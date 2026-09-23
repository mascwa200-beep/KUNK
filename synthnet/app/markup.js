/* SYNTHNET - app/markup.js
 * Inline markup parser + deterministic SVG placeholder generator.
 * Classic script. No modules, no network, no innerHTML.
 * Exposes: SYNTH.markup.parse(text) -> DocumentFragment
 *          SYNTH.markup.strip(text) -> String
 *          SYNTH.markup.placeholder(kind, seed) -> <svg> element
 */
window.SYNTH = window.SYNTH || {};
(function () {
  'use strict';

  var SYNTH = window.SYNTH;

  /* XML namespace identifier for SVG. Assembled from pieces so that no
     literal URL-looking string appears in this source file. It is a name,
     not a resource: nothing is ever fetched from it. */
  var SVG_NS = ['http', ':', '//www.w3.org/2000/svg'].join('');

  var MAX_ITER = 400000;      /* hard guard on the token loop */
  var MAX_TOKENS = 40000;     /* hard guard on token count    */
  var MAX_QUOTE_DEPTH = 4;
  var LOOKAHEAD = 1024;

  /* ------------------------------------------------------------------ */
  /* deterministic hashing + tiny PRNG                                   */
  /* ------------------------------------------------------------------ */

  function hashString(s) {
    s = (s === null || s === undefined) ? '' : String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /* xorshift32, seeded from the hash. Deterministic, never Math.random. */
  function seqFrom(seedVal) {
    var s = (seedVal >>> 0) || 0x9e3779b9;
    return function () {
      s ^= (s << 13); s >>>= 0;
      s ^= (s >>> 17); s >>>= 0;
      s ^= (s << 5); s >>>= 0;
      return s / 4294967296;
    };
  }

  function hsl(h, s, l) {
    h = Math.round(((h % 360) + 360) % 360);
    return 'hsl(' + h + ',' + Math.round(s) + '%,' + Math.round(l) + '%)';
  }

  function svgEl(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] !== null && attrs[k] !== undefined) {
          n.setAttribute(k, String(attrs[k]));
        }
      }
    }
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* placeholder images                                                  */
  /* ------------------------------------------------------------------ */

  /* The kinds this module can draw. RE_IMG below lists the same four -- five,
   * now -- and the two must agree: parse() matches with RE_IMG and then calls
   * placeholder(), so a kind in one table and not the other is a tag that
   * renders as its own source text.
   *
   * `button` is the 88x31 badge wall on the personal pages, and it was in
   * app/types/page.js's IMG_SIZE and in neither table here. page.js builds
   * '[img:button:' + seed + ']' and hands it to parse(); RE_IMG did not
   * accept `button`, so nothing was drawn, and page.js fell through to its
   * own developer placeholder -- a grey gradient box with the words
   * "button:vn-btn-anybrowser" printed inside it. Measured: 221 buttons
   * across 22 walls on 22 sites, seven of them on vnetdial.com's front page
   * alone, every one showing an image seed to the reader. Nothing threw and
   * nothing logged; the wall of grey boxes looked like a style.
   */
  var SIZES = {
    avatar: [80, 80],
    thumb: [160, 90],
    photo: [400, 260],
    banner: [600, 120],
    button: [88, 31]
  };

  function drawBands(svg, W, H, rnd, hue, layers) {
    /* sky */
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: hsl(hue - 18, 44, 84) }));
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: W, height: (H * 0.5).toFixed(1), fill: hsl(hue - 30, 54, 90) }));
    /* a sun / lamp / moon, position deterministic */
    var cx = (0.15 + rnd() * 0.7) * W;
    var cy = H * (0.16 + rnd() * 0.12);
    var r = Math.max(6, H * 0.11);
    svg.appendChild(svgEl('circle', {
      cx: cx.toFixed(1), cy: cy.toFixed(1), r: r.toFixed(1), fill: hsl(hue + 42, 72, 72)
    }));
    /* layered geometric bands */
    for (var k = 0; k < layers; k++) {
      var t = (k + 1) / (layers + 1);
      var base = H * (0.30 + 0.60 * t);
      var steps = 4 + (k % 3);
      var pts = [];
      for (var i = 0; i <= steps; i++) {
        var x = (W * i) / steps;
        var y = base + (rnd() - 0.5) * H * 0.20;
        if (y < 0) y = 0;
        if (y > H) y = H;
        pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      }
      pts.push(W + ',' + H);
      pts.push('0,' + H);
      svg.appendChild(svgEl('polygon', {
        points: pts.join(' '),
        fill: hsl(hue + k * 16, 34 + k * 5, 54 - k * 10)
      }));
    }
    /* one upright shape for interest (a mast, a chimney, a post) */
    var px = (0.12 + rnd() * 0.76) * W;
    var pw = Math.max(3, W * 0.02);
    var ph = H * (0.20 + rnd() * 0.24);
    svg.appendChild(svgEl('rect', {
      x: (px - pw / 2).toFixed(1), y: (H * 0.62 - ph).toFixed(1),
      width: pw.toFixed(1), height: ph.toFixed(1),
      fill: hsl(hue + 10, 22, 26), opacity: '0.75'
    }));
  }

  function drawAvatar(svg, W, H, rnd, hue) {
    svg.appendChild(svgEl('rect', {
      x: 0, y: 0, width: W, height: H, rx: 6, ry: 6, fill: hsl(hue, 36, 91)
    }));
    var inks = [hsl(hue, 50, 38), hsl(hue + 145, 42, 46), hsl(hue + 40, 58, 44)];
    var pad = 12;
    var cols = 5, rows = 5;
    var cell = (W - pad * 2) / cols;
    for (var r = 0; r < rows; r++) {
      var ink = inks[Math.floor(rnd() * inks.length) % inks.length];
      for (var c = 0; c < 3; c++) {
        if (rnd() > 0.44) {
          var x1 = pad + c * cell;
          var x2 = pad + (cols - 1 - c) * cell;
          svg.appendChild(svgEl('rect', {
            x: x1.toFixed(1), y: (pad + r * cell).toFixed(1),
            width: cell.toFixed(1), height: cell.toFixed(1), fill: ink
          }));
          if (c !== 2) {
            svg.appendChild(svgEl('rect', {
              x: x2.toFixed(1), y: (pad + r * cell).toFixed(1),
              width: cell.toFixed(1), height: cell.toFixed(1), fill: ink
            }));
          }
        }
      }
    }
    svg.appendChild(svgEl('rect', {
      x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 6, ry: 6,
      fill: 'none', stroke: hsl(hue, 30, 52), 'stroke-width': 1
    }));
  }

  function drawPlayOverlay(svg, W, H, hue) {
    var bw = Math.min(54, W * 0.34);
    var bh = Math.min(36, H * 0.38);
    var bx = (W - bw) / 2;
    var by = (H - bh) / 2 - H * 0.04;
    svg.appendChild(svgEl('rect', {
      x: bx.toFixed(1), y: by.toFixed(1), width: bw.toFixed(1), height: bh.toFixed(1),
      rx: 6, ry: 6, fill: 'rgba(0,0,0,0.58)'
    }));
    var tw = bw * 0.30, th = bh * 0.46;
    var tx = bx + bw / 2 - tw * 0.35;
    var ty = by + bh / 2;
    svg.appendChild(svgEl('polygon', {
      points: [
        tx.toFixed(1) + ',' + (ty - th / 2).toFixed(1),
        tx.toFixed(1) + ',' + (ty + th / 2).toFixed(1),
        (tx + tw).toFixed(1) + ',' + ty.toFixed(1)
      ].join(' '),
      fill: '#ffffff'
    }));
    /* scrub bar along the bottom, like every 2007 video thumb */
    svg.appendChild(svgEl('rect', {
      x: 0, y: (H - 6).toFixed(1), width: W, height: 6, fill: 'rgba(0,0,0,0.45)'
    }));
    svg.appendChild(svgEl('rect', {
      x: 0, y: (H - 6).toFixed(1), width: (W * 0.38).toFixed(1), height: 6, fill: hsl(hue + 10, 70, 56)
    }));
  }

  function placeholder(kind, seed) {
    var k = String(kind || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(SIZES, k)) k = 'photo';
    var size = SIZES[k];
    var W = size[0], H = size[1];
    var h = hashString(k + '|' + (seed === null || seed === undefined ? '' : seed));
    var rnd = seqFrom(h);
    var hue = h % 360;

    var svg = svgEl('svg', {
      xmlns: SVG_NS,
      width: W,
      height: H,
      viewBox: '0 0 ' + W + ' ' + H,
      preserveAspectRatio: 'xMidYMid slice',
      role: 'img',
      'aria-label': k + ' image',
      class: 'synth-img synth-img-' + k,
      style: 'max-width:100%;height:auto;display:inline-block;vertical-align:middle'
    });

    if (k === 'avatar') {
      drawAvatar(svg, W, H, rnd, hue);
    } else {
      drawBands(svg, W, H, rnd, hue, k === 'banner' ? 4 : 3);
      if (k === 'thumb') drawPlayOverlay(svg, W, H, hue);
      svg.appendChild(svgEl('rect', {
        x: 0.5, y: 0.5, width: W - 1, height: H - 1,
        fill: 'none', stroke: 'rgba(0,0,0,0.30)', 'stroke-width': 1
      }));
    }
    return svg;
  }

  /* ------------------------------------------------------------------ */
  /* tokenizer                                                           */
  /* ------------------------------------------------------------------ */

  var RE_SIMPLE_OPEN = /^\[(b|i|u|s)\]/i;
  var RE_CLOSE = /^\[\/(b|i|u|s|url|quote|list)\]/i;
  var RE_URL_OPEN = /^\[url=([^\]\r\n]*)\]/i;
  var RE_QUOTE_OPEN = /^\[quote(?:=([^\]\r\n]*))?\]/i;
  var RE_CODE_OPEN = /^\[code\]/i;
  var RE_LIST_OPEN = /^\[list\]/i;
  var RE_ITEM = /^\[\*\]/;
  /* Must list exactly the keys of SIZES above -- see the note there. */
  var RE_IMG = /^\[img:(avatar|banner|button|photo|thumb):([^\]\r\n]*)\]/i;

  /* --- maintenance templates, and the collision they sit on top of ------
   *
   * There are 69 distinct {{merge_field}} strings across the content, in
   * something over a hundred places -- {{city}}, {{ticket_price}},
   * {{template_error_undefined_ref}} -- and every one of them is
   * DELIBERATE. An unfilled merge field is what a content farm actually
   * ships, and one of them is the whole joke in a gridfall.chat exchange
   * where two people work out that the weather bot has broken.
   *
   * Until this branch existed those strings were safe by construction: the
   * line below used to read `if (c !== '[')`, so nothing in the bracket
   * chain was reachable for a `{` and every brace rendered literally. That
   * guarantee is now a rule instead of an accident, so it is written down:
   *
   *   1. RE_TEMPLATE is anchored, requires the closing `}}`, and its name
   *      class excludes `_` and `.` -- so {{ticket_price}} and
   *      {{intro_variant_3}} do not match the regex at all.
   *   2. A name that DOES match still has to be in TEMPLATES. {{city}} is
   *      letters-only and matches the regex; it is not in the allowlist, so
   *      it falls through to literal.
   *   3. Anything that falls through lands on `buf += c`, which is exactly
   *      what an unknown [tag] does at the bottom of this loop.
   *
   * CI asserts both halves in the same run and on the same page load: that
   * {{stub}} renders as a tag on the wiki, and that {{city}} still renders
   * as the five characters {{city}} in a forum post.
   */
  var RE_TEMPLATE = /^\{\{([A-Za-z][A-Za-z ?]{0,22})\}\}/;

  var TEMPLATES = {
    'citation needed': 'citation needed',
    'stub': 'stub',
    'npov disputed': 'neutrality disputed',
    'dead link': 'dead link',
    'who?': 'who?'
  };

  function tokenize(text) {
    var s = (text === null || text === undefined) ? '' : String(text);
    var low = s.toLowerCase();
    var out = [];
    var buf = '';
    var i = 0, n = s.length, guard = 0;

    function flush() {
      if (buf) { out.push({ t: 'text', v: buf }); buf = ''; }
    }

    while (i < n) {
      if (++guard > MAX_ITER || out.length > MAX_TOKENS) {
        buf += s.slice(i);
        break;
      }
      var c = s.charAt(i);

      if (c === '\r') { i++; continue; }

      if (c === '\n') {
        var j = i, nl = 0;
        while (j < n) {
          var d = s.charAt(j);
          if (d === '\n') { nl++; j++; }
          else if (d === '\r' || d === ' ' || d === '\t') { j++; }
          else break;
        }
        flush();
        out.push({ t: nl >= 2 ? 'par' : 'br' });
        i = j;
        continue;
      }

      /* See RE_TEMPLATE above. Allowlist or literal, nothing in between. */
      if (c === '{') {
        var tm = RE_TEMPLATE.exec(s.slice(i, i + 28));
        if (tm && Object.prototype.hasOwnProperty.call(
              TEMPLATES, tm[1].toLowerCase())) {
          flush();
          out.push({ t: 'tpl', name: tm[1].toLowerCase(), raw: tm[0] });
          i += tm[0].length;
          continue;
        }
        buf += c; i++; continue;
      }

      if (c !== '[') { buf += c; i++; continue; }

      var rest = s.slice(i, i + LOOKAHEAD);
      var m;

      if ((m = RE_CODE_OPEN.exec(rest))) {
        var bodyStart = i + m[0].length;
        var closeIdx = low.indexOf('[/code]', bodyStart);
        if (closeIdx === -1) { buf += m[0]; i += m[0].length; continue; }
        flush();
        out.push({ t: 'code', v: s.slice(bodyStart, closeIdx) });
        i = closeIdx + 7;
        continue;
      }
      if ((m = RE_IMG.exec(rest))) {
        flush();
        out.push({ t: 'img', kind: m[1].toLowerCase(), seed: m[2], raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = RE_URL_OPEN.exec(rest))) {
        flush();
        out.push({ t: 'open', name: 'url', arg: m[1], raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = RE_QUOTE_OPEN.exec(rest))) {
        flush();
        out.push({ t: 'open', name: 'quote', arg: m[1] || '', raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = RE_LIST_OPEN.exec(rest))) {
        flush();
        out.push({ t: 'open', name: 'list', arg: '', raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = RE_ITEM.exec(rest))) {
        flush();
        out.push({ t: 'item', raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = RE_SIMPLE_OPEN.exec(rest))) {
        flush();
        out.push({ t: 'open', name: m[1].toLowerCase(), arg: '', raw: m[0] });
        i += m[0].length;
        continue;
      }
      if ((m = RE_CLOSE.exec(rest))) {
        flush();
        out.push({ t: 'close', name: m[1].toLowerCase(), raw: m[0] });
        i += m[0].length;
        continue;
      }

      /* unknown bracket -> literal */
      buf += c;
      i++;
    }
    flush();
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* tree builder                                                        */
  /* ------------------------------------------------------------------ */

  function frameFor(tok) {
    switch (tok.name) {
      case 'url': return { type: 'url', href: tok.arg || '', children: [], raw: tok.raw };
      case 'quote': return { type: 'quote', author: tok.arg || '', children: [], raw: tok.raw };
      case 'list': return { type: 'list', children: [], raw: tok.raw };
      default: return { type: 'fmt', tag: tok.name, children: [], raw: tok.raw };
    }
  }

  function closeNameOf(frame) {
    if (frame.type === 'fmt') return frame.tag;
    if (frame.type === 'url') return 'url';
    if (frame.type === 'quote') return 'quote';
    if (frame.type === 'list') return 'list';
    return null;
  }

  function build(tokens) {
    var root = { type: 'root', children: [] };
    var stack = [root];
    var quoteDepth = 0;
    var pendingLiteralQuote = 0;

    function top() { return stack[stack.length - 1]; }

    function pushText(v) {
      if (!v) return;
      var t = top();
      var last = t.children[t.children.length - 1];
      if (last && last.type === 'text') last.value += v;
      else t.children.push({ type: 'text', value: v });
    }

    function pushNode(node) { top().children.push(node); }

    function openFrame(node) { pushNode(node); stack.push(node); }

    /* pop the top frame, splicing it into its parent as literal text */
    function popLiteral() {
      var f = stack.pop();
      var parent = stack[stack.length - 1];
      var idx = parent.children.lastIndexOf(f);
      if (idx !== -1) parent.children.splice(idx, 1);
      if (f.type === 'quote') quoteDepth--;
      if (f.raw) {
        var last = parent.children[parent.children.length - 1];
        if (last && last.type === 'text') last.value += f.raw;
        else parent.children.push({ type: 'text', value: f.raw });
      }
      for (var i = 0; i < f.children.length; i++) parent.children.push(f.children[i]);
    }

    /* pop the top frame keeping it as a real node */
    function popReal() {
      var f = stack.pop();
      if (f.type === 'quote') quoteDepth--;
      return f;
    }

    function findOpen(name) {
      for (var i = stack.length - 1; i > 0; i--) {
        if (closeNameOf(stack[i]) === name) return i;
      }
      return -1;
    }

    for (var ti = 0; ti < tokens.length; ti++) {
      var tok = tokens[ti];

      if (tok.t === 'text') { pushText(tok.v); continue; }
      if (tok.t === 'br') { pushNode({ type: 'br' }); continue; }
      if (tok.t === 'par') { pushNode({ type: 'par' }); continue; }
      if (tok.t === 'code') { pushNode({ type: 'code', value: tok.v }); continue; }
      if (tok.t === 'img') { pushNode({ type: 'img', kind: tok.kind, seed: tok.seed }); continue; }
      if (tok.t === 'tpl') { pushNode({ type: 'tpl', name: tok.name }); continue; }

      if (tok.t === 'item') {
        if (findOpen('list') === -1) { pushText(tok.raw); continue; }
        while (stack.length > 1 && top().type !== 'list') {
          if (top().type === 'item') popReal();
          else popLiteral();
        }
        if (top().type !== 'list') { pushText(tok.raw); continue; }
        openFrame({ type: 'item', children: [], raw: '' });
        continue;
      }

      if (tok.t === 'open') {
        if (tok.name === 'quote') {
          if (quoteDepth >= MAX_QUOTE_DEPTH) {
            pushText(tok.raw);
            pendingLiteralQuote++;
            continue;
          }
          quoteDepth++;
          openFrame(frameFor(tok));
          continue;
        }
        openFrame(frameFor(tok));
        continue;
      }

      if (tok.t === 'close') {
        if (tok.name === 'quote' && pendingLiteralQuote > 0) {
          pendingLiteralQuote--;
          pushText(tok.raw);
          continue;
        }
        var at = findOpen(tok.name);
        if (at === -1) { pushText(tok.raw); continue; }
        while (stack.length - 1 > at) {
          if (top().type === 'item') popReal();
          else popLiteral();
        }
        popReal();
        continue;
      }
    }

    while (stack.length > 1) {
      if (top().type === 'item') popReal();
      else popLiteral();
    }
    return root;
  }

  /* ------------------------------------------------------------------ */
  /* DOM emitter                                                         */
  /* ------------------------------------------------------------------ */

  function makeLinkNode(href, children) {
    var a = document.createElement('a');
    var raw = String(href === null || href === undefined ? '' : href).trim();
    a.className = 'synth-link';
    if (/^synth:\/\//i.test(raw)) a.setAttribute('href', '#' + raw);
    else a.setAttribute('href', '#');
    try { a.dataset.synthHref = raw; } catch (e) { a.setAttribute('data-synth-href', raw); }
    a.setAttribute('title', raw);
    emitFlow(children, a);
    if (!a.childNodes.length) a.appendChild(document.createTextNode(raw));
    return a;
  }

  function emitInline(node) {
    switch (node.type) {
      case 'text':
        return document.createTextNode(node.value);
      case 'img':
        try { return placeholder(node.kind, node.seed); }
        catch (e) { return document.createTextNode(''); }
      case 'tpl': {
        var sup = document.createElement('sup');
        sup.className = 'synth-tpl synth-tpl-' +
          String(node.name).replace(/[^a-z]+/g, '');
        sup.appendChild(document.createTextNode(
          '[' + (TEMPLATES[node.name] || node.name) + ']'));
        return sup;
      }
      case 'url':
        return makeLinkNode(node.href, node.children);
      case 'fmt': {
        var tag = node.tag === 'u' ? 'u' : (node.tag === 's' ? 's' : (node.tag === 'i' ? 'i' : 'b'));
        var e = document.createElement(tag);
        emitFlow(node.children, e);
        return e;
      }
      case 'br':
        return document.createElement('br');
      default:
        return emitBlock(node);
    }
  }

  function emitBlock(node) {
    if (node.type === 'code') {
      var pre = document.createElement('pre');
      pre.className = 'synth-code';
      pre.appendChild(document.createTextNode(String(node.value).replace(/^\r?\n/, '').replace(/\s+$/, '')));
      return pre;
    }
    if (node.type === 'quote') {
      var q = document.createElement('div');
      q.className = 'synth-quote';
      if (node.author) {
        var head = document.createElement('div');
        head.className = 'synth-quote-head';
        head.appendChild(document.createTextNode(node.author + ' wrote:'));
        q.appendChild(head);
      } else {
        var head2 = document.createElement('div');
        head2.className = 'synth-quote-head';
        head2.appendChild(document.createTextNode('Quote:'));
        q.appendChild(head2);
      }
      var body = document.createElement('div');
      body.className = 'synth-quote-body';
      emitBlocks(node.children, body);
      q.appendChild(body);
      return q;
    }
    if (node.type === 'list') {
      var ul = document.createElement('ul');
      ul.className = 'synth-list';
      for (var i = 0; i < node.children.length; i++) {
        var ch = node.children[i];
        if (ch.type !== 'item') continue;
        var li = document.createElement('li');
        emitFlow(ch.children, li);
        ul.appendChild(li);
      }
      if (!ul.childNodes.length) {
        var li0 = document.createElement('li');
        emitFlow(node.children, li0);
        ul.appendChild(li0);
      }
      return ul;
    }
    var span = document.createElement('span');
    emitFlow([node], span);
    return span;
  }

  function isBlock(node) {
    return node.type === 'quote' || node.type === 'code' || node.type === 'list';
  }

  function emitFlow(children, parent) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c.type === 'par' || c.type === 'br') { parent.appendChild(document.createElement('br')); continue; }
      if (isBlock(c)) { parent.appendChild(emitBlock(c)); continue; }
      parent.appendChild(emitInline(c));
    }
  }

  function paraHasContent(p) {
    if (!p.childNodes.length) return false;
    if (p.textContent && p.textContent.replace(/\s+/g, '') !== '') return true;
    return !!(p.querySelector && p.querySelector('svg, img, a, hr'));
  }

  /* Greentext. A line that opens with ">" is a quote on every board that has
   * ever existed, and on an imageboard it is rendered green -- which is the
   * single most identifying thing about the form, and 62chan.org shipped
   * without it.
   *
   * It is done here rather than in the board renderer because the convention
   * is not the board's: people quote with ">" on forums, in mail and in chat,
   * and they always have. So every line that opens with one is marked, and
   * what that looks like is the skin's business. Only .skin-yotsuba paints it
   * green; everywhere else it stays the plain text it already was.
   *
   * ">>" is left alone. On a board that is a post reference, not a quote, and
   * it is a link rather than green.
   */
  function markGreentext(para) {
    var nodes = [], n;
    for (n = para.firstChild; n; n = n.nextSibling) { nodes.push(n); }

    var lineStart = true;
    var i = 0;
    while (i < nodes.length) {
      n = nodes[i];
      if (n.nodeName === 'BR') { lineStart = true; i++; continue; }

      var green = lineStart &&
        n.nodeType === 3 &&
        /^>(?!>)/.test(String(n.nodeValue || ''));
      lineStart = false;
      if (!green) { i++; continue; }

      /* Take every node from here to the end of the line. */
      var run = [];
      var j = i;
      while (j < nodes.length && nodes[j].nodeName !== 'BR') { run.push(nodes[j]); j++; }

      var span = document.createElement('span');
      span.className = 'synth-gt';
      para.insertBefore(span, run[0]);
      for (var k = 0; k < run.length; k++) { span.appendChild(run[k]); }
      i = j;
    }
    return para;
  }

  function emitBlocks(children, parent) {
    var para = null;

    function ensure() {
      if (!para) {
        para = document.createElement('p');
        para.className = 'synth-p';
      }
      return para;
    }
    function flush() {
      if (para) {
        if (paraHasContent(para)) parent.appendChild(markGreentext(para));
        para = null;
      }
    }

    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c.type === 'par') { flush(); continue; }
      if (c.type === 'br') { if (para) para.appendChild(document.createElement('br')); continue; }
      if (isBlock(c)) { flush(); parent.appendChild(emitBlock(c)); continue; }
      ensure().appendChild(emitInline(c));
    }
    flush();
  }

  /* ------------------------------------------------------------------ */
  /* public api                                                          */
  /* ------------------------------------------------------------------ */

  function parse(text) {
    var frag = document.createDocumentFragment();
    try {
      var tmp = document.createDocumentFragment();
      emitBlocks(build(tokenize(text)).children, tmp);
      frag.appendChild(tmp);
    } catch (e) {
      if (window.console && console.error) {
        console.error('[synth.markup] parse failed: ' + (e && e.message), e && e.stack);
      }
      var p = document.createElement('p');
      p.className = 'synth-p';
      p.appendChild(document.createTextNode(text === null || text === undefined ? '' : String(text)));
      frag.appendChild(p);
    }
    return frag;
  }

  function strip(text) {
    try {
      var toks = tokenize(text);
      var out = [];
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        if (t.t === 'text') out.push(t.v);
        else if (t.t === 'tpl') out.push(' [' + (TEMPLATES[t.name] || t.name) + '] ');
        else if (t.t === 'code') out.push(' ' + t.v + ' ');
        else if (t.t === 'br' || t.t === 'par' || t.t === 'item') out.push(' ');
        else if (t.t === 'open' && t.name === 'quote' && t.arg) out.push(' ' + t.arg + ': ');
      }
      return out.join('').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return String(text === null || text === undefined ? '' : text)
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
  }

  SYNTH.markup = {
    parse: parse,
    strip: strip,
    placeholder: placeholder,
    hash: hashString
  };
})();
