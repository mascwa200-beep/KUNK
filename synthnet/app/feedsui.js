/* feedsui.js -- the Feeds panel, and the badges that point at it.
 *
 * The command bar has had a "Feeds" button since the first commit. It was
 * wired to nothing: the id appeared in index.html and in no JavaScript. This
 * is what it does now.
 *
 * Feeds is a real page at synth://feeds.verity.net/ rather than a dropdown,
 * which gets history, the back button, a bookmarkable URL and the phone
 * layout for free -- and on a phone the command bar is hidden entirely, so a
 * dropdown hanging off a button nobody can see would have been useless.
 *
 * Everything shown here is derived by app/alerts.js from one record per
 * domain plus the clock. Nothing was queued and nothing ran while the app was
 * closed. The events are simply true now and were not true then.
 *
 * COUNT VERSUS DOT. The number on the button only ever counts things
 * addressed to you: replies to your posts, messages, the world reacting to
 * you. Everything else -- sites you read having moved on -- gets a dot and no
 * number. This is the single knob between an app that feels calm and one that
 * feels frantic, and "1,412" on a bell communicates nothing except that you
 * should feel behind.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};
  var SYNTH = window.SYNTH;

  var TABS = [
    { id: 'all', label: 'All' },
    { id: 'mentions', label: 'Mentions' },
    { id: 'replies', label: 'Replies' },
    { id: 'sites', label: 'Sites' }
  ];

  function el() { return SYNTH.el.apply(null, arguments); }
  function alerts() { return SYNTH.alerts; }
  function has(fn) { return typeof fn === 'function'; }

  function nowMs() {
    return (SYNTH.live && has(SYNTH.live.now)) ? SYNTH.live.now() : Date.now();
  }

  function ago(ms) {
    return (SYNTH.live && has(SYNTH.live.ago)) ? SYNTH.live.ago(ms) : '';
  }

  function commas(n) {
    return (SYNTH.live && has(SYNTH.live.commas)) ? SYNTH.live.commas(n) : String(n);
  }

  /* "three days", "an hour", "4 minutes" -- how long you were gone. */
  function spell(ms) {
    var mins = Math.round(ms / 60000);
    if (mins < 2) return 'a moment';
    if (mins < 60) return mins + ' minutes';
    var hours = Math.round(mins / 60);
    if (hours < 2) return 'an hour';
    if (hours < 36) return hours + ' hours';
    var days = Math.round(hours / 24);
    if (days < 2) return 'a day';
    if (days < 14) return days + ' days';
    var weeks = Math.round(days / 7);
    if (weeks < 9) return weeks + ' weeks';
    return Math.round(days / 30) + ' months';
  }

  function go(url) {
    if (SYNTH.engine && has(SYNTH.engine.navigate)) SYNTH.engine.navigate(url);
  }

  /* --- rows --------------------------------------------------------------- */

  var KIND_LABEL = {
    reply: 'reply',
    dm: 'message',
    world: 'about you',
    published: 'published',
    activity: 'activity'
  };

  function eventRow(e) {
    var row = el('div', { 'class': 'fd-row fd-row-' + e.kind });

    row.appendChild(el('span', { 'class': 'fd-kind fd-kind-' + e.kind },
      KIND_LABEL[e.kind] || e.kind));

    var main = el('div', { 'class': 'fd-main' });
    var title = e.url
      ? el('a', {
          'class': 'fd-title',
          href: '#' + e.url,
          onclick: function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            go(e.url);
          }
        }, e.title)
      : el('span', { 'class': 'fd-title' }, e.title);
    main.appendChild(title);
    if (e.body) main.appendChild(el('div', { 'class': 'fd-body' }, e.body));
    row.appendChild(main);

    /* data-lv-ago so the heartbeat keeps it honest while the panel is open --
     * "2 minutes ago" going stale on a notification list is the exact place
     * you would notice. */
    row.appendChild(el('span', {
      'class': 'fd-when',
      'data-lv-ago': String(e.at || nowMs())
    }, ago(e.at || nowMs())));

    return row;
  }

  function empty(message) {
    return el('div', { 'class': 'fd-empty' }, message);
  }

  /* --- the sites tab ------------------------------------------------------
   *
   * Per-site unread, with the subscription level you can change from here.
   * This is where "watching" gets set, and it is the only stored thing on the
   * page besides the visit timestamps. */

  function levelPicker(domain) {
    var current = alerts().levelFor('domain', domain);
    var wrap = el('span', { 'class': 'fd-level' });
    alerts().LEVELS.forEach(function (level) {
      wrap.appendChild(el('button', {
        type: 'button',
        'class': 'fd-levelbtn' + (level === current ? ' is-on' : ''),
        title: LEVEL_HELP[level] || level,
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          var p = (level === 'normal')
            ? alerts().unsubscribe('domain', domain)
            : alerts().subscribe('domain', domain, level);
          Promise.resolve(p).then(function () {
            if (SYNTH.engine && has(SYNTH.engine.refresh)) SYNTH.engine.refresh();
          });
        }
      }, level));
    });
    return wrap;
  }

  var LEVEL_HELP = {
    muted: 'Never mention this site again',
    normal: 'Counted, but nothing is announced',
    tracking: 'Counted, and shown in the digest',
    watching: 'Tell me every time it posts'
  };

  function sitesTab(box) {
    var unread = alerts().unreadByDomain();
    var visits = alerts().allVisits();
    var domains = Object.keys(visits);

    if (!domains.length) {
      box.appendChild(empty(
        'You have not opened anything yet. Visit a few sites and this fills in.'));
      return;
    }

    domains.sort(function (a, b) {
      return (unread[b] || 0) - (unread[a] || 0) ||
             (visits[b].at || 0) - (visits[a].at || 0);
    });

    domains.forEach(function (domain) {
      var entry = (SYNTH.data && has(SYNTH.data.entry)) ? SYNTH.data.entry(domain) : null;
      var n = unread[domain] || 0;
      var row = el('div', { 'class': 'fd-site' });

      row.appendChild(el('a', {
        'class': 'fd-sitename',
        href: '#synth://' + domain + '/',
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          go('synth://' + domain + '/');
        }
      }, (entry && entry.title) || domain));

      row.appendChild(el('span', { 'class': 'fd-sitedom' }, domain));
      row.appendChild(el('span', { 'class': 'fd-sitewhen' },
        'last opened ' + ago(visits[domain].at)));
      row.appendChild(n
        ? el('span', { 'class': 'fd-count' }, commas(n) + ' new')
        : el('span', { 'class': 'fd-count fd-count-zero' }, 'nothing new'));
      row.appendChild(levelPicker(domain));
      box.appendChild(row);
    });
  }

  /* --- the page ----------------------------------------------------------- */

  function render(mount, loc) {
    var A = alerts();
    if (!A) {
      mount.appendChild(empty('The alerts layer did not load.'));
      return 'Feeds';
    }

    var tab = (loc && loc.query && loc.query.t) || 'all';
    if (!TABS.some(function (t) { return t.id === tab; })) tab = 'all';

    var digest = A.digest();
    var page = el('div', { 'class': 'fd-page' });

    /* Header: how long you were gone, and what moved. */
    var head = el('div', { 'class': 'fd-head' });
    head.appendChild(el('h1', { 'class': 'fd-h1' }, 'Feeds'));

    var mentions = digest.mentions.length;
    var ambient = digest.ambient.length;
    var summary;
    if (!digest.events.length) {
      summary = 'Nothing has happened since you last looked. This is unusual ' +
                'and will not last.';
    } else {
      summary = 'In the ' + spell(digest.away) + ' since you last checked: ' +
        (mentions ? mentions + (mentions === 1 ? ' thing' : ' things') +
                    ' addressed to you' : 'nothing addressed to you') +
        (ambient ? ', and ' + ambient + ' site' + (ambient === 1 ? '' : 's') +
                   ' moved on without you' : '') + '.';
    }
    head.appendChild(el('p', { 'class': 'fd-summary' }, summary));

    if (digest.events.length) {
      head.appendChild(el('button', {
        type: 'button',
        'class': 'fd-markread',
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          Promise.resolve(A.markAllRead()).then(function () {
            if (SYNTH.engine && has(SYNTH.engine.refresh)) SYNTH.engine.refresh();
          });
        }
      }, 'Mark all as read'));
    }
    page.appendChild(head);

    /* Tabs */
    var strip = el('div', { 'class': 'fd-tabs' });
    TABS.forEach(function (t) {
      strip.appendChild(el('a', {
        'class': 'fd-tab' + (t.id === tab ? ' is-on' : ''),
        href: '#synth://feeds.verity.net/?t=' + t.id,
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          go('synth://feeds.verity.net/?t=' + t.id);
        }
      }, t.label));
    });
    page.appendChild(strip);

    var box = el('div', { 'class': 'fd-list' });

    if (tab === 'sites') {
      sitesTab(box);
    } else {
      var rows = digest.events;
      if (tab === 'mentions') rows = digest.mentions;
      if (tab === 'replies') {
        rows = digest.events.filter(function (e) { return e.kind === 'reply'; });
      }
      if (!rows.length) {
        box.appendChild(empty(tab === 'replies'
          ? 'Nobody has replied to you since you last looked.'
          : 'Nothing here.'));
      } else {
        rows.forEach(function (e) { box.appendChild(eventRow(e)); });
      }
    }
    page.appendChild(box);

    page.appendChild(el('div', { 'class': 'fd-foot' },
      'None of this was stored while the app was closed. It is worked out ' +
      'from when you last looked and what the clock says now.'));

    mount.appendChild(page);
    return 'Feeds';
  }

  /* --- the badge on the chrome -------------------------------------------- */

  function paintBadge() {
    var A = alerts();
    if (!A || !has(A.badge)) return;
    var state;
    try { state = A.badge(); } catch (e) { return; }

    /* Both Feeds buttons: the command bar one, and the title bar, which is
     * the only one visible on a phone. */
    [document.getElementById('synth-cmd-feeds'),
     document.getElementById('synth-titlebar')].forEach(function (host) {
      if (!host) return;
      var dot = host.querySelector('.fd-badge');
      if (!state.dot) {
        if (dot && dot.parentNode) dot.parentNode.removeChild(dot);
        return;
      }
      if (!dot) {
        dot = el('span', { 'class': 'fd-badge' });
        host.appendChild(dot);
      }
      /* A number only for things addressed to you. Anything else is a dot. */
      dot.className = 'fd-badge' + (state.count ? '' : ' fd-badge-dot');
      dot.textContent = state.count ? (state.count > 99 ? '99+' : String(state.count)) : '';
      dot.setAttribute('title', state.count
        ? state.count + ' addressed to you'
        : 'Sites you read have posted since you looked');
    });
  }

  SYNTH.feedsui = {
    DOMAIN: 'feeds.verity.net',
    render: render,
    paintBadge: paintBadge
  };
})();
