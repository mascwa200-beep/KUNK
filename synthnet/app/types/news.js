/* SYNTHNET - news renderer.
   Paths:  /                   front page
           /section/<id>       section index
           /article/<id>       one story
           /live/<id>          a liveblog   (/live alone lists them)
           /factcheck/<id>     one fact check (/factcheck alone lists them)
           /corrections        the corrections page
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

  function yearOf(text) {
    var m = String(text == null ? '' : text).match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : 0;
  }

  /* For site.era, which is the skin vintage rather than a date and can be a
     range. yearOf() takes the first year, which is right for an article
     date; an era wants the last one, because "2009-2016" is when it stopped. */
  function lastYear(text) {
    var s = String(text == null ? '' : text), re = /(19|20)\d{2}/g, m, last = 0;
    while ((m = re.exec(s)) !== null) { last = parseInt(m[0], 10); }
    return last;
  }

  /* ------------------------------------------------------------------ */
  /* the clock                                                           */
  /* ------------------------------------------------------------------ */

  function L() { return window.SYNTH.live || null; }

  function nowMs() {
    var l = L();
    if (l && l.now) { try { return l.now(); } catch (e) { /* fall */ } }
    return Date.now();
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june',
                    'july', 'august', 'september', 'october', 'november',
                    'december'];

  /* Dates reach this renderer in two spellings. The live shapes use an ISO
   * stamp ("2026-09-18T14:02"); an article carries the date it printed
   * ("September 18, 2026"). Both are wall clock, and both are built from
   * parts rather than handed to Date.parse, which reads a bare date-time as
   * UTC under ES5 and as local under ES2016 -- a difference of hours in
   * where an update lands and whether it has landed at all. */
  var ISO_AT = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
  var WORD_AT = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/;

  function monthIndex(word) {
    var w = String(word == null ? '' : word).toLowerCase();
    for (var i = 0; i < MONTH_FULL.length; i++) {
      if (MONTH_FULL[i] === w || MONTH_FULL[i].slice(0, 3) === w) { return i; }
    }
    return -1;
  }

  function ymd(y, mo, d, h, mi, s) {
    var t = new Date(y, mo, d, h || 0, mi || 0, s || 0).getTime();
    return isFinite(t) ? t : null;
  }

  function parseAt(v) {
    if (typeof v === 'number') { return isFinite(v) ? v : null; }
    var s = String(v == null ? '' : v);
    var m = ISO_AT.exec(s);
    if (m) {
      return ymd(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
                 m[4] ? parseInt(m[4], 10) : 0,
                 m[5] ? parseInt(m[5], 10) : 0,
                 m[6] ? parseInt(m[6], 10) : 0);
    }
    m = WORD_AT.exec(s);
    if (m) {
      var mo = monthIndex(m[1]);
      if (mo < 0) { return null; }
      return ymd(parseInt(m[3], 10), mo, parseInt(m[2], 10),
                 m[4] ? parseInt(m[4], 10) : 0,
                 m[5] ? parseInt(m[5], 10) : 0, 0);
    }
    return null;
  }

  /* Whether the author actually wrote a time of day. A printed date parses
   * to midnight, and "Published 00:00" is a lie the page would tell on every
   * article in the archive. */
  function hasClock(v) {
    if (typeof v === 'number') { return true; }
    var s = String(v == null ? '' : v);
    var m = ISO_AT.exec(s);
    if (m) { return !!m[4]; }
    m = WORD_AT.exec(s);
    return !!(m && m[4]);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function clockText(ms) {
    var l = L();
    if (l && l.clock) { try { return l.clock(ms); } catch (e) { /* fall */ } }
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function dayText(ms) {
    var d = new Date(ms);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function monthText(ms) {
    var d = new Date(ms);
    return MONTH_FULL[d.getMonth()].charAt(0).toUpperCase() +
           MONTH_FULL[d.getMonth()].slice(1) + ' ' + d.getFullYear();
  }

  function sameDay(a, b) {
    if (a === null || b === null) { return false; }
    var x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() &&
           x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  function agoText(ms) {
    var l = L();
    if (l && l.ago) { try { return l.ago(ms); } catch (e) { /* fall */ } }
    return 'recently';
  }

  function counterOf(key, base, perDay) {
    var l = L();
    if (l && l.counter) {
      try { return l.counter(key, base, perDay); } catch (e) { /* fall */ }
    }
    return base;
  }

  function stripText(s) {
    var M = window.SYNTH.markup;
    if (M && M.strip) { try { return M.strip(s); } catch (e) { /* fall */ } }
    return String(s == null ? '' : s)
      .replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }

  function clip(s, n) {
    var t = trim(s);
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  /* ------------------------------------------------------------------ */
  /* markup safety for copy nobody validated                             */
  /* ------------------------------------------------------------------ */

  var PAIRED = ['b', 'i', 'u', 's', 'quote', 'code', 'list'];

  /* Streamed copy is composed at run time, so validate.py never sees it, and
   * an unclosed [b] does not throw -- markup.js renders it literally, which
   * puts "[b]" on the screen. Counting the pairs is cheap and the fallback is
   * plain text, which is never wrong. Authored bodies go straight through:
   * the validator already warns on those, and silently stripping an author's
   * links would hide the mistake instead of showing it. */
  function balancedMarkup(s) {
    var t = String(s == null ? '' : s), i, name, open, close;
    for (i = 0; i < PAIRED.length; i++) {
      name = PAIRED[i];
      open = t.split(new RegExp('\\[' + name + '(?:=[^\\]]*)?\\]')).length - 1;
      close = t.split('[/' + name + ']').length - 1;
      if (open !== close) { return false; }
    }
    open = t.split(/\[url=[^\]]*\]/).length - 1;
    close = t.split('[/url]').length - 1;
    return open === close;
  }

  var VERDICT = {
    'true': ['True', 'Checks out as stated.'],
    'mostly-true': ['Mostly true', 'Right in substance, wrong in a detail.'],
    'misleading': ['Misleading', 'Every fact in it is accurate and the impression it leaves is not.'],
    'missing-context': ['Missing context', 'True as far as it goes, which is not far.'],
    'false': ['False', 'Not supported by anything we could find.'],
    'unproven': ['Unproven', 'Nobody has shown this either way, including us.']
  };

  var CORR_KIND = {
    'correction': 'Correction',
    'clarification': 'Clarification',
    'editors-note': "Editor's note",
    'retraction': 'Retraction'
  };

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  SYNTH.render.register('news', function (ctx) {
    var el = ctx.el, link = ctx.link, markup = ctx.markup;
    var site = ctx.site || {};
    var data = site.data || {};
    var sections = Array.isArray(data.sections) ? data.sections : [];
    var articles = Array.isArray(data.articles) ? data.articles : [];
    var liveBlogs = Array.isArray(data.live) ? data.live : [];
    var factchecks = Array.isArray(data.factchecks) ? data.factchecks : [];
    var corrections = Array.isArray(data.corrections) ? data.corrections : [];
    var path = ctx.path || [];
    var domain = String(site.domain || site.title || 'news');

    /* Two pieces of furniture below are conventions of the mid-2010s and
     * later -- the read-time estimate and the "this is old" banner. Putting
     * them on a paper that shut its web edition in 2008 would date the page
     * wrong, and dating the page right is most of this renderer's job. */
    var modern = String(site.era || '').indexOf('2026') !== -1;

    function sectionById(id) {
      for (var i = 0; i < sections.length; i++) {
        if (String(sections[i].id) === String(id)) { return sections[i]; }
      }
      return null;
    }

    function sectionName(id) {
      var s = sectionById(id);
      if (s) { return String(s.name || s.id); }
      return String(id || 'News');
    }

    function inSection(id) {
      var out = [];
      for (var i = 0; i < articles.length; i++) {
        if (String(articles[i].sectionId) === String(id)) { out.push(articles[i]); }
      }
      return out;
    }

    function byId(id) {
      for (var i = 0; i < articles.length; i++) {
        if (String(articles[i].id) === String(id)) { return articles[i]; }
      }
      return null;
    }

    function findIn(arr, id) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] && String(arr[i].id) === String(id)) { return arr[i]; }
      }
      return null;
    }

    function href(a) { return '/article/' + encodeURIComponent(String(a.id)); }

    /* ---------- small live-aware pieces ---------- */

    /* app/tick.js repaints anything carrying data-lv-ago every ten seconds,
     * so a timestamp drawn once keeps counting up while the page is read. */
    function agoNode(ms, cls) {
      if (ms === null || ms === undefined || !isFinite(ms)) { return null; }
      return el('span', { 'class': cls || 'news-ago', 'data-lv-ago': String(ms) },
        agoText(ms));
    }

    function badge(kind) {
      if (!kind || !window.SYNTH.liveui || !window.SYNTH.liveui.badge) { return null; }
      try { return window.SYNTH.liveui.badge(kind); } catch (e) { return null; }
    }

    function ad(slot, seed) {
      if (!window.SYNTH.liveui || !window.SYNTH.liveui.ad) { return null; }
      try { return window.SYNTH.liveui.ad(slot, seed); } catch (e) { return null; }
    }

    function body(textIn, cls) {
      var s = String(textIn == null ? '' : textIn);
      if (!s) { return null; }
      return el('div', { 'class': cls || 'news-text' }, markup(s));
    }

    /* ---------- article furniture ---------- */

    function readMinutes(a) {
      var n = parseInt(a.readMinutes, 10);
      if (isFinite(n) && n > 0) { return n; }
      var words = stripText(String(a.lead || '') + ' ' + String(a.body || ''));
      if (!words) { return 0; }
      return Math.max(1, Math.round(words.split(/\s+/).length / 220));
    }

    function kickerOf(a) {
      if (a.kicker) { return String(a.kicker); }
      var name = sectionName(a.sectionId);
      /* A kicker reading FRONT PAGE above a front-page story tells the reader
       * nothing they cannot already see. */
      if (!name || /front\s*page/i.test(name)) { return ''; }
      return name.toUpperCase();
    }

    /* The kicker is the line above the headline naming the desk a story came
     * off, and every paper here files every story under a section it also
     * publishes an index for. So the kicker goes there. It used to be a span,
     * which meant that on halsey-ledger.com the word ABOUT sat above a
     * headline in kicker type for a year and did nothing at all when pressed
     * -- the one control on this renderer that looked live and was not.
     * Where the kicker is a running topic rather than the section's own name
     * ("ROUTE 62" over a story filed under Roads) the link still lands on the
     * index that actually holds the story, which is the honest destination.
     *
     * A kicker has a destination only when that destination is somewhere
     * else. On the index that already holds the story it has none, and
     * linking it to the page under the reader's feet is not a working
     * control: pressing ROADS on the Local index moves no route and repaints
     * no byte, which is the dead span again in a link's clothes. There it is
     * drawn as what it reads as -- a label.
     *
     * A label with nothing beside it is the eyebrow line rather than a span
     * inside it. That is not a detail: a span reading ABOUT is shaped exactly
     * like a nav item, and a line of type reading ABOUT is prose. Legal &
     * Notices on halseycountynow.com carries a story kickered ABOUT, and
     * prose is the only honest thing left to call it once it is established
     * that it has nowhere to go. */
    function eyebrow(a, curSec) {
      var k = kickerOf(a);
      var sec = sectionById(a.sectionId);
      var here = curSec !== null && curSec !== undefined &&
                 String(a.sectionId) === String(curSec);
      /* The section index says overhead which section this is, so a kicker
       * that only repeats it is dropped -- the same rule this renderer has
       * always applied to FRONT PAGE on the front page. A kicker carrying a
       * running topic (ROUTE 62) or a disclosure (PARTNER CONTENT) is not a
       * repetition and stays. */
      if (k && here && k === sectionName(a.sectionId).toUpperCase()) { k = ''; }
      if (!k && !a.wire) { return null; }
      var chip = a.wire ? el('span', {
        'class': 'news-wirechip',
        title: 'Agency copy. This outlet did not write it and did not check it.'
      }, 'WIRE') : null;
      if (k && (here || !sec)) {
        if (!chip) { return el('p', { 'class': 'news-eyebrow news-kicker' }, k); }
        return el('p', { 'class': 'news-eyebrow' },
          el('span', { 'class': 'news-kicker' }, k), chip);
      }
      return el('p', { 'class': 'news-eyebrow' },
        k ? link('/section/' + encodeURIComponent(String(sec.id)), k,
                 'news-kicker news-kicker-link') : null,
        chip);
    }

    function byline(a) {
      var parts = [];
      if (a.byline) {
        /* Half the copy on this network puts the name in the field and half
         * puts "By Ruth Ahlgren, Staff Writer", so prefixing unconditionally
         * printed BY BY across the archive's front page. */
        var who = trim(a.byline);
        parts.push(/^by\s+/i.test(who) ? who : 'By ' + who);
      }
      if (a.date) { parts.push(String(a.date)); }
      var sec = sectionName(a.sectionId);
      if (sec) { parts.push(sec); }
      if (modern) {
        var mins = readMinutes(a);
        if (mins) { parts.push(mins + ' min read'); }
      }
      return el('p', { 'class': 'news-byline' }, parts.join('  ·  '));
    }

    /* The banner every outlet added once it worked out that most arrivals
     * come from search and have no idea how old the thing in front of them
     * is. Only meaningful on a site that is still publishing. */
    function ageBanner(a) {
      if (!modern) { return null; }
      var yr = yearOf(a.date);
      if (!yr || yr >= 2024) { return null; }
      var age = new Date(nowMs()).getFullYear() - yr;
      if (age < 1) { return null; }
      return el('p', { 'class': 'news-age' },
        'This article is more than ' + age + (age === 1 ? ' year old' : ' years old'));
    }

    /* ---------- the developing story ---------- */

    /* An update whose `at` has not arrived is not shown, so a story left open
     * in a tab is genuinely longer when it is come back to. That is the whole
     * mechanic; everything else here is labelling. */
    function updatesOf(a) {
      var src = Array.isArray(a.updates) ? a.updates : [];
      var landed = [], pending = 0, t = nowMs(), i;
      for (i = 0; i < src.length; i++) {
        var u = src[i] || {};
        var ms = parseAt(u.at);
        if (ms !== null && ms > t) { pending++; continue; }
        landed.push({ ms: ms, raw: u.at, text: String(u.text || '') });
      }
      landed.sort(function (x, y) { return (y.ms || 0) - (x.ms || 0); });
      return { landed: landed, pending: pending };
    }

    function stampOf(v, againstMs) {
      var ms = parseAt(v);
      if (ms === null) { return trim(v); }
      if (!hasClock(v)) { return dayText(ms); }
      if (againstMs !== undefined && againstMs !== null && !sameDay(ms, againstMs)) {
        return dayText(ms) + ' ' + clockText(ms);
      }
      return clockText(ms);
    }

    function stamps(a, landed) {
      if (!landed.length) { return null; }
      var pubMs = parseAt(a.date);
      var last = landed[0];
      return el('div', { 'class': 'news-stamps' },
        el('p', { 'class': 'news-stamp' },
          el('span', { 'class': 'news-stamp-label' }, 'Published'),
          ' ', stampOf(a.date) || 'date not recorded'),
        el('p', { 'class': 'news-stamp news-stamp-updated' },
          el('span', { 'class': 'news-stamp-label' }, 'Updated'),
          ' ', stampOf(last.raw, pubMs),
          last.ms !== null ? ' · ' : null,
          agoNode(last.ms, 'news-stamp-ago')));
    }

    function updateStack(landed) {
      if (!landed.length) { return null; }
      var box = el('div', { 'class': 'news-updates' });
      for (var i = 0; i < landed.length; i++) {
        var u = landed[i];
        box.appendChild(el('div', { 'class': 'news-update' },
          el('p', { 'class': 'news-update-head' },
            el('span', { 'class': 'news-update-word' }, 'Update:'),
            ' ',
            el('span', { 'class': 'news-update-time' }, stampOf(u.raw) || 'time not recorded'),
            u.ms !== null ? ' · ' : null,
            agoNode(u.ms, 'news-update-ago')),
          body(u.text, 'news-update-body')));
      }
      return box;
    }

    /* ---------- liveblogs ---------- */

    function blogEntries(blog) {
      var src = Array.isArray(blog.entries) ? blog.entries : [];
      var out = [], i;
      for (i = 0; i < src.length; i++) {
        var e = src[i] || {};
        out.push({
          ms: parseAt(e.at),
          raw: e.at,
          label: trim(e.label),
          headline: trim(e.headline),
          text: String(e.body || ''),
          by: trim(e.by),
          kind: '',
          live: false
        });
      }
      return out;
    }

    /* While the blog is open the desk keeps filing, and on this network most
     * of what the desk files is not written by anyone. Pool NAME, not array,
     * so imported content packs reach this. Rows are {slot, at, item, seed} --
     * the copy is on row.item. */
    function blogArrivals(blog) {
      if (!blog.open) { return []; }
      var every = parseInt(blog.intervalMin, 10);
      if (!isFinite(every) || every <= 0) { return []; }
      var l = L();
      if (!l || !l.stream) { return []; }
      var rows = [];
      try {
        rows = l.stream('live:' + domain + ':' + blog.id, 'newsItems', every, 8) || [];
      } catch (e) { return []; }

      var out = [], i;
      for (i = 0; i < rows.length; i++) {
        var it = rows[i].item;
        if (!it) { continue; }
        var text = String(it.body || it.dek || '');
        var paras = text.split(/\n\s*\n/);
        if (paras.length > 2) { text = paras[0] + '\n\n' + paras[1]; }
        if (!balancedMarkup(text)) { text = stripText(text); }
        out.push({
          ms: rows[i].at,
          raw: null,
          label: trim(it.section),
          headline: trim(it.headline) || 'Filed without a headline',
          text: text,
          by: trim(it.byline) || 'Ledger Newsdesk',
          kind: it.kind === 'human' ? '' : (it.kind || 'bot'),
          live: true
        });
      }
      return out;
    }

    function blogRows(blog) {
      var rows = blogEntries(blog).concat(blogArrivals(blog));
      rows.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });
      return rows;
    }

    function lastTouch(rows, blog) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].ms !== null) { return rows[i].ms; }
      }
      return parseAt(blog.startedAt);
    }

    function liveStrip() {
      if (!liveBlogs.length) { return null; }
      var box = el('div', { 'class': 'news-livestrip' }), i;
      for (i = 0; i < liveBlogs.length; i++) {
        var b = liveBlogs[i] || {};
        var open = !!b.open;
        var rows = blogRows(b);
        var last = lastTouch(rows, b);
        box.appendChild(el('div', { 'class': 'news-livechip-row' + (open ? ' is-open' : '') },
          el('span', { 'class': 'news-livechip' + (open ? '' : ' is-closed') },
            open ? el('span', { 'class': 'news-live-dot', 'aria-hidden': 'true' }) : null,
            open ? 'LIVE' : 'ENDED'),
          link('/live/' + encodeURIComponent(String(b.id)),
            String(b.headline || 'Live coverage'), 'news-livechip-link'),
          el('span', { 'class': 'news-livechip-meta' },
            rows.length + (rows.length === 1 ? ' update' : ' updates'),
            last !== null ? ' · ' : null,
            agoNode(last, 'news-livechip-ago'))));
      }
      return box;
    }

    /* ---------- fact checks ---------- */

    function verdictChip(v, small) {
      var key = String(v == null ? '' : v).toLowerCase();
      var row = own(VERDICT, key) ? VERDICT[key] : null;
      var label = row ? row[0] : (key ? key.replace(/-/g, ' ') : 'Unrated');
      return el('span', {
        'class': 'news-verdict news-verdict-' + (row ? key : 'unrated') +
                 (small ? ' is-small' : ''),
        title: row ? row[1] : 'No rating on file.'
      }, label.toUpperCase());
    }

    function checkLabel(f) {
      return clip(stripText(f.claim), 110) || 'A claim we looked at';
    }

    function factcheckStrip() {
      if (!factchecks.length) { return null; }
      var box = el('div', { 'class': 'news-fcstrip' });
      box.appendChild(el('h4', { 'class': 'news-rule-head' }, 'Fact check'));
      for (var i = 0; i < factchecks.length && i < 4; i++) {
        var f = factchecks[i] || {};
        box.appendChild(el('div', { 'class': 'news-fc-row' },
          verdictChip(f.verdict, true),
          link('/factcheck/' + encodeURIComponent(String(f.id)),
            checkLabel(f), 'news-fc-rowlink')));
      }
      return box;
    }

    /* ---------- most read ---------- */

    /* Ranked by a counter that grows with the wall clock, so the order is
     * stable within a minute and different an hour later, which is how the
     * real box behaves and why nobody trusts it. No thumbnails: the numbered
     * text list is the shape this widget has had since about 2005. */
    function mostRead() {
      if (!articles.length) { return null; }
      var scored = [], i;
      for (i = 0; i < articles.length; i++) {
        var key = 'read:' + domain + ':' + articles[i].id;
        var h = hash(key);
        scored.push({
          a: articles[i],
          n: counterOf(key, 380 + (h % 5200), 24 + (hash(key + '/rate') % 90))
        });
      }
      scored.sort(function (x, y) { return y.n - x.n; });

      var list = el('ol', { 'class': 'news-mostread-list' });
      for (i = 0; i < scored.length && i < 10; i++) {
        list.appendChild(el('li', { 'class': 'news-mostread-item' },
          el('span', { 'class': 'news-mostread-n' }, String(i + 1)),
          link(href(scored[i].a), String(scored[i].a.headline || 'Untitled'),
            'news-mostread-link')));
      }
      return el('aside', { 'class': 'news-mostread' },
        el('h4', { 'class': 'news-mostread-head' }, 'Most Read'),
        list,
        el('p', { 'class': 'news-mostread-note' },
          'Ranked by pages opened, which is not the same as pages read.'));
    }

    /* A dateline fixed to this paper's own latest edition -- which is right
     * for the frozen 2007 archive and wrong for a 2026 site whose slogan is
     * "Updated continuously". On those the masthead sat eleven days behind
     * its own front page, where the liveblog above it said "12 min ago".
     *
     * So a live paper prints today and an archive prints its last day. The
     * authored articles still decide the volume and issue number either way,
     * because those are the paper's, not the calendar's. */
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November',
                  'December'];

    function today() {
      var L = window.SYNTH.live;
      var t = new Date(L && L.now ? L.now() : Date.now());
      return MONTHS[t.getMonth()] + ' ' + t.getDate() + ', ' + t.getFullYear();
    }

    /* Dates are written "September 18, 2026", so picking the newest with a
     * string comparison sorts by the spelling of the month: September beats
     * October, and March beats April. Sort on a real key instead. */
    function dateKey(s) {
      var m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || ''));
      if (!m) { return -1; }
      var mi = -1;
      for (var i = 0; i < MONTHS.length; i++) {
        if (MONTHS[i].toLowerCase() === m[1].toLowerCase()) { mi = i; break; }
      }
      if (mi < 0) { return -1; }
      return parseInt(m[3], 10) * 10000 + mi * 100 + parseInt(m[2], 10);
    }

    function dateline() {
      var latest = '', best = -1;
      for (var i = 0; i < articles.length; i++) {
        var d = String(articles[i].date || '');
        var k = dateKey(d);
        if (d && k > best) { best = k; latest = d; }
      }
      /* Both of these used to read site.era raw. The masthead dateline is a
       * DATE slot -- it is uppercased into .news-dateline below, next to the
       * volume and issue number -- and site.era is the skin vintage, which
       * is free text and can be a range, so a paper with no parseable
       * article date would have printed "2009-2016  •  VOL. 129" there.
       * And `=== '2026'` meant a "2020-2026" masthead would not have got
       * today's date, which is the same mistake read the other way. */
      if (lastYear(site.era) >= 2026) { latest = today(); }
      if (!latest) { latest = String(lastYear(site.era) || ''); }
      var yr = yearOf(latest) || lastYear(site.era) || 2004;
      var seed = hash(site.domain || site.title || 'news');
      var vol = (yr - 1880) + (seed % 3);
      var no = 100 + (seed % 9000);
      var bits = [];
      if (latest) { bits.push(latest.toUpperCase()); }
      bits.push('VOL. ' + vol + ', NO. ' + no);
      bits.push('LATE EDITION');
      bits.push('FIFTY CENTS');
      return bits.join('  •  ');
    }

    function nav(currentSectionId) {
      var bar = el('div', { class: 'news-nav' });
      var front = link('/', 'Front Page', 'news-nav-link' + (currentSectionId === null ? ' is-current' : ''));
      bar.appendChild(front);
      for (var i = 0; i < sections.length; i++) {
        var s = sections[i] || {};
        var cur = String(s.id) === String(currentSectionId);
        bar.appendChild(link('/section/' + encodeURIComponent(String(s.id)),
          String(s.name || s.id), 'news-nav-link' + (cur ? ' is-current' : '')));
      }
      if (liveBlogs.length) {
        bar.appendChild(link('/live', 'Live',
          'news-nav-link' + (currentSectionId === 'live' ? ' is-current' : '')));
      }
      if (factchecks.length) {
        bar.appendChild(link('/factcheck', 'Fact Check',
          'news-nav-link' + (currentSectionId === 'factcheck' ? ' is-current' : '')));
      }
      return bar;
    }

    function masthead() {
      return el('div', { class: 'news-masthead' },
        el('h1', { class: 'news-name' },
          link('/', String(data.masthead || site.title || 'The Daily'), 'news-name-link')),
        el('p', { class: 'news-slogan' }, String(data.slogan || site.description || '')),
        el('p', { class: 'news-dateline' }, dateline()));
    }

    function shell(children, currentSectionId) {
      return el('div', { class: 'news-wrap' },
        /* Every news site has one of these now, and most of what scrolls
         * through it was not written by anyone. */
        (window.SYNTH.liveui ? window.SYNTH.liveui.ticker(site.domain, 10) : null),
        masthead(),
        nav(currentSectionId === undefined ? null : currentSectionId),
        el('div', { class: 'news-body' }, children),
        el('div', { class: 'news-foot' },
          el('p', null,
            String(data.masthead || site.title || 'The Daily'),
            ' — all contents set in ',
            String(lastYear(site.era) || 'the recent past'),
            '. Reproduction without permission is discouraged, loudly.'),
          /* The corrections page hangs off every page, which is the only way
           * anybody ever finds one. */
          el('p', { 'class': 'news-footlinks' },
            link('/corrections', 'Corrections & clarifications', 'news-footlink'),
            factchecks.length ? ' · ' : null,
            factchecks.length ? link('/factcheck', 'Fact checks', 'news-footlink') : null,
            liveBlogs.length ? ' · ' : null,
            liveBlogs.length ? link('/live', 'Live coverage', 'news-footlink') : null)));
    }

    function notFound(msg, currentSectionId) {
      ctx.title('Page Not Found - ' + (site.title || 'news'));
      ctx.mount.appendChild(shell([
        el('div', { class: 'news-404' },
          el('h2', { class: 'news-404-head' }, '404 — No such page'),
          el('p', null, String(msg || '')),
          el('p', null, link('/', 'Return to the front page')))
      ], currentSectionId));
    }

    function gridItem(a) {
      var featured = !!a.featured;
      var kids = [
        eyebrow(a),
        el('h3', { class: 'news-item-head' }, link(href(a), String(a.headline || 'Untitled'))),
        a.dek ? el('p', { class: 'news-item-dek' }, String(a.dek)) : null,
        byline(a)
      ];
      if (featured && a.lead) {
        kids.push(el('div', { class: 'news-item-text' }, markup(String(a.lead))));
        kids.push(el('p', { class: 'news-more' }, link(href(a), 'Full story »', 'news-more-link')));
      }
      return el('div', { class: 'news-item' + (featured ? ' is-featured' : '') }, kids);
    }

    /* ---------- routes ---------- */


    /* The wire that never stops. Most of what the Ledger publishes now is
     * generated, filed under a byline that is a product name, and the human
     * pieces sit underneath it. Arrivals are wall-clock driven; see
     * app/live.js. */
    function liveWire(count) {
      if (!window.SYNTH.live || !window.SYNTH.slop) return null;
      var L = window.SYNTH.live;
      if (!L.pool('newsItems').length) return null;
      var rows = L.stream('wire:' + site.domain, 'newsItems', 7, count);
      /* The story layer. One line: takes stream() rows, returns
       * stream() rows, and does nothing at all when no story is
       * touching this site -- which is most of the time. */
      rows = L.withStory(rows, site);
      if (!rows.length) return null;

      var box = el('div', { class: 'news-wire' });
      box.appendChild(el('div', { class: 'news-wire-head' },
        'Filed in the last hour',
        el('span', { class: 'news-wire-sub' },
          ' · ' + L.commas(L.counter('wire:' + site.domain, 41820, 380)) +
          ' stories published this year')));

      rows.forEach(function (r) {
        var it = r.item;
        box.appendChild(el('div', { class: 'news-wire-row' },
          el('span', { class: 'news-wire-sec' }, String(it.section || 'Local')),
          el('span', { class: 'news-wire-title' }, String(it.headline || '')),
          (window.SYNTH.liveui
            ? window.SYNTH.liveui.badge(it.kind === 'sponsored' ? 'sponsored' : it.kind)
            : null),
          el('span', { class: 'news-wire-meta' },
            ' ' + String(it.byline || 'Staff') + ' · ' + L.ago(r.at))));
      });
      return box;
    }

    if (path.length === 0) {
      ctx.title(String(data.masthead || site.title || 'News'));
      if (!articles.length) {
        ctx.mount.appendChild(shell([el('p', { class: 'news-empty' }, 'No copy filed today.')], null));
        return;
      }
      var lead = null, rest = [], i;
      for (i = 0; i < articles.length; i++) {
        if (!lead && articles[i].featured) { lead = articles[i]; } else { rest.push(articles[i]); }
      }
      if (!lead) { lead = rest.shift(); }
      var featuredRest = [], plainRest = [];
      for (i = 0; i < rest.length; i++) {
        if (rest[i].featured) { featuredRest.push(rest[i]); } else { plainRest.push(rest[i]); }
      }
      var ordered = featuredRest.concat(plainRest);

      var grid = el('div', { class: 'news-grid' });
      for (i = 0; i < ordered.length; i++) { grid.appendChild(gridItem(ordered[i])); }

      var topAd = ad('banner', site.domain + ':front');
      var sideAd = ad('box', site.domain + ':front-side');

      var frontMain = el('div', { 'class': 'news-frontmain' },
        liveStrip(),
        el('div', { class: 'news-lead' },
          eyebrow(lead),
          el('h2', { class: 'news-lead-head' },
            link(href(lead), String(lead.headline || 'Untitled'))),
          lead.dek ? el('p', { class: 'news-lead-dek' }, String(lead.dek)) : null,
          byline(lead),
          el('div', { class: 'news-lead-text' }, markup(String(lead.lead || lead.body || ''))),
          el('p', { class: 'news-more' },
            link(href(lead), 'Continue reading »', 'news-more-link'))),
        ordered.length ? el('h4', { class: 'news-rule-head' }, 'Also in this edition') : null,
        grid,
        factcheckStrip());

      var side = el('aside', { 'class': 'news-side' },
        mostRead(),
        sideAd ? el('div', { 'class': 'news-ad news-ad-side' }, sideAd) : null);

      ctx.mount.appendChild(shell([
        /* Above the fold, above everything, which is where it was sold. */
        topAd ? el('div', { 'class': 'news-ad news-ad-top' }, topAd) : null,
        liveWire(9),
        el('div', { 'class': 'news-front' }, frontMain, side)
      ], null));
      return;
    }

    if (path[0] === 'section' && path.length >= 2) {
      var sid = String(path[1]);
      var known = false;
      for (i = 0; i < sections.length; i++) { if (String(sections[i].id) === sid) { known = true; } }
      var list = inSection(sid);
      if (!known && !list.length) {
        notFound('There is no section called "' + sid + '".', null);
        return;
      }
      var name = sectionName(sid);
      ctx.title(name + ' - ' + (data.masthead || site.title || 'News'));

      var ul = el('div', { class: 'news-list' });
      for (i = 0; i < list.length; i++) {
        var a = list[i];
        ul.appendChild(el('div', { class: 'news-list-item' + (a.featured ? ' is-featured' : '') },
          eyebrow(a, sid),
          el('h3', { class: 'news-list-head' }, link(href(a), String(a.headline || 'Untitled'))),
          a.dek ? el('p', { class: 'news-list-dek' }, String(a.dek)) : null,
          byline(a)));
      }
      ctx.mount.appendChild(shell([
        el('h2', { class: 'news-section-title' }, name),
        el('p', { class: 'news-section-count' },
          list.length + (list.length === 1 ? ' story' : ' stories') + ' filed.'),
        el('div', { 'class': 'news-front' },
          el('div', { 'class': 'news-frontmain' },
            list.length ? ul : el('p', { class: 'news-empty' }, 'Nothing in this section.')),
          el('aside', { 'class': 'news-side' }, mostRead()))
      ], sid));
      return;
    }

    if (path[0] === 'article' && path.length >= 2) {
      var art = byId(String(path[1]));
      if (!art) { notFound('No story with the id "' + String(path[1]) + '".', null); return; }
      ctx.title(String(art.headline || 'Story') + ' - ' + (data.masthead || site.title || 'News'));

      var upd = updatesOf(art);

      var sameSection = inSection(art.sectionId);
      var more = el('ul', { class: 'news-more-list' });
      var shown = 0;
      for (i = 0; i < sameSection.length && shown < 6; i++) {
        if (String(sameSection[i].id) === String(art.id)) { continue; }
        more.appendChild(el('li', null,
          link(href(sameSection[i]), String(sameSection[i].headline || 'Untitled')),
          sameSection[i].dek ? el('span', { class: 'news-more-dek' }, ' — ' + String(sameSection[i].dek)) : null));
        shown++;
      }

      ctx.mount.appendChild(shell([
        el('div', { class: 'news-article' },
          eyebrow(art),
          el('h2', { class: 'news-headline' }, String(art.headline || 'Untitled')),
          art.dek ? el('p', { class: 'news-dek' }, String(art.dek)) : null,
          byline(art),
          stamps(art, upd.landed),
          ageBanner(art),
          upd.pending
            ? el('p', { 'class': 'news-devel' },
                'This story is developing and will be updated')
            : null,
          el('div', { class: 'news-text' },
            updateStack(upd.landed),
            markup(String(art.lead || '')),
            markup(String(art.body || '')))),
        el('div', { class: 'news-morefrom' },
          el('h4', { class: 'news-morefrom-head' }, 'More from ' + sectionName(art.sectionId)),
          shown ? more : el('p', { class: 'news-empty' }, 'Nothing else in this section.'),
          el('p', { class: 'news-backlink' },
            link('/section/' + encodeURIComponent(String(art.sectionId)),
              'All of ' + sectionName(art.sectionId)),
            ' · ',
            link('/', 'Front page')))
      ], art.sectionId));
      return;
    }

    /* ---------- /live ---------- */

    if (path[0] === 'live') {
      if (path.length < 2) {
        ctx.title('Live coverage - ' + (data.masthead || site.title || 'News'));
        var lrows = el('div', { 'class': 'news-index-list' });
        for (i = 0; i < liveBlogs.length; i++) {
          var lb = liveBlogs[i] || {};
          var lopen = !!lb.open;
          var lastLb = lastTouch(blogRows(lb), lb);
          lrows.appendChild(el('div', { 'class': 'news-index-row' },
            el('span', { 'class': 'news-livechip' + (lopen ? '' : ' is-closed') },
              lopen ? el('span', { 'class': 'news-live-dot', 'aria-hidden': 'true' }) : null,
              lopen ? 'LIVE' : 'ENDED'),
            link('/live/' + encodeURIComponent(String(lb.id)),
              String(lb.headline || 'Live coverage'), 'news-index-link'),
            lb.standfirst ? el('p', { 'class': 'news-index-dek' }, String(lb.standfirst)) : null,
            el('p', { 'class': 'news-index-meta' },
              lastLb !== null ? 'Last updated ' : 'Not updated since it opened.',
              agoNode(lastLb, 'news-index-ago'))));
        }
        ctx.mount.appendChild(shell([
          el('h2', { 'class': 'news-section-title' }, 'Live coverage'),
          liveBlogs.length ? lrows
            : el('p', { 'class': 'news-empty' },
                'Nothing is running live. When something is, it goes here and stays here afterwards.')
        ], 'live'));
        return;
      }

      var blog = findIn(liveBlogs, String(path[1]));
      if (!blog) {
        notFound('No live coverage with the id "' + String(path[1]) + '".', 'live');
        return;
      }

      var open = !!blog.open;
      var rows = blogRows(blog);
      var last = lastTouch(rows, blog);
      var head = String(blog.headline || 'Live coverage');
      ctx.title((open ? head : head + ' — as it happened') + ' - ' +
        (data.masthead || site.title || 'News'));

      var header = el('div', { 'class': 'news-live-head' + (open ? '' : ' is-closed') },
        el('p', { 'class': 'news-live-flag' },
          open ? el('span', { 'class': 'news-live-dot', 'aria-hidden': 'true' }) : null,
          open ? 'LIVE' : 'ENDED'),
        el('h2', { 'class': 'news-live-headline' },
          open ? head : head + ' — as it happened'),
        blog.standfirst
          ? el('p', { 'class': 'news-live-standfirst' }, String(blog.standfirst)) : null,
        el('p', { 'class': 'news-live-meta' },
          open ? null : el('span', { 'class': 'news-live-closed' },
            'This liveblog has now closed. '),
          last !== null ? 'Last updated ' : 'No entries filed yet.',
          agoNode(last, 'news-live-ago'),
          ' · ',
          el('span', { 'class': 'news-live-count' },
            rows.length + (rows.length === 1 ? ' update' : ' updates')),
          parseAt(blog.startedAt) !== null
            ? ' · Started ' + dayText(parseAt(blog.startedAt)) +
              ' ' + clockText(parseAt(blog.startedAt))
            : null));

      var keyBox = null;
      var pts = Array.isArray(blog.keyPoints) ? blog.keyPoints : [];
      if (pts.length) {
        var kl = el('ul', { 'class': 'news-keypoints-list' });
        for (i = 0; i < pts.length; i++) {
          kl.appendChild(el('li', null, markup(String(pts[i]))));
        }
        /* Pinned above the entries because almost nobody arrives at the top of
         * a liveblog. They arrive in the middle, from a link, six hours in. */
        keyBox = el('aside', { 'class': 'news-keypoints' },
          el('h3', { 'class': 'news-keypoints-head' }, 'Key points'),
          kl,
          el('p', { 'class': 'news-keypoints-note' },
            'Pinned. Most people open one of these halfway down.'));
      }

      var entries = el('div', { 'class': 'news-entries' });
      for (i = 0; i < rows.length; i++) {
        var r = rows[i];
        entries.appendChild(el('article', { 'class': 'news-entry' + (r.live ? ' is-live' : '') },
          el('p', { 'class': 'news-entry-time' },
            r.ms !== null ? el('span', { 'class': 'news-entry-clock' }, clockText(r.ms)) : null,
            r.ms !== null ? el('span', { 'class': 'news-entry-day' }, dayText(r.ms)) : null,
            agoNode(r.ms, 'news-entry-ago')),
          el('div', { 'class': 'news-entry-main' },
            r.label ? el('p', { 'class': 'news-entry-label' }, r.label) : null,
            r.headline ? el('h3', { 'class': 'news-entry-head' }, r.headline) : null,
            body(r.text, 'news-entry-body'),
            el('p', { 'class': 'news-entry-by' },
              r.by ? r.by : 'Not bylined',
              badge(r.kind)))));
      }

      var liveAd = ad('banner', site.domain + ':live:' + blog.id);

      ctx.mount.appendChild(shell([
        header,
        keyBox,
        liveAd ? el('div', { 'class': 'news-ad news-ad-live' }, liveAd) : null,
        rows.length ? entries
          : el('p', { 'class': 'news-empty' },
              'Nothing has been filed to this liveblog. The header went up anyway.'),
        el('p', { class: 'news-backlink' },
          link('/', 'Front page'), ' · ',
          link('/corrections', 'Corrections'))
      ], 'live'));
      return;
    }

    /* ---------- /factcheck ---------- */

    if (path[0] === 'factcheck') {
      if (path.length < 2) {
        ctx.title('Fact checks - ' + (data.masthead || site.title || 'News'));
        var frows = el('div', { 'class': 'news-index-list' });
        for (i = 0; i < factchecks.length; i++) {
          var fc = factchecks[i] || {};
          frows.appendChild(el('div', { 'class': 'news-index-row' },
            verdictChip(fc.verdict, true),
            link('/factcheck/' + encodeURIComponent(String(fc.id)),
              checkLabel(fc), 'news-index-link'),
            el('p', { 'class': 'news-index-meta' },
              [trim(fc.claimBy), trim(fc.claimWhere), trim(fc.claimWhen)]
                .filter(function (x) { return !!x; }).join(' · '))));
        }
        ctx.mount.appendChild(shell([
          el('h2', { 'class': 'news-section-title' }, 'Fact checks'),
          factchecks.length ? frows
            : el('p', { 'class': 'news-empty' },
                'No fact checks on file. Checking one costs more than writing four.')
        ], 'factcheck'));
        return;
      }

      var check = findIn(factchecks, String(path[1]));
      if (!check) {
        notFound('No fact check with the id "' + String(path[1]) + '".', 'factcheck');
        return;
      }
      ctx.title('Fact check: ' + clip(stripText(check.claim), 60) + ' - ' +
        (data.masthead || site.title || 'News'));

      var attrib = [trim(check.claimBy), trim(check.claimWhere), trim(check.claimWhen)]
        .filter(function (x) { return !!x; }).join('  ·  ');

      var evidence = Array.isArray(check.evidence) ? check.evidence : [];
      var ev = el('ol', { 'class': 'news-fc-evidence' });
      for (i = 0; i < evidence.length; i++) {
        ev.appendChild(el('li', null, markup(String(evidence[i]))));
      }

      var sources = Array.isArray(check.sources) ? check.sources : [];
      var sl = el('ul', { 'class': 'news-fc-sources' });
      for (i = 0; i < sources.length; i++) {
        sl.appendChild(el('li', { 'class': 'news-fc-source' }, markup(String(sources[i]))));
      }

      ctx.mount.appendChild(shell([
        el('div', { 'class': 'news-fc' },
          el('p', { 'class': 'news-eyebrow' },
            el('span', { 'class': 'news-kicker' }, 'FACT CHECK')),
          el('h2', { 'class': 'news-fc-h' }, 'The claim'),
          el('blockquote', { 'class': 'news-fc-claim' },
            el('p', { 'class': 'news-fc-claim-text' }, String(check.claim || ''))),
          attrib ? el('p', { 'class': 'news-fc-attrib' }, attrib) : null,
          el('div', { 'class': 'news-fc-verdictbox' },
            verdictChip(check.verdict, false),
            el('span', { 'class': 'news-fc-gloss' },
              own(VERDICT, String(check.verdict || '').toLowerCase())
                ? VERDICT[String(check.verdict).toLowerCase()][1]
                : 'No rating on file.')),
          el('h3', { 'class': 'news-fc-h3' }, 'Our ruling'),
          body(check.ruling, 'news-fc-ruling'),
          evidence.length ? el('h3', { 'class': 'news-fc-h3' }, 'What we found') : null,
          evidence.length ? ev : null,
          sources.length ? el('h3', { 'class': 'news-fc-h3' }, 'Sources') : null,
          sources.length ? sl
            : el('p', { 'class': 'news-empty' }, 'No sources were listed with this check.')),
        el('p', { class: 'news-backlink' },
          link('/factcheck', 'All fact checks'), ' · ',
          link('/', 'Front page'))
      ], 'factcheck'));
      return;
    }

    /* ---------- /corrections ---------- */

    if (path[0] === 'corrections') {
      ctx.title('Corrections - ' + (data.masthead || site.title || 'News'));

      var rowsC = [], ci;
      for (ci = 0; ci < corrections.length; ci++) {
        var c = corrections[ci] || {};
        rowsC.push({ ms: parseAt(c.at), raw: c.at, c: c });
      }
      rowsC.sort(function (x, y) { return (y.ms || 0) - (x.ms || 0); });

      var listBox = el('div', { 'class': 'news-corr' });
      var currentMonth = null;
      var group = null;

      for (ci = 0; ci < rowsC.length; ci++) {
        var row = rowsC[ci];
        var label = row.ms === null ? 'Undated' : monthText(row.ms);
        if (label !== currentMonth) {
          currentMonth = label;
          listBox.appendChild(el('h3', { 'class': 'news-corr-month' }, label));
          group = el('ul', { 'class': 'news-corr-list' });
          listBox.appendChild(group);
        }

        var kindKey = String(row.c.kind || 'correction').toLowerCase();
        var kindLabel = own(CORR_KIND, kindKey) ? CORR_KIND[kindKey] : 'Note';

        var target = null;
        if (row.c.articleId) {
          var hit = byId(String(row.c.articleId));
          target = hit
            ? el('p', { 'class': 'news-corr-art' }, 'On: ',
                link(href(hit), String(hit.headline || 'the article'), 'news-corr-artlink'))
            /* The article is gone and the correction to it is not. This is the
             * ordinary state of a corrections page and it is left visible. */
            : el('p', { 'class': 'news-corr-art news-corr-gone' },
                'On: a story no longer on this site (' + String(row.c.articleId) + ')');
        }

        group.appendChild(el('li', { 'class': 'news-corr-row' },
          el('p', { 'class': 'news-corr-date' },
            row.ms === null ? trim(row.raw) || 'no date' : dayText(row.ms)),
          el('span', { 'class': 'news-corr-kind news-corr-kind-' + kindKey }, kindLabel),
          body(row.c.text, 'news-corr-text'),
          target));
      }

      ctx.mount.appendChild(shell([
        el('h2', { 'class': 'news-section-title' }, 'Corrections & clarifications'),
        el('p', { 'class': 'news-corr-intro' },
          rowsC.length
            ? (rowsC.length + (rowsC.length === 1 ? ' entry' : ' entries') +
               ', newest first. A correction stays here whether or not the story it ' +
               'belongs to is still up.')
            : 'Nothing has been filed to this page. That is not the same as nothing ' +
              'being wrong. Corrections are appended to the story they belong to when ' +
              'somebody asks for one, and somebody has to ask.'),
        rowsC.length ? listBox : null,
        el('p', { class: 'news-backlink' }, link('/', 'Front page'))
      ], null));
      return;
    }

    notFound('The address "/' + path.join('/') + '" is not part of this paper.', null);
  });
})();
