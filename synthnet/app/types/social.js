/* SYNTHNET :: social renderer
   paths: /  |  /user/<handle>  |  /post/<postId>
          /search  |  /members  |  /account
   No modules, no innerHTML, no network. Everything hangs off window.SYNTH.

   On dead controls, because this file had four of them for a year:

   A nav item that does nothing is worse than a missing one. It renders, it
   sits in link colour, and it tells the reader the feature is there. The
   three answers, in order: make it work from what the site already has; say
   why it cannot; delete it. Nothing here is allowed to just sit.

   The era decides which answer applies, and it is not decoration. "Add to
   Friends" on marla.verity.net (2005) and on shoutbox.live (2026) are not
   the same problem: one is a control on a copy of a service that stopped
   answering, the other is a control on a service that is running and simply
   was never wired. The first gets an explanation, the second gets wired. */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  var COLLAPSE_AFTER = 3;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- helpers ---------- */

  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function txt(v, fallback) {
    var s = (v == null) ? '' : String(v);
    return s ? s : (fallback || '');
  }

  function num(n) {
    var v = (typeof n === 'number') ? n : parseInt(n, 10);
    if (!isFinite(v)) v = 0;
    v = Math.round(v);
    var s = String(Math.abs(v)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return (v < 0 ? '-' : '') + out;
  }

  function hash(str) {
    var h = 2166136261, i;
    str = String(str == null ? '' : str);
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function tint(seed) { return 'hsl(' + (hash(seed) % 360) + ', 40%, 62%)'; }

  function initials(name) {
    var clean = String(name == null ? '' : name).replace(/[^A-Za-z0-9 ]/g, ' ').trim();
    if (!clean) return '?';
    var parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function avatar(el, seed, name, cls) {
    return el('span', {
      'class': 'av' + (cls ? ' ' + cls : ''),
      style: 'background:' + tint(txt(seed, name)) + ';',
      title: txt(name)
    }, initials(name));
  }

  function parseTime(t) {
    var s = String(t == null ? '' : t).trim();
    if (!s) return NaN;
    var ms = Date.parse(s);
    if (!isFinite(ms)) ms = Date.parse(s.replace(' ', 'T'));
    return ms;
  }

  /* a relative-looking stamp, measured against the newest thing in the feed */
  function stamp(t, base) {
    var ms = parseTime(t);
    if (!isFinite(ms) || !isFinite(base)) return txt(t);
    var diff = base - ms;
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd';
    var d = new Date(ms);
    var label = MON[d.getMonth()] + ' ' + d.getDate();
    if (d.getFullYear() !== new Date(base).getFullYear()) label += ', ' + d.getFullYear();
    return label;
  }

  function dat(ctx) { return (ctx.site && ctx.site.data) ? ctx.site.data : {}; }
  function feed(ctx) { return arr(dat(ctx).feed); }
  function profile(ctx) { return dat(ctx).profile || {}; }
  function friends(ctx) { return arr(dat(ctx).friends); }

  function newestTime(ctx) {
    var best = NaN;
    feed(ctx).forEach(function (p) {
      var ms = parseTime(p.time);
      if (isFinite(ms) && (!isFinite(best) || ms > best)) best = ms;
      arr(p.replies).forEach(function (r) {
        var rms = parseTime(r.time);
        if (isFinite(rms) && (!isFinite(best) || rms > best)) best = rms;
      });
    });
    return best;
  }

  function findPost(ctx, id) {
    var list = feed(ctx), i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function normHandle(h) {
    return String(h == null ? '' : h).replace(/^@/, '').toLowerCase();
  }

  function postsByHandle(ctx, handle) {
    var want = normHandle(handle);
    return feed(ctx).filter(function (p) { return normHandle(p.handle) === want; });
  }

  function atHandle(h) {
    var s = txt(h);
    if (!s) return '';
    return s.charAt(0) === '@' ? s : '@' + s;
  }

  /* ---------- era ----------
   * Everything dated 2026 is running. Everything else is a copy of something
   * that was running once, and the difference is the whole point of the
   * project, so it decides what a control is allowed to promise. */

  function isNow(ctx) { return String((ctx.site && ctx.site.era) || '') === '2026'; }
  function archived(ctx) { return !isNow(ctx); }
  function eraOf(ctx) { return txt(ctx.site && ctx.site.era, 'then'); }

  function plain(s) {
    var t = String(s == null ? '' : s);
    if (window.SYNTH.markup && typeof window.SYNTH.markup.strip === 'function') {
      try { t = String(window.SYNTH.markup.strip(t)); } catch (e) { /* raw will do */ }
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  function snippet(s, n) {
    var t = plain(s);
    return t.length <= n ? t : (t.substring(0, n - 1) + '…');
  }

  function replyTotal(ctx) {
    var n = 0;
    feed(ctx).forEach(function (p) { n += arr(p.replies).length; });
    return n;
  }

  function monthYear(ms) {
    if (!isFinite(ms)) return '';
    var d = new Date(ms);
    return MON[d.getMonth()] + ' ' + d.getFullYear();
  }

  function span(ctx) {
    var lo = NaN, hi = NaN;
    feed(ctx).forEach(function (p) {
      var ms = parseTime(p.time);
      if (!isFinite(ms)) return;
      if (!isFinite(lo) || ms < lo) lo = ms;
      if (!isFinite(hi) || ms > hi) hi = ms;
    });
    return { from: monthYear(lo), to: monthYear(hi) };
  }

  /* One account publishing at everyone else is not a conversation, and it
   * must not be drawn as one. Counted rather than listed by domain, so a
   * pack that adds another alert feed gets the same treatment for free. */
  function broadcast(ctx) {
    var own = normHandle(profile(ctx).handle), list = feed(ctx), mine = 0, i;
    if (!own || list.length < 4) return false;
    for (i = 0; i < list.length; i++) {
      if (normHandle(list[i].handle) === own) mine++;
    }
    return mine >= list.length * 0.8;
  }

  /* An instance that lets people in one at a time. Read off the profile for
   * the same reason as unmonitored(): the composer must not quietly promise
   * something the site has written down that it does not do. */
  function byApproval(ctx) {
    var bio = plain(profile(ctx).bio).toLowerCase();
    return bio.indexOf('by approval') >= 0 || bio.indexOf('approve') >= 0;
  }

  /* An account that says in its own profile that nobody reads it. The 2026
   * platforms here all write it down; taking it from the bio rather than
   * from a list of domains means the page and the profile cannot disagree. */
  function unmonitored(ctx) {
    var bio = plain(profile(ctx).bio).toLowerCase();
    return bio.indexOf('not monitored') >= 0 ||
           bio.indexOf('replies are not read') >= 0 ||
           bio.indexOf('not read by a person') >= 0;
  }

  /* ---------- following ----------
   * SYNTH.alerts already stores subscriptions and the Feeds panel already
   * reads them, so Follow is a real toggle with a consequence you can go and
   * look at, not a button that turns blue. A domain subscription is the one
   * the alert model knows about; a handle subscription is kept per site and
   * is why a post in the feed can say you follow the account that wrote it. */

  function alertsApi() {
    var A = window.SYNTH.alerts;
    return (A && typeof A.levelFor === 'function' &&
            typeof A.subscribe === 'function' &&
            typeof A.unsubscribe === 'function') ? A : null;
  }

  function isFollowing(kind, id) {
    var A = alertsApi();
    if (!A) return false;
    try { return A.levelFor(kind, id) === 'watching'; } catch (e) { return false; }
  }

  function handleKey(ctx, handle) {
    return ctx.site.domain + '/' + normHandle(handle);
  }

  function followBtn(ctx, kind, id, offLabel, onLabel) {
    var A = alertsApi();
    if (!A) return null;
    var on = isFollowing(kind, id);
    var btn = ctx.el('button', { type: 'button' });

    function paint() {
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      btn.appendChild(document.createTextNode(on ? onLabel : offLabel));
      btn.setAttribute('class', 'btn sn-follow' + (on ? ' is-on' : ''));
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    btn.addEventListener('click', function () {
      on = !on;
      paint();                     /* the label moves now; the write follows */
      var p = on ? A.subscribe(kind, id, 'watching') : A.unsubscribe(kind, id);
      try { Promise.resolve(p).then(null, function () { }); } catch (e) { /* stored or not */ }
    }, false);

    paint();
    return btn;
  }

  function accountLink(ctx, label) { return ctx.link('/account', label, 'btn'); }

  /* The two controls that sat on every profile card doing nothing. */
  function profileActions(ctx) {
    var el = ctx.el;
    if (isNow(ctx)) {
      return el('div', { 'class': 'pactions' },
        followBtn(ctx, 'domain', ctx.site.domain, 'Follow', 'Following') ||
          accountLink(ctx, 'Follow'),
        accountLink(ctx, 'Send Message'));
    }
    /* 2005 and 2008: both of these needed a server that is not in the copy.
     * They keep their labels and take you to the page that says so. */
    return el('div', { 'class': 'pactions' },
      accountLink(ctx, 'Add to Friends'),
      accountLink(ctx, 'Send Message'));
  }

  /* ---------- the people on the page ----------
   * None of these sites ships a member list. Every one of them ships the
   * posts, and a post has an author, so the list can be counted off the page
   * itself -- which is also the honest version: it is who has spoken here,
   * not who registered.
   *
   * Two kinds of account get in here WITHOUT having said anything, and both
   * belong on the page because both are drawn on it: the friends in the
   * sidebar, and the account the site is published under (on shoutbox.live
   * that account has posted nothing at all). They are counted separately,
   * because a headline that says "29 accounts appear in the posts and
   * replies" over a list whose last two rows read "has not posted here" is
   * a member list lying about itself, which is the exact bug this page was
   * built to stop being. */

  function census(ctx) {
    var map = {}, order = [], p = profile(ctx);

    function touch(handle, name, seed) {
      var h = normHandle(handle);
      if (!h) return null;
      if (!map[h]) {
        /* `handle` is the key and is lower case because that is how a handle
         * is matched; `shown` is how the person actually writes it. The list
         * showed everyone as @countyalerts_verity until these were split. */
        map[h] = { handle: h, shown: String(handle).replace(/^@/, ''),
                   name: txt(name, h), seed: txt(seed, h),
                   posts: 0, replies: 0, kind: '',
                   friend: false, self: false };
        order.push(h);
      }
      var rec = map[h];
      if (rec.name === h && txt(name)) rec.name = String(name);
      if (!rec.seed && txt(seed)) rec.seed = String(seed);
      return rec;
    }

    feed(ctx).forEach(function (post) {
      var rec = touch(post.handle, post.author, post.avatarSeed);
      if (rec) {
        rec.posts++;
        if (!rec.kind) rec.kind = txt(post.kind);
      }
      arr(post.replies).forEach(function (r) {
        var sub = touch(r.handle, r.author, r.avatarSeed);
        if (sub) sub.replies++;
      });
    });
    friends(ctx).forEach(function (f) {
      var rec = touch(f.handle, f.displayName, f.avatarSeed);
      if (rec) rec.friend = true;
    });
    if (p.handle) {
      var own = touch(p.handle, p.displayName, p.avatarSeed);
      if (own) own.self = true;
    }

    var list = order.map(function (h) { return map[h]; });
    list.sort(function (a, b) {
      var d = (b.posts + b.replies) - (a.posts + a.replies);
      if (d) return d;
      return a.handle < b.handle ? -1 : (a.handle > b.handle ? 1 : 0);
    });
    return list;
  }

  /* Said something on the pages that survive, as opposed to merely being
   * drawn on them. The sort above already puts the silent ones last. */
  function spoke(m) { return (m.posts + m.replies) > 0; }

  function spokeCount(ctx) {
    var n = 0;
    census(ctx).forEach(function (m) { if (spoke(m)) n++; });
    return n;
  }

  function repliesByHandle(ctx, handle) {
    var want = normHandle(handle), out = [];
    feed(ctx).forEach(function (p) {
      arr(p.replies).forEach(function (r) {
        if (normHandle(r.handle) === want) out.push({ post: p, reply: r });
      });
    });
    return out;
  }

  /* ---------- chrome ---------- */

  /* Every item in here goes somewhere. Mail, Bulletins and Sign Out all land
   * on /account, which answers each of them in turn -- on the archive sites
   * because the server that answered them is not in the copy, and on the
   * 2026 sites because a feed with no session has nothing to end. Bulletins
   * is a 2005 word and is drawn only where it belongs. */
  function topBar(ctx, here) {
    var el = ctx.el, p = profile(ctx), old = archived(ctx);
    return el('div', { 'class': 'sn-top' },
      el('div', { 'class': 'sn-brand' },
        ctx.link('/', txt(ctx.site.title, ctx.site.domain), 'brandlink')),
      el('div', { 'class': 'sn-nav' },
        ctx.link('/', 'Home'),
        p.handle ? ctx.link('/user/' + encodeURIComponent(normHandle(p.handle)), 'My Profile') : null,
        ctx.link('/members', 'Members'),
        ctx.link('/search', 'Search'),
        ctx.link('/account', old ? 'Mail' : 'Messages'),
        old ? ctx.link('/account', 'Bulletins') : null,
        ctx.link('/account', old ? 'Sign Out' : 'Your account')),
      here ? el('div', { 'class': 'sn-here' }, here) : null);
  }

  /* ---------- profile card ---------- */

  /* `quiet` drops the two action buttons. The account page is where those
   * two buttons go, and a button that reloads the page you are reading is
   * the same dead control wearing a destination. */
  function profileCard(ctx, quiet) {
    var el = ctx.el, p = profile(ctx);
    var rows = [];
    function row(k, v) {
      if (!txt(v)) return;
      rows.push(el('div', { 'class': 'prow' },
        el('span', { 'class': 'pk' }, k),
        el('span', { 'class': 'pv' }, String(v))));
    }
    row('Location', p.location);
    row('Joined', p.joined);
    row('Mood', p.mood);

    return el('div', { 'class': 'pcard' },
      el('div', { 'class': 'pcard-head' },
        avatar(el, p.avatarSeed, txt(p.displayName, p.handle), 'big'),
        el('div', { 'class': 'pid' },
          el('div', { 'class': 'pname' }, txt(p.displayName, txt(p.handle, 'someone'))),
          el('div', { 'class': 'phandle' }, atHandle(p.handle)))),
      txt(p.bio) ? bioNode(ctx, p.bio) : null,
      el('div', { 'class': 'pmeta' }, rows),
      el('div', { 'class': 'pcounts' },
        el('span', { 'class': 'pcount' },
          el('strong', null, num(p.following)), ' Following'),
        el('span', { 'class': 'pcount' },
          el('strong', null, num(p.followers)), ' Followers')),
      quiet ? null : profileActions(ctx));
  }

  function friendsGrid(ctx) {
    var el = ctx.el, list = friends(ctx);
    if (!list.length) return null;
    var top = list.slice(0, 8);
    var cells = top.map(function (f) {
      return el('a', {
        'class': 'fcell',
        href: '#',
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          var h = normHandle(f.handle);
          if (h) SYNTH.engine.navigate('synth://' + ctx.site.domain + '/user/' + encodeURIComponent(h));
        }
      },
        avatar(el, f.avatarSeed, txt(f.displayName, f.handle)),
        el('span', { 'class': 'fname' }, txt(f.displayName, txt(f.handle, '?'))));
    });
    /* "(12 total)" was a claim with no way to check it. It is a link now --
     * and it names where it goes, because /members is not a friends list and
     * "see all 12" landing on a page of 29 is the same claim again with a
     * destination stapled to it. */
    return el('div', { 'class': 'friends' },
      el('div', { 'class': 'friends-head' },
        txt(profile(ctx).displayName, 'This user') + "'s Top " + top.length + ' Friends',
        el('span', { 'class': 'fcountall' }, ' (',
          ctx.link('/members', 'all ' + num(list.length) + ' are on Members',
            'fcountlink'), ')')),
      el('div', { 'class': 'fgrid' }, cells));
  }

  /* ---------- posts ---------- */

  function bioNode(ctx, bio) {
    var box = ctx.el('div', { 'class': 'pbio' });
    var frag = ctx.markup(String(bio));
    if (frag) box.appendChild(frag);
    return box;
  }

  function bodyNode(ctx, body) {
    var el = ctx.el, box = el('div', { 'class': 'p-text' });
    var frag = ctx.markup(txt(body));
    if (frag) box.appendChild(frag);
    return box;
  }

  function replyNode(ctx, r, base) {
    var el = ctx.el;
    return el('div', { 'class': 'reply' },
      avatar(el, r.avatarSeed, txt(r.author, r.handle)),
      el('div', { 'class': 'p-main' },
        el('div', { 'class': 'p-head' },
          el('span', { 'class': 'p-name' }, txt(r.author, txt(r.handle, 'someone'))),
          el('span', { 'class': 'p-handle' }, atHandle(r.handle)),
          el('span', { 'class': 'p-dot' }, ' · '),
          el('span', { 'class': 'p-time', title: txt(r.time) }, stamp(r.time, base))),
        bodyNode(ctx, r.body)));
  }

  function replyBlock(ctx, post, base, expandAll) {
    var el = ctx.el, reps = arr(post.replies);
    if (!reps.length) return null;
    var wrap = el('div', { 'class': 'replies' });
    var hidden = [];
    reps.forEach(function (r, i) {
      var node = replyNode(ctx, r, base);
      if (!expandAll && i >= COLLAPSE_AFTER) {
        node.className = node.className + ' hid';
        hidden.push(node);
      }
      wrap.appendChild(node);
    });
    if (hidden.length) {
      var btn = el('button', {
        'class': 'more-btn',
        type: 'button',
        onclick: function () {
          hidden.forEach(function (n) {
            n.className = n.className.replace(/\s*\bhid\b/, '');
          });
          if (btn.parentNode) btn.parentNode.removeChild(btn);
        }
      }, 'show ' + hidden.length + ' more repl' + (hidden.length === 1 ? 'y' : 'ies'));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  /* ---------- reader notes ----------
   *
   * The crowd-sourced correction hung under a post. It belongs here for the
   * same reason the bots do: on this network the loudest posts are automated
   * and wrong, and the only thing answering them is other readers, slowly,
   * after the post has already travelled.
   *
   * Three things about the real ones that matter more than the box itself:
   *
   *   1. They arrive HOURS LATE. The post goes out, it spreads, and the note
   *      turns up the next morning under a copy nobody is reading any more.
   *      So a note has an arrival time and simply is not there before it --
   *      come back tomorrow and a post you already read has grown one.
   *   2. Most are proposed and never shown. The pending state is the common
   *      one, and it is visible to nobody but the people rating it.
   *   3. Some of them are wrong. A note is a crowd, and a crowd that is
   *      confidently mistaken writes in exactly the same register as one
   *      that is right. Three of the bank below are wrong, and nothing on
   *      the page marks which -- that is the point of including them.
   */
  /* Each note names what it is answering. A note about broadband hung under
   * a post about a hardware store does not read as a crowd correcting a
   * mistake, it reads as a bug -- which is what the first version of this
   * did, because the bank was picked at random. `on` is the list of words
   * that have to be in the post for the note to be available at all; null
   * means it fits any automated post, because it is about the account
   * rather than the claim. */
  var NOTES = [
    { on: ['broadband', 'internet', 'ranks', 'ranked'],
      head: 'Readers added context',
      body: 'The figure in this post is from a 2019 state table that ' +
            'measures advertised speed, not delivered speed. Verity County ' +
            'has not been surveyed since.',
      src: 'Sources: state broadband table (2019); county franchise filings' },
    { on: ['substation', 'fire', '2003', '2004'],
      head: 'Readers added context',
      body: 'The Gridfall substation fire was in June 2003, not 2004. The ' +
            '2004 date comes from a video thumbnail that has been reposted ' +
            'since 2024.',
      src: 'Sources: Verity Ledger archive, 12 June 2003' },
    /* Every key here has to be in the post, not any one of them: a note
     * about a substation photograph hung on a post about a covered bridge
     * matched on the word "photo" alone, which is the mismatch this whole
     * matching pass exists to stop. */
    { on: ['substation'], all: ['photo'],
      head: 'Readers added context',
      body: 'The photograph attached to this post is of a substation in ' +
            'another state. The original is credited to a utility trade ' +
            'magazine.',
      src: 'Sources: reverse image search; the magazine’s own archive' },
    /* Canon: the diner closed in 2006; the 1977 fire was in the kitchen and
     * it reopened eleven days later. An earlier version of this note had the
     * two the wrong way round, which put a "Readers added context" box --
     * sitting in the half of this bank that is meant to be RIGHT -- on the
     * side of the mistake the network already models a bot making on
     * gridline.social. askverity.com states it correctly and is the source. */
    { on: ['kestrel', 'diner'],
      head: 'Readers added context',
      body: 'The Blue Kestrel closed in 2006. The 1977 fire was in the ' +
            'kitchen and the diner reopened eleven days later; the two have ' +
            'been merged in retellings ever since.',
      src: 'Sources: kestrel-journal.net; Marion Teale waitressed there 1971–1979' },
    { on: ['trail', 'branch', 'rail', 'trestle', 'crossing'],
      head: 'Readers added context',
      body: 'The Coyne Creek trestle on this route has been fenced since ' +
            '2014. The county’s own 2013 assessment classes it as not ' +
            'suitable for pedestrian loading.',
      src: 'Sources: Structural Assessment, Four Bridge Structures (2013)' },
    { on: ['store', 'shop', 'storefront'],
      head: 'Readers added context',
      body: 'This post gives the wrong street. The business named here has ' +
            'been on Third since 1994.',
      src: 'Sources: county business licence register' },

    /* --- and the ones that are wrong, written in the same register ----- */
    { on: ['trail', 'branch', 'rail', 'freight'],
      head: 'Readers added context',
      body: 'The Verity Rail branch line is still in service. Freight runs ' +
            'on it twice a week.',
      src: 'Sources: a rail enthusiast forum thread from 2011' },
    { on: ['summary', 'roundup', 'explained', 'explainer'],
      head: 'Readers added context',
      body: 'This account has posted the same text under four different ' +
            'local place names in the last week.',
      src: 'Sources: this account’s own timeline' },
    /* The false positive, and it has to land on a person to be the joke the
     * research says it is. These are the words a small business writes with:
     * opening hours, a street, a price. */
    { on: ['sundays', 'walk-in', 'appointment', 'screens', 'batteries'],
      head: 'Readers added context',
      body: 'The em dashes and the sentence rhythm here indicate this was ' +
            'written by a language model.',
      src: 'Sources: widely reported detection guidance' }
  ];

  /* Every note has to be about the post. An earlier version let two of them
   * match anything, and because those two are the false accusations the
   * feature turned into nothing but vigilantism -- half the notes on screen
   * were wrong ones landing on the two humans who knew what they were
   * talking about. Now the wrong ones are keyed too: they land on the words
   * a small business writes with, which is exactly who gets accused.
   *
   * `on` is any-of and `all` is every-of. A note about a substation
   * photograph matched a post about a covered bridge on the word "photo"
   * alone, which is the mismatch this exists to stop. */
  /* Whole words, not substrings. Matching "top " inside "on top of" and
   * "open " inside "opened" is how a note about content-farm reposting
   * found its way onto an obituary. */
  function saysWord(hay, word) {
    var w = String(word).toLowerCase();
    var at = hay.indexOf(w);
    while (at >= 0) {
      var before = at === 0 ? ' ' : hay.charAt(at - 1);
      var after = hay.charAt(at + w.length) || ' ';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) { return true; }
      at = hay.indexOf(w, at + 1);
    }
    return false;
  }

  function notesFor(post) {
    var hay = String(post.body || '').toLowerCase();
    var out = [], i, j;
    for (i = 0; i < NOTES.length; i++) {
      var n = NOTES[i], hit = false;
      for (j = 0; j < n.on.length; j++) {
        if (saysWord(hay, n.on[j])) { hit = true; break; }
      }
      if (hit && n.all) {
        for (j = 0; j < n.all.length; j++) {
          if (!saysWord(hay, n.all[j])) { hit = false; break; }
        }
      }
      if (hit) { out.push(n); }
    }
    return out;
  }

  /* Nothing is ever hung on a post by a person.
   *
   * The research calls the false-positive accusation one of the funniest
   * things about this feature, and it is, right up until the post it lands
   * on is someone writing about their father dying at County General --
   * which is a real post on this site, and which the first version of this
   * matched twice, once for "written by a language model" and once for
   * "posted the same text under four place names".
   *
   * The joke survives without that. `promoted` is a real local business
   * writing its own opening hours, and accusing Carrow Wireless of being a
   * language model is the same joke with nobody's bereavement in it. */
  var NOTE_KIND_RATE = { bot: 0.30, spam: 0.34, promoted: 0.22, human: 0 };

  function noteFor(post, base) {
    var L = window.SYNTH.live;
    if (!L || !L.rng || !L.now) { return null; }

    var at = post.liveAt;
    if (typeof at !== 'number') {
      /* An authored 2026 post: its baked time, if it parses. */
      at = L.toMs ? L.toMs(post.time) : null;
      if (typeof at !== 'number') { return null; }
    }

    var r = L.rng(hash('note:' + txt(post.id, txt(post.handle)) + ':' + at));
    var rate = NOTE_KIND_RATE[post.kind || 'human'];
    if (rate === undefined) { rate = 0.05; }
    if (r() > rate) { return null; }

    /* Somewhere between two and twenty-six hours after the post. */
    var delay = (2 + r() * 24) * 3600000;
    var shownAt = at + delay;
    var pending = L.now() < shownAt;

    /* A pending note is the common case and is shown to nobody. Only a
     * fraction leak into view at all, as the "being rated" state. */
    if (pending && r() > 0.25) { return null; }

    /* Nothing here answers the post, so nothing is hung under it. That is
     * the truth about almost every post. */
    var bank = notesFor(post);
    if (!bank.length) { return null; }
    var row = bank[Math.floor(r() * bank.length) % bank.length];
    return { head: row.head, body: row.body, source: row.src,
             pending: pending, at: shownAt };
  }

  function noteNode(ctx, note) {
    var el = ctx.el;
    if (note.pending) {
      return el('div', { 'class': 'p-note is-pending' },
        el('div', { 'class': 'p-note-head' },
          'Readers have proposed a note on this post'),
        el('div', { 'class': 'p-note-body' },
          'It is being rated and is not shown to everyone.'));
    }
    /* The three ratings used to be spans. Asking a question and ignoring the
     * answer is the same lie as a nav item that goes nowhere, and the honest
     * version is one line long: the rating is taken, and then it waits, which
     * is what rating a note actually is. */
    var ask = el('div', { 'class': 'p-note-ask' }, 'Do you find this helpful?');

    function rate(label) {
      return el('button', {
        type: 'button', 'class': 'p-note-btn',
        onclick: function () {
          while (ask.firstChild) ask.removeChild(ask.firstChild);
          ask.setAttribute('class', 'p-note-ask is-rated');
          ask.appendChild(document.createTextNode(
            'Rated “' + label.toLowerCase() + '”. A note needs a few days ' +
            'of these before it is shown to everyone, or quietly dropped.'));
        }
      }, label);
    }

    ask.appendChild(rate('Yes'));
    ask.appendChild(rate('Somewhat'));
    ask.appendChild(rate('No'));

    return el('div', { 'class': 'p-note' },
      el('div', { 'class': 'p-note-head' }, note.head),
      el('div', { 'class': 'p-note-body' }, note.body),
      el('div', { 'class': 'p-note-src' }, note.source),
      ask);
  }

  function postNode(ctx, post, base, opts) {
    var el = ctx.el;
    opts = opts || {};
    var replyCount = arr(post.replies).length;

    /* A live post carries a real millisecond timestamp and is shown relative
     * ("6 min ago"); an authored one keeps its baked 2008 string. */
    var when = post.liveAt && window.SYNTH.live
      ? window.SYNTH.live.ago(post.liveAt)
      : stamp(post.time, base);

    var head = el('div', { 'class': 'p-head' },
      el('span', { 'class': 'p-name' },
        post.handle
          ? ctx.link('/user/' + encodeURIComponent(normHandle(post.handle)),
              txt(post.author, txt(post.handle, 'someone')))
          : txt(post.author, 'someone')),
      post.verified && window.SYNTH.liveui ? window.SYNTH.liveui.verifiedTick() : null,
      el('span', { 'class': 'p-handle' }, atHandle(post.handle)),
      kindBadge(ctx, post.kind),
      /* Where Follow shows up. Without this the button would store a row
       * nothing on the page ever read back, which is decor with a database
       * behind it. */
      (isNow(ctx) && post.handle && isFollowing('handle', handleKey(ctx, post.handle)))
        ? el('span', { 'class': 'p-following' }, 'following') : null,
      el('span', { 'class': 'p-dot' }, ' · '),
      post.liveAt
        ? el('span', { 'class': 'p-time lv-time' }, when)
        : ctx.link('/post/' + encodeURIComponent(txt(post.id)), when, 'p-time'));

    var actions = el('div', { 'class': 'p-actions' },
      el('span', { 'class': 'act' }, el('b', null, num(replyCount)), ' replies'),
      el('span', { 'class': 'act' }, el('b', null, num(post.reposts)), ' reposts'),
      el('span', { 'class': 'act' }, el('b', null, num(post.likes)), ' likes'),
      opts.single ? null : ctx.link('/post/' + encodeURIComponent(txt(post.id)), 'permalink', 'act permalink'));

    var rowKind = post.kind === 'promoted' ? ' lv-promoted-row'
                : (post.kind === 'bot' || post.kind === 'spam') ? ' lv-bot-row' : '';

    /* The note sits between the post and its counts, which is where it goes
     * on the real thing: under what it is correcting, above how far that
     * travelled. Only on 2026 sites -- a 2008 archive predates the idea. */
    var note = (ctx.site && String(ctx.site.era) === '2026')
      ? noteFor(post, base) : null;

    return el('div', { 'class': 'post' + (opts.single ? ' single' : '') + rowKind },
      el('div', { 'class': 'p-row' },
        avatar(el, post.avatarSeed, txt(post.author, post.handle)),
        el('div', { 'class': 'p-main' }, head, bodyNode(ctx, post.body),
          note ? noteNode(ctx, note) : null, actions)),
      replyBlock(ctx, post, base, !!opts.single));
  }


  /* ---------- the live layer ----------
   * pulse.gridfall.net is not a 2008 archive any more. Most of what arrives
   * on it now is automated, and this is where that arrives. See app/live.js:
   * posts are a pure function of the wall clock, so the feed has genuinely
   * moved on when you come back, with nothing stored anywhere.
   */

  function liveOn(ctx) {
    /* Only the microblog runs live. marla.verity.net is a personal page that
     * stopped updating in 2005, and bots posting into it would be nonsense. */
    return ctx.site && ctx.site.domain === 'pulse.gridfall.net' &&
           window.SYNTH.live && window.SYNTH.slop &&
           window.SYNTH.live.pool('socialPosts').length > 0;
  }

  function livePosts(ctx, count) {
    var L = window.SYNTH.live;
    /* One arrival every 4 minutes. Busy enough that a refresh usually shows
     * something new, slow enough that it is not a slot machine. */
    var slots = L.stream(ctx.site.domain, 'socialPosts', 4, count);
    return slots.map(function (s, i) {
      var item = s.item;
      var r = L.rng(s.seed);
      return {
        id: 'live-' + s.slot,
        author: item.author,
        handle: item.handle,
        avatarSeed: item.avatarSeed,
        kind: item.kind,
        verified: item.verified,
        body: item.body,
        /* Engagement grows while the post is up, so the top of the feed has
         * lower numbers than the posts below it -- which is what a real feed
         * looks like and is oddly the detail that sells it. */
        likes: Math.floor((item.likes || 0) * (0.25 + r() * 0.2) + i * (item.likes || 0) * 0.04),
        reposts: Math.floor((item.reposts || 0) * (0.3 + r() * 0.3) + i * (item.reposts || 0) * 0.03),
        replies: arr(item.replies),
        liveAt: s.at
      };
    });
  }

  function kindBadge(ctx, kind) {
    if (!window.SYNTH.liveui) return null;
    return window.SYNTH.liveui.badge(kind);
  }

  function adNode(ctx, slot, seed) {
    if (!window.SYNTH.liveui) return null;
    return window.SYNTH.liveui.ad(slot, seed);
  }

  /* ---------- the box at the top ----------
   *
   * What was here was a grey rectangle that looked like a text field and a
   * Post button that had been greyed out with no reason given. Three
   * outcomes now, and each of them is true of the site it is drawn on:
   *
   *   a running 2026 platform  -> the real composer, the same one the board
   *                               and the aggregator use. You post, bots
   *                               reply, the fame model does what it does.
   *   a one-account feed       -> no box, and the arithmetic that says why.
   *   a copy of a dead service -> no box, and what stopped, and when.
   */

  function composeInto(ctx, host) {
    var el = ctx.el;

    if (isNow(ctx) && !broadcast(ctx) &&
        window.SYNTH.compose && window.SYNTH.compose.box) {
      try {
        var box = window.SYNTH.compose.box(ctx, ctx.site.domain, function () {
          if (window.SYNTH.engine && window.SYNTH.engine.refresh) {
            window.SYNTH.engine.refresh();
          }
        });
        if (box) {
          host.appendChild(el('div', { 'class': 'sn-compose' },
            byApproval(ctx)
              ? el('div', { 'class': 'sn-compose-note' },
                  'Accounts on ' + ctx.site.domain + ' are approved one at a ' +
                  'time by the person who runs it. This one is on your device ' +
                  'and was not: what you write here is kept here.')
              : null,
            box));
          minePostsInto(ctx, host);
          return;
        }
      } catch (e) { /* fall through and say why instead */ }
    }

    host.appendChild(closedBox(ctx));
  }

  function minePostsInto(ctx, host) {
    var mine = [];
    if (!(window.SYNTH.me && typeof window.SYNTH.me.posts === 'function')) return;
    try { mine = window.SYNTH.me.posts(ctx.site.domain) || []; } catch (e) { return; }
    if (!mine.length) return;
    if (!(window.SYNTH.compose && window.SYNTH.compose.myPosts)) return;
    try {
      var node = window.SYNTH.compose.myPosts(ctx, ctx.site.domain);
      if (node) host.appendChild(ctx.el('div', { 'class': 'sn-mine' }, node));
    } catch (e) { /* the composer is optional */ }
  }

  function closedBox(ctx) {
    var el = ctx.el, p = profile(ctx), list = feed(ctx);

    if (isNow(ctx)) {
      var own = normHandle(p.handle), mine = 0, i;
      for (i = 0; i < list.length; i++) {
        if (normHandle(list[i].handle) === own) mine++;
      }
      return el('div', { 'class': 'sn-compose sn-closed' },
        el('div', { 'class': 'compose-label' }, 'There is no box here'),
        el('div', { 'class': 'sn-closed-note' },
          num(mine) + ' of the ' + num(list.length) + ' posts on this page were ' +
          'published by ' + atHandle(p.handle) + ' itself. This is a feed, not a ' +
          'conversation, and there is nowhere on it to write.' +
          (unmonitored(ctx)
            ? ' What it does with anything sent to it is in its own profile, ' +
              'where it says the account is not monitored.'
            : '')),
        accountLink(ctx, 'What you can do here'));
    }

    /* "Nothing has been added since" is false on a site the slop layer is
     * still posting into, and it was sitting two inches above a bot post
     * stamped three minutes ago. What stopped is the people. */
    var when = span(ctx), bots = liveOn(ctx);
    return el('div', { 'class': 'sn-compose sn-closed' },
      el('div', { 'class': 'compose-label' }, 'Posting closed'),
      el('div', { 'class': 'sn-closed-note' },
        (bots
          ? ('The last post by a person here is from ' + txt(when.to, eraOf(ctx)) +
             '. What still arrives is automated, and it arrives whether or not ' +
             'anybody is reading. ')
          : ('The last post here is from ' + txt(when.to, eraOf(ctx)) +
             ' and nothing has been added since. ')) +
        'The box that stood in this space wrote to ' + ctx.site.domain +
        '’s server. What was kept was the pages.'),
      accountLink(ctx, 'Why you cannot sign in'));
  }

  /* ---------- pages ---------- */

  function renderFeed(ctx) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var p = profile(ctx);
    ctx.title(txt(ctx.site.title, ctx.site.domain));

    mount.appendChild(topBar(ctx, null));

    var side = el('div', { 'class': 'sn-side' }, profileCard(ctx), friendsGrid(ctx));
    var main = el('div', { 'class': 'sn-main' });

    composeInto(ctx, main);

    /* Live arrivals sit above the archive, newest first, the way a feed
     * actually reads. Everything below the fold is the 2008 content that was
     * here before the bots. */
    var list = feed(ctx);
    var live = liveOn(ctx) ? livePosts(ctx, 22) : [];

    /* A story is not the slop layer and must not share its gate. liveOn() is
     * true only for pulse.gridfall.net -- marla.verity.net stopped updating
     * in 2005 and bots posting into it would be nonsense -- but shoutbox.live
     * is a live 2026 platform that simply has its own authored feed, and a
     * county-wide story reaches it whether or not the bots do. */
    var L2 = window.SYNTH.live;
    if (L2 && L2.story && String(ctx.site.era) === '2026') {
      var sv = L2.story(ctx.site);
      if (sv) {
        live = [{
          id: 'story-' + sv.storyId,
          author: sv.item.byline || sv.item.author,
          handle: sv.item.handle,
          avatarSeed: sv.item.handle,
          kind: sv.item.kind,
          verified: false,
          /* Headline first, then the post. A social post has no title
           * field, so taking only the body meant a story row here said
           * "a county records request turns up the file. Original: ..."
           * and never once named what the file was about -- the same bug
           * the wire had, found the same way, by asserting on the page
           * rather than on the absence of an error. */
          body: (sv.item.title ? sv.item.title + '\n\n' : '') + sv.item.body,
          likes: sv.item.likes,
          reposts: sv.item.reposts,
          replies: [],
          liveAt: sv.at
        }].concat(live);
      }
    }

    if (live.length) {
      main.insertBefore(window.SYNTH.liveui.onlineBar(ctx.site.domain, 900, 14000),
                        main.firstChild);
      var newCount = 0;
      var L = window.SYNTH.live;
      /* "since you last looked" used to mean "in the last fifteen minutes",
       * which is not what those words mean and was the same number whether
       * you had been away ten seconds or ten days. engine.js now records the
       * real last visit per domain on every navigation; fall back to the old
       * window only when storage has nothing yet (a first visit). */
      var since = (window.SYNTH.alerts && typeof window.SYNTH.alerts.lastVisit === 'function')
        ? window.SYNTH.alerts.lastVisit(ctx.site.domain)
        : 0;
      if (!since) since = L.now() - 15 * 60000;
      for (var n = 0; n < live.length; n++) {
        if (live[n].liveAt > since) newCount++;
      }
      if (newCount) {
        main.appendChild(el('div', { 'class': 'sn-newbar' },
          newCount + ' new post' + (newCount === 1 ? '' : 's') + ' since you last looked'));
      }
    }

    if (!list.length && !live.length) {
      main.appendChild(el('div', { 'class': 'blank' }, 'Nothing here yet. Check back later.'));
    }

    live.forEach(function (post, i) {
      main.appendChild(postNode(ctx, post, base, {}));
      /* An ad every fifth slot. The seed moves with the post so the inventory
       * rotates with the feed rather than sitting still. */
      if (i % 5 === 4) {
        var ad = adNode(ctx, 'inline', ctx.site.domain + ':' + post.id);
        if (ad) main.appendChild(ad);
      }
    });

    if (live.length && list.length) {
      main.appendChild(el('div', { 'class': 'sn-divider' },
        'Older posts \u2014 before the migration'));
    }

    list.forEach(function (post) {
      main.appendChild(postNode(ctx, post, base, {}));
    });

    if (live.length) {
      side.appendChild(adNode(ctx, 'box', ctx.site.domain + ':side'));
    }

    mount.appendChild(el('div', { 'class': 'sn-layout' }, side, main));
    mount.appendChild(el('div', { 'class': 'sn-foot' },
      txt(ctx.site.description, '') + '  —  ' + txt(ctx.site.era, '')));
  }

  function renderUser(ctx, handle) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var p = profile(ctx);
    var want = normHandle(handle);
    var mine = normHandle(p.handle) === want;
    var posts = postsByHandle(ctx, want);
    /* The member list is counted off the posts, and most of the people in a
     * thread only ever turn up in the replies. A profile that 404s for them
     * would make the list a page of dead links, so replies count as being
     * here -- which is true of them, and is most of what a small board is. */
    var reps = repliesByHandle(ctx, want);
    var friend = friends(ctx).filter(function (f) { return normHandle(f.handle) === want; })[0];

    if (!mine && !posts.length && !reps.length && !friend) {
      return render404(ctx, 'That profile could not be found.');
    }

    var display = mine
      ? txt(p.displayName, txt(p.handle, want))
      : (posts.length ? txt(posts[0].author, want)
        : (reps.length ? txt(reps[0].reply.author, want)
          : (friend ? txt(friend.displayName, want) : want)));

    var seed = mine ? p.avatarSeed
      : (posts.length ? posts[0].avatarSeed
        : (reps.length ? reps[0].reply.avatarSeed
          : (friend ? friend.avatarSeed : want)));

    ctx.title(display + ' (' + atHandle(want) + ')');
    mount.appendChild(topBar(ctx, atHandle(want)));

    var head = el('div', { 'class': 'profile-head' },
      el('div', { 'class': 'ph-banner' }, ''),
      el('div', { 'class': 'ph-row' },
        avatar(el, seed, display, 'big'),
        el('div', { 'class': 'ph-id' },
          el('div', { 'class': 'pname' }, display),
          el('div', { 'class': 'phandle' }, atHandle(want)),
          mine && txt(p.bio) ? bioNode(ctx, p.bio) : null,
          el('div', { 'class': 'pcounts' },
            el('span', { 'class': 'pcount' },
              el('strong', null, num(mine ? p.following : 10 + (hash(want) % 240))), ' Following'),
            el('span', { 'class': 'pcount' },
              el('strong', null, num(mine ? p.followers : 4 + (hash(want + 'f') % 900))), ' Followers'),
            el('span', { 'class': 'pcount' },
              el('strong', null, num(posts.length)), ' Posts'),
            reps.length ? el('span', { 'class': 'pcount' },
              el('strong', null, num(reps.length)), ' Replies') : null)),
        /* "Edit Profile" was drawn here whenever the handle matched the
         * site's own account, which is not you and never was -- you are a
         * reader, and there is nothing of yours on this page to edit. It is
         * gone. What is here instead is the control that can be true: on a
         * running site, Follow; on a copy, the reason Follow is not. */
        userAction(ctx, want, mine)));

    var side = el('div', { 'class': 'sn-side' }, mine ? profileCard(ctx) : null, friendsGrid(ctx));
    var main = el('div', { 'class': 'sn-main' }, head);

    if (!posts.length && !reps.length) {
      main.appendChild(el('div', { 'class': 'blank' }, 'This user has not posted anything yet.'));
    }
    posts.forEach(function (post) { main.appendChild(postNode(ctx, post, base, {})); });

    if (reps.length) {
      main.appendChild(el('div', { 'class': 'sn-divider' },
        posts.length ? 'Replies elsewhere on this site'
                     : 'Nothing posted here. ' + num(reps.length) +
                       ' repl' + (reps.length === 1 ? 'y' : 'ies') + ' under other people’s posts.'));
      reps.slice(0, 40).forEach(function (row) {
        main.appendChild(el('div', { 'class': 'sn-replyrow' },
          el('div', { 'class': 'sn-replyon' },
            'under ',
            ctx.link('/post/' + encodeURIComponent(txt(row.post.id)),
              txt(row.post.author, txt(row.post.handle, 'a post')), 'sn-replylink'),
            el('span', { 'class': 'dim' }, ' · ' + stamp(row.reply.time, base))),
          replyNode(ctx, row.reply, base)));
      });
    }

    mount.appendChild(el('div', { 'class': 'sn-layout' }, side, main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  function userAction(ctx, want, mine) {
    if (!isNow(ctx)) return accountLink(ctx, 'Add to Friends');
    if (mine) {
      return followBtn(ctx, 'domain', ctx.site.domain, 'Follow', 'Following') ||
             accountLink(ctx, 'Follow');
    }
    return followBtn(ctx, 'handle', handleKey(ctx, want), 'Follow', 'Following') ||
           accountLink(ctx, 'Follow');
  }

  function renderPost(ctx, id) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var post = findPost(ctx, id);
    if (!post) return render404(ctx, 'That post has been deleted or never existed.');

    ctx.title(txt(post.author, 'post') + ' on ' + txt(ctx.site.title, ctx.site.domain));
    /* This strip says where you are. It used to say "Post", which is a word
     * readers press, and it sat one line under a nav bar of things that were
     * pressable -- so it read as an offer to write one. It is a label. It
     * now reads like one. */
    mount.appendChild(topBar(ctx, 'Single post'));

    var main = el('div', { 'class': 'sn-main' },
      el('div', { 'class': 'crumbline' },
        ctx.link('/', 'Feed'),
        el('span', { 'class': 'sepa' }, ' › '),
        el('span', { 'class': 'here' }, txt(post.author, 'post'))),
      postNode(ctx, post, base, { single: true }),
      el('div', { 'class': 'p-fulltime' }, 'Posted ' + txt(post.time, 'at some point')));

    mount.appendChild(el('div', { 'class': 'sn-layout' },
      el('div', { 'class': 'sn-side' }, profileCard(ctx), friendsGrid(ctx)),
      main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  /* ---------- /search ----------
   *
   * The nav item that started all of this. It can simply work: the posts,
   * the replies and everyone who wrote either are already on the page, and
   * reading them is the whole feature. What it will not do is pretend to
   * reach further than the page -- for that it hands you to the network's
   * own search, which is a different thing and is labelled as one.
   */

  function terms(q) {
    return String(q || '').toLowerCase().split(/\s+/).filter(function (t) { return !!t; });
  }

  function hits(hay, list) {
    var h = String(hay || '').toLowerCase(), i;
    for (i = 0; i < list.length; i++) {
      if (h.indexOf(list[i]) < 0) return false;
    }
    return true;
  }

  function searchSite(ctx, q) {
    var want = terms(q);
    var out = { posts: [], replies: [], people: [] };
    if (!want.length) return out;

    feed(ctx).forEach(function (post) {
      if (hits(plain(post.body) + ' ' + txt(post.author) + ' ' + txt(post.handle), want)) {
        out.posts.push(post);
      }
      arr(post.replies).forEach(function (r) {
        if (hits(plain(r.body) + ' ' + txt(r.author) + ' ' + txt(r.handle), want)) {
          out.replies.push({ post: post, reply: r });
        }
      });
    });
    census(ctx).forEach(function (m) {
      if (hits(m.handle + ' ' + m.name, want)) out.people.push(m);
    });
    return out;
  }

  function searchForm(ctx, q) {
    var el = ctx.el;
    var input = el('input', {
      type: 'text', name: 'q', 'class': 'sn-q', value: q,
      placeholder: 'Search ' + ctx.site.domain,
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false'
    });

    function go(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var v = String(input.value || '').trim();
      var url = 'synth://' + ctx.site.domain + '/search';
      if (v) url += '?q=' + encodeURIComponent(v);
      if (window.SYNTH.engine && window.SYNTH.engine.navigate) {
        window.SYNTH.engine.navigate(url);
      }
    }

    return el('form', { 'class': 'sn-searchform', onsubmit: go },
      input,
      el('button', { type: 'submit', 'class': 'btn' }, 'Search'));
  }

  function hitRow(ctx, href, who, when, body) {
    var el = ctx.el;
    return el('div', { 'class': 'sn-hit' },
      el('div', { 'class': 'sn-hit-head' },
        ctx.link(href, who, 'sn-hit-link'),
        el('span', { 'class': 'dim' }, when ? ' · ' + when : '')),
      el('div', { 'class': 'sn-hit-body' }, snippet(body, 160)));
  }

  function renderSearch(ctx) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var q = txt(ctx.query && ctx.query.q, '').replace(/\s+/g, ' ').trim();
    var when = span(ctx), posts = feed(ctx).length, reps = replyTotal(ctx);

    ctx.title(q ? ('Search: ' + q + ' — ' + txt(ctx.site.title, ctx.site.domain))
                : ('Search ' + txt(ctx.site.title, ctx.site.domain)));
    mount.appendChild(topBar(ctx, 'Search this site'));

    var main = el('div', { 'class': 'sn-main' },
      el('h2', { 'class': 'sn-pagehead' }, 'Search ' + ctx.site.domain),
      searchForm(ctx, q),
      el('p', { 'class': 'sn-lede' },
        'This reads what is on the page: ' + num(posts) + ' post' +
        (posts === 1 ? '' : 's') + ' and ' + num(reps) + ' repl' +
        (reps === 1 ? 'y' : 'ies') +
        (when.from ? (', ' + when.from + ' to ' + when.to) : '') + '. ' +
        (archived(ctx)
          ? 'The service’s own search went when the service did. This one ' +
            'is done here, in the page, over the copy that survived.'
          : 'It asks ' + ctx.site.domain + ' nothing, because nothing here ' +
            'is on a server to ask.')));

    /* The slop layer is a function of the clock and has no permalink, so a
     * result pointing at one would be a link to a page that does not exist.
     * It is left out, and left out on the page rather than quietly. */
    if (liveOn(ctx)) {
      main.appendChild(el('p', { 'class': 'sn-lede' },
        'What arrives from the automated accounts is not in this. It is ' +
        'posted continuously and none of it has an address to send you to.'));
    }

    var SD = (window.SYNTH.engine && window.SYNTH.engine.SEARCH_DOMAIN)
      ? window.SYNTH.engine.SEARCH_DOMAIN : '';

    if (!q) {
      main.appendChild(el('div', { 'class': 'blank' },
        'Type something above. Handles work too.'));
    } else {
      var found = searchSite(ctx, q);
      var total = found.posts.length + found.replies.length + found.people.length;

      main.appendChild(el('div', { 'class': 'sn-count' },
        total ? (num(total) + ' result' + (total === 1 ? '' : 's') + ' for “' + q + '”')
              : ('Nothing here says “' + q + '”.')));

      if (found.people.length) {
        main.appendChild(el('div', { 'class': 'sn-subhead' }, 'Accounts'));
        found.people.slice(0, 12).forEach(function (m) {
          main.appendChild(memberRow(ctx, m));
        });
      }

      if (found.posts.length) {
        main.appendChild(el('div', { 'class': 'sn-subhead' }, 'Posts'));
        found.posts.slice(0, 30).forEach(function (post) {
          main.appendChild(hitRow(ctx,
            '/post/' + encodeURIComponent(txt(post.id)),
            txt(post.author, txt(post.handle, 'someone')),
            stamp(post.time, base), post.body));
        });
      }

      if (found.replies.length) {
        main.appendChild(el('div', { 'class': 'sn-subhead' }, 'Replies'));
        found.replies.slice(0, 30).forEach(function (row) {
          main.appendChild(hitRow(ctx,
            '/post/' + encodeURIComponent(txt(row.post.id)),
            txt(row.reply.author, txt(row.reply.handle, 'someone')) +
              ' — under ' + txt(row.post.author, 'a post'),
            stamp(row.reply.time, base), row.reply.body));
        });
      }

      if (SD) {
        main.appendChild(el('div', { 'class': 'sn-elsewhere' },
          ctx.link('synth://' + SD + '/?q=' + encodeURIComponent(q),
            'Look for “' + q + '” on the rest of VerityNet'),
          el('div', { 'class': 'dim' },
            'A different search, over every site in this build rather than this one.')));
      }
    }

    mount.appendChild(el('div', { 'class': 'sn-layout' },
      el('div', { 'class': 'sn-side' }, profileCard(ctx)), main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  /* ---------- /members ---------- */

  function countLine(m) {
    var bits = [];
    if (m.posts) bits.push(num(m.posts) + ' post' + (m.posts === 1 ? '' : 's'));
    if (m.replies) bits.push(num(m.replies) + ' repl' + (m.replies === 1 ? 'y' : 'ies'));
    if (bits.length) return bits.join(' · ');
    /* Say which of the two reasons put a silent account on the list, rather
     * than "listed" -- which is the word a member list uses when it does not
     * want to be asked. */
    if (m.self) return 'the account the site is published under · nothing of its own here';
    if (m.friend) return 'in the friends list · has said nothing on these pages';
    return 'has said nothing on these pages';
  }

  function memberRow(ctx, m) {
    var el = ctx.el;
    var inner = el('span', { 'class': 'mrow' },
      avatar(el, m.seed, m.name),
      el('span', { 'class': 'mid' },
        el('span', { 'class': 'mname' }, m.name),
        el('span', { 'class': 'mhandle' }, atHandle(m.shown || m.handle)),
        el('span', { 'class': 'mcount' }, countLine(m))),
      (isNow(ctx) && isFollowing('handle', handleKey(ctx, m.handle)))
        ? el('span', { 'class': 'mfollow' }, 'following') : null);
    return ctx.link('/user/' + encodeURIComponent(m.handle), inner, 'mcell');
  }

  function renderMembers(ctx) {
    var el = ctx.el, mount = ctx.mount;
    var list = census(ctx), auto = 0, said = 0, i;

    for (i = 0; i < list.length; i++) {
      if (spoke(list[i])) said++;
      if (list[i].kind === 'bot' || list[i].kind === 'spam' ||
          list[i].kind === 'promoted') auto++;
    }
    var quiet = list.length - said;

    ctx.title('People on ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Members'));

    var main = el('div', { 'class': 'sn-main' },
      el('h2', { 'class': 'sn-pagehead' }, 'Everyone who has said something here'),
      el('p', { 'class': 'sn-lede' },
        'There is no member list on ' + ctx.site.domain + ' to hand out, so ' +
        'this one is counted off the page: ' + num(said) + ' account' +
        (said === 1 ? '' : 's') + ' appear in the posts and replies ' +
        'that are here. It is who has spoken, not who registered.' +
        (auto ? ' ' + num(auto) + ' of them post under a label that says ' +
                'the account is automated.' : '') +
        /* The friends in the sidebar and the site's own account are drawn on
         * these pages without having written on them. They stay on the list,
         * because a reader who clicked one of those faces has to be able to
         * land somewhere -- but they are counted apart from the people who
         * said something, and each row says which it is. */
        (quiet ? ' Below them, ' + num(quiet) + ' more account' +
                 (quiet === 1 ? ' is' : 's are') + ' drawn on this site ' +
                 'without having posted or replied here at all.' : '')));

    list.forEach(function (m) { main.appendChild(memberRow(ctx, m)); });

    mount.appendChild(el('div', { 'class': 'sn-layout' },
      el('div', { 'class': 'sn-side' }, profileCard(ctx)), main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  /* ---------- /account ----------
   *
   * Where Mail, Bulletins, Sign Out, Add to Friends and Send Message land.
   * None of the five can be built, and saying why is better than a button
   * that shrugs -- on the archive sites it is the thing that teaches you
   * what a saved copy is, and on the 2026 sites it is the platform's own
   * position, which it has already written down in its profile.
   */

  function line(ctx, s) { return ctx.el('p', { 'class': 'sn-say' }, s); }
  function sub(ctx, s) { return ctx.el('h3', { 'class': 'sn-subhead' }, s); }

  function stillWorks(ctx, main) {
    var el = ctx.el, posts = feed(ctx).length, reps = replyTotal(ctx);
    main.appendChild(sub(ctx, 'What does work'));
    main.appendChild(el('ul', { 'class': 'sn-list' },
      el('li', null, ctx.link('/', 'The feed'), ' — ' + num(posts) +
        ' post' + (posts === 1 ? '' : 's') + ' and ' + num(reps) + ' repl' +
        (reps === 1 ? 'y' : 'ies') + ', all of it readable without an account.'),
      el('li', null, ctx.link('/members', 'Everyone who posted'),
        ' — ' + num(spokeCount(ctx)) + ' accounts, counted off the posts.'),
      el('li', null, ctx.link('/search', 'Search'),
        ' — over those posts, done here in the page.')));
  }

  function renderAccount(ctx) {
    var el = ctx.el, mount = ctx.mount, p = profile(ctx);
    var who = atHandle(p.handle);

    ctx.title('Your account on ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Your account'));

    var main = el('div', { 'class': 'sn-main sn-prose' });

    if (archived(ctx)) {
      main.appendChild(el('h2', { 'class': 'sn-pagehead' },
        'There is nothing here to sign in to'));
      main.appendChild(line(ctx,
        'This is ' + ctx.site.domain + ' as it stood in ' + eraOf(ctx) +
        '. The pages were kept. The part of it that knew who you were was not.'));
      main.appendChild(line(ctx,
        'Mail, bulletins and friend requests were never pages. Each one was a ' +
        'question put to a server — who are you, who are your friends, what ' +
        'came in while you were out — and the answer was written for one ' +
        'person and nobody else. Nothing is answering. The three of them have ' +
        'nowhere to go, which is why they bring you here instead of opening a form.'));
      main.appendChild(line(ctx,
        'Sign Out is the one that gives it away. Nothing is signed in, so there ' +
        'is nothing to end. That bar was drawn for somebody with an account on ' +
        'this service, and it has been drawn for nobody since.'));
      stillWorks(ctx, main);
      main.appendChild(line(ctx,
        'All of it reads without an account, which was ordinary then and is not now.'));
    } else {
      main.appendChild(el('h2', { 'class': 'sn-pagehead' }, 'Your account'));

      var me = (window.SYNTH.me && typeof window.SYNTH.me.profile === 'function')
        ? window.SYNTH.me.profile() : null;
      main.appendChild(line(ctx, me && me.handle
        ? ('You are ' + atHandle(me.handle) + ' here. That account is kept in this ' +
           'browser and not on ' + ctx.site.domain + ': the same handle on every ' +
           'site in this build, and none of it has left the device.')
        : ('You do not have an account on this device yet. The sites that take ' +
           'posts offer you one at the top of the feed; this page is the rest ' +
           'of what the buttons in the bar above would have done.')));

      main.appendChild(sub(ctx, 'Messages'));
      main.appendChild(line(ctx, unmonitored(ctx)
        ? ('Anything sent to ' + who + ' arrives somewhere nobody looks. Its own ' +
           'profile says the account is not monitored and that replies are not ' +
           'read, which at least has the virtue of being written down.')
        : ('Messages to ' + who + ' go to whoever runs ' + ctx.site.domain +
           '. What that means in practice is in the profile, and it is worth ' +
           'reading before you write.')));
      /* Send Message brought you here, so this page owes you the rest of the
       * sentence: there is no form, and there is not going to be one. */
      main.appendChild(line(ctx,
        'There is no box on this page to write one in. Nothing in this copy ' +
        'reaches ' + ctx.site.domain + ', and a form that quietly wrote to ' +
        'your own browser instead would be a worse lie than the button that ' +
        'brought you here.'));
      if (p.handle) {
        main.appendChild(el('p', { 'class': 'sn-say' },
          ctx.link('/user/' + encodeURIComponent(normHandle(p.handle)),
            'Read the profile for ' + who)));
      }

      main.appendChild(sub(ctx, 'Following'));
      main.appendChild(line(ctx,
        'Follow is the control on this site that does something. It is stored in ' +
        'this browser, it marks the accounts you follow in the feed, and the ' +
        'Feeds panel counts what has arrived on a site since you last looked. ' +
        ctx.site.domain + ' is not told, because there is nobody there to tell.'));

      main.appendChild(sub(ctx, 'Signing out'));
      main.appendChild(line(ctx,
        'There is no session, so there is nothing to end. Your handle and your ' +
        'posts are in this browser’s storage and nowhere else, and the ' +
        'control panel is where they can be looked at or cleared.'));
      main.appendChild(el('p', { 'class': 'sn-say' },
        ctx.link('synth://control.verity.net/storage', 'Storage in the control panel')));

      stillWorks(ctx, main);
    }

    mount.appendChild(el('div', { 'class': 'sn-layout' },
      el('div', { 'class': 'sn-side' }, profileCard(ctx, true)), main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  function render404(ctx, msg) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title('Not Found :: ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Oops'));
    mount.appendChild(el('div', { 'class': 'err' },
      el('h2', null, 'Sorry! This page is not available.'),
      el('p', null, txt(msg, 'The link you followed may be broken, or the page may have been removed.')),
      el('p', null, ctx.link('/', 'Go back to the home feed'))));
  }

  /* ---------- entry point ---------- */

  function renderSocial(ctx) {
    var path = arr(ctx.path);
    if (!path.length) return renderFeed(ctx);
    if (path[0] === 'user' && path.length >= 2) return renderUser(ctx, path[1]);
    if (path[0] === 'post' && path.length >= 2) return renderPost(ctx, path[1]);
    if (path[0] === 'search') return renderSearch(ctx);
    if (path[0] === 'members') return renderMembers(ctx);
    if (path[0] === 'account') return renderAccount(ctx);
    return render404(ctx, 'We could not find that page.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('social', renderSocial);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['social', renderSocial]);
  }
}());
