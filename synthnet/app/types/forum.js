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
      h = (h * 16777619) >>> 0;
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
      'All times are local.');
  }

  /* ---------- index ---------- */


  /* ---------- the live layer ----------
   * These boards did not die, which would at least be dignified. They filled
   * up with automated accounts posting keyword salad at each other. New
   * threads arrive on the wall clock; see app/live.js.
   */

  function liveOn(ctx) {
    return window.SYNTH.live && window.SYNTH.slop &&
           arr(window.SYNTH.slop.forumTopics).length > 0;
  }

  function liveTopics(ctx, count) {
    var L = window.SYNTH.live;
    var all = arr(window.SYNTH.slop.forumTopics);

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
          ' \u00b7 ' + t.replies + ' replies \u00b7 ' + L.commas(t.views) + ' views')));
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
    var guests = 3 + ((h >> 4) % 22);
    var peak = 46 + ((h >> 9) % 180);
    var peakDate = DOW[(h >> 3) % 7] + ' ' + MON[(h >> 6) % 12] + ' ' +
      (1 + ((h >> 11) % 28)) + ', ' + txt(ctx.site.era, '2004') + ' ' +
      (1 + ((h >> 13) % 12)) + ':' + (10 + ((h >> 17) % 49)) + ' pm';

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
    var newest = names.length ? names[(h >> 7) % names.length] : 'lurker_01';

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

  function postNode(ctx, topic, post, globalIndex, page) {
    var el = ctx.el;
    var left = el('div', { 'class': 'post-author' },
      avatarBox(el, post.avatarSeed, post.author),
      el('div', { 'class': 'aname' }, txt(post.author, 'guest')),
      el('div', { 'class': 'atitle' }, txt(post.authorTitle, 'Member')),
      el('div', { 'class': 'ameta' }, 'Joined: ' + txt(post.authorJoined, '—')),
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

    if (pages > 1) mount.appendChild(pager(ctx, topic.id, page, pages, 'top'));

    var start = (page - 1) * PER_PAGE;
    var slice = posts.slice(start, start + PER_PAGE);

    if (!slice.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'There are no posts in this topic.'));
    }
    slice.forEach(function (p, i) {
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

  /* ---------- entry point ---------- */

  function renderForum(ctx) {
    var path = arr(ctx.path);
    if (!path.length) return renderIndex(ctx);
    if (path[0] === 'board' && path.length >= 2) return renderBoard(ctx, path[1]);
    if (path[0] === 'topic' && path.length >= 2) return renderTopic(ctx, path[1]);
    return render404(ctx, 'The page you requested could not be found on this board.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('forum', renderForum);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['forum', renderForum]);
  }
}());
