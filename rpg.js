/* PROVIDENCE: HOLLOW KING — deterministic RPG engine over providence_log.
   Pure replay: state = computeState(logRows, rpgEvents, now). No stored aggregates.
   RULES.v=1. Shared verbatim between Providence OS (HUD) and Providence Log (PWA). */
(function (global) {
  "use strict";

  var RULES = {
    v: 1,
    // per-unit soul weights with daily caps (anti-farm)
    weights: {
      outreach_sent: { per: 3, cap: 150, branch: "STRENGTH" },
      calls_booked: { per: 40, cap: 400, branch: "STRENGTH" },
      deals_closed: { per: 200, cap: 1000, branch: "STRENGTH" },
      revenue: { per: 0.001, cap: 300, branch: "STRENGTH" }, // 1 soul per 1000 Kc
      deep_work_hours: { per: 15, cap: 90, branch: "INTELLECT" },
      pages_read: { per: 2, cap: 40, branch: "INTELLECT" },
      gym_count: { per: 25, cap: 50, branch: "VIGOR" }
    },
    flat: {
      sleep7: { souls: 20, branch: "VIGOR" },      // sleep_hours >= 7
      energy4: { souls: 15, branch: "VIGOR" },     // energy_level >= 4
      brain_dump: { souls: 5, branch: "FAITH" },   // non-empty
      bool: { souls: 10, branch: "FAITH" }         // each daily standard kept
    },
    goalsKeptMax: 15,                               // 15 * kept/total, FAITH
    igPenaltyPerMin: 1,                             // instant_grat_minutes, floor day at 0
    deathStakePct: 0.15, deathStakeMin: 50,         // bloodstain stake
    valor: 0.10,                                    // corpse-run bonus on recovery day
    corpseRunDeadlineHour: 12,                      // seal next day before noon
    hollowMax: 10, healEveryStreak: 3,              // 3 consecutive seals heal 1 hollowing
    statCost: function (lvl) { return Math.round(80 * Math.pow(lvl, 1.55)); },
    multPerLevel: 0.04, multCap: 0.60,
    titles: [[75, "The Providence"], [50, "Lord of Cinder"], [35, "Lord Hunter"],
             [20, "Kindled"], [10, "Bearer of the Curse"], [0, "Unkindled"]]
  };

  var BOOLS = ["reflection_done", "good_routine", "client_delivery_done"];
  var STATS = ["VIGOR", "INTELLECT", "STRENGTH", "FAITH"];

  function isSealed(row) {
    if (!row) return false;
    var numeric = Object.keys(RULES.weights).concat(["sleep_hours", "energy_level", "instant_grat_minutes"]);
    for (var i = 0; i < numeric.length; i++) if (row[numeric[i]] !== null && row[numeric[i]] !== undefined) return true;
    for (var j = 0; j < BOOLS.length; j++) if (row[BOOLS[j]] !== null && row[BOOLS[j]] !== undefined) return true;
    if (row.goals_kept !== null && row.goals_kept !== undefined && row.goals_kept !== "") return true;
    return false; // intentions-only row (tomorrow goals) is NOT a seal
  }

  function mult(stats, branch) {
    var lvl = stats[branch] || 0;
    return 1 + Math.min(RULES.multCap, lvl * RULES.multPerLevel);
  }

  // Souls for one sealed row given current stat levels. Returns {total, parts:[{k,souls,branch}]}
  function soulsForRow(row, stats) {
    var parts = [], total = 0;
    function add(k, raw, branch) {
      var s = Math.round(raw * mult(stats, branch));
      if (s !== 0) { parts.push({ k: k, souls: s, branch: branch }); total += s; }
    }
    for (var k in RULES.weights) {
      var w = RULES.weights[k], v = Number(row[k] || 0);
      if (v > 0) add(k, Math.min(w.cap, v * w.per), w.branch);
    }
    if (Number(row.sleep_hours || 0) >= 7) add("sleep 7h+", RULES.flat.sleep7.souls, "VIGOR");
    if (Number(row.energy_level || 0) >= 4) add("energy 4+", RULES.flat.energy4.souls, "VIGOR");
    if ((row.brain_dump || "").trim()) add("brain dump", RULES.flat.brain_dump.souls, "FAITH");
    BOOLS.forEach(function (b) { if (row[b] === true) add(b.replace(/_/g, " "), RULES.flat.bool.souls, "FAITH"); });
    var gk = String(row.goals_kept || "");
    var m = gk.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (m && Number(m[2]) > 0) add("vows kept " + gk, Math.round(RULES.goalsKeptMax * Number(m[1]) / Number(m[2])), "FAITH");
    var ig = Number(row.instant_grat_minutes || 0);
    if (ig > 0) { var pen = Math.min(total, ig * RULES.igPenaltyPerMin); parts.push({ k: "the formless feed", souls: -pen, branch: "FAITH" }); total -= pen; }
    return { total: Math.max(0, total), parts: parts };
  }

  function dstr(d) { // local YYYY-MM-DD
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function addDays(ds, n) { var d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n); return dstr(d); }

  function title(level) {
    for (var i = 0; i < RULES.titles.length; i++) if (level >= RULES.titles[i][0]) return RULES.titles[i][1];
    return "Unkindled";
  }

  /* computeState(rows, events, now)
     rows: providence_log rows (any order), each {date, created_at, ...fields}
     events: rpg_events rows {ts, kind, payload} — kinds used here: levelup {stat}
     now: Date */
  function computeState(rows, events, now) {
    now = now || new Date();
    var byDate = {}; (rows || []).forEach(function (r) { byDate[r.date] = r; });
    var evs = (events || []).slice().sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });

    var sealedDates = Object.keys(byDate).filter(function (d) { return isSealed(byDate[d]); }).sort();
    var today = dstr(now);
    var state = {
      rulesV: RULES.v, banked: 0, spent: 0, lifetime: 0,
      stats: { VIGOR: 0, INTELLECT: 0, STRENGTH: 0, FAITH: 0 },
      hollowing: 0, deaths: 0, streak: 0, bestStreak: 0,
      bloodstain: null, ignoredEvents: [], ledger: [], todaySealed: !!(byDate[today] && isSealed(byDate[today]))
    };
    if (!sealedDates.length) { state.level = 0; state.title = title(0); state.nextCost = RULES.statCost(1); return state; }

    var healCounter = 0, ei = 0;
    var start = sealedDates[0], cursor = start;
    var pendingStain = null; // {date, amount}

    function applyEventsUpTo(ts) {
      while (ei < evs.length && new Date(evs[ei].ts) <= ts) {
        var e = evs[ei++];
        if (e.kind === "levelup") {
          var st = e.payload && e.payload.stat;
          if (STATS.indexOf(st) < 0) { state.ignoredEvents.push(e); continue; }
          var cost = RULES.statCost(state.stats[st] + 1);
          if (state.banked >= cost) { state.banked -= cost; state.spent += cost; state.stats[st]++; state.ledger.push({ t: e.ts, msg: st + " raised to " + state.stats[st] + " (-" + cost + ")" }); }
          else state.ignoredEvents.push(e);
        }
      }
    }

    while (cursor <= today) {
      var row = byDate[cursor], sealed = row && isSealed(row);
      var endOfDay = new Date(cursor + "T23:59:59");
      applyEventsUpTo(endOfDay);

      if (sealed) {
        var got = soulsForRow(row, state.stats), bonus = 0;
        // corpse run check: previous day died, this seal before noon reclaims
        if (pendingStain) {
          var created = row.created_at ? new Date(row.created_at) : endOfDay;
          if (cursor === addDays(pendingStain.date, 1) && created.getHours() < RULES.corpseRunDeadlineHour) {
            bonus = Math.round(got.total * RULES.valor);
            state.ledger.push({ t: cursor, msg: "CORPSE RUN: " + pendingStain.amount + " souls reclaimed, +" + bonus + " valor" });
          } else {
            state.banked = Math.max(0, state.banked - pendingStain.amount);
            state.hollowing = Math.min(RULES.hollowMax, state.hollowing + 1);
            state.ledger.push({ t: cursor, msg: "Bloodstain lost: -" + pendingStain.amount + " souls, hollowing " + state.hollowing });
          }
          pendingStain = null;
        }
        state.banked += got.total + bonus; state.lifetime += got.total + bonus;
        state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak);
        healCounter++;
        if (healCounter >= RULES.healEveryStreak && state.hollowing > 0) { state.hollowing--; healCounter = 0; state.ledger.push({ t: cursor, msg: "Humanity restored: hollowing " + state.hollowing }); }
      } else if (cursor < today) { // a fully past unsealed day = death
        state.deaths++;
        if (pendingStain) { // previous stain expires unrecovered
          state.banked = Math.max(0, state.banked - pendingStain.amount);
          state.hollowing = Math.min(RULES.hollowMax, state.hollowing + 1);
          state.ledger.push({ t: cursor, msg: "Bloodstain lost: -" + pendingStain.amount + " souls, hollowing " + state.hollowing });
        }
        var stake = Math.max(RULES.deathStakeMin, Math.round(state.banked * RULES.deathStakePct));
        pendingStain = { date: cursor, amount: Math.min(stake, state.banked) };
        state.streak = 0; healCounter = 0;
        state.ledger.push({ t: cursor, msg: "YOU DIED. Bloodstain holds " + pendingStain.amount + " souls" });
      }
      if (cursor === today) break;
      cursor = addDays(cursor, 1);
    }
    applyEventsUpTo(now);

    // active stain (yesterday died, today not yet sealed): corpse run window
    if (pendingStain) {
      var deadline = new Date(addDays(pendingStain.date, 1) + "T" + (RULES.corpseRunDeadlineHour < 10 ? "0" : "") + RULES.corpseRunDeadlineHour + ":00:00");
      state.bloodstain = { date: pendingStain.date, amount: pendingStain.amount, deadline: deadline.toISOString(), expired: now > deadline };
    }
    var lvl = STATS.reduce(function (s, k) { return s + state.stats[k]; }, 0);
    state.level = lvl; state.title = title(lvl);
    state.nextCost = {}; STATS.forEach(function (k) { state.nextCost[k] = RULES.statCost(state.stats[k] + 1); });
    state.ledger = state.ledger.slice(-12);
    return state;
  }

  var API = { RULES: RULES, computeState: computeState, soulsForRow: soulsForRow, isSealed: isSealed, title: title, STATS: STATS };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.HollowKing = API;
})(typeof window !== "undefined" ? window : globalThis);
