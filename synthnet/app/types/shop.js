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

  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  /* SYNTH.live.ago() takes an absolute timestamp, and every call in this file
   * was handing it a duration instead -- 11 * 60 * 1000 is eleven minutes as a
   * length and 1 January 1970 as a moment, so every "refreshed", every review
   * date and every repriced-at on all seven shops read "1 Jan 1970". */
  function agoBy(ms) {
    return SYNTH.live.ago(SYNTH.live.now() - ms);
  }

  /* ---------- what this storefront can actually do ----------
   *
   * Seven shops run on this renderer and only some of them can take an order.
   * The difference is already in the data. A catalogue that is mostly
   * sellerKind "brand" is a business selling its own goods, and on every one
   * of those the website is a catalogue while the order is placed by a person
   * somewhere else -- Hollis says so on its own ordering page, in as many
   * words: "there is no cart that knows what is on the shelf". A catalogue of
   * "bot", "dropship", "reseller" and "sponsored" is a platform, and a
   * platform will always take the order. What it will not tell you is what
   * happens next.
   *
   * So the list is the same everywhere and the end of the list is not. DESK
   * holds the end of it, per domain, taken from each site's own pages. A shop
   * added later and not in the table falls back to the generic entry for its
   * mode, which says only things that are true of every store here.
   */

  var CART = 'shopcart';

  /* The header's count links, for the page being looked at. Reset when a page
   * is built, pruned of anything the engine has since swapped out. */
  var cartLinks = [];

  function repaintCartLinks(domain) {
    var kept = [];
    var i;
    for (i = 0; i < cartLinks.length; i++) {
      var w = cartLinks[i];
      if (!w.node || (document.body && !document.body.contains(w.node))) { continue; }
      kept.push(w);
      if (String(w.domain) !== String(domain)) { continue; }
      var n = cartCount(domain);
      while (w.node.firstChild) { w.node.removeChild(w.node.firstChild); }
      w.node.appendChild(document.createTextNode(
        w.title + (n ? ' (' + n + ')' : '')));
    }
    cartLinks = kept;
  }

  function cartRows(domain) {
    var v = (SYNTH.store && SYNTH.store.get) ? SYNTH.store.get(CART, domain, null) : null;
    return isArray(v) ? v : [];
  }

  /* Every mutation goes through here, so the one place that has to know the
   * list changed is this one. The count in the header is built once per
   * navigation, and without this it went on reading "Your cart (1)" while the
   * page under it said "Your cart is empty" -- the control worked and the
   * chrome above it contradicted the result on the same screen. */
  function cartSave(domain, rows) {
    if (SYNTH.store && SYNTH.store.put) { SYNTH.store.put(CART, domain, rows); }
    repaintCartLinks(domain);
  }

  function cartCount(domain) {
    var rows = cartRows(domain);
    var n = 0;
    var i;
    for (i = 0; i < rows.length; i++) { n += Number(rows[i].qty) || 0; }
    return n;
  }

  function cartQtyOf(domain, id) {
    var rows = cartRows(domain);
    var i;
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id)) { return Number(rows[i].qty) || 0; }
    }
    return 0;
  }

  /* price and name are copied in at the moment of adding rather than looked up
   * again when the list is read. On shopwell.store that is the whole joke --
   * the repricer moves the listing while the list sits -- and everywhere else
   * it means a delisted item still reads as something instead of a blank row. */
  function cartAdd(domain, p, howMany) {
    var rows = cartRows(domain);
    var i;
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(p.id)) {
        rows[i].qty = (Number(rows[i].qty) || 0) + howMany;
        cartSave(domain, rows);
        return rows[i].qty;
      }
    }
    rows.push({
      id: p.id,
      qty: howMany,
      price: Number(p.price) || 0,
      name: SYNTH.markup.strip(p.name || '').slice(0, 90)
    });
    cartSave(domain, rows);
    return howMany;
  }

  function cartSetQty(domain, id, qty) {
    var rows = cartRows(domain);
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      if (String(rows[i].id) !== String(id)) { out.push(rows[i]); continue; }
      if (qty > 0) { rows[i].qty = qty; out.push(rows[i]); }
    }
    cartSave(domain, out);
    return out;
  }

  var DESK_COUNTER = {
    noun: 'order', title: 'Your order', add: 'Add to Order',
    lines: [
      'Nothing here has been sent to the shop. This list is kept in this browser and goes no further.',
      'The storefront is a catalogue. Somebody at the shop takes the order, and it is not this page.'
    ]
  };

  var DESK_PLATFORM = {
    noun: 'cart', title: 'Your cart', add: 'Add to Cart', now: 'Buy Now',
    lines: [
      'Nothing here has been ordered. This cart is kept in this browser and goes no further.',
      'Prices, availability and the seller on each line are whatever the listing said at the moment it was added.'
    ]
  };

  var DESK = {
    'gridfallpizza.com': {
      noun: 'order', title: 'Your order', add: 'Add to Order',
      second: { label: 'Ordering, and what to do when it will not work', href: '/p/p-ordering' },
      lines: [
        'Nothing here has been sent to the shop. This list is kept in this browser and goes no further.',
        'The ORDER ONLINE button on this site belongs to a company called Menubridge. It is not part of the shop and the shop did not write it. Marcy has had ticket 44-1187 open with them since the 4th of March and has had three replies.',
        'Ring 782-2440 and read this list down the telephone. A person answers. Prices on these pages win over prices in the order system, every time.',
        'Delivery is $15 minimum: $3 inside the Gridfall village line, $5 just outside it, and nowhere else at any price.'
      ]
    },
    'hollismarket.com': {
      noun: 'order list', title: 'Your order list', add: 'Add to Order List',
      second: { label: 'Online ordering — how this actually works', href: '/p/p-info-order' },
      lines: [
        'Nothing here has been sent to the store. This list is kept in this browser and goes no further.',
        'There is no cart on this site that knows what is on the shelf. The order form emails the store and that is all it does: it reserves nothing and it charges nothing.',
        'Alma reads the orders between 6:15 and 7 in the morning, and again after the lunch rush. Put a real telephone number on it — if the cut you asked for is not there, somebody rings you, because the platform sends the order from an address that does not receive.',
        'Pickup orders in before 4 p.m. are ready the next morning. Thursday delivery has to be in by 4 p.m. Wednesday or it waits a week. Or ring 782-3811 and read your list to somebody.'
      ]
    },
    'countysupply.store': {
      noun: 'order', title: 'Your order', add: 'Add to Order',
      lines: [
        'Nothing here has been sent to the store. This list is kept in this browser and goes no further.',
        'County Supply fills orders off the shelf in Marchfield. The e-commerce platform sitting between you and the shop is the thing that wrote the product descriptions on these pages, and it will not let the shop delete the reviews underneath them.'
      ]
    },
    'veritymonuments.com': {
      noList: true,
      second: { label: 'The yard, the hours, and how an order goes', href: '/p/p-sh-about' },
      why: [
        'A stone is not added to a cart.',
        'An order starts with the cemetery’s rules, because half of what you are about to choose has already been chosen for you. Then stone, size and colour, out in the yard in daylight. Then a layout printed full size on paper, as many times as it takes. Then you sign the proof — and after that, what is on the proof is what gets cut, including anything wrong on it that both of you missed.',
        'Telephone before you drive out to 4110 Marchfield Road. Two of the five of them are usually in a cemetery.'
      ]
    },
    'shopwell.store': {
      noun: 'cart', title: 'Your cart', add: 'Add to Cart', now: 'Buy Now',
      lines: [
        'Nothing here has been ordered. This cart is kept in this browser and goes no further.',
        'The figures below are the ones that were showing when each item went in. A repricer runs while you read, so the listing pages may already disagree with this page.',
        'ShopWell lists about eleven million items and stocks about four hundred of them. Which of the two any one listing is does not appear on the listing.'
      ]
    },
    'gridfalldeals.com': {
      noun: 'cart', title: 'Your cart', add: 'Add to Cart', now: 'Buy Now',
      second: { label: 'Shipping & delivery times', href: '/p/p-90' },
      lines: [
        'Nothing here has been ordered. This cart is kept in this browser and goes no further.',
        'Each item is printed or picked after the order is placed, at whichever fulfilment partner is nearest. Delivery is 18 to 32 days. Retail collection at Depot Street is not available.',
        'A handling fee of $4.95 applies under $35, and a fulfilment surcharge of $2.40 on county merchandise. Neither of them is in the subtotal above.',
        'All Verity County merchandise is final sale. Returns must be started within 14 days of the order date, and an order counts as delivered 7 days after dispatch whatever the estimate on the listing said.'
      ]
    },
    'gridfalleats.com': {
      noun: 'order', title: 'Your order', add: 'Add to Order', now: 'Order Now',
      second: { label: 'How your order total is calculated', href: '/p/f-total' },
      lines: [
        'Nothing here has been ordered. This order is kept in this browser and goes no further.',
        'Drivers currently online in your area: 0.',
        'The subtotal above is the items only. The Service Fee, the Delivery Fee, the Small Order Fee and the Local Operating Fee are added at checkout, and the suggested tip is calculated on the total after all four of them.',
        'Orders to addresses outside the delivery area are accepted and may not be delivered.'
      ]
    }
  };

  function modeOf(site) {
    var products = d(site).products || [];
    var brand = 0;
    var i;
    for (i = 0; i < products.length; i++) {
      if (String(products[i].sellerKind || '') === 'brand') { brand++; }
    }
    return (products.length && brand * 2 >= products.length) ? 'counter' : 'platform';
  }

  function deskFor(site) {
    var found = Object.prototype.hasOwnProperty.call(DESK, site.domain)
      ? DESK[site.domain] : null;
    if (found) { return found; }
    return modeOf(site) === 'counter' ? DESK_COUNTER : DESK_PLATFORM;
  }

  /* Only offer a link to one of the store's own pages if the store still has
   * that page. The ids below come out of the site files; a file can change. */
  function hasProduct(site, id) {
    var products = d(site).products || [];
    var i;
    for (i = 0; i < products.length; i++) {
      if (String(products[i].id) === String(id)) { return true; }
    }
    return false;
  }

  function secondLinkOf(site) {
    var desk = deskFor(site);
    if (!desk.second) { return null; }
    var id = String(desk.second.href).replace(/^\/p\//, '');
    return hasProduct(site, id) ? desk.second : null;
  }

  /* Several of these shops publish prose through a storefront that only knows
   * how to publish products: opening hours, delivery areas, cemetery rules and
   * fee schedules all arrive here as $0.00 "products". Gridfall Pizza says so
   * itself, in a bullet on its own hours page. None of them is for sale, and a
   * buy button on one would be the plainest lie on the site.
   *
   * A zero price on its own does not settle it, though. Renner's on
   * gridfalleats.com is priced at $0 because its delivery is free, and it is a
   * restaurant, not an article. So: a whole department of unpriced items is a
   * department of pages; one unpriced item among priced ones is a listing that
   * simply has no price, and there is still nothing there to add.
   *
   * Recruitment belongs in the list for the same reason and was missed the
   * first time. gridfalleats.com files its driver recruitment as a department,
   * and prices "Driver Pay and Earnings" at $2.40 -- which is what a driver is
   * paid per delivery, not what the article costs. Reading that as a price put
   * a working "Add to Order", an "Order Now" and an "Only 3 left in stock" on
   * an article about how drivers are paid. */
  var PAGEY = /\bhelp\b|\bsupport\b|\babout\b|\binformation\b|\bcontact\b|\bpolic|\bservice\b|\bfees?\b|\bcharges?\b|\bhours\b|\bhiring\b|\bcareers?\b|\bjobs?\b|\brecruit/i;

  /* A listing whose name IS the name of one of this store's own departments is
   * the front of that department, not a thing. gridfalleats.com's "Restaurants
   * Near You" holds four of them, each priced at its own delivery fee, so Add
   * to Order put a restaurant on the order at the price of delivering from it.
   * What a reader wants off that listing is the menu, and the menu is the
   * department it names. Derived from the data, so it finds nothing on the
   * other six shops and would find a fifth restaurant if one were added. */
  function departmentBehind(site, p) {
    var cats = d(site).categories || [];
    var head = String(p.name || '').split(/\s+[-–—·]\s+/)[0]
      .replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!head) { return null; }
    var i;
    for (i = 0; i < cats.length; i++) {
      if (String(cats[i].id) === String(p.catId)) { continue; }
      if (String(cats[i].name || '').replace(/^\s+|\s+$/g, '').toLowerCase() === head) {
        return cats[i];
      }
    }
    return null;
  }

  function catHasPrices(site, cat) {
    if (!cat) { return false; }
    var products = d(site).products || [];
    var i;
    for (i = 0; i < products.length; i++) {
      if (String(products[i].catId) !== String(cat.id)) { continue; }
      if (Number(products[i].price) > 0) { return true; }
    }
    return false;
  }

  function buyState(site, p, cat) {
    if (departmentBehind(site, p)) { return 'menu'; }
    if (cat && PAGEY.test(String(cat.name || ''))) { return 'page'; }
    if (Number(p.price) > 0) { return 'sell'; }
    return catHasPrices(site, cat) ? 'noprice' : 'page';
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

  function goTo(ctx, path) {
    if (SYNTH.engine && SYNTH.engine.navigate) {
      SYNTH.engine.navigate('synth://' + ctx.site.domain + path);
    }
  }

  /* The search box used to be three spans painted to look like a search box.
   * It searches the catalogue now, which is the only index this store has and
   * the only one it ever claimed to have. */
  function searchForm(ctx) {
    var data = d(ctx.site);
    var store = data.storeName || ctx.site.title || 'the store';
    var cats = data.categories || [];
    var q = (ctx.query && ctx.query.q) ? String(ctx.query.q) : '';
    var inCat = (ctx.query && ctx.query.in) ? String(ctx.query.in) : '';

    var pick = el('select', { 'class': 'ms-searchcat', 'aria-label': 'Department to search' });
    pick.appendChild(el('option', { 'value': '' }, 'All'));
    var i;
    for (i = 0; i < cats.length; i++) {
      var opt = el('option', { 'value': String(cats[i].id) }, cats[i].name);
      if (String(cats[i].id) === inCat) { opt.selected = true; }
      pick.appendChild(opt);
    }

    var field = el('input', {
      'type': 'search', 'class': 'ms-searchfield', 'value': q,
      'placeholder': 'Search ' + store, 'aria-label': 'Search ' + store
    });

    var box = el('form', {
      'class': 'ms-searchbox',
      'onsubmit': function (ev) {
        if (ev && ev.preventDefault) { ev.preventDefault(); }
        var term = String(field.value || '').replace(/^\s+|\s+$/g, '');
        var where = String(pick.value || '');
        var path = '/?q=' + encodeURIComponent(term);
        if (where) { path += '&in=' + encodeURIComponent(where); }
        goTo(ctx, path);
      }
    }, pick, field, el('button', { 'type': 'submit', 'class': 'ms-searchgo' }, 'Go'));

    return el('div', { 'class': 'ms-searchrow' }, box);
  }

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
    var desk = deskFor(ctx.site);
    if (!desk.noList) {
      var n = cartCount(ctx.site.domain);
      var cl = ctx.link('/cart',
        desk.title + (n ? ' (' + n + ')' : ''), 'ms-cartlink');
      cartLinks.push({ node: cl, title: desk.title, domain: ctx.site.domain });
      top.appendChild(cl);
    }
    head.appendChild(top);

    head.appendChild(searchForm(ctx));

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
      'Listings refreshed ' + agoBy(4 * 60 * 1000) + '.'));
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
      'Refreshed ' + agoBy(90 * 1000) + ' by the pricing engine.'));
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

    var query = ctx.query || {};
    var minStars = query.min ? Number(query.min) : 0;
    var onlyBrand = String(query.by || '') === 'brand';

    var products = [];
    var all = data.products || [];
    var inCat = 0;
    for (i = 0; i < all.length; i++) {
      if (String(all[i].catId) !== String(catId)) { continue; }
      inCat++;
      if (minStars && !((Number(all[i].rating) || 0) >= minStars)) { continue; }
      if (onlyBrand && String(all[i].sellerKind || '') !== 'brand') { continue; }
      products.push(all[i]);
    }

    ctx.title(cat.name + ' — ' + (data.storeName || ctx.site.title));
    ctx.mount.appendChild(breadcrumb(ctx, [
      { label: data.storeName || 'Home', href: '/' },
      { label: cat.name }
    ]));
    ctx.mount.appendChild(urgencyBanner(ctx.site.domain + ':' + catId));

    var head = el('div', { 'class': 'ms-listhead' },
      el('h1', { 'class': 'ms-h1' }, cat.name));
    if (minStars || onlyBrand) {
      head.appendChild(el('p', { 'class': 'ms-result-count' },
        products.length + ' of the ' + inCat + ' items in this department' +
        (minStars ? (', rated ' + minStars + ' stars and up') : '') +
        (onlyBrand ? ', sold by the shop itself' : '') + '.'));
    } else {
      head.appendChild(el('p', { 'class': 'ms-result-count' },
        SYNTH.live.commas(SYNTH.live.counter('shop:res:' + catId, 1200 + products.length, 340)) +
        ' results · ' + products.length + ' in stock locally'));
    }
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

    /* These used to be a row of stars and the word "unavailable" sitting under
     * a heading that said Filters. Both filter now. On a catalogue of bot
     * listings the seller filter returns nothing, which is the honest result
     * and not an error. */
    side.appendChild(el('h2', { 'class': 'ms-side-h' }, 'Filters'));
    side.appendChild(el('p', { 'class': 'ms-side-note' }, 'Avg. customer review'));
    var base = '/c/' + catId;
    var rates = el('ul', { 'class': 'ms-side-list ms-side-rates' });
    var r;
    for (r = 4; r >= 2; r--) {
      var on = String(minStars) === String(r);
      var lab = el('span', { 'class': 'ms-rate-lbl' });
      lab.appendChild(stars(r));
      lab.appendChild(el('span', { 'class': 'ms-rate-txt' }, '& up'));
      rates.appendChild(el('li', { 'class': 'ms-side-item' },
        on ? ctx.link(base, lab, 'ms-side-link on')
           : ctx.link(base + '?min=' + r, lab, 'ms-side-link')));
    }
    side.appendChild(rates);
    side.appendChild(el('p', { 'class': 'ms-side-note' },
      onlyBrand
        ? ctx.link(base, 'Showing the shop’s own listings — show every seller', 'ms-side-link on')
        : ctx.link(base + '?by=brand', 'Sold by the shop itself', 'ms-side-link')));
    var a2 = ad('box', ctx.site.domain + ':side:' + catId);
    if (a2) { side.appendChild(el('div', { 'class': 'ms-adslot ms-adslot-box' }, a2)); }
    layout.appendChild(side);

    var main = el('div', { 'class': 'ms-main' });
    if (!products.length && (minStars || onlyBrand)) {
      main.appendChild(el('p', { 'class': 'ms-empty' },
        onlyBrand && inCat
          ? 'Nothing in this department is sold by the shop itself. Every listing here comes from somebody else.'
          : 'No item in this department is rated that highly.'));
      main.appendChild(ctx.link(base, 'Show all ' + inCat + ' again', 'ms-cart-back'));
    } else if (!products.length) {
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
      agoBy(hoursOf(r.at, 'rev:' + pid + ':' + idx)));
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

  /* The two things that used to be paragraphs painted to look like buttons.
   * On a store that can hold an order they hold one; on a store that cannot,
   * the second one is the store's own page about how an order really goes,
   * and on veritymonuments.com there is no first one at all. */
  function buyControls(ctx, buy, p) {
    var desk = deskFor(ctx.site);
    var second = secondLinkOf(ctx.site);

    if (desk.noList) {
      var why = el('div', { 'class': 'ms-truth ms-truth-buy' });
      var i;
      for (i = 0; i < desk.why.length; i++) {
        why.appendChild(el('p', { 'class': 'ms-truth-p' }, desk.why[i]));
      }
      buy.appendChild(why);
      if (second) {
        buy.appendChild(ctx.link(second.href, second.label, 'ms-buy-alt'));
      }
      return;
    }

    var note = el('p', { 'class': 'ms-buy-note' });
    var have = cartQtyOf(ctx.site.domain, p.id);
    if (have) {
      note.appendChild(document.createTextNode(have + ' in your ' + desk.noun + '. '));
      note.appendChild(ctx.link('/cart', 'Open it', 'ms-buy-open'));
    }

    var add = el('button', {
      'type': 'button', 'class': 'ms-buy-btn',
      'onclick': function () {
        var n = cartAdd(ctx.site.domain, p, 1);
        while (note.firstChild) { note.removeChild(note.firstChild); }
        note.appendChild(document.createTextNode(n + ' in your ' + desk.noun + '. '));
        note.appendChild(ctx.link('/cart', 'Open it', 'ms-buy-open'));
      }
    }, desk.add);
    buy.appendChild(add);

    if (desk.now) {
      buy.appendChild(el('button', {
        'type': 'button', 'class': 'ms-buy-btn2',
        'onclick': function () {
          cartAdd(ctx.site.domain, p, 1);
          goTo(ctx, '/cart');
        }
      }, desk.now));
    } else if (second) {
      buy.appendChild(ctx.link(second.href, second.label, 'ms-buy-alt'));
    }

    buy.appendChild(note);
  }

  /* ---------- the order list ---------- */

  function truthBlock(desk) {
    var box = el('section', { 'class': 'ms-truth' });
    var i;
    for (i = 0; i < desk.lines.length; i++) {
      box.appendChild(el('p', { 'class': 'ms-truth-p' }, desk.lines[i]));
    }
    return box;
  }

  function renderCart(ctx) {
    var data = d(ctx.site);
    var desk = deskFor(ctx.site);
    var domain = ctx.site.domain;

    if (desk.noList) {
      ctx.title('How an order goes — ' + (data.storeName || ctx.site.title));
      ctx.mount.appendChild(breadcrumb(ctx, [
        { label: data.storeName || 'Home', href: '/' },
        { label: 'How an order goes' }
      ]));
      ctx.mount.appendChild(el('h1', { 'class': 'ms-h1' }, 'There is no cart on this site'));
      var why = el('section', { 'class': 'ms-truth' });
      var w;
      for (w = 0; w < desk.why.length; w++) {
        why.appendChild(el('p', { 'class': 'ms-truth-p' }, desk.why[w]));
      }
      ctx.mount.appendChild(why);
      var alt = secondLinkOf(ctx.site);
      if (alt) { ctx.mount.appendChild(ctx.link(alt.href, alt.label, 'ms-buy-alt')); }
      return;
    }

    ctx.title(desk.title + ' — ' + (data.storeName || ctx.site.title));
    ctx.mount.appendChild(breadcrumb(ctx, [
      { label: data.storeName || 'Home', href: '/' },
      { label: desk.title }
    ]));
    ctx.mount.appendChild(el('h1', { 'class': 'ms-h1' }, desk.title));

    var box = el('div', { 'class': 'ms-cart' });

    function paint() {
      while (box.firstChild) { box.removeChild(box.firstChild); }
      var rows = cartRows(domain);
      if (!rows.length) {
        box.appendChild(el('p', { 'class': 'ms-cart-empty' },
          'Your ' + desk.noun + ' is empty.'));
        box.appendChild(ctx.link('/', 'Back to the storefront', 'ms-cart-back'));
        return;
      }

      var total = 0;
      var i;
      for (i = 0; i < rows.length; i++) {
        total += (Number(rows[i].price) || 0) * (Number(rows[i].qty) || 0);
        box.appendChild(cartRow(ctx, rows[i], paint));
      }

      var sum = el('div', { 'class': 'ms-cart-sum' },
        el('span', { 'class': 'ms-cart-sum-lbl' }, 'Subtotal'),
        el('span', { 'class': 'ms-cart-sum-val' }, money(total))
      );
      box.appendChild(sum);

      box.appendChild(el('button', {
        'type': 'button', 'class': 'ms-cart-clear',
        'onclick': function () { cartSave(domain, []); paint(); }
      }, 'Empty this ' + desk.noun));
    }

    paint();
    ctx.mount.appendChild(box);
    ctx.mount.appendChild(truthBlock(desk));

    var second = secondLinkOf(ctx.site);
    if (second) {
      ctx.mount.appendChild(ctx.link(second.href, second.label, 'ms-buy-alt'));
    }
  }

  function cartRow(ctx, row, paint) {
    var domain = ctx.site.domain;
    var qty = Number(row.qty) || 0;
    var line = el('div', { 'class': 'ms-cart-row' });

    line.appendChild(el('p', { 'class': 'ms-cart-name' },
      ctx.link('/p/' + row.id, row.name || row.id, 'ms-cart-link')));

    var unit = el('p', { 'class': 'ms-cart-unit' },
      money(Number(row.price) || 0) + ' each');
    line.appendChild(unit);

    var qbox = el('div', { 'class': 'ms-qtybox' });
    qbox.appendChild(el('button', {
      'type': 'button', 'class': 'ms-qty',
      'aria-label': 'One fewer ' + (row.name || 'item'),
      'onclick': function () { cartSetQty(domain, row.id, qty - 1); paint(); }
    }, '−'));
    qbox.appendChild(el('span', { 'class': 'ms-qty-n' }, String(qty)));
    qbox.appendChild(el('button', {
      'type': 'button', 'class': 'ms-qty',
      'aria-label': 'One more ' + (row.name || 'item'),
      'onclick': function () { cartSetQty(domain, row.id, qty + 1); paint(); }
    }, '+'));
    qbox.appendChild(el('button', {
      'type': 'button', 'class': 'ms-qty ms-qty-rm',
      'onclick': function () { cartSetQty(domain, row.id, 0); paint(); }
    }, 'Remove'));
    line.appendChild(qbox);

    line.appendChild(el('p', { 'class': 'ms-cart-line' },
      money((Number(row.price) || 0) * qty)));
    return line;
  }

  /* ---------- catalogue search ---------- */

  function matches(p, terms) {
    var hay = String(p.name || '') + ' ' + String(p.blurb || '') + ' ' +
      (p.bullets || []).join(' ') + ' ' + String(p.seller || '');
    hay = SYNTH.markup.strip(hay).toLowerCase();
    var i;
    for (i = 0; i < terms.length; i++) {
      if (hay.indexOf(terms[i]) < 0) { return false; }
    }
    return true;
  }

  function renderSearch(ctx, q, inCat) {
    var data = d(ctx.site);
    var store = data.storeName || ctx.site.title;
    var all = data.products || [];
    var cats = data.categories || [];
    var cat = null;
    var i;
    for (i = 0; i < cats.length; i++) {
      if (String(cats[i].id) === String(inCat)) { cat = cats[i]; }
    }

    ctx.title('"' + q + '" — ' + store);
    ctx.mount.appendChild(breadcrumb(ctx, [
      { label: store, href: '/' },
      { label: 'Search' }
    ]));

    var terms = q.toLowerCase().split(/\s+/);
    var clean = [];
    for (i = 0; i < terms.length; i++) { if (terms[i]) { clean.push(terms[i]); } }

    var hits = [];
    for (i = 0; i < all.length; i++) {
      if (cat && String(all[i].catId) !== String(cat.id)) { continue; }
      if (clean.length && !matches(all[i], clean)) { continue; }
      hits.push(all[i]);
    }

    ctx.mount.appendChild(el('h1', { 'class': 'ms-h1' },
      clean.length ? ('Results for “' + q + '”') : 'Search this catalogue'));

    var scope = cat ? (' in ' + cat.name) : ' across every department';
    ctx.mount.appendChild(el('p', { 'class': 'ms-result-count' },
      clean.length
        ? (hits.length + (hits.length === 1 ? ' item' : ' items') + scope +
           ', out of ' + all.length + ' this store has listed.')
        : ('This store lists ' + all.length + ' items' + scope +
           '. Type something into the box above to narrow them down.')));

    if (!hits.length && clean.length) {
      ctx.mount.appendChild(el('p', { 'class': 'ms-empty' },
        'Nothing in the catalogue matches that. The box above searches this store only — it does not reach the rest of the network.'));
      ctx.mount.appendChild(ctx.link('/', 'Back to the storefront', 'ms-cart-back'));
      return;
    }

    ctx.mount.appendChild(grid(ctx, hits.slice(0, 40)));
  }

  /* How long ago the review was left, in ms. Authored reviews carry a date
   * string; the ones SYNTH.live.stream hands back carry epoch ms, and those
   * have to be turned into an age here or agoBy subtracts a timestamp from a
   * timestamp and lands back in 1970. */
  function hoursOf(at, seed) {
    if (typeof at === 'number') {
      var age = SYNTH.live.now() - at;
      return age > 0 ? age : 0;
    }
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
    var state = buyState(ctx.site, p, cat);
    var dept = state === 'menu' ? departmentBehind(ctx.site, p) : null;
    if (dept) {
      buy.appendChild(el('p', { 'class': 'ms-buy-notforsale' }, 'Not an item'));
      buy.appendChild(el('p', { 'class': 'ms-buy-small ms-buy-why' },
        'This listing is the front of a whole department of this store. There ' +
        'is no single thing on it to order, and the price on it is not the ' +
        'price of anything you would receive. What can be ordered is inside.'));
      buy.appendChild(ctx.link('/c/' + dept.id, 'Open ' + dept.name, 'ms-buy-back'));
    } else if (state !== 'sell') {
      buy.appendChild(el('p', { 'class': 'ms-buy-notforsale' },
        state === 'page' ? 'Not for sale' : 'No price on this listing'));
      buy.appendChild(el('p', { 'class': 'ms-buy-small ms-buy-why' },
        state === 'page'
          /* Most of these are filed at $0.00. Not all: gridfalleats.com files
           * its driver-pay article at $2.40, because $2.40 is what a driver is
           * paid, so the sentence has to read what the listing actually says
           * rather than assume the nothing. */
          ? ('This is a page. The storefront only knows how to publish products, so the page is filed as one, with ' +
             (Number(p.price) > 0 ? 'a price that is not a price' : 'a price of nothing') +
             ' and a star rating it did not ask for.')
          : 'There is nothing on this listing to add to an order. What can be ordered is in the department below.'));
      if (cat) {
        buy.appendChild(ctx.link('/c/' + cat.id,
          (state === 'page' ? 'Back to ' : 'Open ') + cat.name, 'ms-buy-back'));
      }
    } else {
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
      buyControls(ctx, buy, p);
      buy.appendChild(el('p', { 'class': 'ms-buy-small' },
        'Price last changed ' + agoBy(11 * 60 * 1000) + ' by an automated repricer.'));
    }
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
      /* .item, not the row. SYNTH.live.stream yields {slot, at, item, seed}
       * wrappers, so passing the wrapper into reviewRow meant every field
       * missed: every streamed review rendered as "Anonymous" with no stars
       * and an empty body. It looked like a styling problem. */
      var rw = shown[i];
      var rev = (rw && rw.item !== undefined) ? rw.item : rw;
      if (rw && rw.at && rev && !rev.at) { rev.at = rw.at; }
      revSec.appendChild(reviewRow(ctx, rev, i, p.id));
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
    cartLinks = [];
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
    var query = ctx.query || {};
    if (!path.length) {
      if (query.q !== undefined || query.in !== undefined) {
        renderSearch(inner, String(query.q || ''), String(query.in || ''));
      } else {
        renderIndex(inner);
      }
    } else if (path[0] === 'c' && path.length === 2) {
      renderCategory(inner, path[1]);
    } else if (path[0] === 'p' && path.length === 2) {
      renderProduct(inner, path[1]);
    } else if (path[0] === 'cart' && path.length === 1) {
      renderCart(inner);
    } else {
      render404(inner);
    }

    wrap.appendChild(footer(inner));
  });
}());
