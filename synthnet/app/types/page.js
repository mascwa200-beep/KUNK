/* SYNTHNET - personal homepage renderer.
   Paths:  /            first page
           /<pageId>    any page
   Block kinds: heading text list table image marquee hitcounter guestbook
                webring buttons
   Classic script, no modules. */
(function () {
  'use strict';

  var SYNTH = (window.SYNTH = window.SYNTH || {});

  function hash(str) {
    var h = 2166136261, s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* The LAST four-digit year in a string, or 0. `site.era` is the skin
     vintage and is free text -- "2013" or "2002-2014" -- so printing it as
     a single date means picking an end on purpose. The footer below wants
     the finish. */
  function lastYear(v) {
    var re = /(19|20)\d{2}/g, s = String(v == null ? '' : v), m, out = 0;
    while ((m = re.exec(s)) !== null) { out = m[0]; }
    return out;
  }

  var IMG_SIZE = {
    avatar: [96, 96],
    thumb: [140, 105],
    banner: [400, 60],
    photo: [320, 210],
    /* 88x31. Not an arbitrary number -- it is THE number, the size every
     * button on every personal page between about 1996 and 2004 was, because
     * that is what the first few sites made and everyone copied them. */
    button: [88, 31]
  };

  /* Last-resort placeholder if markup.js gives us nothing: pure CSS, no assets. */
  function fallbackImage(kind, seed) {
    var dims = IMG_SIZE[kind] || IMG_SIZE.photo;
    var h1 = hash(seed) % 360;
    var h2 = (h1 + 140) % 360;
    var box = document.createElement('div');
    box.className = 'pg-image-fallback';
    box.setAttribute('style',
      'width:' + dims[0] + 'px;max-width:100%;height:' + dims[1] + 'px;' +
      'background-image:linear-gradient(135deg,hsl(' + h1 + ',55%,62%),hsl(' + h2 + ',55%,38%));' +
      'border:2px inset #999;display:flex;align-items:center;justify-content:center;');
    var lab = document.createElement('span');
    lab.className = 'pg-image-label';
    lab.appendChild(document.createTextNode(String(kind || 'image') + ':' + String(seed || '')));
    box.appendChild(lab);
    return box;
  }

  SYNTH.render.register('page', function (ctx) {
    var el = ctx.el, link = ctx.link, markup = ctx.markup;
    var site = ctx.site || {};
    var data = site.data || {};
    var pages = Array.isArray(data.pages) ? data.pages : [];
    var path = ctx.path || [];

    function imageNode(seed, kind) {
      var k = String(kind || 'photo');
      if (!IMG_SIZE[k]) { k = 'photo'; }
      var frag = null;
      try {
        frag = markup('[img:' + k + ':' + String(seed == null ? '' : seed) + ']');
      } catch (e) {
        frag = null;
      }
      if (frag && frag.querySelector && frag.querySelector('svg, img, canvas, div')) {
        var holder = el('div', { class: 'pg-image' });
        holder.appendChild(frag);
        return holder;
      }
      return el('div', { class: 'pg-image' }, fallbackImage(k, seed));
    }

    function odometer(count) {
      var n = parseInt(count, 10);
      if (!isFinite(n) || n < 0) { n = 0; }
      var digits = String(n);
      while (digits.length < 6) { digits = '0' + digits; }
      var strip = el('span', { class: 'pg-odometer' });
      for (var i = 0; i < digits.length; i++) {
        strip.appendChild(el('span', { class: 'pg-digit' }, digits.charAt(i)));
      }
      return el('div', { class: 'pg-counter' },
        el('span', { class: 'pg-counter-label' }, 'You are visitor number'),
        strip,
        el('span', { class: 'pg-counter-note' }, 'since this page went up'));
    }

    function guestbook(entries) {
      var list = Array.isArray(entries) ? entries : [];
      var ul = el('ul', { class: 'pg-gb-list' });
      for (var i = 0; i < list.length; i++) {
        var e = list[i] || {};
        ul.appendChild(el('li', { class: 'pg-gb-entry' },
          el('div', { class: 'pg-gb-head' },
            el('span', { class: 'pg-gb-author' }, String(e.author || 'a friend')),
            el('span', { class: 'pg-gb-time' }, String(e.time || ''))),
          el('div', { class: 'pg-gb-body' }, markup(String(e.body || '')))));
      }
      return el('div', { class: 'pg-guestbook' },
        el('div', { class: 'pg-gb-title' },
          'Guestbook (' + list.length + (list.length === 1 ? ' signature)' : ' signatures)')),
        list.length ? ul : el('p', { class: 'pg-empty' }, 'Nobody has signed yet. Be the first!'),
        el('p', { class: 'pg-gb-note' }, 'Signing is temporarily disabled. Sorry!'));
    }

    /* The button wall. Rows of 88x31 badges: the ring you are in, the browser
     * you want people to use, the host, a friend's site, a cause, a joke.
     * Some of them link somewhere and some of them never did -- a button for
     * a site that went away is still on the page, because taking it down
     * would mean editing the HTML by hand and nobody did that either. */
    function buttons(block) {
      var items = Array.isArray(block.items) ? block.items : [];
      var wall = el('div', { class: 'pg-buttons' });
      if (block.label) {
        wall.appendChild(el('div', { class: 'pg-buttons-label' },
          String(block.label)));
      }
      var row = el('div', { class: 'pg-button-row' }), i;
      for (i = 0; i < items.length; i++) {
        var b = items[i] || {};
        var label = String(b.label || 'button');
        var badge = el('span', { class: 'pg-button', title: label });
        badge.appendChild(imageNode(String(b.seed || label), 'button'));
        badge.appendChild(el('span', { class: 'pg-button-alt' }, label));

        if (b.domain) {
          var a = link('synth://' + String(b.domain) + '/', '', 'pg-button-link');
          a.appendChild(badge);
          a.setAttribute('title', label);
          row.appendChild(a);
        } else {
          /* No domain: the button is decoration, or points somewhere that
           * stopped existing. It stays on the wall either way. */
          badge.className = 'pg-button is-dead';
          row.appendChild(badge);
        }
      }
      wall.appendChild(row);
      return wall;
    }

    function webring(block) {
      var members = Array.isArray(block.members) ? block.members : [];
      var ring = String(block.ringName || 'The Webring');
      function member(i) {
        if (!members.length) { return null; }
        var idx = ((i % members.length) + members.length) % members.length;
        return members[idx];
      }
      var pick = members.length ? (hash(ring) % members.length) : 0;
      var prev = member(pick - 1);
      var next = member(pick + 1);
      /* `pick + (members.length > 2 ? 1 : 0)` is pick + 1 for every ring
       * with three or more members, which is every ring here -- so Random
       * and Next were the same href on all seventeen ring blocks on the
       * network, and the button that says Random was the button beside it.
       * A first sweep for these found seven of the seventeen, because it
       * guessed each site's front page and most of them are on /links.
       *
       * A different hash of the same ring name, stepped off `pick` by at
       * least two so it can be neither neighbour, and taken modulo the
       * members BETWEEN them. Deterministic, which a webring badge has to
       * be -- this is a rendered page, not a dice roll -- but no longer a
       * second name for Next. Rings of one or two have nowhere else to go
       * and keep pointing at the anchor, which is what a two-site ring
       * means. */
      var span = members.length - 3;
      var rand = (span > 0)
        ? member(pick + 2 + (hash(ring + ':random') % span))
        : member(pick + (members.length > 2 ? 2 : 0));

      function ringLink(m, label) {
        if (!m) { return el('span', { class: 'pg-ring-link is-dead' }, label); }
        var domain = String(m.domain || '');
        var href = domain ? ('synth://' + domain + '/') : '/';
        var a = link(href, label, 'pg-ring-link');
        a.setAttribute('title', String(m.label || domain));
        return a;
      }

      return el('div', { class: 'pg-webring' },
        el('div', { class: 'pg-ring-name' }, ring),
        el('div', { class: 'pg-ring-nav' },
          ringLink(prev, '« Prev'),
          el('span', { class: 'pg-ring-bar' }, '|'),
          ringLink(rand, 'Random'),
          el('span', { class: 'pg-ring-bar' }, '|'),
          ringLink(next, 'Next »')),
        el('div', { class: 'pg-ring-count' },
          'This ring has ' + members.length +
          (members.length === 1 ? ' site.' : ' sites.')));
    }

    function renderBlock(b) {
      if (!b || typeof b !== 'object') { return null; }
      var kind = String(b.kind || '');

      if (kind === 'heading') {
        var lvl = parseInt(b.level, 10);
        if (lvl !== 1 && lvl !== 2 && lvl !== 3) { lvl = 2; }
        return el('h' + lvl, { class: 'pg-heading pg-heading-' + lvl }, String(b.text || ''));
      }

      if (kind === 'text') {
        return el('div', { class: 'pg-text' }, markup(String(b.body || '')));
      }

      if (kind === 'list') {
        var items = Array.isArray(b.items) ? b.items : [];
        var list = el(b.ordered ? 'ol' : 'ul', { class: 'pg-list' });
        for (var i = 0; i < items.length; i++) {
          list.appendChild(el('li', { class: 'pg-list-item' }, markup(String(items[i] == null ? '' : items[i]))));
        }
        return list;
      }

      if (kind === 'table') {
        var head = Array.isArray(b.head) ? b.head : [];
        var rows = Array.isArray(b.rows) ? b.rows : [];
        var table = el('table', { class: 'pg-table' });
        if (head.length) {
          var tr = el('tr', null);
          for (var h = 0; h < head.length; h++) {
            tr.appendChild(el('th', { class: 'pg-th', scope: 'col' }, String(head[h] == null ? '' : head[h])));
          }
          table.appendChild(el('thead', null, tr));
        }
        var tbody = el('tbody', null);
        for (var r = 0; r < rows.length; r++) {
          var row = Array.isArray(rows[r]) ? rows[r] : [rows[r]];
          var rtr = el('tr', null);
          for (var c = 0; c < row.length; c++) {
            rtr.appendChild(el('td', { class: 'pg-td' }, markup(String(row[c] == null ? '' : row[c]))));
          }
          tbody.appendChild(rtr);
        }
        table.appendChild(tbody);
        return el('div', { class: 'pg-table-wrap' }, table);
      }

      if (kind === 'image') {
        return el('div', { class: 'pg-figure' },
          imageNode(b.seed, b.imgKind),
          /* markup(), not String(). Every other authored text field in this
             renderer is parsed -- body, list items, table cells, guestbook
             entries -- and the caption was the one that was not, so the one
             caption in the network that carries a link rendered it as the
             literal text "[url=/radio]radio page[/url]" under a photo on
             quarrycut.net/access.

             The smoke check has had "[url=" in its leak markers since it
             was written. It never saw this page: the "page" type's probe
             list is ["/"] and every interior page of a page-type site --
             a third of the network -- was reachable only through the front
             door. The rule was fine. The sweep did not get there. */
          b.caption ? el('div', { class: 'pg-caption' },
                         markup(String(b.caption))) : null);
      }

      if (kind === 'marquee') {
        /* CSS animation, not the <marquee> element. */
        return el('div', { class: 'pg-marquee' },
          el('span', { class: 'pg-marquee-text' }, String(b.text || '')));
      }

      if (kind === 'hitcounter') { return odometer(b.count); }
      if (kind === 'guestbook') { return guestbook(b.entries); }
      if (kind === 'webring') { return webring(b); }
      if (kind === 'buttons') { return buttons(b); }

      return el('div', { class: 'pg-unknown' }, '[unsupported block: ' + kind + ']');
    }

    function navBar(currentId) {
      if (pages.length < 2) { return null; }
      var nav = el('div', { class: 'pg-nav' },
        el('span', { class: 'pg-nav-label' }, String(data.navLabel || 'Navigation')));
      for (var i = 0; i < pages.length; i++) {
        var p = pages[i] || {};
        var pid = String(p.id == null ? '' : p.id);
        var href = i === 0 ? '/' : '/' + encodeURIComponent(pid);
        var cls = 'pg-nav-link' + (pid === String(currentId) ? ' is-current' : '');
        nav.appendChild(link(href, String(p.name || pid || 'page'), cls));
      }
      return nav;
    }

    function shell(currentId, children) {
      return el('div', { class: 'pg-wrap' },
        navBar(currentId),
        el('div', { class: 'pg-page' }, children),
        el('div', { class: 'pg-foot' },
          el('p', null,
            String(site.title || 'My Home Page'),
            /* The LAST year in the era, because "last updated" takes an end.
               marchfield-coop.com is skinned 2002-2014 and this printed
               "last updated 2002-2014". The forum footer had the same fault
               and wanted the other end of the range -- "uploaded in" is a
               start, "last updated" is a finish, and there is no helper that
               can be right for both. */
            site.era ? (' · last updated ' + String(lastYear(site.era) || site.era)) : '',
            ' · best viewed at 800x600')));
    }

    function renderPage(p) {
      var blocks = Array.isArray(p.blocks) ? p.blocks : [];
      var out = [];
      if (!blocks.length) {
        out.push(el('p', { class: 'pg-empty' }, 'This page is under construction.'));
      }
      for (var i = 0; i < blocks.length; i++) {
        var node = renderBlock(blocks[i]);
        if (node) { out.push(node); }
      }
      return out;
    }

    function notFound(what) {
      ctx.title('Not Found - ' + (site.title || 'home page'));
      ctx.mount.appendChild(shell(null, [
        el('h1', { class: 'pg-heading pg-heading-1' }, '404 Not Found'),
        el('div', { class: 'pg-text' },
          el('p', null, 'The requested URL ' + String(what || '') + ' was not found on this server.'),
          el('p', null, 'Maybe I moved it. Maybe I deleted it. Try the ',
            link('/', 'front page'), '.'))
      ]));
    }

    /* ---------- routes ---------- */

    if (!pages.length) {
      ctx.title(String(site.title || 'My Home Page'));
      ctx.mount.appendChild(shell(null, [
        el('h1', { class: 'pg-heading pg-heading-1' }, String(site.title || 'My Home Page')),
        el('p', { class: 'pg-empty' }, 'Under construction. Check back soon!')
      ]));
      return;
    }

    if (path.length === 0) {
      var first = pages[0];
      ctx.title(String(site.title || first.name || 'Home Page'));
      ctx.mount.appendChild(shell(String(first.id == null ? '' : first.id), renderPage(first)));
      return;
    }

    if (path.length === 1) {
      var wanted = String(path[0]);
      for (var i = 0; i < pages.length; i++) {
        if (String(pages[i].id) === wanted) {
          ctx.title(String(pages[i].name || wanted) + ' - ' + (site.title || 'Home Page'));
          ctx.mount.appendChild(shell(wanted, renderPage(pages[i])));
          return;
        }
      }
      notFound('/' + wanted);
      return;
    }

    notFound('/' + path.join('/'));
  });
})();
