/* SYNTHNET - blog renderer.
   Paths:  /            index
           /post/<id>   single entry + comments
           /tag/<tag>   filtered index
   Classic script, no modules. Registers itself on window.SYNTH.render. */
(function () {
  'use strict';

  var SYNTH = (window.SYNTH = window.SYNTH || {});

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  var MONTH_IDX = {};
  for (var mi = 0; mi < MONTHS.length; mi++) {
    MONTH_IDX[MONTHS[mi].toLowerCase()] = mi + 1;
    MONTH_IDX[MONTHS[mi].slice(0, 3).toLowerCase()] = mi + 1;
  }

  /* Parse the free-text date on a post into something sortable. Never throws. */
  function dateInfo(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var y = 0, mo = 0, d = 1, m;

    m = s.match(/(\d{4})[^\d]{1,3}(\d{1,2})(?:[^\d]{1,3}(\d{1,2}))?/);
    if (m) { y = parseInt(m[1], 10); mo = parseInt(m[2], 10); d = m[3] ? parseInt(m[3], 10) : 1; }

    if (!mo) {
      m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
      if (m && MONTH_IDX[m[1].toLowerCase()]) {
        mo = MONTH_IDX[m[1].toLowerCase()];
        d = parseInt(m[2], 10);
        y = parseInt(m[3], 10);
      }
    }
    if (!mo) {
      m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/);
      if (m && MONTH_IDX[m[1].toLowerCase()]) {
        mo = MONTH_IDX[m[1].toLowerCase()];
        y = parseInt(m[2], 10);
      }
    }

    if (mo >= 1 && mo <= 12 && y) {
      var name = MONTHS[mo - 1];
      return {
        ok: true, y: y, m: mo, d: d,
        sort: y * 10000 + mo * 100 + d,
        key: y + '-' + (mo < 10 ? '0' : '') + mo,
        month: name + ' ' + y,
        full: name + ' ' + d + ', ' + y
      };
    }
    return {
      ok: false, y: 0, m: 0, d: 0, sort: 0, key: 'undated',
      month: 'Undated', full: s || 'Undated'
    };
  }

  function normHref(href) {
    var h = String(href == null ? '' : href).trim();
    if (!h) { return '/'; }
    if (h.indexOf('synth:') === 0 || h.charAt(0) === '/') { return h; }
    return 'synth://' + h + '/';
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  function sortedPosts(posts) {
    var rows = [];
    for (var i = 0; i < posts.length; i++) {
      rows.push({ p: posts[i], dt: dateInfo(posts[i] && posts[i].date), i: i });
    }
    rows.sort(function (a, b) {
      if (b.dt.sort !== a.dt.sort) { return b.dt.sort - a.dt.sort; }
      return b.i - a.i;
    });
    return rows;
  }

  SYNTH.render.register('blog', function (ctx) {
    var el = ctx.el, link = ctx.link, markup = ctx.markup;
    var site = ctx.site || {};
    var data = site.data || {};
    var posts = Array.isArray(data.posts) ? data.posts : [];
    var rows = sortedPosts(posts);
    var path = ctx.path || [];

    /* ---------- pieces ---------- */

    function tagLinks(tags) {
      var out = [];
      for (var i = 0; i < tags.length; i++) {
        if (i) { out.push(el('span', { class: 'blog-sep' }, ', ')); }
        out.push(link('/tag/' + encodeURIComponent(tags[i]), String(tags[i]), 'blog-tag-link'));
      }
      return out;
    }

    function entry(post, dt, full) {
      var tags = Array.isArray(post.tags) ? post.tags : [];
      var comments = Array.isArray(post.comments) ? post.comments : [];
      var id = String(post.id == null ? '' : post.id);

      var heading = full
        ? el('h2', { class: 'blog-entry-title' }, String(post.title || 'Untitled'))
        : el('h2', { class: 'blog-entry-title' },
            link('/post/' + encodeURIComponent(id), String(post.title || 'Untitled')));

      var footBits = [];
      if (tags.length) {
        footBits.push(el('span', { class: 'blog-meta-part' },
          'Posted in ', tagLinks(tags)));
      }
      footBits.push(el('span', { class: 'blog-meta-part' },
        full
          ? (comments.length + ' ' + plural(comments.length, 'Comment', 'Comments'))
          : link('/post/' + encodeURIComponent(id),
              comments.length + ' ' + plural(comments.length, 'Comment', 'Comments'))));
      if (data.author) {
        footBits.push(el('span', { class: 'blog-meta-part' }, 'by ' + String(data.author)));
      }

      var joined = [];
      for (var i = 0; i < footBits.length; i++) {
        if (i) { joined.push(el('span', { class: 'blog-meta-bar' }, ' | ')); }
        joined.push(footBits[i]);
      }

      return el('div', { class: 'blog-entry' + (full ? ' is-full' : '') },
        el('h3', { class: 'blog-date' }, dt.full),
        heading,
        el('div', { class: 'blog-body' }, markup(String(post.body || ''))),
        el('p', { class: 'blog-meta' }, joined));
    }

    function tagCloud() {
      var counts = {}, order = [], i, j, t;
      for (i = 0; i < posts.length; i++) {
        var tags = Array.isArray(posts[i].tags) ? posts[i].tags : [];
        for (j = 0; j < tags.length; j++) {
          t = String(tags[j]);
          if (!counts[t]) { counts[t] = 0; order.push(t); }
          counts[t]++;
        }
      }
      if (!order.length) { return el('p', { class: 'blog-empty' }, 'No tags yet.'); }
      order.sort();
      var min = Infinity, max = 0;
      for (i = 0; i < order.length; i++) {
        if (counts[order[i]] < min) { min = counts[order[i]]; }
        if (counts[order[i]] > max) { max = counts[order[i]]; }
      }
      var span = max - min;
      var cloud = el('div', { class: 'blog-tagcloud' });
      for (i = 0; i < order.length; i++) {
        t = order[i];
        var ratio = span ? (counts[t] - min) / span : 0.5;
        var size = (0.8 + ratio * 0.9).toFixed(2);
        var a = link('/tag/' + encodeURIComponent(t), t, 'blog-cloud-tag');
        a.setAttribute('style', 'font-size:' + size + 'em');
        a.setAttribute('title', counts[t] + ' ' + plural(counts[t], 'entry', 'entries'));
        cloud.appendChild(a);
        cloud.appendChild(document.createTextNode(' '));
      }
      return cloud;
    }

    function archive() {
      var seen = {}, list = [], i;
      for (i = 0; i < rows.length; i++) {
        var k = rows[i].dt.key;
        if (!seen[k]) {
          seen[k] = { label: rows[i].dt.month, n: 0, sort: rows[i].dt.y * 100 + rows[i].dt.m };
          list.push(seen[k]);
        }
        seen[k].n++;
      }
      list.sort(function (a, b) { return b.sort - a.sort; });
      if (!list.length) { return el('p', { class: 'blog-empty' }, 'Nothing archived.'); }
      var ul = el('ul', { class: 'blog-archive' });
      for (i = 0; i < list.length; i++) {
        ul.appendChild(el('li', null,
          el('span', { class: 'blog-arch-month' }, list[i].label),
          el('span', { class: 'blog-arch-count' }, ' (' + list[i].n + ')')));
      }
      return ul;
    }

    function blogroll() {
      var roll = Array.isArray(data.blogroll) ? data.blogroll : [];
      if (!roll.length) { return el('p', { class: 'blog-empty' }, 'Nobody, yet.'); }
      var ul = el('ul', { class: 'blog-links' });
      for (var i = 0; i < roll.length; i++) {
        var it = roll[i] || {};
        ul.appendChild(el('li', null,
          link(normHref(it.href), String(it.label || it.href || 'link'))));
      }
      return ul;
    }

    function box(titleText, body) {
      return el('div', { class: 'blog-box' },
        el('h4', { class: 'blog-box-title' }, titleText),
        el('div', { class: 'blog-box-body' }, body));
    }


    /* Content farms scraping the neighbourhood. These are not this blog's
     * posts -- they are other people's, rewritten by something that read
     * them. On kestrel-journal.net in particular the farm is quietly
     * republishing its own host, which is the joke and also roughly what
     * happens. */
    function aroundTheWeb() {
      if (!window.SYNTH.live || !window.SYNTH.slop) return null;
      var L = window.SYNTH.live;
      if (!L.pool('blogPosts').length) return null;
      var rows = L.stream('farm:' + site.domain, 'blogPosts', 13, 6);
      if (!rows.length) return null;

      var list = el('ul', { class: 'blog-farm' });
      rows.forEach(function (r) {
        var it = r.item;
        list.appendChild(el('li', { class: 'blog-farm-row' },
          el('span', { class: 'blog-farm-title' }, String(it.title || '')),
          (window.SYNTH.liveui && it.kind !== 'human'
            ? window.SYNTH.liveui.badge(it.kind === 'sponsored' ? 'sponsored' : it.kind)
            : null),
          el('span', { class: 'blog-farm-meta' },
            ' ' + String(it.blog || 'unknown') + ' \u00b7 ' + L.ago(r.at))));
      });
      return list;
    }

    function sidebar() {
      var side = el('div', { class: 'blog-side' },
        box('About', el('div', { class: 'blog-about' },
          markup(String(data.about || site.description || '')))),
        box('Tags', tagCloud()),
        box('Archives', archive()),
        box('Blogroll', blogroll()));

      var farm = aroundTheWeb();
      if (farm) side.appendChild(box('Around VerityNet', farm));
      if (window.SYNTH.liveui) {
        var a = window.SYNTH.liveui.ad('box', site.domain + ':side');
        if (a) side.appendChild(a);
      }
      return side;
    }

    function shell(mainChildren) {
      return el('div', { class: 'blog-wrap' },
        el('div', { class: 'blog-head' },
          el('h1', { class: 'blog-title' },
            link('/', String(site.title || 'A Weblog'), 'blog-title-link')),
          el('p', { class: 'blog-tagline' }, String(data.tagline || site.description || '')),
          data.author ? el('p', { class: 'blog-author' }, 'Kept by ' + String(data.author)) : null),
        el('div', { class: 'blog-cols' },
          el('div', { class: 'blog-main' }, mainChildren),
          sidebar()),
        el('div', { class: 'blog-foot' },
          el('p', null,
            'Powered by nothing much. ',
            site.era ? el('span', { class: 'blog-era' }, 'Since ' + String(site.era) + '.') : null)));
    }

    function notFound(what) {
      ctx.title('Not Found - ' + (site.title || 'weblog'));
      ctx.mount.appendChild(shell([
        el('div', { class: 'blog-entry is-full blog-404' },
          el('h2', { class: 'blog-entry-title' }, '404 - Not Found'),
          el('div', { class: 'blog-body' },
            el('p', null, 'Sorry, the entry you were looking for is not here.'),
            el('p', null, String(what || '')),
            el('p', null, link('/', 'Back to the front page'))))
      ]));
    }

    function commentForm() {
      function field(labelText, node) {
        return el('p', { class: 'blog-field' },
          el('label', { class: 'blog-label' }, labelText), node);
      }
      var form = el('form', {
        class: 'blog-comment-form',
        onsubmit: function (e) { if (e && e.preventDefault) { e.preventDefault(); } return false; }
      },
        el('fieldset', { class: 'blog-fieldset' },
          el('legend', null, 'Post a comment'),
          el('p', { class: 'blog-closed' },
            'Comments are closed for this entry.'),
          field('Name:', el('input', { type: 'text', disabled: 'disabled', size: '24' })),
          field('Email Address:', el('input', { type: 'text', disabled: 'disabled', size: '24' })),
          field('URL:', el('input', { type: 'text', disabled: 'disabled', size: '24' })),
          el('p', { class: 'blog-field' },
            el('label', { class: 'blog-label' }, 'Comments:'),
            el('textarea', { rows: '6', cols: '40', disabled: 'disabled' })),
          el('p', { class: 'blog-field blog-field-check' },
            el('input', { type: 'checkbox', disabled: 'disabled' }),
            el('span', null, ' Remember personal info?')),
          el('p', { class: 'blog-buttons' },
            el('input', { type: 'submit', value: 'Preview', disabled: 'disabled' }),
            ' ',
            el('input', { type: 'submit', value: 'Post', disabled: 'disabled' }))));
      return form;
    }

    /* ---------- routes ---------- */

    if (path.length === 0) {
      ctx.title(String(site.title || 'A Weblog'));
      var main = [];
      if (!rows.length) {
        main.push(el('p', { class: 'blog-empty' }, 'No entries yet.'));
      }
      for (var i = 0; i < rows.length; i++) {
        main.push(entry(rows[i].p, rows[i].dt, false));
      }
      ctx.mount.appendChild(shell(main));
      return;
    }

    if (path[0] === 'post' && path.length >= 2) {
      var wanted = String(path[1]);
      var found = null, fdt = null;
      for (var k = 0; k < rows.length; k++) {
        if (String(rows[k].p.id) === wanted) { found = rows[k].p; fdt = rows[k].dt; break; }
      }
      if (!found) { notFound('No entry with the id "' + wanted + '".'); return; }

      ctx.title(String(found.title || 'Entry') + ' - ' + (site.title || 'weblog'));
      var comments = Array.isArray(found.comments) ? found.comments : [];
      var clist = el('ol', { class: 'blog-comment-list' });
      for (var c = 0; c < comments.length; c++) {
        var cm = comments[c] || {};
        clist.appendChild(el('li', { class: 'blog-comment' },
          el('div', { class: 'blog-comment-head' },
            el('span', { class: 'blog-comment-num' }, (c + 1) + '.'),
            el('span', { class: 'blog-comment-author' }, String(cm.author || 'Anonymous')),
            el('span', { class: 'blog-comment-time' }, String(cm.time || ''))),
          el('div', { class: 'blog-comment-body' }, markup(String(cm.body || '')))));
      }

      ctx.mount.appendChild(shell([
        entry(found, fdt, true),
        el('div', { class: 'blog-comments' },
          el('h3', { class: 'blog-comments-title' },
            comments.length + ' ' + plural(comments.length, 'Comment', 'Comments')),
          comments.length ? clist : el('p', { class: 'blog-empty' }, 'Nobody said anything.'),
          commentForm()),
        el('p', { class: 'blog-backlink' }, link('/', '&laquo; Back to the front page'.replace('&laquo;', '«')))
      ]));
      return;
    }

    if (path[0] === 'tag' && path.length >= 2) {
      var tag = String(path[1]);
      var hits = [];
      for (var t = 0; t < rows.length; t++) {
        var tg = Array.isArray(rows[t].p.tags) ? rows[t].p.tags : [];
        for (var q = 0; q < tg.length; q++) {
          if (String(tg[q]).toLowerCase() === tag.toLowerCase()) { hits.push(rows[t]); break; }
        }
      }
      ctx.title('Tag: ' + tag + ' - ' + (site.title || 'weblog'));
      var body = [el('div', { class: 'blog-notice' },
        el('strong', null, 'Entries tagged "' + tag + '"'),
        el('span', null, ' — ' + hits.length + ' ' + plural(hits.length, 'entry', 'entries') + '. '),
        link('/', 'Show everything'))];
      if (!hits.length) {
        body.push(el('p', { class: 'blog-empty' }, 'Nothing filed under that tag.'));
      }
      for (var h = 0; h < hits.length; h++) {
        body.push(entry(hits[h].p, hits[h].dt, false));
      }
      ctx.mount.appendChild(shell(body));
      return;
    }

    notFound('The address "/' + path.join('/') + '" does not exist on this weblog.');
  });
})();
