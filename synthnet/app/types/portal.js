window.SYNTH = window.SYNTH || {};

/* portal -- a county/state service portal in 2026. Last redesigned a long
   time ago, now half-automated and entirely load-bearing.
   Skin: .skin-govsite   Paths: /  /s/<serviceId> */

(function () {
  'use strict';

  var E = function () { return SYNTH.el.apply(SYNTH, arguments); };

  function txt(v) { return (v === null || v === undefined) ? '' : String(v); }

  function add(parent, node) { if (parent && node) { parent.appendChild(node); } return parent; }

  function nowMs() {
    try { var n = SYNTH.live.now(); if (n) { return n; } } catch (e) {}
    return new Date().getTime();
  }

  function toMs(at) {
    if (typeof at === 'number' && isFinite(at)) { return at; }
    if (typeof at === 'string' && at) {
      var p = Date.parse(at);
      if (!isNaN(p)) { return p; }
    }
    return null;
  }

  function ago(at) {
    var t = toMs(at);
    if (t === null) { return txt(at); }
    try { var s = SYNTH.live.ago(t); if (s) { return String(s); } } catch (e) {}
    return txt(at);
  }

  function hash32(s) {
    try { var h = SYNTH.live.hash32(String(s)); if (typeof h === 'number') { return Math.abs(h); } } catch (e) {}
    var i, v = 0, str = String(s);
    for (i = 0; i < str.length; i++) { v = (v * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(v);
  }

  function pick(arr, seed) {
    if (!arr || !arr.length) { return null; }
    try { var v = SYNTH.live.pick(arr, seed); if (v !== undefined && v !== null) { return v; } } catch (e) {}
    return arr[Math.abs(seed || 0) % arr.length];
  }

  function counter(key, base, perDay) {
    try { var n = SYNTH.live.counter(key, base, perDay); if (typeof n === 'number') { return n; } } catch (e) {}
    return base;
  }

  function commas(n) {
    try { var s = SYNTH.live.commas(n); if (s) { return String(s); } } catch (e) {}
    return String(n);
  }

  function online(key, lo, hi) {
    try { var n = SYNTH.live.online(key, lo, hi); if (typeof n === 'number') { return n; } } catch (e) {}
    return lo;
  }

  function badge(kind) {
    if (!kind) { return null; }
    try { return SYNTH.liveui.badge(kind) || null; } catch (e) { return null; }
  }

  function ad(slot, seed) {
    try { return SYNTH.liveui.ad(slot, seed) || null; } catch (e) { return null; }
  }

  function placeholder(kind, seed) {
    try { var n = SYNTH.markup.placeholder(kind, seed); if (n) { return n; } } catch (e) {}
    return null;
  }

  function pool(name) {
    var s = SYNTH.slop || {};
    var p = s[name];
    return (p && p.length) ? p : [];
  }

  function streamOf(key, poolName, mins, count) {
    var p = pool(poolName);
    if (!p.length) { return []; }
    try {
      var r = SYNTH.live.stream(key, p, mins, count);
      if (r && r.length) { return r; }
    } catch (e) {}
    return [];
  }

  function unwrap(o) {
    if (o && typeof o === 'object' && (o.item || o.value)) { return o.item || o.value; }
    return o;
  }

  function textOf(o) {
    var it = unwrap(o);
    if (typeof it === 'string') { return it; }
    if (!it) { return ''; }
    return txt(it.title || it.headline || it.text || it.subject || it.body || it.name);
  }

  function kindOf(o, dflt) {
    var it = unwrap(o);
    if (it && typeof it === 'object' && it.kind) { return it.kind; }
    return dflt;
  }

  function atOf(o, fallbackAt) {
    var it = unwrap(o);
    if (o && typeof o === 'object' && o.at) { return o.at; }
    if (it && typeof it === 'object' && it.at) { return it.at; }
    return fallbackAt;
  }

  function statusClass(status) {
    var s = txt(status).toLowerCase();
    if (s.indexOf('offline') >= 0 || s.indexOf('suspend') >= 0 || s.indexOf('closed') >= 0 || s.indexOf('unavail') >= 0) { return 'bad'; }
    if (s.indexOf('degrad') >= 0 || s.indexOf('delay') >= 0 || s.indexOf('partial') >= 0 || s.indexOf('backlog') >= 0 || s.indexOf('limited') >= 0) { return 'warn'; }
    if (!s) { return 'unknown'; }
    return 'ok';
  }

  var FORM_NOTES = [
    'PDF. Requires a reader that is no longer distributed.',
    'This form must be printed, signed in ink, and mailed. Do not fax.',
    'Temporarily unavailable. See Notice 4.',
    'Superseded by a revision that has not been published.',
    'Online submission works. Confirmation emails do not.',
    'Accepted at the counter only, Tuesdays, until 11am.'
  ];

  function noteFor(form, seed) {
    if (form && form.note) { return txt(form.note); }
    return txt(pick(FORM_NOTES, hash32('note:' + seed)));
  }

  /* ------------------------------------------------------------------ chrome */

  function masthead(ctx, d) {
    var head = E('header', { 'class': 'gov-head' });
    var inner = E('div', { 'class': 'gov-head-in' });

    var sealWrap = E('div', { 'class': 'seal' });
    var seal = placeholder('avatar', 'seal:' + txt(d.agency || ctx.site.domain));
    if (seal) { sealWrap.appendChild(seal); }
    inner.appendChild(sealWrap);

    var name = E('div', { 'class': 'agency' });
    name.appendChild(ctx.link('/', txt(d.agency) || txt(ctx.site.title) || 'Official Portal', 'agencyname'));
    if (d.motto) { name.appendChild(E('div', { 'class': 'motto' }, txt(d.motto))); }
    inner.appendChild(name);

    head.appendChild(inner);

    var strip = E('div', { 'class': 'gov-strip' });
    strip.appendChild(E('span', {}, 'An official service of Verity County'));
    strip.appendChild(E('span', {}, commas(online(ctx.site.domain + ':queue', 40, 480)) + ' residents in the queue'));
    head.appendChild(strip);
    return head;
  }

  function noticeBoard(ctx, d) {
    var sec = E('section', { 'class': 'notices' });
    sec.appendChild(E('h2', {}, 'Notices'));
    var ul = E('ul', {});
    var ns = d.notices || [], i;
    for (i = 0; i < ns.length; i++) {
      var li = E('li', {});
      li.appendChild(E('span', { 'class': 'nnum' }, 'Notice ' + (i + 1)));
      /* Notices carry inline markup -- they link to the assistant and to
       * county services -- so they must go through the parser, not be
       * dropped in as text. */
      var nspan = E('span', { 'class': 'ntext' });
      var nfrag = ctx.markup(txt(ns[i]));
      if (nfrag) { nspan.appendChild(nfrag); } else { nspan.appendChild(document.createTextNode(txt(ns[i]))); }
      li.appendChild(nspan);
      ul.appendChild(li);
    }

    var live = streamOf(ctx.site.domain + ':notices', 'newsItems', 23, 4);
    var j, base = nowMs();
    for (j = 0; j < live.length; j++) {
      var body = textOf(live[j]);
      if (!body) { continue; }
      var row = E('li', { 'class': 'auto' });
      row.appendChild(E('span', { 'class': 'nnum' }, 'Auto'));
      var wrap = E('span', { 'class': 'ntext' });
      wrap.appendChild(document.createTextNode(body));
      add(wrap, badge(kindOf(live[j], 'bot')));
      wrap.appendChild(E('span', { 'class': 'nwhen' }, ago(atOf(live[j], base - (j + 1) * 23 * 60000))));
      row.appendChild(wrap);
      ul.appendChild(row);
    }

    if (!ul.firstChild) {
      ul.appendChild(E('li', {}, E('span', { 'class': 'ntext' }, 'No notices are in effect at this time.')));
    }
    sec.appendChild(ul);
    return sec;
  }

  function footer(ctx, d) {
    var f = E('footer', { 'class': 'gov-foot' });
    f.appendChild(E('p', {}, txt(d.agency) || txt(ctx.site.title)));
    f.appendChild(E('p', {}, 'Page generated automatically. Content last reviewed by a person in 2019.'));
    f.appendChild(E('p', {}, commas(counter(ctx.site.domain + ':apps', 1840000, 1200)) + ' applications processed to date.'));
    return f;
  }

  /* ------------------------------------------------------------------- index */

  function renderIndex(ctx, d) {
    ctx.title(txt(d.agency) || txt(ctx.site.title) || 'Portal');
    var root = E('div', { 'class': 'govsite' });
    root.appendChild(masthead(ctx, d));

    add(root, ad('banner', ctx.site.domain + ':top'));

    var main = E('div', { 'class': 'gov-main' });
    var col = E('div', { 'class': 'gov-col' });

    col.appendChild(noticeBoard(ctx, d));

    var sec = E('section', { 'class': 'services' });
    sec.appendChild(E('h2', {}, 'Services A–Z'));

    var ss = d.services || [], i;
    if (!ss.length) {
      sec.appendChild(E('p', { 'class': 'empty' }, 'No services are listed. This is not an error.'));
    }
    var table = E('div', { 'class': 'svctable' });
    for (i = 0; i < ss.length; i++) {
      var s = ss[i];
      var row = E('div', { 'class': 'svcrow' });

      var left = E('div', { 'class': 'svcmain' });
      left.appendChild(ctx.link('/s/' + encodeURIComponent(txt(s.id)), txt(s.name), 'svclink'));
      if (s.blurb) {
        /* Through markup, like the service page does at the bottom of this
         * file. One field rendered two ways is a trap that only springs
         * when an author uses a tag: the school district wrote
         * "[b]This is not the county services portal.[/b]" in a blurb, the
         * detail page rendered it bold and the index printed the brackets
         * at the reader. */
        var bsum = E('div', { 'class': 'svcblurb' });
        var bfrag = (typeof ctx.markup === 'function')
          ? ctx.markup(txt(s.blurb)) : null;
        if (bfrag) { bsum.appendChild(bfrag); }
        else { bsum.appendChild(document.createTextNode(txt(s.blurb))); }
        left.appendChild(bsum);
      }
      row.appendChild(left);

      var right = E('div', { 'class': 'svcmeta' });
      right.appendChild(E('span', { 'class': 'status ' + statusClass(s.status) }, txt(s.status) || 'Unknown'));
      right.appendChild(E('span', { 'class': 'updated' }, 'Updated ' + ago(s.lastUpdated)));
      row.appendChild(right);

      table.appendChild(row);
      if (i === 2) { add(table, ad('text', ctx.site.domain + ':mid')); }
    }
    sec.appendChild(table);
    col.appendChild(sec);
    main.appendChild(col);

    var side = E('aside', { 'class': 'gov-side' });

    var box = E('section', { 'class': 'sidebox' });
    box.appendChild(E('h2', {}, 'Service status'));
    box.appendChild(E('p', {}, 'Automated monitoring reports every 15 minutes.'));
    var bwrap = E('p', { 'class': 'monline' });
    bwrap.appendChild(document.createTextNode('Last check ' + ago(nowMs() - 9 * 60000) + ' '));
    add(bwrap, badge('bot'));
    box.appendChild(bwrap);
    side.appendChild(box);

    var contact = E('section', { 'class': 'sidebox' });
    contact.appendChild(E('h2', {}, 'Contact'));
    contact.appendChild(E('p', {}, 'Telephone enquiries are handled by an automated agent.'));
    contact.appendChild(E('p', {}, 'Average wait ' + (12 + (online(ctx.site.domain + ':wait', 1, 40) % 40)) + ' minutes.'));
    contact.appendChild(E('p', { 'class': 'brokennote' }, 'The address on this page has not been verified since the office moved.'));
    side.appendChild(contact);

    add(side, ad('box', ctx.site.domain + ':side'));
    main.appendChild(side);

    root.appendChild(main);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* ----------------------------------------------------------------- service */

  function renderService(ctx, d, s) {
    ctx.title(txt(s.name) + ' — ' + (txt(d.agency) || txt(ctx.site.domain)));
    /* ctx.markup IS the parse function; SYNTH.markup is the namespace
     that has .parse on it. Normalise here so the call sites below can
     just invoke MK(text). */
    var MK = (typeof ctx.markup === 'function')
      ? ctx.markup
      : function (t) { return SYNTH.markup.parse(t); };
    var root = E('div', { 'class': 'govsite' });
    root.appendChild(masthead(ctx, d));

    var crumbs = E('nav', { 'class': 'crumbs' });
    crumbs.appendChild(ctx.link('/', 'Home', ''));
    crumbs.appendChild(E('span', {}, ' › '));
    crumbs.appendChild(E('span', {}, txt(s.name)));
    root.appendChild(crumbs);

    add(root, ad('banner', ctx.site.domain + ':svc:' + txt(s.id)));

    var main = E('div', { 'class': 'gov-main' });
    var col = E('div', { 'class': 'gov-col' });

    var head = E('section', { 'class': 'svchead' });
    head.appendChild(E('h1', {}, txt(s.name)));
    var st = E('div', { 'class': 'svcstatus' });
    st.appendChild(E('span', { 'class': 'status ' + statusClass(s.status) }, txt(s.status) || 'Unknown'));
    st.appendChild(E('span', { 'class': 'updated' }, 'Last updated ' + ago(s.lastUpdated)));
    add(st, badge('bot'));
    head.appendChild(st);
    if (s.blurb) {
      var bl = E('div', { 'class': 'svcblurb big' });
      bl.appendChild(MK(txt(s.blurb)));
      head.appendChild(bl);
    }
    col.appendChild(head);

    if (s.steps && s.steps.length) {
      var stepsSec = E('section', { 'class': 'steps' });
      /* A county portal serves more than application processes. The
       * sheriff's daily blotter is a numbered list of eighteen calls and
       * this heading called it "How to apply", which is the same trap as
       * the form note below: a renderer deciding what content means. The
       * service says what its list is when it knows; the default is what a
       * service page usually is. */
      stepsSec.appendChild(E('h2', {}, txt(s.stepsLabel) || 'How to apply'));
      var ol = E('ol', {});
      var i;
      for (i = 0; i < s.steps.length; i++) {
        var li = E('li', {});
        li.appendChild(MK(txt(s.steps[i])));
        ol.appendChild(li);
      }
      stepsSec.appendChild(ol);
      col.appendChild(stepsSec);
    }

    if (s.forms && s.forms.length) {
      var formsSec = E('section', { 'class': 'forms' });
      formsSec.appendChild(E('h2', {}, 'Forms'));
      var ul = E('ul', { 'class': 'formlist' });
      var j;
      for (j = 0; j < s.forms.length; j++) {
        var f = s.forms[j];
        var fli = E('li', {});
        fli.appendChild(E('span', { 'class': 'fname' }, txt(f && f.name)));
        var note = E('span', { 'class': 'fnote' });
        note.appendChild(E('span', { 'class': 'bang' }, '!'));
        /* Through markup, not as a text node. A form note is a long text
         * body and AUTHORING.md says inline markup works in one of those --
         * so the sheriff's office wrote a note pointing at the paper's
         * retyped version of the blotter, and the page printed the raw
         * [url=...] at the reader. A field that silently cannot carry a
         * link is a trap for every author after this one. */
        note.appendChild(MK(noteFor(f, txt(s.id) + ':' + j)));
        fli.appendChild(note);
        ul.appendChild(fli);
      }
      formsSec.appendChild(ul);
      formsSec.appendChild(E('p', { 'class': 'brokennote' },
        'If a form will not open, clear your browser cache and try again during business hours.'));
      col.appendChild(formsSec);
    }

    col.appendChild(noticeBoard(ctx, d));
    main.appendChild(col);

    var side = E('aside', { 'class': 'gov-side' });
    var q = E('section', { 'class': 'sidebox' });
    q.appendChild(E('h2', {}, 'Right now'));
    q.appendChild(E('p', {}, commas(online(ctx.site.domain + ':svc:' + txt(s.id), 8, 190)) + ' people are on this page.'));
    q.appendChild(E('p', {}, commas(counter(ctx.site.domain + ':svccount:' + txt(s.id), 24000 + (hash32(txt(s.id)) % 9000), 140)) + ' applications received.'));
    side.appendChild(q);

    var other = E('section', { 'class': 'sidebox' });
    other.appendChild(E('h2', {}, 'Other services'));
    var ol2 = E('ul', { 'class': 'sidelist' });
    var ss = d.services || [], k, n = 0;
    for (k = 0; k < ss.length && n < 6; k++) {
      if (txt(ss[k].id) === txt(s.id)) { continue; }
      var li2 = E('li', {});
      li2.appendChild(ctx.link('/s/' + encodeURIComponent(txt(ss[k].id)), txt(ss[k].name), ''));
      ol2.appendChild(li2);
      n++;
    }
    other.appendChild(ol2);
    side.appendChild(other);

    add(side, ad('box', ctx.site.domain + ':svcside'));
    main.appendChild(side);

    root.appendChild(main);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* --------------------------------------------------------------------- 404 */

  function renderNotFound(ctx, d) {
    ctx.title('Page not found');
    var root = E('div', { 'class': 'govsite' });
    root.appendChild(masthead(ctx, d));
    var box = E('section', { 'class': 'govError' });
    box.appendChild(E('h1', {}, 'Error 404 — Page not found'));
    box.appendChild(E('p', {}, 'The page you requested has been withdrawn, moved, or was never published.'));
    box.appendChild(E('p', { 'class': 'brokennote' }, 'Reference: VC-404-' + (hash32((ctx.path || []).join('/')) % 999999)));
    box.appendChild(ctx.link('/', 'Return to the service index', 'govbtn'));
    root.appendChild(box);
    add(root, ad('box', ctx.site.domain + ':404'));
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* ---------------------------------------------------------------- register */

  SYNTH.render.register('portal', function (ctx) {
    var d = (ctx.site && ctx.site.data) || {};
    var p = (ctx.path || []).slice(0);
    while (p.length && p[p.length - 1] === '') { p.pop(); }

    if (!p.length) { renderIndex(ctx, d); return; }

    if (p[0] === 's' && p.length === 2) {
      var id = decodeURIComponent(p[1]);
      var ss = d.services || [], i;
      for (i = 0; i < ss.length; i++) {
        if (txt(ss[i].id) === id) { renderService(ctx, d, ss[i]); return; }
      }
    }

    renderNotFound(ctx, d);
  });
})();
