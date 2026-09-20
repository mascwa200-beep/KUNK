/* hostbridge.js -- the page's one line to the app around it.
 *
 * When Synthnet runs as an Android app there is a home-screen widget and an
 * occasional notification, and both have to work with the app closed. There
 * is no WebView then: no JavaScript engine, no storage access, nothing. So
 * the native side recomputes the counts itself from the same wall clock (see
 * android/.../SlotMath.java, which is cross-checked against app/live.js in
 * CI), and all it needs from here is the small part it cannot derive -- when
 * you last looked at each site, and which streams that site watches.
 *
 * The counts are deliberately NOT sent. A stored count is wrong within
 * minutes and increasingly wrong for exactly as long as the app stays closed,
 * which is when the widget is being read. Sending the inputs and letting the
 * other side do the arithmetic is the only version of this that keeps
 * climbing while you are asleep.
 *
 * Everywhere that is not the Android app -- a browser, tools/serve.py, the
 * standalone single-file build -- window.SynthHost simply does not exist and
 * every function here quietly does nothing.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};
  var SYNTH = window.SYNTH;

  /* Keep the snapshot small: it goes into SharedPreferences, and forty sites
   * is far more than anyone has visited in a session. */
  var MAX_SITES = 60;

  function host() {
    try {
      return (typeof window.SynthHost !== 'undefined') ? window.SynthHost : null;
    } catch (e) {
      return null;
    }
  }

  function available() { return !!host(); }

  function alertsEnabled() {
    var h = host();
    if (!h || typeof h.alertsEnabled !== 'function') return false;
    try { return !!h.alertsEnabled(); } catch (e) { return false; }
  }

  /* Shows the system permission dialog, via the activity. Only from a tap:
   * a prompt that appears before anyone knows what the app is gets declined,
   * and on Android 13+ a declined POST_NOTIFICATIONS is final until the app
   * is reinstalled. */
  function requestAlerts() {
    var h = host();
    if (!h || typeof h.requestAlerts !== 'function') return false;
    try { h.requestAlerts(); return true; } catch (e) { return false; }
  }

  /* Called by the activity after the dialog is answered, so the page can
   * redraw whatever toggle asked. */
  function alertsAnswered() {
    try {
      if (SYNTH.engine && typeof SYNTH.engine.refresh === 'function') {
        SYNTH.engine.refresh();
      }
    } catch (e) { /* not worth breaking over */ }
  }

  function snapshot() {
    var A = SYNTH.alerts;
    if (!A) return null;

    var visits = A.allVisits();
    var rows = [];
    Object.keys(visits).forEach(function (domain) {
      if (A.levelFor('domain', domain) === 'muted') return;
      var rec = visits[domain];
      var entry = (SYNTH.data && typeof SYNTH.data.entry === 'function')
        ? SYNTH.data.entry(domain) : null;
      rows.push({
        domain: domain,
        title: (entry && entry.title) || domain,
        at: rec.at,
        feeds: (rec.feeds || []).map(function (f) {
          return { key: f.key, interval: f.interval };
        })
      });
    });

    /* Busiest first, so a truncated snapshot keeps the sites that matter. */
    rows.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    if (rows.length > MAX_SITES) rows.length = MAX_SITES;

    var profile = (SYNTH.me && typeof SYNTH.me.profile === 'function')
      ? SYNTH.me.profile() : null;

    var badge = { count: 0 };
    try { badge = A.badge(); } catch (e) { /* leave it at zero */ }

    return {
      handle: (profile && profile.handle) || '',
      seenAt: A.seenAt(),
      /* Things addressed to you, as of now. Unlike the per-site counts this
       * one genuinely cannot be recomputed natively -- it depends on the bot
       * reply engine -- so it is a snapshot and the notification treats it
       * as a floor rather than a live figure. */
      mentions: badge.count || 0,
      sites: rows
    };
  }

  /* Push the snapshot across. Cheap: a few hundred bytes into
   * SharedPreferences, and it also refreshes the widget. */
  function sync() {
    var h = host();
    if (!h || typeof h.saveSnapshot !== 'function') return false;
    var snap = snapshot();
    if (!snap) return false;
    try {
      h.saveSnapshot(JSON.stringify(snap));
      return true;
    } catch (e) {
      return false;
    }
  }

  SYNTH.host = {
    available: available,
    alertsEnabled: alertsEnabled,
    requestAlerts: requestAlerts,
    alertsAnswered: alertsAnswered,
    snapshot: snapshot,
    sync: sync
  };
})();
