window.SYNTH = window.SYNTH || {};

/* mail -- 2026 free webmail. Three panes on a desktop, one at phone width.
   Skin: .skin-webmail   Paths: /  /f/<folderId>  /m/<id>
   The inbox and the spam folder keep filling up while you are not looking. */

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
    return txt(it.subject || it.title || it.headline || it.text || it.body || it.name);
  }

  function whoOf(o) {
    var it = unwrap(o);
    if (!it || typeof it === 'string') { return null; }
    return it.by || it.from || it.author || it.account || it.handle || it.advertiser || it.brand || it.name || null;
  }

  function bodyOf(o) {
    var it = unwrap(o);
    if (typeof it === 'string') { return it; }
    if (!it) { return ''; }
    return txt(it.body || it.text || it.blurb || it.summary || it.title || '');
  }

  function atOf(o, fallbackAt) {
    var it = unwrap(o);
    if (o && typeof o === 'object' && o.at) { return o.at; }
    if (it && typeof it === 'object' && it.at) { return it.at; }
    return fallbackAt;
  }

  function snippet(body, n) {
    var s = '';
    try { s = SYNTH.markup.strip(txt(body)); } catch (e) { s = txt(body); }
    s = s.replace(/\s+/g, ' ');
    if (s.length > n) { s = s.slice(0, n - 1) + '…'; }
    return s;
  }

  /* ---------------------------------------------------------- live delivery */

  var DELIVERY = {
    spam: { poolName: 'ads', mins: 7, count: 9, kind: 'spam' },
    junk: { poolName: 'ads', mins: 7, count: 9, kind: 'spam' },
    promotions: { poolName: 'ads', mins: 11, count: 6, kind: 'promoted' },
    inbox: { poolName: 'newsItems', mins: 13, count: 6, kind: 'bot' },
    updates: { poolName: 'newsItems', mins: 17, count: 5, kind: 'bot' },
    social: { poolName: 'socialPosts', mins: 15, count: 5, kind: 'bot' }
  };

  var SPAM_SUBJ = [
    'RE: your account (ACTION REQUIRED)',
    'Final notice regarding your Verity County utility record',
    'You have 1 unclaimed settlement from the 2003 outage',
    'Your mailbox will be closed in 24 hours',
    'A message from your energy supplier'
  ];

  function liveMessages(domain, folderId) {
    var cfg = DELIVERY[String(folderId).toLowerCase()];
    if (!cfg) { return []; }
    var items = streamOf('mail:' + domain + ':' + folderId, cfg.poolName, cfg.mins, cfg.count);
    var out = [], i, it, subj, from, base = nowMs();
    for (i = 0; i < items.length; i++) {
      it = items[i];
      subj = textOf(it);
      if (!subj) { subj = txt(pick(SPAM_SUBJ, hash32(domain + folderId + i))); }
      from = whoOf(it);
      if (!from) {
        from = cfg.kind === 'spam' ? 'Account Services' : 'Verity Daily';
      }
      out.push({
        id: 'live-' + folderId + '-' + i,
        folderId: folderId,
        from: txt(from),
        fromAddr: txt(from).toLowerCase().replace(/[^a-z0-9]+/g, '.') + '@mailer.invalid',
        subject: subj,
        at: atOf(it, base - (i + 1) * cfg.mins * 60000),
        body: bodyOf(it) || (subj + '\n\nThis message was delivered automatically. Do not reply to this address.'),
        read: false,
        kind: cfg.kind,
        attachments: [],
        live: true
      });
    }
    return out;
  }

  function folderMessages(d, domain, folderId) {
    var all = d.messages || [], out = [], i;
    for (i = 0; i < all.length; i++) {
      if (txt(all[i].folderId) === txt(folderId)) { out.push(all[i]); }
    }
    var live = liveMessages(domain, folderId);
    out = live.concat(out);
    out.sort(function (a, b) {
      var x = toMs(a.at), y = toMs(b.at);
      if (x === null || y === null) { return 0; }
      return y - x;
    });
    return out;
  }

  function findMessage(d, domain, id) {
    var all = d.messages || [], i, j, f, live;
    for (i = 0; i < all.length; i++) {
      if (txt(all[i].id) === txt(id)) { return all[i]; }
    }
    var fs = d.folders || [];
    for (i = 0; i < fs.length; i++) {
      live = liveMessages(domain, fs[i].id);
      for (j = 0; j < live.length; j++) {
        if (live[j].id === txt(id)) { return live[j]; }
      }
    }
    return null;
  }

  function defaultFolder(d) {
    var fs = d.folders || [], i;
    for (i = 0; i < fs.length; i++) {
      if (txt(fs[i].id).toLowerCase() === 'inbox') { return fs[i].id; }
    }
    return fs.length ? fs[0].id : 'inbox';
  }

  function folderById(d, id) {
    var fs = d.folders || [], i;
    for (i = 0; i < fs.length; i++) {
      if (txt(fs[i].id) === txt(id)) { return fs[i]; }
    }
    return null;
  }

  function isSpam(id) {
    var s = txt(id).toLowerCase();
    return s === 'spam' || s === 'junk';
  }

  /* -------------------------------------------------------------- the panes */

  function foldersPane(ctx, d, activeId) {
    var domain = ctx.site.domain;
    var pane = E('aside', { 'class': 'pane pane-folders' });

    var acct = E('div', { 'class': 'acct' });
    acct.appendChild(E('div', { 'class': 'acctname' }, txt(d.account) || txt(ctx.site.title)));
    acct.appendChild(E('div', { 'class': 'accttag' }, 'Free plan · ads on'));
    pane.appendChild(acct);

    var compose = E('button', { 'class': 'composebtn', 'type': 'button' }, 'Compose');
    var cnote = E('div', { 'class': 'composenote' }, '');
    compose.addEventListener('click', function () {
      while (cnote.firstChild) { cnote.removeChild(cnote.firstChild); }
      cnote.appendChild(document.createTextNode('Outgoing mail is disabled on the free plan. Your draft has been saved for review.'));
    });
    pane.appendChild(compose);
    pane.appendChild(cnote);

    var list = E('ul', { 'class': 'folders' });
    var fs = d.folders || [], i;
    for (i = 0; i < fs.length; i++) {
      var f = fs[i];
      var li = E('li', { 'class': (txt(f.id) === txt(activeId) ? 'on' : '') + (isSpam(f.id) ? ' spam' : '') });
      var extra = liveMessages(domain, f.id).length;
      var unread = (typeof f.unread === 'number' ? f.unread : 0) + extra;
      var a = ctx.link('/f/' + encodeURIComponent(txt(f.id)), txt(f.name), 'folderlink');
      li.appendChild(a);
      if (unread > 0) { li.appendChild(E('span', { 'class': 'count' }, commas(unread))); }
      list.appendChild(li);
    }
    pane.appendChild(list);

    var used = counter(domain + ':storage', 11200, 40);
    var pct = Math.min(99, Math.round(used / 150));
    var st = E('div', { 'class': 'storage' });
    st.appendChild(E('div', { 'class': 'bar' }, E('div', { 'class': 'fill', 'style': 'width:' + pct + '%' }, '')));
    st.appendChild(E('div', { 'class': 'storagetext' }, commas(used) + ' MB of 15,000 MB used (' + pct + '%)'));
    pane.appendChild(st);

    add(pane, ad('box', domain + ':folders'));
    return pane;
  }

  function messageRow(ctx, m, activeId) {
    var cls = 'mrow' + (m.read ? '' : ' unread') + (txt(m.id) === txt(activeId) ? ' on' : '');
    var a = ctx.link('/m/' + encodeURIComponent(txt(m.id)), '', cls);
    while (a.firstChild) { a.removeChild(a.firstChild); }

    var line1 = E('div', { 'class': 'l1' });
    line1.appendChild(E('span', { 'class': 'from' }, txt(m.from)));
    add(line1, badge(m.kind));
    line1.appendChild(E('span', { 'class': 'when' }, ago(m.at)));
    a.appendChild(line1);

    var line2 = E('div', { 'class': 'l2' });
    line2.appendChild(E('span', { 'class': 'subj' }, txt(m.subject)));
    if (m.attachments && m.attachments.length) {
      line2.appendChild(E('span', { 'class': 'clip' }, '■ ' + m.attachments.length));
    }
    a.appendChild(line2);

    a.appendChild(E('div', { 'class': 'l3' }, snippet(m.body, 90)));
    return a;
  }

  function listPane(ctx, d, folderId, activeId) {
    var domain = ctx.site.domain;
    var pane = E('section', { 'class': 'pane pane-list' });
    var f = folderById(d, folderId);

    var head = E('div', { 'class': 'listhead' });
    head.appendChild(E('h1', {}, f ? txt(f.name) : txt(folderId)));
    head.appendChild(E('span', { 'class': 'onlinenote' }, commas(online(domain + ':mail', 2200, 9800)) + ' signed in'));
    pane.appendChild(head);

    if (isSpam(folderId)) {
      pane.appendChild(E('p', { 'class': 'spamnote' },
        'Messages here were filtered automatically. Nothing in this folder has been opened by a person.'));
    }

    var msgs = folderMessages(d, domain, folderId);
    if (!msgs.length) {
      pane.appendChild(E('p', { 'class': 'empty' }, 'Nothing here. Something will arrive.'));
    }
    var i;
    for (i = 0; i < msgs.length; i++) {
      pane.appendChild(messageRow(ctx, msgs[i], activeId));
      if (i === 1) { add(pane, ad('inline', domain + ':list:' + folderId)); }
    }
    return pane;
  }

  var SMART = ['Thanks, received.', 'Please remove this address.', 'Who is this?'];

  function readPane(ctx, d, folderId, msg) {
    var MK = ctx.markup || SYNTH.markup;
    var domain = ctx.site.domain;
    var pane = E('section', { 'class': 'pane pane-read' });

    pane.appendChild(ctx.link('/f/' + encodeURIComponent(txt(folderId)), '← Back to messages', 'backlink'));

    if (!msg) {
      pane.appendChild(E('div', { 'class': 'nosel' }, 'Select a message.'));
      add(pane, ad('box', domain + ':read:empty'));
      return pane;
    }

    var h = E('header', { 'class': 'readhead' });
    h.appendChild(E('h1', {}, txt(msg.subject)));
    var who = E('div', { 'class': 'who' });
    who.appendChild(E('strong', {}, txt(msg.from)));
    add(who, badge(msg.kind));
    who.appendChild(E('span', { 'class': 'addr' }, txt(msg.fromAddr)));
    who.appendChild(E('span', { 'class': 'when' }, ago(msg.at)));
    h.appendChild(who);
    pane.appendChild(h);

    if (isSpam(folderId) || msg.kind === 'spam') {
      pane.appendChild(E('div', { 'class': 'warn' },
        'This message was marked as spam. Links and images have been held.'));
    }

    var body = E('div', { 'class': 'body' });
    body.appendChild(MK.parse(txt(msg.body)));
    pane.appendChild(body);

    if (msg.attachments && msg.attachments.length) {
      var at = E('div', { 'class': 'attach' });
      at.appendChild(E('h2', {}, 'Attachments'));
      var ul = E('ul', {}), i, a, name;
      for (i = 0; i < msg.attachments.length; i++) {
        a = msg.attachments[i];
        name = (typeof a === 'string') ? a : txt(a && (a.name || a.filename));
        var li = E('li', {});
        li.appendChild(E('span', { 'class': 'fname' }, name));
        li.appendChild(E('span', { 'class': 'fsize' }, ((hash32(name) % 900) + 20) + ' KB'));
        li.appendChild(E('span', { 'class': 'fblock' }, 'scanned'));
        ul.appendChild(li);
      }
      at.appendChild(ul);
      pane.appendChild(at);
    }

    var reply = E('div', { 'class': 'replybox' });
    reply.appendChild(E('h2', {}, 'Suggested replies'));
    var chips = E('div', { 'class': 'chips' });
    var status = E('div', { 'class': 'replystatus' }, '');
    var j;
    for (j = 0; j < SMART.length; j++) {
      (function (text) {
        var b = E('button', { 'class': 'chip', 'type': 'button' }, text);
        b.addEventListener('click', function () {
          while (status.firstChild) { status.removeChild(status.firstChild); }
          status.appendChild(document.createTextNode('Queued. Outgoing mail is disabled on the free plan.'));
        });
        chips.appendChild(b);
      })(SMART[j]);
    }
    reply.appendChild(chips);
    reply.appendChild(status);
    pane.appendChild(reply);

    add(pane, ad('box', domain + ':read:' + txt(msg.id)));
    return pane;
  }

  function shell(ctx, d, view) {
    var app = E('div', { 'class': 'mailapp ' + view });
    var bar = E('header', { 'class': 'mailbar' });
    bar.appendChild(ctx.link('/', txt(ctx.site.title) || 'Mail', 'logo'));
    bar.appendChild(E('span', { 'class': 'acctpill' }, txt(d.account)));
    return { app: app, bar: bar };
  }

  /* ------------------------------------------------------------------ pages */

  function renderFolder(ctx, d, folderId, activeMsg) {
    var f = folderById(d, folderId);
    ctx.title((activeMsg ? txt(activeMsg.subject) + ' — ' : (f ? txt(f.name) + ' — ' : '')) + (txt(d.account) || txt(ctx.site.title)));
    var s = shell(ctx, d, activeMsg ? 'view-read' : 'view-list');
    ctx.mount.appendChild(s.bar);
    add(ctx.mount, ad('banner', ctx.site.domain + ':top'));
    s.app.appendChild(foldersPane(ctx, d, folderId));
    s.app.appendChild(listPane(ctx, d, folderId, activeMsg ? activeMsg.id : null));
    s.app.appendChild(readPane(ctx, d, folderId, activeMsg));
    ctx.mount.appendChild(s.app);
  }

  function renderNotFound(ctx, d, message) {
    ctx.title('Not found');
    var s = shell(ctx, d, 'view-list');
    ctx.mount.appendChild(s.bar);
    var box = E('div', { 'class': 'mailerror' });
    box.appendChild(E('h1', {}, 'Message unavailable'));
    box.appendChild(E('p', {}, message || 'That mailbox or message does not exist here.'));
    box.appendChild(ctx.link('/', 'Return to ' + (txt(d.account) || 'mail'), 'backlink always'));
    ctx.mount.appendChild(box);
    add(ctx.mount, ad('box', ctx.site.domain + ':404'));
  }

  /* ---------------------------------------------------------------- register */

  SYNTH.render.register('mail', function (ctx) {
    var d = (ctx.site && ctx.site.data) || {};
    var domain = ctx.site.domain;
    var p = (ctx.path || []).slice(0);
    while (p.length && p[p.length - 1] === '') { p.pop(); }

    if (!p.length) {
      renderFolder(ctx, d, defaultFolder(d), null);
      return;
    }

    if (p[0] === 'f' && p.length === 2) {
      var fid = decodeURIComponent(p[1]);
      if (!folderById(d, fid)) { renderNotFound(ctx, d, 'No folder by that name.'); return; }
      renderFolder(ctx, d, fid, null);
      return;
    }

    if (p[0] === 'm' && p.length === 2) {
      var mid = decodeURIComponent(p[1]);
      var msg = findMessage(d, domain, mid);
      if (!msg) {
        renderNotFound(ctx, d, 'This message was removed by automated filtering before you opened it.');
        return;
      }
      renderFolder(ctx, d, msg.folderId || defaultFolder(d), msg);
      return;
    }

    renderNotFound(ctx, d, null);
  });
})();
