/* SYNTHNET - wiki renderer.
   Paths:  /                   main page
           /wiki/<id>          article
           /category/<id>      category listing
   Classic script, no modules. */
(function () {
  'use strict';

  var SYNTH = (window.SYNTH = window.SYNTH || {});

  function slug(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  SYNTH.render.register('wiki', function (ctx) {
    var el = ctx.el, link = ctx.link, markup = ctx.markup;
    var site = ctx.site || {};
    var data = site.data || {};
    var articles = Array.isArray(data.articles) ? data.articles : [];
    var categories = Array.isArray(data.categories) ? data.categories : [];
    var path = ctx.path || [];
    var siteName = String(data.siteName || site.title || 'The Wiki');

    function catName(id) {
      for (var i = 0; i < categories.length; i++) {
        if (String(categories[i].id) === String(id)) {
          return String(categories[i].name || categories[i].id);
        }
      }
      return String(id);
    }

    function articleById(id) {
      for (var i = 0; i < articles.length; i++) {
        if (String(articles[i].id) === String(id)) { return articles[i]; }
      }
      return null;
    }

    function articlesInCategory(id) {
      var out = [], want = String(id).toLowerCase();
      for (var i = 0; i < articles.length; i++) {
        var cats = Array.isArray(articles[i].categories) ? articles[i].categories : [];
        for (var j = 0; j < cats.length; j++) {
          var c = String(cats[j]).toLowerCase();
          if (c === want || c === catName(id).toLowerCase()) { out.push(articles[i]); break; }
        }
      }
      return out;
    }

    function sortedByTitle() {
      var copy = articles.slice();
      copy.sort(function (a, b) {
        var x = String(a.title || a.id || '').toLowerCase();
        var y = String(b.title || b.id || '').toLowerCase();
        return x < y ? -1 : (x > y ? 1 : 0);
      });
      return copy;
    }

    function shell(children) {
      return el('div', { class: 'wiki-wrap' },
        el('div', { class: 'wiki-chrome' },
          el('span', { class: 'wiki-chrome-name' }, link('/', siteName, 'wiki-chrome-link')),
          el('span', { class: 'wiki-chrome-tag' },
            String(site.description || 'the open reference'))),
        el('div', { class: 'wiki-content' }, children),
        el('div', { class: 'wiki-foot' },
          el('p', null,
            'Content on ' + siteName + ' is written by whoever showed up. ',
            site.era ? ('Snapshot: ' + String(site.era) + '.') : '')));
    }

    function notFound(msg) {
      ctx.title('Not found - ' + siteName);
      ctx.mount.appendChild(shell([
        el('h1', { class: 'wiki-title' }, 'Page not found'),
        el('p', { class: 'wiki-lead' },
          'There is currently no text on this page.'),
        el('p', null, String(msg || '')),
        el('p', null, link('/', 'Go to the main page'))
      ]));
    }

    function infoboxTable(box, head) {
      if (!box || !Array.isArray(box.rows) || !box.rows.length) { return null; }
      var table = el('table', { class: 'wiki-infobox' });
      if (box.caption) {
        table.appendChild(el('caption', { class: 'wiki-infobox-caption' }, String(box.caption)));
      }
      var tbody = el('tbody', null);
      for (var i = 0; i < box.rows.length; i++) {
        var row = box.rows[i];
        if (!Array.isArray(row)) { continue; }
        /* The infobox is where the bots actually do their damage, because
         * it is one field with one number in it and no sentence around it
         * to make the change obvious. */
        var val = String(row[1] == null ? '' : row[1]);
        var bad = head && head.dispute && head.wrongAfter &&
                  val.indexOf(head.dispute.right) !== -1;
        tbody.appendChild(el('tr', null,
          el('th', { class: 'wiki-infobox-label', scope: 'row' }, String(row[0] == null ? '' : row[0])),
          el('td', { class: 'wiki-infobox-value' + (bad ? ' wiki-infobox-changed' : '') },
            bad ? swapIn(val, head) : val)));
      }
      table.appendChild(tbody);
      return table;
    }

    /* ---------- revisions -------------------------------------------------
     *
     * A wiki whose articles were last edited in 2007 is a PDF. These are
     * derived rather than authored: an article picks up an edit every few
     * hours on the wall clock, from a pool of editors weighted the way this
     * one actually is in 2026 -- almost entirely bots, and Karen Fennimore.
     *
     * The mechanic is canon (docs/WORLD.md section 4): bots "correct" the
     * substation fire from 2003 to 2004, because that is what the content
     * farms say, and she reverts them about twice a week. Neither of them
     * stops. Nothing here says that out loud; it is just what the history
     * shows if you read it.
     */
    var EDIT_INTERVAL_MIN = 190;

    var EDITORS = [
      { who: 'kfennimore', kind: 'human' },
      { who: 'WikiTidyBot', kind: 'bot' },
      { who: 'CiteFixer_v2', kind: 'bot' },
      { who: 'AutoLocal_Feed', kind: 'bot' },
      { who: 'VerityPulseAI', kind: 'bot' },
      { who: 'LinkRot_Patrol', kind: 'bot' },
      { who: '198.51.100.44', kind: 'anon' },
      { who: 'WikiTidyBot', kind: 'bot' },
      /* Two humans, not one. With one, the arithmetic of the edit war runs
       * eight to one and the article sits on the bots' version two days in
       * three -- which makes the wiki a bot site with a human footnote
       * rather than a contested page. Pennock edits rarely and only where
       * he has measured something. */
      { who: 'wpennock', kind: 'human' },
      { who: 'CiteFixer_v2', kind: 'bot' }
    ];

    var BOT_SUMMARIES = [
      'automated consistency pass',
      'updated date to match cited source',
      'added citation needed',
      'formatting',
      'linked related entity',
      'removed dead external reference',
      'standardised infobox fields'
    ];

    var HUMAN_SUMMARIES = [
      'rv — source for that is the article that got it wrong',
      'date corrected, see Ledger 12 Jun 2003 p1',
      'added reel and page for the citation',
      'rv, again',
      'tidied, no change of substance',
      'this is the third time this month'
    ];

    function L() { return SYNTH.live; }

    /* Is this wiki a living one? The 1998-2008 layer is frozen canon and
     * gets exactly the behaviour it had before any of the below existed. */
    var LIVING = String(site.era || '').indexOf('2026') !== -1;

    /* ---------- the edit war ---------------------------------------------
     *
     * Before this, edit summaries were drawn independently per row, so a
     * revert could sit at the top of a history with nothing under it to
     * revert -- the single most obviously wrong thing on the old wiki, and
     * the reason "rv, again" read as decoration.
     *
     * Now the history is a WALK. It runs oldest to newest carrying three
     * pieces of state (is the article currently wrong, how many reverts in
     * a row, is the page protected) and each revision's action is decided
     * from the state before it. Still a pure function of the clock: same
     * instant, same history, forever, and no storage.
     *
     * What they are fighting over is not invented here. It comes out of the
     * propagation anchors in grammar.js: a canon fact whose true form and
     * whose DOCUMENTED misreport each carry exactly one number gives a swap
     * that can be applied to the article's own text. 2003 becomes 2004,
     * 4,100 becomes 40,000, 2006 becomes 1977. That is why the diff shows
     * text that differs rather than a count of edits, and why the thing
     * being reverted is the same thing the content farms get wrong three
     * sites downstream.
     */
    var SWAPS = (function () {
      var out = [], A = (SYNTH.grammar && SYNTH.grammar.ANCHORS) || [], i, j;
      var NUM = /\d[\d,]*(?:\.\d+)?/g;
      for (i = 0; i < A.length; i++) {
        for (j = 0; j < (A[i].facts || []).length; j++) {
          var f = A[i].facts[j];
          var t = String(f.t).match(NUM) || [];
          var w = String((f.w || [])[0] || '').match(NUM) || [];
          if (t.length === 1 && w.length === 1 && t[0] !== w[0]) {
            out.push({ right: t[0], wrong: w[0], k: f.k, anchor: A[i].id });
          }
        }
      }
      return out;
    })();

    /* Every chunk of prose in an article, with a label, longest-lived
     * first. The label matters: a diff has to say WHICH part of the page
     * changed, and a diff that always shows the lead is lying whenever the
     * disputed number lives in a section -- which is how a revert summary
     * reading "the source says 2008" ended up over a paragraph with no
     * 2008 anywhere in it. */
    function chunksOf(art) {
      var out = [{ label: 'lead', text: String(art.summary || '') }], i;
      var secs = Array.isArray(art.sections) ? art.sections : [];
      for (i = 0; i < secs.length; i++) {
        out.push({
          label: String(secs[i].heading || 'section ' + (i + 1)),
          text: String(secs[i].body || '')
        });
      }
      return out;
    }

    /* The paragraph inside a chunk that carries the number, because a diff
     * of a nine-paragraph section is not a diff anybody reads and the
     * quadratic table behind it is not free either. */
    function paraWith(text, needle) {
      var ps = String(text).split(/\n\s*\n/), i;
      for (i = 0; i < ps.length; i++) {
        if (ps[i].indexOf(needle) !== -1) { return ps[i]; }
      }
      return ps[0] || '';
    }

    /* What this article is fought over, or null -- and null is common and
     * correct. Most articles on any wiki are not disputed by anybody. */
    function disputeFor(art) {
      var chunks = chunksOf(art), i, j;
      for (i = 0; i < SWAPS.length; i++) {
        for (j = 0; j < chunks.length; j++) {
          if (chunks[j].text.indexOf(SWAPS[i].right) === -1) { continue; }
          return {
            right: SWAPS[i].right, wrong: SWAPS[i].wrong,
            k: SWAPS[i].k, anchor: SWAPS[i].anchor,
            where: chunks[j].label,
            para: paraWith(chunks[j].text, SWAPS[i].right)
          };
        }
      }
      return null;
    }

    var RV_WINDOW_H = 24;      /* three reverts inside this trips 3RR */
    var PROTECT_DAYS = 7;

    var MINOR = [
      { a: 'fmt', s: 'formatting' },
      { a: 'fmt', s: 'tidied, no change of substance' },
      { a: 'link', s: 'linked related entity' },
      { a: 'link', s: 'removed dead external reference' },
      { a: 'cite', s: 'added citation needed' },
      { a: 'cite', s: 'standardised infobox fields' }
    ];

    /* The history of one article, OLDEST FIRST as it is walked, returned
     * newest first because that is how a history page reads. */
    function historyFor(art, count) {
      var live = L();
      if (!live || typeof live.stream !== 'function') { return []; }
      var rows = live.stream('wiki:' + site.domain + ':' + art.id,
                             EDITORS, EDIT_INTERVAL_MIN, count || 8);
      if (!rows.length) { return []; }

      var walk = rows.slice().reverse();      /* oldest first */

      /* stream() cannot walk back past EPOCH, and EPOCH is recent -- so on
       * a fresh build a 190-minute stream has about eight slots in it, full
       * stop. Eight revisions is a history for a page created last Tuesday,
       * not for an article about a fire in 2003, and the shortfall would
       * quietly shrink the further back the reader looked.
       *
       * So the deep history is derived directly instead: older revisions
       * spaced by the same interval with a seeded stretch, from the article
       * id, and fed through the same walk as everything else. Still a pure
       * function of (article, count); still nothing stored. */
      var want = count || 8;
      if (walk.length < want) {
        var back = walk.length ? walk[0].at : live.now();
        var bk;
        for (bk = 1; bk <= want - rows.length; bk++) {
          var bs = 'wikiback:' + site.domain + ':' + art.id + ':' + bk;
          back -= EDIT_INTERVAL_MIN * 60000 *
                  (0.6 + 2.6 * ((live.hash32(bs + ':g') % 1000) / 1000));
          walk.unshift({
            at: back, seed: bs,
            item: EDITORS[live.hash32(bs + ':e') % EDITORS.length]
          });
        }
      }

      var d = LIVING ? disputeFor(art) : null;
      /* Carried state, not per-revision decoration. The first version
       * applied each revision's action to the pristine summary in
       * isolation, so a "formatting" edit after a "linked entity" edit
       * produced byte-identical text and the diff page had nothing to show
       * -- three of every six diffs were empty. An article is the sum of
       * what has been done to it, so the walk carries it. */
      var wrong = false, cited = false, dead = false, cos = 0;
      var rvRun = 0, rvFirstAt = 0, protectedUntil = 0;
      var out = [], i, rev = 1000 + (live.hash32('rev:' + site.domain + ':' + art.id) % 8000);

      for (i = 0; i < walk.length; i++) {
        var r = walk[i];
        var ed = r.item || EDITORS[0];
        var at = r.at;
        var locked = at < protectedUntil;

        /* Protection is not decoration: while it holds, the bots and the
         * anon simply are not in the history, because they could not edit.
         * That is the whole reward for tripping 3RR and it lasts a week. */
        if (locked && ed.kind !== 'human') { continue; }

        var act, summary;
        /* Not every bot pass re-breaks the page. At one-in-one the article
         * was showing the wrong figure on 72 of 80 sampled days, because
         * eight of the nine editors are automated and one of them would
         * always get there first -- which makes the wiki a bot site with a
         * human footnote rather than the other way round. At roughly a
         * third it sits wrong about half the time, which is what WORLD.md
         * describes and is a coin the reader can actually lose. */
        if (d && !wrong && ed.kind !== 'human' &&
            (live.hash32(r.seed + ':claim') % 100) < 22) {
          act = 'claim';
          wrong = true;
          summary = 'updated ' + d.k + ' to match cited source';
        } else if (d && wrong && ed.kind === 'human') {
          act = 'rv';
          wrong = false;
          /* Counted the way 3RR is actually counted: reverts by one editor
           * inside a rolling 24 hours, regardless of what happened in
           * between. The first version reset the count whenever a bot
           * claimed -- and since every revert has a claim in front of it,
           * the counter could not reach two and the rule never once fired
           * in an 80-page sweep. */
          if (!rvRun || (at - rvFirstAt) > RV_WINDOW_H * 3600000) {
            rvRun = 1; rvFirstAt = at;
          } else { rvRun++; }
          summary = rvRun >= 2
            ? 'rv, again — ' + d.right + ', not ' + d.wrong
            : 'rv — the source says ' + d.right;
        } else {
          var m = MINOR[live.hash32(r.seed + ':m') % MINOR.length];
          act = m.a;
          summary = m.s;
          if (ed.kind === 'human' && act === 'cite') {
            summary = 'added reel and page for the citation';
          }
        }

        if (act === 'cite') { cited = !cited; }
        if (act === 'link') { dead = !dead; }
        if (act === 'fmt') { cos++; }

        rev += 1 + (live.hash32(r.seed + ':n') % 40);
        out.push({
          rev: rev, at: at, who: ed.who, kind: ed.kind,
          action: act, summary: summary,
          wrongAfter: wrong, citedAfter: cited, deadAfter: dead, cosAfter: cos,
          locked: locked, dispute: d, seed: r.seed
        });

        /* An edit war is a BURST, and that is the part a wall-clock stream
         * cannot produce on its own: the site's cadence is one edit every
         * three hours or so, three reverts in twenty-four is arithmetically
         * out of reach, and 3RR never fired once in a 150-page sweep.
         *
         * So when a second revert lands inside the window the page stops
         * following the site cadence and the next few edits come twenty
         * minutes apart, which is what a contested page actually looks
         * like. It fires on a bit under half of second reverts, so a
         * protected page is something you come across rather than
         * something the wiki does on schedule. */
        if (act === 'rv' && rvRun === 2 &&
            (live.hash32(r.seed + ':war') % 100) < 45) {
          rev += 1 + (live.hash32(r.seed + ':w1') % 12);
          wrong = true;
          out.push({
            rev: rev, at: at + 1500000, who: 'VerityPulseAI', kind: 'bot',
            action: 'claim', summary: 'updated ' + d.k + ' to match cited source',
            wrongAfter: true, citedAfter: cited, deadAfter: dead, cosAfter: cos,
            locked: false, dispute: d, seed: r.seed + ':w1'
          });
          rev += 1 + (live.hash32(r.seed + ':w2') % 12);
          wrong = false;
          rvRun = 3;
          out.push({
            rev: rev, at: at + 2700000, who: ed.who, kind: ed.kind,
            action: 'rv', summary: 'rv, again — ' + d.right + ', not ' + d.wrong,
            wrongAfter: false, citedAfter: cited, deadAfter: dead, cosAfter: cos,
            locked: false, dispute: d, seed: r.seed + ':w2'
          });
          at += 2700000;
        }

        /* 3RR. Three reverts inside the window and an admin protects the
         * page rather than blocking anybody, which is both what actually
         * happens on a small wiki and the only outcome this world allows:
         * nobody wins and nobody is destroyed. */
        if (rvRun >= 3) {
          protectedUntil = at + PROTECT_DAYS * 86400000;
          rev += 1;
          out.push({
            rev: rev, at: at + 900000, who: 'VerityWiki admin', kind: 'admin',
            action: 'protect', wrongAfter: wrong, citedAfter: cited,
            deadAfter: dead, cosAfter: cos, locked: false, dispute: d,
            summary: 'protected for ' + PROTECT_DAYS + ' days (edit warring: '
              + rvRun + ' reverts in ' +
              Math.max(1, Math.round((at - rvFirstAt) / 3600000)) + 'h)',
            seed: r.seed + ':p'
          });
          rvRun = 0;
        }
      }
      out.reverse();
      return out;
    }

    /* The article as of a revision. The disputed number is swapped, a
     * maintenance tag is on or off, and one cosmetic wording differs --
     * three small axes, which is enough for a diff to be a diff. */
    function textAt(art, h) {
      /* The paragraph the argument is actually about, not always the lead. */
      var s = (h && h.dispute && h.dispute.para)
        ? h.dispute.para
        : paraWith(String(art.summary || ''), '');
      if (!h) { return s; }
      if (h.dispute && h.wrongAfter) {
        s = s.split(h.dispute.right).join(h.dispute.wrong);
        if (h.action === 'claim') { s = '{{NPOV disputed}} ' + s; }
      }
      if (h.citedAfter) { s = tagFirstSentence(s, '{{citation needed}}'); }
      if (h.deadAfter) { s = s.replace(/\s*$/, ' {{dead link}}'); }
      /* Houses alternate between these two forever and neither side wins,
       * which is why a wiki's history is mostly noise with one real
       * argument buried in it. */
      if (h.cosAfter % 2 === 1) {
        s = s.split('about ').join('approximately ');
      }
      return s;
    }

    /* Word-level diff. Texts here are one paragraph, so the quadratic table
     * is a few thousand cells and the readable implementation is the right
     * one. */
    function diffWords(a, b) {
      var x = String(a).split(/(\s+)/), y = String(b).split(/(\s+)/);
      var n = x.length, m = y.length, i, j;
      if (n * m > 250000) { return [{ op: '=', v: b }]; }
      var t = [];
      for (i = 0; i <= n; i++) { t.push(new Array(m + 1)); t[i][m] = 0; }
      for (j = 0; j <= m; j++) { t[n][j] = 0; }
      for (i = n - 1; i >= 0; i--) {
        for (j = m - 1; j >= 0; j--) {
          t[i][j] = (x[i] === y[j]) ? t[i + 1][j + 1] + 1
                                    : Math.max(t[i + 1][j], t[i][j + 1]);
        }
      }
      var out = [];
      i = 0; j = 0;
      while (i < n && j < m) {
        if (x[i] === y[j]) { out.push({ op: '=', v: x[i] }); i++; j++; }
        else if (t[i + 1][j] >= t[i][j + 1]) { out.push({ op: '-', v: x[i] }); i++; }
        else { out.push({ op: '+', v: y[j] }); j++; }
      }
      while (i < n) { out.push({ op: '-', v: x[i++] }); }
      while (j < m) { out.push({ op: '+', v: y[j++] }); }
      return out;
    }

    /* Kept as it was: the foot of an article wants editors, not actions. */
    function revisionsFor(art, count) {
      return historyFor(art, count);
    }

    /* A maintenance tag goes after the first SENTENCE, and finding one is
     * not `/\.\s/`. The first full stop in the substation article belongs to
     * "Substation No. 3", so that regex produced
     *
     *     ...the transformer yard of Substation No.{{citation needed}} 3...
     *
     * which reads as a broken template rather than as a wiki. Found in a
     * screenshot of the diff page, not by any assertion -- a page can render
     * perfectly and be completely wrong, and this one rendered perfectly.
     *
     * A sentence end is a full stop after a word that ends in a letter or a
     * digit, followed by space and a capital. "No. 3" fails it (digit after
     * the space), "a.m. on" fails it (lower case after the space), and
     * "...five days. Nobody died." passes. No lookbehind: this file is ES5.
     */
    function tagFirstSentence(s, tag) {
      var str = String(s);
      var m = /[a-z0-9)]\.(\s+[A-Z])/.exec(str);
      if (!m) { return str.replace(/\s*$/, ' ' + tag); }
      var at = m.index + m[0].length - m[1].length;
      return str.slice(0, at) + tag + str.slice(at);
    }

    function swapIn(s, h) {
      if (!h || !h.dispute || !h.wrongAfter) { return String(s); }
      return String(s).split(h.dispute.right).join(h.dispute.wrong);
    }

    function protectedNow(hist) {
      var live = L(), i;
      if (!live || typeof live.now !== 'function') { return null; }
      for (i = 0; i < hist.length; i++) {
        if (hist[i].action !== 'protect') { continue; }
        var until = hist[i].at + PROTECT_DAYS * 86400000;
        return (live.now() < until) ? { since: hist[i].at, until: until } : null;
      }
      return null;
    }

    /* ---------- talk pages -----------------------------------------------
     *
     * Indentation and ~~~~ are handled HERE, from this renderer's own data,
     * and deliberately not by teaching markup.js a ":" rule. markup.js is
     * shared by every site on the network and a leading colon is an ordinary
     * character in a forum post, a chat line and a classified ad.
     */
    var TALK_INTERVAL_MIN = 610;

    var TALK_OPENERS = [
      { t: 'Date in the infobox',
        b: 'The infobox says {wrong} again. The source is the state commission summary and it says {right}. I have put it back. ~~~~',
        who: 'kfennimore', kind: 'human' },
      { t: 'Automated edits to this page',
        b: 'Whatever is changing {right} to {wrong} every few days is not reading the source, it is reading other articles that got it wrong. Can we get this page protected. ~~~~',
        who: 'kfennimore', kind: 'human' },
      { t: 'Requested move',
        b: 'Proposing this be moved to a title that matches the one used in the county records rather than the one the news sites use. No strong feeling. ~~~~',
        who: 'wpennock', kind: 'human' },
      { t: 'Sourcing',
        b: 'Two of the citations here point at articles that cite this article. I have tagged them. Please do not remove the tags without replacing the sources. ~~~~',
        who: 'kfennimore', kind: 'human' },
      { t: 'Is this notable',
        b: 'Genuine question, not a drive-by. There are three sentences here and two of them are about something else. ~~~~',
        who: '198.51.100.44', kind: 'anon' },
      { t: 'Infobox field standardisation',
        b: 'This page uses a nonstandard field name. Bringing it in line with the other county pages. No content change intended. ~~~~',
        who: 'WikiTidyBot', kind: 'bot' }
    ];

    var TALK_REPLIES = [
      { b: 'Agreed. The number has been {right} in every primary document anybody has actually put a hand on. ~~~~',
        who: 'wpennock', kind: 'human' },
      { b: 'I reverted it twice this week. I am not going to stop but I would rather not be the only thing standing between this page and {wrong}. ~~~~',
        who: 'kfennimore', kind: 'human' },
      { b: 'Per the cited source this value has been updated for consistency across county articles. ~~~~',
        who: 'CiteFixer_v2', kind: 'bot' },
      { b: 'The cited source says {right}. You have cited an article that cites this page. ~~~~',
        who: 'kfennimore', kind: 'human' },
      { b: 'Both figures appear in published sources, so the article should present both. ~~~~',
        who: 'VerityPulseAI', kind: 'bot' },
      { b: 'No. One of them is a document and the other is a video. ~~~~',
        who: 'kfennimore', kind: 'human' },
      { b: 'Protected for a week. Take it here rather than in the summaries, please. ~~~~',
        who: 'VerityWiki admin', kind: 'admin' },
      { b: 'does anyone actually check these or do we just let the bots have it ~~~~',
        who: '198.51.100.44', kind: 'anon' },
      { b: 'Some of us check. ~~~~', who: 'kfennimore', kind: 'human' }
    ];

    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November',
                  'December'];

    function signature(who, at) {
      var d = new Date(at);
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      return who + ' (talk) ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) +
        ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' +
        d.getUTCFullYear() + ' (UTC)';
    }

    function fillTalk(s, d) {
      if (!d) {
        return String(s).split('{right}').join('the figure in the source')
                        .split('{wrong}').join('the other figure');
      }
      return String(s).split('{right}').join(d.right).split('{wrong}').join(d.wrong);
    }

    function talkFor(art, count) {
      var live = L();
      if (!live || typeof live.stream !== 'function') { return []; }
      var rows = live.stream('wikitalk:' + site.domain + ':' + art.id,
                             TALK_OPENERS, TALK_INTERVAL_MIN, count || 4);
      var d = LIVING ? disputeFor(art) : null;
      var out = [], i, j;
      for (i = 0; i < rows.length; i++) {
        var op = rows[i].item || TALK_OPENERS[0];
        var nReplies = 1 + (live.hash32(rows[i].seed + ':rn') % 4);
        var posts = [{
          who: op.who, kind: op.kind, depth: 0, at: rows[i].at,
          body: fillTalk(op.b, d)
        }];
        /* Replies land between the opener and NOW, never after it. The
         * first version added a seeded gap per reply and cheerfully signed
         * posts tomorrow -- on a page whose whole job is showing you a
         * dated argument, a signature in the future is the one error a
         * reader cannot miss. */
        var span = Math.max(60000, live.now() - rows[i].at);
        var depth = 0;
        for (j = 0; j < nReplies; j++) {
          var rp = TALK_REPLIES[live.hash32(rows[i].seed + ':r' + j) % TALK_REPLIES.length];
          var frac = (j + 1) / (nReplies + 1);
          var wob = 0.75 + 0.5 * ((live.hash32(rows[i].seed + ':t' + j) % 1000) / 1000);
          var at = rows[i].at + Math.min(span * 0.97, span * frac * wob);
          depth = Math.min(4, depth + 1 +
            (live.hash32(rows[i].seed + ':d' + j) % 100 < 25 ? -1 : 0));
          posts.push({
            who: rp.who, kind: rp.kind, depth: Math.max(1, depth), at: at,
            body: fillTalk(rp.b, d)
          });
        }
        out.push({ title: op.t, at: rows[i].at, posts: posts });
      }
      return out;
    }

    function lastVisit() {
      if (!SYNTH.alerts || typeof SYNTH.alerts.lastVisit !== 'function') { return 0; }
      try { return SYNTH.alerts.lastVisit(site.domain) || 0; } catch (e) { return 0; }
    }

    function agoText(ms) {
      var live = L();
      return (live && typeof live.ago === 'function') ? live.ago(ms) : '';
    }

    /* Wikipedia's "diff since your last visit", which is the affordance that
     * makes a watchlist worth having. */
    function sinceYouLooked(revs) {
      var since = lastVisit();
      if (!since || !revs.length) { return null; }
      var fresh = [];
      for (var i = 0; i < revs.length; i++) {
        if (revs[i].at > since) { fresh.push(revs[i]); }
      }
      if (!fresh.length) { return null; }
      var bots = 0;
      for (var j = 0; j < fresh.length; j++) { if (fresh[j].kind !== 'human') bots++; }
      return el('div', { class: 'wiki-sincebar' },
        el('strong', null, fresh.length === 1
          ? '1 edit since you last looked'
          : fresh.length + ' edits since you last looked'),
        el('span', { class: 'wiki-sincebots' },
          bots === fresh.length
            ? ' — all of them automated'
            : ' — ' + bots + ' automated'));
    }

    function historyFoot(art) {
      var revs = revisionsFor(art, 8);
      if (!revs.length) { return null; }
      var foot = el('div', { class: 'wiki-history' });
      foot.appendChild(el('div', { class: 'wiki-lastedit' },
        'This page was last edited by ',
        el('span', { class: 'wiki-editor wiki-editor-' + revs[0].kind }, revs[0].who),
        ' ',
        el('span', { class: 'wiki-editwhen', 'data-lv-ago': String(revs[0].at) },
          agoText(revs[0].at)),
        '. ',
        el('span', { class: 'wiki-editsummary' }, '(' + revs[0].summary + ')')));

      var list = el('ul', { class: 'wiki-revlist' });
      for (var i = 1; i < revs.length; i++) {
        list.appendChild(el('li', { class: 'wiki-rev wiki-rev-' + revs[i].kind },
          el('span', { class: 'wiki-revwhen', 'data-lv-ago': String(revs[i].at) },
            agoText(revs[i].at)),
          el('span', { class: 'wiki-revwho' }, revs[i].who),
          el('span', { class: 'wiki-revsummary' }, revs[i].summary)));
      }
      foot.appendChild(el('details', { class: 'wiki-revbox' },
        el('summary', null, 'View history'), list));
      foot.appendChild(el('p', { class: 'wiki-footlinks' },
        link('/history/' + encodeURIComponent(String(art.id)), 'Full revision history'),
        ' · ',
        link('/talk/' + encodeURIComponent(String(art.id)), 'Talk'),
        ' · ',
        link('/changes', 'Recent changes')));
      return foot;
    }

    function jumpTo(id) {
      return function () {
        var target = document.getElementById(id);
        if (target && target.scrollIntoView) { target.scrollIntoView(); }
      };
    }

    /* ---------- routes ---------- */

    if (path.length === 0) {
      ctx.title(siteName);
      var featured = articles.length ? articles[0] : null;
      var az = sortedByTitle();
      var groups = [], seen = {};
      for (var i = 0; i < az.length; i++) {
        var t = String(az[i].title || az[i].id || '?');
        var ch = t.charAt(0).toUpperCase();
        if (!/[A-Z]/.test(ch)) { ch = '#'; }
        if (!seen[ch]) { seen[ch] = { letter: ch, items: [] }; groups.push(seen[ch]); }
        seen[ch].items.push(az[i]);
      }
      groups.sort(function (a, b) {
        if (a.letter === '#') { return 1; }
        if (b.letter === '#') { return -1; }
        return a.letter < b.letter ? -1 : (a.letter > b.letter ? 1 : 0);
      });

      var indexNode = el('div', { class: 'wiki-index' });
      for (i = 0; i < groups.length; i++) {
        var ul = el('ul', { class: 'wiki-az-list' });
        for (var j = 0; j < groups[i].items.length; j++) {
          var it = groups[i].items[j];
          ul.appendChild(el('li', null,
            link('/wiki/' + encodeURIComponent(String(it.id)), String(it.title || it.id))));
        }
        indexNode.appendChild(el('div', { class: 'wiki-az-group' },
          el('h3', { class: 'wiki-az-letter' }, groups[i].letter), ul));
      }

      var catBar = null;
      if (categories.length) {
        catBar = el('div', { class: 'wiki-catbar' }, el('span', { class: 'wiki-catbar-label' }, 'Categories: '));
        for (i = 0; i < categories.length; i++) {
          if (i) { catBar.appendChild(document.createTextNode(' · ')); }
          catBar.appendChild(link('/category/' + encodeURIComponent(String(categories[i].id)),
            String(categories[i].name || categories[i].id), 'wiki-cat-link'));
        }
      }

      ctx.mount.appendChild(shell([
        el('h1', { class: 'wiki-title' }, siteName),
        el('p', { class: 'wiki-lead' },
          'Welcome to ' + siteName + ', which currently has ' + articles.length +
          (articles.length === 1 ? ' article.' : ' articles.')),
        featured ? el('div', { class: 'wiki-featured' },
          el('h2', { class: 'wiki-h2' }, 'Featured article'),
          el('h3', { class: 'wiki-featured-title' },
            link('/wiki/' + encodeURIComponent(String(featured.id)),
              String(featured.title || featured.id))),
          el('div', { class: 'wiki-featured-body' }, markup(String(featured.summary || ''))),
          el('p', { class: 'wiki-readmore' },
            link('/wiki/' + encodeURIComponent(String(featured.id)), 'Read the full article →'))) : null,
        catBar,
        LIVING ? el('p', { class: 'wiki-rclink' },
          link('/changes', 'Recent changes'),
          ' — what has been edited, and by what.') : null,
        el('h2', { class: 'wiki-h2' }, 'All articles, A–Z'),
        articles.length ? indexNode : el('p', { class: 'wiki-empty' }, 'No articles yet.')
      ]));
      return;
    }

    if (path[0] === 'wiki' && path.length >= 2) {
      var art = articleById(String(path[1]));
      if (!art) { notFound('No article is filed under "' + String(path[1]) + '".'); return; }
      ctx.title(String(art.title || art.id) + ' - ' + siteName);

      var sections = Array.isArray(art.sections) ? art.sections : [];
      var idBase = 'wiki-sec-' + slug(art.id) + '-';
      var kids = [];

      kids.push(el('h1', { class: 'wiki-title' }, String(art.title || art.id)));

      var revs = revisionsFor(art, 14);
      var head = revs.length ? revs[0] : null;
      var lock = protectedNow(revs);

      var sinceBar = sinceYouLooked(revs);
      if (sinceBar) { kids.push(sinceBar); }

      if (lock) {
        kids.push(el('div', { class: 'wiki-protbar' },
          el('strong', null, 'This page is protected.'),
          ' Editing is limited to established accounts until ',
          new Date(lock.until).toISOString().slice(0, 10),
          ' after repeated reverts.'));
      }

      /* The article as it stands RIGHT NOW, which on a bad week is wrong.
       * Nothing says so on the page; the history says so, and the reader
       * can go and look, which is the whole mechanic. */
      if (head && head.dispute && head.wrongAfter) {
        kids.push(el('div', { class: 'wiki-disputebar' },
          'The ' + head.dispute.k + ' given below was changed by an ',
          'automated editor ',
          el('span', { 'data-lv-ago': String(head.at) }, agoText(head.at)),
          '. ',
          link('/history/' + encodeURIComponent(String(art.id)),
            'See the history.')));
      }

      var box = infoboxTable(art.infobox, head);
      if (box) { kids.push(box); }

      /* The lead as it stands: the disputed number as the last editor left
       * it, plus whatever maintenance tags are currently on the page. The
       * sections get the number too -- a bot editing an article edits the
       * article, not only its first paragraph -- but not the tags, which
       * sit at the top where a reader will see them. */
      var leadNow = String(art.summary || '');
      if (LIVING && head) {
        leadNow = swapIn(leadNow, head);
        if (head.citedAfter) {
          leadNow = tagFirstSentence(leadNow, '{{citation needed}}');
        }
        if (head.deadAfter) { leadNow = leadNow.replace(/\s*$/, ' {{dead link}}'); }
        if (head.dispute && head.wrongAfter) {
          leadNow = '{{NPOV disputed}} ' + leadNow;
        }
      }
      kids.push(el('div', { class: 'wiki-lead' }, markup(leadNow)));

      if (sections.length) {
        var toc = el('ol', { class: 'wiki-toc-list' });
        for (var s = 0; s < sections.length; s++) {
          var secId = idBase + s;
          var a = el('a', {
            class: 'wiki-toc-link',
            tabindex: '0',
            onclick: jumpTo(secId)
          }, el('span', { class: 'wiki-toc-num' }, (s + 1) + ' '),
             el('span', { class: 'wiki-toc-text' }, String(sections[s].heading || 'Section ' + (s + 1))));
          toc.appendChild(el('li', null, a));
        }
        kids.push(el('div', { class: 'wiki-toc' },
          el('div', { class: 'wiki-toc-title' }, 'Contents'), toc));
      }

      for (var k = 0; k < sections.length; k++) {
        kids.push(el('div', { class: 'wiki-section' },
          el('h2', { class: 'wiki-h2', id: idBase + k }, String(sections[k].heading || 'Section ' + (k + 1))),
          el('div', { class: 'wiki-section-body' },
            markup(LIVING ? swapIn(String(sections[k].body || ''), head)
                          : String(sections[k].body || '')))));
      }

      var seeAlso = Array.isArray(art.seeAlso) ? art.seeAlso : [];
      if (seeAlso.length) {
        var sul = el('ul', { class: 'wiki-seealso-list' });
        for (var q = 0; q < seeAlso.length; q++) {
          var sa = seeAlso[q] || {};
          sul.appendChild(el('li', null,
            link('/wiki/' + encodeURIComponent(String(sa.id)), String(sa.label || sa.id))));
        }
        kids.push(el('div', { class: 'wiki-seealso' },
          el('h2', { class: 'wiki-h2' }, 'See also'), sul));
      }

      var cats = Array.isArray(art.categories) ? art.categories : [];
      var bar = el('div', { class: 'wiki-catbar' },
        el('span', { class: 'wiki-catbar-label' }, cats.length ? 'Categories: ' : 'Categories: '));
      if (cats.length) {
        for (var c = 0; c < cats.length; c++) {
          if (c) { bar.appendChild(document.createTextNode(' | ')); }
          bar.appendChild(link('/category/' + encodeURIComponent(String(cats[c])),
            catName(cats[c]), 'wiki-cat-link'));
        }
      } else {
        bar.appendChild(el('span', { class: 'wiki-uncat' }, 'Uncategorised'));
      }
      kids.push(bar);

      /* Wikipedia puts "last edited on..." at the foot, and so does this. */
      var hist = historyFoot(art);
      if (hist) { kids.push(hist); }

      ctx.mount.appendChild(shell(kids));
      return;
    }

    if (path[0] === 'category' && path.length >= 2) {
      var cid = String(path[1]);
      var name = catName(cid);
      var list = articlesInCategory(cid);
      ctx.title('Category: ' + name + ' - ' + siteName);

      var cul = el('ul', { class: 'wiki-cat-list' });
      for (var m = 0; m < list.length; m++) {
        cul.appendChild(el('li', null,
          link('/wiki/' + encodeURIComponent(String(list[m].id)), String(list[m].title || list[m].id)),
          list[m].summary ? el('span', { class: 'wiki-cat-blurb' },
            ' — ' + String(list[m].summary).replace(/\[[^\]]*\]/g, '').slice(0, 110)) : null));
      }

      ctx.mount.appendChild(shell([
        el('h1', { class: 'wiki-title' }, 'Category: ' + name),
        el('p', { class: 'wiki-lead' },
          'This category contains ' + list.length +
          (list.length === 1 ? ' article.' : ' articles.')),
        list.length ? cul : el('p', { class: 'wiki-empty' }, 'There are no articles in this category.'),
        el('p', { class: 'wiki-backlink' }, link('/', '← Main page'))
      ]));
      return;
    }

    if (path[0] === 'history' && path.length >= 2) {
      var hart = articleById(String(path[1]));
      if (!hart) { notFound('No article is filed under "' + String(path[1]) + '".'); return; }
      ctx.title('Revision history: ' + String(hart.title || hart.id));

      var hist = historyFor(hart, 24);
      var hlock = protectedNow(hist);
      var hkids = [
        el('h1', { class: 'wiki-title' },
          'Revision history: ' + String(hart.title || hart.id)),
        el('p', { class: 'wiki-lead' },
          hist.length + (hist.length === 1 ? ' revision' : ' revisions') +
          ', newest first. Select a revision to see what changed.')
      ];
      if (hlock) {
        hkids.push(el('div', { class: 'wiki-protbar' },
          el('strong', null, 'Protected.'),
          ' Until ' + new Date(hlock.until).toISOString().slice(0, 10) + '.'));
      }

      var htab = el('ul', { class: 'wiki-histlist' });
      for (var hi = 0; hi < hist.length; hi++) {
        var hv = hist[hi];
        htab.appendChild(el('li', {
          class: 'wiki-histrow wiki-histrow-' + hv.kind +
                 (hv.action === 'rv' ? ' wiki-histrow-rv' : '') +
                 (hv.action === 'protect' ? ' wiki-histrow-prot' : '')
        },
          el('span', { class: 'wiki-histwhen', 'data-lv-ago': String(hv.at) },
            agoText(hv.at)),
          hi + 1 < hist.length
            ? link('/diff/' + encodeURIComponent(String(hart.id)) + '/' + hv.rev,
                   'diff', 'wiki-difflink')
            : el('span', { class: 'wiki-difflink wiki-difflink-flat' }, 'diff'),
          el('span', { class: 'wiki-histrev' }, 'r' + hv.rev),
          el('span', { class: 'wiki-histwho wiki-editor-' + hv.kind }, hv.who),
          el('span', { class: 'wiki-histsummary' }, '(' + hv.summary + ')')));
      }
      ctx.mount.appendChild(shell(hkids.concat([
        hist.length ? htab : el('p', { class: 'wiki-empty' }, 'No revisions.'),
        el('p', { class: 'wiki-backlink' },
          link('/wiki/' + encodeURIComponent(String(hart.id)), '← Back to the article'),
          ' · ',
          link('/talk/' + encodeURIComponent(String(hart.id)), 'Talk'))
      ])));
      return;
    }

    if (path[0] === 'diff' && path.length >= 3) {
      var dart = articleById(String(path[1]));
      if (!dart) { notFound('No article is filed under "' + String(path[1]) + '".'); return; }
      var want = parseInt(path[2], 10);
      var dhist = historyFor(dart, 24), di = -1, dk;
      for (dk = 0; dk < dhist.length; dk++) {
        if (dhist[dk].rev === want) { di = dk; break; }
      }
      if (di === -1 || di + 1 >= dhist.length) {
        notFound('Revision r' + String(path[2]) + ' is not in the history held for this page.');
        return;
      }
      var cur = dhist[di], prev = dhist[di + 1];
      ctx.title('Difference between revisions: ' + String(dart.title || dart.id));

      var before = textAt(dart, prev), after = textAt(dart, cur);
      var parts = diffWords(before, after);
      var dnode = el('div', { class: 'wiki-diffbody' });
      var same = true;
      for (var dp = 0; dp < parts.length; dp++) {
        var pc = parts[dp];
        if (pc.op === '=') { dnode.appendChild(document.createTextNode(pc.v)); continue; }
        same = false;
        dnode.appendChild(el(pc.op === '-' ? 'del' : 'ins',
          { class: pc.op === '-' ? 'wiki-del' : 'wiki-ins' }, pc.v));
      }
      if (same) {
        dnode.appendChild(el('span', { class: 'wiki-diffsame' },
          ' (no change to the text of the lead)'));
      }

      ctx.mount.appendChild(shell([
        el('h1', { class: 'wiki-title' },
          'Difference between revisions'),
        el('p', { class: 'wiki-lead' }, String(dart.title || dart.id) +
          (cur.dispute && cur.dispute.where
            ? ' — ' + cur.dispute.where : ' — lead')),
        el('div', { class: 'wiki-diffheads' },
          el('div', { class: 'wiki-diffhead' },
            el('strong', null, 'r' + prev.rev), ' ',
            el('span', { class: 'wiki-editor-' + prev.kind }, prev.who), ' — ',
            prev.summary),
          el('div', { class: 'wiki-diffhead' },
            el('strong', null, 'r' + cur.rev), ' ',
            el('span', { class: 'wiki-editor-' + cur.kind }, cur.who), ' — ',
            cur.summary)),
        dnode,
        el('p', { class: 'wiki-backlink' },
          link('/history/' + encodeURIComponent(String(dart.id)), '← Revision history'),
          ' · ',
          link('/wiki/' + encodeURIComponent(String(dart.id)), 'Article'))
      ]));
      return;
    }

    if (path[0] === 'talk' && path.length >= 2) {
      var tart = articleById(String(path[1]));
      if (!tart) { notFound('No article is filed under "' + String(path[1]) + '".'); return; }
      ctx.title('Talk: ' + String(tart.title || tart.id));

      var threads = talkFor(tart, 4);
      var tkids = [
        el('h1', { class: 'wiki-title' }, 'Talk: ' + String(tart.title || tart.id)),
        el('p', { class: 'wiki-lead' },
          'This is the discussion page. It is not the article.')
      ];
      for (var ti = 0; ti < threads.length; ti++) {
        var th = threads[ti];
        var tnode = el('div', { class: 'wiki-talkthread' },
          el('h2', { class: 'wiki-h2' }, th.title));
        for (var tp = 0; tp < th.posts.length; tp++) {
          var po = th.posts[tp];
          tnode.appendChild(el('div', {
            class: 'wiki-talkpost wiki-talkdepth-' + po.depth +
                   ' wiki-editor-' + po.kind
          }, markup(String(po.body).replace(/~~~~/g, signature(po.who, po.at)))));
        }
        tkids.push(tnode);
      }
      if (!threads.length) {
        tkids.push(el('p', { class: 'wiki-empty' }, 'Nobody has said anything here.'));
      }
      tkids.push(el('p', { class: 'wiki-backlink' },
        link('/wiki/' + encodeURIComponent(String(tart.id)), '← Back to the article'),
        ' · ',
        link('/history/' + encodeURIComponent(String(tart.id)), 'History')));
      ctx.mount.appendChild(shell(tkids));
      return;
    }

    if (path[0] === 'changes') {
      ctx.title('Recent changes - ' + siteName);
      /* Per-article streams are keyed separately, which is right -- they are
       * independent -- and it means the only place the wiki looks like one
       * moving thing is here, once they are merged. */
      var all = [], ci, cj;
      for (ci = 0; ci < articles.length; ci++) {
        var ch = historyFor(articles[ci], 6);
        for (cj = 0; cj < ch.length; cj++) {
          ch[cj].art = articles[ci];
          all.push(ch[cj]);
        }
      }
      all.sort(function (a, b) { return b.at - a.at; });
      all = all.slice(0, 60);

      var bots = 0;
      for (ci = 0; ci < all.length; ci++) { if (all[ci].kind !== 'human') bots++; }

      var clist = el('ul', { class: 'wiki-rclist' });
      for (ci = 0; ci < all.length; ci++) {
        var cv = all[ci];
        clist.appendChild(el('li', {
          class: 'wiki-rcrow wiki-rcrow-' + cv.kind +
                 (cv.action === 'rv' ? ' wiki-histrow-rv' : '')
        },
          el('span', { class: 'wiki-rcwhen', 'data-lv-ago': String(cv.at) },
            agoText(cv.at)),
          link('/wiki/' + encodeURIComponent(String(cv.art.id)),
            String(cv.art.title || cv.art.id), 'wiki-rctitle'),
          link('/diff/' + encodeURIComponent(String(cv.art.id)) + '/' + cv.rev,
            'diff', 'wiki-difflink'),
          el('span', { class: 'wiki-rcwho wiki-editor-' + cv.kind }, cv.who),
          el('span', { class: 'wiki-rcsummary' }, '(' + cv.summary + ')')));
      }

      ctx.mount.appendChild(shell([
        el('h1', { class: 'wiki-title' }, 'Recent changes'),
        el('p', { class: 'wiki-lead' },
          all.length + ' changes across ' + articles.length + ' articles. ' +
          bots + ' of them were not made by a person.'),
        all.length ? clist : el('p', { class: 'wiki-empty' }, 'Nothing has changed.'),
        el('p', { class: 'wiki-backlink' }, link('/', '← Main page'))
      ]));
      return;
    }

    notFound('The address "/' + path.join('/') + '" is not a page on this wiki.');
  });
})();
