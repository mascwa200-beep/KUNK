/* SYNTHNET :: forum renderer
   paths: /  |  /board/<boardId>  |  /topic/<topicId>  |  /modlog
          /faq  |  /search  |  /members  |  /members/<name>  |  /account/<what>
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

  /* How old the board is, taken from the era string the site declares.
     "2009-2016" is a board that ran for seven years and stopped, so the
     number that matters is the last one in it, not the first. */
  function eraYear(ctx) {
    var s = String((ctx.site && ctx.site.era) || ''), re = /\d{4}/g, m, last = 0;
    while ((m = re.exec(s)) !== null) { last = parseInt(m[0], 10); }
    return last || 2026;
  }

  function isModern(ctx) { return eraYear(ctx) >= 2017; }

  /* Post bodies carry inline markup. Anywhere a body is quoted as a plain
     string -- a search snippet, a member's last line -- the tags have to come
     off, or "[b]" ships to the screen as text, which is its own bug class. */
  function plain(s, max) {
    var t = String(s == null ? '' : s);
    t = t.replace(/\[url=[^\]]*\]/gi, '');
    t = t.replace(/\[img:[^\]]*\]/gi, '');
    t = t.replace(/\[quote=[^\]]*\]/gi, '');
    t = t.replace(/\[\/?[A-Za-z*][^\]]*\]/g, '');
    t = t.replace(/\{\{[^}]*\}\}/g, '');
    t = t.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (max && t.length > max) { t = t.substring(0, max - 1) + '…'; }
    return t;
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

  /* --- the nav bar -------------------------------------------------------
   *
   * Seven words sat across the top of every page of eight boards for a year
   * -- FAQ, Search, Memberlist, Usergroups, Register, Profile, Log in --
   * drawn as spans, 252 of them, and not one did anything. A nav item is a
   * claim about what a site IS. A board with a memberlist is a board with
   * members; a board with Register is a board you can join. Both claims were
   * empty on every board on this network.
   *
   * Four of them are now built out of what the board already knows: the
   * memberlist is the people posting in the threads, usergroups is what the
   * titles beside their names say, search reads the same topics the pages
   * read, and the FAQ is assembled from the board's own counters and its own
   * rules thread.
   *
   * The other three tell the truth instead, and the truth is different on
   * every board. Registration on boards.gridfall.net closed in 2017 and has
   * not reopened; the rail forum's was never closed and has had nobody
   * behind it since the branch line went in 2008; oldswap went read-only on
   * a date it announced in advance.
   * The dead nav item becomes the thing that teaches you the board is
   * frozen, which is more than a working sign-up form would have done.
   */
  function navSpec(ctx) {
    var modern = isModern(ctx);
    return [
      { label: 'FAQ', href: '/faq' },
      { label: 'Search', href: '/search' },
      { label: modern ? 'Members' : 'Memberlist', href: '/members' },
      { label: modern ? 'Groups' : 'Usergroups', href: '/members?view=groups' },
      { label: 'Register', href: '/account/register' },
      { label: 'Profile', href: '/account/profile' },
      { label: modern ? 'Sign in' : 'Log in', href: '/account/login' }
    ];
  }

  function header(ctx, trail) {
    var el = ctx.el, d = dat(ctx);
    var nav = navSpec(ctx).map(function (n) {
      return ctx.link(n.href, n.label, 'navitem');
    });
    return [
      el('div', { 'class': 'fbanner' },
        el('h1', null, ctx.link('/', txt(d.boardName, txt(ctx.site.title, ctx.site.domain)), 'bannerlink')),
        el('div', { 'class': 'fdesc' }, txt(ctx.site.description, 'A discussion board')),
        el('div', { 'class': 'fnav' }, nav)),
      crumb(ctx, trail)
    ];
  }

  /* When the board started taking posts, which is NOT the same question as
     what decade the board looks like.

     `era` is the skin vintage. Twenty-odd places across app/ read it to pick
     a layout, so it cannot be quietly reinterpreted as a founding date -- and
     for two boards it is not one. gridfallswap.net is skinned 2026 and its
     own description says "Started in 2017"; sdrlisteners.org is skinned 2026
     and says "running since 2004". Both printed 2026 in the footer, on the
     same page as the sentence contradicting it.

     So: an optional `since` when the two differ, and the era otherwise. The
     era can be a range -- oldswap ran 2009-2016 -- and "a board script
     someone uploaded in 2009-2016" is not a sentence. The script was
     uploaded once, at the start, which is the first year in the range. */
  function foundedIn(ctx) {
    return yearIn(ctx.site && ctx.site.since) ||
           yearIn(ctx.site && ctx.site.era) || 2003;
  }

  function footer(ctx) {
    var el = ctx.el;
    return el('div', { 'class': 'ffoot' },
      'Powered by a board script someone uploaded in ' +
      String(foundedIn(ctx)) + '. ' +
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
    /* The story layer: stream() rows in, stream() rows out. A story reaching
     * a forum is a thread somebody started about it, which is what a forum
     * does with news. See app/live.js. */
    var rows = L.withStory(
      L.stream('threads:' + ctx.site.domain, pool, 9, count), ctx.site);
    return rows.map(function (sl) {
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
    /* eraYear(), not the era string. The era can be a range, and dropping it
       into a date printed "Most users ever online was 118 on Mon Apr 2,
       2009-2016 9:50 pm" on oldswap -- a date with a span where the year
       goes. Same fault as the footer year, four hundred lines apart, and
       neither was caught by anything.

       The LAST year of the range here, where the footer wants the first: a
       board's busiest night is late in its life, and the script that runs it
       went up at the start. One field, two ends, two call sites. */
    var peakDate = DOW[(h >>> 3) % 7] + ' ' + MON[(h >>> 6) % 12] + ' ' +
      (1 + ((h >>> 11) % 28)) + ', ' + String(eraYear(ctx)) + ' ' +
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
    /* A board only carries the handful of threads somebody wrote out; the
       rest of it is the number in the index row. The totals line has to
       agree with the column above it or the page argues with itself -- and
       it did: gridfallswap's Off Topic row read 604 topics while the line
       under it said "101,900 articles in 21 topics", because posts were
       corrected against the declared counts and topics were not. Both, or
       neither. */
    var claimedPosts = 0, claimedTopics = 0;
    allBoards(ctx).forEach(function (b) {
      var pc = parseInt(b.postCount, 10);
      if (isFinite(pc)) claimedPosts += pc;
      var tc = parseInt(b.topicCount, 10);
      if (isFinite(tc)) claimedTopics += tc;
    });
    if (claimedPosts > postTotal) postTotal = claimedPosts;
    if (claimedTopics > topicTotal) topicTotal = claimedTopics;
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
      /* `1 + hash % 9` is 1 on one board in nine, so one board in nine read
         "no registered users and 1 guests". */
      el('span', { 'class': 'dim' }, (function () {
        var g = 1 + (hash(txt(board.id)) % 9);
        return '  Users browsing this forum: no registered users and ' +
               g + (g === 1 ? ' guest' : ' guests');
      }()))));

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

  /* ======================================================================
   * THE NAV ITEMS, BUILT
   *
   * Everything below this line exists because of the seven spans in
   * header(). Four of the seven are features; three are explanations. None
   * of them needed anything the board did not already have.
   * ==================================================================== */

  function sec(el, heading) { return el('h2', { 'class': 'fsec' }, heading); }

  function para(el, kids) { return el('p', { 'class': 'fpara' }, kids); }

  function panel(ctx, heading, kids) {
    return ctx.el('div', { 'class': 'fpanel' }, sec(ctx.el, heading), kids);
  }

  /* Banner, breadcrumb, title bar: the chrome every page of a board wears,
     so a page that is not a thread still looks like it belongs to it. */
  function shell(ctx, crumbLabel, heading, sub) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title(heading + ' :: ' + txt(ctx.site.title, ctx.site.domain));
    header(ctx, [{ label: 'Board index', href: '/' }, { label: crumbLabel }])
      .forEach(function (n) { mount.appendChild(n); });
    var wrap = el('div', { 'class': 'fwrap' });
    wrap.appendChild(el('div', { 'class': 'tbar' },
      el('span', { 'class': 'tbar-title' }, heading),
      sub ? el('span', { 'class': 'tbar-sub' }, sub) : null));
    mount.appendChild(wrap);
    return wrap;
  }

  function closeOut(ctx, wrap) {
    wrap.appendChild(ctx.el('div', { 'class': 'boardfoot' },
      ctx.link('/', '« Board index', 'backlink')));
    ctx.mount.appendChild(footer(ctx));
  }

  function topicLink(ctx, topic, cls) {
    return ctx.link('/topic/' + encodeURIComponent(txt(topic.id)),
      txt(topic.title, 'a thread'), cls || null);
  }

  /* Every board on this network has a thread that is its rules, and every
     one of them calls it something different. */
  var RULES_RE = /rule|read (this|it|the|first|before)|guideline|etiquette|how this board works|faq/i;
  var CLOSING_RE = /clos(e|es|ed|ing)/i;

  function topicMatching(ctx, re) {
    var list = topics(ctx), i, best = null, t;
    for (i = 0; i < list.length; i++) {
      t = list[i];
      if (!re.test(String(t.title || ''))) { continue; }
      if (!best || (t.sticky && !best.sticky)) { best = t; }
    }
    return best;
  }

  /* The years actually written on the board, which is a better answer than
     the era field. boards.gridfall.net is dated 2004 and carries join dates
     from 2001; a FAQ that said "running since 2004" would be contradicted by
     the third row of its own memberlist. */
  function yearIn(v) {
    var m = /(19|20)\d{2}/.exec(String(v == null ? '' : v));
    return m ? parseInt(m[0], 10) : 0;
  }

  function dateSpan(ctx) {
    var list = topics(ctx), lo = 0, hi = 0, i, j;

    function note(v) {
      var y = yearIn(v);
      if (!y || y < 1990 || y > 2100) { return; }
      if (!lo || y < lo) { lo = y; }
      if (y > hi) { hi = y; }
    }

    for (i = 0; i < list.length; i++) {
      note(list[i].time);
      var posts = arr(list[i].posts);
      for (j = 0; j < posts.length; j++) {
        note(posts[j].time);
        note(posts[j].authorJoined);
      }
    }
    return { from: lo, to: hi };
  }

  function boardNumbers(ctx) {
    var boards = allBoards(ctx), served = topics(ctx), i, n;
    var out = { cats: cats(ctx).length, boards: boards.length,
                claimedTopics: 0, claimedPosts: 0,
                topics: served.length, posts: 0 };
    for (i = 0; i < boards.length; i++) {
      n = parseInt(boards[i].topicCount, 10);
      if (isFinite(n)) { out.claimedTopics += n; }
      n = parseInt(boards[i].postCount, 10);
      if (isFinite(n)) { out.claimedPosts += n; }
    }
    for (i = 0; i < served.length; i++) { out.posts += arr(served[i].posts).length; }
    return out;
  }

  /* --- who is on a board -------------------------------------------------
   *
   * A memberlist is not a table somebody has to write. It is the people in
   * the threads: their name, the title beside it, the number the board puts
   * under that, the date they joined and the last thing they said. All five
   * are already on every post. The list was always derivable; nobody had
   * derived it.
   */
  function memberIndex(ctx) {
    var list = topics(ctx), out = [], by = {}, i, j;

    function rec(name) {
      var key = String(name).toLowerCase();
      if (!by[key]) {
        by[key] = { name: String(name), title: '', posts: 0, joined: '',
                    here: 0, started: 0, seed: '', last: null };
        out.push(by[key]);
      }
      return by[key];
    }

    for (i = 0; i < list.length; i++) {
      var t = list[i];
      if (t.author) { rec(t.author).started++; }
      var posts = arr(t.posts);
      for (j = 0; j < posts.length; j++) {
        var p = posts[j];
        if (!p.author) { continue; }
        var m = rec(p.author);
        m.here++;
        if (!m.title && p.authorTitle) { m.title = String(p.authorTitle); }
        if (!m.joined && p.authorJoined) { m.joined = String(p.authorJoined); }
        if (!m.seed && p.avatarSeed) { m.seed = String(p.avatarSeed); }
        var n = parseInt(p.authorPosts, 10);
        if (isFinite(n) && n > m.posts) { m.posts = n; }
        m.last = { topic: t, time: txt(p.time), body: txt(p.body),
                   page: Math.floor(j / PER_PAGE) + 1 };
      }
    }

    out.sort(function (a, b) {
      if (b.posts !== a.posts) { return b.posts - a.posts; }
      if (b.here !== a.here) { return b.here - a.here; }
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    });
    return out;
  }

  function findMember(ctx, name) {
    var list = memberIndex(ctx), want = String(name || '').toLowerCase(), i;
    for (i = 0; i < list.length; i++) {
      if (list[i].name.toLowerCase() === want) { return list[i]; }
    }
    return null;
  }

  /* Groups, on a board, are the titles. Nothing else about an account is
     visible from outside, and inventing a permissions table the content
     never wrote would be making one up. */
  var GROUP_ORDER = ['Administrators', 'Moderators', 'Automated accounts',
                     'Members', 'Banned'];

  function groupOf(member) {
    var t = String(member.title || '').toLowerCase();
    if (t.indexOf('bot') >= 0 || t.indexOf('automated') >= 0) { return 'Automated accounts'; }
    if (t === 'banned') { return 'Banned'; }
    if (t.indexOf('admin') >= 0 || t.indexOf('founder') >= 0) { return 'Administrators'; }
    if (t.indexOf('mod') >= 0) { return 'Moderators'; }
    return 'Members';
  }

  function memberLink(ctx, member, cls) {
    return ctx.link('/members/' + encodeURIComponent(member.name), member.name, cls || null);
  }

  /* Staff, for the FAQ. Not modsOf(): that one counts any role title, and a
     role title includes "Banned", which put a banned account for a fake
     coupon site on oldswap's list of the people who run the board. */
  function staffNames(ctx) {
    var d = dat(ctx);
    if (arr(d.moderators).length) { return arr(d.moderators).slice(0); }
    var list = memberIndex(ctx), out = [], i, g;
    for (i = 0; i < list.length; i++) {
      g = groupOf(list[i]);
      if (g === 'Administrators' || g === 'Moderators') { out.push(list[i].name); }
    }
    return out;
  }

  /* --- what the board will and will not let you do ------------------------
   *
   * The three account nav items. There is no honest way to make Register
   * work: nothing here has a server, and more to the point most of these
   * boards would not take you if it did. boards.gridfall.net shut its
   * sign-up in 2017 and never reopened it; oldswap announced a date and went
   * read-only on it; the rail forum was never closed and has simply had
   * nobody behind it for years. So the pages say which of those is true
   * here, which is a thing worth knowing and was not written down anywhere
   * else on the board.
   */
  function accountState(ctx) {
    var d = String(ctx.site.domain || '').toLowerCase();
    if (d === 'boards.gridfall.net') { return 'closed2017'; }
    if (d === 'forums.verityrail.org') { return 'left'; }
    if (d === 'oldswap.gridfall.net') { return 'readonly'; }
    var desc = String(ctx.site.description || '').toLowerCase();
    if (desc.indexOf('archived') >= 0 || desc.indexOf('read only') >= 0 ||
        desc.indexOf('read-only') >= 0 || desc.indexOf('closed') >= 0) { return 'readonly'; }
    if (!isModern(ctx)) { return 'stopped'; }
    return 'open';
  }

  function joinAnswer(ctx) {
    var state = accountState(ctx);
    if (state === 'closed2017') { return 'No. Registration closed in 2017 and has not reopened.'; }
    if (state === 'left') { return 'The form is still there. There is nobody behind it.'; }
    if (state === 'readonly') { return 'No. The board is read-only, and everything on it stays readable.'; }
    if (state === 'stopped') { return 'Not any more. Nothing has been posted here in a long time.'; }
    return 'Members post and guests read. You are reading.';
  }

  function joinParas(ctx) {
    var el = ctx.el, state = accountState(ctx), out = [];
    var rules = topicMatching(ctx, RULES_RE);

    if (state === 'closed2017') {
      out.push(para(el, 'Registration closed in 2017 and has not reopened. A spam run ' +
        'put 44,000 messages on the board in nine days, and shutting the sign-up form ' +
        'was the thing that stopped it.'));
      out.push(para(el, 'It has stayed shut for nine years. The accounts that existed ' +
        'before it still work and about six of them still post; nobody has been given ' +
        'a new one since.'));
      out.push(para(el, 'Dale Carver, who signs his posts mod_dcarver, moderates the ' +
        'board on his own and pays the $11 a month it costs to keep it where it is. ' +
        'He has paid it every month since. Reopening the form would mean doing the ' +
        'spam again, and he has said no every time he has been asked.'));
    } else if (state === 'left') {
      out.push(para(el, 'Nobody closed registration on this board. The line closed ' +
        'instead. The last revenue freight ran the Marchfield to Coyne Flats branch ' +
        'on 14 March 2008, the farewell thread ran to 400 replies, and the board went ' +
        'quiet in stages over about the eighteen months after that.'));
      out.push(para(el, 'The last post here by a person is from 2013. The last post of ' +
        'any kind is a spam bump from 2024. The sign-up form is still sitting on the ' +
        'server with everything else and there is nobody on the other end of it.'));
      out.push(para(el, 'It has never been deleted and there is no sign anyone means to ' +
        'delete it. It is not broken. It is finished, which is a different thing and ' +
        'reads the same from here.'));
    } else if (state === 'readonly') {
      var closing = topicMatching(ctx, CLOSING_RE);
      out.push(para(el, [
        'Registration and posting are closed. ',
        closing ? 'The thread that announced it is still up: ' : '',
        closing ? topicLink(ctx, closing) : null,
        closing ? '.' : ''
      ]));
      out.push(para(el, 'Nothing was deleted when it shut, which was the whole argument ' +
        'for shutting it this way rather than turning it off: every listing is exactly ' +
        'where the person who wrote it left it.'));
      if (String(ctx.site.domain).toLowerCase() === 'oldswap.gridfall.net') {
        out.push(para(el, ['The board people use for this now is ',
          ctx.link('synth://gridfallswap.net/', 'gridfallswap.net'), '.']));
      }
    } else if (state === 'stopped') {
      out.push(para(el, 'The sign-up form is still on this board. Nothing behind it has ' +
        'run in years, and nothing new has been posted here in about as long.'));
    } else {
      out.push(para(el, 'Nobody has closed registration here. This is a small board and ' +
        'signing up happens on the board itself, the way it always did.'));
      out.push(para(el, 'Reading needs nothing. Every forum, every thread, the ' +
        'memberlist and the moderation log are open to whoever turns up, which is most ' +
        'of what anybody ever wanted from a board anyway.'));
    }

    if (rules) {
      out.push(para(el, ['Either way, the thread to read first is ',
        topicLink(ctx, rules), '.']));
    }
    return out;
  }

  function signInParas(ctx) {
    var el = ctx.el, state = accountState(ctx), out = [];

    if (state === 'closed2017') {
      out.push(para(el, ['The login still works for accounts that already exist. There ' +
        'is no way to get one: see ', ctx.link('/account/register', 'Registration'), '.']));
    } else if (state === 'left') {
      out.push(para(el, 'The login still works in the sense that the software still ' +
        'offers it. The last person to use it posted in 2013.'));
    } else if (state === 'readonly') {
      out.push(para(el, 'Nothing has signed in here since the board went read-only, ' +
        'including the people who ran it. Read-only means everybody.'));
    } else if (state === 'stopped') {
      out.push(para(el, 'There is a login. There has been nobody to talk to behind it ' +
        'for a very long time.'));
    } else {
      out.push(para(el, 'Members sign in on the board. Guests read, which is what you ' +
        'are doing, and it is the larger half of what this board is for.'));
    }

    out.push(para(el, 'This browser reads boards; it does not sign in to them and it ' +
      'cannot post. That is the same reason every thread here ends with the line ' +
      'about not being able to reply.'));
    return out;
  }

  /* --- the one thing on these pages that is yours ------------------------
   *
   * A guest has no profile on a board. What does exist is the record this
   * browser keeps: when you last had the place open, and whether you want to
   * hear about it. That timestamp is not decorative -- it is what puts "Jump
   * to first unread post" at the top of a thread that has moved. See
   * app/alerts.js.
   */
  var LEVEL_HELP = {
    muted: 'never mention this board again',
    normal: 'counted, but nothing is announced',
    tracking: 'counted, and listed in the digest',
    watching: 'tell me every time it posts'
  };

  function watchRow(ctx) {
    var el = ctx.el, A = window.SYNTH.alerts;
    if (!A || typeof A.levelFor !== 'function' || !arr(A.LEVELS).length) { return null; }
    var domain = ctx.site.domain;
    var current;
    try { current = A.levelFor('domain', domain); } catch (e) { return null; }

    var row = el('div', { 'class': 'fwatch' });
    A.LEVELS.forEach(function (level) {
      row.appendChild(el('button', {
        type: 'button',
        'class': 'fwatch-btn' + (level === current ? ' is-on' : ''),
        title: LEVEL_HELP[level] || level,
        onclick: function (ev) {
          if (ev && ev.preventDefault) { ev.preventDefault(); }
          var p;
          try {
            p = (level === 'normal') ? A.unsubscribe('domain', domain)
                                     : A.subscribe('domain', domain, level);
          } catch (e2) { p = null; }
          Promise.resolve(p).then(function () {
            if (window.SYNTH.engine && window.SYNTH.engine.refresh) {
              window.SYNTH.engine.refresh();
            }
          });
        }
      }, level));
    });
    return el('div', { 'class': 'fwatch-wrap' }, row,
      el('div', { 'class': 'dim fwatch-now' },
        'Currently: ' + current + ' — ' + (LEVEL_HELP[current] || '')));
  }

  /* ---------- FAQ ---------- */

  function ageLine(ctx) {
    var span = dateSpan(ctx);
    if (span.from && span.to && span.to > span.from) {
      return 'The oldest date written on these pages is ' + span.from +
        ' and the newest is ' + span.to + '.';
    }
    if (span.from) {
      return 'Everything on these pages is dated ' + span.from + '.';
    }
    return 'Nothing on these pages carries a date, which is unusual and not ' +
      'a good sign.';
  }

  function renderFaq(ctx) {
    var el = ctx.el, n = boardNumbers(ctx);
    var wrap = shell(ctx, 'Board FAQ', 'Frequently asked questions',
      'Answered from what is on this board, not from the manual its software shipped with.');

    var counts;
    if (n.claimedTopics > n.topics) {
      counts = n.boards + (n.boards === 1 ? ' forum in ' : ' forums in ') + n.cats +
        (n.cats === 1 ? ' category. ' : ' categories. ') +
        'The counters on the index add up to ' + num(n.claimedTopics) + ' topics and ' +
        num(n.claimedPosts) + ' posts. ' + num(n.topics) +
        (n.topics === 1 ? ' topic opens' : ' topics open') + ' from here, carrying ' +
        num(n.posts) + ' posts between them; the rest are further back than anything ' +
        'still links to.';
    } else {
      counts = n.boards + (n.boards === 1 ? ' forum in ' : ' forums in ') + n.cats +
        (n.cats === 1 ? ' category, ' : ' categories, ') + num(n.topics) + ' topics and ' +
        num(n.posts) + ' posts.';
    }

    /* Not a "what this board is" panel: the line under the banner on every
       page of the site already says that, and repeating it two inches lower
       is how a FAQ starts being the thing nobody reads. */
    wrap.appendChild(panel(ctx, 'How big this board is', [
      para(el, counts),
      para(el, ageLine(ctx))
    ]));

    var rules = topicMatching(ctx, RULES_RE);
    wrap.appendChild(panel(ctx, 'Can I post here?', [
      para(el, joinAnswer(ctx)),
      para(el, ['The long version is on ',
        ctx.link('/account/register', 'the registration page'), '.']),
      rules ? para(el, ['The rules, as the board wrote them: ',
        topicLink(ctx, rules), '.']) : null
    ]));

    var mods = staffNames(ctx);
    var modLine = mods.length
      ? ('Accounts carrying a staff title here: ' + mods.join(', ') + '.')
      : 'Nobody on the threads that are left carries a staff title.';
    var extraMod = null;
    var dom = String(ctx.site.domain).toLowerCase();
    if (dom === 'boards.gridfall.net') {
      extraMod = 'One person moderates it now. Dale Carver deletes the overnight spam ' +
        'with his coffee, which takes him about forty minutes, and pays the $11 a ' +
        'month the board costs.';
    } else if (dom === 'forums.verityrail.org') {
      extraMod = 'None of them have logged in for years. Nothing has been moderated ' +
        'here since the board went quiet, including the spam.';
    } else if (dom === 'trailusers.verity.net') {
      extraMod = 'The parks department account nominally runs the board. Its last post ' +
        'was a mowing notice in November 2023.';
    }
    wrap.appendChild(panel(ctx, 'Who runs it', [
      para(el, modLine),
      extraMod ? para(el, extraMod) : null,
      para(el, ['Everything they have done that a reader can see is in the ',
        ctx.link('/modlog', 'moderation log'), ', with the reason given at the time.'])
    ]));

    wrap.appendChild(panel(ctx, 'What the little squares mean', [
      el('div', { 'class': 'legend' },
        el('span', { 'class': 'ficon' }, ''), ' New posts   ',
        el('span', { 'class': 'ficon off' }, ''), ' No new posts   ',
        el('span', { 'class': 'ficon lock' }, ''), ' Forum is locked'),
      para(el, 'A locked thread can still be read. Locking is how a thread ends on a ' +
        'board rather than how it is removed.')
    ]));

    wrap.appendChild(panel(ctx, 'Finding something', [
      para(el, ['There is a ', ctx.link('/search', 'search over this board'),
        ' that reads the threads themselves, and a ',
        ctx.link('/members', 'list of everybody who posts on it'), '.']),
      para(el, 'Thread pages remember where you got to. If a thread has moved since ' +
        'you last had it open, a link to the first post you have not read appears at ' +
        'the top of it.')
    ]));

    closeOut(ctx, wrap);
  }

  /* ---------- search ----------
   *
   * The board's own threads, read the way the pages read them. It is not the
   * network index at search.verity.net and should not pretend to be: this
   * one finds the post, on the page it is on, on this board.
   */
  function searchForm(ctx, q) {
    var el = ctx.el;
    var input = el('input', {
      type: 'text', name: 'q', value: txt(q), autocomplete: 'off',
      'class': 'fsearch-input', 'aria-label': 'Words to look for on this board'
    });
    var go = function (ev) {
      if (ev && ev.preventDefault) { ev.preventDefault(); }
      var v = String(input.value || '').replace(/^\s+|\s+$/g, '');
      var url = 'synth://' + ctx.site.domain + '/search' +
        (v ? ('?q=' + encodeURIComponent(v)) : '');
      if (window.SYNTH.engine && window.SYNTH.engine.navigate) {
        window.SYNTH.engine.navigate(url);
      }
    };
    return el('form', { 'class': 'fsearch', onsubmit: go },
      input,
      el('button', { type: 'submit', 'class': 'fsearch-go' }, 'Search'));
  }

  function termsOf(q) {
    var raw = String(q || '').toLowerCase().split(/\s+/), out = [], i;
    for (i = 0; i < raw.length; i++) {
      if (raw[i]) { out.push(raw[i]); }
    }
    return out;
  }

  function matchesAll(hay, terms) {
    var i;
    for (i = 0; i < terms.length; i++) {
      if (hay.indexOf(terms[i]) === -1) { return false; }
    }
    return true;
  }

  function snippetAround(body, terms) {
    var flat = plain(body), low = flat.toLowerCase(), at = -1, i, p;
    for (i = 0; i < terms.length; i++) {
      p = low.indexOf(terms[i]);
      if (p !== -1 && (at === -1 || p < at)) { at = p; }
    }
    if (at === -1) { return flat.length > 160 ? flat.substring(0, 159) + '…' : flat; }
    var start = Math.max(0, at - 60);
    var out = flat.substring(start, start + 170);
    if (start > 0) { out = '…' + out; }
    if (start + 170 < flat.length) { out = out + '…'; }
    return out;
  }

  function searchBoard(ctx, terms) {
    var list = topics(ctx), hits = { topics: [], posts: [] }, i, j;
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      var head = (txt(t.title) + ' ' + txt(t.author)).toLowerCase();
      if (matchesAll(head, terms) && hits.topics.length < 40) {
        hits.topics.push(t);
      }
      var posts = arr(t.posts);
      for (j = 0; j < posts.length; j++) {
        if (hits.posts.length >= 60) { break; }
        var p = posts[j];
        var hay = (plain(p.body) + ' ' + txt(p.author)).toLowerCase();
        if (!matchesAll(hay, terms)) { continue; }
        hits.posts.push({ topic: t, post: p, page: Math.floor(j / PER_PAGE) + 1,
                          index: j });
      }
    }
    return hits;
  }

  function renderSearch(ctx) {
    var el = ctx.el;
    var q = txt(ctx.query && ctx.query.q);
    var n = boardNumbers(ctx);
    var wrap = shell(ctx, 'Search this board', 'Search this board',
      'Reads the ' + num(n.topics) + ' topics and ' + num(n.posts) +
      ' posts this board serves, titles and bodies both.');

    wrap.appendChild(searchForm(ctx, q));

    var terms = termsOf(q);
    if (!terms.length) {
      wrap.appendChild(el('div', { 'class': 'blank' },
        'Type a word. Names work as well as subjects: most of what people look ' +
        'for on a board is who said it.'));
      closeOut(ctx, wrap);
      return;
    }

    var hits = searchBoard(ctx, terms);
    var total = hits.topics.length + hits.posts.length;
    /* The query comes back out onto the page, so it goes through the same
       stripper a post body does. A search for "[b]" is not a reason to print
       markup at a reader. */
    var shown = plain(q, 48) || '—';

    wrap.appendChild(el('div', { 'class': 'fhit-count' },
      total === 0
        ? ('Nothing on this board matches ' + shown + '.')
        : (num(hits.topics.length) +
           (hits.topics.length === 1 ? ' topic title and ' : ' topic titles and ') +
           num(hits.posts.length) +
           (hits.posts.length === 1 ? ' post match ' : ' posts match ') + shown + '.')));

    if (hits.topics.length) {
      wrap.appendChild(sec(el, 'Topics'));
      hits.topics.forEach(function (t) {
        var b = findBoard(ctx, t.boardId);
        wrap.appendChild(el('div', { 'class': 'fhit' },
          el('div', { 'class': 'ttitle' }, topicLink(ctx, t)),
          el('div', { 'class': 'tmeta' },
            'by ' + txt(t.author, 'guest') +
            (b ? ' in ' + txt(b.name, 'a forum') : '') +
            (t.time ? ' » ' + t.time : ''))));
      });
    }

    if (hits.posts.length) {
      wrap.appendChild(sec(el, 'Posts'));
      hits.posts.forEach(function (h) {
        wrap.appendChild(el('div', { 'class': 'fhit' },
          el('div', { 'class': 'ttitle' },
            ctx.link('/topic/' + encodeURIComponent(txt(h.topic.id)) +
              '?page=' + h.page, txt(h.topic.title, 'a thread'))),
          el('div', { 'class': 'tmeta' },
            'post #' + (h.index + 1) + ' by ' + txt(h.post.author, 'guest') +
            (h.post.time ? ' » ' + h.post.time : '')),
          el('div', { 'class': 'fhit-snip' }, snippetAround(h.post.body, terms))));
      });
    }

    if (!total) {
      wrap.appendChild(el('p', { 'class': 'fpara' },
        'The whole of this board is ' + num(n.topics) + ' topics. If the thread you ' +
        'want was on it once, it may be behind one of the counters on the index that ' +
        'nothing links to any more.'));
    }

    closeOut(ctx, wrap);
  }

  /* ---------- memberlist, groups, one member ---------- */

  function memberRow(ctx, m, i) {
    var el = ctx.el;
    return el('tr', { 'class': i % 2 ? 'alt' : '' },
      el('td', { 'class': 'col-icon' }, avatarBox(el, m.seed, m.name, 'tiny')),
      el('td', { 'class': 'col-forum' },
        el('div', { 'class': 'fboard-name' }, memberLink(ctx, m)),
        el('div', { 'class': 'fboard-desc' },
          (m.title ? m.title : rankFor(m.posts)) +
          (m.joined ? ' · joined ' + m.joined : '') +
          (m.started ? ' · started ' + num(m.started) +
            (m.started === 1 ? ' thread here' : ' threads here') : ''))),
      el('td', { 'class': 'col-num' }, num(m.posts)),
      /* Joined is on the line under the name rather than in this column,
         because this column is the one both old skins drop on a phone and a
         join date is half of what a memberlist row means. */
      el('td', { 'class': 'col-last' },
        el('div', { 'class': 'lp-time' },
          m.last && m.last.time ? 'Last post ' + m.last.time : '')));
  }

  function renderMembers(ctx) {
    var el = ctx.el;
    var list = memberIndex(ctx);
    var groups = String((ctx.query && ctx.query.view) || '') === 'groups';

    var wrap = shell(ctx,
      groups ? (isModern(ctx) ? 'Groups' : 'Usergroups')
             : (isModern(ctx) ? 'Members' : 'Memberlist'),
      groups ? (isModern(ctx) ? 'Groups' : 'Usergroups')
             : (isModern(ctx) ? 'Members' : 'Memberlist'),
      groups
        ? 'What the titles beside the names add up to.'
        : 'Everybody who has said anything on the pages this board still serves.');

    if (!list.length) {
      wrap.appendChild(el('div', { 'class': 'blank' },
        'Nobody has posted here, which makes this the shortest memberlist on the network.'));
      closeOut(ctx, wrap);
      return;
    }

    if (groups) {
      var buckets = {}, order = [], i, g;
      for (i = 0; i < list.length; i++) {
        g = groupOf(list[i]);
        if (!buckets[g]) { buckets[g] = []; }
        buckets[g].push(list[i]);
      }
      for (i = 0; i < GROUP_ORDER.length; i++) {
        if (buckets[GROUP_ORDER[i]]) { order.push(GROUP_ORDER[i]); }
      }
      wrap.appendChild(el('p', { 'class': 'fpara' },
        'A board has no way to show you a group from the outside except the title it ' +
        'prints beside a name. These are those titles, sorted. An account calling ' +
        'itself a member is taken at its word here, which is how a board takes it too.'));
      order.forEach(function (name) {
        var people = buckets[name], kids = [], k;
        for (k = 0; k < people.length; k++) {
          if (k) { kids.push(el('span', { 'class': 'sepa' }, ', ')); }
          kids.push(memberLink(ctx, people[k]));
        }
        wrap.appendChild(el('div', { 'class': 'fgroup' },
          el('h3', { 'class': 'fgroup-head' },
            name + ' (' + num(people.length) + ')'),
          el('div', { 'class': 'fgroup-body' }, kids)));
      });
      closeOut(ctx, wrap);
      return;
    }

    var rows = list.map(function (m, i) { return memberRow(ctx, m, i); });
    wrap.appendChild(el('table', { 'class': 'flist fmembers', cellspacing: '0', cellpadding: '0' },
      el('thead', null,
        el('tr', null,
          el('th', { 'class': 'col-icon' }, ''),
          el('th', { 'class': 'col-forum' }, 'Username'),
          el('th', { 'class': 'col-num' }, 'Posts'),
          el('th', { 'class': 'col-last' }, 'Last post'))),
      el('tbody', null, rows)));

    wrap.appendChild(el('p', { 'class': 'fpara dim' },
      'The post counts are the board’s own, and they count posts that are not on ' +
      'these pages any more. The join dates are whatever the account said when it ' +
      'registered. ' + num(list.length) +
      (list.length === 1 ? ' name is' : ' names are') + ' on this list; the index ' +
      'claims a great many more registered, and most of those never posted once.'));

    wrap.appendChild(el('div', { 'class': 'boardfoot' },
      ctx.link('/members?view=groups',
        isModern(ctx) ? 'The same list by group' : 'The same list by usergroup',
        'backlink')));

    closeOut(ctx, wrap);
  }

  function renderMember(ctx, name) {
    var el = ctx.el;
    var m = findMember(ctx, name);
    if (!m) {
      return render404(ctx, 'There is no account by that name on this board.');
    }

    var trust = trustFor({ authorPosts: m.posts, authorJoined: m.joined });
    var wrap = shell(ctx, m.name, m.name,
      (m.title ? m.title : rankFor(m.posts)) +
      (m.joined ? ' · joined ' + m.joined : ''));

    var left = el('div', { 'class': 'post-author' },
      avatarBox(el, m.seed, m.name),
      el('div', { 'class': 'aname' }, m.name),
      el('div', { 'class': 'atitle' }, m.title ? m.title : rankFor(m.posts)),
      trust ? el('div', { 'class': 'atrust atrust-' + trust.n, title: trust.label },
        'TL' + trust.n) : null,
      el('div', { 'class': 'ameta' }, 'Joined: ' + txt(m.joined, '—')),
      el('div', { 'class': 'ameta' }, 'Posts: ' + num(m.posts)));

    var body = el('div', { 'class': 'post-main' });
    body.appendChild(el('div', { 'class': 'post-head' },
      el('span', { 'class': 'post-time' },
        num(m.here) + (m.here === 1 ? ' post' : ' posts') +
        ' on the pages this board still serves')));

    var lines = el('div', { 'class': 'post-body' });
    var group = groupOf(m);
    if (group === 'Automated accounts') {
      lines.appendChild(para(el, 'The title beside the name says this account is not a ' +
        'person. The number under it is counted exactly the way everybody else’s is.'));
    } else if (group === 'Banned') {
      lines.appendChild(para(el, 'The account is banned. What it posted before that is ' +
        'still where it left it, which is how a board does this: the account stops, the ' +
        'record does not.'));
    } else if (group === 'Administrators' || group === 'Moderators') {
      lines.appendChild(para(el, 'That title was given to this account by a person. ' +
        'Everything else on this page is arithmetic.'));
    } else {
      lines.appendChild(para(el, 'The board calls this account ' + rankFor(m.posts) +
        ', which is worked out from the number of posts beside the name and nothing else.'));
    }
    if (m.last) {
      lines.appendChild(para(el, ['Last seen in ',
        ctx.link('/topic/' + encodeURIComponent(txt(m.last.topic.id)) +
          '?page=' + m.last.page, txt(m.last.topic.title, 'a thread')),
        m.last.time ? ', ' + m.last.time : '', '.']));
      lines.appendChild(el('div', { 'class': 'fhit-snip' }, plain(m.last.body, 220)));
    }
    if (m.started) {
      lines.appendChild(para(el, 'Started ' + num(m.started) +
        (m.started === 1 ? ' thread' : ' threads') + ' here.'));
    }
    lines.appendChild(para(el, 'A memberlist is a list of who is here. It is not a way ' +
      'to reach any of them, and nothing on these pages sends anybody anything.'));
    body.appendChild(lines);

    wrap.appendChild(el('div', { 'class': 'post' }, left, body));

    var mine = topics(ctx).filter(function (t) {
      return String(t.author || '').toLowerCase() === m.name.toLowerCase();
    });
    if (mine.length) {
      wrap.appendChild(sec(el, 'Threads started'));
      mine.forEach(function (t) {
        var b = findBoard(ctx, t.boardId);
        wrap.appendChild(el('div', { 'class': 'fhit' },
          el('div', { 'class': 'ttitle' }, topicLink(ctx, t)),
          el('div', { 'class': 'tmeta' },
            (b ? txt(b.name, 'a forum') : 'a forum') +
            (t.time ? ' » ' + t.time : ''))));
      });
    }

    wrap.appendChild(el('div', { 'class': 'boardfoot' },
      ctx.link('/members', isModern(ctx) ? '« All members' : '« Memberlist',
        'backlink')));
    closeOut(ctx, wrap);
  }

  /* ---------- register, sign in, your record ---------- */

  function renderAccount(ctx, what) {
    var el = ctx.el;

    if (what === 'register') {
      var wrap = shell(ctx, 'Registration', 'Registration', joinAnswer(ctx));
      wrap.appendChild(panel(ctx, 'Joining this board', joinParas(ctx)));
      wrap.appendChild(panel(ctx, 'What reading gets you', [
        para(el, ['Everything. Every forum, every thread, the ',
          ctx.link('/members', 'memberlist'), ', the ',
          ctx.link('/modlog', 'moderation log'), ' and the ',
          ctx.link('/search', 'search'),
          ' are open to anybody who arrives at the address.']),
        para(el, ['The one thing this browser keeps for you is on ',
          ctx.link('/account/profile', 'your record page'), '.'])
      ]));
      closeOut(ctx, wrap);
      return;
    }

    if (what === 'login') {
      var inLabel = isModern(ctx) ? 'Signing in' : 'Logging in';
      var w2 = shell(ctx, inLabel, inLabel, 'You are reading this as a guest.');
      w2.appendChild(panel(ctx, 'The short answer', signInParas(ctx)));
      w2.appendChild(panel(ctx, 'What that costs you', [
        para(el, 'Nothing you can see. A signed-in member of this board gets a ' +
          'different colour on the unread squares and a box to type in. The reading ' +
          'is identical, and the reading is what is left of most of these boards.'),
        para(el, ['If you want the board to be watched for you, that is on ',
          ctx.link('/account/profile', 'your record page'), '.'])
      ]));
      closeOut(ctx, w2);
      return;
    }

    /* profile */
    var w3 = shell(ctx, 'Your record', 'Your record on this board',
      'Which is shorter than you would think, and honest about it.');

    var A = window.SYNTH.alerts;
    var last = 0;
    if (A && typeof A.lastVisit === 'function') {
      try { last = A.lastVisit(ctx.site.domain) || 0; } catch (e) { last = 0; }
    }
    var L = window.SYNTH.live;
    var whenLine = last
      ? ('This board was last open here ' +
         ((L && L.ago) ? L.ago(last) : 'a while ago') + '.')
      : 'This is the first time this board has been open here.';

    w3.appendChild(panel(ctx, 'What the board keeps', [
      para(el, 'Nothing with your name on it. You have not signed in, and the only ' +
        'place a guest appears on a board like this one is in the guest count at the ' +
        'bottom of the index.'),
      para(el, 'It has no idea which threads you have read, and it never did: that is ' +
        'what an account was for.')
    ]));

    var watch = watchRow(ctx);
    w3.appendChild(panel(ctx, 'What this browser keeps', [
      para(el, whenLine),
      para(el, 'That timestamp is the whole of it, and it does one job: a thread that ' +
        'has moved since then opens with a link to the first post you have not read, ' +
        'and a line across the thread where you stopped.'),
      watch ? para(el, 'It can also watch the board for you, which is this browser ' +
        'doing the checking rather than the board doing any telling:') : null,
      watch
    ]));

    var profile = (window.SYNTH.me && typeof window.SYNTH.me.profile === 'function')
      ? window.SYNTH.me.profile() : null;
    if (profile && profile.handle) {
      w3.appendChild(panel(ctx, 'The name you use elsewhere', [
        para(el, 'You post on this network as ' + profile.handle +
          '. That name is yours and not this board’s: nothing here is signed ' +
          'with it, and nothing here would know it if you arrived.')
      ]));
    }

    closeOut(ctx, w3);
  }

  /* ---------- entry point ---------- */

  function renderForum(ctx) {
    var path = arr(ctx.path);
    if (!path.length) return renderIndex(ctx);
    if (path[0] === 'board' && path.length >= 2) return renderBoard(ctx, path[1]);
    if (path[0] === 'topic' && path.length >= 2) return renderTopic(ctx, path[1]);
    if (path[0] === 'modlog') return renderModLog(ctx);
    if (path[0] === 'faq') return renderFaq(ctx);
    if (path[0] === 'search') return renderSearch(ctx);
    if (path[0] === 'members') {
      return path.length >= 2 ? renderMember(ctx, path[1]) : renderMembers(ctx);
    }
    if (path[0] === 'account') {
      var what = String(path[1] || 'profile');
      if (what === 'register' || what === 'login' || what === 'profile') {
        return renderAccount(ctx, what);
      }
      return render404(ctx, 'There is no such page in the account area of this board.');
    }
    return render404(ctx, 'The page you requested could not be found on this board.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('forum', renderForum);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['forum', renderForum]);
  }
}());
