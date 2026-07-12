/* PROVIDENCE: HOLLOW KING — deterministic RPG engine over providence_log.
   Pure replay: state = computeState(logRows, rpgEvents, now). No stored aggregates.
   RULES.v=2: shop, embers, weekly boss. Shared verbatim between Providence OS and Providence Log. */
(function (global) {
  "use strict";

  var RULES = {
    v: 2,
    weights: {
      outreach_sent: { per: 3, cap: 150, branch: "STRENGTH" },
      calls_booked: { per: 40, cap: 400, branch: "STRENGTH" },
      deals_closed: { per: 200, cap: 1000, branch: "STRENGTH" },
      revenue: { per: 0.001, cap: 300, branch: "STRENGTH" },
      deep_work_hours: { per: 15, cap: 90, branch: "INTELLECT" },
      pages_read: { per: 2, cap: 40, branch: "INTELLECT" },
      gym_count: { per: 25, cap: 50, branch: "VIGOR" }
    },
    flat: {
      sleep7: { souls: 20, branch: "VIGOR" },
      energy4: { souls: 15, branch: "VIGOR" },
      brain_dump: { souls: 5, branch: "FAITH" },
      bool: { souls: 10, branch: "FAITH" }
    },
    goalsKeptMax: 15,
    igPenaltyPerMin: 1,
    deathStakePct: 0.15, deathStakeMin: 50,
    valor: 0.10,
    corpseRunDeadlineHour: 12,
    hollowMax: 10, healEveryStreak: 3,
    statCost: function (lvl) { return Math.round(80 * Math.pow(lvl, 1.55)); },
    multPerLevel: 0.04, multCap: 0.60,
    titles: [[75, "The Providence"], [50, "Lord of Cinder"], [35, "Lord Hunter"],
             [20, "Kindled"], [10, "Bearer of the Curse"], [0, "Unkindled"]],
    bossReward: 500,
    // roster order = tie-break priority. [metric, name, weekly target]
    bosses: [
      ["outreach_sent", "Gatekeeper of the First Word", 70],
      ["calls_booked", "The Silent Calendar", 3],
      ["deep_work_hours", "The Sloth Devourer", 10],
      ["goals_kept", "Warden of the Broken Vow", 5],       // days with >=1/2 vows kept
      ["instant_grat_minutes", "The Formless Feed", 210]   // INVERSE: weekly budget
    ]
  };

  var SHOP = {
    ember:       { cost: 300, type: "ember",   label: "Ember", max: 2, desc: "Consumed on a missed day: no death, the flame survives." },
    acc_ember:   { cost: 400, type: "accent",  label: "Ember Orange", hex: "#d98a4a" },
    acc_blood:   { cost: 400, type: "accent",  label: "Bloodstain",   hex: "#b56a6a" },
    acc_abyss:   { cost: 400, type: "accent",  label: "Abyss Violet", hex: "#9a8ab5" },
    acc_frost:   { cost: 400, type: "accent",  label: "Frost",        hex: "#9ab5b0" },
    fire_blue:   { cost: 600, type: "fireskin", label: "Blue Flame",  ramp: ["#d9ecff", "#8fc0ee", "#4a86dd", "#274a99"] },
    fire_white:  { cost: 600, type: "fireskin", label: "White Flame", ramp: ["#ffffff", "#f0ead8", "#cfc4a8", "#8f8570"] },
    fire_abyss:  { cost: 600, type: "fireskin", label: "Abyss Fire",  ramp: ["#e8d9ff", "#b48fee", "#7a4add", "#3d2799"] },
    title_flame: { cost: 250, type: "epithet", label: "of the First Flame" },
    title_iron:  { cost: 250, type: "epithet", label: "the Unbroken" }
  };

  var BOOLS = ["reflection_done", "good_routine", "client_delivery_done"];
  var STATS = ["VIGOR", "INTELLECT", "STRENGTH", "FAITH"];

  function isSealed(row) {
    if (!row) return false;
    var numeric = Object.keys(RULES.weights).concat(["sleep_hours", "energy_level", "instant_grat_minutes"]);
    for (var i = 0; i < numeric.length; i++) if (row[numeric[i]] !== null && row[numeric[i]] !== undefined) return true;
    for (var j = 0; j < BOOLS.length; j++) if (row[BOOLS[j]] !== null && row[BOOLS[j]] !== undefined) return true;
    if (row.goals_kept !== null && row.goals_kept !== undefined && row.goals_kept !== "") return true;
    return false;
  }

  function mult(stats, branch) {
    var lvl = stats[branch] || 0;
    return 1 + Math.min(RULES.multCap, lvl * RULES.multPerLevel);
  }

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

  function dstr(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function addDays(ds, n) { var d = new Date(ds + "T12:00:00"); d.setDate(d.getDate() + n); return dstr(d); }
  function mondayOf(ds) { var d = new Date(ds + "T12:00:00"); var w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return dstr(d); }

  function title(level) {
    for (var i = 0; i < RULES.titles.length; i++) if (level >= RULES.titles[i][0]) return RULES.titles[i][1];
    return "Unkindled";
  }

  // weekly metric total from byDate over [monday, monday+6]
  function weekMetric(byDate, monday, metric) {
    var sum = 0;
    for (var i = 0; i < 7; i++) {
      var r = byDate[addDays(monday, i)];
      if (!r) continue;
      if (metric === "goals_kept") {
        var m = String(r.goals_kept || "").match(/^(\d+)\s*\/\s*(\d+)$/);
        if (m && Number(m[2]) > 0 && Number(m[1]) / Number(m[2]) >= 0.5) sum++;
      } else sum += Number(r[metric] || 0);
    }
    return sum;
  }

  // pick the boss for a week: weakest metric of the PREVIOUS week vs target
  function pickBossMetric(byDate, monday) {
    var prev = addDays(monday, -7), worst = null, worstScore = Infinity;
    var any = false;
    for (var i = 0; i < 7; i++) if (byDate[addDays(prev, i)]) { any = true; break; }
    if (!any) return RULES.bosses[0][0];
    RULES.bosses.forEach(function (b) {
      var metric = b[0], target = b[2], got = weekMetric(byDate, prev, metric), score;
      if (metric === "instant_grat_minutes") score = got <= target ? 1 + (target - got) / target : target / got; // over budget = weak
      else score = got / target;
      if (score < worstScore) { worstScore = score; worst = metric; }
    });
    return worst || RULES.bosses[0][0];
  }

  function bossDef(metric) {
    for (var i = 0; i < RULES.bosses.length; i++) if (RULES.bosses[i][0] === metric) return RULES.bosses[i];
    return RULES.bosses[0];
  }

  function questsForDay(row) {
    row = row || {};
    return [
      { name: "Seal the day at the bonfire", done: isSealed(row), hint: "bank your souls" },
      { name: "Send 10+ words into the dark", done: Number(row.outreach_sent || 0) >= 10, hint: "outreach" },
      { name: "Two hours of deep work", done: Number(row.deep_work_hours || 0) >= 2, hint: "30 souls" },
      { name: "Starve the Formless Feed", done: isSealed(row) && Number(row.instant_grat_minutes || 0) === 0, hint: "0 wasted minutes" },
      { name: "Train the body", done: Number(row.gym_count || 0) > 0, hint: "25 souls" },
      { name: "Keep the vows", done: /^([1-9]\d*)\/\1$/.test(String(row.goals_kept || "")), hint: "all intentions" }
    ];
  }

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
      inventory: { embers: 0 }, unlocks: { accents: [], fireskins: [], epithets: [] }, owned: {},
      bloodstain: null, ignoredEvents: [], ledger: [], boss: null,
      todaySealed: !!(byDate[today] && isSealed(byDate[today]))
    };
    var bossMult = {}, bossWins = {}, bossHistory = [];

    function applyEventsUpTo(ts) {
      while (ei < evs.length && new Date(evs[ei].ts) <= ts) {
        var e = evs[ei++];
        if (e.kind === "levelup") {
          var st = e.payload && e.payload.stat;
          if (STATS.indexOf(st) < 0) { state.ignoredEvents.push(e); continue; }
          var cost = RULES.statCost(state.stats[st] + 1);
          if (state.banked >= cost) { state.banked -= cost; state.spent += cost; state.stats[st]++; state.ledger.push({ t: e.ts, msg: st + " raised to " + state.stats[st] + " (-" + cost + ")" }); }
          else state.ignoredEvents.push(e);
        } else if (e.kind === "purchase") {
          var item = SHOP[e.payload && e.payload.item];
          if (!item) { state.ignoredEvents.push(e); continue; }
          if (item.type === "ember" && state.inventory.embers >= item.max) { state.ignoredEvents.push(e); continue; }
          if (item.type !== "ember" && state.owned[e.payload.item]) { state.ignoredEvents.push(e); continue; }
          if (state.banked < item.cost) { state.ignoredEvents.push(e); continue; }
          state.banked -= item.cost; state.spent += item.cost;
          if (item.type === "ember") state.inventory.embers++;
          else {
            state.owned[e.payload.item] = true;
            if (item.type === "accent") state.unlocks.accents.push({ label: item.label, hex: item.hex });
            if (item.type === "fireskin") state.unlocks.fireskins.push({ id: e.payload.item, label: item.label, ramp: item.ramp });
            if (item.type === "epithet") state.unlocks.epithets.push(item.label);
          }
          state.ledger.push({ t: e.ts, msg: "Bought " + item.label + " (-" + item.cost + ")" });
        }
      }
    }

    function spawnBoss(monday) {
      var metric = pickBossMetric(byDate, monday);
      var def = bossDef(metric);
      return { week: monday, metric: metric, name: def[1],
        hp: Math.round(def[2] * (bossMult[metric] || 1)), dmg: 0,
        inverse: metric === "instant_grat_minutes", slain: false };
    }
    function settleBoss(b, weekComplete) { // multipliers + inverse kill at week end
      if (b.inverse && weekComplete && b.dmg <= b.hp && !b.slain) {
        b.slain = true;
        state.banked += RULES.bossReward; state.lifetime += RULES.bossReward;
        state.ledger.push({ t: addDays(b.week, 6), msg: b.name + " SLAIN (+" + RULES.bossReward + " souls)" });
      }
      if (!weekComplete) return;
      bossHistory.push({ week: b.week, metric: b.metric, name: b.name, hp: b.hp, dmg: b.dmg, slain: b.slain });
      if (b.slain) {
        bossWins[b.metric] = (bossWins[b.metric] || 0) + 1;
        if (bossWins[b.metric] >= 2) { bossMult[b.metric] = (bossMult[b.metric] || 1) * 1.15; bossWins[b.metric] = 0; }
      } else {
        bossMult[b.metric] = (bossMult[b.metric] || 1) * 1.10; bossWins[b.metric] = 0;
        state.ledger.push({ t: addDays(b.week, 6), msg: b.name + " endured. It remembers you." });
      }
    }
    function bossDamage(b, row, day) {
      if (!b || !row) return;
      if (b.metric === "goals_kept") {
        var m2 = String(row.goals_kept || "").match(/^(\d+)\s*\/\s*(\d+)$/);
        if (m2 && Number(m2[2]) > 0 && Number(m2[1]) / Number(m2[2]) >= 0.5) b.dmg++;
      } else b.dmg += Number(row[b.metric] || 0);
      if (!b.inverse && !b.slain && b.dmg >= b.hp) {
        b.slain = true;
        state.banked += RULES.bossReward; state.lifetime += RULES.bossReward;
        state.ledger.push({ t: day || b.week, msg: b.name + " SLAIN (+" + RULES.bossReward + " souls)" });
      }
    }

    if (!sealedDates.length) {
      state.level = 0; state.title = title(0); state.nextCost = {};
      STATS.forEach(function (k) { state.nextCost[k] = RULES.statCost(1); });
      return state;
    }

    var healCounter = 0, ei = 0;
    var start = sealedDates[0], cursor = start;
    var pendingStain = null;
    var curBoss = spawnBoss(mondayOf(start));

    while (cursor <= today) {
      var m = mondayOf(cursor);
      if (m !== curBoss.week) { settleBoss(curBoss, true); curBoss = spawnBoss(m); }

      var row = byDate[cursor], sealed = row && isSealed(row);
      var endOfDay = new Date(cursor + "T23:59:59");
      if (row) bossDamage(curBoss, row, cursor);
      applyEventsUpTo(endOfDay);

      if (sealed) {
        var got = soulsForRow(row, state.stats), bonus = 0;
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
      } else if (cursor < today) {
        if (state.inventory.embers > 0) {
          state.inventory.embers--;
          state.ledger.push({ t: cursor, msg: "An Ember kept the flame alive (" + cursor + ")" });
        } else {
          state.deaths++;
          if (pendingStain) {
            state.banked = Math.max(0, state.banked - pendingStain.amount);
            state.hollowing = Math.min(RULES.hollowMax, state.hollowing + 1);
            state.ledger.push({ t: cursor, msg: "Bloodstain lost: -" + pendingStain.amount + " souls, hollowing " + state.hollowing });
          }
          var stake = Math.max(RULES.deathStakeMin, Math.round(state.banked * RULES.deathStakePct));
          pendingStain = { date: cursor, amount: Math.min(stake, state.banked) };
          state.streak = 0; healCounter = 0;
          state.ledger.push({ t: cursor, msg: "YOU DIED. Bloodstain holds " + pendingStain.amount + " souls" });
        }
      }
      if (cursor === today) break;
      cursor = addDays(cursor, 1);
    }
    applyEventsUpTo(now);

    if (pendingStain) {
      var deadline = new Date(addDays(pendingStain.date, 1) + "T" + (RULES.corpseRunDeadlineHour < 10 ? "0" : "") + RULES.corpseRunDeadlineHour + ":00:00");
      state.bloodstain = { date: pendingStain.date, amount: pendingStain.amount, deadline: deadline.toISOString(), expired: now > deadline };
    }

    // if replay never reached this week (all history older), fast-forward the boss
    if (curBoss.week !== mondayOf(today)) { settleBoss(curBoss, true); curBoss = spawnBoss(mondayOf(today)); }
    var sunday = addDays(curBoss.week, 6);
    state.boss = {
      metric: curBoss.metric, name: curBoss.name, hp: curBoss.hp, dmg: Math.round(curBoss.dmg * 10) / 10,
      inverse: curBoss.inverse, slain: curBoss.slain,
      daysLeft: Math.max(0, Math.round((new Date(sunday + "T23:59:59") - now) / 86400000)),
      week: curBoss.week, reward: RULES.bossReward, history: bossHistory.slice(-6)
    };

    var lvl = STATS.reduce(function (s, k) { return s + state.stats[k]; }, 0);
    state.level = lvl; state.title = title(lvl);
    state.nextCost = {}; STATS.forEach(function (k) { state.nextCost[k] = RULES.statCost(state.stats[k] + 1); });
    state.ledger = state.ledger.slice(-12);
    return state;
  }

  var API = { RULES: RULES, SHOP: SHOP, computeState: computeState, soulsForRow: soulsForRow, isSealed: isSealed, title: title, STATS: STATS, questsForDay: questsForDay, mondayOf: mondayOf };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.HollowKing = API;
})(typeof window !== "undefined" ? window : globalThis);
