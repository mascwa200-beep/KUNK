/* live.js -- the thing that makes VerityNet feel alive.
 *
 * A static site is obviously dead: every timestamp says 2007, every counter
 * reads the same number forever, and the feed you left is the feed you come
 * back to. This file fixes that without a server, without storage and without
 * a network, which is the only way it can work here.
 *
 * The trick is that nothing is stored and nothing is random. Everything is a
 * pure function of the wall clock:
 *
 *   slot        = floor(minutes since EPOCH / interval)
 *   which item  = pool[ hash(domain, slot) % pool.length ]
 *   posted at   = EPOCH + slot * interval
 *
 * So a post "arrives" every few minutes, drawn deterministically from a pool
 * that cycles in a different order each pass. Open the app twice in one minute
 * and it is identical; open it an hour later and the feed has moved on; leave
 * it a week and it is unrecognisable. Nothing is written to disk, so there is
 * nothing to corrupt and nothing to sync.
 *
 * The other half of the illusion is what fills those slots, which lives in
 * live_content.js: bots, engagement farms, bought posts and ad inventory.
 * VerityNet is not a nice internet. It is a mostly-automated one with a few
 * humans still posting into it, which is the joke and also roughly the point.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  /* The clock's zero point. Everything live is measured from here, so the
   * content can talk in "minutes after epoch" and never go stale. */
  var EPOCH = Date.UTC(2026, 8, 19, 0, 0, 0);
  var MINUTE = 60000;
  var HOUR = 3600000;
  var DAY = 86400000;

  /* Overridable so tests and screenshots can pin the clock. */
  var fixedNow = null;

  function now() {
    return fixedNow === null ? Date.now() : fixedNow;
  }

  function setNow(ms) { fixedNow = ms; }

  function minutesSinceEpoch() {
    return Math.floor((now() - EPOCH) / MINUTE);
  }

  /* --- deterministic randomness ----------------------------------------
   * Math.random would make the page different on every repaint, which reads
   * as broken rather than alive. Everything here is a hash of inputs, so the
   * same minute always renders the same page. */

  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* mulberry32: small, fast, good enough to look unpatterned. */
  function rng(seed) {
    var a = typeof seed === 'string' ? hash32(seed) : (seed >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(arr, seed) {
    if (!arr || !arr.length) return null;
    return arr[hash32(String(seed)) % arr.length];
  }

  /* Pick n distinct items, stable for a given seed. */
  function sample(arr, n, seed) {
    if (!arr || !arr.length) return [];
    var idx = [];
    for (var i = 0; i < arr.length; i++) idx.push(i);
    var r = rng(seed);
    for (var j = idx.length - 1; j > 0; j--) {
      var k = Math.floor(r() * (j + 1));
      var tmp = idx[j]; idx[j] = idx[k]; idx[k] = tmp;
    }
    var out = [];
    for (var m = 0; m < Math.min(n, idx.length); m++) out.push(arr[idx[m]]);
    return out;
  }

  /* --- relative time ---------------------------------------------------- */

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  /* "just now" / "6 min ago" / "3 hours ago" / "Tue 14:02" / "12 Mar" */
  function ago(ms) {
    var d = now() - ms;
    if (d < 0) d = 0;
    if (d < 45000) return 'just now';
    if (d < 90000) return 'a minute ago';
    if (d < HOUR) return Math.round(d / MINUTE) + ' min ago';
    if (d < 2 * HOUR) return 'an hour ago';
    if (d < DAY) return Math.round(d / HOUR) + ' hours ago';
    if (d < 2 * DAY) return 'yesterday';
    if (d < 7 * DAY) return Math.round(d / DAY) + ' days ago';
    var t = new Date(ms);
    return t.getDate() + ' ' + MONTHS[t.getMonth()];
  }

  /* An absolute clock time, for the chrome and for sites that showed one. */
  function clock(ms) {
    var t = new Date(ms);
    return pad(t.getHours()) + ':' + pad(t.getMinutes());
  }

  function longDate(ms) {
    var t = new Date(ms);
    return MONTHS[t.getMonth()] + ' ' + t.getDate() + ', ' + t.getFullYear() +
           ' ' + clock(ms);
  }

  /* --- the slot machine -------------------------------------------------
   * The core of the whole illusion. Returns the most recent `count` arrivals
   * for a stream, newest first, each with the moment it "posted". */

  /* Resolve a pool argument. Renderers may pass the array itself, or -- and
   * this is the point -- the *name* of a pool, in which case the built-in
   * entries are concatenated with whatever imported content packs contribute
   * under the same name.
   *
   * SYNTH.packs.slopFor() has existed since packs shipped and was called by
   * nothing, so a pack could ship fifty extra feed posts and none of them
   * would ever appear anywhere. Resolving here means every renderer picks
   * that up without any of them changing, which beats teaching seventeen
   * renderers about packs individually. */
  function resolvePool(pool) {
    if (Array.isArray(pool)) return pool;
    if (typeof pool !== 'string') return [];
    var base = (SYNTH.slop && SYNTH.slop[pool]) || [];
    var extra = [];
    try {
      if (SYNTH.packs && typeof SYNTH.packs.slopFor === 'function') {
        extra = SYNTH.packs.slopFor(pool) || [];
      }
    } catch (e) { /* packs not ready, or storage unavailable */ }
    return extra.length ? base.concat(extra) : base;
  }

  /* --- rhythm -----------------------------------------------------------
   *
   * A network that posts at exactly the same rate at 4am on a Tuesday as at
   * 9pm on a Saturday is not a network, it is a metronome. This is the one
   * cheapest thing that makes a place feel inhabited rather than merely
   * populated: the same feed, read at different hours, should feel busy or
   * abandoned.
   *
   * It is expressed as slots being skipped rather than as fewer items being
   * returned, so a quiet hour never produces an empty page -- it produces a
   * page whose last ten posts span six hours instead of forty minutes.
   * Which is what a dead forum at 4am actually looks like.
   */

  /* Reach by hour, local time. Mirrors the curve in fame.js, which models
   * the same thing from the other end (how far YOUR post travels). */
  var HOUR_WEIGHT = [
    0.34, 0.28, 0.22, 0.20, 0.22, 0.30,
    0.48, 0.66, 0.82, 0.88, 0.86, 0.90,
    1.00, 0.92, 0.84, 0.84, 0.92, 1.04,
    1.18, 1.30, 1.34, 1.22, 0.92, 0.58
  ];

  /* Sunday..Saturday. Weekends run later and louder; Monday is nobody's
   * best day; Friday evening starts early. */
  var DAY_WEIGHT = [1.06, 0.92, 0.97, 0.99, 1.00, 1.08, 1.12];

  /* Never below this, or a page drawn at 4am looks broken rather than
   * quiet -- and CI, which runs at whatever hour it runs, would flake. */
  var QUIET_FLOOR = 0.34;

  function busyness(ms) {
    var d = new Date(ms === undefined ? now() : ms);
    var hourOfDay = d.getHours() + d.getMinutes() / 60;
    var lo = HOUR_WEIGHT[Math.floor(hourOfDay) % 24];
    var hi = HOUR_WEIGHT[(Math.floor(hourOfDay) + 1) % 24];
    var frac = hourOfDay - Math.floor(hourOfDay);
    var hour = lo + (hi - lo) * frac;      /* smooth, not stepped on the hour */
    var w = hour * DAY_WEIGHT[d.getDay()];
    return w < QUIET_FLOOR ? QUIET_FLOOR : (w > 1 ? 1 : w);
  }

  /* Did anything actually get posted in this slot? Deterministic per
   * (key, slot), so the same slot is always either live or not -- a slot
   * that flickered would make posts appear and disappear on a refresh. */
  function slotLive(key, slot, intervalMin) {
    var at = EPOCH + slot * intervalMin * MINUTE;
    return rng(key + ':live:' + slot)() < busyness(at);
  }

  /* --- the arrivals ledger ---------------------------------------------
   *
   * Every live feed on the network goes through stream(), which makes it the
   * one place that knows what a page is watching and which slot it was
   * watching when it drew. Recording that costs nothing and lets the
   * heartbeat say exactly how many things have arrived since -- "4 new
   * posts", counted, not estimated -- without a single renderer having to
   * opt in or report anything.
   *
   * The engine clears this immediately before each render, so the ledger
   * always describes the page currently on screen. */
  var ledger = {};

  function resetLedger() { ledger = {}; }

  /* [{key, interval, slot}] as of the last render. */
  function ledgerRows() {
    var out = [], k;
    for (k in ledger) {
      if (Object.prototype.hasOwnProperty.call(ledger, k)) out.push(ledger[k]);
    }
    return out;
  }

  /* How many slots have ticked over on the watched streams since the page
   * drew. This is the number behind the "N new posts" pill. */
  function arrivals() {
    var rows = ledgerRows(), total = 0, i, s;
    for (i = 0; i < rows.length; i++) {
      var nowSlot = Math.floor(minutesSinceEpoch() / rows[i].interval);
      /* Count only the slots that were actually busy enough to post in, or
       * the pill would promise four new posts at 4am and deliver one. Capped
       * because a tab left open for a month should say "lots", not spend a
       * second counting to 40,000. */
      var from = Math.max(rows[i].slot + 1, nowSlot - 400);
      for (s = from; s <= nowSlot; s++) {
        if (slotLive(rows[i].key, s, rows[i].interval)) total++;
      }
    }
    return total;
  }

  function stream(key, poolOrName, intervalMin, count) {
    var pool = resolvePool(poolOrName);
    if (!pool.length) return [];
    var current = Math.floor(minutesSinceEpoch() / intervalMin);
    /* Keyed by stream key so a renderer calling the same stream twice (an
     * index and a sidebar, say) does not count its arrivals twice. */
    ledger[key] = { key: key, interval: intervalMin, slot: current };

    /* Walk back through slots, keeping only the ones that were busy enough
     * to have produced a post (see slotLive). Scanning further than `count`
     * means a quiet night still fills the page -- it just reaches further
     * back to do it, so the timestamps spread out instead of the feed
     * emptying. The cap stops a pathologically quiet stretch walking back
     * through years of slots looking for ten posts. */
    var out = [];
    var scanned = 0;
    var limit = count * 8;
    var slot = current;
    while (out.length < count && slot >= 0 && scanned < limit) {
      if (slotLive(key, slot, intervalMin)) {
        var h = hash32(key + ':' + slot);
        out.push({
          slot: slot,
          at: EPOCH + slot * intervalMin * MINUTE,
          item: pool[h % pool.length],
          seed: h
        });
      }
      slot--;
      scanned++;
    }
    return out;
  }

  /* --- pointing at somewhere that exists --------------------------------
   *
   * Several places build a synth:// link in code rather than in content:
   * fame.js ("the Ledger has written about you"), bots.js ("read the full
   * aggregation at..."), and anything else that wants to reference a kind of
   * site without caring which one.
   *
   * They used to hardcode domain strings, and three of the domains in
   * fame.js had never existed in the registry, so the entire fame feature
   * emitted dead links at every milestone. validate.py could not see it
   * because it checks the links inside site JSON, not the ones JavaScript
   * builds at run time.
   *
   * So: resolve a *role* against the registry when the link is built. If the
   * net has no site that can play the role, the link is omitted rather than
   * emitted broken. Renaming or deleting a site can no longer strand a
   * caller. .github/scripts/synthnet_link_check.py holds the line.
   */

  var ROLE_PREFER = {
    feed:   ['gridline.social'],
    news:   ['now.verityledger.com', 'verityledger.com'],
    wiki:   ['wiki.gridfall.net'],
    video:  ['now.clipvault.tv', 'clipvault.tv'],
    forum:  ['boards.gridfall.net'],
    farm:   [],
    oldweb: ['stargazers.verity.net', 'tnorris.verity.net']
  };

  /* Which site types can stand in for each role, best first. */
  var ROLE_TYPES = {
    feed:   ['social', 'aggregator', 'board'],
    news:   ['news', 'wire', 'blog'],
    wiki:   ['wiki'],
    video:  ['stream', 'media'],
    forum:  ['forum', 'board', 'qa', 'aggregator'],
    farm:   ['aggregator', 'news', 'blog'],
    oldweb: ['page']
  };

  /* The one path shape each type routes. Must agree with PATH_PREFIXES in
   * tools/validate.py -- a path no renderer serves is a link that 404s. */
  var ROLE_PATH = {
    forum: '/topic/', board: '/t/', social: '/post/', aggregator: '/item/',
    news: '/article/', wire: '/d/', blog: '/post/', wiki: '/wiki/',
    media: '/watch/', stream: '/w/', qa: '/q/', page: '/'
  };

  function registryRows() {
    try {
      if (SYNTH.data && typeof SYNTH.data.list === 'function') {
        return SYNTH.data.list() || [];
      }
    } catch (e) { /* registry not loaded yet */ }
    return [];
  }

  /* The registry row that best plays `role`, or null. Prefers a 2026 site
   * over an archive, except for the `oldweb` role where the whole point is
   * that the page is ancient and still up. */
  function siteFor(role) {
    var rows = registryRows();
    if (!rows.length) return null;

    var byDomain = {}, i;
    for (i = 0; i < rows.length; i++) {
      byDomain[String(rows[i].domain).toLowerCase()] = rows[i];
    }

    var prefer = ROLE_PREFER[role] || [];
    for (i = 0; i < prefer.length; i++) {
      if (byDomain[prefer[i]]) return byDomain[prefer[i]];
    }

    var types = ROLE_TYPES[role] || [];
    var wantOld = role === 'oldweb';
    var best = null;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rank = types.indexOf(r.type);
      if (rank === -1) continue;
      var modern = String(r.era || '').indexOf('2026') !== -1;
      var score = rank * 2 + ((modern !== wantOld) ? 0 : 1);
      if (!best || score < best.score) best = { row: r, score: score };
    }
    return best ? best.row : null;
  }

  function domainFor(role) {
    var row = siteFor(role);
    return row ? row.domain : null;
  }

  /* A complete markup link, or '' when nothing can serve the role. Callers
   * concatenate the result, so '' disappears cleanly. Pass slug === null for
   * a link to the site's front page. */
  function linkTo(role, slug, label) {
    var row = siteFor(role);
    if (!row) return '';
    if (slug === null || slug === undefined) {
      return '[url=synth://' + row.domain + '/]' + label + '[/url]';
    }
    var prefix = ROLE_PATH[row.type];
    if (!prefix) return '';
    if (prefix === '/') {
      /* `page` sites address pages as /<pageId>, and we do not know theirs. */
      return '[url=synth://' + row.domain + '/]' + label + '[/url]';
    }
    return '[url=synth://' + row.domain + prefix + encodeURIComponent(slug) +
           ']' + label + '[/url]';
  }

  /* --- counters that move ----------------------------------------------
   * A view count that never changes is the tell that a page is a screenshot.
   * These grow with real elapsed time and wobble enough not to look linear. */

  function counter(key, base, perDay) {
    var days = (now() - EPOCH) / DAY;
    var r = rng(key);
    var drift = 0.85 + r() * 0.3;
    return Math.max(0, Math.floor(base + days * perDay * drift));
  }

  /* "N users online": a daily sine so it is busy in the evening and dead at
   * 4am, plus a slow wander so two refreshes never read quite the same. */
  function online(key, low, high) {
    var t = now();
    var d = new Date(t);
    var hourOfDay = d.getHours() + d.getMinutes() / 60;
    var daily = Math.sin((hourOfDay - 4) / 24 * Math.PI * 2);
    var span = high - low;
    var base = low + span * (0.45 + 0.4 * daily);
    var wobble = rng(key + ':' + Math.floor(t / (5 * MINUTE)))();
    return Math.max(1, Math.round(base + (wobble - 0.5) * span * 0.18));
  }

  /* Formats 12345 as "12.3k", the way every counter on the real web does. */
  function short(n) {
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k';
    return (n / 1000000).toFixed(1) + 'M';
  }

  function commas(n) {
    return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  SYNTH.live = {
    EPOCH: EPOCH,
    now: now,
    setNow: setNow,
    minutesSinceEpoch: minutesSinceEpoch,
    hash32: hash32,
    rng: rng,
    pick: pick,
    sample: sample,
    ago: ago,
    clock: clock,
    longDate: longDate,
    stream: stream,
    pool: resolvePool,
    resetLedger: resetLedger,
    ledgerRows: ledgerRows,
    arrivals: arrivals,
    busyness: busyness,
    slotLive: slotLive,
    siteFor: siteFor,
    domainFor: domainFor,
    linkTo: linkTo,
    counter: counter,
    online: online,
    short: short,
    commas: commas
  };
})();
