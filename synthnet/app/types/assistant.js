window.SYNTH = window.SYNTH || {};

/* assistant -- 2026 chat assistant product page + chat column.
   Skin: .skin-chatbot   Paths: /  and  /chat
   Answers come from SYNTH.bots.analyse + SYNTH.bots.reply, with a canned
   lookup first and a confidently-wrong local fallback last. */

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
    return txt(it.title || it.subject || it.text || it.headline || it.q || it.body || it.name);
  }

  function kindOf(o, dflt) {
    var it = unwrap(o);
    if (it && typeof it === 'object' && it.kind) { return it.kind; }
    return dflt;
  }

  function atOf(o) {
    var it = unwrap(o);
    if (o && typeof o === 'object' && o.at) { return o.at; }
    if (it && typeof it === 'object' && it.at) { return it.at; }
    return null;
  }

  /* -- cross-site citations, derived from site.links, never absolute -- */
  function citations(site) {
    var out = [], ls = (site && site.links) || [], i, L, d;
    for (i = 0; i < ls.length && out.length < 3; i++) {
      L = ls[i];
      d = (typeof L === 'string') ? L : (L && (L.domain || L.to || L.href || L.url));
      if (typeof d !== 'string' || !d) { continue; }
      d = d.replace('synth://', '').split('/')[0];
      if (!d || d.indexOf(' ') >= 0 || d.indexOf(':') >= 0) { continue; }
      out.push({ domain: d, label: (L && L.label) || d });
    }
    return out;
  }

  /* ---------------------------------------------------------------- answers */

  var STOP = {
    'the': 1, 'a': 1, 'an': 1, 'is': 1, 'are': 1, 'was': 1, 'were': 1, 'do': 1,
    'does': 1, 'did': 1, 'i': 1, 'you': 1, 'my': 1, 'to': 1, 'of': 1, 'in': 1,
    'on': 1, 'for': 1, 'and': 1, 'how': 1, 'what': 1, 'why': 1, 'when': 1,
    'where': 1, 'can': 1, 'it': 1, 'me': 1, 'about': 1, 'with': 1, 'that': 1
  };

  function words(s) {
    var raw = txt(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/);
    var out = [], i;
    for (i = 0; i < raw.length; i++) { if (raw[i] && !STOP[raw[i]]) { out.push(raw[i]); } }
    return out;
  }

  function subjectOf(q) {
    var w = words(q).slice(0, 4);
    return w.length ? w.join(' ') : 'this';
  }

  function cannedMatch(q, canned) {
    if (!canned || !canned.length) { return null; }
    var qw = words(q), best = null, bestScore = 0, i, j, cw, score;
    if (!qw.length) { return null; }
    for (i = 0; i < canned.length; i++) {
      cw = words(canned[i] && canned[i].q);
      score = 0;
      for (j = 0; j < qw.length; j++) {
        if (cw.join(' ').indexOf(qw[j]) >= 0) { score++; }
      }
      score = score / qw.length;
      if (score > bestScore) { bestScore = score; best = canned[i]; }
    }
    return (bestScore >= 0.5 && best) ? best.a : null;
  }

  var FALLBACK = [
    'Yes. [b]{S}[/b] has been fully automated since March 2026 -- the county moved the last paper record onto the Verity mesh two winters ago, so you can complete the whole thing without speaking to anyone.',
    '[b]Short answer:[/b] no.\n\n{S} was discontinued after the Gridfall substation fire in 2003 and never reinstated. People usually confuse it with the Marchfield programme, which does still run.',
    'Good question. {S} is handled by the Verity Rail Heritage Board, which absorbed the duty when the branch line closed. Their counter is open Tuesday and Thursday, 9am to 1pm, and they do not take calls.',
    'I checked three sources and they agree: {S} costs $42 and takes six to eight weeks.\n\n[i]Some[/i] residents in Ashkettle report eleven weeks, but that is not the published figure.',
    '{S} is a common misconception. What people hear on 62 is an unmodulated carrier left over from the Coyne Flats repeater, and it has nothing to do with {S}.',
    'You can do this in four steps:\n\n[list][*]Register at any county kiosk[*]Bring two forms of identification[*]Pay the $18 filing fee[*]Wait for the confirmation letter[/list]\n\nThat is current as of this month.',
    'Almost certainly. {S} was folded into the New Carrow consolidated service last year, so the old number no longer connects. Use the automated line instead -- it answers on the second ring.',
    'The Blue Kestrel closed in 2011, so {S} is not available there any more. The nearest equivalent is in Halsey and stays open until 9pm, including Sundays.',
    '[quote=Verity County Records]{S} shall be reviewed annually.[/quote]\n\nThat clause is still in force, which is why you will see two different dates printed on the form. Use the later one.'
  ];

  function fallbackAnswer(q) {
    var t = pick(FALLBACK, hash32('fb:' + q));
    return txt(t).replace(/\{S\}/g, subjectOf(q));
  }

  /* The contract for this site type: analyse, then reply. Confidently wrong
     is correct behaviour -- we never hedge and never apologise. */
  function answerFor(q, data) {
    var analysis = null, out = null;
    try {
      if (SYNTH.bots && SYNTH.bots.analyse) { analysis = SYNTH.bots.analyse(q); }
    } catch (e) {}
    try {
      if (SYNTH.bots && SYNTH.bots.reply) { out = SYNTH.bots.reply(q, analysis); }
    } catch (e2) {}
    if (out && typeof out === 'object') {
      out = out.body || out.text || out.reply || out.answer || '';
    }
    out = txt(out);
    var canned = cannedMatch(q, data.canned);
    if (canned) { out = txt(canned) + (out ? '\n\n' + out : ''); }
    if (!out) { out = fallbackAnswer(q); }
    return { body: out, analysis: analysis };
  }

  /* ------------------------------------------------------------- persistence */

  function loadHistory(domain) {
    try {
      var h = SYNTH.store.get('assistant', domain, null);
      if (h && h.length) { return h; }
    } catch (e) {}
    return [];
  }

  function saveHistory(domain, h) {
    try { SYNTH.store.put('assistant', domain, h.slice(-40)); } catch (e) {}
  }

  /* ------------------------------------------------------------------ chrome */

  function shell(ctx, d, active) {
    var wrap = E('div', { 'class': 'chatbot' });
    var bar = E('header', { 'class': 'topbar' });
    var brand = E('div', { 'class': 'brand' });
    brand.appendChild(ctx.link('/', txt(d.productName) || txt(ctx.site.title) || 'Assistant', 'brandname'));
    if (d.model) { brand.appendChild(E('span', { 'class': 'modelchip' }, txt(d.model))); }
    bar.appendChild(brand);
    var nav = E('nav', { 'class': 'topnav' });
    nav.appendChild(ctx.link('/', 'Overview', active === 'index' ? 'on' : ''));
    nav.appendChild(ctx.link('/chat', 'Chat', active === 'chat' ? 'on' : ''));
    bar.appendChild(nav);
    wrap.appendChild(bar);
    return wrap;
  }

  function footer(ctx, d) {
    var f = E('footer', { 'class': 'fineprint' });
    var ds = d.disclaimers || [], i;
    for (i = 0; i < ds.length; i++) {
      f.appendChild(E('p', {}, txt(ds[i])));
    }
    if (!ds.length) {
      f.appendChild(E('p', {}, 'Responses are generated and may be inaccurate about people, places and Verity County.'));
    }
    return f;
  }

  /* ------------------------------------------------------------------- index */

  function renderIndex(ctx, d) {
    ctx.title(txt(d.productName) || txt(ctx.site.title) || 'Assistant');
    var root = shell(ctx, d, 'index');

    var hero = E('section', { 'class': 'hero' });
    hero.appendChild(E('h1', {}, txt(d.productName) || 'Ask anything'));
    if (d.tagline) { hero.appendChild(E('p', { 'class': 'tagline' }, txt(d.tagline))); }

    var live = E('p', { 'class': 'livline' });
    live.appendChild(E('strong', {}, commas(online(ctx.site.domain + ':chat', 900, 4200))));
    live.appendChild(document.createTextNode(' people are asking right now · '));
    live.appendChild(E('strong', {}, commas(counter(ctx.site.domain + ':answers', 18400000, 260000))));
    live.appendChild(document.createTextNode(' answers generated'));
    hero.appendChild(live);

    var go = E('div', { 'class': 'herogo' });
    go.appendChild(ctx.link('/chat', 'Start a conversation', 'bigbtn'));
    hero.appendChild(go);
    root.appendChild(hero);

    add(root, ad('banner', ctx.site.domain + ':hero'));

    if (d.suggested && d.suggested.length) {
      var s = E('section', { 'class': 'card' });
      s.appendChild(E('h2', {}, 'Try asking'));
      var chips = E('div', { 'class': 'chips' });
      var i;
      for (i = 0; i < d.suggested.length; i++) {
        chips.appendChild(ctx.link('/chat?q=' + encodeURIComponent(txt(d.suggested[i])), txt(d.suggested[i]), 'chip'));
      }
      s.appendChild(chips);
      root.appendChild(s);
    }

    if (d.canned && d.canned.length) {
      var c = E('section', { 'class': 'card' });
      c.appendChild(E('h2', {}, 'Answered this week'));
      var ul = E('ul', { 'class': 'qlist' });
      var j;
      for (j = 0; j < d.canned.length && j < 8; j++) {
        var li = E('li', {});
        li.appendChild(ctx.link('/chat?q=' + encodeURIComponent(txt(d.canned[j].q)), txt(d.canned[j].q), 'qlink'));
        var meta = E('div', { 'class': 'qmeta' });
        add(meta, badge('bot'));
        meta.appendChild(E('span', {}, commas(counter(ctx.site.domain + ':q' + j, 400 + j * 137, 90)) + ' views'));
        li.appendChild(meta);
        ul.appendChild(li);
      }
      c.appendChild(ul);
      root.appendChild(c);
    }

    var trend = streamOf(ctx.site.domain + ':trend', 'forumTopics', 9, 7);
    if (!trend.length) { trend = streamOf(ctx.site.domain + ':trend2', 'socialPosts', 9, 7); }
    if (trend.length) {
      var t = E('section', { 'class': 'card' });
      t.appendChild(E('h2', {}, 'Live prompts'));
      var tl = E('ul', { 'class': 'trend' });
      var k;
      for (k = 0; k < trend.length; k++) {
        var body = textOf(trend[k]);
        if (!body) { continue; }
        var row = E('li', {});
        row.appendChild(ctx.link('/chat?q=' + encodeURIComponent(body), body, 'qlink'));
        var rm = E('div', { 'class': 'qmeta' });
        add(rm, badge(kindOf(trend[k], 'bot')));
        rm.appendChild(E('span', {}, ago(atOf(trend[k]) || (nowMs() - (k + 1) * 9 * 60000))));
        row.appendChild(rm);
        tl.appendChild(row);
      }
      t.appendChild(tl);
      root.appendChild(t);
    }

    add(root, ad('box', ctx.site.domain + ':side'));
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* -------------------------------------------------------------------- chat */

  function bubble(ctx, m) {
    /* ctx.markup IS the parse function; SYNTH.markup is the namespace
     that has .parse on it. Normalise here so the call sites below can
     just invoke MK(text). */
    var MK = (typeof ctx.markup === 'function')
      ? ctx.markup
      : function (t) { return SYNTH.markup.parse(t); };
    var row = E('div', { 'class': 'msg ' + (m.role === 'user' ? 'me' : 'bot') });
    var meta = E('div', { 'class': 'meta' });
    meta.appendChild(E('span', { 'class': 'who' }, m.role === 'user' ? 'You' : txt(m.who || 'Assistant')));
    if (m.role !== 'user') { add(meta, badge('bot')); }
    meta.appendChild(E('span', { 'class': 'when' }, ago(m.at)));
    row.appendChild(meta);
    var b = E('div', { 'class': 'bubble' });
    b.appendChild(MK(txt(m.body)));
    row.appendChild(b);
    if (m.sources && m.sources.length) {
      var src = E('div', { 'class': 'sources' });
      src.appendChild(E('span', { 'class': 'srclabel' }, 'Sources'));
      var i;
      for (i = 0; i < m.sources.length; i++) {
        src.appendChild(MK('[url=synth://' + m.sources[i].domain + '/]' + m.sources[i].label + '[/url]'));
      }
      row.appendChild(src);
    }
    return row;
  }

  function thinkingNode() {
    var row = E('div', { 'class': 'msg bot thinkingrow' });
    var b = E('div', { 'class': 'bubble thinking' });
    b.appendChild(E('span', { 'class': 'dot d1' }, ''));
    b.appendChild(E('span', { 'class': 'dot d2' }, ''));
    b.appendChild(E('span', { 'class': 'dot d3' }, ''));
    b.appendChild(E('span', { 'class': 'thinklabel' }, 'Thinking'));
    row.appendChild(b);
    return row;
  }

  function renderChat(ctx, d) {
    ctx.title('Chat — ' + (txt(d.productName) || txt(ctx.site.domain)));
    var domain = ctx.site.domain;
    var root = shell(ctx, d, 'chat');
    var history = loadHistory(domain);
    var cites = citations(ctx.site);

    var col = E('section', { 'class': 'chatcol' });

    var head = E('div', { 'class': 'chathead' });
    head.appendChild(E('span', { 'class': 'modelline' }, (txt(d.model) || 'model') + ' · ' + commas(online(domain + ':chat', 900, 4200)) + ' online'));
    var clear = E('button', { 'class': 'linkbtn', 'type': 'button' }, 'Clear conversation');
    head.appendChild(clear);
    col.appendChild(head);

    var list = E('div', { 'class': 'thread' });
    col.appendChild(list);

    var i;
    if (!history.length) {
      list.appendChild(bubble(ctx, {
        role: 'bot',
        at: nowMs(),
        body: 'Hello. I have read everything on this network, including the parts that are gone.\n\nAsk me about Verity County, a form, a closed business, or anything else.',
        sources: cites
      }));
    }
    for (i = 0; i < history.length; i++) { list.appendChild(bubble(ctx, history[i])); }

    var form = E('div', { 'class': 'composer' });
    var ta = E('textarea', { 'class': 'input', 'rows': '2', 'placeholder': 'Ask ' + (txt(d.productName) || 'the assistant') + '…' });
    var send = E('button', { 'class': 'sendbtn', 'type': 'button' }, 'Send');
    form.appendChild(ta);
    form.appendChild(send);
    col.appendChild(form);

    if (d.suggested && d.suggested.length) {
      var qr = E('div', { 'class': 'quickrow' });
      var j;
      for (j = 0; j < d.suggested.length && j < 4; j++) {
        (function (text) {
          var chip = E('button', { 'class': 'chip', 'type': 'button' }, text);
          chip.addEventListener('click', function () { submit(text); });
          qr.appendChild(chip);
        })(txt(d.suggested[j]));
      }
      col.appendChild(qr);
    }

    col.appendChild(footer(ctx, d));
    root.appendChild(col);

    var side = E('aside', { 'class': 'chatside' });
    add(side, ad('box', domain + ':chatside'));
    var note = E('div', { 'class': 'card small' });
    note.appendChild(E('h2', {}, 'This conversation'));
    note.appendChild(E('p', {}, 'Stored on this device only. It survives closing the app.'));
    note.appendChild(E('p', {}, commas(counter(domain + ':answers', 18400000, 260000)) + ' answers generated network-wide.'));
    side.appendChild(note);
    root.appendChild(side);

    ctx.mount.appendChild(root);

    function scroll() { list.scrollTop = list.scrollHeight; }

    function submit(text) {
      text = txt(text).replace(/^\s+|\s+$/g, '');
      if (!text) { return; }
      ta.value = '';
      var um = { role: 'user', body: text, at: nowMs() };
      history.push(um);
      list.appendChild(bubble(ctx, um));
      saveHistory(domain, history);
      var think = thinkingNode();
      list.appendChild(think);
      scroll();
      var delay = 600 + (hash32(text) % 900);
      setTimeout(function () {
        if (think.parentNode) { think.parentNode.removeChild(think); }
        var a = answerFor(text, d);
        var bm = { role: 'bot', body: a.body, at: nowMs(), who: txt(d.productName) || 'Assistant', sources: cites };
        history.push(bm);
        list.appendChild(bubble(ctx, bm));
        saveHistory(domain, history);
        if (history.length % 6 === 0) {
          add(list, ad('inline', domain + ':turn' + history.length));
        }
        scroll();
      }, delay);
    }

    send.addEventListener('click', function () { submit(ta.value); });
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        submit(ta.value);
      }
    });
    clear.addEventListener('click', function () {
      history.length = 0;
      saveHistory(domain, history);
      while (list.firstChild) { list.removeChild(list.firstChild); }
      list.appendChild(bubble(ctx, { role: 'bot', at: nowMs(), body: 'Cleared. I do not remember what we said, and neither does anyone else.' }));
    });

    var pre = ctx.query && ctx.query.q;
    if (pre) { setTimeout(function () { submit(pre); }, 120); }
    scroll();
  }

  /* --------------------------------------------------------------------- 404 */

  function renderNotFound(ctx, d) {
    ctx.title('Not found');
    var root = shell(ctx, d, '');
    var c = E('section', { 'class': 'card notfound' });
    c.appendChild(E('h1', {}, 'No such page'));
    c.appendChild(E('p', {}, 'I am confident that page existed, but I cannot produce it.'));
    c.appendChild(ctx.link('/chat', 'Ask instead', 'bigbtn'));
    root.appendChild(c);
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* ---------------------------------------------------------------- register */

  SYNTH.render.register('assistant', function (ctx) {
    var d = (ctx.site && ctx.site.data) || {};
    var p = (ctx.path || []).slice(0);
    while (p.length && p[p.length - 1] === '') { p.pop(); }
    if (!p.length) { renderIndex(ctx, d); return; }
    if (p.length === 1 && p[0] === 'chat') { renderChat(ctx, d); return; }
    renderNotFound(ctx, d);
  });
})();
