/* PROVIDENCE: HOLLOW KING — deterministic RPG engine over providence_log.
   Pure replay: state = computeState(logRows, rpgEvents, now). No stored aggregates.
   RULES.v=3 (AXIOM RISEN): loot, equipment, deeds, titles, streak buff, jackpot, Tavern Board.
   Shared verbatim between Providence OS and Providence Log. */
(function (global) {
  "use strict";

  var RULES = {
    v: 3,
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
    multPerLevel: 0.04, multCap: 0.60, totalMultCap: 0.80,
    streakBuffPer: 0.02, streakBuffCap: 0.30,
    jackpotSouls: 500,
    titles: [[75, "The Providence"], [50, "Lord of Cinder"], [35, "Lord Hunter"],
             [20, "Kindled"], [10, "Bearer of the Curse"], [0, "Unkindled"]],
    bossReward: 500,
    bosses: [
      ["outreach_sent", "Gatekeeper of the First Word", 70],
      ["calls_booked", "The Silent Calendar", 3],
      ["deep_work_hours", "The Sloth Devourer", 10],
      ["goals_kept", "Warden of the Broken Vow", 5],
      ["instant_grat_minutes", "The Formless Feed", 210]
    ],
    rarityMult: { common: 0.03, rare: 0.05, epic: 0.08, legendary: 0.12 },
    rarityColor: { common: "#BDBDBD", rare: "#42A5F5", epic: "#AB47BC", legendary: "#FFD700" },
    dropChance: 0.5,
    rarityWeights: [["common", 70], ["rare", 20], ["epic", 8], ["legendary", 2]],
    bossRarityWeights: [["rare", 70], ["epic", 22], ["legendary", 8]]
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
    title_iron:  { cost: 250, type: "epithet", label: "the Unbroken Will" }
  };

  var SLOTS = ["BLADE", "HELM", "CLOAK", "RING", "TALISMAN", "LANTERN"];

  /* id: {slot, rarity, branch, label, unique?} — unique items never drop, only deeds grant them */
  var ITEMS = {
    blade_first_word:  { slot: "BLADE", rarity: "common",    branch: "STRENGTH",  label: "Blade of the First Word" },
    blade_cold_iron:   { slot: "BLADE", rarity: "rare",      branch: "STRENGTH",  label: "Cold Iron of the Opener" },
    blade_closer:      { slot: "BLADE", rarity: "epic",      branch: "STRENGTH",  label: "Closer's Edge" },
    blade_calendar:    { slot: "BLADE", rarity: "legendary", branch: "STRENGTH",  label: "Fang of the Silent Calendar" },
    helm_quiet:        { slot: "HELM", rarity: "common",     branch: "VIGOR",     label: "Helm of the Quiet Mind" },
    helm_iron_sleep:   { slot: "HELM", rarity: "rare",       branch: "VIGOR",     label: "Helm of Iron Sleep" },
    helm_clarity:      { slot: "HELM", rarity: "epic",       branch: "INTELLECT", label: "Crown of Morning Clarity" },
    helm_abyss:        { slot: "HELM", rarity: "legendary",  branch: "INTELLECT", label: "Crown of the Abyss Gazer" },
    cloak_sealed:      { slot: "CLOAK", rarity: "common",    branch: "FAITH",     label: "Cloak of the Sealed Days" },
    cloak_ember:       { slot: "CLOAK", rarity: "rare",      branch: "VIGOR",     label: "Cloak of Ember and Ash" },
    cloak_vowkeeper:   { slot: "CLOAK", rarity: "epic",      branch: "FAITH",     label: "Vowkeeper's Shroud" },
    cloak_night:       { slot: "CLOAK", rarity: "legendary", branch: "FAITH",     label: "Shroud of the Unbroken Night" },
    ring_proofs:       { slot: "RING", rarity: "common",     branch: "FAITH",     label: "Ring of Small Proofs" },
    ring_deep:         { slot: "RING", rarity: "rare",       branch: "INTELLECT", label: "Ring of the Deep Hours" },
    ring_unbroken:     { slot: "RING", rarity: "epic",       branch: "FAITH",     label: "Ring of the Unbroken" },
    ring_rainmaker:    { slot: "RING", rarity: "legendary",  branch: "STRENGTH",  label: "Ledger of the Rainmaker" },
    tal_coffee:        { slot: "TALISMAN", rarity: "common",   branch: "INTELLECT", label: "Coffee of Clarity" },
    tal_feed_ward:     { slot: "TALISMAN", rarity: "rare",     branch: "FAITH",     label: "Ward Against the Formless Feed" },
    tal_first_flame:   { slot: "TALISMAN", rarity: "epic",     branch: "VIGOR",     label: "Charm of the First Flame" },
    tal_eye_shard:     { slot: "TALISMAN", rarity: "legendary", branch: "INTELLECT", label: "Eye Shard of Providence" },
    lan_hunter:        { slot: "LANTERN", rarity: "common",    branch: "VIGOR",     label: "Hunter's Lantern" },
    lan_grey_ward:     { slot: "LANTERN", rarity: "rare",      branch: "FAITH",     label: "Lantern Against the Grey" },
    lan_moonlit:       { slot: "LANTERN", rarity: "epic",      branch: "INTELLECT", label: "Moonlit Lantern" },
    lan_dawn:          { slot: "LANTERN", rarity: "legendary", branch: "STRENGTH",  label: "Dawnbringer Lantern" },
    band_iron_will:    { slot: "RING", rarity: "epic",      branch: "FAITH",    label: "Band of Iron Will", unique: true },
    coin_golden_day:   { slot: "TALISMAN", rarity: "legendary", branch: "STRENGTH", label: "Coin of the Golden Day", unique: true },
    helm_vanquisher:   { slot: "HELM", rarity: "epic",      branch: "STRENGTH", label: "Trophy Helm of the Vanquisher", unique: true }
  };
  var DROP_POOL = {};
  Object.keys(ITEMS).forEach(function (id) {
    if (ITEMS[id].unique) return;
    var r = ITEMS[id].rarity; (DROP_POOL[r] = DROP_POOL[r] || []).push(id);
  });

  /* DEEDS: cond gets a live ctx during replay; reward at unlock day */
  var DEEDS = [
    { id: "first_blood",  name: "First Blood",        how: "seal your first day",              souls: 50 },
    { id: "kindling",     name: "Kindling",           how: "7 day streak",                     souls: 100 },
    { id: "iron_will",    name: "Iron Will",          how: "30 day streak",                    souls: 300, item: "band_iron_will", title: "the Iron-Willed" },
    { id: "unbroken",     name: "The Unbroken",       how: "90 day streak",                    souls: 1000, title: "the Unbroken" },
    { id: "rainmaker",    name: "The Rainmaker",      how: "50+ outreach in one day",          souls: 200, title: "the Rainmaker" },
    { id: "golden_day",   name: "The Golden Day",     how: "50 000+ revenue in one day",       souls: 300, item: "coin_golden_day", title: "Jackpot King" },
    { id: "monk_mode",    name: "Monk Mode",          how: "7 sealed days with zero feed",     souls: 150 },
    { id: "time_weaver",  name: "The Time Weaver",    how: "4h+ deep work in one day",         souls: 150, title: "the Time Weaver" },
    { id: "first_hunt",   name: "First Hunt",         how: "close your first deal",            souls: 200 },
    { id: "bossbane",     name: "Bossbane",           how: "slay 3 weekly bosses",             souls: 250, item: "helm_vanquisher" },
    { id: "cinderlord",   name: "Cinderlord",         how: "slay 10 weekly bosses",            souls: 600, title: "Cinderlord" },
    { id: "board_lord",   name: "Lord of the Board",  how: "claim 10 tavern quests",           souls: 200, title: "Lord of the Board" },
    { id: "scholar",      name: "The Scholar",        how: "100 pages read, lifetime",         souls: 100 },
    { id: "corpse_runner",name: "The Corpse Runner",  how: "reclaim a bloodstain before noon", souls: 100 },
    { id: "humanity",     name: "Humanity Restored",  how: "heal from hollowing 3+ to zero",   souls: 150 },
    { id: "patron",       name: "Patron of the Firekeeper", how: "first purchase",             souls: 50 },
    { id: "ascendant",    name: "The Ascendant",      how: "reach level 20",                   souls: 300, title: "the Ascendant" },
    { id: "vowlord",      name: "Vowlord",            how: "20 days with every vow kept",      souls: 200, title: "Vowlord" }
  ];

  /* Tavern Board quest templates. verify: metric (row threshold) | seal (row condition) | honor */
  var QUESTS = [
    { id: "q_words15", name: "Send 15 words into the dark",      dur: 60,  souls: 90,  verify: "metric", metric: "outreach_sent", min: 15 },
    { id: "q_words30", name: "The long watch of the Gatekeeper", dur: 120, souls: 180, verify: "metric", metric: "outreach_sent", min: 30 },
    { id: "q_deep1",   name: "One hour, undisturbed",            dur: 60,  souls: 60,  verify: "metric", metric: "deep_work_hours", min: 1 },
    { id: "q_deep2",   name: "Two hours in the depths",          dur: 120, souls: 120, verify: "metric", metric: "deep_work_hours", min: 2 },
    { id: "q_call",    name: "A voice answers in the dark",      dur: 90,  souls: 150, verify: "metric", metric: "calls_booked", min: 1 },
    { id: "q_train",   name: "Temper the body",                  dur: 90,  souls: 80,  verify: "metric", metric: "gym_count", min: 1 },
    { id: "q_pages",   name: "Read the old scrolls",             dur: 60,  souls: 60,  verify: "metric", metric: "pages_read", min: 10 },
    { id: "q_zero",    name: "Starve the Formless Feed",         dur: 240, souls: 100, verify: "seal",   check: "ig0" },
    { id: "q_vows",    name: "Keep every vow",                   dur: 240, souls: 120, verify: "seal",   check: "vows" },
    { id: "q_reflect", name: "Sit with the day",                 dur: 30,  souls: 60,  verify: "seal",   check: "reflect" },
    { id: "q_dump",    name: "Empty the mind into the well",     dur: 30,  souls: 50,  verify: "seal",   check: "dump" },
    { id: "q_hard",    name: "Write the hardest message first",  dur: 30,  souls: 70,  verify: "honor" },
    { id: "q_walk",    name: "Walk without the lantern (no phone)", dur: 45, souls: 60, verify: "honor" },
    { id: "q_client",  name: "Move a client's world forward",    dur: 90,  souls: 100, verify: "seal",   check: "delivery" }
  ];
  var SEAL_CHECKS = {
    ig0:      function (row) { return Number(row.instant_grat_minutes || 0) === 0; },
    vows:     function (row) { return /^([1-9]\d*)\/\1$/.test(String(row.goals_kept || "")); },
    reflect:  function (row) { return row.reflection_done === true; },
    dump:     function (row) { return (row.brain_dump || "").trim().length > 0; },
    delivery: function (row) { return row.client_delivery_done === true; }
  };

  var BOOLS = ["reflection_done", "good_routine", "client_delivery_done"];
  var STATS = ["VIGOR", "INTELLECT", "STRENGTH", "FAITH"];

  /* ── seeded RNG (deterministic loot) ── */
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pickWeighted(rng, pairs) {
    var tot = 0, i; for (i = 0; i < pairs.length; i++) tot += pairs[i][1];
    var x = rng() * tot;
    for (i = 0; i < pairs.length; i++) { x -= pairs[i][1]; if (x <= 0) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  }
  function rollDrop(seedStr, weights, guaranteed) {
    var rng = mulberry32(hash32(seedStr));
    if (!guaranteed && rng() > RULES.dropChance) return null;
    var rarity = pickWeighted(rng, weights || RULES.rarityWeights);
    var pool = DROP_POOL[rarity] || DROP_POOL.common;
    return pool[Math.floor(rng() * pool.length)];
  }

  function boardFor(date) {
    var rng = mulberry32(hash32("board:" + date));
    var idx = QUESTS.map(function (_, i) { return i; });
    var out = [];
    while (out.length < 3 && idx.length) out.push(QUESTS[idx.splice(Math.floor(rng() * idx.length), 1)[0]]);
    return out;
  }

  function isSealed(row) {
    if (!row) return false;
    var numeric = Object.keys(RULES.weights).concat(["sleep_hours", "energy_level", "instant_grat_minutes"]);
    for (var i = 0; i < numeric.length; i++) if (row[numeric[i]] !== null && row[numeric[i]] !== undefined) return true;
    for (var j = 0; j < BOOLS.length; j++) if (row[BOOLS[j]] !== null && row[BOOLS[j]] !== undefined) return true;
    if (row.goals_kept !== null && row.goals_kept !== undefined && row.goals_kept !== "") return true;
    return false;
  }

  function gearBonus(equipped, branch) {
    var b = 0;
    SLOTS.forEach(function (s) {
      var it = equipped[s] && ITEMS[equipped[s]];
      if (it && it.branch === branch) b += RULES.rarityMult[it.rarity];
    });
    return b;
  }
  function mult(stats, branch, equipped) {
    var lvl = stats[branch] || 0;
    var m = Math.min(RULES.multCap, lvl * RULES.multPerLevel) + (equipped ? gearBonus(equipped, branch) : 0);
    return 1 + Math.min(RULES.totalMultCap, m);
  }

  /* souls for one sealed row; ctx = {stats, equipped, streak} (streak BEFORE this day) */
  function soulsForRow(row, statsOrCtx, maybeEquipped, maybeStreak) {
    var ctx = (statsOrCtx && statsOrCtx.stats) ? statsOrCtx
      : { stats: statsOrCtx || {}, equipped: maybeEquipped || {}, streak: maybeStreak || 0 };
    var parts = [], total = 0;
    function add(k, raw, branch) {
      var s = Math.round(raw * mult(ctx.stats, branch, ctx.equipped));
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
    total = Math.max(0, total);
    var buff = Math.min(RULES.streakBuffCap, (ctx.streak || 0) * RULES.streakBuffPer);
    if (buff > 0 && total > 0) {
      var extra = Math.round(total * buff);
      parts.push({ k: "flame buff +" + Math.round(buff * 100) + "%", souls: extra, branch: "FAITH" });
      total += extra;
    }
    return { total: total, parts: parts, buff: buff };
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
  function pickBossMetric(byDate, monday) {
    var prev = addDays(monday, -7), worst = null, worstScore = Infinity, any = false;
    for (var i = 0; i < 7; i++) if (byDate[addDays(prev, i)]) { any = true; break; }
    if (!any) return RULES.bosses[0][0];
    RULES.bosses.forEach(function (b) {
      var metric = b[0], target = b[2], got = weekMetric(byDate, prev, metric), score;
      if (metric === "instant_grat_minutes") score = got <= target ? 1 + (target - got) / target : target / got;
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
    var evs = (events || []).slice().sort(function (a, b) { return new Date(a.ts) - new Date(b.ts) || (a.id || 0) - (b.id || 0); });

    var sealedDates = Object.keys(byDate).filter(function (d) { return isSealed(byDate[d]); }).sort();
    var today = dstr(now);
    var state = {
      rulesV: RULES.v, banked: 0, spent: 0, lifetime: 0,
      stats: { VIGOR: 0, INTELLECT: 0, STRENGTH: 0, FAITH: 0 },
      hollowing: 0, deaths: 0, streak: 0, bestStreak: 0,
      inventory: { embers: 0 }, items: {}, equipped: {},
      unlocks: { accents: [], fireskins: [], epithets: [] }, owned: {},
      deeds: [], deedIds: {}, jackpots: 0, questsClaimed: 0, bossKills: 0,
      bloodstain: null, ignoredEvents: [], ledger: [], boss: null,
      todaySealed: !!(byDate[today] && isSealed(byDate[today]))
    };
    var bossMult = {}, bossWins = {}, bossHistory = [];
    var counters = { zeroFeedDays: 0, pagesTotal: 0, vowDays: 0, corpseRuns: 0, purchased: false, maxHollow: 0, healedFromDeep: false, maxRevenue: 0 };

    /* quest bookkeeping: starts/claims grouped by local date of the event */
    var qStartByDate = {}, qClaimByDate = {};
    evs.forEach(function (e) {
      if (e.kind !== "quest_start" && e.kind !== "quest_claim") return;
      var d = dstr(new Date(e.ts));
      var q = e.payload && e.payload.qid;
      if (!q) { state.ignoredEvents.push(e); return; }
      if (e.kind === "quest_start") (qStartByDate[d] = qStartByDate[d] || []).push({ qid: q, ts: new Date(e.ts) });
      else (qClaimByDate[d] = qClaimByDate[d] || []).push({ qid: q, ts: new Date(e.ts) });
    });
    /* resolved quests for a date: started on board, one-at-a-time, claimed after duration */
    function questsResolved(date) {
      var starts = (qStartByDate[date] || []).slice().sort(function (a, b) { return a.ts - b.ts; });
      var claims = qClaimByDate[date] || [];
      var board = boardFor(date).map(function (q) { return q.id; });
      var done = [], current = null;
      starts.forEach(function (st) {
        if (board.indexOf(st.qid) < 0) return;              // not on this day's board
        if (current && !current.claimed) return;             // one at a time
        var q = QUESTS.filter(function (x) { return x.id === st.qid; })[0];
        current = { q: q, start: st.ts, claimed: false };
        var cl = claims.filter(function (c) { return c.qid === st.qid && (c.ts - st.ts) >= q.dur * 60000; })[0];
        if (cl) { current.claimed = true; current.claimTs = cl.ts; done.push(current); }
      });
      return { done: done, current: current };
    }

    function grantItem(id, when, why) {
      if (state.items[id]) { // duplicate → half rarity value in souls
        var val = Math.round(200 * (RULES.rarityMult[ITEMS[id].rarity] / 0.03) * 0.5);
        state.banked += val; state.lifetime += val;
        state.ledger.push({ t: when, msg: "Duplicate " + ITEMS[id].label + " melted (+" + val + ")" });
      } else {
        state.items[id] = { got: when };
        state.ledger.push({ t: when, msg: (why || "LOOT") + ": " + ITEMS[id].label + " [" + ITEMS[id].rarity + "]" });
        state.lastDrop = { id: id, when: when };
      }
    }
    function unlockDeed(id, when) {
      if (state.deedIds[id]) return;
      var d = DEEDS.filter(function (x) { return x.id === id; })[0];
      if (!d) return;
      state.deedIds[id] = when;
      state.deeds.push({ id: id, name: d.name, when: when });
      if (d.souls) { state.banked += d.souls; state.lifetime += d.souls; }
      if (d.item) grantItem(d.item, when, "DEED");
      if (d.title && state.unlocks.epithets.indexOf(d.title) < 0) state.unlocks.epithets.push(d.title);
      state.ledger.push({ t: when, msg: "DEED: " + d.name + (d.souls ? " (+" + d.souls + ")" : "") });
    }
    function checkDeeds(date, row) {
      if (state.streak >= 1) unlockDeed("first_blood", date);
      if (state.streak >= 7) unlockDeed("kindling", date);
      if (state.streak >= 30) unlockDeed("iron_will", date);
      if (state.streak >= 90) unlockDeed("unbroken", date);
      if (row) {
        if (Number(row.outreach_sent || 0) >= 50) unlockDeed("rainmaker", date);
        if (Number(row.revenue || 0) >= 50000) unlockDeed("golden_day", date);
        if (Number(row.deep_work_hours || 0) >= 4) unlockDeed("time_weaver", date);
        if (Number(row.deals_closed || 0) >= 1) unlockDeed("first_hunt", date);
      }
      if (counters.zeroFeedDays >= 7) unlockDeed("monk_mode", date);
      if (counters.pagesTotal >= 100) unlockDeed("scholar", date);
      if (counters.vowDays >= 20) unlockDeed("vowlord", date);
      if (counters.corpseRuns >= 1) unlockDeed("corpse_runner", date);
      if (counters.healedFromDeep) unlockDeed("humanity", date);
      if (counters.purchased) unlockDeed("patron", date);
      if (state.bossKills >= 3) unlockDeed("bossbane", date);
      if (state.bossKills >= 10) unlockDeed("cinderlord", date);
      if (state.questsClaimed >= 10) unlockDeed("board_lord", date);
      var lvl = STATS.reduce(function (s, k) { return s + state.stats[k]; }, 0);
      if (lvl >= 20) unlockDeed("ascendant", date);
    }

    function spawnBoss(monday) {
      var metric = pickBossMetric(byDate, monday);
      var def = bossDef(metric);
      return { week: monday, metric: metric, name: def[1],
        hp: Math.round(def[2] * (bossMult[metric] || 1)), dmg: 0,
        inverse: metric === "instant_grat_minutes", slain: false };
    }
    function settleBoss(b, weekComplete) {
      if (b.inverse && weekComplete && b.dmg <= b.hp && !b.slain) {
        b.slain = true; state.bossKills++;
        state.banked += RULES.bossReward; state.lifetime += RULES.bossReward;
        state.ledger.push({ t: addDays(b.week, 6), msg: b.name + " SLAIN (+" + RULES.bossReward + ")" });
        grantItem(rollDrop("bossdrop:" + b.week + ":" + b.metric, RULES.bossRarityWeights, true), addDays(b.week, 6), "BOSS LOOT");
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
        b.slain = true; state.bossKills++;
        state.banked += RULES.bossReward; state.lifetime += RULES.bossReward;
        state.ledger.push({ t: day || b.week, msg: b.name + " SLAIN (+" + RULES.bossReward + ")" });
        grantItem(rollDrop("bossdrop:" + b.week + ":" + b.metric, RULES.bossRarityWeights, true), day || b.week, "BOSS LOOT");
      }
    }

    var ei = 0;
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
          counters.purchased = true;
          if (item.type === "ember") state.inventory.embers++;
          else {
            state.owned[e.payload.item] = true;
            if (item.type === "accent") state.unlocks.accents.push({ label: item.label, hex: item.hex });
            if (item.type === "fireskin") state.unlocks.fireskins.push({ id: e.payload.item, label: item.label, ramp: item.ramp });
            if (item.type === "epithet") state.unlocks.epithets.push(item.label);
          }
          state.ledger.push({ t: e.ts, msg: "Bought " + item.label + " (-" + item.cost + ")" });
        } else if (e.kind === "equip") {
          var slot = e.payload && e.payload.slot, id = e.payload && e.payload.item;
          if (slot === "TITLE") {
            if (!id || state.unlocks.epithets.indexOf(id) >= 0) state.equipped.TITLE = id || null;
            else state.ignoredEvents.push(e);
          } else if (SLOTS.indexOf(slot) >= 0) {
            if (!id) { state.equipped[slot] = null; }
            else if (state.items[id] && ITEMS[id] && ITEMS[id].slot === slot) state.equipped[slot] = id;
            else state.ignoredEvents.push(e);
          } else state.ignoredEvents.push(e);
        }
        /* quest_start / quest_claim handled by questsResolved during the day loop */
      }
    }

    if (!sealedDates.length) {
      state.level = 0; state.title = title(0); state.nextCost = {};
      STATS.forEach(function (k) { state.nextCost[k] = RULES.statCost(1); });
      state.board = boardFor(today).map(function (q) { return { id: q.id, name: q.name, dur: q.dur, souls: q.souls, verify: q.verify, status: "available" }; });
      return state;
    }

    var healCounter = 0;
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
        var got = soulsForRow(row, { stats: state.stats, equipped: state.equipped, streak: state.streak }), bonus = 0;
        if (pendingStain) {
          var created = row.created_at ? new Date(row.created_at) : endOfDay;
          if (cursor === addDays(pendingStain.date, 1) && created.getHours() < RULES.corpseRunDeadlineHour) {
            bonus = Math.round(got.total * RULES.valor);
            counters.corpseRuns++;
            state.ledger.push({ t: cursor, msg: "CORPSE RUN: " + pendingStain.amount + " souls reclaimed, +" + bonus + " valor" });
          } else {
            state.banked = Math.max(0, state.banked - pendingStain.amount);
            state.hollowing = Math.min(RULES.hollowMax, state.hollowing + 1);
            counters.maxHollow = Math.max(counters.maxHollow, state.hollowing);
            state.ledger.push({ t: cursor, msg: "Bloodstain lost: -" + pendingStain.amount + ", hollowing " + state.hollowing });
          }
          pendingStain = null;
        }
        state.banked += got.total + bonus; state.lifetime += got.total + bonus;
        /* jackpot: all-time revenue record beaten */
        var rev = Number(row.revenue || 0);
        if (rev > 0 && counters.maxRevenue > 0 && rev > counters.maxRevenue) {
          state.banked += RULES.jackpotSouls; state.lifetime += RULES.jackpotSouls; state.jackpots++;
          state.ledger.push({ t: cursor, msg: "JACKPOT: a new golden day (+" + RULES.jackpotSouls + ")" });
        }
        counters.maxRevenue = Math.max(counters.maxRevenue, rev);
        /* tavern quests of this day: souls land with the seal */
        var qr = questsResolved(cursor);
        qr.done.forEach(function (dq) {
          var ok = dq.q.verify === "honor" ? true
            : dq.q.verify === "seal" ? SEAL_CHECKS[dq.q.check](row)
            : Number(row[dq.q.metric] || 0) >= dq.q.min;
          if (!ok) { state.ledger.push({ t: cursor, msg: "Quest failed the seal: " + dq.q.name }); return; }
          state.banked += dq.q.souls; state.lifetime += dq.q.souls; state.questsClaimed++;
          state.ledger.push({ t: cursor, msg: "QUEST: " + dq.q.name + " (+" + dq.q.souls + ")" });
          var drop = rollDrop("drop:" + dq.q.id + ":" + cursor, RULES.rarityWeights, false);
          if (drop) grantItem(drop, cursor, "QUEST LOOT");
        });
        if (Number(row.instant_grat_minutes || 0) === 0) counters.zeroFeedDays++;
        counters.pagesTotal += Number(row.pages_read || 0);
        if (/^([1-9]\d*)\/\1$/.test(String(row.goals_kept || ""))) counters.vowDays++;
        state.streak++; state.bestStreak = Math.max(state.bestStreak, state.streak);
        healCounter++;
        if (healCounter >= RULES.healEveryStreak && state.hollowing > 0) {
          state.hollowing--; healCounter = 0;
          if (state.hollowing === 0 && counters.maxHollow >= 3) counters.healedFromDeep = true;
          state.ledger.push({ t: cursor, msg: "Humanity restored: hollowing " + state.hollowing });
        }
        checkDeeds(cursor, row);
      } else if (cursor < today) {
        if (state.inventory.embers > 0) {
          state.inventory.embers--;
          state.ledger.push({ t: cursor, msg: "An Ember kept the flame alive (" + cursor + ")" });
        } else {
          state.deaths++;
          if (pendingStain) {
            state.banked = Math.max(0, state.banked - pendingStain.amount);
            state.hollowing = Math.min(RULES.hollowMax, state.hollowing + 1);
            counters.maxHollow = Math.max(counters.maxHollow, state.hollowing);
            state.ledger.push({ t: cursor, msg: "Bloodstain lost: -" + pendingStain.amount + ", hollowing " + state.hollowing });
          }
          var stake = Math.max(RULES.deathStakeMin, Math.round(state.banked * RULES.deathStakePct));
          pendingStain = { date: cursor, amount: Math.min(stake, state.banked) };
          state.streak = 0; healCounter = 0;
          state.ledger.push({ t: cursor, msg: "YOU DIED. Bloodstain holds " + pendingStain.amount + " souls" });
        }
        checkDeeds(cursor, null);
      }
      if (cursor === today) break;
      cursor = addDays(cursor, 1);
    }
    applyEventsUpTo(now);
    checkDeeds(today, byDate[today]);

    if (pendingStain) {
      var deadline = new Date(addDays(pendingStain.date, 1) + "T" + (RULES.corpseRunDeadlineHour < 10 ? "0" : "") + RULES.corpseRunDeadlineHour + ":00:00");
      state.bloodstain = { date: pendingStain.date, amount: pendingStain.amount, deadline: deadline.toISOString(), expired: now > deadline };
    }

    if (curBoss.week !== mondayOf(today)) { settleBoss(curBoss, true); curBoss = spawnBoss(mondayOf(today)); }
    var sunday = addDays(curBoss.week, 6);
    state.boss = {
      metric: curBoss.metric, name: curBoss.name, hp: curBoss.hp, dmg: Math.round(curBoss.dmg * 10) / 10,
      inverse: curBoss.inverse, slain: curBoss.slain,
      daysLeft: Math.max(0, Math.round((new Date(sunday + "T23:59:59") - now) / 86400000)),
      week: curBoss.week, reward: RULES.bossReward, history: bossHistory.slice(-6)
    };

    /* today's tavern board with live statuses */
    var qToday = questsResolved(today);
    var claimedIds = qToday.done.map(function (d) { return d.q.id; });
    state.activeQuest = null;
    if (qToday.current && !qToday.current.claimed) {
      var cq = qToday.current;
      var end = new Date(cq.start.getTime() + cq.q.dur * 60000);
      state.activeQuest = { id: cq.q.id, name: cq.q.name, souls: cq.q.souls, endTs: end.toISOString(), ready: now >= end };
    }
    state.board = boardFor(today).map(function (q) {
      var status = claimedIds.indexOf(q.id) >= 0 ? "claimed"
        : (state.activeQuest && state.activeQuest.id === q.id) ? (state.activeQuest.ready ? "claimable" : "active")
        : (state.activeQuest ? "locked" : "available");
      return { id: q.id, name: q.name, dur: q.dur, souls: q.souls, verify: q.verify, status: status };
    });

    var lvl = STATS.reduce(function (s, k) { return s + state.stats[k]; }, 0);
    state.level = lvl; state.title = title(lvl);
    state.epithet = state.equipped.TITLE || (state.unlocks.epithets.length ? state.unlocks.epithets[state.unlocks.epithets.length - 1] : null);
    state.buff = Math.min(RULES.streakBuffCap, state.streak * RULES.streakBuffPer);
    state.nextCost = {}; STATS.forEach(function (k) { state.nextCost[k] = RULES.statCost(state.stats[k] + 1); });
    state.ledger = state.ledger.slice(-14);
    return state;
  }

  var API = { RULES: RULES, SHOP: SHOP, ITEMS: ITEMS, SLOTS: SLOTS, DEEDS: DEEDS, QUESTS: QUESTS,
    computeState: computeState, soulsForRow: soulsForRow, isSealed: isSealed, title: title,
    STATS: STATS, questsForDay: questsForDay, mondayOf: mondayOf, boardFor: boardFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.HollowKing = API;
})(typeof window !== "undefined" ? window : globalThis);
