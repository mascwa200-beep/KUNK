/* synthnet :: aggregator renderer
 * 2026-era link aggregator. Two skins: skin-orange-news, skin-round-red.
 * Classic script, ES5-safe. No innerHTML with data. No absolute URLs.
 */
window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var el = null;

  function has(ns) { return !!(window.SYNTH && window.SYNTH[ns]); }

  function liveAd(slot, seed) {
    if (!has('liveui') || !SYNTH.liveui.ad) { return null; }
    try { return SYNTH.liveui.ad(slot, seed); } catch (e) { return null; }
  }

  function liveBadge(kind) {
    if (!kind || !has('liveui') || !SYNTH.liveui.badge) { return null; }
    try { return SYNTH.liveui.badge(kind); } catch (e) { return null; }
  }

  function ago(at) {
    if (has('live') && SYNTH.live.ago) {
      try { return SYNTH.live.ago(at); } catch (e) { /* fall through */ }
    }
    return 'a while ago';
  }

  function counter(key, base, perDay) {
    if (has('live') && SYNTH.live.counter) {
      try { return SYNTH.live.counter(key, base, perDay); } catch (e) { /* fall */ }
    }
    return base;
  }

  function shortNum(n) {
    if (has('live') && SYNTH.live.short) {
      try { return SYNTH.live.short(n); } catch (e) { /* fall */ }
    }
    return String(n);
  }

  function streamed(key, p, intervalMin, count) {
    if (!p || !p.length) { return []; }
    if (has('live') && SYNTH.live.stream) {
      try {
        var out = SYNTH.live.stream(key, p, intervalMin, count);
        if (out && out.length) { return out; }
      } catch (e) { /* fall */ }
    }
    /* Fallback for when live.js is missing. `p` may be a list of POOL NAMES
     * rather than items, and slicing that hands back the strings
     * "forumTopics" and "socialPosts" as if they were posts. Resolve first. */
    var flat = p, fi;
    if (typeof flat[0] === 'string') {
      flat = [];
      for (fi = 0; fi < p.length; fi++) { flat = flat.concat(pool(p[fi])); }
    }
    return flat.slice(0, count || 3);
  }

  /* One line, stripped and cut. Shared, because every renderer that rolled
   * its own reached for `body` before `headline` and printed a whole article
   * where a title goes. */
  function titleOf(item, fallback) {
    if (SYNTH.live && typeof SYNTH.live.titleOf === 'function') {
      return SYNTH.live.titleOf(item, fallback);
    }
    if (typeof item === 'string') { return item; }
    return (item && (item.title || item.headline || item.body)) || fallback || '';
  }

  function pool(name) {
    if (has('slop') && SYNTH.slop[name]) { return SYNTH.slop[name]; }
    return [];
  }

  function text(t) { return document.createTextNode(String(t == null ? '' : t)); }

  function byId(arr, id) {
    var i;
    for (i = 0; i < (arr || []).length; i++) {
      if (String(arr[i].id) === String(id)) { return arr[i]; }
    }
    return null;
  }

  /* ---------- chrome ---------- */

  function header(ctx, d, activeBoard) {
    var bar = el('div', { 'class': 'agg-bar' });
    bar.appendChild(ctx.link('/', d.siteName || ctx.site.title, 'agg-brand'));

    var nav = el('nav', { 'class': 'agg-nav', 'aria-label': 'Boards' });
    nav.appendChild(ctx.link('/', 'top', 'agg-navlink' + (activeBoard ? '' : ' is-on')));
    var boards = d.boards || [];
    var i;
    for (i = 0; i < boards.length; i++) {
      var cls = 'agg-navlink' + (activeBoard === boards[i].id ? ' is-on' : '');
      nav.appendChild(ctx.link('/board/' + boards[i].id, boards[i].name, cls));
    }
    bar.appendChild(nav);

    var live = el('span', { 'class': 'agg-live' });
    if (has('live') && SYNTH.live.online) {
      var n = 0;
      try { n = SYNTH.live.online(ctx.site.domain, 900, 4200); } catch (e) { n = 0; }
      if (n) {
        live.appendChild(el('span', { 'class': 'agg-dot' }));
        live.appendChild(text(shortNum(n) + ' online'));
      }
    }
    bar.appendChild(live);

    var wrap = el('div', { 'class': 'agg-head' }, bar);
    if (d.tagline) {
      wrap.appendChild(el('div', { 'class': 'agg-tagline' }, text(d.tagline)));
    }
    return wrap;
  }

  function footer(ctx, d) {
    var f = el('footer', { 'class': 'agg-foot' });
    f.appendChild(text((d.siteName || ctx.site.title) + ' · Verity County · 2026'));
    f.appendChild(el('span', { 'class': 'agg-foot-sep' }, text(' · ')));
    f.appendChild(text('moderation is mostly automated'));
    return f;
  }

  function notFound(ctx, d) {
    var box = el('div', { 'class': 'agg-404' },
      el('h1', null, text('404')),
      el('p', null, text('No such page. The crawler may have eaten it.')),
      ctx.link('/', 'back to the front page', 'agg-back')
    );
    return box;
  }

  /* ---------- link rows ---------- */

  function domainOf(link) {
    if (link.domain) { return link.domain; }
    if (link.url) {
      var m = String(link.url).replace(/^synth:\/\//, '');
      return m.split('/')[0];
    }
    return null;
  }

  function linkTarget(ctx, link) {
    /* internal synth:// urls become cross-site links via markup; otherwise item page */
    if (link.url && /^synth:\/\//.test(link.url)) {
      var rest = String(link.url).replace(/^synth:\/\//, '');
      var a = el('a', { 'class': 'agg-title', href: 'synth://' + rest }, text(link.title));
      return a;
    }
    return ctx.link('/item/' + link.id, link.title, 'agg-title');
  }

  function linkRow(ctx, d, link, rank) {
    var row = el('li', { 'class': 'agg-row' });

    if (rank != null) {
      row.appendChild(el('span', { 'class': 'agg-rank' }, text(String(rank) + '.')));
    }

    var vote = el('span', { 'class': 'agg-vote', 'aria-hidden': 'true' }, text('▲'));
    row.appendChild(vote);

    var main = el('div', { 'class': 'agg-main' });
    var line = el('div', { 'class': 'agg-line' });
    line.appendChild(linkTarget(ctx, link));
    var dom = domainOf(link);
    if (dom) {
      line.appendChild(el('span', { 'class': 'agg-dom' }, text('(' + dom + ')')));
    }
    var b = liveBadge(link.kind);
    if (b) { line.appendChild(b); }
    main.appendChild(line);

    var pts = counter('agg:' + ctx.site.domain + ':pts:' + link.id, link.points || 1, 14);
    var meta = el('div', { 'class': 'agg-meta' });
    meta.appendChild(el('span', { 'class': 'agg-pts' }, text(SYNTH.live && SYNTH.live.commas ? SYNTH.live.commas(pts) + ' points' : pts + ' points')));
    meta.appendChild(text(' by '));
    meta.appendChild(el('span', { 'class': 'agg-by' }, text(link.by || 'anon')));
    meta.appendChild(text(' ' + ago(link.at) + ' · '));
    meta.appendChild(ctx.link('/item/' + link.id, (link.commentCount || (link.comments || []).length) + ' comments', 'agg-clink'));
    main.appendChild(meta);

    row.appendChild(main);
    return row;
  }

  function streamRows(ctx, keySuffix) {
    var items = streamed(
      'agg:' + ctx.site.domain + ':' + keySuffix,
      ['newsItems', 'forumTopics'],
      11,
      4
    );
    /* story layer: stream() rows in, stream() rows out. See app/live.js. */
    items = SYNTH.live.withStory(items, ctx.site);
    if (!items.length) { return null; }
    var box = el('section', { 'class': 'agg-stream' });
    box.appendChild(el('h2', { 'class': 'agg-stream-h' }, text('Arriving now')));
    var ul = el('ul', { 'class': 'agg-list agg-list-stream' });
    var i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      var title = titleOf(it, 'untitled');
      var kind = typeof it === 'string' ? 'bot' : (it.kind || 'bot');
      var li = el('li', { 'class': 'agg-row agg-row-live' });
      li.appendChild(el('span', { 'class': 'agg-vote', 'aria-hidden': 'true' }, text('▲')));
      var main = el('div', { 'class': 'agg-main' });
      var line = el('div', { 'class': 'agg-line' });
      line.appendChild(el('span', { 'class': 'agg-title agg-title-dead' }, text(title)));
      var bg = liveBadge(kind);
      if (bg) { line.appendChild(bg); }
      main.appendChild(line);
      main.appendChild(el('div', { 'class': 'agg-meta' }, text(
        counter('agg:' + ctx.site.domain + ':live:' + i, 2 + i * 3, 40) + ' points · just now'
      )));
      li.appendChild(main);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return box;
  }

  /* ---------- compose ---------- */

  function composeInto(ctx, host) {
    if (!(window.SYNTH && SYNTH.compose && SYNTH.compose.box)) { return; }
    try {
      var box = SYNTH.compose.box(ctx, ctx.site.domain, function () {
        if (ctx.rerender) { ctx.rerender(); }
      });
      if (box) { host.appendChild(box); }
    } catch (e) { /* compose optional */ }
  }

  function myPostsInto(ctx, host) {
    if (!(window.SYNTH && SYNTH.compose && SYNTH.compose.myPosts)) { return; }
    try {
      var mine = SYNTH.compose.myPosts(ctx, ctx.site.domain);
      if (mine) { host.appendChild(mine); }
    } catch (e) { /* optional */ }
  }

  /* ---------- pages ---------- */

  function pageIndex(ctx, d) {
    ctx.title(d.siteName || ctx.site.title);
    var root = el('div', { 'class': 'agg-page' });
    root.appendChild(header(ctx, d, null));

    var banner = liveAd('banner', ctx.site.domain + ':top');
    if (banner) { root.appendChild(el('div', { 'class': 'agg-ad agg-ad-banner' }, banner)); }

    var body = el('div', { 'class': 'agg-body' });

    composeInto(ctx, body);
    myPostsInto(ctx, body);

    var links = (d.links || []).slice();
    links.sort(function (a, b) { return (b.points || 0) - (a.points || 0); });

    var ul = el('ol', { 'class': 'agg-list' });
    var i;
    for (i = 0; i < links.length; i++) {
      ul.appendChild(linkRow(ctx, d, links[i], i + 1));
      if (i === 3) {
        var inl = liveAd('inline', ctx.site.domain + ':row4');
        if (inl) {
          ul.appendChild(el('li', { 'class': 'agg-row agg-row-ad' },
            el('div', { 'class': 'agg-ad agg-ad-inline' }, inl)));
        }
      }
    }
    body.appendChild(ul);

    var st = streamRows(ctx, 'front');
    if (st) { body.appendChild(st); }

    var boxAd = liveAd('box', ctx.site.domain + ':side');
    if (boxAd) { body.appendChild(el('div', { 'class': 'agg-ad agg-ad-box' }, boxAd)); }

    root.appendChild(body);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  function pageBoard(ctx, d, boardId) {
    var board = byId(d.boards || [], boardId);
    if (!board) { return page404(ctx, d); }
    ctx.title(board.name + ' – ' + (d.siteName || ctx.site.title));

    var root = el('div', { 'class': 'agg-page' });
    root.appendChild(header(ctx, d, board.id));

    var banner = liveAd('banner', ctx.site.domain + ':' + board.id);
    if (banner) { root.appendChild(el('div', { 'class': 'agg-ad agg-ad-banner' }, banner)); }

    var body = el('div', { 'class': 'agg-body' });
    body.appendChild(el('h1', { 'class': 'agg-h1' }, text(board.name)));

    var links = (d.links || []).filter(function (l) {
      return String(l.boardId) === String(board.id);
    });
    links.sort(function (a, b) { return (b.points || 0) - (a.points || 0); });

    if (!links.length) {
      body.appendChild(el('p', { 'class': 'agg-empty' }, text('Nothing here yet. The submission queue is automated and it is having a day.')));
    } else {
      var ul = el('ol', { 'class': 'agg-list' });
      var i;
      for (i = 0; i < links.length; i++) {
        ul.appendChild(linkRow(ctx, d, links[i], i + 1));
        if (i === 2) {
          var inl = liveAd('inline', ctx.site.domain + ':' + board.id + ':3');
          if (inl) {
            ul.appendChild(el('li', { 'class': 'agg-row agg-row-ad' },
              el('div', { 'class': 'agg-ad agg-ad-inline' }, inl)));
          }
        }
      }
      body.appendChild(ul);
    }

    var st = streamRows(ctx, 'board:' + board.id);
    if (st) { body.appendChild(st); }

    root.appendChild(body);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  function commentNode(ctx, c, depth) {
    var node = el('li', { 'class': 'agg-comment agg-depth-' + (depth > 2 ? 2 : depth) });
    var head = el('div', { 'class': 'agg-chead' });
    head.appendChild(el('span', { 'class': 'agg-by' }, text(c.by || 'anon')));
    var b = liveBadge(c.kind);
    if (b) { head.appendChild(b); }
    head.appendChild(el('span', { 'class': 'agg-cpts' }, text(' ' + (c.points || 0) + ' points')));
    node.appendChild(head);

    var bodyEl = el('div', { 'class': 'agg-cbody' });
    bodyEl.appendChild(ctx.markup(c.body || ''));
    node.appendChild(bodyEl);

    if (c.replies && c.replies.length) {
      var ul = el('ul', { 'class': 'agg-clist' });
      var i;
      for (i = 0; i < c.replies.length; i++) {
        ul.appendChild(commentNode(ctx, c.replies[i], depth + 1));
      }
      node.appendChild(ul);
    }
    return node;
  }

  function pageItem(ctx, d, id) {
    var link = byId(d.links || [], id);
    if (!link) { return page404(ctx, d); }
    ctx.title(link.title);

    var root = el('div', { 'class': 'agg-page' });
    root.appendChild(header(ctx, d, link.boardId));

    var body = el('div', { 'class': 'agg-body' });

    var head = el('article', { 'class': 'agg-item' });
    var h = el('h1', { 'class': 'agg-h1' }, text(link.title));
    head.appendChild(h);

    var dom = domainOf(link);
    if (dom) {
      var domLine = el('div', { 'class': 'agg-itemdom' });
      if (link.url && /^synth:\/\//.test(link.url)) {
        domLine.appendChild(el('a', { 'class': 'agg-out', href: link.url }, text(dom)));
      } else {
        domLine.appendChild(text(dom));
      }
      head.appendChild(domLine);
    }

    var pts = counter('agg:' + ctx.site.domain + ':pts:' + link.id, link.points || 1, 14);
    var views = counter('agg:' + ctx.site.domain + ':views:' + link.id, (link.points || 1) * 37, 620);
    var meta = el('div', { 'class': 'agg-meta agg-meta-item' });
    meta.appendChild(text(pts + ' points by '));
    meta.appendChild(el('span', { 'class': 'agg-by' }, text(link.by || 'anon')));
    var ib = liveBadge(link.kind);
    if (ib) { meta.appendChild(ib); }
    meta.appendChild(text(' ' + ago(link.at) + ' · ' + shortNum(views) + ' views'));
    head.appendChild(meta);
    body.appendChild(head);

    var boxAd = liveAd('box', ctx.site.domain + ':item:' + link.id);
    if (boxAd) { body.appendChild(el('div', { 'class': 'agg-ad agg-ad-box' }, boxAd)); }

    var cs = link.comments || [];
    body.appendChild(el('h2', { 'class': 'agg-h2' }, text(cs.length + ' comments')));

    if (cs.length) {
      var ul = el('ul', { 'class': 'agg-clist agg-clist-top' });
      var i;
      for (i = 0; i < cs.length; i++) {
        ul.appendChild(commentNode(ctx, cs[i], 0));
        if (i === 1) {
          var inl = liveAd('inline', ctx.site.domain + ':c:' + link.id);
          if (inl) {
            ul.appendChild(el('li', { 'class': 'agg-comment agg-comment-ad' },
              el('div', { 'class': 'agg-ad agg-ad-inline' }, inl)));
          }
        }
      }
      body.appendChild(ul);
    } else {
      body.appendChild(el('p', { 'class': 'agg-empty' }, text('No comments. Unusual in 2026.')));
    }

    var live = streamed(
      'agg:' + ctx.site.domain + ':c:' + link.id,
      ['mediaComments', 'socialPosts'],
      7,
      3
    );
    if (live.length) {
      var lu = el('ul', { 'class': 'agg-clist agg-clist-live' });
      var j;
      for (j = 0; j < live.length; j++) {
        var lv = live[j];
        var lbody = typeof lv === 'string' ? lv : (lv.body || lv.text || lv.title || '');
        var lby = typeof lv === 'string' ? 'relay_' + (j + 1) : (lv.by || 'relay_' + (j + 1));
        var lkind = typeof lv === 'string' ? 'bot' : (lv.kind || 'bot');
        lu.appendChild(commentNode(ctx, { by: lby, kind: lkind, body: lbody, points: 1 }, 0));
      }
      body.appendChild(el('h2', { 'class': 'agg-h2 agg-h2-live' }, text('Still coming in')));
      body.appendChild(lu);
    }

    root.appendChild(body);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  function page404(ctx, d) {
    ctx.title('404 – ' + (d.siteName || ctx.site.title));
    var root = el('div', { 'class': 'agg-page' });
    root.appendChild(header(ctx, d, null));
    root.appendChild(el('div', { 'class': 'agg-body' }, notFound(ctx, d)));
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* ---------- register ---------- */

  SYNTH.render.register('aggregator', function (ctx) {
    el = ctx.el;
    var d = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    if (!p.length) { return pageIndex(ctx, d); }
    if (p[0] === 'board' && p[1]) { return pageBoard(ctx, d, p[1]); }
    if (p[0] === 'item' && p[1]) { return pageItem(ctx, d, p[1]); }
    return page404(ctx, d);
  });
}());
