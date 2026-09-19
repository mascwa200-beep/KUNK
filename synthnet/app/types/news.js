/* SYNTHNET - news renderer.
   Paths:  /                   front page
           /section/<id>       section index
           /article/<id>       one story
   Classic script, no modules. */
(function () {
  'use strict';

  var SYNTH = (window.SYNTH = window.SYNTH || {});

  function hash(str) {
    var h = 2166136261, s = String(str == null ? '' : str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function yearOf(text) {
    var m = String(text == null ? '' : text).match(/(19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : 0;
  }

  SYNTH.render.register('news', function (ctx) {
    var el = ctx.el, link = ctx.link, markup = ctx.markup;
    var site = ctx.site || {};
    var data = site.data || {};
    var sections = Array.isArray(data.sections) ? data.sections : [];
    var articles = Array.isArray(data.articles) ? data.articles : [];
    var path = ctx.path || [];

    function sectionName(id) {
      for (var i = 0; i < sections.length; i++) {
        if (String(sections[i].id) === String(id)) { return String(sections[i].name || sections[i].id); }
      }
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

    function href(a) { return '/article/' + encodeURIComponent(String(a.id)); }

    /* A dateline that is fixed for this paper, not for today. */
    function dateline() {
      var latest = '';
      for (var i = 0; i < articles.length; i++) {
        var d = String(articles[i].date || '');
        if (d && d > latest) { latest = d; }
      }
      if (!latest) { latest = String(site.era || ''); }
      var yr = yearOf(latest) || yearOf(site.era) || 2004;
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
      return bar;
    }

    function masthead() {
      return el('div', { class: 'news-masthead' },
        el('h1', { class: 'news-name' },
          link('/', String(data.masthead || site.title || 'The Daily'), 'news-name-link')),
        el('p', { class: 'news-slogan' }, String(data.slogan || site.description || '')),
        el('p', { class: 'news-dateline' }, dateline()));
    }

    function byline(a) {
      var parts = [];
      if (a.byline) { parts.push('By ' + String(a.byline)); }
      if (a.date) { parts.push(String(a.date)); }
      var sec = sectionName(a.sectionId);
      if (sec) { parts.push(sec); }
      return el('p', { class: 'news-byline' }, parts.join('  ·  '));
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
            String(site.era || 'the recent past'),
            '. Reproduction without permission is discouraged, loudly.')));
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

      ctx.mount.appendChild(shell([
        el('div', { class: 'news-lead' },
          el('h2', { class: 'news-lead-head' },
            link(href(lead), String(lead.headline || 'Untitled'))),
          lead.dek ? el('p', { class: 'news-lead-dek' }, String(lead.dek)) : null,
          byline(lead),
          el('div', { class: 'news-lead-text' }, markup(String(lead.lead || lead.body || ''))),
          el('p', { class: 'news-more' },
            link(href(lead), 'Continue reading »', 'news-more-link'))),
        ordered.length ? el('h4', { class: 'news-rule-head' }, 'Also in this edition') : null,
        grid
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
          el('h3', { class: 'news-list-head' }, link(href(a), String(a.headline || 'Untitled'))),
          a.dek ? el('p', { class: 'news-list-dek' }, String(a.dek)) : null,
          byline(a)));
      }
      ctx.mount.appendChild(shell([
        el('h2', { class: 'news-section-title' }, name),
        el('p', { class: 'news-section-count' },
          list.length + (list.length === 1 ? ' story' : ' stories') + ' filed.'),
        list.length ? ul : el('p', { class: 'news-empty' }, 'Nothing in this section.')
      ], sid));
      return;
    }

    if (path[0] === 'article' && path.length >= 2) {
      var art = byId(String(path[1]));
      if (!art) { notFound('No story with the id "' + String(path[1]) + '".', null); return; }
      ctx.title(String(art.headline || 'Story') + ' - ' + (data.masthead || site.title || 'News'));

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
          el('h2', { class: 'news-headline' }, String(art.headline || 'Untitled')),
          art.dek ? el('p', { class: 'news-dek' }, String(art.dek)) : null,
          byline(art),
          el('div', { class: 'news-text' },
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

    notFound('The address "/' + path.join('/') + '" is not part of this paper.', null);
  });
})();
