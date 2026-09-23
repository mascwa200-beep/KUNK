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

  /* FNV-1a, with Math.imul.
   *
   * The obvious spelling of this step is `h = (h * 16777619) >>> 0`, and it
   * is WRONG in a way that took eighteen months to notice, because the
   * output still looks like noise.
   *
   * JavaScript numbers are IEEE754 doubles. With h up to 2^32 the product
   * reaches 2^55, past the 53 bits a double carries, so it is rounded -- and
   * what rounding throws away is the BOTTOM bits. The result is a hash whose
   * low bits are almost constant: bucketing 40,000 values by `& 7` gave
   * 21,768 in one bucket and 4 in another.
   *
   * Every draw on this network is `hash32(x) % pool.length`, so every pool
   * was being sampled through that. Seven of the twenty-eight canon nouns in
   * grammar.js were chosen essentially never and seven were chosen three
   * times too often; the same was true of every slop pool, every ad slot and
   * every bot archetype. The network has always had a fraction of the
   * variety it appeared to have, and the feeds repeating was the symptom.
   *
   * Math.imul is an exact 32-bit multiply. The same 40,000 values now land
   * within 0.2% of even across all eight buckets.
   *
   * Changing this changes every seed, so all derived content shifts. That is
   * fine -- none of it is stored -- but android/.../SlotMath.java must move
   * with it or the widget and the app disagree. There is a check for that. */
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
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

  /* Times from the live clock are epoch ms. Times on disk are strings, and
   * the content writes them FOUR different ways, because four different kinds
   * of page show them four different ways:
   *
   *   2019-04-11T10:22:00      a question or a wire dispatch
   *   September 18, 2026       a newspaper's edition date
   *   Sep 20, 2026 7:58 AM     a post in a feed
   *   04 Mar 2017              a forum member's join date
   *
   * All four live here so callers stop each keeping a half-right parser of
   * their own. That is not hypothetical: passing a string used to fail
   * silently and completely -- `now() - "2019-.."` is NaN, so every
   * comparison in ago() was false and it fell through to the absolute date
   * at the bottom, which does parse strings. A question asked in 2019
   * rendered as "11 Apr", no year, on a page being read in 2026. Nothing
   * threw. It looked like a date.
   *
   * The fourth shape is the forum join date, and half of those carry no day
   * at all ("Mar 2017", 233 of them against 201 with a day). Those parse to
   * the first of the month, and callers that need a real day -- a join
   * anniversary, say -- have to check `toMsHasDay` rather than assume.
   *
   * Parsed by parts, never Date.parse: a bare date-time reads as UTC under
   * ES5 and as local under ES2016, which would move every authored timestamp
   * by hours depending on the engine. */
  var AT_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
  var AT_WORD =
    /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})\s*([AaPp])?)?/;
  /* "04 Mar 2017" and "Mar 2017". The day is optional and its absence is
   * information, so it is reported rather than defaulted away. */
  var AT_DMY = /^(?:(\d{1,2})\s+)?([A-Za-z]{3,9})\.?\s+(\d{4})\s*$/;

  function monthIndex(name) {
    var n = String(name || '').slice(0, 3).toLowerCase(), i;
    for (i = 0; i < MONTHS.length; i++) {
      if (MONTHS[i].toLowerCase() === n) { return i; }
    }
    return -1;
  }

  function toMs(v) {
    if (typeof v === 'number') { return isFinite(v) ? v : null; }
    if (v instanceof Date) { return isFinite(v.getTime()) ? v.getTime() : null; }
    var s = String(v === null || v === undefined ? '' : v);

    var m = AT_ISO.exec(s);
    if (m) {
      var t = new Date(
        parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
        m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0,
        m[6] ? parseInt(m[6], 10) : 0
      ).getTime();
      return isFinite(t) ? t : null;
    }

    m = AT_WORD.exec(s);
    if (m) {
      var mi = monthIndex(m[1]);
      if (mi < 0) { return null; }
      var hr = m[4] ? parseInt(m[4], 10) : 0;
      var ap = m[6] ? m[6].toLowerCase() : '';
      /* 12 AM is 0 and 12 PM is 12, which is the one case a naive +12 gets
       * backwards at both ends of the day. */
      if (ap === 'p' && hr < 12) { hr += 12; }
      if (ap === 'a' && hr === 12) { hr = 0; }
      var w = new Date(
        parseInt(m[3], 10), mi, parseInt(m[2], 10),
        hr, m[5] ? parseInt(m[5], 10) : 0, 0
      ).getTime();
      return isFinite(w) ? w : null;
    }

    m = AT_DMY.exec(s);
    if (m) {
      var di = monthIndex(m[2]);
      if (di < 0) { return null; }
      var d = new Date(
        parseInt(m[3], 10), di, m[1] ? parseInt(m[1], 10) : 1
      ).getTime();
      return isFinite(d) ? d : null;
    }
    return null;
  }

  /* Whether a date string actually named a day, as opposed to parsing to the
   * first of the month because that is all there was. A join anniversary is
   * meaningless without this, and "Mar 2017" would otherwise silently become
   * the 1st of March and celebrate itself. */
  function hasDay(v) {
    if (typeof v === 'number' || v instanceof Date) { return true; }
    var s = String(v === null || v === undefined ? '' : v);
    if (AT_ISO.test(s) || AT_WORD.test(s)) { return true; }
    var m = AT_DMY.exec(s);
    return !!(m && m[1]);
  }

  /* "just now" / "6 min ago" / "3 hours ago" / "12 Mar" / "11 Apr 2019" */
  function ago(at) {
    var ms = toMs(at);
    if (ms === null) { return ''; }
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
    /* Half the network is an archive. "11 Apr" on a page being read in 2026
     * says this year, and it means 2019. */
    if (t.getFullYear() !== new Date(now()).getFullYear()) {
      return t.getDate() + ' ' + MONTHS[t.getMonth()] + ' ' + t.getFullYear();
    }
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
  /* How much of a feed is composed rather than hand-written. At 0.72 roughly
   * seven posts in ten come out of the grammar, which is what stops a pool of
   * eighty wrapping visibly inside ten minutes -- while the hand-written ones
   * stay frequent enough to carry the texture the grammar cannot. */
  var GRAMMAR_SHARE = 0.72;

  /* An array of POOL NAMES, rather than an array of items.
   *
   * This distinction is the whole reason twelve renderers were drawing from
   * hand-written entries only. A site that wants two pools -- a board shows
   * forum topics and social posts together -- concatenated them itself and
   * passed the result, and a plain array is not a pool name, so virtual()
   * declined to compose and the grammar never ran. The board had 149 items
   * forever where it could have had 246 and climbing.
   *
   * So a list of strings is now a first-class pool. */
  function isNameList(v) {
    return Array.isArray(v) && v.length > 0 && typeof v[0] === 'string';
  }

  function resolvePool(pool) {
    if (isNameList(pool)) {
      var joined = [], n;
      for (n = 0; n < pool.length; n++) {
        joined = joined.concat(resolvePool(pool[n]));
      }
      return joined;
    }
    if (Array.isArray(pool)) return pool;
    if (pool && pool.isVirtual) return pool;
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

  /* --- virtual pools -----------------------------------------------------
   *
   * 550 hand-written entries across every pool is the whole variety budget of
   * this network. Sit on one site for ten minutes and it wraps, which is the
   * tell that finishes the illusion off.
   *
   * Writing 55,000 entries instead is 32 MB and nobody would write them. So
   * most of a feed is COMPOSED: template x canon entity x tone x detail, the
   * same technique bots.js already uses to answer your own posts.
   *
   * A virtual pool reports a length but holds only the written items. Indices
   * past those are composed on demand from the seed of the slot that asked,
   * so each one is drawn from the grammar's whole space rather than from a
   * precomputed list. Nothing is generated until something asks and nothing
   * is stored.
   *
   * Deliberately NOT returned by resolvePool(): several renderers read a pool
   * directly with pool[i] and pool.filter(), and handing those an object with
   * a length of 300 and 80 real entries would be a quiet source of undefined.
   * Only stream() -- which goes through at() -- ever sees one. */
  function virtual(written, poolName) {
    if (!written || !written.length) return written || [];
    if (written.isVirtual) return written;
    if (!SYNTH.grammar || typeof SYNTH.grammar.makes !== 'function') return written;

    /* poolName may be a list, for a site that streams two pools at once.
     * Keep only the names the grammar can actually compose; if none of them
     * can be, there is nothing to add and the written array stands. */
    var names = isNameList(poolName) ? poolName : [poolName];
    var makeable = [], mi;
    for (mi = 0; mi < names.length; mi++) {
      if (SYNTH.grammar.makes(names[mi])) { makeable.push(names[mi]); }
    }
    if (!makeable.length) return written;

    return {
      /* An explicit flag rather than duck-typing on .at(). Both arrays and
       * strings have had a .at() method since ES2022, so a check for one
       * matches every plain array AND every pool name -- which returned the
       * string "socialPosts" as an eleven-item pool and served its
       * characters as posts. It also silently disabled the grammar
       * everywhere, because Array.prototype.at(i) ignores the second
       * argument and cheerfully returns the element. */
      isVirtual: true,
      length: Math.round(written.length / (1 - GRAMMAR_SHARE)),
      written: written.length,
      at: function (index, seed) {
        if (index < written.length) return written[index];
        /* Which kind of thing to compose, when the site streams more than
         * one. Hashed off the seed so it is stable for a slot, rather than
         * alternating, which would read as a pattern. */
        var name = makeable.length === 1
          ? makeable[0]
          : makeable[hash32('mk:' + seed) % makeable.length];
        var made = null;
        try { made = SYNTH.grammar.make(name, seed); } catch (e) { made = null; }
        return made || written[index % written.length];
      }
    };
  }

  /* What makes two composed items "the same" to a reader. Not identity --
   * two posts that open with the same eight words read as a repeat even when
   * the nouns differ, and that is the thing people actually notice. */
  function signature(item) {
    if (!item) return '';
    if (typeof item === 'string') return item.slice(0, 48);
    /* A composed item carries the id of the template it came out of, which
     * is the only reliable comparison: "Got a letter about Substation No. 3"
     * and "Got a letter about the Bracken Lane school" differ well past any
     * prefix you would compare and are obviously the same post. */
    if (item.tplId) return 't' + item.tplId;
    var text = item.body || item.title || item.headline || item.lead || '';
    return String(text).replace(/\s+/g, ' ').slice(0, 48);
  }

  /* One row of a stream.
   *
   * The contract has always been {slot, at, item, seed}, and reading a field
   * off the row instead of off `.item` is far and away the most repeated
   * mistake on this project -- it is bug #2 in docs/AUTHORING.md and it was
   * still live in three shipped renderers: the dash drew blank headlines and
   * blank ticker lines, every streamed shop review rendered as "Anonymous"
   * with an empty body, and the stream site's "Just uploaded" list was six
   * identical "Untitled upload" rows. None of them failed. They just quietly
   * rendered nothing, which is exactly the shape of bug this project keeps
   * producing.
   *
   * So the row now carries the item's own fields as well. row.body and
   * row.item.body are both the body; neither spelling is wrong any more.
   *
   * The four wrapper keys win on a collision, because they are the contract.
   * Only one pool entry anywhere defines one of them (an ad's `slot`, which
   * means the ad shape rather than a time slot), and ads are drawn directly
   * rather than streamed, so nothing is shadowed today. A future pool that
   * needs a field called `at` or `seed` should read it off `.item`. */
  function row(slot, at, item, seed) {
    var out = {};
    if (item && typeof item === 'object') {
      for (var k in item) {
        if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
      }
    }
    out.slot = slot;
    out.at = at;
    out.item = item;
    out.seed = seed;
    return out;
  }

  /* A one-line title for a pooled item, for the many places a renderer wants
   * a headline rather than a body.
   *
   * Hand-rolled versions of this kept reaching for `body` first, which is
   * right for a post and wrong for a headline -- and pooled news items have
   * a `headline`, not a `title`, so the usual `it.title || it.text ||
   * it.body` chain fell straight through to the body. The aggregator, the Q&A
   * site and the dash were each putting a whole multi-paragraph article where
   * one line goes, with its markup printed raw because a title is inserted as
   * text rather than parsed.
   *
   * Strips markup and truncates, because a title should be neither. */
  function titleOf(item, fallback) {
    var raw = '';
    if (typeof item === 'string') {
      raw = item;
    } else if (item && typeof item === 'object') {
      raw = item.title || item.headline || item.subject || item.name ||
            item.text || item.body || '';
    }
    if (!raw) return fallback || '';
    if (SYNTH.markup && typeof SYNTH.markup.strip === 'function') {
      try { raw = String(SYNTH.markup.strip(raw)); } catch (e) { /* as-is */ }
    }
    raw = String(raw).replace(/\s+/g, ' ').trim();
    if (raw.length > 96) raw = raw.slice(0, 95) + '…';
    return raw || fallback || '';
  }

  function poolItem(pool, index, seed) {
    return (pool && pool.isVirtual)
      ? pool.at(index, seed)
      : pool[index];
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
   * the same thing from the other end (how far YOUR post travels), and
   * SlotMath.java, which computes it for the widget. */
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
    /* A name gets the grammar folded in; a pre-filtered array does not,
     * unless the caller wrapped it with live.virtual() itself. */
    var pool = (typeof poolOrName === 'string' || isNameList(poolOrName))
      ? virtual(resolvePool(poolOrName), poolOrName)
      : resolvePool(poolOrName);
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
    var seen = {};
    while (out.length < count && slot >= 0 && scanned < limit) {
      if (slotLive(key, slot, intervalMin)) {
        var h = hash32(key + ':' + slot);
        /* poolItem, not pool[...]: a pool may be virtual, with most of its
         * length composed on demand from this slot's seed rather than
         * sitting in memory. See virtual(). */
        var item = poolItem(pool, h % pool.length, h);

        /* Two posts on one screen that open with the same eight words is the
         * single thing that gives a composed feed away, and with a dozen
         * templates and ten posts the birthday problem makes it common. So
         * re-roll a repeat rather than write another hundred templates.
         *
         * This used to re-roll only for composed pools, on the reasoning that
         * a WRITTEN pool repeating means it has genuinely wrapped, and an
         * honest wrap should show. The reasoning is right and the test for it
         * was wrong: it confused "this draw collided" with "the pool is
         * exhausted". A forum front page drawing 8 rows from 38 written
         * topics is nowhere near wrapping, and it was showing three duplicate
         * pairs out of eight rows -- 5 distinct titles, stacked adjacently,
         * which reads as the machine and not as a board.
         *
         * So the test is now whether the pool has anything else to offer.
         * Below `count` items it genuinely has wrapped, nothing is re-rolled,
         * and the repetition is the truth. */
        var tries = 0;
        while (tries < 4 && (pool.isVirtual || pool.length > count) &&
               Object.prototype.hasOwnProperty.call(seen, signature(item))) {
          tries++;
          var rh = hash32(key + ':' + slot + '/r' + tries);
          item = poolItem(pool, rh % pool.length, rh);
        }
        seen[signature(item)] = 1;

        out.push(row(slot, EPOCH + slot * intervalMin * MINUTE, item, h));
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
    oldweb: ['stargazers.verity.net', 'tnorris.verity.net'],
    wire:   ['veritywire.press'],
    social: ['shoutbox.live'],
    ask:    ['ask.verity.ai'],
    letter: ['thequarry.news']
  };

  /* Which site types can stand in for each role, best first. */
  var ROLE_TYPES = {
    feed:   ['social', 'aggregator', 'board'],
    news:   ['news', 'wire', 'blog'],
    wiki:   ['wiki'],
    video:  ['stream', 'media'],
    forum:  ['forum', 'board', 'qa', 'aggregator'],
    farm:   ['aggregator', 'news', 'blog'],
    oldweb: ['page'],
    /* Added for the story chain. ADDED, not changed: linkTo() and
     * .github/scripts/synthnet_link_check.py both read the seven above, and
     * editing one of them moves links that already resolve. */
    wire:   ['wire', 'news'],
    social: ['social', 'chat', 'board'],
    ask:    ['assistant', 'qa'],
    letter: ['newsletter', 'blog']
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

  /* --- thread half-life ---------------------------------------------------
   *
   * counter() grows for ever, which is right for a view count and wrong for
   * a conversation. Threads do not accrue replies at a steady rate until the
   * heat death of the universe: they burn through most of their replies in
   * the first day or so, then stop, and a small minority run for years.
   *
   * So a thread gets two draws at birth, both pure functions of its id: how
   * many replies it will EVER get, and how fast it gets there. The count at
   * any moment is the exponential approach to that ceiling:
   *
   *   total(age) = authored + peak * (1 - 2^(-age / halfLife))
   *
   * which is monotonic, never exceeds `authored + peak`, and is computable
   * in constant time from (id, now) -- no walking the history, nothing
   * stored. The heavy tail is what puts a handful of threads past a board's
   * bump limit while most sink at nine replies, and it is the reason a bump
   * limit is a rule rather than a decoration. */
  function threadLife(key, authored, startMs) {
    var base = (typeof authored === 'number' && isFinite(authored)) ? authored : 0;
    var start = toMs(startMs);
    if (start === null) { return { total: base, peak: 0, halfLifeH: 0, hot: false }; }

    var r = rng('life:' + key);
    var roll = r();
    /* Most threads are small. About one in twenty-five is the thread people
     * are still linking to in two years. */
    var peak = roll > 0.96 ? Math.floor(240 + r() * 900)
             : roll > 0.80 ? Math.floor(28 + r() * 90)
             : Math.floor(2 + r() * 22);
    var halfLifeH = roll > 0.96 ? (90 + r() * 400) : (5 + r() * 30);

    var ageH = (now() - start) / HOUR;
    if (ageH < 0) { ageH = 0; }
    var grown = peak * (1 - Math.pow(2, -ageH / halfLifeH));
    return {
      total: base + Math.floor(grown),
      peak: base + peak,
      halfLifeH: halfLifeH,
      /* Still moving: it has not yet reached nine tenths of what it will be. */
      hot: grown < peak * 0.9
    };
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


  /* ======================================================================
   * STORIES -- the same event, on eight sites, getting worse
   *
   * Until this existed, nothing on VerityNet was ever ABOUT anything else.
   * Every site streamed independently from its own pool on its own interval,
   * so a substation story could be on the wire, the paper, the aggregator,
   * the board and social in the same hour and be five unrelated texts. That
   * is a lot of content. It is not an internet.
   *
   * A story is a slot, like everything else here. One candidate every six
   * hours, derived from hash32('st:' + slot), no storage and no randomness.
   * It picks a canon anchor from grammar.js -- a real event with facts that
   * are written down in docs/WORLD.md -- and walks a fixed chain of roles:
   *
   *   wire -> news -> feed -> forum -> social -> wiki -> ask -> farm
   *
   * Each hop arrives a seeded delay after the last, so a story that broke
   * six hours ago has made four hops and the sites further down have not
   * heard yet. And each hop INHERITS the previous hop's damage and adds
   * exactly one more: a date slips a year, a cause is swapped for a
   * plausible wrong one, a number inflates, or a fact goes vague. Hop 0 is
   * the record. Hop 7 has seven things wrong and still reads like a news
   * story, which is the entire point.
   *
   * One hop may get it right and be ignored -- see `correction` below.
   * ====================================================================== */

  var STORY_INTERVAL_MIN = 360;     /* a candidate every six hours */
  var STORY_FIRES_PCT = 40;         /* ...of which this many actually run */
  var MAX_LIVE_STORIES = 3;

  /* gap: minutes to the NEXT hop. Cumulative, never independently jittered,
   * because a hop that overtakes its own source means the aggregator front
   * pages a story the wire has not filed yet. */
  var STORY_CHAIN = [
    { role: 'wire',   gap: 55 },
    { role: 'news',   gap: 105 },
    { role: 'feed',   gap: 130 },
    { role: 'forum',  gap: 145 },
    { role: 'social', gap: 170 },
    { role: 'wiki',   gap: 285 },
    { role: 'ask',    gap: 350 },
    { role: 'farm',   gap: 0 }
  ];

  function storyDomainFor(role, seed, used) {
    var rows = registryRows(), i, cands = [];
    var types = ROLE_TYPES[role] || [];
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (types.indexOf(r.type) === -1) { continue; }
      /* The archive is frozen. A 2007 newspaper page cannot carry a story
       * from this morning, and letting it would destroy the one thing a
       * reader can check the network against. */
      if (String(r.era || '').indexOf('2026') === -1) { continue; }
      if (used[r.domain]) { continue; }
      cands.push(r);
    }
    if (!cands.length) { return null; }

    /* Prefer the obvious site half the time, so the network has a spine,
     * and rotate the rest so every story does not run through the same
     * eight domains and read as scripted by Tuesday. */
    var prefer = ROLE_PREFER[role] || [];
    if (hash32(seed + ':pref' + role) % 100 < 50) {
      for (i = 0; i < prefer.length; i++) {
        var j;
        for (j = 0; j < cands.length; j++) {
          if (cands[j].domain === prefer[i]) { return cands[j]; }
        }
      }
    }
    return cands[hash32(seed + ':pick' + role) % cands.length];
  }

  /* The damage at hop n, replayed from hop 0 so it is a pure function of
   * (seed, n) rather than something accumulated. */
  function decayAt(core, seed, n) {
    var lost = [], wrong = {}, h, i;
    for (h = 1; h <= n; h++) {
      var live = [];
      for (i = 0; i < core.facts.length; i++) {
        var k = core.facts[i].k;
        if (!Object.prototype.hasOwnProperty.call(wrong, k) &&
            lost.indexOf(k) === -1) { live.push(core.facts[i]); }
      }
      if (!live.length) { break; }      /* saturated; later hops add nothing */
      var f = live[hash32(seed + ':lose' + h) % live.length];
      if (hash32(seed + ':mode' + h) % 100 < 62) {
        wrong[f.k] = f.w[hash32(seed + ':w' + h) % f.w.length];
      } else {
        lost.push(f.k);
      }
    }
    return { lost: lost, wrong: wrong };
  }

  function storyAt(slot) {
    var seed = 'st:' + slot;
    if (hash32(seed + ':fires') % 100 >= STORY_FIRES_PCT) { return null; }
    if (!SYNTH.grammar || typeof SYNTH.grammar.storyCore !== 'function') {
      return null;
    }
    var core = SYNTH.grammar.storyCore(seed);
    var t0 = EPOCH + slot * STORY_INTERVAL_MIN * MINUTE;
    var r = rng(seed + ':life');
    var lifeH = 24 + Math.floor(r() * 72);
    var heat = r();
    var hops = 4 + Math.round(heat * 4);

    var chain = [], used = {}, at = t0, i;
    for (i = 0; i < STORY_CHAIN.length && chain.length < hops; i++) {
      var step = STORY_CHAIN[i];
      var site = storyDomainFor(step.role, seed, used);
      if (!site) { continue; }
      used[site.domain] = 1;
      chain.push({
        hop: chain.length, role: step.role, domain: site.domain,
        type: site.type, at: at
      });
      var jitter = 0.7 + 0.6 * rng(seed + ':gap' + i)();
      at += step.gap * jitter * MINUTE;
    }
    if (chain.length < 2) { return null; }

    return {
      id: 's' + slot, slot: slot, seed: seed, at: t0,
      ends: t0 + lifeH * HOUR, lifeHours: lifeH, heat: heat,
      anchor: core.anchor, subject: core.subject, where: core.where,
      trigger: core.trigger, facts: core.facts, chain: chain,
      /* Which hop, if any, gets it right and is ignored anyway. */
      fixAt: (hash32(seed + ':fix') % 100 < 45)
        ? 2 + (hash32(seed + ':fixhop') % Math.max(1, chain.length - 2))
        : -1
    };
  }

  function storiesLive(atMs) {
    var at = (typeof atMs === 'number') ? atMs : now();
    var current = Math.floor((at - EPOCH) / (STORY_INTERVAL_MIN * MINUTE));
    var out = [], back;
    /* 96h of history is four days, past the longest lifeHours draw. */
    for (back = 0; back <= 16 && out.length < MAX_LIVE_STORIES; back++) {
      var s = storyAt(current - back);
      if (!s) { continue; }
      if (at < s.at || at > s.ends) { continue; }
      out.push(s);
    }
    return out;
  }

  /* This site's version of whatever story is touching it, or null -- and
   * null is the common case and is correct. A site carries a story about a
   * fifth of the time; the rest of the network is not about any one thing,
   * which is also true of the real one. */
  function story(site, opts) {
    opts = opts || {};
    var domain = String((site && site.domain) || site || '').toLowerCase();
    if (!domain) { return null; }
    var at = (typeof opts.at === 'number') ? opts.at : now();
    var live = storiesLive(at), i, j;

    for (i = 0; i < live.length; i++) {
      var s = live[i];
      for (j = 0; j < s.chain.length; j++) {
        var hop = s.chain[j];
        if (hop.domain.toLowerCase() !== domain) { continue; }
        if (at < hop.at) { continue; }     /* has not reached here yet */
        var isFix = (s.fixAt === hop.hop);
        var dmg = isFix ? { lost: [], wrong: {} } : decayAt(s, s.seed, hop.hop);
        var view = {
          role: hop.role, type: hop.type, hop: hop.hop,
          subject: s.subject, where: s.where, trigger: s.trigger,
          facts: s.facts, lost: dmg.lost, wrong: dmg.wrong,
          correction: isFix, seed: s.seed + ':h' + hop.hop
        };
        var item = SYNTH.grammar.storyItem(s, view);
        var out = row(hop.hop, hop.at, item, hash32(view.seed));
        out.story = true;
        out.storyId = s.id;
        out.anchor = s.anchor;
        out.hop = hop.hop;
        out.role = hop.role;
        out.lost = dmg.lost;
        out.wrong = dmg.wrong;
        out.correction = isFix;
        out.upstream = j > 0 ? s.chain[j - 1] : null;
        return out;
      }
    }
    return null;
  }

  /* The opt-in, and the whole reason this is not a layer: it takes stream()
   * rows and returns stream() rows. A renderer adds one line and every other
   * line it has stays exactly as it was. */
  function withStory(rows, site, opts) {
    var list = rows || [];
    var v = story(site, opts);
    if (!v) { return list; }
    /* Prepended rather than time-sorted into position seven of nine, where
     * it would be statistically present and practically invisible. */
    return [v].concat(list);
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
    /* Exported because renderers hold both shapes too: an authored time is a
     * wall-clock string and a streamed one is epoch ms, and every one of them
     * had its own half-right parser. */
    toMs: toMs,
    toMsHasDay: hasDay,
    clock: clock,
    longDate: longDate,
    stream: stream,
    pool: resolvePool,
    virtual: virtual,
    poolItem: poolItem,
    titleOf: titleOf,
    resetLedger: resetLedger,
    ledgerRows: ledgerRows,
    arrivals: arrivals,
    busyness: busyness,
    slotLive: slotLive,
    siteFor: siteFor,
    domainFor: domainFor,
    linkTo: linkTo,
    counter: counter,
    threadLife: threadLife,
    storiesLive: storiesLive,
    story: story,
    withStory: withStory,
    online: online,
    short: short,
    commas: commas
  };
})();
