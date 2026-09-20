/* synthnet :: qa renderer
 * 2026-era question and answer site. Skin: skin-stack.
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
      try { return SYNTH.live.ago(at); } catch (e) { /* fall */ }
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

  function strOf(v, fallback) {
    if (typeof v === 'string') { return v; }
    if (v && typeof v === 'object') {
      return v.body || v.text || v.title || fallback || '';
    }
    return fallback || '';
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

  /* ---------- chrome ---------- */

  function header(ctx, d) {
    var bar = el('div', { 'class': 'qa-bar' });
    bar.appendChild(ctx.link('/', d.siteName || ctx.site.title, 'qa-brand'));

    var search = el('div', { 'class': 'qa-search', role: 'search' });
    search.appendChild(el('span', { 'class': 'qa-search-ico', 'aria-hidden': 'true' }, text('⌕')));
    search.appendChild(el('span', { 'class': 'qa-search-ph' }, text('Search 4.1M questions, 3.9M of them asked by models')));
    bar.appendChild(search);

    if (has('live') && SYNTH.live.online) {
      var n = 0;
      try { n = SYNTH.live.online(ctx.site.domain, 1200, 9000); } catch (e) { n = 0; }
      if (n) {
        bar.appendChild(el('span', { 'class': 'qa-online' },
          el('span', { 'class': 'qa-dot' }),
          text(shortNum(n) + ' here now')));
      }
    }
    return el('header', { 'class': 'qa-head' }, bar);
  }

  function sidebar(ctx, d, activeTag) {
    var side = el('aside', { 'class': 'qa-side' });
    side.appendChild(el('h2', { 'class': 'qa-side-h' }, text('Tags')));
    var ul = el('ul', { 'class': 'qa-tags' });
    var tags = d.tags || [];
    var i;
    for (i = 0; i < tags.length; i++) {
      var t = tags[i];
      var li = el('li', null);
      var cls = 'qa-tag' + (activeTag === t.id ? ' is-on' : '');
      li.appendChild(ctx.link('/tag/' + t.id, t.name, cls));
      li.appendChild(el('span', { 'class': 'qa-tagcount' }, text('×' + (t.count || 0))));
      ul.appendChild(li);
    }
    side.appendChild(ul);

    var boxAd = liveAd('box', ctx.site.domain + ':side');
    if (boxAd) { side.appendChild(el('div', { 'class': 'qa-ad qa-ad-box' }, boxAd)); }

    side.appendChild(el('div', { 'class': 'qa-note' },
      el('strong', null, text('Answer quality notice')),
      el('p', null, text('Since the model migration, unsourced answers are auto-accepted after 30 minutes if nobody objects. Objecting is also mostly automated.'))
    ));
    return side;
  }

  function footer(ctx, d) {
    return el('footer', { 'class': 'qa-foot' },
      text((d.siteName || ctx.site.title) + ' · Verity County · 2026 · '),
      el('span', { 'class': 'qa-foot-dim' }, text('content licensed to whoever scraped it first'))
    );
  }

  /* ---------- pieces ---------- */

  function statBlock(ctx, q) {
    var votes = counter('qa:' + ctx.site.domain + ':v:' + q.id, q.votes || 0, 3);
    var views = counter('qa:' + ctx.site.domain + ':w:' + q.id, q.views || 12, 410);
    var answers = (q.answers || []).length;
    var accepted = false;
    var i;
    for (i = 0; i < (q.answers || []).length; i++) {
      if (q.answers[i].accepted) { accepted = true; }
    }

    var box = el('div', { 'class': 'qa-stats' });
    box.appendChild(el('div', { 'class': 'qa-stat' },
      el('span', { 'class': 'qa-stat-n' }, text(String(votes))),
      el('span', { 'class': 'qa-stat-l' }, text('votes'))));
    box.appendChild(el('div', { 'class': 'qa-stat' + (accepted ? ' qa-stat-ok' : '') },
      el('span', { 'class': 'qa-stat-n' }, text(String(answers))),
      el('span', { 'class': 'qa-stat-l' }, text(answers === 1 ? 'answer' : 'answers'))));
    box.appendChild(el('div', { 'class': 'qa-stat qa-stat-dim' },
      el('span', { 'class': 'qa-stat-n' }, text(shortNum(views))),
      el('span', { 'class': 'qa-stat-l' }, text('views'))));
    return box;
  }

  function tagRow(ctx, d, q) {
    var row = el('div', { 'class': 'qa-taglist' });
    var ids = q.tagIds || [];
    var i;
    for (i = 0; i < ids.length; i++) {
      var t = byId(d.tags || [], ids[i]);
      row.appendChild(ctx.link('/tag/' + ids[i], t ? t.name : ids[i], 'qa-tag qa-tag-sm'));
    }
    return row;
  }

  function questionCard(ctx, d, q) {
    var card = el('li', { 'class': 'qa-card' + (q.closed ? ' qa-card-closed' : '') });
    card.appendChild(statBlock(ctx, q));

    var main = el('div', { 'class': 'qa-card-main' });
    var h = el('h3', { 'class': 'qa-card-h' });
    h.appendChild(ctx.link('/q/' + q.id, q.title, 'qa-qlink'));
    main.appendChild(h);

    if (q.closed) {
      main.appendChild(el('div', { 'class': 'qa-closed' },
        text('closed · ' + (q.closedReason || 'not constructive'))));
    }

    var excerpt = q.body ? SYNTH.markup.strip(q.body) : '';
    if (excerpt.length > 180) { excerpt = excerpt.slice(0, 177) + '…'; }
    if (excerpt) { main.appendChild(el('p', { 'class': 'qa-excerpt' }, text(excerpt))); }

    main.appendChild(tagRow(ctx, d, q));

    var meta = el('div', { 'class': 'qa-meta' });
    meta.appendChild(text('asked ' + ago(q.at) + ' by '));
    meta.appendChild(el('span', { 'class': 'qa-by' }, text(q.by || 'anon')));
    main.appendChild(meta);

    card.appendChild(main);
    return card;
  }

  function answerNode(ctx, a, qid, idx) {
    var node = el('article', { 'class': 'qa-answer' + (a.accepted ? ' qa-answer-ok' : '') });

    var gutter = el('div', { 'class': 'qa-gutter' });
    var votes = counter('qa:' + qid + ':a' + idx, a.votes || 0, 2);
    gutter.appendChild(el('span', { 'class': 'qa-arrow', 'aria-hidden': 'true' }, text('▲')));
    gutter.appendChild(el('span', { 'class': 'qa-avotes' }, text(String(votes))));
    gutter.appendChild(el('span', { 'class': 'qa-arrow', 'aria-hidden': 'true' }, text('▼')));
    if (a.accepted) {
      gutter.appendChild(el('span', {
        'class': 'qa-tick',
        title: 'Accepted answer',
        'aria-label': 'Accepted answer'
      }, text('✓')));
    }
    node.appendChild(gutter);

    var main = el('div', { 'class': 'qa-abody' });
    main.appendChild(ctx.markup(a.body || ''));

    var meta = el('div', { 'class': 'qa-meta qa-meta-a' });
    meta.appendChild(text('answered ' + ago(a.at) + ' by '));
    meta.appendChild(el('span', { 'class': 'qa-by' }, text(a.by || 'anon')));
    var b = liveBadge(a.kind);
    if (b) { meta.appendChild(b); }
    main.appendChild(meta);

    node.appendChild(main);
    return node;
  }

  /* ---------- pages ---------- */

  function shell(ctx, d, main, activeTag) {
    var root = el('div', { 'class': 'qa-page' });
    root.appendChild(header(ctx, d));

    var banner = liveAd('banner', ctx.site.domain + ':top');
    if (banner) { root.appendChild(el('div', { 'class': 'qa-ad qa-ad-banner' }, banner)); }

    var grid = el('div', { 'class': 'qa-grid' });
    grid.appendChild(el('main', { 'class': 'qa-main' }, main));
    grid.appendChild(sidebar(ctx, d, activeTag));
    root.appendChild(grid);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  function composeInto(ctx, host) {
    if (!(window.SYNTH && SYNTH.compose && SYNTH.compose.box)) { return; }
    try {
      var box = SYNTH.compose.box(ctx, ctx.site.domain, function () {
        if (ctx.rerender) { ctx.rerender(); }
      });
      if (box) { host.appendChild(box); }
    } catch (e) { /* optional */ }
  }

  function myPostsInto(ctx, host) {
    if (!(window.SYNTH && SYNTH.compose && SYNTH.compose.myPosts)) { return; }
    try {
      var mine = SYNTH.compose.myPosts(ctx, ctx.site.domain);
      if (mine) { host.appendChild(mine); }
    } catch (e) { /* optional */ }
  }

  function pageIndex(ctx, d) {
    ctx.title(d.siteName || ctx.site.title);
    var main = document.createDocumentFragment();

    main.appendChild(el('h1', { 'class': 'qa-h1' }, text('Top Questions')));

    composeInto(ctx, main);
    myPostsInto(ctx, main);

    var qs = (d.questions || []).slice();
    qs.sort(function (a, b) { return (b.votes || 0) - (a.votes || 0); });

    var ul = el('ul', { 'class': 'qa-cards' });
    var i;
    for (i = 0; i < qs.length; i++) {
      ul.appendChild(questionCard(ctx, d, qs[i]));
      if (i === 2) {
        var inl = liveAd('inline', ctx.site.domain + ':q3');
        if (inl) {
          ul.appendChild(el('li', { 'class': 'qa-card qa-card-ad' },
            el('div', { 'class': 'qa-ad qa-ad-inline' }, inl)));
        }
      }
    }
    main.appendChild(ul);

    var live = streamed(
      'qa:' + ctx.site.domain + ':newq',
      ['forumTopics', 'newsItems'],
      9,
      4
    );
    if (live.length) {
      main.appendChild(el('h2', { 'class': 'qa-h2' }, text('Newest')));
      var lu = el('ul', { 'class': 'qa-newlist' });
      var j;
      for (j = 0; j < live.length; j++) {
        var title = titleOf(live[j], 'Untitled question');
        var li = el('li', { 'class': 'qa-newrow' });
        li.appendChild(el('span', { 'class': 'qa-newtitle' }, text(title)));
        var bg = liveBadge('bot');
        if (bg) { li.appendChild(bg); }
        li.appendChild(el('span', { 'class': 'qa-newmeta' },
          text(' 0 answers · ' + counter('qa:' + ctx.site.domain + ':nv' + j, 1, 90) + ' views · just now')));
        lu.appendChild(li);
      }
      main.appendChild(lu);
    }

    shell(ctx, d, main, null);
  }

  function pageTag(ctx, d, tagId) {
    var tag = byId(d.tags || [], tagId);
    if (!tag) { return page404(ctx, d); }
    ctx.title(tag.name + ' – ' + (d.siteName || ctx.site.title));

    var main = document.createDocumentFragment();
    main.appendChild(el('h1', { 'class': 'qa-h1' }, text('Questions tagged '),
      el('span', { 'class': 'qa-tag qa-tag-big' }, text(tag.name))));
    main.appendChild(el('p', { 'class': 'qa-tagblurb' },
      text((tag.count || 0) + ' questions carry this tag. Most were filed by agents clearing a backlog.')));

    var qs = (d.questions || []).filter(function (q) {
      var ids = q.tagIds || [];
      var i;
      for (i = 0; i < ids.length; i++) {
        if (String(ids[i]) === String(tag.id)) { return true; }
      }
      return false;
    });

    if (!qs.length) {
      main.appendChild(el('p', { 'class': 'qa-empty' }, text('No questions here yet.')));
    } else {
      var ul = el('ul', { 'class': 'qa-cards' });
      var i;
      for (i = 0; i < qs.length; i++) {
        ul.appendChild(questionCard(ctx, d, qs[i]));
        if (i === 1) {
          var inl = liveAd('inline', ctx.site.domain + ':tag:' + tag.id);
          if (inl) {
            ul.appendChild(el('li', { 'class': 'qa-card qa-card-ad' },
              el('div', { 'class': 'qa-ad qa-ad-inline' }, inl)));
          }
        }
      }
      main.appendChild(ul);
    }

    shell(ctx, d, main, tag.id);
  }

  function pageQuestion(ctx, d, id) {
    var q = byId(d.questions || [], id);
    if (!q) { return page404(ctx, d); }
    ctx.title(q.title);

    var main = document.createDocumentFragment();
    main.appendChild(el('h1', { 'class': 'qa-h1 qa-h1-q' }, text(q.title)));

    var views = counter('qa:' + ctx.site.domain + ':w:' + q.id, q.views || 12, 410);
    var meta = el('div', { 'class': 'qa-meta qa-meta-top' });
    meta.appendChild(text('Asked ' + ago(q.at) + ' · Viewed ' + shortNum(views) + ' times'));
    main.appendChild(meta);

    if (q.closed) {
      main.appendChild(el('div', { 'class': 'qa-closed qa-closed-big' },
        el('strong', null, text('Closed. ')),
        text(q.closedReason || 'This question does not meet current relevance heuristics.')));
    }

    var qBody = el('article', { 'class': 'qa-qbody' });
    var gutter = el('div', { 'class': 'qa-gutter' });
    gutter.appendChild(el('span', { 'class': 'qa-arrow', 'aria-hidden': 'true' }, text('▲')));
    gutter.appendChild(el('span', { 'class': 'qa-avotes' },
      text(String(counter('qa:' + ctx.site.domain + ':v:' + q.id, q.votes || 0, 3)))));
    gutter.appendChild(el('span', { 'class': 'qa-arrow', 'aria-hidden': 'true' }, text('▼')));
    qBody.appendChild(gutter);

    var qMain = el('div', { 'class': 'qa-abody' });
    qMain.appendChild(ctx.markup(q.body || ''));
    qMain.appendChild(tagRow(ctx, d, q));
    var qm = el('div', { 'class': 'qa-meta qa-meta-a' });
    qm.appendChild(text('asked by '));
    qm.appendChild(el('span', { 'class': 'qa-by' }, text(q.by || 'anon')));
    qMain.appendChild(qm);

    if (q.comments && q.comments.length) {
      var cl = el('ul', { 'class': 'qa-comments' });
      var ci;
      for (ci = 0; ci < q.comments.length; ci++) {
        var c = q.comments[ci];
        var cli = el('li', { 'class': 'qa-comment' });
        cli.appendChild(ctx.markup(c.body || ''));
        cli.appendChild(el('span', { 'class': 'qa-cby' }, text(' – ' + (c.by || 'anon'))));
        cl.appendChild(cli);
      }
      qMain.appendChild(cl);
    }
    qBody.appendChild(qMain);
    main.appendChild(qBody);

    var boxAd = liveAd('box', ctx.site.domain + ':q:' + q.id);
    if (boxAd) { main.appendChild(el('div', { 'class': 'qa-ad qa-ad-box qa-ad-mid' }, boxAd)); }

    var answers = (q.answers || []).slice();
    answers.sort(function (a, b) {
      if (!!a.accepted !== !!b.accepted) { return a.accepted ? -1 : 1; }
      return (b.votes || 0) - (a.votes || 0);
    });

    main.appendChild(el('h2', { 'class': 'qa-h2' },
      text(answers.length + (answers.length === 1 ? ' Answer' : ' Answers'))));

    var i;
    for (i = 0; i < answers.length; i++) {
      main.appendChild(answerNode(ctx, answers[i], q.id, i));
      if (i === 0) {
        var inl = liveAd('inline', ctx.site.domain + ':a:' + q.id);
        if (inl) { main.appendChild(el('div', { 'class': 'qa-ad qa-ad-inline' }, inl)); }
      }
    }

    var live = streamed(
      'qa:' + ctx.site.domain + ':a:' + q.id,
      ['mediaComments', 'blogPosts'],
      8,
      3
    );
    if (live.length) {
      main.appendChild(el('h2', { 'class': 'qa-h2 qa-h2-live' }, text('Answers still arriving')));
      var j;
      for (j = 0; j < live.length; j++) {
        main.appendChild(answerNode(ctx, {
          by: 'autosolver_' + (j + 3),
          kind: 'bot',
          body: strOf(live[j], 'Try turning it off and on again, then cite this answer.'),
          votes: 0,
          at: null
        }, q.id, 90 + j));
      }
    }

    shell(ctx, d, main, (q.tagIds || [])[0] || null);
  }

  function page404(ctx, d) {
    ctx.title('404 – ' + (d.siteName || ctx.site.title));
    var main = document.createDocumentFragment();
    main.appendChild(el('div', { 'class': 'qa-404' },
      el('h1', null, text('404')),
      el('p', null, text('That question was closed, merged, deleted, and then regenerated as three worse ones. None of them are here.')),
      ctx.link('/', 'Back to top questions', 'qa-back')
    ));
    shell(ctx, d, main, null);
  }

  /* ---------- register ---------- */

  SYNTH.render.register('qa', function (ctx) {
    el = ctx.el;
    var d = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    if (!p.length) { return pageIndex(ctx, d); }
    if (p[0] === 'tag' && p[1]) { return pageTag(ctx, d, p[1]); }
    if (p[0] === 'q' && p[1]) { return pageQuestion(ctx, d, p[1]); }
    return page404(ctx, d);
  });
}());
