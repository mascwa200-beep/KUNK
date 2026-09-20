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

    function infoboxTable(box) {
      if (!box || !Array.isArray(box.rows) || !box.rows.length) { return null; }
      var table = el('table', { class: 'wiki-infobox' });
      if (box.caption) {
        table.appendChild(el('caption', { class: 'wiki-infobox-caption' }, String(box.caption)));
      }
      var tbody = el('tbody', null);
      for (var i = 0; i < box.rows.length; i++) {
        var row = box.rows[i];
        if (!Array.isArray(row)) { continue; }
        tbody.appendChild(el('tr', null,
          el('th', { class: 'wiki-infobox-label', scope: 'row' }, String(row[0] == null ? '' : row[0])),
          el('td', { class: 'wiki-infobox-value' }, String(row[1] == null ? '' : row[1]))));
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

    /* Revisions for one article, newest first. Pure function of the clock. */
    function revisionsFor(art, count) {
      var live = L();
      if (!live || typeof live.stream !== 'function') { return []; }
      var rows = live.stream('wiki:' + site.domain + ':' + art.id,
                             EDITORS, EDIT_INTERVAL_MIN, count || 8);
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var ed = rows[i].item || EDITORS[0];
        var summaries = ed.kind === 'human' ? HUMAN_SUMMARIES : BOT_SUMMARIES;
        out.push({
          at: rows[i].at,
          who: ed.who,
          kind: ed.kind,
          summary: summaries[live.hash32(rows[i].seed + ':s') % summaries.length]
        });
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

      var revs = revisionsFor(art, 8);
      var sinceBar = sinceYouLooked(revs);
      if (sinceBar) { kids.push(sinceBar); }

      var box = infoboxTable(art.infobox);
      if (box) { kids.push(box); }

      kids.push(el('div', { class: 'wiki-lead' }, markup(String(art.summary || ''))));

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
          el('div', { class: 'wiki-section-body' }, markup(String(sections[k].body || '')))));
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

    notFound('The address "/' + path.join('/') + '" is not a page on this wiki.');
  });
})();
