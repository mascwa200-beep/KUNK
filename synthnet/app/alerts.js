/* alerts.js -- what happened while you were gone.
 *
 * The network already moved while the app was shut. That is what the wall
 * clock in live.js is for and it has always been true. What was missing is
 * any record that you were not there to see it: no unread count, no "since
 * your last visit", no subscriptions, no last-seen anywhere in storage. You
 * could post, bots could reply, followers could arrive, and you had to go
 * looking for all of it.
 *
 * The whole mechanism is ONE SMALL RECORD PER DOMAIN: when you last looked,
 * and which streams that page was watching when it drew. engine.js writes it
 * on every successful navigation. Everything below is derived from that,
 * because live.stream() is a pure function of the clock:
 *
 *     unread(domain) = slots that have ticked over since you last looked
 *
 * No content is stored. No background work runs. Nothing is queued. Shut the
 * app for three days, open it, and it says 1,412 new posts across nine sites
 * -- because 1,412 slots elapsed, not because anything was running.
 *
 * The other stored thing is subscriptions, which are tiny: a kind, an id and
 * a level. Everything they produce is derived too.
 *
 * Exports (window.SYNTH.alerts):
 *   lastVisit(domain)          -> ms, or 0 if never
 *   markVisited(domain, feeds) -> promise
 *   unreadFor(domain)          -> {count, since}
 *   unreadByDomain()           -> {domain: count}
 *   since(ms)                  -> [EVENT] newest first
 *   digest()                   -> {events, mentions, ambient, oldest, newest}
 *   badge()                    -> {count, dot}   see "count versus dot" below
 *   markAllRead()              -> promise
 *   subs() / subscribe() / unsubscribe() / levelFor()
 *
 * EVENT = {id, at, kind, level, title, body, url, from}
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};
  var SYNTH = window.SYNTH;

  var VISITS = 'visits';        /* domain -> {at, feeds:[{key,interval}]} */
  var SUBS = 'subs';            /* "<kind>:<id>" -> {kind, id, level, at} */
  var STATE = 'alertstate';     /* 'seen' -> ms the alert list was last read */

  var MINUTE = 60000;
  var DAY = 86400000;

  /* Subscription levels, borrowed from Discourse because it is the ladder
   * that actually works: four steps, each one obvious.
   *
   *   watching   every post produces an alert
   *   tracking   a count, no alert
   *   normal     nothing unless you are mentioned
   *   muted      nothing, ever
   */
  var LEVELS = ['muted', 'normal', 'tracking', 'watching'];
  var DEFAULT_LEVEL = 'normal';

  function store() { return SYNTH.store; }
  function live() { return SYNTH.live; }
  function nowMs() {
    return (live() && live().now) ? live().now() : Date.now();
  }

  function has(fn) { return typeof fn === 'function'; }

  /* --- unread ------------------------------------------------------------
   *
   * Counting the slots a site's feed has ticked through since you last
   * looked means knowing which streams that site watches and how fast they
   * run. The obvious way to get that is a table here mapping site type to
   * stream key and cadence -- and it would be wrong within a month, because
   * the keys live inline in seventeen renderers and nothing would tell you
   * when one changed. Two bugs on this project have already been exactly
   * that shape.
   *
   * So it is not written down anywhere. live.js keeps a ledger of the
   * streams the page actually consulted, and engine.js hands that ledger to
   * markVisited() on the way out. A site's feeds are therefore whatever that
   * site really asked for the last time it drew, and a renderer changing its
   * cadence updates this automatically on the next visit.
   *
   * A site you have never opened has no recorded feeds and no unread count,
   * which is correct: you cannot be behind on something you have never seen.
   */

  function visitRecord(domain) {
    if (!store() || !domain) return null;
    var v = store().get(VISITS, String(domain).toLowerCase(), null);
    if (!v) return null;
    /* Tolerate the bare timestamp an older build wrote. */
    if (typeof v === 'number') return { at: v, feeds: [] };
    return (typeof v.at === 'number') ? v : null;
  }

  function lastVisit(domain) {
    var rec = visitRecord(domain);
    return rec ? rec.at : 0;
  }

  function markVisited(domain, feeds) {
    if (!store() || !domain) return Promise.resolve(false);
    var rows = [];
    (feeds || []).forEach(function (f) {
      if (f && f.key && f.interval > 0) {
        rows.push({ key: f.key, interval: f.interval });
      }
    });
    /* A page that drew no stream this time (an article, say) must not wipe
     * the feeds recorded when its front page drew. */
    if (!rows.length) {
      var prev = visitRecord(domain);
      if (prev && prev.feeds && prev.feeds.length) rows = prev.feeds;
    }
    return store().put(VISITS, String(domain).toLowerCase(),
                       { at: nowMs(), feeds: rows });
  }

  function allVisits() {
    if (!store()) return {};
    var out = {};
    store().all(VISITS).forEach(function (row) {
      var v = row.value;
      if (typeof v === 'number') out[row.key] = { at: v, feeds: [] };
      else if (v && typeof v.at === 'number') out[row.key] = v;
    });
    return out;
  }

  function slotsSince(key, intervalMin, since) {
    var L = live();
    if (!L || !has(L.slotLive)) return 0;
    var nowSlot = Math.floor(L.minutesSinceEpoch() / intervalMin);
    var sinceSlot = Math.floor((since - L.EPOCH) / (intervalMin * MINUTE));
    if (!isFinite(sinceSlot) || sinceSlot < 0) sinceSlot = nowSlot - 1;
    /* A month away is "lots", not a reason to count to forty thousand. */
    var from = Math.max(sinceSlot + 1, nowSlot - 600);
    var n = 0;
    for (var s = from; s <= nowSlot; s++) {
      if (L.slotLive(key, s, intervalMin)) n++;
    }
    return n;
  }

  function countFor(rec) {
    if (!rec || !rec.feeds || !rec.feeds.length) return 0;
    var n = 0;
    for (var i = 0; i < rec.feeds.length; i++) {
      n += slotsSince(rec.feeds[i].key, rec.feeds[i].interval, rec.at);
    }
    return n;
  }

  function unreadFor(domain) {
    var rec = visitRecord(domain);
    if (!rec) return { count: 0, since: 0 };
    if (levelFor('domain', domain) === 'muted') return { count: 0, since: rec.at };
    return { count: countFor(rec), since: rec.at };
  }

  function unreadByDomain() {
    var out = {};
    var visits = allVisits();
    Object.keys(visits).forEach(function (domain) {
      if (levelFor('domain', domain) === 'muted') return;
      var n = countFor(visits[domain]);
      if (n > 0) out[domain] = n;
    });
    return out;
  }

  /* --- subscriptions ----------------------------------------------------- */

  function subKey(kind, id) {
    return String(kind) + ':' + String(id).toLowerCase();
  }

  function subs() {
    if (!store()) return [];
    return store().all(SUBS)
      .map(function (r) { return r.value; })
      .filter(function (v) { return v && v.kind && v.id; });
  }

  function levelFor(kind, id) {
    if (!store()) return DEFAULT_LEVEL;
    var row = store().get(SUBS, subKey(kind, id), null);
    return (row && LEVELS.indexOf(row.level) !== -1) ? row.level : DEFAULT_LEVEL;
  }

  function subscribe(kind, id, level) {
    if (!store()) return Promise.resolve(false);
    if (LEVELS.indexOf(level) === -1) level = 'watching';
    if (level === DEFAULT_LEVEL) return unsubscribe(kind, id);
    return store().put(SUBS, subKey(kind, id),
      { kind: kind, id: String(id), level: level, at: nowMs() });
  }

  function unsubscribe(kind, id) {
    if (!store()) return Promise.resolve(false);
    return store().del(SUBS, subKey(kind, id));
  }

  /* --- the event list ----------------------------------------------------
   *
   * Everything here is derived from something that already existed. None of
   * it is stored, and none of it ran while the app was closed -- it is all
   * simply true of the clock now and was not true then.
   */

  function ev(id, at, kind, level, title, body, url, from) {
    return {
      id: id, at: at, kind: kind, level: level,
      title: title, body: body || '', url: url || '', from: from || ''
    };
  }

  /* Replies to your own posts. bots.repliesFor() already grows with elapsed
   * time, so the ones that are new are simply the ones dated after `since`. */
  function replyEvents(since, out) {
    if (!SYNTH.me || !has(SYNTH.me.posts) || !SYNTH.bots || !has(SYNTH.bots.repliesFor)) return;
    var profile = has(SYNTH.me.profile) ? SYNTH.me.profile() : null;
    if (!profile) return;
    var now = nowMs();

    SYNTH.me.posts().slice(0, 25).forEach(function (post) {
      var replies;
      try {
        replies = SYNTH.bots.repliesFor(post, {
          now: now, followers: profile.followers || 0
        }) || [];
      } catch (e) { return; }

      var fresh = replies.filter(function (r) {
        return (r.at || post.at) > since;
      });
      if (!fresh.length) return;

      var excerpt = String(post.body || '').replace(/\s+/g, ' ').slice(0, 48);
      var human = fresh.filter(function (r) { return r.kind === 'human'; });
      /* Bundling: "Alice, Bob and 12 others replied" rather than fourteen
       * rows. Real notification lists do this because fourteen rows of the
       * same event is not fourteen times as much information. */
      var who = fresh.slice(0, 2).map(function (r) {
        return r.author || r.handle || 'someone';
      });
      var rest = fresh.length - who.length;
      var headline = who.join(', ') +
        (rest > 0 ? ' and ' + rest + ' other' + (rest === 1 ? '' : 's') : '') +
        ' replied';

      out.push(ev(
        'reply:' + post.id + ':' + fresh.length,
        fresh[0].at || now,
        'reply',
        'mention',                     /* addressed to you: earns a number */
        headline,
        '“' + excerpt + (post.body.length > 48 ? '…' : '') + '”' +
          (human.length ? '' : ' · all of them automated'),
        'synth://' + post.domain + '/',
        who[0]
      ));
    });
  }

  /* Followers, milestones and the world reacting to you. */
  function fameEvents(since, out) {
    if (!SYNTH.fame || !SYNTH.me || !has(SYNTH.me.profile)) return;
    var profile = SYNTH.me.profile();
    if (!profile) return;

    if (has(SYNTH.fame.events)) {
      var world = [];
      try { world = SYNTH.fame.events(profile) || []; } catch (e) { world = []; }
      world.forEach(function (e) {
        /* Fame events have no timestamp of their own -- they are true or not
         * true of your follower count. Treat one as "new" if it has not been
         * seen, which the seen-marker below handles. */
        out.push(ev('fame:' + e.id, nowMs(), 'world', 'mention',
                    e.title, firstLine(e.body),
                    e.domain ? 'synth://' + e.domain + '/' : '', ''));
      });
    }

    if (has(SYNTH.fame.dmsFor)) {
      var dms = [];
      try { dms = SYNTH.fame.dmsFor(profile) || []; } catch (e) { dms = []; }
      dms.filter(function (d) { return d.at > since; }).forEach(function (d) {
        out.push(ev('dm:' + d.handle + ':' + d.at, d.at, 'dm', 'mention',
                    'Message from ' + (d.from || d.handle),
                    firstLine(d.body), '', d.handle));
      });
    }
  }

  /* Sites you are watching that have published. */
  function subscriptionEvents(since, out) {
    var rows = subs().filter(function (s) {
      return s.kind === 'domain' && s.level === 'watching';
    });
    rows.forEach(function (s) {
      var rec = visitRecord(s.id);
      if (!rec) return;              /* watching something never opened */
      var n = countFor(rec);
      if (n < 1) return;
      var entry = (SYNTH.data && has(SYNTH.data.entry)) ? SYNTH.data.entry(s.id) : null;
      out.push(ev('sub:' + s.id + ':' + n, nowMs(), 'published', 'mention',
                  ((entry && entry.title) || s.id) + ': ' + n + ' new',
                  (entry && entry.description) || '', 'synth://' + s.id + '/', ''));
    });
  }

  /* Everything else that moved. One row per site, not one per post. */
  function ambientEvents(since, out) {
    var unread = unreadByDomain();
    Object.keys(unread).forEach(function (domain) {
      if (levelFor('domain', domain) === 'watching') return;   /* already above */
      var entry = (SYNTH.data && has(SYNTH.data.entry)) ? SYNTH.data.entry(domain) : null;
      out.push(ev('ambient:' + domain + ':' + unread[domain], nowMs(),
                  'activity', 'ambient',
                  (entry && entry.title ? entry.title : domain),
                  unread[domain] + ' new since you looked',
                  'synth://' + domain + '/', ''));
    });
  }

  function firstLine(body) {
    var s = String(body || '').split('\n')[0];
    if (SYNTH.markup && has(SYNTH.markup.strip)) {
      try { s = String(SYNTH.markup.strip(s)); } catch (e) { /* raw is fine */ }
    }
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  }

  function since(ms) {
    var from = typeof ms === 'number' ? ms : seenAt();
    var out = [];
    try { replyEvents(from, out); } catch (e) {}
    try { fameEvents(from, out); } catch (e) {}
    try { subscriptionEvents(from, out); } catch (e) {}
    try { ambientEvents(from, out); } catch (e) {}
    out.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    return out;
  }

  /* --- seen state --------------------------------------------------------- */

  function seenAt() {
    if (!store()) return nowMs() - DAY;
    var v = store().get(STATE, 'seen', 0);
    if (typeof v === 'number' && v > 0) return v;

    /* Nothing stored yet. The obvious fallback is "now minus a day", and it
     * is wrong in a way that is easy to miss: it is recomputed on every call,
     * so it floats with the clock. Go away for three days and the digest
     * still only reports the last twenty-four hours of them, because the
     * window slid along with you.
     *
     * The account's own start date is the honest answer -- you have been
     * away since you signed up and never came back to read anything. */
    var profile = (SYNTH.me && has(SYNTH.me.profile)) ? SYNTH.me.profile() : null;
    if (profile && profile.joined) {
      var joined = typeof profile.joined === 'number'
        ? profile.joined : Date.parse(profile.joined);
      if (isFinite(joined) && joined > 0 && joined <= nowMs()) return joined;
    }
    return nowMs() - DAY;
  }

  function markAllRead() {
    if (!store()) return Promise.resolve(false);
    return store().put(STATE, 'seen', nowMs());
  }

  /* --- the badge ----------------------------------------------------------
   *
   * Count versus dot, which is the difference between an app that feels calm
   * and one that feels frantic. A NUMBER is only ever for things addressed to
   * you -- a reply to your post, a message, the world reacting to you. Plain
   * ACTIVITY on sites you read gets a dot and no number, because "1,412" on a
   * bell means nothing except that you should feel behind.
   */
  function badge() {
    var rows = since(seenAt());
    var count = 0, dot = false;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].level === 'mention') count++;
      else dot = true;
    }
    return { count: count, dot: dot || count > 0 };
  }

  /* Grouped for the "while you were away" block. */
  function digest() {
    var rows = since(seenAt());
    var mentions = [], ambient = [];
    rows.forEach(function (r) {
      (r.level === 'mention' ? mentions : ambient).push(r);
    });
    return {
      events: rows,
      mentions: mentions,
      ambient: ambient,
      seenAt: seenAt(),
      away: Math.max(0, nowMs() - seenAt())
    };
  }

  SYNTH.alerts = {
    LEVELS: LEVELS,
    lastVisit: lastVisit,
    markVisited: markVisited,
    allVisits: allVisits,
    unreadFor: unreadFor,
    unreadByDomain: unreadByDomain,
    since: since,
    digest: digest,
    badge: badge,
    seenAt: seenAt,
    markAllRead: markAllRead,
    subs: subs,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    levelFor: levelFor
  };
})();
