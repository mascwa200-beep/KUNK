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

  function stream(key, pool, intervalMin, count) {
    if (!pool || !pool.length) return [];
    var current = Math.floor(minutesSinceEpoch() / intervalMin);
    var out = [];
    for (var i = 0; i < count; i++) {
      var slot = current - i;
      if (slot < 0) break;
      var h = hash32(key + ':' + slot);
      out.push({
        slot: slot,
        at: EPOCH + slot * intervalMin * MINUTE,
        item: pool[h % pool.length],
        seed: h
      });
    }
    return out;
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
    counter: counter,
    online: online,
    short: short,
    commas: commas
  };
})();
