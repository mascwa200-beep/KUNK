/* SYNTHNET :: forum renderer
   paths: /  |  /board/<boardId>  |  /topic/<topicId>
   No modules, no innerHTML, no network. Everything hangs off window.SYNTH. */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  var PER_PAGE = 10;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /* ---------- small helpers ---------- */

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

  function tint(seed) {
    return 'hsl(' + (hash(seed) % 360) + ', 34%, 66%)';
  }

  function initials(name) {
    var clean = String(name == null ? '' : name).replace(/[^A-Za-z0-9 ]/g, ' ').trim();
    if (!clean) return '?';
    var parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function dat(ctx) { return (ctx.site && ctx.site.data) ? ctx.site.data : {}; }
  function cats(ctx) { return arr(dat(ctx).categories); }
  function topics(ctx) { return arr(dat(ctx).topics); }
  function txt(v, fallback) {
    var s = (v == null) ? '' : String(v);
    return s ? s : (fallback || '');
  }

  function allBoards(ctx) {
    var out = [];
    cats(ctx).forEach(function (cat) {
      arr(cat.boards).forEach(function (b) { out.push(b); });
    });
    return out;
  }

  function findBoard(ctx, id) {
    var list = allBoards(ctx), i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function findTopic(ctx, id) {
    var list = topics(ctx), i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function topicsOfBoard(ctx, boardId) {
    return topics(ctx).filter(function (t) { return String(t.boardId) === String(boardId); });
  }

  function lastPostOf(topic) {
    var posts = arr(topic.posts);
    if (!posts.length) return { author: topic.author, time: topic.time };
    return posts[posts.length - 1];
  }

  function avatarBox(el, seed, name, extra) {
    return el('div', {
      'class': 'avatar' + (extra ? ' ' + extra : ''),
      style: 'background:' + tint(txt(seed, name)) + ';'
    }, initials(name));
  }

  /* ---------- chrome ---------- */

  function crumb(ctx, trail) {
    var el = ctx.el, kids = [], i, step;
    for (i = 0; i < trail.length; i++) {
      if (i) kids.push(el('span', { 'class': 'sepa' }, ' » '));
      step = trail[i];
      kids.push(step.href
        ? ctx.link(step.href, step.label)
        : el('span', { 'class': 'here' }, step.label));
    }
    return el('div', { 'class': 'crumb' }, kids);
  }

  function header(ctx, trail) {
    var el = ctx.el, d = dat(ctx);
    var navItems = ['FAQ', 'Search', 'Memberlist', 'Usergroups', 'Register', 'Profile', 'Log in'];
    var nav = navItems.map(function (n) {
      return el('span', { 'class': 'navitem' }, n);
    });
    return [
      el('div', { 'class': 'fbanner' },
        el('h1', null, ctx.link('/', txt(d.boardName, txt(ctx.site.title, ctx.site.domain)), 'bannerlink')),
        el('div', { 'class': 'fdesc' }, txt(ctx.site.description, 'A discussion board')),
        el('div', { 'class': 'fnav' }, nav)),
      crumb(ctx, trail)
    ];
  }

  function footer(ctx) {
    var el = ctx.el;
    return el('div', { 'class': 'ffoot' },
      'Powered by a board script someone uploaded in ' + txt(ctx.site.era, '2003') + '. ' +
      'All times are local. ',
      ctx.link('/modlog', 'Moderation log', 'backlink'));
  }

  /* ---------- index ---------- */


  /* ---------- the live layer ----------
   * These boards did not die, which would at least be dignified. They filled
   * up with automated accounts posting keyword salad at each other. New
   * threads arrive on the wall clock; see app/live.js.
   */

  function liveOn(ctx) {
    return window.SYNTH.live && window.SYNTH.slop &&
           window.SYNTH.live.pool('forumTopics').length > 0;
  }

  function liveTopics(ctx, count) {
    var L = window.SYNTH.live;
    var all = L.pool('forumTopics');

    /* What arrives NOW is overwhelmingly automated -- that is the premise.
     * The human threads in the pool are the board's history, not its current
     * activity, so they are weighted down to roughly one in six rather than
     * excluded: a board with literally no humans left reads as a gimmick,
     * and one real person surfacing occasionally is what makes the rest
     * land. */
    var automated = [], human = [];
    for (var i = 0; i < all.length; i++) {
      (all[i].kind === 'human' ? human : automated).push(all[i]);
    }
    var pool = automated.length ? automated.concat(automated).concat(automated)
                                    .concat(automated).concat(automated).concat(human)
                                : all;
    /* Slower than the microblog: a board gets a new thread every 9 minutes,
     * and most of them are junk. */
    return L.stream('threads:' + ctx.site.domain, pool, 9, count).map(function (sl) {
      var t = sl.item, r = L.rng(sl.seed);
      return {
        id: 'live-' + sl.slot,
        title: t.title,
        author: t.author,
        kind: t.kind,
        replies: Math.floor((t.replies || 0) * (0.3 + r() * 0.8)),
        views: Math.floor((t.views || 0) * (0.3 + r() * 1.4)),
        at: sl.at
      };
    });
  }

  function liveTopicRows(ctx, count) {
    var el = ctx.el;
    if (!liveOn(ctx)) return null;
    var L = window.SYNTH.live;
    var rows = liveTopics(ctx, count);
    if (!rows.length) return null;

    var wrap = el('div', { 'class': 'lv-recent' });
    wrap.appendChild(el('div', { 'class': 'lv-recent-head' }, 'Active in the last hour'));
    rows.forEach(function (t) {
      wrap.appendChild(el('div', { 'class': 'lv-recent-row' },
        el('span', { 'class': 'lv-recent-title' }, t.title),
        window.SYNTH.liveui ? window.SYNTH.liveui.badge(t.kind) : null,
        el('span', { 'class': 'lv-recent-meta' },
          ' by ' + t.author + ' \u00b7 ' + L.ago(t.at) +
          ' \u00b7 ' + t.replies + (t.replies === 1 ? ' reply' : ' replies') +
          ' \u00b7 ' + L.commas(t.views) + ' views')));
    });
    return wrap;
  }

  function renderIndex(ctx) {
    var el = ctx.el, d = dat(ctx), mount = ctx.mount;
    var name = txt(d.boardName, txt(ctx.site.title, ctx.site.domain));
    ctx.title(name + ' :: Index');

    header(ctx, [{ label: 'Board index' }]).forEach(function (n) { mount.appendChild(n); });

    if (window.SYNTH.liveui) {
      mount.appendChild(window.SYNTH.liveui.onlineBar(ctx.site.domain, 60, 2400));
      var topBanner = window.SYNTH.liveui.ad('banner', ctx.site.domain + ':index');
      if (topBanner) mount.appendChild(topBanner);
    }
    var recent = liveTopicRows(ctx, 8);
    if (recent) mount.appendChild(recent);

    var list = cats(ctx);
    if (!list.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'There are no forums on this board yet.'));
    }

    list.forEach(function (cat) {
      var rows = [];
      arr(cat.boards).forEach(function (b, i) {
        var lp = b.lastPost || {};
        var lastCell;
        if (lp.time || lp.author) {
          lastCell = el('td', { 'class': 'col-last' },
            el('div', { 'class': 'lp-time' }, txt(lp.time)),
            el('div', { 'class': 'lp-by' }, lp.author ? 'by ' + lp.author : ''));
        } else {
          lastCell = el('td', { 'class': 'col-last dim' }, 'No posts');
        }
        rows.push(el('tr', { 'class': i % 2 ? 'alt' : '' },
          el('td', { 'class': 'col-icon' }, el('span', { 'class': 'ficon' }, '')),
          el('td', { 'class': 'col-forum' },
            el('div', { 'class': 'fboard-name' },
              ctx.link('/board/' + encodeURIComponent(txt(b.id)), txt(b.name, 'Untitled forum'))),
            el('div', { 'class': 'fboard-desc' }, txt(b.desc))),
          el('td', { 'class': 'col-num' }, num(b.topicCount)),
          el('td', { 'class': 'col-num' }, num(b.postCount)),
          lastCell));
      });

      mount.appendChild(el('div', { 'class': 'cat' },
        el('div', { 'class': 'cat-head' }, txt(cat.name, 'Forums')),
        el('table', { 'class': 'flist', cellspacing: '0', cellpadding: '0' },
          el('thead', null,
            el('tr', null,
              el('th', { 'class': 'col-icon' }, ''),
              el('th', { 'class': 'col-forum' }, 'Forum'),
              el('th', { 'class': 'col-num' }, 'Topics'),
              el('th', { 'class': 'col-num' }, 'Posts'),
              el('th', { 'class': 'col-last' }, 'Last Post'))),
          el('tbody', null, rows))));
    });

    /* stats, derived deterministically so the page never jitters */
    var h = hash(txt(ctx.site.domain, 'board'));
    var regs = 1 + (h % 7);
    var guests = 3 + ((h >>> 4) % 22);
    var peak = 46 + ((h >>> 9) % 180);
    var peakDate = DOW[(h >>> 3) % 7] + ' ' + MON[(h >>> 6) % 12] + ' ' +
      (1 + ((h >>> 11) % 28)) + ', ' + txt(ctx.site.era, '2004') + ' ' +
      (1 + ((h >>> 13) % 12)) + ':' + (10 + ((h >>> 17) % 49)) + ' pm';

    var authors = {}, postTotal = 0, topicTotal = 0;
    topics(ctx).forEach(function (t) {
      topicTotal++;
      if (t.author) authors[String(t.author)] = 1;
      arr(t.posts).forEach(function (p) {
        postTotal++;
        if (p.author) authors[String(p.author)] = 1;
      });
    });
    var declared = 0;
    allBoards(ctx).forEach(function (b) {
      var pc = parseInt(b.postCount, 10);
      if (isFinite(pc)) declared += pc;
    });
    if (declared > postTotal) postTotal = declared;
    var names = Object.keys(authors);
    var members = names.length + 12 + (h % 90);
    var newest = names.length ? names[(h >>> 7) % names.length] : 'lurker_01';

    mount.appendChild(el('div', { 'class': 'fbottom' },
      el('div', { 'class': 'fonline' },
        el('strong', null, 'Who is online'), ' — In total there are ' +
        num(regs + guests) + ' users online :: ' + num(regs) + ' registered, 0 hidden and ' +
        num(guests) + ' guests   [ Based on users active over the past 5 minutes ]'),
      el('div', { 'class': 'fonline dim' },
        'Most users ever online was ' + num(peak) + ' on ' + peakDate),
      el('div', { 'class': 'fstats' },
        'Our users have posted a total of ' + num(postTotal) + ' articles in ' +
        num(topicTotal) + ' topics • We have ' + num(members) +
        ' registered users • The newest registered user is ' +
        el('span', { 'class': 'uname' }, newest).textContent),
      el('div', { 'class': 'legend' },
        el('span', { 'class': 'ficon' }, ''), ' New posts   ',
        el('span', { 'class': 'ficon off' }, ''), ' No new posts   ',
        el('span', { 'class': 'ficon lock' }, ''), ' Forum is locked')));

    mount.appendChild(footer(ctx));
  }

  /* ---------- board ---------- */

  function renderBoard(ctx, boardId) {
    var el = ctx.el, mount = ctx.mount;
    var board = findBoard(ctx, boardId);
    if (!board) return render404(ctx, 'The forum you selected does not exist.');

    ctx.title(txt(board.name, 'Forum') + ' :: ' + txt(ctx.site.title, ctx.site.domain));
    header(ctx, [
      { label: 'Board index', href: '/' },
      { label: txt(board.name, 'Forum') }
    ]).forEach(function (n) { mount.appendChild(n); });

    mount.appendChild(el('div', { 'class': 'tbar' },
      el('span', { 'class': 'tbar-title' }, txt(board.name, 'Forum')),
      el('span', { 'class': 'tbar-sub' }, txt(board.desc))));

    var boardRecent = liveTopicRows(ctx, 6);
    if (boardRecent) mount.appendChild(boardRecent);
    if (window.SYNTH.liveui) {
      var bAd = window.SYNTH.liveui.ad('text', ctx.site.domain + ':' + boardId);
      if (bAd) mount.appendChild(bAd);
    }

    var list = topicsOfBoard(ctx, boardId).slice(0);
    list.sort(function (a, b) {
      var sa = a.sticky ? 0 : 1, sb = b.sticky ? 0 : 1;
      return sa - sb;
    });

    if (!list.length) {
      mount.appendChild(el('div', { 'class': 'blank' },
        'No topics or posts met your search criteria. This forum is empty.'));
      mount.appendChild(footer(ctx));
      return;
    }

    var rows = list.map(function (t, i) {
      var lp = lastPostOf(t);
      var flags = [];
      if (t.sticky) flags.push(el('span', { 'class': 'tflag sticky' }, 'Sticky:'));
      if (t.locked) flags.push(el('span', { 'class': 'tflag locked' }, 'Locked:'));
      var iconCls = 'ficon' + (t.locked ? ' lock' : (t.sticky ? ' pin' : ''));
      var replies = (t.replies == null && arr(t.posts).length)
        ? Math.max(0, arr(t.posts).length - 1) : t.replies;

      return el('tr', { 'class': (i % 2 ? 'alt' : '') + (t.sticky ? ' is-sticky' : '') },
        el('td', { 'class': 'col-icon' }, el('span', { 'class': iconCls }, '')),
        el('td', { 'class': 'col-topic' },
          el('div', { 'class': 'ttitle' }, flags,
            ctx.link('/topic/' + encodeURIComponent(txt(t.id)), txt(t.title, 'Untitled topic'))),
          el('div', { 'class': 'tmeta' },
            'by ' + txt(t.author, 'guest') + (t.time ? ' » ' + t.time : ''))),
        el('td', { 'class': 'col-author' }, txt(t.author, 'guest')),
        el('td', { 'class': 'col-num' }, num(replies)),
        el('td', { 'class': 'col-num' }, num(t.views)),
        el('td', { 'class': 'col-last' },
          el('div', { 'class': 'lp-time' }, txt(lp.time)),
          el('div', { 'class': 'lp-by' }, lp.author ? 'by ' + lp.author : '')));
    });

    mount.appendChild(el('table', { 'class': 'flist ftopics', cellspacing: '0', cellpadding: '0' },
      el('thead', null,
        el('tr', null,
          el('th', { 'class': 'col-icon' }, ''),
          el('th', { 'class': 'col-topic' }, 'Topics'),
          el('th', { 'class': 'col-author' }, 'Author'),
          el('th', { 'class': 'col-num' }, 'Replies'),
          el('th', { 'class': 'col-num' }, 'Views'),
          el('th', { 'class': 'col-last' }, 'Last Post'))),
      el('tbody', null, rows)));

    mount.appendChild(el('div', { 'class': 'boardfoot' },
      ctx.link('/', '« Board index', 'backlink'),
      el('span', { 'class': 'dim' }, '  Users browsing this forum: no registered users and ' +
        (1 + (hash(txt(board.id)) % 9)) + ' guests')));

    mount.appendChild(footer(ctx));
  }

  /* ---------- topic ---------- */

  function pager(ctx, topicId, page, pages, where) {
    var el = ctx.el, kids = [], i, href;
    kids.push(el('span', { 'class': 'pg-label' }, 'Goto page '));
    for (i = 1; i <= pages; i++) {
      href = '/topic/' + encodeURIComponent(String(topicId)) + '?page=' + i;
      if (i === page) kids.push(el('strong', { 'class': 'cur' }, String(i)));
      else kids.push(ctx.link(href, String(i)));
      if (i < pages) kids.push(el('span', { 'class': 'pg-sep' }, ', '));
    }
    if (page > 1) {
      kids.push(el('span', { 'class': 'pg-gap' }, '   '));
      kids.push(ctx.link('/topic/' + encodeURIComponent(String(topicId)) + '?page=' + (page - 1),
        '« Previous'));
    }
    if (page < pages) {
      kids.push(el('span', { 'class': 'pg-gap' }, '   '));
      kids.push(ctx.link('/topic/' + encodeURIComponent(String(topicId)) + '?page=' + (page + 1),
        'Next »'));
    }
    return el('div', { 'class': 'pager ' + (where || '') }, kids);
  }

  /* --- unread ------------------------------------------------------------
   *
   * "Jump to first unread" is the affordance that defines a forum. It is the
   * reason people could follow a 900-post thread for four years without
   * re-reading it, and it is the single most-cited thing people miss about
   * forums now that the conversation has moved to places that do not have
   * it. The engine records a real last-visit per domain (see app/alerts.js),
   * so this costs a timestamp comparison.
   *
   * On the archive boards nothing is ever newer than your last visit, so no
   * divider appears and nothing changes -- which is correct. It is the 2026
   * boards where it does any work.
   */
  function lastVisitOf(ctx) {
    if (!window.SYNTH.alerts || typeof window.SYNTH.alerts.lastVisit !== 'function') {
      return 0;
    }
    try { return window.SYNTH.alerts.lastVisit(ctx.site.domain) || 0; }
    catch (e) { return 0; }
  }

  function postTime(post) {
    var raw = post && post.time;
    if (typeof raw === 'number') return raw;
    if (!raw) return 0;
    var ms = Date.parse(String(raw));
    if (!isFinite(ms)) ms = Date.parse(String(raw).replace(' ', 'T'));
    return isFinite(ms) ? ms : 0;
  }

  /* Index of the first post newer than your last visit, or -1. */
  function firstUnread(posts, since) {
    if (!since) return -1;
    for (var i = 0; i < posts.length; i++) {
      if (postTime(posts[i]) > since) return i;
    }
    return -1;
  }

  function unreadDivider(el, count) {
    return el('div', {
      'class': 'unreadbar',
      id: 'first-unread'
    }, count === 1 ? 'New post since you last looked'
                   : count + ' new posts since you last looked');
  }

  /* --- who someone is on a forum -----------------------------------------
   *
   * Every forum that has ever existed computes a member's title from their
   * post count. This one did not: `authorTitle` is free text the content
   * author types, and the generator picks from a fixed list without ever
   * looking at `authorPosts` (app/grammar.js). The result was 352 posts
   * titled "Member", including one from an account with 4,106 posts.
   *
   * So a RANK is derived, and a ROLE is not. "Administrator", "Moderator",
   * "Site Admin" and the bot titles are given to someone by a person and
   * outrank anything arithmetic; the generic rungs are recomputed from the
   * number next to them, which is what a forum does.
   */
  var RANKS = [
    [0, 'Newly registered'],
    [10, 'Junior Member'],
    [50, 'Member'],
    [250, 'Senior Member'],
    [1000, 'Regular'],
    [5000, 'Lifer']
  ];

  /* Titles that are a job rather than a score. Matched case-insensitively
   * and kept exactly as the content wrote them. */
  var ROLE_TITLES = ['administrator', 'site admin', 'admin', 'moderator',
                     'mod', 'bot', 'automated listing assistant', 'staff',
                     'founder', 'banned'];

  function isRole(title) {
    var t = String(title || '').toLowerCase().trim();
    if (!t) { return false; }
    for (var i = 0; i < ROLE_TITLES.length; i++) {
      if (t === ROLE_TITLES[i]) { return true; }
    }
    /* "Automated listing assistant" and friends: anything that says what the
     * account is for rather than how much it has posted. */
    return t.indexOf('admin') >= 0 || t.indexOf('mod') >= 0 ||
           t.indexOf('bot') >= 0 || t.indexOf('automated') >= 0;
  }

  function rankFor(posts) {
    var n = (typeof posts === 'number') ? posts : parseInt(posts, 10);
    if (!isFinite(n) || n < 0) { n = 0; }
    var name = RANKS[0][1];
    for (var i = 0; i < RANKS.length; i++) {
      if (n >= RANKS[i][0]) { name = RANKS[i][1]; }
    }
    return name;
  }

  function titleFor(post) {
    if (isRole(post.authorTitle)) { return String(post.authorTitle); }
    return rankFor(post.authorPosts);
  }

  /* Trust, on the ladder every modern forum uses, from post count AND age
   * together -- which is the point of it. A thousand posts in a fortnight is
   * not the same account as a thousand posts over nine years, and a forum
   * that cannot tell them apart is one a spammer walks into. */
  function trustFor(post) {
    var L = window.SYNTH.live;
    var posts = (typeof post.authorPosts === 'number') ? post.authorPosts : 0;
    var joined = (L && L.toMs) ? L.toMs(post.authorJoined) : null;
    if (joined === null) { return null; }
    var years = ((L && L.now ? L.now() : Date.now()) - joined) / 31557600000;
    if (years < 0) { years = 0; }
    if (posts >= 500 && years >= 3) { return { n: 4, label: 'Trust level 4 — veteran' }; }
    if (posts >= 200 && years >= 1) { return { n: 3, label: 'Trust level 3 — regular' }; }
    if (posts >= 30 && years >= 0.25) { return { n: 2, label: 'Trust level 2 — member' }; }
    if (posts >= 5) { return { n: 1, label: 'Trust level 1 — basic' }; }
    return { n: 0, label: 'Trust level 0 — new' };
  }

  /* A join anniversary, but only where there is a date to have one on. More
   * than half the join strings in this network are "Mar 2017" with no day at
   * all, and inventing one so the slice could celebrate itself would be
   * making up a fact about a person. Those accounts get nothing. */
  function cakeYears(post) {
    var L = window.SYNTH.live;
    var joined = (L && L.toMs) ? L.toMs(post.authorJoined) : null;
    if (joined === null) { return 0; }
    return new Date(L.now()).getFullYear() - new Date(joined).getFullYear();
  }

  function isCakeDay(post) {
    var L = window.SYNTH.live;
    if (!L || !L.toMs || !L.toMsHasDay) { return false; }
    if (!L.toMsHasDay(post.authorJoined)) { return false; }
    var joined = L.toMs(post.authorJoined);
    if (joined === null) { return false; }
    var j = new Date(joined), t = new Date(L.now());
    if (j.getFullYear() >= t.getFullYear()) { return false; }
    return j.getMonth() === t.getMonth() && j.getDate() === t.getDate();
  }

  function postNode(ctx, topic, post, globalIndex, page) {
    var el = ctx.el;
    /* The thread starter, marked wherever they turn up further down it.
     * On a long thread this is the difference between reading an argument
     * and reading a person answering everybody in turn. */
    var isOp = !!post.author && !!topic.author &&
      String(post.author).toLowerCase() === String(topic.author).toLowerCase();

    var trust = trustFor(post);
    var cake = isCakeDay(post);

    var left = el('div', { 'class': 'post-author' },
      avatarBox(el, post.avatarSeed, post.author),
      el('div', { 'class': 'aname' },
        txt(post.author, 'guest'),
        isOp ? el('span', { 'class': 'optag', title: 'started this thread' },
          'OP') : null),
      el('div', { 'class': 'atitle' }, titleFor(post)),
      trust ? el('div', {
        'class': 'atrust atrust-' + trust.n,
        title: trust.label
      }, 'TL' + trust.n) : null,
      el('div', { 'class': 'ameta' },
        'Joined: ' + txt(post.authorJoined, '—'),
        cake ? el('span', {
          'class': 'cakeday',
          title: 'Joined on this day, ' + cakeYears(post) + ' years ago'
        }, '●') : null),
      el('div', { 'class': 'ameta' }, 'Posts: ' + num(post.authorPosts)));

    var body = el('div', { 'class': 'post-body' });
    var frag = ctx.markup(txt(post.body));
    if (frag) body.appendChild(frag);

    var main = el('div', { 'class': 'post-main' },
      el('div', { 'class': 'post-head' },
        el('span', { 'class': 'post-time' }, 'Posted: ' + txt(post.time, 'unknown')),
        ctx.link('/topic/' + encodeURIComponent(txt(topic.id)) + '?page=' + page,
          '#' + (globalIndex + 1), 'perma')),
      body);

    if (post.signature) {
      main.appendChild(el('div', { 'class': 'sep' }, ''));
      var sig = el('div', { 'class': 'sig' });
      var sfrag = ctx.markup(String(post.signature));
      if (sfrag) sig.appendChild(sfrag);
      main.appendChild(sig);
    }

    return el('div', { 'class': 'post' }, left, main);
  }

  function renderTopic(ctx, topicId) {
    var el = ctx.el, mount = ctx.mount;
    var topic = findTopic(ctx, topicId);
    if (!topic) return render404(ctx, 'The topic or post you requested does not exist.');

    var board = findBoard(ctx, topic.boardId);
    ctx.title(txt(topic.title, 'Topic') + ' :: ' + txt(ctx.site.title, ctx.site.domain));

    var trail = [{ label: 'Board index', href: '/' }];
    if (board) trail.push({ label: txt(board.name, 'Forum'), href: '/board/' + encodeURIComponent(txt(board.id)) });
    trail.push({ label: txt(topic.title, 'Topic') });
    header(ctx, trail).forEach(function (n) { mount.appendChild(n); });

    var posts = arr(topic.posts);
    var pages = Math.max(1, Math.ceil(posts.length / PER_PAGE));
    var page = parseInt(ctx.query && ctx.query.page, 10);
    if (!isFinite(page) || page < 1) page = 1;
    if (page > pages) page = pages;

    var flags = [];
    if (topic.sticky) flags.push(el('span', { 'class': 'tflag sticky' }, 'Sticky'));
    if (topic.locked) flags.push(el('span', { 'class': 'tflag locked' }, 'Locked'));

    mount.appendChild(el('div', { 'class': 'tbar' },
      el('span', { 'class': 'tbar-title' }, txt(topic.title, 'Topic')),
      el('span', { 'class': 'tbar-sub' }, flags,
        ' ' + num(posts.length) + ' post' + (posts.length === 1 ? '' : 's') +
        ' • ' + num(topic.views) + ' views')));

    if (topic.locked) {
      mount.appendChild(el('div', { 'class': 'lockednote' },
        'This topic is locked: you cannot edit posts or make replies.'));
    }

    /* Where you got to last time. */
    var since = lastVisitOf(ctx);
    var unreadAt = firstUnread(posts, since);
    var unreadCount = unreadAt === -1 ? 0 : posts.length - unreadAt;

    if (unreadCount) {
      var unreadPage = Math.floor(unreadAt / PER_PAGE) + 1;
      mount.appendChild(el('div', { 'class': 'unreadjump' },
        ctx.link('/topic/' + encodeURIComponent(txt(topic.id)) +
                 '?page=' + unreadPage + '#first-unread',
          'Jump to first unread post', 'jumplink'),
        el('span', { 'class': 'dim' },
          '  ' + num(unreadCount) + ' new since ' +
          (window.SYNTH.live && window.SYNTH.live.ago
            ? window.SYNTH.live.ago(since) : 'your last visit'))));
    }

    if (pages > 1) mount.appendChild(pager(ctx, topic.id, page, pages, 'top'));

    var start = (page - 1) * PER_PAGE;
    var slice = posts.slice(start, start + PER_PAGE);

    if (!slice.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'There are no posts in this topic.'));
    }
    slice.forEach(function (p, i) {
      /* The divider goes in the river at the exact post you had not seen,
       * rather than at the top of the page, which is the whole point of it. */
      if (unreadCount && start + i === unreadAt) {
        mount.appendChild(unreadDivider(el, unreadCount));
      }
      mount.appendChild(postNode(ctx, topic, p, start + i, page));
    });

    if (pages > 1) mount.appendChild(pager(ctx, topic.id, page, pages, 'bottom'));

    mount.appendChild(el('div', { 'class': 'boardfoot' },
      board
        ? ctx.link('/board/' + encodeURIComponent(txt(board.id)), '« ' + txt(board.name, 'Forum'), 'backlink')
        : ctx.link('/', '« Board index', 'backlink'),
      el('span', { 'class': 'dim' }, '  You cannot post new topics in this forum')));

    mount.appendChild(footer(ctx));
  }

  /* ---------- 404 ---------- */

  function render404(ctx, msg) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title('Information :: ' + txt(ctx.site.title, ctx.site.domain));
    header(ctx, [{ label: 'Board index', href: '/' }, { label: 'Information' }])
      .forEach(function (n) { mount.appendChild(n); });
    mount.appendChild(el('div', { 'class': 'err' },
      el('div', { 'class': 'err-head' }, 'Information'),
      el('div', { 'class': 'err-body' },
        el('p', null, txt(msg, 'The page you requested does not exist.')),
        el('p', null, ctx.link('/', 'Click here to return to the board index')))));
    mount.appendChild(footer(ctx));
  }

  /* --- the mod log --------------------------------------------------------
   *
   * Moderation on this network left no trace anywhere. Threads could be
   * locked and posts could be gone, and there was no record of who did it or
   * why -- which is the opposite of the thing forums argue about constantly.
   * A public log is the compromise every board eventually lands on: it does
   * not stop anyone being unfair, it just makes the unfairness legible.
   *
   * Derived from the clock like the wiki's revisions, so it accumulates
   * while you are away and is the same list twice at the same instant.
   */
  var MOD_ACTIONS = [
    ['locked', 'thread locked', 'going in circles'],
    ['locked', 'thread locked', 'answered, twice'],
    ['locked', 'thread locked', 'rule 3'],
    ['removed', 'post removed', 'rule 1'],
    ['removed', 'post removed', 'advertising'],
    ['removed', 'post removed', 'reposted from the other board, verbatim'],
    ['moved', 'thread moved', 'wrong board'],
    ['moved', 'thread moved', 'belongs in Off Topic'],
    ['warned', 'user warned', 'rule 2, second time'],
    ['banned', 'user banned, 7 days', 'rule 2, third time'],
    ['banned', 'user banned, permanent', 'the account was made this morning'],
    ['pinned', 'thread pinned', 'people keep asking'],
    ['unlocked', 'thread unlocked', 'on request. Behave.'],
    ['nothing', 'report dismissed', 'this is not against any rule'],
    ['nothing', 'report dismissed', 'I read the thread. It is fine.']
  ];

  /* Who moderates here, taken from the board's own staff rather than a
   * hardcoded name. An earlier version defaulted to mod_dcarver, who is
   * canon -- he pays the hosting on boards.gridfall.net out of pocket -- and
   * therefore exactly the wrong person to be banning people on a swap board
   * two domains over. The site already says who its staff are, in the title
   * next to every post they make. */
  function modsOf(d) {
    var seen = {}, out = [], i, j, topics = arr(d.topics);
    if (arr(d.moderators).length) { return arr(d.moderators); }
    for (i = 0; i < topics.length; i++) {
      var posts = arr(topics[i].posts);
      for (j = 0; j < posts.length; j++) {
        var p = posts[j];
        if (!p.author || seen[p.author]) { continue; }
        if (!isRole(p.authorTitle)) { continue; }
        /* A bot does not moderate; it is the thing being moderated. */
        var t = String(p.authorTitle).toLowerCase();
        if (t.indexOf('bot') >= 0 || t.indexOf('automated') >= 0) { continue; }
        seen[p.author] = 1;
        out.push(p.author);
      }
    }
    return out.length ? out : ['staff'];
  }

  function modLogRows(ctx, count) {
    var L = window.SYNTH.live;
    if (!L || !L.stream) { return []; }
    var d = dat(ctx);
    var mods = modsOf(d);

    var rows = L.stream('modlog:' + ctx.site.domain, MOD_ACTIONS, 220, count || 24);
    var out = [], i;
    for (i = 0; i < rows.length; i++) {
      var a = rows[i].item;
      if (!a) { continue; }
      out.push({
        at: rows[i].at,
        kind: a[0],
        what: a[1],
        why: a[2],
        by: mods[L.hash32('modby:' + rows[i].seed) % mods.length],
        /* A thread id if the content has one, so the entry points somewhere
         * real rather than at a number nobody can follow. */
        topic: pickTopic(d, rows[i].seed)
      });
    }
    return out;
  }

  function pickTopic(d, seed) {
    var L = window.SYNTH.live;
    var topics = arr(d.topics);
    if (!topics.length) { return null; }
    return topics[L.hash32('modtopic:' + seed) % topics.length];
  }

  function renderModLog(ctx) {
    var el = ctx.el, d = dat(ctx);
    ctx.title('Moderation log - ' + txt(ctx.site.title, ctx.site.domain));

    var mount = ctx.mount;
    header(ctx, [
      { label: 'Board index', href: '/' },
      { label: 'Moderation log' }
    ]).forEach(function (n) { mount.appendChild(n); });

    var wrap = el('div', { 'class': 'fwrap' });

    var head = el('div', { 'class': 'tbar' },
      el('span', { 'class': 'tbar-title' }, 'Moderation log'),
      el('span', { 'class': 'tbar-sub' },
        'Public since 2009. Every action, and the reason given at the time. ' +
        'Appeals go to the contact address and are read eventually.'));
    wrap.appendChild(head);

    var rows = modLogRows(ctx, 24);
    var list = el('div', { 'class': 'modlog' });
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var line = el('div', { 'class': 'modlog-row modlog-' + r.kind });
      line.appendChild(el('span', {
        'class': 'modlog-when',
        'data-lv-ago': String(r.at)
      }, window.SYNTH.live.ago(r.at)));
      line.appendChild(el('span', { 'class': 'modlog-what' }, r.what));
      if (r.topic) {
        line.appendChild(el('span', { 'class': 'modlog-target' },
          ctx.link('/topic/' + encodeURIComponent(txt(r.topic.id)),
            txt(r.topic.title, 'a thread'), 'modlog-link')));
      }
      line.appendChild(el('span', { 'class': 'modlog-by' }, 'by ' + r.by));
      line.appendChild(el('span', { 'class': 'modlog-why' }, '“' + r.why + '”'));
      list.appendChild(line);
    }
    wrap.appendChild(list);

    if (!rows.length) {
      wrap.appendChild(el('p', { 'class': 'blank' },
        'Nothing has been actioned recently. This is either a quiet week or ' +
        'nobody is reading the reports.'));
    }

    wrap.appendChild(el('div', { 'class': 'boardfoot' },
      ctx.link('/', 'Board index', 'backlink')));
    ctx.mount.appendChild(wrap);
  }

  /* ---------- entry point ---------- */

  function renderForum(ctx) {
    var path = arr(ctx.path);
    if (!path.length) return renderIndex(ctx);
    if (path[0] === 'board' && path.length >= 2) return renderBoard(ctx, path[1]);
    if (path[0] === 'topic' && path.length >= 2) return renderTopic(ctx, path[1]);
    if (path[0] === 'modlog') return renderModLog(ctx);
    return render404(ctx, 'The page you requested could not be found on this board.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('forum', renderForum);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['forum', renderForum]);
  }
}());
