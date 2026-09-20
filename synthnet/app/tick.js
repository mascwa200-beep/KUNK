/* tick.js -- the heartbeat.
 *
 * Before this file there was not one setInterval in the whole project. The
 * page painted once and froze: every timestamp, view count, "users online"
 * and ticker was computed at paint and then sat there until you navigated.
 * So the net moved between visits and was a photograph during one, which is
 * the opposite of the impression the wall clock in live.js exists to create.
 *
 * What this does NOT do is re-render the page on a timer. That would be one
 * line and it would be wrong: it throws away scroll position, collapses any
 * "show more replies" you had opened, fights the async navToken machinery in
 * engine.js, and moves the thing you were reading out from under your thumb.
 * Real feeds do not do it either.
 *
 * Instead:
 *
 *   1. The small, self-contained widgets that are *about* motion -- the
 *      online counter, the breaking ticker -- repaint in place. They carry a
 *      data-lv-* attribute describing how to rebuild them, so this file
 *      never has to know which renderer drew them.
 *
 *   2. New arrivals are announced, not injected. live.js keeps a ledger of
 *      which streams the current page consulted and at which slot; when
 *      those slots tick over, a "4 new posts" pill appears at the top of the
 *      viewport. Clicking it re-renders -- which is the one moment when
 *      replacing what you are looking at is what you asked for.
 *
 * Everything is still a pure function of the clock. This file adds no state
 * to the world; it only asks the same questions again, later.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};
  var SYNTH = window.SYNTH;

  /* Ten seconds is short enough that a counter visibly moves while you read
   * a page and long enough to be free. The work per beat is a querySelectorAll
   * over one subtree and some arithmetic. */
  var BEAT_MS = 10000;

  var timer = null;
  var pillNode = null;

  function el() { return SYNTH.el.apply(null, arguments); }
  function live() { return SYNTH.live; }

  function viewport() {
    return document.getElementById('synth-viewport');
  }

  /* --- when not to beat --------------------------------------------------
   *
   * Repainting under someone's hands is worse than not repainting. */
  function busy() {
    // A hidden tab should cost nothing at all.
    if (document.hidden) return true;

    var view = viewport();
    if (!view) return true;

    // Typing. The composer, the assistant's chat box, a search field.
    var active = document.activeElement;
    if (active && active !== document.body && view.contains(active)) {
      var tag = String(active.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (active.isContentEditable) return true;
    }

    // Mid-selection: the user is copying something out of the page.
    try {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount) {
        var node = sel.getRangeAt(0).commonAncestorContainer;
        if (node && view.contains(node.nodeType === 1 ? node : node.parentNode)) {
          return true;
        }
      }
    } catch (e) { /* no selection API, carry on */ }

    return false;
  }

  /* --- widgets that repaint in place ------------------------------------ */

  function repaintOnline(node) {
    var spec = String(node.getAttribute('data-lv-online') || '').split(':');
    var domain = spec[0];
    var low = parseInt(spec[1], 10) || 40;
    var high = parseInt(spec[2], 10) || 900;
    if (!domain || !SYNTH.liveui || typeof SYNTH.liveui.onlineBar !== 'function') return;

    var fresh = SYNTH.liveui.onlineBar(domain, low, high);
    if (!fresh) return;
    // onlineBar returns a whole bar; move its children across rather than
    // swapping the node, so nothing that wrapped it loses its child.
    while (node.firstChild) node.removeChild(node.firstChild);
    while (fresh.firstChild) node.appendChild(fresh.firstChild);
  }

  function repaintTicker(node) {
    var spec = String(node.getAttribute('data-lv-ticker') || '').split(':');
    var seed = spec[0] || 'ticker';
    var count = parseInt(spec[1], 10) || 8;
    if (!SYNTH.liveui || typeof SYNTH.liveui.ticker !== 'function') return;

    var fresh = SYNTH.liveui.ticker(seed, count);
    if (!fresh) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    while (fresh.firstChild) node.appendChild(fresh.firstChild);
  }

  /* A counter that grows with elapsed time. The attribute carries everything
   * needed to recompute it: data-lv-counter="<key>|<base>|<perDay>|<fmt>" */
  function repaintCounter(node) {
    var spec = String(node.getAttribute('data-lv-counter') || '').split('|');
    if (spec.length < 3) return;
    var L = live();
    if (!L || typeof L.counter !== 'function') return;
    var value = L.counter(spec[0], parseFloat(spec[1]) || 0, parseFloat(spec[2]) || 0);
    var text = spec[3] === 'short' ? L.short(value) : L.commas(value);
    if (node.textContent !== text) node.textContent = text;
  }

  /* A relative timestamp: data-lv-ago="<epoch ms>" */
  function repaintAgo(node) {
    var ms = parseInt(node.getAttribute('data-lv-ago'), 10);
    if (!isFinite(ms)) return;
    var L = live();
    if (!L || typeof L.ago !== 'function') return;
    var text = L.ago(ms);
    if (node.textContent !== text) node.textContent = text;
  }

  function repaintWidgets() {
    var view = viewport();
    if (!view) return;
    var i, rows;
    rows = view.querySelectorAll('[data-lv-online]');
    for (i = 0; i < rows.length; i++) repaintOnline(rows[i]);
    rows = view.querySelectorAll('[data-lv-ticker]');
    for (i = 0; i < rows.length; i++) repaintTicker(rows[i]);
    rows = view.querySelectorAll('[data-lv-counter]');
    for (i = 0; i < rows.length; i++) repaintCounter(rows[i]);
    rows = view.querySelectorAll('[data-lv-ago]');
    for (i = 0; i < rows.length; i++) repaintAgo(rows[i]);
  }

  /* --- the new-arrivals pill --------------------------------------------- */

  function dropPill() {
    if (pillNode && pillNode.parentNode) pillNode.parentNode.removeChild(pillNode);
    pillNode = null;
  }

  function showPill(n) {
    var view = viewport();
    if (!view) return;

    var label = n === 1 ? '1 new post' : n + ' new posts';
    if (pillNode) {
      var span = pillNode.querySelector('.lv-pill-text');
      if (span) span.textContent = label;
      return;
    }

    pillNode = el('button', {
      type: 'button',
      'class': 'lv-pill',
      title: 'Load what has arrived since this page drew',
      onclick: function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        dropPill();
        if (SYNTH.engine && typeof SYNTH.engine.refresh === 'function') {
          SYNTH.engine.refresh();
        }
      }
    },
      el('span', { 'class': 'lv-pill-arrow', 'aria-hidden': 'true' }, '↑'),
      el('span', { 'class': 'lv-pill-text' }, label)
    );
    view.insertBefore(pillNode, view.firstChild);
  }

  function checkArrivals() {
    var L = live();
    if (!L || typeof L.arrivals !== 'function') return;
    var n = L.arrivals();
    if (n > 0) showPill(n);
  }

  /* --- the beat ---------------------------------------------------------- */

  function beat() {
    if (busy()) return;
    try {
      repaintWidgets();
      checkArrivals();
    } catch (e) {
      /* A throwing heartbeat that keeps throwing every ten seconds would
       * bury the console and hide whatever caused it. Stop, and say so once. */
      stop();
      if (window.console && console.error) {
        console.error('[synth.tick] stopped after an error', e && e.stack ? e.stack : e);
      }
    }
  }

  function start() {
    if (timer !== null) return;
    timer = setInterval(beat, BEAT_MS);
    /* A tab that was hidden for an hour should catch up the moment it is
     * looked at, not up to ten seconds later. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) beat();
    }, false);
  }

  function stop() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  /* Called by the engine at the start of every render: the page about to be
   * drawn is current by definition, so any pill from the previous one is
   * stale. */
  function reset() {
    dropPill();
  }

  SYNTH.tick = {
    start: start,
    stop: stop,
    reset: reset,
    beat: beat,           /* exported so tests can step the clock by hand */
    running: function () { return timer !== null; },
    interval: BEAT_MS
  };
})();
