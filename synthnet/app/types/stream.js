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

  /* Built-in pool plus anything imported content packs add under the same
   * name. Goes through live.js so packs reach every renderer at once. */
  function poolOf(name) {
    if (S.live && has(S.live.pool)) { return S.live.pool(name); }
    return (S.slop && S.slop[name]) || [];
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

  /* One line, stripped and cut. Shared, because every renderer that rolled
   * its own reached for `body` before `headline` and printed a whole article
   * where a title goes. */
  function titleOf(item, fallback) {
    if (S.live && typeof S.live.titleOf === 'function') {
      return S.live.titleOf(item, fallback);
    }
    if (typeof item === 'string') { return item; }
    return (item && (item.title || item.headline || item.body)) || fallback || '';
  }

  function parseBody(text) {
    if (S.markup && has(S.markup.parse)) { return S.markup.parse(text || ''); }
    return document.createTextNode(text || '');
  }

  /* Empty a node and put one run of children in it. Used everywhere a
   * control repaints itself, which is now most of them. */
  function setKids(node, kids) {
    var i;
    while (node.firstChild) { node.removeChild(node.firstChild); }
    for (i = 0; i < kids.length; i++) {
      if (kids[i] === null || kids[i] === undefined) { continue; }
      node.appendChild(kids[i].nodeType ? kids[i] : document.createTextNode(String(kids[i])));
    }
    return node;
  }

  /* ---------- what this browser remembers ----------
   *
   * Four records, all of them per site, none of them content: which channels
   * you subscribe to, which videos you kept, which way you voted, and whether
   * you left autoplay on. Subscriptions go through SYNTH.alerts because that
   * is where the Feeds page looks; the rest are this renderer's own and sit
   * in SYNTH.store beside everything else the browser keeps.
   */

  var SAVED = 'streamsaved';    /* "<domain>/<videoId>" -> {at}          */
  var VOTES = 'streamvotes';    /* "<domain>/<videoId>" -> 'up' | 'down' */
  var RAISED = 'streamwatch';   /* "<domain>" -> 1, see syncDomainWatch  */
  var AUTO = 'streamautoplay';  /* "<domain>" -> 0, only ever the off    */

  function swallow(p) {
    try { Promise.resolve(p).then(null, function () { /* stored or not */ }); }
    catch (e) { /* no promises, no storage, still a working page */ }
  }

  function alertsApi() {
    var A = S.alerts;
    return (A && has(A.levelFor) && has(A.subscribe) && has(A.unsubscribe)) ? A : null;
  }

  function storeApi() {
    var st = S.store;
    return (st && has(st.get) && has(st.put) && has(st.del)) ? st : null;
  }

  function rowKey(ctx, id) { return ctx.site.domain + '/' + String(id); }

  function isSubbed(ctx, channelId) {
    var A = alertsApi();
    if (!A) { return false; }
    try { return A.levelFor('channel', rowKey(ctx, channelId)) === 'watching'; }
    catch (e) { return false; }
  }

  function subbedChannels(ctx, data) {
    var chs = data.channels || [], out = [], i;
    for (i = 0; i < chs.length; i++) {
      if (isSubbed(ctx, chs[i].id)) { out.push(chs[i]); }
    }
    return out;
  }

  /* The alert layer counts unread per SITE, because a visit record is per
   * site -- so a channel subscription has to be said at the domain level too
   * or the Feeds page never hears about it. It is only ever moved from the
   * default up to 'watching', and only moved back down if this is what put
   * it there: a level you set by hand on the Feeds page is yours, and the
   * marker below is how this tells the difference. */
  function syncDomainWatch(ctx, data) {
    var A = alertsApi(), st = storeApi(), level;
    if (!A) { return; }
    try { level = A.levelFor('domain', ctx.site.domain); } catch (e) { return; }
    var any = subbedChannels(ctx, data).length > 0;
    var mine = st ? !!st.get(RAISED, ctx.site.domain, null) : false;
    if (any && level === 'normal') {
      swallow(A.subscribe('domain', ctx.site.domain, 'watching'));
      if (st) { swallow(st.put(RAISED, ctx.site.domain, 1)); }
    } else if (!any && mine && level === 'watching') {
      swallow(A.unsubscribe('domain', ctx.site.domain));
      if (st) { swallow(st.del(RAISED, ctx.site.domain)); }
    }
  }

  function isSaved(ctx, id) {
    var st = storeApi();
    return st ? !!st.get(SAVED, rowKey(ctx, id), null) : false;
  }

  function setSaved(ctx, id, on) {
    var st = storeApi();
    if (!st) { return; }
    if (on) { swallow(st.put(SAVED, rowKey(ctx, id), { at: nowMs() })); }
    else { swallow(st.del(SAVED, rowKey(ctx, id))); }
  }

  function savedVideos(ctx, data) {
    var vids = data.videos || [], rows = [], out = [], st = storeApi(), i, row;
    if (!st) { return out; }
    for (i = 0; i < vids.length; i++) {
      row = st.get(SAVED, rowKey(ctx, vids[i].id), null);
      if (row) { rows.push({ v: vids[i], at: (row && row.at) || 0 }); }
    }
    rows.sort(function (a, b) { return b.at - a.at; });
    for (i = 0; i < rows.length; i++) { out.push(rows[i].v); }
    return out;
  }

  function voteOf(ctx, id) {
    var st = storeApi();
    var v = st ? st.get(VOTES, rowKey(ctx, id), '') : '';
    return (v === 'up' || v === 'down') ? v : '';
  }

  function setVote(ctx, id, v) {
    var st = storeApi();
    if (!st) { return; }
    if (v === 'up' || v === 'down') { swallow(st.put(VOTES, rowKey(ctx, id), v)); }
    else { swallow(st.del(VOTES, rowKey(ctx, id))); }
  }

  /* Autoplay defaults on, so only the off is worth a row. */
  function autoplayOn(ctx) {
    var st = storeApi();
    return st ? st.get(AUTO, ctx.site.domain, 1) !== 0 : true;
  }

  function setAutoplay(ctx, on) {
    var st = storeApi();
    if (!st) { return; }
    if (on) { swallow(st.del(AUTO, ctx.site.domain)); }
    else { swallow(st.put(AUTO, ctx.site.domain, 0)); }
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

  /* ---------- search ----------
   *
   * The box in the bar used to print a line about the recommendation model
   * having decided you want the home feed, and do nothing else. The site
   * ships its own catalogue -- channels, titles, descriptions -- so the box
   * can search that, and hand the rest to the browser's own index.
   */

  function textHit(hay, terms) {
    var low = String(hay || '').toLowerCase(), i;
    for (i = 0; i < terms.length; i++) {
      if (low.indexOf(terms[i]) < 0) { return false; }
    }
    return true;
  }

  function searchResults(ctx, data, q) {
    var terms = q.toLowerCase().split(/\s+/), i;
    var chs = data.channels || [], vids = data.videos || [];
    var hitC = [], hitV = [];
    for (i = 0; i < chs.length; i++) {
      if (textHit((chs[i].name || '') + ' ' + (chs[i].about || ''), terms)) { hitC.push(chs[i]); }
    }
    for (i = 0; i < vids.length; i++) {
      if (textHit((vids[i].title || '') + ' ' + (vids[i].description || ''), terms)) { hitV.push(vids[i]); }
    }

    /* The head used to print the size of the whole hit set over a list that
     * stops at four channels and eight videos, with no more-link and no
     * pagination -- so "31 matches" sat on top of twelve rows and that was
     * all there was. Count what is rendered, and name the remainder. */
    var capC = Math.min(hitC.length, 4), capV = Math.min(hitV.length, 8);
    var shown = capC + capV;
    var n = hitC.length + hitV.length;
    var box = el('div', { 'class': 'tm-results' });
    box.appendChild(el('div', { 'class': 'tm-resulthead' },
      !n ? ('Nothing on this site matches “' + q + '”.')
        : shown < n
          ? (shown + ' of ' + n + ' matches on this site for “' + q + '”')
          : (n + (n === 1 ? ' match' : ' matches') + ' on this site for “' + q + '”')));

    var ul = el('ul', { 'class': 'tm-resultlist' });
    for (i = 0; i < capC; i++) {
      ul.appendChild(el('li', { 'class': 'tm-resultitem' },
        ctx.link('/c/' + hitC[i].id, hitC[i].name || hitC[i].id, 'tm-resultlink'),
        el('span', { 'class': 'tm-resultkind' }, 'channel')));
    }
    for (i = 0; i < capV; i++) {
      ul.appendChild(el('li', { 'class': 'tm-resultitem' },
        ctx.link('/w/' + hitV[i].id, titleOf(hitV[i], 'Untitled'), 'tm-resultlink'),
        el('span', { 'class': 'tm-resultkind' }, hitV[i].duration || '')));
    }
    if (ul.firstChild) { box.appendChild(ul); }

    box.appendChild(el('div', { 'class': 'tm-resultfoot' },
      'Titles and descriptions on this site only. ',
      ctx.link('synth://search.verity.net/?q=' + encodeURIComponent(q),
               'Search the whole network', 'tm-resultlink')));
    return box;
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
      var q = input.value.replace(/^\s+|\s+$/g, '');
      setKids(results, q ? [searchResults(ctx, data, q)] : []);
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
      /* Same arithmetic as the channel header. Drawing the raw counter here
       * made the rail say "860 subs" on the front page while the channel
       * page said "861 subscribers · including you" -- one fact, two
       * numbers, one press apart. */
      meta.appendChild(el('span', { 'class': 'tm-navsubs' },
        shortNum(subsTotal(ctx, ch)) + ' subs'));
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

  /* ---------- subscribing ----------
   *
   * This was a span reading "Subscribe" on every channel and every watch
   * page, and it was the one dead control here that could simply be made
   * true: both ClipVault sites are live in 2026, SYNTH.alerts already keeps
   * subscriptions, and the browser's Feeds page already reads them back.
   *
   * The count next to it goes up by one when you press it, because that is
   * what your subscription does to the count -- and it says "including you"
   * as well, because at 418,000 subscribers rounded to three figures your
   * one is arithmetically real and completely invisible.
   */

  /* The site's own count plus you, if you are one of them. Every place that
   * prints a subscriber number goes through here, so they cannot disagree. */
  function subsTotal(ctx, ch) {
    return counter(ctx.site.domain + ':subs:' + ch.id, ch.subs || 0, 420) +
           (isSubbed(ctx, ch.id) ? 1 : 0);
  }

  function subsCount(ctx, ch, suffix) {
    var node = el('div', { 'class': 'tm-chsubs' });
    function paint() {
      var on = isSubbed(ctx, ch.id);
      setKids(node, [shortNum(subsTotal(ctx, ch)) + suffix + (on ? ' · including you' : '')]);
    }
    paint();
    return { node: node, paint: paint };
  }

  function subscribeControl(ctx, data, ch, onChange) {
    if (!alertsApi()) { return null; }     /* no store, no promise to make */
    var wrap = el('div', { 'class': 'tm-subwrap' });
    var btn = el('button', { type: 'button', 'class': 'tm-subbtn' });
    var note = el('div', { 'class': 'tm-subnote' });

    function paint() {
      var on = isSubbed(ctx, ch.id);
      setKids(btn, [on ? 'Subscribed' : 'Subscribe']);
      btn.setAttribute('class', 'tm-subbtn' + (on ? ' tm-subbtn-on' : ''));
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label',
        (on ? 'Subscribed to ' : 'Subscribe to ') + (ch.name || ch.id));
      setKids(note, on
        ? ['New uploads here are counted in ',
           ctx.link('synth://feeds.verity.net/?t=sites', 'Feeds', 'tm-subnotelink'),
           '.']
        : []);
    }

    btn.addEventListener('click', function () {
      var A = alertsApi();
      if (!A) { return; }
      var key = rowKey(ctx, ch.id);
      swallow(isSubbed(ctx, ch.id)
        ? A.unsubscribe('channel', key)
        : A.subscribe('channel', key, 'watching'));
      syncDomainWatch(ctx, data);
      paint();
      if (onChange) { onChange(); }
    }, false);

    paint();
    wrap.appendChild(btn);
    wrap.appendChild(note);
    return wrap;
  }

  /* ---------- live sidebar feed ---------- */

  function autoplayFeed(ctx, data, currentId) {
    var box = el('aside', { 'class': 'tm-up', 'aria-label': 'Up next' });
    var head = el('div', { 'class': 'tm-uphead' });
    head.appendChild(el('h2', { 'class': 'tm-uptitle' }, 'Up next'));
    var toggle = el('label', { 'class': 'tm-autoplay' });
    var on = autoplayOn(ctx);
    var cb = el('input', { type: 'checkbox', 'class': 'tm-autocb', checked: on });
    cb.checked = on;
    toggle.appendChild(cb);
    toggle.appendChild(el('span', { 'class': 'tm-autotxt' }, 'Autoplay'));
    head.appendChild(toggle);
    box.appendChild(head);

    /* The note used to say "the setting saves" while nothing stored it: the
     * box came back ticked on the next watch page because it was drawn
     * ticked, every time. It saves now -- per site, in this browser -- and
     * the note says which half of the sentence the site is responsible for. */
    var note = el('p', { 'class': 'tm-upnote' });
    function paintNote() {
      setKids(note, [cb.checked
        ? 'Autoplay is on. It has been on since 2024. The setting is kept by this browser; the model does not read it.'
        : 'Autoplay is off, and this browser will remember that. The list below is the same list either way -- the model never read the setting.']);
    }
    cb.addEventListener('change', function () {
      setAutoplay(ctx, cb.checked);
      paintNote();
    }, false);
    paintNote();
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
    var pool = poolOf('mediaUploads');
    var incoming = streamPool(ctx.site.domain + ':uploads', pool, 11, 6);
    if (incoming && incoming.length) {
      box.appendChild(el('h3', { 'class': 'tm-uptitle tm-uptitle2' }, 'Just uploaded'));
      var ul2 = el('ul', { 'class': 'tm-uplist tm-uplist-thin' });
      for (i = 0; i < incoming.length; i++) {
        /* .item, not the row -- see the note on the live comments below.
         * This one fell through to the 'Untitled upload' fallback, so the
         * whole "Just uploaded" list was six identical placeholder rows. */
        var incRow = incoming[i];
        var it = (incRow && incRow.item !== undefined) ? incRow.item : incRow;
        var text = titleOf(it, 'Untitled upload');
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

  /* ---------- the home feed ----------
   *
   * The chip row was six words in pill shapes: All, Verity County, Live,
   * Auto-generated, From 2007, Music -- one of them highlighted as though it
   * were selected, none of them doing anything, and four of them describing
   * categories neither site actually has. They are now worked out from the
   * videos on the page, so a chip exists only if it names a real division of
   * what is here, and pressing it makes that division.
   */

  function durationSecs(v) {
    var parts = String(v.duration || '').split(':'), n = 0, i;
    if (!v.duration) { return 0; }
    for (i = 0; i < parts.length; i++) { n = n * 60 + (parseInt(parts[i], 10) || 0); }
    return n;
  }

  function videoText(v) {
    return ((v.title || '') + ' ' + (v.description || '')).toLowerCase();
  }

  function videoMs(v) {
    var t = Date.parse(v.at || '');
    return isFinite(t) ? t : 0;
  }

  function filterDefs(vids) {
    var cands = [
      { id: 'short', label: 'Under a minute',
        test: function (v) { var s = durationSecs(v); return s > 0 && s < 60; } },
      { id: 'long', label: 'Over five minutes',
        test: function (v) { return durationSecs(v) >= 300; } },
      { id: 'human', label: 'Made by a person',
        test: function (v) { return v.kind === 'human'; } },
      { id: 'auto', label: 'Generated',
        test: function (v) { return v.kind === 'bot' || v.kind === 'spam'; } },
      { id: 'fire', label: 'The substation',
        test: function (v) { return videoText(v).indexOf('substation') >= 0; } },
      { id: 'week', label: 'This week',
        test: function (v) {
          var t = videoMs(v);
          return t > 0 && (nowMs() - t) < 7 * 86400000;
        } }
    ];
    var out = [{ id: 'all', label: 'All', test: null }], i, j, n;
    for (i = 0; i < cands.length && out.length < 6; i++) {
      n = 0;
      for (j = 0; j < vids.length; j++) { if (cands[i].test(vids[j])) { n++; } }
      /* A chip that selects everything, or nothing, is a lie in a pill. */
      if (n > 0 && n < vids.length) { out.push(cands[i]); }
    }
    return out;
  }

  function feedSection(ctx, data) {
    var vids = data.videos || [];
    var defs = filterDefs(vids);
    var box = el('section', { 'class': 'tm-feed' });
    var head = el('h1', { 'class': 'tm-h1' }, 'Recommended');
    var note = el('div', { 'class': 'tm-filternote' });
    var grid = el('div', { 'class': 'tm-grid' });
    var current = 'all';
    var btns = [];
    var i;

    function draw() {
      var def = null, list = [], j;
      for (j = 0; j < defs.length; j++) { if (defs[j].id === current) { def = defs[j]; } }
      for (j = 0; j < vids.length; j++) {
        if (!def || !def.test || def.test(vids[j])) { list.push(vids[j]); }
      }

      setKids(head, [def && def.test ? def.label : 'Recommended']);
      setKids(note, [def && def.test
        ? (list.length + ' of ' + vids.length + ' on this page.')
        : (vids.length + ' videos, in the order the model put them in.')]);

      var kids = [];
      for (j = 0; j < list.length; j++) {
        kids.push(videoCard(ctx, data, list[j]));
        if (j === 3) {
          var mid = liveAd('box', ctx.site.domain + ':grid');
          if (mid) { kids.push(el('div', { 'class': 'tm-card tm-card-ad' }, mid)); }
        }
      }
      if (!kids.length) { kids.push(el('p', { 'class': 'tm-empty' }, 'Nothing on this page.')); }
      setKids(grid, kids);

      for (j = 0; j < btns.length; j++) {
        var on = defs[j].id === current;
        btns[j].setAttribute('class', 'tm-chip' + (on ? ' tm-chip-on' : ''));
        btns[j].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    /* One chip is not a filter row, it is a label. */
    if (defs.length > 1) {
      var chipRow = el('div', { 'class': 'tm-chips', role: 'group', 'aria-label': 'Filter this page' });
      for (i = 0; i < defs.length; i++) {
        btns.push((function (def) {
          var b = el('button', { type: 'button', 'class': 'tm-chip' }, def.label);
          b.addEventListener('click', function () { current = def.id; draw(); }, false);
          chipRow.appendChild(b);
          return b;
        }(defs[i])));
      }
      box.appendChild(chipRow);
    }

    box.appendChild(head);
    box.appendChild(note);
    box.appendChild(grid);
    draw();
    return box;
  }

  /* What subscribing got you: the channels you follow here, and what they
   * have put out. Derived from the same two lists the rest of the page is
   * drawn from, so it cannot go stale. */
  function subscriptionShelf(ctx, data) {
    var chans = subbedChannels(ctx, data);
    if (!chans.length) { return null; }

    var sec = el('section', { 'class': 'tm-shelf' });
    sec.appendChild(el('h2', { 'class': 'tm-h2' }, 'From your subscriptions'));

    var line = el('p', { 'class': 'tm-shelfnote' }, chans.length === 1
      ? 'One channel here: '
      : (chans.length + (chans.length === 1 ? ' channel here: ' : ' channels here: ')));
    var i;
    for (i = 0; i < chans.length; i++) {
      line.appendChild(ctx.link('/c/' + chans[i].id, chans[i].name || chans[i].id, 'tm-chlink'));
      if (i < chans.length - 1) { line.appendChild(el('span', { 'class': 'tm-dot' }, '·')); }
    }
    sec.appendChild(line);

    var list = [], j;
    for (i = 0; i < chans.length; i++) {
      var mine = videosOf(data, chans[i].id);
      for (j = 0; j < mine.length; j++) { list.push(mine[j]); }
    }
    list.sort(function (a, b) { return videoMs(b) - videoMs(a); });

    if (!list.length) {
      sec.appendChild(el('p', { 'class': 'tm-empty' },
        'Nothing from them on this page. The upload queue is still running.'));
      return sec;
    }
    var grid = el('div', { 'class': 'tm-grid' });
    for (i = 0; i < list.length && i < 6; i++) {
      grid.appendChild(videoCard(ctx, data, list[i]));
    }
    sec.appendChild(grid);
    return sec;
  }

  /* Where Save puts things. */
  function savedShelf(ctx, data) {
    if (!savedVideos(ctx, data).length) { return null; }

    var sec = el('section', { 'class': 'tm-shelf' });
    sec.appendChild(el('h2', { 'class': 'tm-h2' }, 'Saved'));
    sec.appendChild(el('p', { 'class': 'tm-shelfnote' },
      'Kept by this browser. ClipVault is not told and has no list of its own.'));
    var grid = el('div', { 'class': 'tm-grid' });

    function removeBtn(v) {
      var b = el('button', {
        type: 'button', 'class': 'tm-unsave',
        'aria-label': 'Remove ' + titleOf(v, 'this video') + ' from Saved'
      }, 'Remove');
      b.addEventListener('click', function () { setSaved(ctx, v.id, false); draw(); }, false);
      return b;
    }

    function draw() {
      var rows = savedVideos(ctx, data), kids = [], i, card;
      for (i = 0; i < rows.length && i < 8; i++) {
        card = videoCard(ctx, data, rows[i]);
        card.appendChild(removeBtn(rows[i]));
        kids.push(card);
      }
      if (!kids.length) {
        kids.push(el('p', { 'class': 'tm-empty' }, 'Nothing saved here now.'));
      }
      setKids(grid, kids);
    }

    draw();
    sec.appendChild(grid);
    return sec;
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

    var subs = subscriptionShelf(ctx, data);
    if (subs) { main.appendChild(subs); }
    var kept = savedShelf(ctx, data);
    if (kept) { main.appendChild(kept); }

    main.appendChild(feedSection(ctx, data));

    shell.appendChild(main);
    shell.appendChild(autoplayFeed(ctx, data, null));
    wrap.appendChild(shell);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  /* ---------- the row under a video ----------
   *
   * Five pills that were five spans: a like count you could not move, a
   * thumb-down, Share, Save, and "Report · queued" which announced a queue
   * nothing had been put in. All five keep a record now, and the line under
   * the row says what that record is and where it went -- which on a
   * platform with no accounts and nobody reading reports is the honest half
   * of the feature.
   */
  function watchActions(ctx, data, v, likes) {
    var box = el('div', { 'class': 'tm-actbox' });
    var row = el('div', { 'class': 'tm-actions' });
    var panel = el('div', { 'class': 'tm-panel', role: 'status' });
    var open = '';

    function show(key, kids) { open = key; setKids(panel, kids); }
    function clearIf(key) { if (open === key) { open = ''; setKids(panel, []); } }
    function toggle(key, kids) {
      if (open === key) { clearIf(key); } else { show(key, kids); }
    }

    var up = el('button', { type: 'button', 'class': 'tm-act' });
    var down = el('button', { type: 'button', 'class': 'tm-act' });
    var share = el('button', { type: 'button', 'class': 'tm-act' }, 'Share');
    var save = el('button', { type: 'button', 'class': 'tm-act' });
    var report = el('button', { type: 'button', 'class': 'tm-act' }, 'Report');

    function paintVotes() {
      var vote = voteOf(ctx, v.id);
      setKids(up, ['▲ ' + shortNum(likes + (vote === 'up' ? 1 : 0))]);
      setKids(down, ['▼']);
      up.setAttribute('class', 'tm-act' + (vote === 'up' ? ' tm-act-on' : ''));
      up.setAttribute('aria-pressed', vote === 'up' ? 'true' : 'false');
      up.setAttribute('aria-label', 'Like this video');
      down.setAttribute('class', 'tm-act' + (vote === 'down' ? ' tm-act-on' : ''));
      down.setAttribute('aria-pressed', vote === 'down' ? 'true' : 'false');
      down.setAttribute('aria-label', 'Dislike this video');
    }

    function paintSave() {
      var on = isSaved(ctx, v.id);
      setKids(save, [on ? 'Saved' : 'Save']);
      save.setAttribute('class', 'tm-act' + (on ? ' tm-act-on' : ''));
      save.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    up.addEventListener('click', function () {
      var on = voteOf(ctx, v.id) !== 'up';
      setVote(ctx, v.id, on ? 'up' : '');
      paintVotes();
      if (on) { show('vote', ['Counted. The number on the button is the site’s, plus you.']); }
      else { clearIf('vote'); }
    }, false);

    down.addEventListener('click', function () {
      var on = voteOf(ctx, v.id) !== 'down';
      setVote(ctx, v.id, on ? 'down' : '');
      paintVotes();
      if (on) { show('vote', ['Kept. This one is not shown to anybody, including you.']); }
      else { clearIf('vote'); }
    }, false);

    share.addEventListener('click', function () {
      toggle('share', [
        'The address is ',
        ctx.link('/w/' + v.id, 'synth://' + ctx.site.domain + '/w/' + v.id, 'tm-panellink'),
        '. There is nowhere off this network to send it to, and nothing here ' +
        'that can copy it for you.'
      ]);
    }, false);

    save.addEventListener('click', function () {
      var on = !isSaved(ctx, v.id);
      setSaved(ctx, v.id, on);
      paintSave();
      if (on) {
        show('save', ['Kept on the ', ctx.link('/', 'front page', 'tm-panellink'),
                      ' under Saved, by this browser and nowhere else.']);
      } else { clearIf('save'); }
    }, false);

    report.addEventListener('click', function () {
      var n = counter(ctx.site.domain + ':reports:' + v.id,
                      400 + (hash32(String(v.id)) % 9000), 140);
      toggle('report', ['Queued. ' + commas(n) + ' reports are ahead of yours on ' +
                        'this site, and nothing on this page says who reads one.']);
    }, false);

    paintVotes();
    paintSave();
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(share);
    row.appendChild(save);
    row.appendChild(report);
    box.appendChild(row);
    box.appendChild(panel);
    return box;
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

    /* The transport is a picture of a transport. There is no file behind it
     * and there never was, which the stage says in so many words, so it is
     * marked as decoration -- aria-hidden here, pointer-events off in the
     * skin -- rather than sitting there inviting a press that cannot do
     * anything. */
    var scrub = el('div', { 'class': 'tm-scrub', 'aria-hidden': 'true' });
    var fill = el('div', { 'class': 'tm-scrubfill' });
    scrub.appendChild(fill);
    player.appendChild(scrub);
    var controls = el('div', { 'class': 'tm-controls', 'aria-hidden': 'true' });
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

    main.appendChild(watchActions(ctx, data, v, likes));

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
      var count = subsCount(ctx, ch, ' subscribers');
      cm.appendChild(count.node);
      strip.appendChild(cm);
      var sub = subscribeControl(ctx, data, ch, count.paint);
      if (sub) { strip.appendChild(sub); }
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
      poolOf('mediaComments'),
      7, 6
    );
    var csec = el('section', { 'class': 'tm-comments' });
    csec.appendChild(el('h2', { 'class': 'tm-h2' },
      (function (n) {
        return commas(n) + (n === 1 ? ' comment' : ' comments');
      }(comments.length + (live ? live.length : 0)))));
    csec.appendChild(el('p', { 'class': 'tm-cnote' },
      'Comment ranking: engagement. Human comments appear below the fold by design.'));

    var clist = el('ul', { 'class': 'tm-clist' });
    var rows = [], i;
    for (i = 0; i < comments.length; i++) {
      rows.push(scoreComment(ctx, v.id, comments[i], 'c'));
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
        rows.push(scoreComment(ctx, v.id, {
          by: obj.by || obj.author || 'anon',
          kind: obj.kind || 'bot',
          body: obj.body || obj.text || String(lc),
          likes: obj.likes || 0,
          at: obj.at || lcAt
        }, 'lc'));
      }
    }
    /* The note above this list makes two claims, and the list used to keep
     * neither: nothing was sorted at all, and the authored humans rendered
     * first with the bot stream appended after -- the exact inverse of
     * "below the fold". Rank on the number each row actually prints, and
     * put the humans under the bots. */
    rows.sort(function (a, b) {
      if (a.human !== b.human) { return a.human ? 1 : -1; }
      if (b.n !== a.n) { return b.n - a.n; }
      return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });
    for (i = 0; i < rows.length; i++) {
      clist.appendChild(commentItem(ctx, rows[i]));
    }
    csec.appendChild(clist);
    main.appendChild(csec);

    shell.appendChild(main);
    shell.appendChild(autoplayFeed(ctx, data, v.id));
    wrap.appendChild(shell);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  /* The like seed used to carry the comment's position in the list, so the
   * same comment scored differently depending on where it sat -- and a sort
   * on that number would have chased its own tail. Key it on who said it,
   * when, and what, so the number rides with the comment. */
  function commentKey(ctx, vid, c, tag) {
    return ctx.site.domain + ':' + tag + ':' + vid + ':' +
      (c.by || 'anon') + '@' + (c.at || 0) + '#' + hash32(String(c.body || ''));
  }

  function scoreComment(ctx, vid, c, tag) {
    var key = commentKey(ctx, vid, c, tag);
    return {
      by: c.by, kind: c.kind, body: c.body, at: c.at,
      key: key,
      human: (c.kind || '') === 'human',
      n: counter(key, c.likes || 0, 90)
    };
  }

  function commentItem(ctx, c) {
    var seed = c.key;
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
      '▲ ' + shortNum(c.n),
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
    var count = subsCount(ctx, ch, ' subscribers');
    hm.appendChild(count.node);
    if (S.live && has(S.live.online)) {
      hm.appendChild(el('div', { 'class': 'tm-chonline' },
        commas(S.live.online(ctx.site.domain + ':ch:' + ch.id, 30, 2400)) + ' viewers on this channel right now'));
    }
    var about = el('div', { 'class': 'tm-chabout' });
    about.appendChild(parseBody(ch.about || ''));
    hm.appendChild(about);
    head.appendChild(hm);
    var sub = subscribeControl(ctx, data, ch, count.paint);
    if (sub) { head.appendChild(sub); }
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

  /* site.links is an array of domain STRINGS (the envelope in
     docs/AUTHORING.md, enforced by tools/validate.py). Reading it as
     objects is why this footer emitted `synth://` with no domain at all,
     labelled "link" -- the `l.domain || l.href || ''` fallback chain made
     the fault silent instead of printing "undefined" the way market.js and
     shop.js did. An object is still accepted in case a pack ships one. */
  function linkDomain(entry) {
    if (typeof entry === 'string') { return entry; }
    if (entry && typeof entry === 'object') {
      return String(entry.domain || entry.href || '');
    }
    return '';
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
        var dom = linkDomain(links[i]);
        if (!dom) { continue; }
        row.appendChild(parseBody('[url=synth://' + dom + ']' + dom + '[/url]'));
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
