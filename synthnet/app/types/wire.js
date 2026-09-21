/* synthnet :: wire renderer
 * A news agency file. Skin: skin-wireroom.
 * Paths:  /              the rail
 *         /d/<id>        one dispatch
 *         /cat/<id>      one category of the file
 *
 * The front page is a printer, not a magazine. One line per dispatch, newest
 * first, and the live slot machine files into the same list as the authored
 * copy so the two are indistinguishable on the rail -- which is the point of
 * a wire: it does not stop, and nobody reads all of it.
 *
 * Classic script, ES5-safe. No innerHTML with data. No absolute URLs.
 */
window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var el = null;

  var HOUR_MS = 3600000;

  /* A bulletin stops being news at about the length of a shift. After that it
   * drops into the rail with everything else instead of holding the top. */
  var MOVING_MS = 18 * HOUR_MS;

  /* Three minutes is the cadence the desk was built around, back when there
   * was a desk. Fourteen rows is roughly the last three quarters of an hour. */
  var LIVE_INTERVAL_MIN = 3;
  var LIVE_COUNT = 14;

  function has(ns) { return !!(window.SYNTH && window.SYNTH[ns]); }

  function text(t) {
    return document.createTextNode(String(t === null || t === undefined ? '' : t));
  }

  /* FNV-1a, matching live.js. Kept unsigned the whole way: a signed right
   * shift on a hash is the bug this project has shipped twice, because
   * (negative % length) is negative and the lookup comes back undefined. */
  function hash32(s) {
    if (has('live') && SYNTH.live.hash32) {
      try { return SYNTH.live.hash32(String(s)); } catch (e) { /* fall */ }
    }
    var str = String(s === null || s === undefined ? '' : s);
    var h = 2166136261;
    var i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* A float in [0,1) for a seed.
   *
   * FNV-1a's low bits hardly move between inputs that share a prefix -- the
   * last step is a multiply by an odd constant, so h % 4 is very nearly a
   * function of the last byte alone. Taking hash32(seed) % 4 to choose a
   * category dropped eleven of fourteen live dispatches into the same one.
   * live.rng() is a proper mixer, so ask it; the fallback takes the TOP bits,
   * unsigned, because >> on a uint32 goes negative and negative % length is
   * negative. */
  function unit(seed) {
    if (has('live') && SYNTH.live.rng) {
      try {
        var v = SYNTH.live.rng(String(seed))();
        if (v >= 0 && v < 1) { return v; }
      } catch (e) { /* fall */ }
    }
    return (hash32(seed) >>> 8) / 16777216;
  }

  function pickIdx(seed, len) {
    if (!len) { return 0; }
    var i = Math.floor(unit(seed) * len);
    return i < 0 ? 0 : (i >= len ? len - 1 : i);
  }

  function nowMs() {
    if (has('live') && SYNTH.live.now) {
      try { return SYNTH.live.now(); } catch (e) { /* fall */ }
    }
    return Date.now();
  }

  function agoText(ms) {
    if (has('live') && SYNTH.live.ago) {
      try { return SYNTH.live.ago(ms); } catch (e) { /* fall */ }
    }
    return 'earlier';
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function clockText(ms) {
    if (has('live') && SYNTH.live.clock) {
      try { return SYNTH.live.clock(ms); } catch (e) { /* fall */ }
    }
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function strip(s) {
    if (has('markup') && SYNTH.markup.strip) {
      try { return SYNTH.markup.strip(s); } catch (e) { /* fall */ }
    }
    return String(s === null || s === undefined ? '' : s)
      .replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function badge(kind) {
    if (!kind || !has('liveui') || !SYNTH.liveui.badge) { return null; }
    try { return SYNTH.liveui.badge(kind); } catch (e) { return null; }
  }

  function counterNode(key, base, perDay) {
    var value = base;
    if (has('live') && SYNTH.live.counter) {
      try { value = SYNTH.live.counter(key, base, perDay); } catch (e) { value = base; }
    }
    var shown = String(value);
    if (has('live') && SYNTH.live.commas) {
      try { shown = SYNTH.live.commas(value); } catch (e) { /* fall */ }
    }
    return el('span', {
      'class': 'wr-num',
      'data-lv-counter': key + '|' + base + '|' + perDay + '|commas'
    }, text(shown));
  }

  function sampleOf(arr, n, seed) {
    if (!arr || !arr.length) { return []; }
    if (has('live') && SYNTH.live.sample) {
      try {
        var s = SYNTH.live.sample(arr, n, seed);
        if (s && s.length) { return s; }
      } catch (e) { /* fall */ }
    }
    var want = n < arr.length ? n : arr.length;
    var out = [];
    var used = {};
    var start = pickIdx('sample:' + seed, arr.length);
    var step = 0;
    while (out.length < want && step < arr.length * 4) {
      var idx = (start + step * 7) % arr.length;
      if (!used[idx]) { used[idx] = 1; out.push(arr[idx]); }
      step++;
    }
    return out;
  }

  function byId(arr, id) {
    var i;
    for (i = 0; i < (arr || []).length; i++) {
      if (arr[i] && String(arr[i].id) === String(id)) { return arr[i]; }
    }
    return null;
  }

  /* ---------- dispatch model ---------- */

  var AT_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

  /* Authored `at` is a wall-clock string; the live layer hands back real epoch
   * ms. Both become ms here so one sort can interleave them. Built by parts
   * rather than Date.parse, which reads a bare date-time as UTC under ES5 and
   * as local under ES2016 -- a difference of hours in where a row lands. */
  function parseAt(v) {
    if (typeof v === 'number' && isFinite(v)) { return v; }
    var m = AT_RE.exec(String(v === null || v === undefined ? '' : v));
    if (!m) { return null; }
    var t = new Date(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0
    ).getTime();
    return isFinite(t) ? t : null;
  }

  var CHIP = {
    bulletin: ['BULLETIN', 'Top priority. Everything else on the desk waits.'],
    urgent: ['URGENT', 'Moves ahead of the routine file.'],
    routine: ['ROUTINE', 'Files in order. Most of the day is this.']
  };

  function priorityOf(p) {
    var v = String(p === null || p === undefined ? '' : p).toLowerCase();
    return Object.prototype.hasOwnProperty.call(CHIP, v) ? v : 'routine';
  }

  function chip(p) {
    var row = CHIP[p] || CHIP.routine;
    return el('span', { 'class': 'wr-chip wr-chip-' + p, title: row[1] }, text(row[0]));
  }

  /* The rail shows the first sentence of the lead and no more. A wire lead is
   * written to survive being cut here, because it usually is. */
  function firstLine(s, max) {
    var t = strip(s);
    var re = /[.!?](\s+|$)/g;
    var m;
    while ((m = re.exec(t)) !== null) {
      /* "Substation No. 3" and "5:02 a.m." are not ends of sentences, and a
       * rail line that stops at "No." is worse than one that runs long. */
      var before = t.slice(0, m.index).match(/[A-Za-z0-9]+$/);
      if (before && before[0].length <= 3) { continue; }
      if (m.index < 28) { continue; }
      var next = t.charAt(m.index + m[0].length);
      if (next && next !== next.toUpperCase()) { continue; }
      t = t.slice(0, m.index + 1);
      break;
    }
    if (t.length > max) { t = t.slice(0, max - 1) + '…'; }
    return t;
  }

  var LD = ['1ST-LD', '2ND-LD-WRITETHRU', '3RD-LD', 'ADV', 'BRIEF', 'ADDS', 'SUB'];

  /* A slug names the story, so the words a headline opens with -- HERE is what
   * to know, WHAT you need to know -- are exactly the ones it must not use.
   * Without this the rail fills with HERE-ASHKETTLE-RESIDENTS and
   * WHAT-KNOW-ABOUT, which no desk would recognise. */
  var SLUG_STOP = {
    HERE: 1, WHAT: 1, THIS: 1, THAT: 1, THESE: 1, THOSE: 1, WITH: 1, FROM: 1,
    AFTER: 1, BEFORE: 1, ABOUT: 1, SAYS: 1, SAID: 1, WILL: 1, WOULD: 1,
    HAVE: 1, BEEN: 1, MORE: 1, THAN: 1, THEY: 1, WERE: 1, ALSO: 1, YOUR: 1,
    JUST: 1, INTO: 1, OVER: 1, KNOW: 1, NEED: 1, THERE: 1, WHICH: 1
  };

  /* Slugs are made from the story, not the headline, and they are always a
   * little too short to be clear. Every desk keeps a cheat sheet for this. */
  function slugFrom(headline, seed) {
    var words = strip(headline).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/);
    var keep = [];
    var i;
    for (i = 0; i < words.length && keep.length < 3; i++) {
      if (words[i].length <= 3) { continue; }
      if (Object.prototype.hasOwnProperty.call(SLUG_STOP, words[i])) { continue; }
      keep.push(words[i]);
    }
    if (!keep.length) { keep.push('VERITY'); }
    return keep.join('-') + '-' + LD[pickIdx('ld:' + seed, LD.length)];
  }

  /* Bulletins are rare on purpose: two slots in a hundred. Make them common
   * and the red chip stops meaning anything, which is how real wires end up
   * with four priority levels nobody uses. */
  function livePriority(seed) {
    var u = unit('pri:' + seed);
    if (u < 0.02) { return 'bulletin'; }
    if (u < 0.20) { return 'urgent'; }
    return 'routine';
  }

  function authoredRows(d, cats) {
    var list = d.dispatches || [];
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var x = list[i];
      if (!x || typeof x !== 'object') { continue; }
      var cat = byId(cats, x.catId);
      out.push({
        id: x.id === null || x.id === undefined ? null : String(x.id),
        live: false,
        kind: null,
        catId: x.catId,
        catName: cat ? cat.name : null,
        slug: String(x.slug || 'VERITY-FILE').toUpperCase(),
        priority: priorityOf(x.priority),
        at: parseAt(x.at),
        lead: x.lead || '',
        corrects: x.corrects || null,
        raw: x
      });
    }
    return out;
  }

  function liveRows(ctx, cats) {
    if (!has('live') || !SYNTH.live.stream) { return []; }
    var rows;
    try {
      /* Pool NAME, not array: that is what lets imported content packs reach
       * this file at all. */
      rows = SYNTH.live.stream('wire:' + ctx.site.domain, 'newsItems',
                               LIVE_INTERVAL_MIN, LIVE_COUNT);
      /* The story layer: takes stream() rows, returns stream() rows, and
       * returns them untouched when nothing is happening -- which is most
       * of the time. The wire is hop 0, so what it files is the record. */
      rows = SYNTH.live.withStory(rows, ctx.site);
    } catch (e) { return []; }

    var out = [];
    var i;
    for (i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      /* stream() returns wrappers -- {slot, at, item, seed}. The copy is
       * r.item. Reading r.body here prints [object Object] on screen. */
      var it = (r && r.item && typeof r.item === 'object') ? r.item : null;
      if (!it) { continue; }
      var seed = String(r.seed || r.slot || i);
      var cat = cats.length ? cats[pickIdx('cat:' + seed, cats.length)] : null;
      out.push({
        id: null,
        live: true,
        kind: it.kind || 'bot',
        catId: cat ? cat.id : null,
        catName: cat ? cat.name : (it.section || null),
        slug: slugFrom(it.headline || it.section || 'Verity file', seed),
        priority: livePriority(seed),
        at: r.at,
        /* The wire throws headlines away and files a slug, so the lead is
         * the only place a row can say what it is about. A dek is a fine
         * lead for a routine item -- but a story dek is bare facts, and
         * hop 0 of a propagating story was filing "2008. 14 March 2008.
         * an abandonment filing by Verity Rail." with nothing to say the
         * branch line was the subject. CI caught that; the body opens with
         * the subject, so story rows take the body. */
        lead: (r.story ? (it.body || it.dek) : (it.dek || it.body))
              || it.headline || '',
        corrects: null,
        raw: null
      });
    }
    return out;
  }

  function byTimeDesc(a, b) {
    var av = (a.at === null || a.at === undefined) ? -1 : a.at;
    var bv = (b.at === null || b.at === undefined) ? -1 : b.at;
    return bv - av;
  }

  function railRows(ctx, d, cats, catId) {
    var rows = authoredRows(d, cats).concat(liveRows(ctx, cats));
    if (catId) {
      var kept = [];
      var i;
      for (i = 0; i < rows.length; i++) {
        if (String(rows[i].catId) === String(catId)) { kept.push(rows[i]); }
      }
      rows = kept;
    }
    rows.sort(byTimeDesc);
    return rows;
  }

  /* ---------- chrome ---------- */

  function agencyName(ctx, d) {
    return d.agency || ctx.site.title || 'Verity News Service';
  }

  /* `fileRows` is the WHOLE file, not the list the page happens to be
   * showing. LAST FILED used to read rows[0] of whatever the caller passed,
   * so it meant "newest on the file" on /, "newest in this category" on
   * /cat/<id>, and "newest on the file" again on a dispatch page whose rail
   * was highlighted to that dispatch's category. Six of veritywire.press's
   * seven category pages printed a different time from the index under the
   * same words -- one of them three days off -- and the figure immediately
   * to its left, ON THE FILE, is keyed per domain and is site-wide on every
   * page regardless. One label, one meaning. */
  function header(ctx, d, rows, fileRows) {
    var head = el('header', { 'class': 'wr-head' });

    var top = el('div', { 'class': 'wr-head-top' });
    top.appendChild(ctx.link('/', agencyName(ctx, d), 'wr-brand'));
    if (d.bureau) {
      top.appendChild(el('span', { 'class': 'wr-bureau' }, text(d.bureau)));
    }
    head.appendChild(top);

    var stat = el('div', { 'class': 'wr-head-stat' });
    stat.appendChild(el('span', { 'class': 'wr-key' }, text('ON THE FILE')));
    stat.appendChild(counterNode('wire:' + ctx.site.domain + ':filed', 148200, 470));
    stat.appendChild(el('span', { 'class': 'wr-dim' }, text('dispatches this year')));

    var file = fileRows || rows;
    if (file.length && file[0].at !== null && file[0].at !== undefined) {
      stat.appendChild(el('span', { 'class': 'wr-sep', 'aria-hidden': 'true' }, text('·')));
      stat.appendChild(el('span', { 'class': 'wr-key' }, text('LAST FILED')));
      stat.appendChild(el('span', {
        'class': 'wr-ago',
        'data-lv-ago': String(file[0].at)
      }, text(agoText(file[0].at))));
    }
    head.appendChild(stat);
    return head;
  }

  function catRail(ctx, d, cats, activeId) {
    if (!cats.length) { return null; }
    var nav = el('nav', { 'class': 'wr-cats', 'aria-label': 'File categories' });
    nav.appendChild(el('span', { 'class': 'wr-key' }, text('FILE')));
    var i;
    for (i = 0; i < cats.length; i++) {
      var on = String(cats[i].id) === String(activeId);
      nav.appendChild(ctx.link('/cat/' + encodeURIComponent(String(cats[i].id)),
        String(cats[i].name || cats[i].id).toUpperCase(),
        'wr-cat' + (on ? ' is-on' : '')));
    }
    return nav;
  }

  function footer(ctx, d) {
    var foot = el('footer', { 'class': 'wr-foot' });
    foot.appendChild(el('p', { 'class': 'wr-foot-line' },
      text(agencyName(ctx, d) + ' copy is supplied to subscribing outlets under ' +
           'the syndication terms. Rewrite rights are not included, which has ' +
           'never once stopped anybody.')));

    if (has('liveui') && SYNTH.liveui.automatedShare) {
      var share = null;
      try { share = SYNTH.liveui.automatedShare(ctx.site.domain); } catch (e) { share = null; }
      if (share) {
        foot.appendChild(el('p', { 'class': 'wr-foot-line wr-dim' },
          text(share + '% of today’s file moved without a person reading it. ' +
               'Quality note 4, revised 2024, not revised since.')));
      }
    }
    return foot;
  }

  function shell(ctx, d, rows, main, activeCat, fileRows) {
    var root = el('div', { 'class': 'wr-page' });
    root.appendChild(header(ctx, d, rows, fileRows));
    var nav = catRail(ctx, d, (d.categories || []), activeCat);
    if (nav) { root.appendChild(nav); }
    root.appendChild(el('main', { 'class': 'wr-main' }, main));
    root.appendChild(footer(ctx, d));
    ctx.mount.appendChild(root);
  }

  /* ---------- the rail ---------- */

  function rowNode(ctx, r, pinned) {
    var cls = 'wr-row';
    if (r.live) { cls += ' wr-row-live'; }
    if (r.priority === 'bulletin') { cls += ' wr-row-bul'; }
    if (pinned) { cls += ' wr-row-pin'; }
    var li = el('li', {
      'class': cls,
      title: r.live ? 'Moving now. Not written up, not filed, not checked.' : null
    });

    li.appendChild(el('span', { 'class': 'wr-time' },
      text(r.at === null || r.at === undefined ? '--:--' : clockText(r.at))));
    li.appendChild(chip(r.priority));
    /* A pinned bulletin sits above dispatches filed after it, so the rail's
     * own "newest first" is briefly untrue at the top. Say why, or it reads
     * as a broken sort rather than a desk holding a story up. */
    if (pinned) {
      li.appendChild(el('span', {
        'class': 'wr-pin',
        title: 'Held at the top of the file while it is still moving.'
      }, text('HOLDING')));
    }

    if (r.id) {
      li.appendChild(ctx.link('/d/' + encodeURIComponent(r.id), r.slug, 'wr-slug'));
    } else {
      /* Live copy has no file page: it moved, it has not been written up, and
       * a link to a dispatch id that does not exist is worse than no link. */
      li.appendChild(el('span', { 'class': 'wr-slug wr-slug-flat' }, text(r.slug)));
    }

    if (r.corrects) {
      li.appendChild(el('span', { 'class': 'wr-corr', title: String(r.corrects) },
        text('CORR')));
    }

    li.appendChild(el('span', { 'class': 'wr-line' }, text(firstLine(r.lead, 140))));

    var b = badge(r.kind);
    if (b) { li.appendChild(b); }

    if (r.at !== null && r.at !== undefined) {
      li.appendChild(el('span', {
        'class': 'wr-ago',
        'data-lv-ago': String(r.at)
      }, text(agoText(r.at))));
    }
    return li;
  }

  /* A bulletin that is still moving holds the top of the rail and gets a line
   * of its own. Anything older than a shift does not, because a banner that is
   * always up is a masthead. */
  function movingBulletin(rows) {
    var n = nowMs();
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].priority !== 'bulletin') { continue; }
      if (rows[i].at === null || rows[i].at === undefined) { continue; }
      if (n - rows[i].at > MOVING_MS) { continue; }
      return rows[i];
    }
    return null;
  }

  function bulletinBanner(ctx, r) {
    var box = el('div', { 'class': 'wr-bulletin', role: 'alert' });
    box.appendChild(el('span', { 'class': 'wr-bulletin-tag' }, text('BULLETIN')));
    box.appendChild(el('span', { 'class': 'wr-bulletin-text' }, text(firstLine(r.lead, 110))));
    if (r.id) {
      box.appendChild(ctx.link('/d/' + encodeURIComponent(r.id), 'full file', 'wr-bulletin-link'));
    }
    box.appendChild(el('span', {
      'class': 'wr-ago',
      'data-lv-ago': String(r.at)
    }, text(agoText(r.at))));
    return box;
  }

  function railList(ctx, rows, pinned) {
    var ol = el('ol', { 'class': 'wr-rail' });
    var i;
    if (pinned) { ol.appendChild(rowNode(ctx, pinned, true)); }
    for (i = 0; i < rows.length; i++) {
      if (pinned && rows[i] === pinned) { continue; }
      ol.appendChild(rowNode(ctx, rows[i], false));
    }
    return ol;
  }

  function emptyRail() {
    return el('p', { 'class': 'wr-empty' },
      text('NOTHING ON THE RAIL. Either the feed is down at this end or nothing ' +
           'happened in the county for three quarters of an hour, and one of ' +
           'those is much more likely than the other.'));
  }

  function pageIndex(ctx, d) {
    ctx.title(agencyName(ctx, d));
    var cats = d.categories || [];
    var rows = railRows(ctx, d, cats, null);
    var main = document.createDocumentFragment();

    var bul = movingBulletin(rows);
    if (bul) { main.appendChild(bulletinBanner(ctx, bul)); }

    main.appendChild(el('div', { 'class': 'wr-railhead' },
      el('span', { 'class': 'wr-key' }, text('THE RAIL')),
      el('span', { 'class': 'wr-dim' },
        text(bul
          ? 'newest first, under the bulletin the desk is holding up · ' +
            'times local · nothing here has been subedited'
          : 'newest first · times local · nothing here has been ' +
            'subedited'))));

    if (!rows.length) {
      main.appendChild(emptyRail());
    } else {
      main.appendChild(railList(ctx, rows, bul));
    }

    /* No ad slot. The file is sold by subscription, and an agency that ran
     * display advertising down the middle of its own rail would be told so by
     * every subscriber it has, twice. */
    shell(ctx, d, rows, main, null);
  }

  function pageCat(ctx, d, catId) {
    var cats = d.categories || [];
    var cat = byId(cats, catId);
    if (!cat) { return pageNotFound(ctx, d); }
    ctx.title(String(cat.name) + ' — ' + agencyName(ctx, d));

    var rows = railRows(ctx, d, cats, cat.id);
    var main = document.createDocumentFragment();

    main.appendChild(el('h1', { 'class': 'wr-h1' }, text(String(cat.name).toUpperCase())));
    main.appendChild(el('p', { 'class': 'wr-catnote' },
      text('Everything moving under this category, newest first. Subscribers ' +
           'who take the whole file get this anyway; the split exists because ' +
           'two outlets asked for it in 2021 and one of them is gone.')));

    if (!rows.length) {
      main.appendChild(emptyRail());
    } else {
      main.appendChild(railList(ctx, rows, null));
    }

    main.appendChild(el('p', { 'class': 'wr-back' }, ctx.link('/', '◄ back to the whole file', 'wr-backlink')));
    shell(ctx, d, rows, main, cat.id, railRows(ctx, d, cats, null));
  }

  /* ---------- the keyword index ---------- */

  /* The keyword line at the foot of a file is not decoration. It is how the
   * file is retrieved: a desk that wants everything the agency has moved on
   * the substation punches the word and gets the lot back. The words were
   * drawn as chips -- bordered, boxed, sitting in a row under a heading
   * reading KEYWORDS -- and did nothing whatever when pressed, which made the
   * retrieval index the one part of this terminal that was a prop. It isn't
   * one now, and nothing had to be invented to fix it: the index was always
   * sitting in the file, spelled out on every dispatch. */

  function keywordRows(d, cats, word) {
    var all = authoredRows(d, cats);
    var want = String(word === null || word === undefined ? '' : word).toLowerCase();
    var out = [];
    var i, j, kw;
    for (i = 0; i < all.length; i++) {
      kw = (all[i].raw && all[i].raw.keywords) || [];
      for (j = 0; j < kw.length; j++) {
        if (String(kw[j]).toLowerCase() === want) { out.push(all[i]); break; }
      }
    }
    out.sort(byTimeDesc);
    return out;
  }

  /* Give the word back in the spelling the file keeps, not whatever spelling
   * arrived in the address bar. */
  function keywordLabel(d, word) {
    var all = d.dispatches || [];
    var want = String(word === null || word === undefined ? '' : word).toLowerCase();
    var i, j, kw;
    for (i = 0; i < all.length; i++) {
      kw = (all[i] && all[i].keywords) || [];
      for (j = 0; j < kw.length; j++) {
        if (String(kw[j]).toLowerCase() === want) { return String(kw[j]); }
      }
    }
    return String(word === null || word === undefined ? '' : word);
  }

  function pageKeyword(ctx, d, word) {
    var cats = d.categories || [];
    var rows = keywordRows(d, cats, word);
    if (!rows.length) { return pageNotFound(ctx, d); }

    var label = keywordLabel(d, word).toUpperCase();
    ctx.title('KEYWORD ' + label + ' — ' + agencyName(ctx, d));

    var main = document.createDocumentFragment();
    main.appendChild(el('h1', { 'class': 'wr-h1' }, text('KEYWORD: ' + label)));
    main.appendChild(el('p', { 'class': 'wr-catnote' },
      text(rows.length === 1
        ? 'One file on the agency keyword index carries this word.'
        : String(rows.length) + ' files on the agency keyword index carry ' +
          'this word, newest first. The index goes back as far as the file ' +
          'does and no further.')));
    main.appendChild(railList(ctx, rows, null));
    main.appendChild(el('p', { 'class': 'wr-back' },
      ctx.link('/', '◄ back to the whole file', 'wr-backlink')));

    shell(ctx, d, railRows(ctx, d, cats, null), main, null);
  }

  /* ---------- one dispatch ---------- */

  /* The other half of the ### end mark. A take that ends MORE is telling the
   * receiving desk the story is not whole yet and to keep the slug open for
   * the next one. It was being flushed into the copy like any other
   * paragraph, which left the word MORE sitting alone under a 2:58 a.m.
   * bulletin in body type, looking exactly like something you press and doing
   * nothing at all when you did. It is not a Read More button and never was.
   * But the take it promises is in the file -- GRIDFALL-OUTAGE-BULLETIN is
   * followed at 3:12 by GRIDFALL-OUTAGE-1ST-LD -- so the mark goes there. */
  var MORE_RE = /^\(?\s*MORE(?:\s+(?:TO\s+COME|FOLLOWS))?\s*\)?$/i;

  function slugWords(slug) {
    var parts = String(slug === null || slug === undefined ? '' : slug)
      .toUpperCase().split(/[^A-Z0-9]+/);
    var out = [], i;
    for (i = 0; i < parts.length; i++) { if (parts[i]) { out.push(parts[i]); } }
    return out;
  }

  /* Two takes are the same story when the slug opens on the same two words --
   * a desk refiles GRIDFALL-OUTAGE-BULLETIN as GRIDFALL-OUTAGE-1ST-LD -- or,
   * where the desk renamed it, when the keyword line still agrees twice over.
   * ROUTE-62-TANKER-BULLETIN became ROUTE-62-REOPEN-BRIEF overnight and only
   * the keywords carry that across. */
  function sameStory(a, b) {
    var wa = slugWords(a.slug), wb = slugWords(b.slug);
    if (wa.length && wb.length && wa[0] === wb[0] &&
        (wa.length < 2 || wb.length < 2 || wa[1] === wb[1])) { return true; }
    var seen = {}, ka = a.keywords || [], kb = b.keywords || [], n = 0, i;
    for (i = 0; i < ka.length; i++) { seen[String(ka[i]).toLowerCase()] = 1; }
    for (i = 0; i < kb.length; i++) {
      if (seen[String(kb[i]).toLowerCase()]) { n++; }
    }
    return n >= 2;
  }

  function nextTake(d, x) {
    var all = (d && d.dispatches) || [];
    var mine = parseAt(x.at);
    var best = null, bestAt = null;
    var i, c, at;
    for (i = 0; i < all.length; i++) {
      c = all[i];
      if (!c || String(c.id) === String(x.id)) { continue; }
      if (String(c.catId) !== String(x.catId)) { continue; }
      at = parseAt(c.at);
      if (at === null || mine === null || at <= mine) { continue; }
      if (!sameStory(x, c)) { continue; }
      if (bestAt === null || at < bestAt) { best = c; bestAt = at; }
    }
    return best ? { take: best, at: bestAt } : null;
  }

  function moreInto(ctx, host, d, x) {
    var found = x ? nextTake(d, x) : null;
    if (!found) {
      /* No later take moved. Then the mark is the whole truth about the file:
       * the desk meant to send more and never did. */
      host.appendChild(el('p', { 'class': 'wr-more-note' },
        text('MORE — the take ended there. Nothing further has moved on this slug.')));
      return;
    }
    var slug = String(found.take.slug || 'the next take').toUpperCase();
    host.appendChild(el('div', { 'class': 'wr-more' },
      ctx.link('/d/' + encodeURIComponent(String(found.take.id)), 'MORE',
               'wr-more-mark'),
      el('span', { 'class': 'wr-dim' },
        text('Not the whole story. The next take moved at ' +
             clockText(found.at) + ' as ' + slug + '.'))));
  }

  /* Body sections are separated by ___ on a line of its own, which is how a
   * wire marks a break the receiving desk is allowed to cut at. */
  function bodyInto(ctx, host, body, d, x) {
    var lines = String(body === null || body === undefined ? '' : body).split('\n');
    var chunk = [];
    var i;

    function flush() {
      var t = chunk.join('\n');
      chunk = [];
      var bare = strip(t);
      if (!bare) { return false; }
      if (MORE_RE.test(bare)) { moreInto(ctx, host, d, x); return true; }
      host.appendChild(el('div', { 'class': 'wr-copy' }, ctx.markup(t)));
      return true;
    }

    for (i = 0; i < lines.length; i++) {
      if (/^\s*_{3,}\s*$/.test(lines[i])) {
        if (flush()) { host.appendChild(el('hr', { 'class': 'wr-sep-rule' })); }
        continue;
      }
      chunk.push(lines[i]);
    }
    flush();
  }

  /* The em dash after the dateline belongs to the wire, not to the writer, so
   * it is added here and the content never carries it. The lead's first
   * paragraph is unwrapped into the same line so the dateline runs into the
   * copy the way it does on paper. */
  function leadInto(ctx, host, dateline, lead) {
    var p = el('p', { 'class': 'wr-lead' });
    if (dateline) {
      p.appendChild(el('span', { 'class': 'wr-dateline' },
        text(String(dateline) + ' — ')));
    }
    var frag = ctx.markup(lead || '');
    var first = frag.firstChild;
    var rest = true;
    if (first && first.nodeType === 1 && String(first.tagName).toLowerCase() === 'p') {
      while (first.firstChild) { p.appendChild(first.firstChild); }
      frag.removeChild(first);
    } else {
      p.appendChild(frag);
      rest = false;
    }
    host.appendChild(p);
    if (rest) { host.appendChild(frag); }
  }

  var HOW = [
    'ran it verbatim under a staff byline',
    'cut it to four grafs and dropped the attribution',
    'rewrote the lead and kept the error',
    'ran it with the 2004 date the content farms use',
    'ran it twice, eleven minutes apart',
    'credited it to a different agency'
  ];

  /* An archive domain cannot pick anything up, but it can still be on the
   * subscriber list, because nobody has audited that list either. */
  var HOW_DEAD = [
    'still on the subscriber list; nothing has published there in years',
    'listed as taking the file, which it has not done since the archive froze'
  ];

  function newsSites() {
    var rows = [];
    try {
      if (has('data') && typeof SYNTH.data.list === 'function') {
        rows = SYNTH.data.list() || [];
      }
    } catch (e) { return []; }
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].domain && String(rows[i].type) === 'news') {
        out.push(rows[i]);
      }
    }
    return out;
  }

  /* Who ran it. This is the only part of a wire that is visible from outside
   * it, and it costs one hash: the same dispatch always shows the same pickups
   * to the same reader, and the sites named are real ones in this net. */
  function carriedBy(ctx, id) {
    var sites = newsSites();
    if (sites.length < 2) { return null; }

    /* Prefer outlets that still publish. Two of them is enough to make the
     * point; below that, fall back to whatever news sites exist so the block
     * does not vanish from a small net. */
    var modern = [];
    var rest = [];
    var i;
    for (i = 0; i < sites.length; i++) {
      if (String(sites[i].era || '').indexOf('2026') !== -1) { modern.push(sites[i]); }
      else { rest.push(sites[i]); }
    }
    var pool = modern.length >= 2 ? modern : modern.concat(rest);

    var want = 2 + pickIdx('carry:' + id, 2);     /* two or three */
    var picks = sampleOf(pool, want, 'carry:' + id);
    if (picks.length < 2) { return null; }

    /* Two Ledger domains carry the same masthead, so name the domain when the
     * title alone would print the same outlet twice. */
    var seen = {};
    for (i = 0; i < picks.length; i++) {
      /* '#' keeps a masthead called "constructor" out of Object.prototype. */
      var t = '#' + String(picks[i].title || picks[i].domain);
      seen[t] = (seen[t] || 0) + 1;
    }

    var box = el('section', { 'class': 'wr-carry' });
    box.appendChild(el('h2', { 'class': 'wr-h2' }, text('CARRIED BY')));
    var ul = el('ul', { 'class': 'wr-carry-list' });
    for (i = 0; i < picks.length; i++) {
      var row = picks[i];
      var title = String(row.title || row.domain);
      var label = seen['#' + title] > 1 ? (title + ' (' + row.domain + ')') : title;
      var pseed = 'pick:' + id + ':' + row.domain;
      var live2026 = String(row.era || '').indexOf('2026') !== -1;
      var tail = live2026
        ? (' · picked it up ' + (3 + pickIdx('min:' + pseed, 55)) +
           ' min after filing, ' + HOW[pickIdx('how:' + pseed, HOW.length)])
        : (' · ' + HOW_DEAD[pickIdx('dead:' + pseed, HOW_DEAD.length)]);
      var li = el('li', { 'class': 'wr-carry-row' });
      li.appendChild(ctx.link('synth://' + row.domain + '/', label, 'wr-carry-link'));
      li.appendChild(el('span', { 'class': 'wr-dim' }, text(tail)));
      ul.appendChild(li);
    }
    box.appendChild(ul);
    /* The list is two or three long (`want` above), and this sentence used
       to say "Two of them" whatever it drew -- so a three-outlet list came
       with a flat statement that two of them had gone quiet, and a reader
       who counted found three. Derive it, and never claim more have stopped
       reporting than are on the list. */
    var quiet = picks.length >= 3 ? 'Two' : 'One';
    var verb = picks.length >= 3 ? 'have' : 'has';
    box.appendChild(el('p', { 'class': 'wr-carry-note' },
      text('Pickup is reported by the subscriber, on the honour system, ' +
           'monthly. ' + quiet + ' of them ' + verb +
           ' not reported since March.')));
    return box;
  }

  function alsoInCat(ctx, d, cats, dispatch) {
    var rows = railRows(ctx, d, cats, dispatch.catId);
    var out = [];
    var i;
    for (i = 0; i < rows.length && out.length < 3; i++) {
      if (!rows[i].id || rows[i].id === String(dispatch.id)) { continue; }
      out.push(rows[i]);
    }
    if (!out.length) { return null; }

    var box = el('section', { 'class': 'wr-also' });
    box.appendChild(el('h2', { 'class': 'wr-h2' }, text('EARLIER ON THIS FILE')));
    var ol = el('ol', { 'class': 'wr-rail wr-rail-tight' });
    for (i = 0; i < out.length; i++) { ol.appendChild(rowNode(ctx, out[i])); }
    box.appendChild(ol);
    return box;
  }

  function pageDispatch(ctx, d, id) {
    var cats = d.categories || [];
    var x = byId(d.dispatches || [], id);
    if (!x) { return pageNotFound(ctx, d); }

    var slug = String(x.slug || 'VERITY-FILE').toUpperCase();
    var priority = priorityOf(x.priority);
    var at = parseAt(x.at);
    var cat = byId(cats, x.catId);
    ctx.title(slug + ' — ' + agencyName(ctx, d));

    var main = document.createDocumentFragment();
    var art = el('article', { 'class': 'wr-dispatch' });

    /* slug line */
    var slugline = el('div', { 'class': 'wr-slugline' });
    slugline.appendChild(el('h1', { 'class': 'wr-h1 wr-h1-slug' }, text(slug)));
    slugline.appendChild(chip(priority));
    if (x.moved) {
      slugline.appendChild(el('span', { 'class': 'wr-moved', title: 'Refiled. The earlier version is dead copy.' },
        text('MOVED ' + String(x.moved))));
    }
    art.appendChild(slugline);

    var meta = el('div', { 'class': 'wr-meta' });
    if (cat) {
      meta.appendChild(ctx.link('/cat/' + encodeURIComponent(String(cat.id)),
        String(cat.name).toUpperCase(), 'wr-cat wr-cat-sm'));
    }
    if (at !== null) {
      meta.appendChild(el('span', { 'class': 'wr-time' }, text(clockText(at))));
      meta.appendChild(el('span', { 'class': 'wr-ago', 'data-lv-ago': String(at) },
        text(agoText(at))));
    }
    meta.appendChild(el('span', { 'class': 'wr-dim' }, text('file ' + String(x.id))));
    art.appendChild(meta);

    /* A correction runs above the copy it corrects, always, because the desks
     * that matter read the top three lines and nothing else. */
    if (x.corrects) {
      art.appendChild(el('div', { 'class': 'wr-corrects' },
        el('span', { 'class': 'wr-corrects-tag' }, text('CORRECTION')),
        el('span', null, text(String(x.corrects)))));
    }

    leadInto(ctx, art, x.dateline, x.lead);

    if (x.byline) {
      art.appendChild(el('p', { 'class': 'wr-byline' },
        text('By '),
        el('span', { 'class': 'wr-byline-name' }, text(String(x.byline))),
        text(', ' + agencyName(ctx, d))));
    }

    bodyInto(ctx, art, x.body, d, x);

    var kw = x.keywords || [];
    if (kw.length) {
      var tags = el('div', { 'class': 'wr-keywords' });
      tags.appendChild(el('span', { 'class': 'wr-key' }, text('KEYWORDS')));
      var i;
      for (i = 0; i < kw.length; i++) {
        tags.appendChild(ctx.link(
          '/kw/' + encodeURIComponent(String(kw[i]).toLowerCase()),
          String(kw[i]), 'wr-kw wr-kw-link'));
      }
      art.appendChild(tags);
    }

    /* The end mark. It is there so the receiving desk knows the file is whole
     * and not cut off mid-transmission, which used to happen constantly. */
    art.appendChild(el('div', { 'class': 'wr-end' },
      el('span', { 'class': 'wr-end-mark' }, text('###')),
      el('span', { 'class': 'wr-dim' },
        text('END ' + slug + ' · ' + agencyName(ctx, d) +
             (d.bureau ? ' · ' + d.bureau : '')))));

    main.appendChild(art);

    var carried = carriedBy(ctx, String(x.id));
    if (carried) { main.appendChild(carried); }

    var also = alsoInCat(ctx, d, cats, x);
    if (also) { main.appendChild(also); }

    main.appendChild(el('p', { 'class': 'wr-back' },
      ctx.link('/', '◄ back to the rail', 'wr-backlink')));

    shell(ctx, d, railRows(ctx, d, cats, null), main, x.catId);
  }

  function pageNotFound(ctx, d) {
    ctx.title('NO SUCH FILE — ' + agencyName(ctx, d));
    var main = document.createDocumentFragment();
    main.appendChild(el('div', { 'class': 'wr-404' },
      el('h1', { 'class': 'wr-h1' }, text('NO SUCH FILE')),
      el('p', null, text('That id is not on the file. Either the desk killed it ' +
        'before it moved, or it was refiled under a different slug and the old ' +
        'one was not kept. Nobody here can tell you which, because the log that ' +
        'would say was on the machine that was retired.')),
      ctx.link('/', '◄ back to the rail', 'wr-backlink')));
    shell(ctx, d, [], main, null);
  }

  /* ---------- register ---------- */

  SYNTH.render.register('wire', function (ctx) {
    el = ctx.el;
    var d = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    if (!p.length) { return pageIndex(ctx, d); }
    if (p[0] === 'd' && p[1]) { return pageDispatch(ctx, d, p[1]); }
    if (p[0] === 'cat' && p[1]) { return pageCat(ctx, d, p[1]); }
    /* Engine path segments arrive already decoded, so a keyword with a space
     * in it ("route 62") reaches this as one segment and is not re-decoded. */
    if (p[0] === 'kw' && p[1]) { return pageKeyword(ctx, d, p.slice(1).join('/')); }
    return pageNotFound(ctx, d);
  });
}());
