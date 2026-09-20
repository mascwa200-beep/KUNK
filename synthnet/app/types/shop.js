window.SYNTH = window.SYNTH || {};

/* shop -- 2026 megastore. Dense, yellow-orange buy box, urgency banners,
   bot reviews, "only N left". Skin: .skin-megastore */
(function () {
  'use strict';

  var el = SYNTH.el;

  function d(site) {
    return (site && site.data) || {};
  }

  function money(n) {
    if (typeof n !== 'number') { return String(n || ''); }
    var s = n.toFixed(2).split('.');
    return '$' + SYNTH.live.commas(Number(s[0])) + '.' + s[1];
  }

  function seedOf(str) {
    return SYNTH.live.hash32(String(str || 'seed'));
  }

  /* ---------- small pieces ---------- */

  function stars(rating) {
    var wrap = el('span', { 'class': 'ms-stars', 'aria-label': (rating || 0) + ' out of 5 stars' });
    var full = Math.round(Number(rating) || 0);
    var i;
    for (i = 1; i <= 5; i++) {
      wrap.appendChild(el('span', { 'class': i <= full ? 'ms-star on' : 'ms-star', 'aria-hidden': 'true' }, '★'));
    }
    return wrap;
  }

  function badgeFor(kind) {
    if (!SYNTH.liveui || !SYNTH.liveui.badge) { return null; }
    return SYNTH.liveui.badge(kind);
  }

  function ad(slot, seed) {
    if (!SYNTH.liveui || !SYNTH.liveui.ad) { return null; }
    return SYNTH.liveui.ad(slot, seed);
  }

  function urgencyBanner(seed) {
    var r = SYNTH.live.rng(seedOf('urgency:' + seed));
    var lines = [
      'FLASH EVENT ENDS SOON — prices update every 4 minutes',
      'WAREHOUSE CLEARANCE — Verity County fulfilment centre',
      'PRICE DROPPED WHILE YOU WERE READING THIS',
      'ALGORITHMIC DEAL WINDOW OPEN — reopens at an unspecified time',
      'LIMITED STOCK EVENT — restock queued behind 4,100 other requests'
    ];
    var text = lines[Math.floor(r() * lines.length) % lines.length];
    var bar = el('div', { 'class': 'ms-urgent' },
      el('span', { 'class': 'ms-urgent-dot', 'aria-hidden': 'true' }),
      el('span', { 'class': 'ms-urgent-text' }, text),
      el('span', { 'class': 'ms-urgent-count' }, SYNTH.live.commas(SYNTH.live.counter('shop:urgent:' + seed, 2400, 900)) + ' watching')
    );
    return bar;
  }

  function stockLine(p) {
    var left = 1 + (SYNTH.live.hash32('stock:' + p.id) % 7);
    var cls = left <= 3 ? 'ms-stock low' : 'ms-stock';
    return el('p', { 'class': cls }, left <= 3
      ? ('Only ' + left + ' left in stock — order soon.')
      : ('In stock. ' + left + ' remaining at this price.'));
  }

  function thumb(seed, kind) {
    var box = el('span', { 'class': 'ms-thumb' });
    box.appendChild(SYNTH.markup.placeholder(kind || 'thumb', seed));
    return box;
  }

  function breadcrumb(ctx, parts) {
    var nav = el('nav', { 'class': 'ms-crumb', 'aria-label': 'Breadcrumb' });
    var i;
    for (i = 0; i < parts.length; i++) {
      if (i) { nav.appendChild(el('span', { 'class': 'ms-crumb-sep', 'aria-hidden': 'true' }, '›')); }
      if (parts[i].href) {
        nav.appendChild(ctx.link(parts[i].href, parts[i].label, 'ms-crumb-link'));
      } else {
        nav.appendChild(el('span', { 'class': 'ms-crumb-now' }, parts[i].label));
      }
    }
    return nav;
  }

  /* ---------- chrome ---------- */

  function header(ctx) {
    var data = d(ctx.site);
    var head = el('header', { 'class': 'ms-head' });

    var top = el('div', { 'class': 'ms-head-top' },
      ctx.link('/', data.storeName || ctx.site.title || 'Megastore', 'ms-logo'),
      el('div', { 'class': 'ms-deliver' },
        el('span', { 'class': 'ms-deliver-lbl' }, 'Deliver to'),
        el('span', { 'class': 'ms-deliver-val' }, 'Gridfall, Verity County')
      )
    );
    head.appendChild(top);

    var form = el('div', { 'class': 'ms-searchrow' },
      el('span', { 'class': 'ms-searchbox', 'role': 'presentation' },
        el('span', { 'class': 'ms-searchcat' }, 'All'),
        el('span', { 'class': 'ms-searchfield' }, 'Search ' + (data.storeName || 'the store')),
        el('span', { 'class': 'ms-searchgo' }, 'Go')
      )
    );
    head.appendChild(form);

    var cats = el('nav', { 'class': 'ms-catbar', 'aria-label': 'Departments' });
    var list = data.categories || [];
    var i;
    for (i = 0; i < list.length; i++) {
      cats.appendChild(ctx.link('/c/' + list[i].id, list[i].name, 'ms-catlink'));
    }
    head.appendChild(cats);

    if (SYNTH.liveui && SYNTH.liveui.onlineBar) {
      var bar = SYNTH.liveui.onlineBar(ctx.site.domain, 900, 5200);
      if (bar) { head.appendChild(bar); }
    }
    return head;
  }

  function footer(ctx) {
    var data = d(ctx.site);
    var f = el('footer', { 'class': 'ms-foot' });
    f.appendChild(el('p', { 'class': 'ms-foot-line' },
      (data.storeName || 'Store') + ' — a Verity County fulfilment partner.'));
    f.appendChild(el('p', { 'class': 'ms-foot-small' },
      'Prices, availability and product descriptions are generated and may not reflect any item that exists. ' +
      'Listings refreshed ' + SYNTH.live.ago(4 * 60 * 1000) + '.'));
    var links = ctx.site.links || [];
    if (links.length) {
      var row = el('p', { 'class': 'ms-foot-links' });
      var i;
      for (i = 0; i < links.length; i++) {
        if (i) { row.appendChild(el('span', { 'class': 'ms-foot-dot', 'aria-hidden': 'true' }, ' · ')); }
        row.appendChild(SYNTH.markup.parse('[url=synth://' + links[i].href + ']' + (links[i].label || links[i].href) + '[/url]'));
      }
      f.appendChild(row);
    }
    return f;
  }

  /* ---------- product card ---------- */

  function card(ctx, p) {
    var c = el('article', { 'class': 'ms-card' });
    var imgLink = ctx.link('/p/' + p.id, '', 'ms-card-img');
    imgLink.appendChild(thumb(p.imgSeed || p.id, 'thumb'));
    c.appendChild(imgLink);
    var body = el('div', { 'class': 'ms-card-body' });
    body.appendChild(el('h3', { 'class': 'ms-card-name' }, ctx.link('/p/' + p.id, p.name || 'Untitled item', 'ms-card-link')));

    var rateRow = el('div', { 'class': 'ms-card-rate' },
      stars(p.rating),
      el('span', { 'class': 'ms-card-rc' }, SYNTH.live.commas(
        SYNTH.live.counter('shop:rc:' + p.id, p.reviewCount || 12, 9)) + ' ratings')
    );
    body.appendChild(rateRow);

    var priceRow = el('div', { 'class': 'ms-card-price' },
      el('span', { 'class': 'ms-price' }, money(p.price))
    );
    if (p.was && p.was > p.price) {
      priceRow.appendChild(el('span', { 'class': 'ms-was' }, 'List: ' + money(p.was)));
    }
    body.appendChild(priceRow);

    if (p.prime) {
      body.appendChild(el('p', { 'class': 'ms-prime' }, 'SAME-DAY — drone window pending'));
    }
    var sb = badgeFor(p.sellerKind);
    var sell = el('p', { 'class': 'ms-card-seller' }, 'Sold by ' + (p.seller || 'unknown seller') + ' ');
    if (sb) { sell.appendChild(sb); }
    body.appendChild(sell);

    c.appendChild(body);
    return c;
  }

  function grid(ctx, products, cls) {
    var g = el('div', { 'class': 'ms-grid ' + (cls || '') });
    var i;
    for (i = 0; i < products.length; i++) {
      g.appendChild(card(ctx, products[i]));
    }
    return g;
  }

  /* ---------- pages ---------- */

  function renderIndex(ctx) {
    var data = d(ctx.site);
    var products = data.products || [];
    ctx.title((data.storeName || ctx.site.title) + ' — everything, instantly');

    ctx.mount.appendChild(urgencyBanner(ctx.site.domain));

    var a1 = ad('banner', ctx.site.domain + ':top');
    if (a1) { ctx.mount.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-banner' }, a1)); }

    var hero = el('section', { 'class': 'ms-hero' });
    hero.appendChild(el('h1', { 'class': 'ms-hero-title' }, data.storeName || 'Megastore'));
    hero.appendChild(el('p', { 'class': 'ms-hero-sub' },
      ctx.site.description || 'Ships to Verity County. Mostly.'));
    hero.appendChild(el('p', { 'class': 'ms-hero-live' },
      SYNTH.live.commas(SYNTH.live.online('shop:' + ctx.site.domain, 780, 4200)) +
      ' shoppers browsing right now'));
    ctx.mount.appendChild(hero);

    /* Deals: a growing stream so the front page keeps moving. */
    var dealPool = [];
    var i;
    for (i = 0; i < products.length; i++) {
      dealPool.push(products[i]);
    }
    if (SYNTH.live && SYNTH.live.pool) {
      /* fold ad copy in as phantom "deals of the minute" */
      var extra = SYNTH.live.pool('ads');
      for (i = 0; i < extra.length && i < 14; i++) {
        var txt = typeof extra[i] === 'string' ? extra[i] : (extra[i] && (extra[i].text || extra[i].title)) || '';
        if (!txt) { continue; }
        dealPool.push({
          id: 'promo-' + SYNTH.live.hash32(txt),
          name: SYNTH.markup.strip(txt).slice(0, 72),
          price: 3 + (SYNTH.live.hash32(txt) % 9000) / 100,
          was: null,
          rating: 3 + (SYNTH.live.hash32('r' + txt) % 20) / 10,
          reviewCount: 4 + (SYNTH.live.hash32('c' + txt) % 900),
          imgSeed: txt,
          seller: 'AutoVendor ' + (SYNTH.live.hash32('s' + txt) % 900),
          sellerKind: 'bot',
          prime: true,
          promo: true
        });
      }
    }

    var dealStream = SYNTH.live.stream('shop:deals:' + ctx.site.domain, dealPool, 7, 12);
    var dealSec = el('section', { 'class': 'ms-sec' });
    dealSec.appendChild(el('h2', { 'class': 'ms-sec-h' }, 'Deals of the minute'));
    dealSec.appendChild(el('p', { 'class': 'ms-sec-note' },
      'Refreshed ' + SYNTH.live.ago(90 * 1000) + ' by the pricing engine.'));
    dealSec.appendChild(grid(ctx, dealStream.length ? dealStream : products.slice(0, 8), 'ms-grid-deal'));
    ctx.mount.appendChild(dealSec);

    var a2 = ad('inline', ctx.site.domain + ':mid');
    if (a2) { ctx.mount.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-inline' }, a2)); }

    var cats = data.categories || [];
    for (i = 0; i < cats.length; i++) {
      var inCat = [];
      var j;
      for (j = 0; j < products.length; j++) {
        if (products[j].catId === cats[i].id) { inCat.push(products[j]); }
      }
      if (!inCat.length) { continue; }
      var sec = el('section', { 'class': 'ms-sec' });
      var h = el('h2', { 'class': 'ms-sec-h' });
      h.appendChild(ctx.link('/c/' + cats[i].id, cats[i].name, 'ms-sec-link'));
      sec.appendChild(h);
      sec.appendChild(grid(ctx, inCat.slice(0, 6)));
      ctx.mount.appendChild(sec);
    }

    var a3 = ad('box', ctx.site.domain + ':foot');
    if (a3) { ctx.mount.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-box' }, a3)); }
  }

  function renderCategory(ctx, catId) {
    var data = d(ctx.site);
    var cats = data.categories || [];
    var cat = null;
    var i;
    for (i = 0; i < cats.length; i++) {
      if (String(cats[i].id) === String(catId)) { cat = cats[i]; }
    }
    if (!cat) { return render404(ctx); }

    var products = [];
    var all = data.products || [];
    for (i = 0; i < all.length; i++) {
      if (String(all[i].catId) === String(catId)) { products.push(all[i]); }
    }

    ctx.title(cat.name + ' — ' + (data.storeName || ctx.site.title));
    ctx.mount.appendChild(breadcrumb(ctx, [
      { label: data.storeName || 'Home', href: '/' },
      { label: cat.name }
    ]));
    ctx.mount.appendChild(urgencyBanner(ctx.site.domain + ':' + catId));

    var head = el('div', { 'class': 'ms-listhead' },
      el('h1', { 'class': 'ms-h1' }, cat.name),
      el('p', { 'class': 'ms-result-count' },
        SYNTH.live.commas(SYNTH.live.counter('shop:res:' + catId, 1200 + products.length, 340)) +
        ' results · ' + products.length + ' in stock locally')
    );
    ctx.mount.appendChild(head);

    var a1 = ad('banner', ctx.site.domain + ':cat:' + catId);
    if (a1) { ctx.mount.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-banner' }, a1)); }

    var layout = el('div', { 'class': 'ms-layout' });
    var side = el('aside', { 'class': 'ms-side' });
    side.appendChild(el('h2', { 'class': 'ms-side-h' }, 'Departments'));
    var ul = el('ul', { 'class': 'ms-side-list' });
    for (i = 0; i < cats.length; i++) {
      ul.appendChild(el('li', { 'class': 'ms-side-item' },
        ctx.link('/c/' + cats[i].id, cats[i].name, String(cats[i].id) === String(catId) ? 'ms-side-link on' : 'ms-side-link')));
    }
    side.appendChild(ul);
    side.appendChild(el('h2', { 'class': 'ms-side-h' }, 'Filters'));
    side.appendChild(el('p', { 'class': 'ms-side-note' }, 'Avg. customer review'));
    side.appendChild(stars(4));
    side.appendChild(el('p', { 'class': 'ms-side-note' }, 'Verified seller only (unavailable)'));
    var a2 = ad('box', ctx.site.domain + ':side:' + catId);
    if (a2) { side.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-box' }, a2)); }
    layout.appendChild(side);

    var main = el('div', { 'class': 'ms-main' });
    if (!products.length) {
      main.appendChild(el('p', { 'class': 'ms-empty' }, 'No items indexed in this department yet.'));
    } else {
      main.appendChild(grid(ctx, products));
    }
    layout.appendChild(main);
    ctx.mount.appendChild(layout);
  }

  function reviewRow(ctx, r, idx, pid) {
    var box = el('article', { 'class': 'ms-review' });
    var who = el('p', { 'class': 'ms-rev-who' });
    who.appendChild(el('span', { 'class': 'ms-rev-av' }, SYNTH.markup.placeholder('avatar', r.by || ('rev' + idx))));
    who.appendChild(el('span', { 'class': 'ms-rev-name' }, r.by || 'Anonymous'));
    var b = badgeFor(r.kind);
    if (b) { who.appendChild(b); }
    box.appendChild(who);

    var head = el('p', { 'class': 'ms-rev-head' });
    head.appendChild(stars(r.stars));
    head.appendChild(el('span', { 'class': 'ms-rev-title' }, r.title || ''));
    box.appendChild(head);

    var meta = el('p', { 'class': 'ms-rev-meta' },
      SYNTH.live.ago(hoursOf(r.at, 'rev:' + pid + ':' + idx)));
    if (r.verified) {
      meta.appendChild(el('span', { 'class': 'ms-verified' }, 'Verified Purchase'));
    }
    box.appendChild(meta);

    box.appendChild(el('div', { 'class': 'ms-rev-body' }, SYNTH.markup.parse(r.body || '')));

    var help = el('p', { 'class': 'ms-rev-help' },
      SYNTH.live.commas(SYNTH.live.counter('shop:help:' + pid + ':' + idx, 3, 11)) +
      ' people found this helpful');
    box.appendChild(help);
    return box;
  }

  function hoursOf(at, seed) {
    if (typeof at === 'number') { return at; }
    var h = 1 + (SYNTH.live.hash32(String(at || '') + '|' + seed) % (60 * 24 * 40));
    return h * 60 * 1000;
  }

  function renderProduct(ctx, pid) {
    var data = d(ctx.site);
    var all = data.products || [];
    var p = null;
    var i;
    for (i = 0; i < all.length; i++) {
      if (String(all[i].id) === String(pid)) { p = all[i]; }
    }
    if (!p) { return render404(ctx); }

    var cats = data.categories || [];
    var cat = null;
    for (i = 0; i < cats.length; i++) {
      if (String(cats[i].id) === String(p.catId)) { cat = cats[i]; }
    }

    ctx.title(p.name + ' — ' + (data.storeName || ctx.site.title));
    ctx.mount.appendChild(breadcrumb(ctx, [
      { label: data.storeName || 'Home', href: '/' },
      cat ? { label: cat.name, href: '/c/' + cat.id } : { label: 'All' },
      { label: SYNTH.markup.strip(p.name || '').slice(0, 40) }
    ]));

    ctx.mount.appendChild(urgencyBanner(p.id));

    var top = el('div', { 'class': 'ms-pdp' });

    var gal = el('div', { 'class': 'ms-gal' });
    gal.appendChild(el('div', { 'class': 'ms-gal-main' }, SYNTH.markup.placeholder('photo', p.imgSeed || p.id)));
    var strip = el('div', { 'class': 'ms-gal-strip' });
    for (i = 0; i < 4; i++) {
      strip.appendChild(el('span', { 'class': 'ms-gal-thumb' },
        SYNTH.markup.placeholder('thumb', (p.imgSeed || p.id) + ':' + i)));
    }
    gal.appendChild(strip);
    gal.appendChild(el('p', { 'class': 'ms-gal-note' }, 'Images auto-generated from the listing title.'));
    top.appendChild(gal);

    var info = el('div', { 'class': 'ms-info' });
    info.appendChild(el('h1', { 'class': 'ms-h1' }, p.name || 'Untitled item'));
    var by = el('p', { 'class': 'ms-by' }, 'Sold by ' + (p.seller || 'unknown seller') + ' ');
    var sb = badgeFor(p.sellerKind);
    if (sb) { by.appendChild(sb); }
    info.appendChild(by);

    var rr = el('p', { 'class': 'ms-rate-row' });
    rr.appendChild(stars(p.rating));
    rr.appendChild(el('span', { 'class': 'ms-rate-num' }, String(p.rating || 0)));
    rr.appendChild(el('span', { 'class': 'ms-rate-count' },
      SYNTH.live.commas(SYNTH.live.counter('shop:rc:' + p.id, p.reviewCount || 12, 9)) + ' ratings'));
    info.appendChild(rr);

    if (p.blurb) {
      info.appendChild(el('div', { 'class': 'ms-blurb' }, SYNTH.markup.parse(p.blurb)));
    }

    var bullets = p.bullets || [];
    if (bullets.length) {
      var ul = el('ul', { 'class': 'ms-bullets' });
      for (i = 0; i < bullets.length; i++) {
        ul.appendChild(el('li', { 'class': 'ms-bullet' }, SYNTH.markup.parse(bullets[i])));
      }
      info.appendChild(ul);
    }

    info.appendChild(el('p', { 'class': 'ms-viewing' },
      SYNTH.live.commas(SYNTH.live.online('shop:pdp:' + p.id, 12, 340)) +
      ' people are looking at this right now'));
    top.appendChild(info);

    /* the buy box */
    var buy = el('aside', { 'class': 'ms-buy' });
    var priceLine = el('p', { 'class': 'ms-buy-price' }, money(p.price));
    buy.appendChild(priceLine);
    if (p.was && p.was > p.price) {
      var save = Math.round(100 - (p.price / p.was) * 100);
      buy.appendChild(el('p', { 'class': 'ms-buy-was' },
        'List: ' + money(p.was) + ' · you save ' + save + '%'));
    }
    if (p.prime) {
      buy.appendChild(el('p', { 'class': 'ms-buy-ship' }, 'SAME-DAY delivery, drone window pending'));
    }
    buy.appendChild(stockLine(p));
    buy.appendChild(el('p', { 'class': 'ms-buy-btn' }, 'Add to Cart'));
    buy.appendChild(el('p', { 'class': 'ms-buy-btn2' }, 'Buy Now'));
    buy.appendChild(el('p', { 'class': 'ms-buy-small' },
      'Price last changed ' + SYNTH.live.ago(11 * 60 * 1000) + ' by an automated repricer.'));
    var a1 = ad('box', 'buy:' + p.id);
    if (a1) { buy.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-box' }, a1)); }
    top.appendChild(buy);

    ctx.mount.appendChild(top);

    /* also bought */
    var also = p.alsoBought || [];
    if (also.length) {
      var rel = [];
      for (i = 0; i < also.length; i++) {
        var j;
        for (j = 0; j < all.length; j++) {
          if (String(all[j].id) === String(also[i])) { rel.push(all[j]); }
        }
      }
      if (rel.length) {
        var relSec = el('section', { 'class': 'ms-sec' });
        relSec.appendChild(el('h2', { 'class': 'ms-sec-h' }, 'Customers who bought this also bought'));
        relSec.appendChild(grid(ctx, rel));
        ctx.mount.appendChild(relSec);
      }
    }

    var a2 = ad('inline', 'pdp:' + p.id);
    if (a2) { ctx.mount.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-inline' }, a2)); }

    /* reviews -- a stream, so fresh "reviews" keep arriving */
    var pool = (p.reviews || []).slice(0);
    if (SYNTH.live && SYNTH.live.pool) {
      var mc = SYNTH.live.pool('mediaComments');
      for (i = 0; i < mc.length && i < 24; i++) {
        var body = typeof mc[i] === 'string' ? mc[i] : (mc[i] && mc[i].body) || '';
        if (!body) { continue; }
        pool.push({
          by: 'Reviewer' + (SYNTH.live.hash32(body) % 9000),
          stars: 4 + (SYNTH.live.hash32('s' + body) % 2),
          title: 'Five stars, would receive again',
          body: body,
          verified: (SYNTH.live.hash32('v' + body) % 3) !== 0,
          kind: 'bot'
        });
      }
    }
    var shown = SYNTH.live.stream('shop:rev:' + p.id, pool, 23, Math.max(3, (p.reviews || []).length + 2));
    if (!shown.length) { shown = (p.reviews || []); }

    var revSec = el('section', { 'class': 'ms-sec ms-revsec' });
    revSec.appendChild(el('h2', { 'class': 'ms-sec-h' }, 'Customer reviews'));
    revSec.appendChild(el('p', { 'class': 'ms-sec-note' },
      'Review authenticity is scored automatically. ' +
      SYNTH.live.commas(SYNTH.live.counter('shop:removed:' + p.id, 40, 6)) +
      ' reviews were removed for policy reasons.'));
    for (i = 0; i < shown.length; i++) {
      revSec.appendChild(reviewRow(ctx, shown[i], i, p.id));
    }
    ctx.mount.appendChild(revSec);
  }

  function render404(ctx) {
    ctx.title('Page not found');
    var box = el('section', { 'class': 'ms-404' });
    box.appendChild(el('h1', { 'class': 'ms-h1' }, "We couldn't find that page"));
    box.appendChild(el('p', { 'class': 'ms-404-p' },
      'The item may have been delisted, merged into another listing, or generated in error.'));
    box.appendChild(ctx.link('/', 'Back to the storefront', 'ms-404-link'));
    var a = ad('box', '404:' + ctx.site.domain);
    if (a) { box.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-box' }, a)); }
    ctx.mount.appendChild(box);
  }

  SYNTH.render = SYNTH.render || {};
  SYNTH.render.register('shop', function (ctx) {
    var wrap = el('div', { 'class': 'skin-megastore' });
    var real = ctx.mount;
    real.appendChild(wrap);

    var inner = { };
    var k;
    for (k in ctx) { if (Object.prototype.hasOwnProperty.call(ctx, k)) { inner[k] = ctx[k]; } }
    inner.mount = wrap;

    wrap.appendChild(header(inner));
    var body = el('main', { 'class': 'ms-body' });
    wrap.appendChild(body);
    inner.mount = body;

    var path = ctx.path || [];
    if (!path.length) {
      renderIndex(inner);
    } else if (path[0] === 'c' && path.length === 2) {
      renderCategory(inner, path[1]);
    } else if (path[0] === 'p' && path.length === 2) {
      renderProduct(inner, path[1]);
    } else {
      render404(inner);
    }

    wrap.appendChild(footer(inner));
  });
}());
