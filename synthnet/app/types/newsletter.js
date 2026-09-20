/* synthnet :: newsletter renderer
 * An email newsletter, read on the web. Skin: skin-inbox-letter.
 *
 * The form this is imitating is an *email*, so the page carries the furniture
 * an email carries and a web page does not: the view-in-browser line at the
 * very top, the subscriber count in the letterhead, the sponsor block, the
 * forward-this line, and the unsubscribe footer. The unsubscribe footer is
 * added here rather than written into the content, because every issue has
 * one and an author who typed it out per issue would eventually vary it.
 *
 * Classic script, ES5-safe. No innerHTML with data. No absolute URLs.
 */
window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var el = null;

  var HOUR_MS = 3600000;

  function has(ns) { return !!(window.SYNTH && window.SYNTH[ns]); }

  function text(t) { return document.createTextNode(String(t == null ? '' : t)); }

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
    return 'recently';
  }

  function commas(n) {
    if (has('live') && SYNTH.live.commas) {
      try { return SYNTH.live.commas(n); } catch (e) { /* fall */ }
    }
    return String(n);
  }

  function counterValue(key, base, perDay) {
    if (has('live') && SYNTH.live.counter) {
      try { return SYNTH.live.counter(key, base, perDay); } catch (e) { /* fall */ }
    }
    return base;
  }

  function liveBadge(kind) {
    if (!kind || !has('liveui') || !SYNTH.liveui.badge) { return null; }
    try { return SYNTH.liveui.badge(kind); } catch (e) { return null; }
  }

  function stripMarkup(s) {
    if (has('markup') && SYNTH.markup.strip) {
      try { return SYNTH.markup.strip(s || ''); } catch (e) { /* fall */ }
    }
    return String(s == null ? '' : s);
  }

  /* hash32 returns a uint32. Everything downstream uses % on it directly --
   * a signed >> here would go negative and index off the end of the array. */
  function hashOf(seed) {
    if (has('live') && SYNTH.live.hash32) {
      try { return SYNTH.live.hash32(String(seed)); } catch (e) { /* fall */ }
    }
    var h = 2166136261, i, s = String(seed);
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pickBy(arr, seed) {
    if (!arr || !arr.length) { return null; }
    return arr[hashOf(seed) % arr.length];
  }

  function poolByName(name) {
    if (has('live') && SYNTH.live.pool) {
      try { return SYNTH.live.pool(name) || []; } catch (e) { /* fall */ }
    }
    if (has('slop') && SYNTH.slop[name]) { return SYNTH.slop[name]; }
    return [];
  }

  /* stream() hands back WRAPPERS -- {slot, at, item, seed} -- and the content
   * is row.item. The fallback below builds the same wrapper shape so callers
   * never have to know which path they got. */
  function streamed(key, poolName, intervalMin, count) {
    if (has('live') && SYNTH.live.stream) {
      try {
        var rows = SYNTH.live.stream(key, poolName, intervalMin, count);
        if (rows && rows.length) { return rows; }
      } catch (e) { /* fall */ }
    }
    var p = poolByName(poolName);
    var out = [];
    var want = Math.min(count || 3, p.length);
    var i;
    for (i = 0; i < want; i++) {
      out.push({ slot: i, at: null, item: p[i], seed: hashOf(key + ':' + i) });
    }
    return out;
  }

  /* One line, stripped and cut. Shared via live.js, because every renderer
   * that rolled its own reached for `body` before `headline` and printed a
   * whole article where a title goes. */
  function titleOf(item, fallback) {
    if (SYNTH.live && typeof SYNTH.live.titleOf === 'function') {
      return SYNTH.live.titleOf(item, fallback);
    }
    if (typeof item === 'string') { return item; }
    return (item && (item.title || item.headline || item.body)) || fallback || '';
  }

  function strOf(v, fallback) {
    if (typeof v === 'string') { return v; }
    if (v && typeof v === 'object') {
      return v.headline || v.title || v.body || v.text || fallback || '';
    }
    return fallback || '';
  }

  function byId(arr, id) {
    var i;
    for (i = 0; i < (arr || []).length; i++) {
      if (arr[i] && String(arr[i].id) === String(id)) { return arr[i]; }
    }
    return null;
  }

  function numOf(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : -1;
  }

  /* ---------- reading the data ---------- */

  function issuesNewestFirst(d) {
    var rows = (d.issues || []).slice();
    rows.sort(function (a, b) {
      var an = numOf(a && a.number), bn = numOf(b && b.number);
      if (an !== bn) { return bn - an; }
      /* No numbers, or a tie: fall back to the printed date, which is free
       * text but usually something Date.parse can read. */
      var ad = Date.parse((a && a.date) || ''), bd = Date.parse((b && b.date) || '');
      if (isFinite(ad) && isFinite(bd) && ad !== bd) { return bd - ad; }
      return 0;
    });
    return rows;
  }

  /* The archive list shows the first sentence of the intro, which is how you
   * remember which issue was which. Abbreviations ("Verity Co.", initials)
   * would chop it after four words, so a sentence has to earn its ending by
   * being long enough to be one. */
  function firstSentence(raw) {
    var s = stripMarkup(raw).replace(/\s+/g, ' ');
    s = s.replace(/^\s+/, '').replace(/\s+$/, '');
    if (!s) { return ''; }
    var re = /[.!?]["')\]]?(?=\s|$)/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var end = m.index + m[0].length;
      if (end >= 40) { return s.slice(0, end); }
    }
    if (s.length > 170) { return s.slice(0, 167) + '…'; }
    return s;
  }

  /* Small numbers, moving slowly: this is a county newsletter, not a
   * platform. The growth rate is derived from the base so a 300-subscriber
   * letter creeps and a 9,000-subscriber one creeps proportionally. */
  function subsPerDay(base) {
    var v = base > 0 ? base / 450 : 0.5;
    if (v < 0.25) { v = 0.25; }
    return Math.round(v * 100) / 100;
  }

  function subscriberCount(ctx, d) {
    var base = numOf(d.subscribers);
    if (base < 0) { base = 312; }
    var key = 'nl:' + ctx.site.domain + ':subs';
    var perDay = subsPerDay(base);
    var value = counterValue(key, base, perDay);
    /* app/tick.js repaints this in place off the attribute; without it the
     * number is computed once at paint and then sits there. */
    return el('span', {
      'class': 'nl-subs-n',
      'data-lv-counter': key + '|' + base + '|' + perDay
    }, text(commas(value)));
  }

  /* The newest issue went out at the top of an hour, three hours back, so two
   * renders inside the same hour agree with each other and the line still
   * ages while you read. */
  function sentAt() {
    var t = nowMs();
    return t - (t % HOUR_MS) - 3 * HOUR_MS;
  }

  function sentLine() {
    var ms = sentAt();
    return el('span', { 'class': 'nl-sent' },
      text('sent '),
      el('span', { 'data-lv-ago': String(ms) }, text(agoText(ms))));
  }

  /* ---------- chrome ---------- */

  function inert(label, why) {
    return el('span', { 'class': 'nl-inert', title: why || '' }, text(label));
  }

  function viewInBrowser() {
    return el('p', { 'class': 'nl-vib' },
      text('Email not displaying correctly? '),
      inert('View in browser', 'You are in the browser. This is the archive copy.'),
      text('.'));
  }

  function masthead(ctx, d) {
    var head = el('header', { 'class': 'nl-mast' });
    head.appendChild(ctx.link('/', d.title || ctx.site.title, 'nl-wordmark'));

    var who = d.author ? ('by ' + d.author) : '';
    if (who) { head.appendChild(el('div', { 'class': 'nl-mast-by' }, text(who))); }

    var stats = el('div', { 'class': 'nl-subs' });
    stats.appendChild(subscriberCount(ctx, d));
    stats.appendChild(text(' subscribers'));
    if (d.cadence) {
      stats.appendChild(el('span', { 'class': 'nl-sep' }, text(' · ')));
      stats.appendChild(text(String(d.cadence)));
    }
    head.appendChild(stats);
    return head;
  }

  function sponsorLabel(d) {
    return d.sponsorLabel ? String(d.sponsorLabel) : 'Together with';
  }

  /* ---------- the subscribe box ---------- */

  function subscribeBox(ctx, d) {
    /* Three tries, three answers, and then it stops explaining itself. The
     * form is dead for the boring reason forms are usually dead. */
    var replies = [
      'That went nowhere. The signup has been wired to nothing since the ' +
        'provider changed its embed in 2023. The button is still here because ' +
        'taking it out means editing the template.',
      'Still nothing. There is no list at this end. The list is a spreadsheet, ' +
        'and the spreadsheet is on a laptop in Gridfall.',
      'Third time, same result. Whatever you typed is in the box and nowhere ' +
        'else, and it will not be there after you navigate away.'
    ];
    var tries = 0;

    var input = el('input', {
      type: 'text',
      'class': 'nl-sub-in',
      name: 'email',
      autocomplete: 'off',
      placeholder: 'your email',
      'aria-label': 'Email address'
    });

    var note = el('p', {
      'class': 'nl-sub-note',
      role: 'status',
      'aria-live': 'polite'
    });

    var form = el('form', {
      'class': 'nl-sub',
      onsubmit: function (ev) {
        if (ev && ev.preventDefault) { ev.preventDefault(); }
        tries++;
        var msg = replies[Math.min(tries, replies.length) - 1];
        while (note.firstChild) { note.removeChild(note.firstChild); }
        note.appendChild(text(msg));
        return false;
      }
    });

    /* Not a <label>: the field carries its own aria-label, and a label with
     * nothing to point at is worse for a screen reader than a plain line. */
    form.appendChild(el('p', { 'class': 'nl-sub-label' },
      text((d.cadence ? (String(d.cadence) + '. ') : '') +
           'One letter at a time, and nothing else ever.')));

    var row = el('div', { 'class': 'nl-sub-row' });
    row.appendChild(input);
    row.appendChild(el('button', { type: 'submit', 'class': 'nl-sub-go' },
      text('Subscribe')));
    form.appendChild(row);
    form.appendChild(note);
    return form;
  }

  /* ---------- issue pieces ---------- */

  var ARROW_LABELS = [
    'Read the rest',
    'Keep going',
    'The whole thing',
    'More of this, if you want it',
    'The full piece'
  ];

  function card(ctx, item, seed) {
    var node = el('article', { 'class': 'nl-card' });
    node.appendChild(el('h3', { 'class': 'nl-card-h' },
      text(item.headline || 'Untitled')));

    if (item.blurb) {
      node.appendChild(el('div', { 'class': 'nl-card-b' }, ctx.markup(item.blurb)));
    }

    var label = pickBy(ARROW_LABELS, seed + ':' + (item.headline || '')) ||
      ARROW_LABELS[0];
    if (item.href) {
      node.appendChild(el('p', { 'class': 'nl-card-go' },
        ctx.link(item.href, label + ' →', 'nl-arrow')));
    } else {
      /* An item with nowhere to point is not a bug in the data. Half the
       * things in a local letter were a phone call or a piece of paper. */
      node.appendChild(el('p', { 'class': 'nl-card-go' },
        inert('No link on this one →',
          'There was never a link. Somebody told him in person.')));
    }
    return node;
  }

  function sponsorBlock(ctx, d, issue) {
    var sp = issue.sponsor;
    if (!sp || typeof sp !== 'object' || !sp.name) { return null; }

    var box = el('aside', { 'class': 'nl-sponsor' });
    var tag = el('div', { 'class': 'nl-sponsor-tag' },
      text(sponsorLabel(d) + ' '),
      el('strong', { 'class': 'nl-sponsor-name' }, text(String(sp.name))));
    var badge = liveBadge('sponsored');
    if (badge) { tag.appendChild(badge); }
    box.appendChild(tag);

    if (sp.copy) {
      box.appendChild(el('div', { 'class': 'nl-sponsor-copy' }, ctx.markup(sp.copy)));
    }
    box.appendChild(el('p', { 'class': 'nl-sponsor-foot' },
      text('Paid placement. It covers the hosting and about a third of the ' +
           'time this takes.')));
    return box;
  }

  function sectionBlock(ctx, section, si) {
    var node = el('section', { 'class': 'nl-section' });
    node.appendChild(el('h2', { 'class': 'nl-section-h' },
      text(section.name || 'Elsewhere')));
    var items = section.items || [];
    var i;
    for (i = 0; i < items.length; i++) {
      if (!items[i] || typeof items[i] !== 'object') { continue; }
      node.appendChild(card(ctx, items[i], 'nl:' + si + ':' + i));
    }
    if (!items.length) {
      node.appendChild(el('p', { 'class': 'nl-empty' },
        text('Nothing made it into this one.')));
    }
    return node;
  }

  function signoffBlock(ctx, d, issue) {
    var box = el('div', { 'class': 'nl-signoff' });
    if (issue.signoff) {
      box.appendChild(ctx.markup(issue.signoff));
    } else {
      box.appendChild(el('p', null, text('— ' + (d.author || 'the desk'))));
    }
    box.appendChild(el('p', { 'class': 'nl-forward' },
      text('Forward this to a friend. That is the entire marketing plan and ' +
           'it has worked, by my count, twice.')));
    return box;
  }

  /* Every issue ends with one of these and the content never writes it. */
  function unsubscribeBlock(ctx, d) {
    var foot = el('footer', { 'class': 'nl-unsub' });
    foot.appendChild(el('p', { 'class': 'nl-unsub-why' },
      text('You are getting this because you subscribed, or because you were ' +
           'on a list that got imported, or because somebody forwarded it and ' +
           'you replied to the forward.')));

    var row = el('p', { 'class': 'nl-unsub-row' });
    row.appendChild(inert('Unsubscribe',
      'Unsubscribes are handled by the provider. The provider changed in 2023.'));
    row.appendChild(text(' · '));
    row.appendChild(inert('Update your preferences',
      'There are no preferences. There is one letter and it goes to everybody.'));
    row.appendChild(text(' · '));
    row.appendChild(inert('View in browser', 'Already done.'));
    foot.appendChild(row);

    foot.appendChild(el('p', { 'class': 'nl-unsub-addr' },
      text((d.title || ctx.site.title) + ' · Verity County · ' +
           'no physical address given, which is technically a problem and has ' +
           'never once come up.')));
    return foot;
  }

  /* Archive chrome, not part of the letter: three feeds rewrite each issue
   * inside the hour and one of them credits it. */
  function echoBlock(ctx, d, issue) {
    var sources = ['gridline_digest', 'AutoLocal_Feed', 'CountyWatch_AI', 'VerityPulseAI'];
    var rows = streamed('nl:' + ctx.site.domain + ':echo:' + issue.id,
      'newsItems', 47, 3);
    if (!rows.length) { return null; }

    var box = el('div', { 'class': 'nl-echo' });
    box.appendChild(el('h2', { 'class': 'nl-echo-h' }, text('Picked up elsewhere')));
    box.appendChild(el('p', { 'class': 'nl-echo-note' },
      text('Not part of the letter. The archive bolts it on: the feeds that ' +
           'scrape this publish inside the hour, and what comes out is only ' +
           'sometimes about the same thing.')));

    /* Rotate through the handles rather than hashing each row independently,
     * which kept dealing the same one three times. Three different feeds
     * carrying it is the shape of the thing; one feed carrying it three times
     * is a different and less true joke. */
    var turn = hashOf('nl:echo:' + ctx.site.domain + ':' + issue.id) % sources.length;

    var ul = el('ul', { 'class': 'nl-echo-list' });
    var i;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var item = row.item;
      var who = sources[(turn + i) % sources.length];
      var li = el('li', { 'class': 'nl-echo-row' });

      var head = el('div', { 'class': 'nl-echo-head' },
        text(titleOf(item, 'Verity County Residents React To Local Development')));
      li.appendChild(head);

      var meta = el('div', { 'class': 'nl-echo-meta' });
      meta.appendChild(el('span', { 'class': 'nl-echo-src' }, text(who)));
      var badge = liveBadge('bot');
      if (badge) { meta.appendChild(badge); }
      if (row.at) {
        meta.appendChild(text(' '));
        meta.appendChild(el('span', { 'data-lv-ago': String(row.at) },
          text(agoText(row.at))));
      }
      /* One of the four credits the source. The other three do not, which is
       * the arrangement and nobody has asked for it to change. */
      meta.appendChild(text(who === 'gridline_digest'
        ? ' · credits the letter'
        : ' · no credit'));
      li.appendChild(meta);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    return box;
  }

  /* ---------- pages ---------- */

  function shell(ctx, kids) {
    var page = el('div', { 'class': 'nl-page' });
    page.appendChild(el('div', { 'class': 'nl-sheet' }, kids));
    ctx.mount.appendChild(page);
  }

  function gapNote(rows) {
    var lowest = null, i, n;
    for (i = 0; i < rows.length; i++) {
      n = numOf(rows[i] && rows[i].number);
      if (n > 0 && (lowest === null || n < lowest)) { lowest = n; }
    }
    if (lowest === null || lowest <= 1) { return null; }
    return el('p', { 'class': 'nl-gap' },
      text('Issues 1–' + (lowest - 1) + ' were on the old provider. The ' +
           'export came out as a folder of HTML with the images stripped and ' +
           'the dates in a format nothing reads, and it has not been put back up.'));
  }

  function archiveRow(ctx, issue, isNewest) {
    var li = el('li', { 'class': 'nl-arc-row' + (isNewest ? ' is-newest' : '') });

    var meta = el('div', { 'class': 'nl-arc-meta' });
    var n = numOf(issue.number);
    if (n >= 0) { meta.appendChild(el('span', { 'class': 'nl-arc-no' }, text('#' + issue.number))); }
    if (issue.date) {
      if (n >= 0) { meta.appendChild(el('span', { 'class': 'nl-sep' }, text(' · '))); }
      meta.appendChild(text(String(issue.date)));
    }
    if (isNewest) {
      meta.appendChild(el('span', { 'class': 'nl-sep' }, text(' · ')));
      meta.appendChild(sentLine());
    }
    li.appendChild(meta);

    li.appendChild(el('h3', { 'class': 'nl-arc-h' },
      ctx.link('/i/' + encodeURIComponent(issue.id),
        issue.subject || ('Issue ' + (issue.number || issue.id)), 'nl-arc-link')));

    var first = firstSentence(issue.intro);
    if (first) { li.appendChild(el('p', { 'class': 'nl-arc-first' }, text(first))); }
    return li;
  }

  function pageArchive(ctx, d) {
    ctx.title((d.title || ctx.site.title) + ' — archive');

    var kids = [];
    kids.push(masthead(ctx, d));
    kids.push(subscribeBox(ctx, d));

    var rows = issuesNewestFirst(d);
    kids.push(el('h2', { 'class': 'nl-section-h nl-arc-head' },
      text(rows.length ? 'Every issue, newest first' : 'The archive')));

    if (!rows.length) {
      kids.push(el('p', { 'class': 'nl-empty' },
        text('Nothing is archived here yet. The letter goes out either way.')));
    } else {
      var ul = el('ul', { 'class': 'nl-arc' });
      var i;
      for (i = 0; i < rows.length; i++) {
        ul.appendChild(archiveRow(ctx, rows[i], i === 0));
      }
      kids.push(ul);
      var gap = gapNote(rows);
      if (gap) { kids.push(gap); }
    }

    kids.push(el('footer', { 'class': 'nl-unsub' },
      el('p', { 'class': 'nl-unsub-addr' },
        text('Archive pages carry the unsubscribe line the email carries. ' +
             'It is at the bottom of every issue and it does not work there ' +
             'either.'))));

    shell(ctx, kids);
  }

  function pageIssue(ctx, d, id) {
    var rows = issuesNewestFirst(d);
    var issue = byId(rows, id);
    if (!issue) { return page404(ctx, d, id); }

    var idx = 0, i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i] === issue) { idx = i; }
    }

    ctx.title((issue.subject || ('Issue ' + issue.number)) + ' — ' +
      (d.title || ctx.site.title));

    var kids = [];
    kids.push(viewInBrowser());
    kids.push(masthead(ctx, d));

    var line = el('div', { 'class': 'nl-issue-line' });
    if (numOf(issue.number) >= 0) {
      line.appendChild(el('span', { 'class': 'nl-issue-no' }, text('Issue #' + issue.number)));
      if (issue.date) { line.appendChild(el('span', { 'class': 'nl-sep' }, text(' · '))); }
    }
    if (issue.date) { line.appendChild(text(String(issue.date))); }
    if (idx === 0) {
      line.appendChild(el('span', { 'class': 'nl-sep' }, text(' · ')));
      line.appendChild(sentLine());
    }
    kids.push(line);

    if (issue.sponsor && issue.sponsor.name) {
      kids.push(el('div', { 'class': 'nl-sponsor-teaser' },
        text(sponsorLabel(d) + ' ' + issue.sponsor.name)));
    }

    if (issue.subject) {
      kids.push(el('h1', { 'class': 'nl-subject' }, text(issue.subject)));
    }

    if (issue.intro) {
      kids.push(el('div', { 'class': 'nl-intro' }, ctx.markup(issue.intro)));
    }

    var sections = issue.sections || [];
    var sponsor = sponsorBlock(ctx, d, issue);
    for (i = 0; i < sections.length; i++) {
      if (!sections[i] || typeof sections[i] !== 'object') { continue; }
      kids.push(sectionBlock(ctx, sections[i], i));
      /* The ad sits after the first section, where the eye has already
       * committed to reading and has not yet got bored. */
      if (i === 0 && sponsor) { kids.push(sponsor); sponsor = null; }
    }
    if (sponsor) { kids.push(sponsor); }

    kids.push(signoffBlock(ctx, d, issue));
    kids.push(unsubscribeBlock(ctx, d));

    var nav = el('nav', { 'class': 'nl-nav' });
    if (idx > 0) {
      nav.appendChild(ctx.link('/i/' + encodeURIComponent(rows[idx - 1].id),
        '← Newer', 'nl-nav-link'));
    }
    nav.appendChild(ctx.link('/', 'All issues', 'nl-nav-link'));
    if (idx < rows.length - 1) {
      nav.appendChild(ctx.link('/i/' + encodeURIComponent(rows[idx + 1].id),
        'Older →', 'nl-nav-link'));
    }
    kids.push(nav);

    var echo = echoBlock(ctx, d, issue);
    if (echo) { kids.push(echo); }

    shell(ctx, kids);
  }

  function page404(ctx, d, wanted) {
    ctx.title('Not in the archive — ' + (d.title || ctx.site.title));
    var kids = [];
    kids.push(masthead(ctx, d));
    kids.push(el('h1', { 'class': 'nl-subject' }, text('No issue by that name')));
    kids.push(el('p', { 'class': 'nl-404' },
      text('Nothing here is called ' +
           (wanted ? ('“' + String(wanted) + '”') : 'that') +
           '. Links sent before the move have a different shape and most of ' +
           'them rot on the way; the issue number out of the old link usually ' +
           'still works if you go at it from the list.')));
    kids.push(el('p', { 'class': 'nl-404' }, ctx.link('/', 'Back to the archive', 'nl-nav-link')));
    shell(ctx, kids);
  }

  /* ---------- register ---------- */

  SYNTH.render.register('newsletter', function (ctx) {
    el = ctx.el;
    var d = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];

    if (!p.length) { return pageArchive(ctx, d); }
    if (p[0] === 'i' && p[1]) { return pageIssue(ctx, d, p[1]); }
    return page404(ctx, d, p.join('/'));
  });
}());
