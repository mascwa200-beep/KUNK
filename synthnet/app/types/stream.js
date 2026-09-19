window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var S = window.SYNTH;

  function el() { return S.el.apply(null, arguments); }

  function has(fn) { return typeof fn === 'function'; }

  function liveAd(slot, seed) {
    if (!S.liveui || !has(S.liveui.ad)) { return null; }
    return S.liveui.ad(slot, seed);
  }

  function badge(kind) {
    if (!S.liveui || !has(S.liveui.badge)) { return null; }
    return S.liveui.badge(kind);
  }

  function ago(ms) {
    if (S.live && has(S.live.ago)) { return S.live.ago(ms); }
    return '';
  }

  function nowMs() {
    if (S.live && has(S.live.now)) { return S.live.now(); }
    return Date.now();
  }

  function shortNum(n) {
    if (S.live && has(S.live.short)) { return S.live.short(n); }
    return String(n);
  }

  function commas(n) {
    if (S.live && has(S.live.commas)) { return S.live.commas(n); }
    return String(n);
  }

  function hash32(str) {
    if (S.live && has(S.live.hash32)) { return S.live.hash32(str); }
    var h = 0, i;
    for (i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return h >>> 0;
  }

  function counter(key, base, perDay) {
    if (S.live && has(S.live.counter)) { return S.live.counter(key, base, perDay); }
    return base;
  }

  function streamPool(key, pool, intervalMin, count) {
    if (S.live && has(S.live.stream)) { return S.live.stream(key, pool, intervalMin, count); }
    return (pool || []).slice(0, count);
  }

  function pick(arr, seed) {
    if (S.live && has(S.live.pick)) { return S.live.pick(arr, seed); }
    if (!arr || !arr.length) { return null; }
    return arr[hash32(String(seed)) % arr.length];
  }

  function placeholder(kind, seed) {
    if (S.markup && has(S.markup.placeholder)) { return S.markup.placeholder(kind, seed); }
    return el('span', { 'class': 'tm-noimg' });
  }

  function parseBody(text) {
    if (S.markup && has(S.markup.parse)) { return S.markup.parse(text || ''); }
    return document.createTextNode(text || '');
  }

  /* ---------- lookups ---------- */

  function findVideo(data, id) {
    var vids = data.videos || [], i;
    for (i = 0; i < vids.length; i++) {
      if (String(vids[i].id) === String(id)) { return vids[i]; }
    }
    return null;
  }

  function findChannel(data, id) {
    var chs = data.channels || [], i;
    for (i = 0; i < chs.length; i++) {
      if (String(chs[i].id) === String(id)) { return chs[i]; }
    }
    return null;
  }

  function videosOf(data, channelId) {
    var vids = data.videos || [], out = [], i;
    for (i = 0; i < vids.length; i++) {
      if (String(vids[i].channelId) === String(channelId)) { out.push(vids[i]); }
    }
    return out;
  }

  /* ---------- shared chrome ---------- */

  function header(ctx, data) {
    var bar = el('div', { 'class': 'tm-bar' });
    var brand = el('div', { 'class': 'tm-brand' },
      el('span', { 'class': 'tm-logo', 'aria-hidden': 'true' }, '▶'),
      ctx.link('/', data.siteName || ctx.site.title || 'stream', 'tm-brandname')
    );
    bar.appendChild(brand);

    var search = el('form', { 'class': 'tm-search', role: 'search' });
    var input = el('input', {
      'class': 'tm-searchinput',
      type: 'text',
      'aria-label': 'Search videos',
      placeholder: 'Search'
    });
    var btn = el('button', { 'class': 'tm-searchbtn', type: 'submit' }, 'Search');
    var results = el('div', { 'class': 'tm-searchnote' });
    search.appendChild(input);
    search.appendChild(btn);
    search.addEventListener('submit', function (ev) {
      ev.preventDefault();
      while (results.firstChild) { results.removeChild(results.firstChild); }
      var q = input.value.replace(/^\s+|\s+$/g, '');
      if (!q) { return; }
      results.appendChild(document.createTextNode(
        'Search is handled by the recommendation model. It has decided you want the home feed.'
      ));
    });
    bar.appendChild(search);
    bar.appendChild(results);

    var online = el('div', { 'class': 'tm-online' });
    if (S.live && has(S.live.online)) {
      online.appendChild(document.createTextNode(
        commas(S.live.online(ctx.site.domain + ':stream', 9000, 41000)) + ' watching now'
      ));
    }
    bar.appendChild(online);
    return bar;
  }

  function sidebarNav(ctx, data) {
    var nav = el('nav', { 'class': 'tm-nav', 'aria-label': 'Channels' });
    nav.appendChild(el('h2', { 'class': 'tm-navhead' }, 'Channels'));
    var list = el('ul', { 'class': 'tm-navlist' });
    var chs = data.channels || [], i;
    for (i = 0; i < chs.length; i++) {
      var ch = chs[i];
      var li = el('li', { 'class': 'tm-navitem' });
      var a = ctx.link('/c/' + ch.id, '', 'tm-navlink');
      a.appendChild(el('span', { 'class': 'tm-navav' }, placeholder('avatar', ch.avatarSeed || ch.id)));
      var meta = el('span', { 'class': 'tm-navmeta' });
      var nameRow = el('span', { 'class': 'tm-navname' }, ch.name || ch.id);
      if (ch.verified) {
        nameRow.appendChild(el('span', { 'class': 'tm-verified', title: 'Verified' }, '✓'));
      }
      meta.appendChild(nameRow);
      meta.appendChild(el('span', { 'class': 'tm-navsubs' }, shortNum(
        counter(ctx.site.domain + ':subs:' + ch.id, ch.subs || 0, 420)
      ) + ' subs'));
      a.appendChild(meta);
      li.appendChild(a);
      var b = badge(ch.kind);
      if (b) { li.appendChild(b); }
      list.appendChild(li);
    }
    nav.appendChild(list);
    var ad = liveAd('box', ctx.site.domain + ':navad');
    if (ad) { nav.appendChild(el('div', { 'class': 'tm-adslot' }, ad)); }
    return nav;
  }

  function videoCard(ctx, data, v, cls) {
    var card = el('article', { 'class': 'tm-card' + (cls ? ' ' + cls : '') });
    var thumbLink = ctx.link('/w/' + v.id, '', 'tm-thumb');
    thumbLink.appendChild(placeholder('thumb', v.thumbSeed || v.id));
    thumbLink.appendChild(el('span', { 'class': 'tm-dur' }, v.duration || '0:00'));
    card.appendChild(thumbLink);

    var body = el('div', { 'class': 'tm-cardbody' });
    body.appendChild(ctx.link('/w/' + v.id, v.title || 'Untitled', 'tm-cardtitle'));

    var ch = findChannel(data, v.channelId);
    var by = el('div', { 'class': 'tm-cardby' });
    if (ch) {
      by.appendChild(ctx.link('/c/' + ch.id, ch.name || ch.id, 'tm-chlink'));
      if (ch.verified) {
        by.appendChild(el('span', { 'class': 'tm-verified', title: 'Verified' }, '✓'));
      }
    } else {
      by.appendChild(document.createTextNode('unknown channel'));
    }
    var vb = badge(v.kind);
    if (vb) { by.appendChild(vb); }
    body.appendChild(by);

    var views = counter(ctx.site.domain + ':views:' + v.id, v.views || 0, 5200);
    body.appendChild(el('div', { 'class': 'tm-cardmeta' },
      shortNum(views) + ' views',
      el('span', { 'class': 'tm-dot' }, '·'),
      ago(v.at)
    ));
    card.appendChild(body);
    return card;
  }

  /* ---------- live sidebar feed ---------- */

  function autoplayFeed(ctx, data, currentId) {
    var box = el('aside', { 'class': 'tm-up', 'aria-label': 'Up next' });
    var head = el('div', { 'class': 'tm-uphead' });
    head.appendChild(el('h2', { 'class': 'tm-uptitle' }, 'Up next'));
    var toggle = el('label', { 'class': 'tm-autoplay' });
    var cb = el('input', { type: 'checkbox', 'class': 'tm-autocb', checked: 'checked' });
    toggle.appendChild(cb);
    toggle.appendChild(el('span', { 'class': 'tm-autotxt' }, 'Autoplay'));
    head.appendChild(toggle);
    box.appendChild(head);

    var note = el('p', { 'class': 'tm-upnote' },
      'Autoplay is on. It has been on since 2024. The setting saves, the model does not read it.');
    box.appendChild(note);

    var vids = data.videos || [], list = [], i;
    for (i = 0; i < vids.length; i++) {
      if (String(vids[i].id) !== String(currentId)) { list.push(vids[i]); }
    }
    var ul = el('ul', { 'class': 'tm-uplist' });
    for (i = 0; i < list.length && i < 8; i++) {
      ul.appendChild(el('li', { 'class': 'tm-upitem' }, videoCard(ctx, data, list[i], 'tm-card-row')));
      if (i === 2) {
        var ad = liveAd('inline', ctx.site.domain + ':up:' + (currentId || 'home'));
        if (ad) { ul.appendChild(el('li', { 'class': 'tm-upitem tm-upad' }, ad)); }
      }
    }
    box.appendChild(ul);

    /* incoming uploads keep arriving */
    var pool = (S.slop && S.slop.mediaUploads) || [];
    var incoming = streamPool(ctx.site.domain + ':uploads', pool, 11, 6);
    if (incoming && incoming.length) {
      box.appendChild(el('h3', { 'class': 'tm-uptitle tm-uptitle2' }, 'Just uploaded'));
      var ul2 = el('ul', { 'class': 'tm-uplist tm-uplist-thin' });
      for (i = 0; i < incoming.length; i++) {
        var it = incoming[i];
        var text = typeof it === 'string' ? it : (it.title || it.text || it.body || 'Untitled upload');
        var seed = ctx.site.domain + ':inc:' + i + ':' + text;
        var li = el('li', { 'class': 'tm-upitem tm-incoming' });
        var row = el('div', { 'class': 'tm-increw' });
        row.appendChild(el('span', { 'class': 'tm-incthumb' }, placeholder('thumb', seed)));
        var m = el('div', { 'class': 'tm-incmeta' });
        m.appendChild(el('div', { 'class': 'tm-inctitle' }, S.markup && has(S.markup.strip) ? S.markup.strip(text) : text));
        var sub = el('div', { 'class': 'tm-incsub' },
          shortNum(counter(seed, 40 + (hash32(seed) % 900), 3000)) + ' views');
        var kb = badge((typeof it === 'object' && it.kind) || 'bot');
        if (kb) { sub.appendChild(kb); }
        m.appendChild(sub);
        row.appendChild(m);
        li.appendChild(row);
        ul2.appendChild(li);
      }
      box.appendChild(ul2);
    }
    return box;
  }

  /* ---------- pages ---------- */

  function pageIndex(ctx, data) {
    ctx.title(data.siteName || ctx.site.title || 'stream');

    var wrap = el('div', { 'class': 'tm-page tm-page-home' });

    var topAd = liveAd('banner', ctx.site.domain + ':home');
    if (topAd) { wrap.appendChild(el('div', { 'class': 'tm-adslot tm-adbanner' }, topAd)); }

    var shell = el('div', { 'class': 'tm-shell' });
    shell.appendChild(sidebarNav(ctx, data));

    var main = el('main', { 'class': 'tm-main' });

    var mineHost = null;
    if (S.compose && has(S.compose.myPosts)) {
      mineHost = el('section', { 'class': 'tm-mine' });
      var mine = S.compose.myPosts(ctx, ctx.site.domain);
      if (mine && mine.nodeType) { mineHost.appendChild(mine); }
    }

    if (S.compose && has(S.compose.box)) {
      var box = S.compose.box(ctx, ctx.site.domain, function () {
        if (!mineHost) { return; }
        while (mineHost.firstChild) { mineHost.removeChild(mineHost.firstChild); }
        var again = S.compose.myPosts(ctx, ctx.site.domain);
        if (again && again.nodeType) { mineHost.appendChild(again); }
      });
      if (box && box.nodeType) {
        main.appendChild(el('div', { 'class': 'tm-compose' },
          el('h2', { 'class': 'tm-h2' }, 'Upload'),
          box));
      }
    }
    if (mineHost) { main.appendChild(mineHost); }

    var chipRow = el('div', { 'class': 'tm-chips' });
    var chipNames = ['All', 'Verity County', 'Live', 'Auto-generated', 'From 2007', 'Music'];
    for (var c = 0; c < chipNames.length; c++) {
      chipRow.appendChild(el('span', {
        'class': 'tm-chip' + (c === 0 ? ' tm-chip-on' : '')
      }, chipNames[c]));
    }
    main.appendChild(chipRow);

    main.appendChild(el('h1', { 'class': 'tm-h1' }, 'Recommended'));

    var grid = el('div', { 'class': 'tm-grid' });
    var vids = data.videos || [], i;
    for (i = 0; i < vids.length; i++) {
      grid.appendChild(videoCard(ctx, data, vids[i]));
      if (i === 3) {
        var mid = liveAd('box', ctx.site.domain + ':grid');
        if (mid) { grid.appendChild(el('div', { 'class': 'tm-card tm-card-ad' }, mid)); }
      }
    }
    main.appendChild(grid);

    shell.appendChild(main);
    shell.appendChild(autoplayFeed(ctx, data, null));
    wrap.appendChild(shell);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  function pageWatch(ctx, data, id) {
    var v = findVideo(data, id);
    if (!v) { return notFound(ctx, data); }
    ctx.title(v.title || 'video');

    var wrap = el('div', { 'class': 'tm-page tm-page-watch' });
    var shell = el('div', { 'class': 'tm-shell tm-shell-watch' });
    var main = el('main', { 'class': 'tm-main' });

    /* honest placeholder player */
    var player = el('div', { 'class': 'tm-player' });
    var stage = el('div', { 'class': 'tm-stage' });
    stage.appendChild(placeholder('banner', v.thumbSeed || v.id));
    stage.appendChild(el('div', { 'class': 'tm-stagenote' },
      el('span', { 'class': 'tm-playglyph', 'aria-hidden': 'true' }, '▶'),
      el('span', { 'class': 'tm-stagetext' }, 'No video here. There never was.')
    ));
    player.appendChild(stage);

    var scrub = el('div', { 'class': 'tm-scrub' });
    var fill = el('div', { 'class': 'tm-scrubfill' });
    scrub.appendChild(fill);
    player.appendChild(scrub);
    var controls = el('div', { 'class': 'tm-controls' });
    controls.appendChild(el('span', { 'class': 'tm-ctl' }, '▶'));
    controls.appendChild(el('span', { 'class': 'tm-ctl' }, '⏭'));
    controls.appendChild(el('span', { 'class': 'tm-time' }, '0:00 / ' + (v.duration || '0:00')));
    controls.appendChild(el('span', { 'class': 'tm-ctlspace' }));
    controls.appendChild(el('span', { 'class': 'tm-ctl' }, '1x'));
    controls.appendChild(el('span', { 'class': 'tm-ctl' }, 'HD'));
    controls.appendChild(el('span', { 'class': 'tm-ctl' }, '⛶'));
    player.appendChild(controls);
    main.appendChild(player);

    main.appendChild(el('h1', { 'class': 'tm-vtitle' }, v.title || 'Untitled'));

    var views = counter(ctx.site.domain + ':views:' + v.id, v.views || 0, 5200);
    var likes = counter(ctx.site.domain + ':likes:' + v.id, v.likes || 0, 260);

    var stats = el('div', { 'class': 'tm-vstats' });
    stats.appendChild(el('span', { 'class': 'tm-vstat' }, commas(views) + ' views'));
    stats.appendChild(el('span', { 'class': 'tm-dot' }, '·'));
    stats.appendChild(el('span', { 'class': 'tm-vstat' }, ago(v.at)));
    var vb = badge(v.kind);
    if (vb) { stats.appendChild(vb); }
    main.appendChild(stats);

    var actions = el('div', { 'class': 'tm-actions' });
    actions.appendChild(el('span', { 'class': 'tm-act' }, '▲ ' + shortNum(likes)));
    actions.appendChild(el('span', { 'class': 'tm-act' }, '▼'));
    actions.appendChild(el('span', { 'class': 'tm-act' }, 'Share'));
    actions.appendChild(el('span', { 'class': 'tm-act' }, 'Save'));
    actions.appendChild(el('span', { 'class': 'tm-act tm-act-dim' }, 'Report · queued'));
    main.appendChild(actions);

    /* channel strip */
    var ch = findChannel(data, v.channelId);
    if (ch) {
      var strip = el('div', { 'class': 'tm-chstrip' });
      var av = ctx.link('/c/' + ch.id, '', 'tm-chav');
      av.appendChild(placeholder('avatar', ch.avatarSeed || ch.id));
      strip.appendChild(av);
      var cm = el('div', { 'class': 'tm-chmeta' });
      var nm = el('div', { 'class': 'tm-chname' });
      nm.appendChild(ctx.link('/c/' + ch.id, ch.name || ch.id, 'tm-chlink'));
      if (ch.verified) { nm.appendChild(el('span', { 'class': 'tm-verified' }, '✓')); }
      var cb2 = badge(ch.kind);
      if (cb2) { nm.appendChild(cb2); }
      cm.appendChild(nm);
      cm.appendChild(el('div', { 'class': 'tm-chsubs' }, shortNum(
        counter(ctx.site.domain + ':subs:' + ch.id, ch.subs || 0, 420)
      ) + ' subscribers'));
      strip.appendChild(cm);
      strip.appendChild(el('span', { 'class': 'tm-subbtn' }, 'Subscribe'));
      main.appendChild(strip);
    }

    var desc = el('div', { 'class': 'tm-desc' });
    desc.appendChild(parseBody(v.description || ''));
    main.appendChild(desc);

    var midAd = liveAd('inline', ctx.site.domain + ':watch:' + v.id);
    if (midAd) { main.appendChild(el('div', { 'class': 'tm-adslot tm-adinline' }, midAd)); }

    /* comments */
    var comments = v.comments || [];
    var live = streamPool(
      ctx.site.domain + ':cmt:' + v.id,
      (S.slop && S.slop.mediaComments) || [],
      7, 6
    );
    var csec = el('section', { 'class': 'tm-comments' });
    csec.appendChild(el('h2', { 'class': 'tm-h2' },
      commas(comments.length + (live ? live.length : 0)) + ' comments'));
    csec.appendChild(el('p', { 'class': 'tm-cnote' },
      'Comment ranking: engagement. Human comments appear below the fold by design.'));

    var clist = el('ul', { 'class': 'tm-clist' });
    var i;
    for (i = 0; i < comments.length; i++) {
      clist.appendChild(commentItem(ctx, comments[i], ctx.site.domain + ':c:' + v.id + ':' + i));
    }
    if (live) {
      for (i = 0; i < live.length; i++) {
        /* SYNTH.live.stream() yields wrappers -- {slot, at, item, seed} --
         * not the pooled entries themselves. Treating the wrapper as the
         * entry meant every field lookup missed and the fallback stringified
         * an object, so every live comment on every video read
         * "[object Object]". */
        var wrapped = live[i];
        var lc = (wrapped && wrapped.item !== undefined) ? wrapped.item : wrapped;
        var lcAt = (wrapped && wrapped.at) ? wrapped.at : nowMs();
        var obj = typeof lc === 'string'
          ? { by: 'guest_' + (hash32(lc) % 9000), kind: 'bot', body: lc, likes: 0, at: nowMs() }
          : lc;
        clist.appendChild(commentItem(ctx, {
          by: obj.by || obj.author || 'anon',
          kind: obj.kind || 'bot',
          body: obj.body || obj.text || String(lc),
          likes: obj.likes || 0,
          at: obj.at || lcAt
        }, ctx.site.domain + ':lc:' + v.id + ':' + i));
      }
    }
    csec.appendChild(clist);
    main.appendChild(csec);

    shell.appendChild(main);
    shell.appendChild(autoplayFeed(ctx, data, v.id));
    wrap.appendChild(shell);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  function commentItem(ctx, c, seed) {
    var li = el('li', { 'class': 'tm-citem' });
    li.appendChild(el('span', { 'class': 'tm-cav' }, placeholder('avatar', c.by || seed)));
    var body = el('div', { 'class': 'tm-cbody' });
    var head = el('div', { 'class': 'tm-chead' });
    head.appendChild(el('span', { 'class': 'tm-cby' }, c.by || 'anon'));
    var b = badge(c.kind);
    if (b) { head.appendChild(b); }
    head.appendChild(el('span', { 'class': 'tm-cwhen' }, ago(c.at || nowMs())));
    body.appendChild(head);
    var text = el('div', { 'class': 'tm-ctext' });
    text.appendChild(parseBody(c.body || ''));
    body.appendChild(text);
    body.appendChild(el('div', { 'class': 'tm-cfoot' },
      '▲ ' + shortNum(counter(seed, c.likes || 0, 90)),
      el('span', { 'class': 'tm-dot' }, '·'),
      'Reply'
    ));
    li.appendChild(body);
    return li;
  }

  function pageChannel(ctx, data, id) {
    var ch = findChannel(data, id);
    if (!ch) { return notFound(ctx, data); }
    ctx.title(ch.name || 'channel');

    var wrap = el('div', { 'class': 'tm-page tm-page-channel' });

    var banner = el('div', { 'class': 'tm-banner' });
    banner.appendChild(placeholder('banner', 'ch:' + (ch.avatarSeed || ch.id)));
    wrap.appendChild(banner);

    var head = el('header', { 'class': 'tm-chhead' });
    head.appendChild(el('span', { 'class': 'tm-chheadav' }, placeholder('avatar', ch.avatarSeed || ch.id)));
    var hm = el('div', { 'class': 'tm-chheadmeta' });
    var h1 = el('h1', { 'class': 'tm-h1' }, ch.name || ch.id);
    if (ch.verified) { h1.appendChild(el('span', { 'class': 'tm-verified' }, '✓')); }
    var chb = badge(ch.kind);
    if (chb) { h1.appendChild(chb); }
    hm.appendChild(h1);
    hm.appendChild(el('div', { 'class': 'tm-chsubs' },
      shortNum(counter(ctx.site.domain + ':subs:' + ch.id, ch.subs || 0, 420)) + ' subscribers'));
    if (S.live && has(S.live.online)) {
      hm.appendChild(el('div', { 'class': 'tm-chonline' },
        commas(S.live.online(ctx.site.domain + ':ch:' + ch.id, 30, 2400)) + ' viewers on this channel right now'));
    }
    var about = el('div', { 'class': 'tm-chabout' });
    about.appendChild(parseBody(ch.about || ''));
    hm.appendChild(about);
    head.appendChild(hm);
    head.appendChild(el('span', { 'class': 'tm-subbtn' }, 'Subscribe'));
    wrap.appendChild(head);

    var ad = liveAd('banner', ctx.site.domain + ':ch:' + ch.id);
    if (ad) { wrap.appendChild(el('div', { 'class': 'tm-adslot tm-adbanner' }, ad)); }

    var shell = el('div', { 'class': 'tm-shell' });
    var main = el('main', { 'class': 'tm-main' });
    main.appendChild(el('h2', { 'class': 'tm-h2' }, 'Videos'));
    var mine = videosOf(data, ch.id);
    if (!mine.length) {
      main.appendChild(el('p', { 'class': 'tm-empty' },
        'This channel has published nothing a person made. The upload queue is still running.'));
    } else {
      var grid = el('div', { 'class': 'tm-grid' });
      for (var i = 0; i < mine.length; i++) {
        grid.appendChild(videoCard(ctx, data, mine[i]));
        if (i === 2) {
          var inAd = liveAd('box', ctx.site.domain + ':chgrid:' + ch.id);
          if (inAd) { grid.appendChild(el('div', { 'class': 'tm-card tm-card-ad' }, inAd)); }
        }
      }
      main.appendChild(grid);
    }
    shell.appendChild(main);
    shell.appendChild(autoplayFeed(ctx, data, null));
    wrap.appendChild(shell);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  function footer(ctx, data) {
    var f = el('footer', { 'class': 'tm-foot' });
    f.appendChild(el('p', { 'class': 'tm-footline' },
      (data.siteName || 'stream') + ' · Verity County · 2026'));
    f.appendChild(el('p', { 'class': 'tm-footline tm-footdim' },
      'Recommendations generated automatically. Watch history is retained indefinitely and cannot be viewed.'));
    var links = ctx.site.links || [];
    if (links.length) {
      var row = el('p', { 'class': 'tm-footlinks' });
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        row.appendChild(parseBody('[url=synth://' + (l.domain || l.href || '') + ']' +
          (l.label || l.domain || 'link') + '[/url]'));
        if (i < links.length - 1) { row.appendChild(el('span', { 'class': 'tm-dot' }, '·')); }
      }
      f.appendChild(row);
    }
    return f;
  }

  function notFound(ctx, data) {
    ctx.title('404');
    var wrap = el('div', { 'class': 'tm-page tm-page-404' });
    var box = el('div', { 'class': 'tm-404' });
    box.appendChild(el('div', { 'class': 'tm-404glyph', 'aria-hidden': 'true' }, '▶'));
    box.appendChild(el('h1', { 'class': 'tm-h1' }, 'This video is unavailable'));
    box.appendChild(el('p', { 'class': 'tm-404p' },
      'It may have been removed, made private, or generated and then un-generated.'));
    box.appendChild(ctx.link('/', 'Back to home feed', 'tm-btn'));
    wrap.appendChild(box);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  /* ---------- registration ---------- */

  S.render.register('stream', function (ctx) {
    var data = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    ctx.mount.appendChild(header(ctx, data));

    if (S.liveui && has(S.liveui.onlineBar)) {
      var bar = S.liveui.onlineBar(ctx.site.domain, 9000, 41000);
      if (bar) { ctx.mount.appendChild(el('div', { 'class': 'tm-onlinebar' }, bar)); }
    }

    if (!p.length) { return pageIndex(ctx, data); }
    if (p[0] === 'w' && p[1]) { return pageWatch(ctx, data, p[1]); }
    if (p[0] === 'c' && p[1]) { return pageChannel(ctx, data, p[1]); }
    return notFound(ctx, data);
  });
}());
