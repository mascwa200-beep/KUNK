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

  function commas(n) {
    if (S.live && has(S.live.commas)) { return S.live.commas(n); }
    return String(n);
  }

  function shortNum(n) {
    if (S.live && has(S.live.short)) { return S.live.short(n); }
    return String(n);
  }

  function counter(key, base, perDay) {
    if (S.live && has(S.live.counter)) { return S.live.counter(key, base, perDay); }
    return base;
  }

  function hash32(str) {
    if (S.live && has(S.live.hash32)) { return S.live.hash32(str); }
    var h = 0, i;
    for (i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return h >>> 0;
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

  function strip(text) {
    if (S.markup && has(S.markup.strip)) { return S.markup.strip(text || ''); }
    return String(text || '');
  }

  function placeholder(kind, seed) {
    if (S.markup && has(S.markup.placeholder)) { return S.markup.placeholder(kind, seed); }
    return el('span', { 'class': 'gd-noimg' });
  }

  /* ---------- weather glyphs (text only, no external assets) ---------- */

  function skyGlyph(summary) {
    var s = String(summary || '').toLowerCase();
    if (s.indexOf('storm') >= 0 || s.indexOf('thunder') >= 0) { return '⚡'; }
    if (s.indexOf('snow') >= 0 || s.indexOf('sleet') >= 0) { return '❄'; }
    if (s.indexOf('rain') >= 0 || s.indexOf('shower') >= 0 || s.indexOf('drizzle') >= 0) { return '☔'; }
    if (s.indexOf('fog') >= 0 || s.indexOf('haze') >= 0 || s.indexOf('smoke') >= 0) { return '≈'; }
    if (s.indexOf('cloud') >= 0 || s.indexOf('overcast') >= 0) { return '☁'; }
    if (s.indexOf('wind') >= 0) { return '⤳'; }
    return '☀';
  }

  function statusClass(status) {
    var s = String(status || '').toLowerCase();
    if (s.indexOf('suspend') >= 0 || s.indexOf('cancel') >= 0 || s.indexOf('closed') >= 0 ||
        s.indexOf('down') >= 0 || s.indexOf('sever') >= 0) { return 'gd-bad'; }
    if (s.indexOf('delay') >= 0 || s.indexOf('minor') >= 0 || s.indexOf('reduced') >= 0 ||
        s.indexOf('partial') >= 0) { return 'gd-warn'; }
    return 'gd-ok';
  }

  function levelClass(level) {
    var s = String(level || '').toLowerCase();
    if (s.indexOf('sever') >= 0 || s.indexOf('emerg') >= 0 || s.indexOf('red') >= 0 ||
        s.indexOf('danger') >= 0) { return 'gd-alert-high'; }
    if (s.indexOf('warn') >= 0 || s.indexOf('amber') >= 0 || s.indexOf('watch') >= 0) { return 'gd-alert-mid'; }
    return 'gd-alert-low';
  }

  function trendGlyph(trend) {
    var s = String(trend || '').toLowerCase();
    if (s.indexOf('up') >= 0 || s.indexOf('ris') >= 0 || s.indexOf('high') >= 0) { return '▲'; }
    if (s.indexOf('down') >= 0 || s.indexOf('fall') >= 0 || s.indexOf('low') >= 0) { return '▼'; }
    return '▬';
  }

  /* ---------- sections ---------- */

  function header(ctx, data) {
    var head = el('header', { 'class': 'gd-head' });
    var top = el('div', { 'class': 'gd-headtop' });
    top.appendChild(el('h1', { 'class': 'gd-brand' },
      ctx.link('/', data.siteName || ctx.site.title || 'dash', 'gd-brandlink')));
    if (data.place) {
      top.appendChild(el('span', { 'class': 'gd-place' }, data.place));
    }
    head.appendChild(top);

    var meta = el('div', { 'class': 'gd-headmeta' });
    meta.appendChild(el('span', { 'class': 'gd-clock' }, 'Updated ' + ago(nowMs() - 60000)));
    if (S.live && has(S.live.online)) {
      meta.appendChild(el('span', { 'class': 'gd-dot' }, '·'));
      meta.appendChild(el('span', { 'class': 'gd-onlinecount' },
        commas(S.live.online(ctx.site.domain + ':dash', 300, 5200)) + ' people watching this page'));
    }
    var b = badge('bot');
    if (b) { meta.appendChild(b); }
    head.appendChild(meta);

    if (ctx.site.description) {
      head.appendChild(el('p', { 'class': 'gd-tag' }, ctx.site.description));
    }
    return head;
  }

  function alertsBar(ctx, data) {
    var alerts = data.alerts || [];
    if (!alerts.length) { return null; }
    var wrap = el('section', { 'class': 'gd-alerts', 'aria-label': 'Alerts' });
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var row = el('div', { 'class': 'gd-alert ' + levelClass(a.level) });
      row.appendChild(el('span', { 'class': 'gd-alertlevel' }, String(a.level || 'notice').toUpperCase()));
      var txt = el('span', { 'class': 'gd-alerttext' });
      txt.appendChild(parseBody(a.text || ''));
      row.appendChild(txt);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function weatherStrip(ctx, data) {
    var w = data.weather || {};
    var sec = el('section', { 'class': 'gd-weather', 'aria-label': 'Weather' });

    var now = el('div', { 'class': 'gd-wnow' });
    now.appendChild(el('span', { 'class': 'gd-wglyph', 'aria-hidden': 'true' }, skyGlyph(w.summary)));
    var nowMeta = el('div', { 'class': 'gd-wnowmeta' });
    nowMeta.appendChild(el('div', { 'class': 'gd-wtemp' },
      (w.nowC === undefined || w.nowC === null ? '--' : String(w.nowC)),
      el('span', { 'class': 'gd-wdeg' }, '°C')));
    nowMeta.appendChild(el('div', { 'class': 'gd-wsummary' }, w.summary || 'Conditions unavailable'));
    if (w.feelsC !== undefined && w.feelsC !== null) {
      nowMeta.appendChild(el('div', { 'class': 'gd-wfeels' }, 'Feels like ' + w.feelsC + '°C'));
    }
    now.appendChild(nowMeta);
    sec.appendChild(now);

    var days = w.days || [];
    if (days.length) {
      var strip = el('ul', { 'class': 'gd-wdays' });
      for (var i = 0; i < days.length; i++) {
        var d = days[i];
        var li = el('li', { 'class': 'gd-wday' });
        li.appendChild(el('span', { 'class': 'gd-wdayname' }, d.day || '--'));
        li.appendChild(el('span', { 'class': 'gd-wdayglyph', 'aria-hidden': 'true' }, skyGlyph(d.summary)));
        li.appendChild(el('span', { 'class': 'gd-wdaytemps' },
          el('span', { 'class': 'gd-whi' }, (d.hi === undefined ? '--' : d.hi) + '°'),
          el('span', { 'class': 'gd-wlo' }, (d.lo === undefined ? '--' : d.lo) + '°')
        ));
        li.appendChild(el('span', { 'class': 'gd-wdaysummary' }, d.summary || ''));
        strip.appendChild(li);
      }
      sec.appendChild(strip);
    }

    sec.appendChild(el('p', { 'class': 'gd-wnote' },
      'Forecast produced by model run ' + (hash32(ctx.site.domain + ':wx') % 900 + 100) +
      '. No station in Verity County has reported since the Gridfall sensor array was decommissioned.'));
    return sec;
  }

  function bigCard(title, value, sub, cls) {
    var card = el('article', { 'class': 'gd-card gd-card-big' + (cls ? ' ' + cls : '') });
    card.appendChild(el('h2', { 'class': 'gd-cardtitle' }, title));
    card.appendChild(el('div', { 'class': 'gd-big' }, value));
    if (sub) { card.appendChild(el('div', { 'class': 'gd-cardsub' }, sub)); }
    return card;
  }

  function numbersRow(ctx, data) {
    var row = el('section', { 'class': 'gd-grid gd-grid-nums', 'aria-label': 'Live numbers' });
    var dom = ctx.site.domain;

    var energy = data.energy || {};
    var eCard = el('article', { 'class': 'gd-card gd-card-big gd-card-energy' });
    eCard.appendChild(el('h2', { 'class': 'gd-cardtitle' }, 'Grid price'));
    eCard.appendChild(el('div', { 'class': 'gd-big' },
      (energy.price === undefined || energy.price === null ? '--' : String(energy.price)),
      el('span', { 'class': 'gd-unit' }, energy.unit || '')));
    eCard.appendChild(el('div', { 'class': 'gd-cardsub' },
      el('span', { 'class': 'gd-trend', 'aria-hidden': 'true' }, trendGlyph(energy.trend)),
      el('span', {}, ' ' + (energy.trend || 'flat'))));
    row.appendChild(eCard);

    row.appendChild(bigCard(
      'County load',
      commas(counter(dom + ':load', 418, 1900)) + ' MW',
      'Substation 4 (Gridfall) still carries the rebuilt bus from 2003.',
      'gd-card-load'
    ));

    row.appendChild(bigCard(
      'Requests served',
      shortNum(counter(dom + ':reqs', 12400000, 8400000)),
      'Roughly 97% of these are not people.',
      'gd-card-reqs'
    ));

    var onlineVal = (S.live && has(S.live.online))
      ? commas(S.live.online(dom + ':sessions', 240, 4800))
      : '--';
    row.appendChild(bigCard('Sessions open', onlineVal, 'Counted at the edge. Bots included.', 'gd-card-sessions'));

    return row;
  }

  function transitCard(ctx, data) {
    var card = el('article', { 'class': 'gd-card gd-card-transit' });
    card.appendChild(el('h2', { 'class': 'gd-cardtitle' }, 'Transit'));
    var lines = data.transit || [];
    if (!lines.length) {
      card.appendChild(el('p', { 'class': 'gd-empty' }, 'No services reporting.'));
      return card;
    }
    var ul = el('ul', { 'class': 'gd-transit' });
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i];
      var li = el('li', { 'class': 'gd-trow' });
      li.appendChild(el('span', { 'class': 'gd-troute' }, t.route || '--'));
      li.appendChild(el('span', { 'class': 'gd-tstatus ' + statusClass(t.status) }, t.status || 'unknown'));
      if (t.note) {
        var note = el('span', { 'class': 'gd-tnote' });
        note.appendChild(parseBody(t.note));
        li.appendChild(note);
      }
      ul.appendChild(li);
    }
    card.appendChild(ul);
    card.appendChild(el('p', { 'class': 'gd-cardfoot' },
      'Branch-line status has read the same since the Verity Rail closure. The feed is still billed monthly.'));
    return card;
  }

  function widgetCards(ctx, data) {
    var out = [];
    var widgets = data.widgets || [];
    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      var card = el('article', { 'class': 'gd-card gd-card-widget' });
      card.appendChild(el('h2', { 'class': 'gd-cardtitle' }, w.title || 'Widget'));
      var lines = w.lines || [];
      if (!lines.length) {
        card.appendChild(el('p', { 'class': 'gd-empty' }, 'No data.'));
      } else {
        var ul = el('ul', { 'class': 'gd-lines' });
        for (var j = 0; j < lines.length; j++) {
          var li = el('li', { 'class': 'gd-line' });
          li.appendChild(parseBody(lines[j]));
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }
      out.push(card);
    }
    return out;
  }

  function tickerCard(ctx, data) {
    var pool = poolOf('tickers');
    var items = streamPool(ctx.site.domain + ':ticker', pool, 4, 8);
    if (!items || !items.length) { return null; }
    var card = el('article', { 'class': 'gd-card gd-card-ticker' });
    card.appendChild(el('h2', { 'class': 'gd-cardtitle' }, 'County wire'));
    var ul = el('ul', { 'class': 'gd-ticker' });
    for (var i = 0; i < items.length; i++) {
      /* .item, not the row: SYNTH.live.stream yields {slot, at, item, seed}
       * wrappers. Reading .text off the wrapper is undefined, which is why
       * this card has been drawing blank lines since it shipped. */
      var row = items[i];
      var it = (row && row.item !== undefined) ? row.item : row;
      var text = titleOf(it, '');
      var kind = (typeof it === 'object' && it.kind) || 'bot';
      var seed = ctx.site.domain + ':tk:' + i + ':' + text;
      var li = el('li', { 'class': 'gd-tickitem' });
      li.appendChild(el('span', {
        'class': 'gd-tickwhen',
        'data-lv-ago': String((row && row.at) || (nowMs() - ((i + 1) * 240000)))
      }, ago((row && row.at) || (nowMs() - ((i + 1) * 240000)))));
      var tx = el('span', { 'class': 'gd-ticktext' });
      tx.appendChild(parseBody(text));
      li.appendChild(tx);
      var b = badge(kind);
      if (b) { li.appendChild(b); }
      li.appendChild(el('span', { 'class': 'gd-tickviews' },
        shortNum(counter(seed, 20 + (hash32(seed) % 400), 1800))));
      ul.appendChild(li);
    }
    card.appendChild(ul);
    return card;
  }

  function newsCard(ctx, data) {
    var pool = poolOf('newsItems');
    var items = streamPool(ctx.site.domain + ':news', pool, 9, 5);
    if (!items || !items.length) { return null; }
    var card = el('article', { 'class': 'gd-card gd-card-news' });
    card.appendChild(el('h2', { 'class': 'gd-cardtitle' }, 'Auto-filed reports'));
    var ul = el('ul', { 'class': 'gd-news' });
    for (var i = 0; i < items.length; i++) {
      /* Same wrapper unpacking as above. And `headline` first: a newsItem
       * has no `title`, so the old fallback chain would have reached `body`
       * and put a whole multi-paragraph article where a headline goes. */
      var nrow = items[i];
      var it = (nrow && nrow.item !== undefined) ? nrow.item : nrow;
      var title = titleOf(it, 'Untitled report');
      var kind = (typeof it === 'object' && it.kind) || 'bot';
      var li = el('li', { 'class': 'gd-newsitem' });
      li.appendChild(el('span', { 'class': 'gd-newsthumb' },
        placeholder('thumb', ctx.site.domain + ':nw:' + i + ':' + strip(title))));
      var m = el('div', { 'class': 'gd-newsmeta' });
      var t = el('div', { 'class': 'gd-newstitle' });
      t.appendChild(parseBody(title));
      m.appendChild(t);
      var sub = el('div', {
        'class': 'gd-newssub',
        'data-lv-ago': String((nrow && nrow.at) || (nowMs() - ((i + 1) * 1500000)))
      }, ago((nrow && nrow.at) || (nowMs() - ((i + 1) * 1500000))));
      var b = badge(kind);
      if (b) { sub.appendChild(b); }
      m.appendChild(sub);
      li.appendChild(m);
      ul.appendChild(li);
    }
    card.appendChild(ul);
    card.appendChild(el('p', { 'class': 'gd-cardfoot' },
      'Filed without a byline. No correction has ever been issued.'));
    return card;
  }

  function noticeCard(ctx, data) {
    var card = el('article', { 'class': 'gd-card gd-card-signal' });
    card.appendChild(el('h2', { 'class': 'gd-cardtitle' }, 'Unclassified carrier'));
    card.appendChild(el('div', { 'class': 'gd-big gd-big-small' }, '62.000 MHz'));
    card.appendChild(el('p', { 'class': 'gd-cardsub' },
      'Continuous. Five-figure groups. The dashboard logs it under "environmental noise" ' +
      'because there is no other field for it.'));
    return card;
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
    var f = el('footer', { 'class': 'gd-foot' });
    f.appendChild(el('p', { 'class': 'gd-footline' },
      (data.siteName || 'dash') + ' · ' + (data.place || 'Verity County') + ' · 2026'));
    f.appendChild(el('p', { 'class': 'gd-footline gd-footdim' },
      'Every figure on this page is produced by an automated pipeline. ' +
      'No operator has signed off on a reading since the maintenance contract lapsed.'));
    var links = ctx.site.links || [];
    if (links.length) {
      var row = el('p', { 'class': 'gd-footlinks' });
      for (var i = 0; i < links.length; i++) {
        var dom = linkDomain(links[i]);
        if (!dom) { continue; }
        row.appendChild(parseBody('[url=synth://' + dom + ']' + dom + '[/url]'));
        if (i < links.length - 1) { row.appendChild(el('span', { 'class': 'gd-dot' }, '·')); }
      }
      f.appendChild(row);
    }
    return f;
  }

  function notFound(ctx, data) {
    ctx.title('404');
    var wrap = el('div', { 'class': 'gd-page gd-page-404' });
    var card = el('div', { 'class': 'gd-card gd-404' });
    card.appendChild(el('h1', { 'class': 'gd-cardtitle gd-404title' }, 'No panel here'));
    card.appendChild(el('p', { 'class': 'gd-404p' },
      'This dashboard has exactly one page. Everything worth showing is already on it.'));
    card.appendChild(ctx.link('/', 'Return to the dashboard', 'gd-btn'));
    wrap.appendChild(card);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  function pageIndex(ctx, data) {
    ctx.title(data.siteName || ctx.site.title || 'dash');

    var wrap = el('div', { 'class': 'gd-page' });
    wrap.appendChild(header(ctx, data));

    var alerts = alertsBar(ctx, data);
    if (alerts) { wrap.appendChild(alerts); }

    var topAd = liveAd('banner', ctx.site.domain + ':top');
    if (topAd) { wrap.appendChild(el('div', { 'class': 'gd-adslot gd-adbanner' }, topAd)); }

    wrap.appendChild(weatherStrip(ctx, data));
    wrap.appendChild(numbersRow(ctx, data));

    var grid = el('section', { 'class': 'gd-grid gd-grid-cards', 'aria-label': 'Panels' });
    grid.appendChild(transitCard(ctx, data));

    var ticker = tickerCard(ctx, data);
    if (ticker) { grid.appendChild(ticker); }

    var widgets = widgetCards(ctx, data);
    for (var i = 0; i < widgets.length; i++) {
      grid.appendChild(widgets[i]);
      if (i === 0) {
        var boxAd = liveAd('box', ctx.site.domain + ':cards');
        if (boxAd) { grid.appendChild(el('article', { 'class': 'gd-card gd-card-ad' }, boxAd)); }
      }
    }

    var news = newsCard(ctx, data);
    if (news) { grid.appendChild(news); }

    grid.appendChild(noticeCard(ctx, data));

    var textAd = liveAd('text', ctx.site.domain + ':cardstext');
    if (textAd) { grid.appendChild(el('article', { 'class': 'gd-card gd-card-ad gd-card-adtext' }, textAd)); }

    wrap.appendChild(grid);
    wrap.appendChild(footer(ctx, data));
    ctx.mount.appendChild(wrap);
  }

  S.render.register('dash', function (ctx) {
    var data = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    if (S.liveui && has(S.liveui.onlineBar)) {
      var bar = S.liveui.onlineBar(ctx.site.domain, 300, 5200);
      if (bar) { ctx.mount.appendChild(el('div', { 'class': 'gd-onlinebar' }, bar)); }
    }

    if (!p.length) { return pageIndex(ctx, data); }
    return notFound(ctx, data);
  });
}());
