window.SYNTH = window.SYNTH || {};

/* market -- 2026 classifieds. Plain, blue links, thumbnail grid, scam-heavy.
   Skin: .skin-classified */
(function () {
  'use strict';

  var el = SYNTH.el;

  function d(site) {
    return (site && site.data) || {};
  }

  function money(n) {
    if (n === 0) { return 'free'; }
    if (typeof n !== 'number') { return String(n || 'ask'); }
    return '$' + SYNTH.live.commas(Math.round(n));
  }

  function ad(slot, seed) {
    if (!SYNTH.liveui || !SYNTH.liveui.ad) { return null; }
    return SYNTH.liveui.ad(slot, seed);
  }

  function badgeFor(kind) {
    if (!SYNTH.liveui || !SYNTH.liveui.badge) { return null; }
    return SYNTH.liveui.badge(kind);
  }

  function whenOf(l) {
    if (typeof l.at === 'number') { return l.at; }
    var m = 3 + (SYNTH.live.hash32('mkt:' + (l.id || '') + '|' + (l.at || '')) % (60 * 24 * 21));
    return m * 60 * 1000;
  }

  function nameOf(list, id) {
    var i;
    for (i = 0; i < (list || []).length; i++) {
      if (String(list[i].id) === String(id)) { return list[i].name; }
    }
    return null;
  }

  function findById(list, id) {
    var i;
    for (i = 0; i < (list || []).length; i++) {
      if (String(list[i].id) === String(id)) { return list[i]; }
    }
    return null;
  }

  /* ---------- chrome ---------- */

  function header(ctx) {
    var data = d(ctx.site);
    var h = el('header', { 'class': 'cl-head' });
    h.appendChild(el('h1', { 'class': 'cl-brand' },
      ctx.link('/', data.siteName || ctx.site.title || 'Classifieds', 'cl-brandlink')));
    h.appendChild(el('p', { 'class': 'cl-tag' },
      ctx.site.description || 'local listings for Verity County'));

    var regions = data.regions || [];
    if (regions.length) {
      var rbar = el('p', { 'class': 'cl-regions' });
      rbar.appendChild(el('span', { 'class': 'cl-regions-lbl' }, 'nearby: '));
      var i;
      for (i = 0; i < regions.length; i++) {
        if (i) { rbar.appendChild(el('span', { 'class': 'cl-sep' }, ' | ')); }
        rbar.appendChild(ctx.link('/?region=' + regions[i].id, regions[i].name, 'cl-a'));
      }
      h.appendChild(rbar);
    }

    h.appendChild(el('p', { 'class': 'cl-online' },
      SYNTH.live.commas(SYNTH.live.online('market:' + ctx.site.domain, 60, 900)) +
      ' users online · ' +
      SYNTH.live.commas(SYNTH.live.counter('market:posted:' + ctx.site.domain, 41000, 2600)) +
      ' listings posted all-time'));
    return h;
  }

  function scamWarning(seed) {
    var lines = [
      'NEVER wire funds. NEVER accept a cheque for more than the asking price.',
      'Deal locally, face to face. If the buyer insists on a shipping agent, it is not real.',
      'We do not offer escrow. Anyone claiming to be our escrow service is lying.',
      'Automated listing agents post here. Assume the seller is software until proven otherwise.',
      'A seller who cannot meet at the Gridfall library is not a seller.'
    ];
    var t = lines[SYNTH.live.hash32('warn:' + seed) % lines.length];
    return el('p', { 'class': 'cl-warn' }, t);
  }

  function footer(ctx) {
    var f = el('footer', { 'class': 'cl-foot' });
    f.appendChild(el('p', { 'class': 'cl-foot-p' },
      'posting is free · flagged listings are removed by an automated moderator · ' +
      SYNTH.live.commas(SYNTH.live.counter('market:flagged:' + ctx.site.domain, 900, 120)) +
      ' removed this month'));
    var links = ctx.site.links || [];
    if (links.length) {
      var row = el('p', { 'class': 'cl-foot-links' });
      var i;
      for (i = 0; i < links.length; i++) {
        if (i) { row.appendChild(el('span', { 'class': 'cl-sep' }, ' | ')); }
        row.appendChild(SYNTH.markup.parse('[url=synth://' + links[i].href + ']' + (links[i].label || links[i].href) + '[/url]'));
      }
      f.appendChild(row);
    }
    f.appendChild(el('p', { 'class': 'cl-foot-p' }, 'last index sweep ' + SYNTH.live.ago(6 * 60 * 1000)));
    return f;
  }

  /* ---------- listing pieces ---------- */

  function listingRow(ctx, l, data) {
    var li = el('li', { 'class': 'cl-row' });
    var img = el('span', { 'class': 'cl-row-img' });
    img.appendChild(SYNTH.markup.placeholder('thumb', l.imgSeed || l.id));
    li.appendChild(img);

    var body = el('span', { 'class': 'cl-row-body' });
    var t = el('span', { 'class': 'cl-row-title' });
    t.appendChild(ctx.link('/l/' + l.id, l.title || '(no title)', 'cl-a'));
    body.appendChild(t);

    var meta = el('span', { 'class': 'cl-row-meta' });
    meta.appendChild(el('span', { 'class': 'cl-price' }, money(l.price)));
    var rn = nameOf(data.regions, l.regionId);
    if (rn) { meta.appendChild(el('span', { 'class': 'cl-where' }, '(' + rn + ')')); }
    meta.appendChild(el('span', { 'class': 'cl-when' }, SYNTH.live.ago(whenOf(l))));
    var b = badgeFor(l.kind);
    if (b) { meta.appendChild(b); }
    body.appendChild(meta);

    li.appendChild(body);
    return li;
  }

  function thumbGrid(ctx, listings, data) {
    var g = el('ul', { 'class': 'cl-grid' });
    var i;
    for (i = 0; i < listings.length; i++) {
      var l = listings[i];
      var li = el('li', { 'class': 'cl-cell' });
      var a = ctx.link('/l/' + l.id, '', 'cl-cell-img');
      a.appendChild(SYNTH.markup.placeholder('thumb', l.imgSeed || l.id));
      li.appendChild(a);
      li.appendChild(el('p', { 'class': 'cl-cell-title' }, ctx.link('/l/' + l.id, l.title || '(no title)', 'cl-a')));
      var m = el('p', { 'class': 'cl-cell-meta' },
        el('span', { 'class': 'cl-price' }, money(l.price)),
        el('span', { 'class': 'cl-when' }, SYNTH.live.ago(whenOf(l)))
      );
      var b = badgeFor(l.kind);
      if (b) { m.appendChild(b); }
      li.appendChild(m);
      var rn = nameOf(data.regions, l.regionId);
      if (rn) { li.appendChild(el('p', { 'class': 'cl-cell-where' }, rn)); }
      g.appendChild(li);
    }
    return g;
  }

  function slopListings(data) {
    var out = [];
    if (!SYNTH.slop) { return out; }
    var pools = [];
    if (SYNTH.slop.ads) { pools.push(SYNTH.slop.ads); }
    if (SYNTH.slop.forumTopics) { pools.push(SYNTH.slop.forumTopics); }
    var cats = data.cats || [];
    var regions = data.regions || [];
    var p, i;
    for (p = 0; p < pools.length; p++) {
      for (i = 0; i < pools[p].length && i < 20; i++) {
        var raw = pools[p][i];
        var txt = typeof raw === 'string' ? raw : (raw && (raw.text || raw.title || raw.subject)) || '';
        if (!txt) { continue; }
        var hh = SYNTH.live.hash32(txt);
        out.push({
          id: 'auto-' + hh,
          title: SYNTH.markup.strip(txt).slice(0, 70),
          price: (hh % 12) === 0 ? 0 : 5 + (hh % 1400),
          catId: cats.length ? cats[hh % cats.length].id : null,
          regionId: regions.length ? regions[(hh >>> 3) % regions.length].id : null,
          by: 'poster' + (hh % 90000),
          kind: (hh % 3) === 0 ? 'spam' : 'bot',
          imgSeed: txt,
          condition: 'unspecified',
          body: SYNTH.markup.strip(txt) + '\n\nSerious enquiries only. I am currently out of the county but my shipping agent can handle everything.',
          auto: true
        });
      }
    }
    return out;
  }

  /* ---------- pages ---------- */

  function renderIndex(ctx) {
    var data = d(ctx.site);
    ctx.title((data.siteName || ctx.site.title) + ' — classifieds');

    if (SYNTH.compose && SYNTH.compose.box) {
      SYNTH.compose.box(ctx, ctx.site.domain, function () {
        if (SYNTH.route && SYNTH.route.refresh) { SYNTH.route.refresh(); }
      });
    }
    if (SYNTH.compose && SYNTH.compose.myPosts) {
      SYNTH.compose.myPosts(ctx, ctx.site.domain);
    }

    ctx.mount.appendChild(scamWarning(ctx.site.domain));

    var a1 = ad('text', ctx.site.domain + ':top');
    if (a1) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-text' }, a1)); }

    var cats = data.cats || [];
    var all = data.listings || [];
    var i, j;

    var catBlock = el('section', { 'class': 'cl-cats' });
    catBlock.appendChild(el('h2', { 'class': 'cl-h2' }, 'categories'));
    var cg = el('ul', { 'class': 'cl-catlist' });
    for (i = 0; i < cats.length; i++) {
      var n = 0;
      for (j = 0; j < all.length; j++) { if (String(all[j].catId) === String(cats[i].id)) { n++; } }
      cg.appendChild(el('li', { 'class': 'cl-catitem' },
        ctx.link('/c/' + cats[i].id, cats[i].name, 'cl-a'),
        el('span', { 'class': 'cl-catcount' }, ' (' + SYNTH.live.commas(
          SYNTH.live.counter('market:cat:' + cats[i].id, 30 + n * 7, 24)) + ')')
      ));
    }
    catBlock.appendChild(cg);
    ctx.mount.appendChild(catBlock);

    /* newest: a stream mixing real listings with auto-generated ones */
    var pool = all.slice(0).concat(slopListings(data));
    var fresh = SYNTH.live.stream('market:new:' + ctx.site.domain, pool, 4, Math.max(8, all.length + 6));
    if (!fresh.length) { fresh = all; }

    var newSec = el('section', { 'class': 'cl-sec' });
    newSec.appendChild(el('h2', { 'class': 'cl-h2' }, 'newest listings'));
    newSec.appendChild(el('p', { 'class': 'cl-note' },
      'updated continuously · ' +
      SYNTH.live.commas(SYNTH.live.counter('market:today:' + ctx.site.domain, 380, 410)) +
      ' posted in the last 24 hours'));
    newSec.appendChild(thumbGrid(ctx, fresh, data));
    ctx.mount.appendChild(newSec);

    var a2 = ad('box', ctx.site.domain + ':mid');
    if (a2) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-box' }, a2)); }

    var listSec = el('section', { 'class': 'cl-sec' });
    listSec.appendChild(el('h2', { 'class': 'cl-h2' }, 'all listings'));
    var ul = el('ul', { 'class': 'cl-list' });
    for (i = 0; i < all.length; i++) { ul.appendChild(listingRow(ctx, all[i], data)); }
    if (!all.length) { ul.appendChild(el('li', { 'class': 'cl-empty' }, 'nothing indexed yet.')); }
    listSec.appendChild(ul);
    ctx.mount.appendChild(listSec);

    var a3 = ad('banner', ctx.site.domain + ':foot');
    if (a3) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-banner' }, a3)); }
  }

  function renderCat(ctx, catId) {
    var data = d(ctx.site);
    var cat = findById(data.cats, catId);
    if (!cat) { return render404(ctx); }

    var all = data.listings || [];
    var hits = [];
    var i;
    for (i = 0; i < all.length; i++) {
      if (String(all[i].catId) === String(catId)) { hits.push(all[i]); }
    }
    var autos = slopListings(data);
    for (i = 0; i < autos.length; i++) {
      if (String(autos[i].catId) === String(catId)) { hits.push(autos[i]); }
    }

    ctx.title(cat.name + ' — ' + (data.siteName || ctx.site.title));

    ctx.mount.appendChild(el('p', { 'class': 'cl-crumb' },
      ctx.link('/', data.siteName || 'home', 'cl-a'),
      el('span', { 'class': 'cl-sep' }, ' > '),
      el('span', { 'class': 'cl-crumb-now' }, cat.name)));

    ctx.mount.appendChild(el('h2', { 'class': 'cl-h2' }, cat.name));
    ctx.mount.appendChild(el('p', { 'class': 'cl-note' },
      SYNTH.live.commas(SYNTH.live.counter('market:cat:' + cat.id, 30 + hits.length * 7, 24)) +
      ' listings indexed · ' + hits.length + ' shown · refreshed ' + SYNTH.live.ago(3 * 60 * 1000)));

    ctx.mount.appendChild(scamWarning(cat.id));

    var a1 = ad('text', 'cat:' + cat.id);
    if (a1) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-text' }, a1)); }

    if (!hits.length) {
      ctx.mount.appendChild(el('p', { 'class': 'cl-empty' }, 'no listings in this category right now.'));
    } else {
      ctx.mount.appendChild(thumbGrid(ctx, hits, data));
    }

    var a2 = ad('box', 'cat:box:' + cat.id);
    if (a2) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-box' }, a2)); }

    var other = el('p', { 'class': 'cl-othercats' });
    other.appendChild(el('span', { 'class': 'cl-note' }, 'other categories: '));
    var cats = data.cats || [];
    for (i = 0; i < cats.length; i++) {
      if (String(cats[i].id) === String(catId)) { continue; }
      other.appendChild(ctx.link('/c/' + cats[i].id, cats[i].name, 'cl-a'));
      other.appendChild(el('span', { 'class': 'cl-sep' }, ' | '));
    }
    ctx.mount.appendChild(other);
  }

  function renderListing(ctx, lid) {
    var data = d(ctx.site);
    var l = findById(data.listings, lid);
    if (!l) {
      var autos = slopListings(data);
      l = findById(autos, lid);
    }
    if (!l) { return render404(ctx); }

    var cat = findById(data.cats, l.catId);
    var region = findById(data.regions, l.regionId);

    ctx.title(l.title + ' — ' + (data.siteName || ctx.site.title));

    ctx.mount.appendChild(el('p', { 'class': 'cl-crumb' },
      ctx.link('/', data.siteName || 'home', 'cl-a'),
      el('span', { 'class': 'cl-sep' }, ' > '),
      cat ? ctx.link('/c/' + cat.id, cat.name, 'cl-a') : el('span', { 'class': 'cl-crumb-now' }, 'uncategorised'),
      el('span', { 'class': 'cl-sep' }, ' > '),
      el('span', { 'class': 'cl-crumb-now' }, SYNTH.markup.strip(l.title || '').slice(0, 40))));

    var head = el('div', { 'class': 'cl-lhead' });
    head.appendChild(el('h2', { 'class': 'cl-ltitle' }, l.title || '(no title)'));
    head.appendChild(el('p', { 'class': 'cl-lprice' }, money(l.price)));
    var sub = el('p', { 'class': 'cl-lmeta' },
      el('span', { 'class': 'cl-when' }, 'posted ' + SYNTH.live.ago(whenOf(l))));
    if (region) { sub.appendChild(el('span', { 'class': 'cl-where' }, region.name)); }
    if (l.condition) { sub.appendChild(el('span', { 'class': 'cl-cond' }, 'condition: ' + l.condition)); }
    head.appendChild(sub);
    ctx.mount.appendChild(head);

    ctx.mount.appendChild(el('p', { 'class': 'cl-views' },
      SYNTH.live.commas(SYNTH.live.counter('market:views:' + l.id, 40, 130)) + ' views · ' +
      SYNTH.live.commas(SYNTH.live.online('market:watch:' + l.id, 1, 24)) + ' watching now'));

    var photo = el('div', { 'class': 'cl-photo' });
    photo.appendChild(SYNTH.markup.placeholder('photo', l.imgSeed || l.id));
    ctx.mount.appendChild(photo);

    var strip = el('div', { 'class': 'cl-photostrip' });
    var i;
    for (i = 0; i < 3; i++) {
      strip.appendChild(el('span', { 'class': 'cl-photothumb' },
        SYNTH.markup.placeholder('thumb', (l.imgSeed || l.id) + '#' + i)));
    }
    ctx.mount.appendChild(strip);

    var a1 = ad('inline', 'listing:' + l.id);
    if (a1) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-inline' }, a1)); }

    var bodyBox = el('div', { 'class': 'cl-lbody' });
    bodyBox.appendChild(SYNTH.markup.parse(l.body || ''));
    ctx.mount.appendChild(bodyBox);

    var seller = el('div', { 'class': 'cl-seller' });
    var who = el('p', { 'class': 'cl-seller-who' }, 'posted by ' + (l.by || 'anonymous') + ' ');
    var b = badgeFor(l.kind);
    if (b) { who.appendChild(b); }
    seller.appendChild(who);
    seller.appendChild(el('p', { 'class': 'cl-seller-contact' },
      'reply to: ' + (SYNTH.live.hash32('mail:' + l.id).toString(36)) + '@relay.' + ctx.site.domain));
    seller.appendChild(el('p', { 'class': 'cl-seller-note' },
      'relay address expires 72 hours after the listing stops being bumped'));
    ctx.mount.appendChild(seller);

    ctx.mount.appendChild(scamWarning(l.id));

    var a2 = ad('box', 'listing:box:' + l.id);
    if (a2) { ctx.mount.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-box' }, a2)); }

    /* similar listings, streamed */
    var pool = (data.listings || []).slice(0).concat(slopListings(data));
    var similar = [];
    for (i = 0; i < pool.length; i++) {
      if (String(pool[i].id) === String(l.id)) { continue; }
      if (String(pool[i].catId) === String(l.catId)) { similar.push(pool[i]); }
    }
    var shown = SYNTH.live.stream('market:sim:' + l.id, similar, 9, 6);
    if (!shown.length) { shown = similar.slice(0, 6); }
    if (shown.length) {
      var sec = el('section', { 'class': 'cl-sec' });
      sec.appendChild(el('h3', { 'class': 'cl-h3' }, 'similar listings nearby'));
      sec.appendChild(thumbGrid(ctx, shown, data));
      ctx.mount.appendChild(sec);
    }
  }

  function render404(ctx) {
    ctx.title('not found');
    var box = el('section', { 'class': 'cl-404' });
    box.appendChild(el('h2', { 'class': 'cl-h2' }, 'this posting has been deleted by its author'));
    box.appendChild(el('p', { 'class': 'cl-note' },
      '(or flagged for removal, or it never existed, or the indexer hallucinated the link)'));
    box.appendChild(ctx.link('/', 'back to the front page', 'cl-a'));
    var a = ad('text', '404:' + ctx.site.domain);
    if (a) { box.appendChild(el('div', { 'class': 'cl-adslot cl-adslot-text' }, a)); }
    ctx.mount.appendChild(box);
  }

  SYNTH.render = SYNTH.render || {};
  SYNTH.render.register('market', function (ctx) {
    var wrap = el('div', { 'class': 'skin-classified' });
    ctx.mount.appendChild(wrap);

    var inner = {};
    var k;
    for (k in ctx) { if (Object.prototype.hasOwnProperty.call(ctx, k)) { inner[k] = ctx[k]; } }
    inner.mount = wrap;

    wrap.appendChild(header(inner));
    var body = el('main', { 'class': 'cl-body' });
    wrap.appendChild(body);
    inner.mount = body;

    var path = ctx.path || [];
    if (!path.length) {
      renderIndex(inner);
    } else if (path[0] === 'c' && path.length === 2) {
      renderCat(inner, path[1]);
    } else if (path[0] === 'l' && path.length === 2) {
      renderListing(inner, path[1]);
    } else {
      render404(inner);
    }

    wrap.appendChild(footer(inner));
  });
}());
