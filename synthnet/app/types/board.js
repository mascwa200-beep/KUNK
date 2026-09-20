/* synthnet :: board renderer
 * 2026-era imageboard. Skin: skin-yotsuba.
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

  function hash32(s) {
    if (has('live') && SYNTH.live.hash32) {
      try { return SYNTH.live.hash32(String(s)); } catch (e) { /* fall */ }
    }
    var h = 0, i;
    for (i = 0; i < String(s).length; i++) {
      h = ((h << 5) - h + String(s).charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function streamed(key, p, intervalMin, count) {
    if (!p || !p.length) { return []; }
    if (has('live') && SYNTH.live.stream) {
      try {
        var out = SYNTH.live.stream(key, p, intervalMin, count);
        if (out && out.length) { return out; }
      } catch (e) { /* fall */ }
    }
    return p.slice(0, count || 3);
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

  function strOf(v, fallback) {
    if (typeof v === 'string') { return v; }
    if (v && typeof v === 'object') {
      return v.body || v.text || v.title || fallback || '';
    }
    return fallback || '';
  }

  /* ---------- chrome ---------- */

  function header(ctx, d) {
    var head = el('header', { 'class': 'bd-head' });

    var top = el('div', { 'class': 'bd-topbar' });
    top.appendChild(ctx.link('/', '/' + (d.boardName || 'b') + '/', 'bd-toplink'));
    top.appendChild(el('span', { 'class': 'bd-topsep' }, text('  ')));
    top.appendChild(el('span', { 'class': 'bd-topdim' }, text('catalog   archive   rules')));
    head.appendChild(top);

    var banner = el('div', { 'class': 'bd-banner' });
    banner.appendChild(SYNTH.markup.placeholder('banner', 'bd:' + ctx.site.domain));
    head.appendChild(banner);

    head.appendChild(el('h1', { 'class': 'bd-h1' }, text('/' + (d.boardName || 'b') + '/')));
    head.appendChild(el('div', { 'class': 'bd-sub' }, text(ctx.site.description || 'no subject')));

    if (has('live') && SYNTH.live.online) {
      var n = 0;
      try { n = SYNTH.live.online(ctx.site.domain, 60, 480); } catch (e) { n = 0; }
      if (n) {
        head.appendChild(el('div', { 'class': 'bd-online' },
          text(shortNum(n) + ' posters connected · '),
          el('span', { 'class': 'bd-online-dim' }, text('an unknown share of them people'))));
      }
    }
    return head;
  }

  function rules(ctx, d) {
    var list = d.rules || [];
    if (!list.length) { return null; }
    var box = el('div', { 'class': 'bd-rules' });
    box.appendChild(el('strong', null, text('Rules')));
    var ol = el('ol', { 'class': 'bd-rulelist' });
    var i;
    for (i = 0; i < list.length; i++) {
      ol.appendChild(el('li', null, ctx.markup(list[i])));
    }
    box.appendChild(ol);
    return box;
  }

  function footer(ctx, d) {
    return el('footer', { 'class': 'bd-foot' },
      el('hr', { 'class': 'bd-hr' }),
      el('div', null,
        text('/' + (d.boardName || 'b') + '/ · Verity County · 2026 · '),
        el('span', { 'class': 'bd-foot-dim' }, text('posts are retained until the model needs the space'))
      )
    );
  }

  /* ---------- posts ---------- */

  function postNo(seedBase, i) {
    return 8000000 + (hash32(String(seedBase) + ':' + i) % 8999999);
  }

  /* A board reply that quotes nothing is a forum post with the name taken
   * off. The two things that make this form look like itself are the post
   * reference and the greentext quote above the answer, and neither was
   * reaching the streamed replies -- the ">>" here was a fallback for a row
   * with no usable text, so in practice it never appeared at all.
   *
   * So a reply picks something earlier in the thread, seeded off the row, and
   * opens against it. Roughly half the time with the number alone, a third of
   * the time with a quoted line as well. The rest answer nothing, because a
   * board is mostly people talking past each other.
   *
   * The quoted line is a real fragment of the post being answered, so the
   * thread reads as a conversation rather than a stack. markup.js turns any
   * line opening with ">" green; the ">>" reference is left alone, because on
   * a board that is a link and not a quote. */
  function quotable(s) {
    var line = String(s || '')
      .replace(/\[[^\]]*\]/g, ' ')
      .split(/\n+/)
      .map(function (x) { return x.replace(/\s+/g, ' ').trim(); })
      .filter(function (x) { return x.length > 14 && x.charAt(0) !== '>'; })[0];
    if (!line) { return ''; }
    if (line.length <= 64) { return line; }
    var cut = line.slice(0, 64);
    var sp = cut.lastIndexOf(' ');
    return (sp > 28 ? cut.slice(0, sp) : cut);
  }

  function replyTo(t, posts, live, j, body) {
    var row = live[j];
    if (!row || typeof row.seed !== 'number') { return body; }
    if (!has('live') || !SYNTH.live.rng) { return body; }

    var r = SYNTH.live.rng(row.seed);
    var roll = r();
    if (roll > 0.82) { return body; }          /* answers nobody */

    /* Anything already in the thread: the OP, an authored reply, or an
     * earlier streamed one. */
    var targets = [{ no: postNo(t.id, 0), text: t.body }];
    var i;
    for (i = 0; i < posts.length; i++) {
      /* postNode's own rule: an authored post may carry its number, and on
       * this board they all do (No.1001 upward). Recomputing the hash here
       * instead produced three references per thread that pointed at no post
       * on the page -- the same dead-link class as app/fame.js, arriving as
       * a number rather than a URL. */
      var p = posts[i] || {};
      targets.push({
        no: p.no != null ? p.no : postNo(t.id, i + 1),
        text: p.body
      });
    }
    for (i = 0; i < j; i++) {
      targets.push({ no: postNo('live:' + t.id, i + 1), text: strOf(live[i], '') });
    }

    var pickedAt = Math.floor(r() * targets.length);
    var target = targets[pickedAt >= targets.length ? targets.length - 1 : pickedAt];
    if (!target) { return body; }

    var head = '>>' + target.no;
    if (roll < 0.34) {
      var q = quotable(target.text);
      if (q) { head += '\n>' + q; }
    }
    return head + '\n' + body;
  }

  function nameLine(ctx, by, kind, at, no) {
    var line = el('div', { 'class': 'bd-postinfo' });
    line.appendChild(el('span', { 'class': 'bd-name' }, text(by || 'Anonymous')));
    var b = liveBadge(kind);
    if (b) { line.appendChild(b); }
    line.appendChild(el('span', { 'class': 'bd-date' }, text(' ' + ago(at))));
    line.appendChild(el('span', { 'class': 'bd-no' }, text(' No.' + no)));
    return line;
  }

  function fileLine(ctx, seed) {
    if (!seed) { return null; }
    var n = (hash32(String(seed)) % 900) + 40;
    return el('div', { 'class': 'bd-file' },
      text('File: ' + String(seed).replace(/[^a-z0-9]/gi, '_').slice(0, 14) + '.png '),
      el('span', { 'class': 'bd-filedim' }, text('(' + n + ' KB, 480x480)')));
  }

  function threadOp(ctx, d, t, isThreadPage) {
    var wrap = el('div', { 'class': 'bd-op' });

    var fl = fileLine(ctx, t.imageSeed);
    if (fl) { wrap.appendChild(fl); }

    if (t.imageSeed) {
      var thumb = el('div', { 'class': 'bd-thumb' });
      thumb.appendChild(SYNTH.markup.placeholder('thumb', t.imageSeed));
      wrap.appendChild(thumb);
    }

    var info = el('div', { 'class': 'bd-opinfo' });
    var subj = el('span', { 'class': 'bd-subject' }, text(t.subject || ''));
    info.appendChild(subj);
    info.appendChild(text(' '));
    info.appendChild(nameLine(ctx, t.by, null, t.at, postNo(t.id, 0)));

    if (!isThreadPage) {
      info.appendChild(el('span', { 'class': 'bd-oplinks' },
        ctx.link('/t/' + t.id, '[Reply]', 'bd-replylink')));
    }
    wrap.appendChild(info);

    var body = el('blockquote', { 'class': 'bd-body' });
    body.appendChild(ctx.markup(t.body || ''));
    wrap.appendChild(body);

    return wrap;
  }

  function postNode(ctx, p, seedBase, i) {
    var wrap = el('div', { 'class': 'bd-post' });

    var no = p.no != null ? p.no : postNo(seedBase, i + 1);
    var info = el('div', { 'class': 'bd-postrow' });
    info.appendChild(nameLine(ctx, p.by, p.kind, p.at, no));
    wrap.appendChild(info);

    var fl = fileLine(ctx, p.imageSeed);
    if (fl) { wrap.appendChild(fl); }
    if (p.imageSeed) {
      var thumb = el('div', { 'class': 'bd-thumb bd-thumb-sm' });
      thumb.appendChild(SYNTH.markup.placeholder('thumb', p.imageSeed));
      wrap.appendChild(thumb);
    }

    var body = el('blockquote', { 'class': 'bd-body' });
    body.appendChild(ctx.markup(p.body || ''));
    wrap.appendChild(body);

    return wrap;
  }

  /* ---------- compose ---------- */

  function composeInto(ctx, host) {
    if (!(window.SYNTH && SYNTH.compose && SYNTH.compose.box)) { return; }
    try {
      var box = SYNTH.compose.box(ctx, ctx.site.domain, function () {
        if (ctx.rerender) { ctx.rerender(); }
      });
      if (box) { host.appendChild(el('div', { 'class': 'bd-compose' }, box)); }
    } catch (e) { /* optional */ }
  }

  function myPostsInto(ctx, host) {
    if (!(window.SYNTH && SYNTH.compose && SYNTH.compose.myPosts)) { return; }
    try {
      var mine = SYNTH.compose.myPosts(ctx, ctx.site.domain);
      if (mine) { host.appendChild(el('div', { 'class': 'bd-mine' }, mine)); }
    } catch (e) { /* optional */ }
  }

  /* ---------- pages ---------- */

  function pageIndex(ctx, d) {
    ctx.title('/' + (d.boardName || 'b') + '/');
    var root = el('div', { 'class': 'bd-page' });
    root.appendChild(header(ctx, d));

    var banner = liveAd('banner', ctx.site.domain + ':top');
    if (banner) { root.appendChild(el('div', { 'class': 'bd-ad bd-ad-banner' }, banner)); }

    var body = el('div', { 'class': 'bd-bodywrap' });

    composeInto(ctx, body);
    myPostsInto(ctx, body);

    var r = rules(ctx, d);
    if (r) { body.appendChild(r); }

    body.appendChild(el('hr', { 'class': 'bd-hr' }));

    var threads = d.threads || [];
    var i;
    for (i = 0; i < threads.length; i++) {
      var t = threads[i];
      var tw = el('div', { 'class': 'bd-threadblock' });
      tw.appendChild(threadOp(ctx, d, t, false));

      var preview = (t.posts || []).slice(-2);
      var j;
      for (j = 0; j < preview.length; j++) {
        tw.appendChild(postNode(ctx, preview[j], t.id, (t.posts || []).length - preview.length + j));
      }

      var hidden = Math.max(0, (t.replyCount || (t.posts || []).length) - preview.length);
      if (hidden > 0) {
        tw.appendChild(el('div', { 'class': 'bd-omitted' },
          text(hidden + ' repl' + (hidden === 1 ? 'y' : 'ies') + ' omitted. '),
          ctx.link('/t/' + t.id, 'Click here to view.', 'bd-replylink')));
      }

      body.appendChild(tw);
      body.appendChild(el('hr', { 'class': 'bd-hr' }));

      if (i === 1) {
        var inl = liveAd('inline', ctx.site.domain + ':mid');
        if (inl) {
          body.appendChild(el('div', { 'class': 'bd-ad bd-ad-inline' }, inl));
          body.appendChild(el('hr', { 'class': 'bd-hr' }));
        }
      }
    }

    /* threads that keep appearing */
    var live = streamed(
      'bd:' + ctx.site.domain + ':threads',
      pool('forumTopics').concat(pool('socialPosts')),
      13,
      3
    );
    if (live.length) {
      body.appendChild(el('div', { 'class': 'bd-livehead' }, text('New threads since you loaded this page')));
      var k;
      for (k = 0; k < live.length; k++) {
        var lb = el('div', { 'class': 'bd-threadblock bd-threadblock-live' });
        var info = el('div', { 'class': 'bd-opinfo' });
        info.appendChild(el('span', { 'class': 'bd-subject' }, text(titleOf(live[k], 'no subject'))));
        info.appendChild(text(' '));
        info.appendChild(nameLine(ctx, 'Anonymous', 'bot', null, postNo('live:' + ctx.site.domain, k)));
        lb.appendChild(info);
        lb.appendChild(el('blockquote', { 'class': 'bd-body' },
          ctx.markup(strOf(live[k], 'no body'))));
        lb.appendChild(el('div', { 'class': 'bd-omitted' },
          text(counter('bd:' + ctx.site.domain + ':lr' + k, 0, 120) + ' replies, 0 of them read')));
        body.appendChild(lb);
        body.appendChild(el('hr', { 'class': 'bd-hr' }));
      }
    }

    var boxAd = liveAd('box', ctx.site.domain + ':bottom');
    if (boxAd) { body.appendChild(el('div', { 'class': 'bd-ad bd-ad-box' }, boxAd)); }

    root.appendChild(body);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  function pageThread(ctx, d, id) {
    var t = byId(d.threads || [], id);
    if (!t) { return page404(ctx, d); }
    ctx.title((t.subject || 'thread') + ' – /' + (d.boardName || 'b') + '/');

    var root = el('div', { 'class': 'bd-page' });
    root.appendChild(header(ctx, d));

    var banner = liveAd('banner', ctx.site.domain + ':t:' + t.id);
    if (banner) { root.appendChild(el('div', { 'class': 'bd-ad bd-ad-banner' }, banner)); }

    var body = el('div', { 'class': 'bd-bodywrap' });
    body.appendChild(el('div', { 'class': 'bd-backline' },
      ctx.link('/', '[Return]', 'bd-replylink')));
    body.appendChild(el('hr', { 'class': 'bd-hr' }));

    var block = el('div', { 'class': 'bd-threadblock' });
    block.appendChild(threadOp(ctx, d, t, true));

    var posts = t.posts || [];
    var i;
    for (i = 0; i < posts.length; i++) {
      block.appendChild(postNode(ctx, posts[i], t.id, i));
      if (i === 2) {
        var inl = liveAd('inline', ctx.site.domain + ':t:' + t.id + ':3');
        if (inl) { block.appendChild(el('div', { 'class': 'bd-ad bd-ad-inline' }, inl)); }
      }
    }

    var live = streamed(
      'bd:' + ctx.site.domain + ':t:' + t.id,
      pool('mediaComments').concat(pool('socialPosts')),
      6,
      4
    );
    var j;
    for (j = 0; j < live.length; j++) {
      block.appendChild(postNode(ctx, {
        by: 'Anonymous',
        kind: 'bot',
        body: replyTo(t, posts, live, j,
          strOf(live[j], '>>' + postNo(t.id, 0) + '\nthis')),
        at: null
      }, 'live:' + t.id, j));
    }

    body.appendChild(block);
    body.appendChild(el('hr', { 'class': 'bd-hr' }));

    var total = posts.length + live.length;
    body.appendChild(el('div', { 'class': 'bd-omitted' },
      text(total + ' replies · ' +
        shortNum(counter('bd:' + ctx.site.domain + ':v:' + t.id, 400, 900)) + ' views')));

    var boxAd = liveAd('box', ctx.site.domain + ':t:' + t.id + ':end');
    if (boxAd) { body.appendChild(el('div', { 'class': 'bd-ad bd-ad-box' }, boxAd)); }

    root.appendChild(body);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  function page404(ctx, d) {
    ctx.title('404 – /' + (d.boardName || 'b') + '/');
    var root = el('div', { 'class': 'bd-page' });
    root.appendChild(header(ctx, d));
    root.appendChild(el('div', { 'class': 'bd-bodywrap' },
      el('div', { 'class': 'bd-404' },
        el('h2', null, text('404 – Not Found')),
        el('p', null, text('Thread pruned. It was mostly two agents agreeing with each other anyway.')),
        ctx.link('/', '[Return]', 'bd-replylink')
      )
    ));
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* ---------- register ---------- */

  SYNTH.render.register('board', function (ctx) {
    el = ctx.el;
    var d = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    if (!p.length) { return pageIndex(ctx, d); }
    if (p[0] === 't' && p[1]) { return pageThread(ctx, d, p[1]); }
    return page404(ctx, d);
  });
}());
