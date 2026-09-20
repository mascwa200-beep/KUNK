/* SYNTHNET :: social renderer
   paths: /  |  /user/<handle>  |  /post/<postId>
   No modules, no innerHTML, no network. Everything hangs off window.SYNTH. */
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

  /* ---------- chrome ---------- */

  function topBar(ctx, here) {
    var el = ctx.el, p = profile(ctx);
    return el('div', { 'class': 'sn-top' },
      el('div', { 'class': 'sn-brand' },
        ctx.link('/', txt(ctx.site.title, ctx.site.domain), 'brandlink')),
      el('div', { 'class': 'sn-nav' },
        ctx.link('/', 'Home'),
        p.handle ? ctx.link('/user/' + encodeURIComponent(normHandle(p.handle)), 'My Profile') : null,
        el('span', { 'class': 'navitem' }, 'Mail'),
        el('span', { 'class': 'navitem' }, 'Bulletins'),
        el('span', { 'class': 'navitem' }, 'Search'),
        el('span', { 'class': 'navitem' }, 'Sign Out')),
      here ? el('div', { 'class': 'sn-here' }, here) : null);
  }

  /* ---------- profile card ---------- */

  function profileCard(ctx) {
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
      el('div', { 'class': 'pactions' },
        el('span', { 'class': 'btn' }, 'Add to Friends'),
        el('span', { 'class': 'btn' }, 'Send Message')));
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
    return el('div', { 'class': 'friends' },
      el('div', { 'class': 'friends-head' },
        txt(profile(ctx).displayName, 'This user') + "'s Top " + top.length + ' Friends',
        el('span', { 'class': 'fcountall' }, ' (' + num(list.length) + ' total)')),
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
    { on: ['kestrel', 'diner'],
      head: 'Readers added context',
      body: 'The Blue Kestrel diner closed in 1977 after a kitchen fire, ' +
            'not in 2006. The 2006 date is when the building was last sold.',
      src: 'Sources: kestrel-journal.net' },
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
    return el('div', { 'class': 'p-note' },
      el('div', { 'class': 'p-note-head' }, note.head),
      el('div', { 'class': 'p-note-body' }, note.body),
      el('div', { 'class': 'p-note-src' }, note.source),
      el('div', { 'class': 'p-note-ask' },
        'Do you find this helpful?',
        el('span', { 'class': 'p-note-btn' }, 'Yes'),
        el('span', { 'class': 'p-note-btn' }, 'Somewhat'),
        el('span', { 'class': 'p-note-btn' }, 'No')));
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

  /* ---------- pages ---------- */

  function renderFeed(ctx) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var p = profile(ctx);
    ctx.title(txt(ctx.site.title, ctx.site.domain));

    mount.appendChild(topBar(ctx, null));

    var side = el('div', { 'class': 'sn-side' }, profileCard(ctx), friendsGrid(ctx));
    var main = el('div', { 'class': 'sn-main' });

    main.appendChild(el('div', { 'class': 'sn-compose' },
      el('div', { 'class': 'compose-label' }, 'What are you doing right now?'),
      el('div', { 'class': 'compose-box' }, ''),
      el('span', { 'class': 'btn dis' }, 'Post')));

    /* Live arrivals sit above the archive, newest first, the way a feed
     * actually reads. Everything below the fold is the 2008 content that was
     * here before the bots. */
    var list = feed(ctx);
    var live = liveOn(ctx) ? livePosts(ctx, 22) : [];

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

    if (!mine && !posts.length) {
      var known = friends(ctx).filter(function (f) { return normHandle(f.handle) === want; });
      if (!known.length) return render404(ctx, 'That profile could not be found.');
    }

    var display = mine
      ? txt(p.displayName, txt(p.handle, want))
      : (posts.length ? txt(posts[0].author, want) : (function () {
          var f = friends(ctx).filter(function (x) { return normHandle(x.handle) === want; })[0];
          return f ? txt(f.displayName, want) : want;
        }()));

    var seed = mine ? p.avatarSeed : (posts.length ? posts[0].avatarSeed : want);

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
              el('strong', null, num(posts.length)), ' Posts'))),
        el('span', { 'class': 'btn' }, mine ? 'Edit Profile' : 'Add to Friends')));

    var side = el('div', { 'class': 'sn-side' }, mine ? profileCard(ctx) : null, friendsGrid(ctx));
    var main = el('div', { 'class': 'sn-main' }, head);

    if (!posts.length) {
      main.appendChild(el('div', { 'class': 'blank' }, 'This user has not posted anything yet.'));
    }
    posts.forEach(function (post) { main.appendChild(postNode(ctx, post, base, {})); });

    mount.appendChild(el('div', { 'class': 'sn-layout' }, side, main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  function renderPost(ctx, id) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var post = findPost(ctx, id);
    if (!post) return render404(ctx, 'That post has been deleted or never existed.');

    ctx.title(txt(post.author, 'post') + ' on ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Post'));

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
    return render404(ctx, 'We could not find that page.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('social', renderSocial);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['social', renderSocial]);
  }
}());
