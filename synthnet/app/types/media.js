/* SYNTHNET :: media renderer
   paths: /  |  /watch/<itemId>  |  /channel/<channelId>
          /channels  |  /members  |  /search?q=  |  /upload  |  /signup
   There is no video here. The player is an honest placeholder.

   The nav used to print Videos, Channels, Community, Upload and Sign Up as
   grey spans that did nothing at all, and a search box made of an empty span
   and the word Search. They rendered perfectly for a year. Everything that
   looks like a control in here now either does the thing, or is a page that
   says why it cannot -- which on an archive is the more interesting page of
   the two. See docs/WORLD.md section 2 (2018) for why ClipVault cannot take
   an upload, and the "Setup, tests and dead cards" channel on
   trailcam.verity.net for why that one never could.

   No modules, no innerHTML, no network. Everything hangs off window.SYNTH. */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  /* ---------- helpers ---------- */

  function arr(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }
  function txt(v, fallback) {
    var s = (v == null) ? '' : String(v);
    return s ? s : (fallback || '');
  }

  function num(n) {
    var v = (typeof n === 'number') ? n : parseInt(n, 10);
    if (!isFinite(v)) v = 0;
    v = Math.round(v);
    var s = String(Math.abs(v)), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return (v < 0 ? '-' : '') + out;
  }

  function hash(str) {
    var h = 2166136261, i;
    str = String(str == null ? '' : str);
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function initials(name) {
    var clean = String(name == null ? '' : name).replace(/[^A-Za-z0-9 ]/g, ' ').trim();
    if (!clean) return '?';
    var parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
  function lower(s) { return trim(s).toLowerCase(); }

  function setText(node, s) {
    while (node.firstChild) node.removeChild(node.firstChild);
    node.appendChild(document.createTextNode(String(s)));
  }

  /* Inline markup out of a description, so a search snippet never ships a
     raw [url= to the screen. */
  function flat(s) {
    var raw = txt(s);
    if (window.SYNTH.markup && typeof window.SYNTH.markup.strip === 'function') {
      try { return window.SYNTH.markup.strip(raw); } catch (e) { /* fall through */ }
    }
    return raw.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  /* deterministic two-tone plate, no images, no network */
  function plateStyle(seed) {
    var h = hash(seed);
    var a = h % 360;
    var b = (a + 28 + (h % 40)) % 360;
    return 'background:linear-gradient(150deg, hsl(' + a + ',26%,58%) 0%, hsl(' +
      b + ',22%,34%) 100%);';
  }

  function avatarBox(el, seed, name, cls) {
    return el('span', {
      'class': 'u-av' + (cls ? ' ' + cls : ''),
      style: 'background:hsl(' + (hash(txt(seed, name)) % 360) + ', 34%, 60%);',
      title: txt(name)
    }, initials(name));
  }

  function thumbBox(el, item, cls) {
    return el('span', { 'class': 'thumb' + (cls ? ' ' + cls : ''), style: plateStyle(txt(item.thumbSeed, item.id)) },
      el('span', { 'class': 'thumb-grain' }, ''),
      el('span', { 'class': 'dur' }, txt(item.duration, '--:--')));
  }

  function dat(ctx) { return (ctx.site && ctx.site.data) ? ctx.site.data : {}; }
  function items(ctx) { return arr(dat(ctx).items); }
  function channels(ctx) { return arr(dat(ctx).channels); }
  function siteName(ctx) {
    return txt(dat(ctx).siteName, txt(ctx.site.title, ctx.site.domain));
  }

  /* site.era is the skin vintage and is free text -- "2007" or "2002-2014".
     Whichever end a caller wants, what it gets back is one four-digit year,
     and the one that matters is the LAST: "2002-2014" is a site that ran for
     twelve years and stopped, so 2014 is when it stopped.

     parseInt() on the raw string took the FIRST year instead, which is the
     same family of bug as printing the range where a date belongs -- it
     would have put a "2005-2026" site into archive mode, reading it as
     stopped in 2005 while its own content ran to this year. */
  function eraYear(ctx) {
    var s = String((ctx.site && ctx.site.era) || ''), re = /\d{4}/g, m, last = 0;
    while ((m = re.exec(s)) !== null) { last = parseInt(m[0], 10); }
    return last || 2026;
  }

  /* 1998-2008 sites are saved copies of something that stopped. 2026 sites
     are running. The difference decides what a dead form is allowed to say. */
  function isArchive(ctx) {
    return eraYear(ctx) < 2009;
  }

  function findItem(ctx, id) {
    var list = items(ctx), i;
    for (i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }

  function findChannel(ctx, id) {
    var list = channels(ctx), i;
    for (i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return list[i];
    return null;
  }

  function channelOfItem(ctx, item) {
    return item ? findChannel(ctx, item.channelId) : null;
  }

  function itemsOfChannel(ctx, chanId) {
    return items(ctx).filter(function (it) {
      return String(it.channelId) === String(chanId);
    });
  }

  /* ---------- subscriptions ----------
   *
   * SYNTH.alerts already stores these: a kind, an id and a level, on the
   * device, and nothing is sent anywhere. That is exactly the right shape for
   * a subscribe button on a site that stopped listening in 2018 -- it can
   * remember, it just cannot tell anyone. The fallback map is for the case
   * where storage is not up yet, so the button still answers a press. */

  var localSubs = {};

  function subId(ctx, chanId) {
    return String(ctx.site.domain) + ':' + String(chanId);
  }

  function alerts() {
    var A = window.SYNTH.alerts;
    return (A && typeof A.levelFor === 'function' &&
            typeof A.subscribe === 'function') ? A : null;
  }

  function isSubbed(ctx, chanId) {
    var key = subId(ctx, chanId);
    var A = alerts();
    if (A) {
      try { return A.levelFor('channel', key) === 'watching'; }
      catch (e) { /* fall through to the local map */ }
    }
    return !!localSubs[key];
  }

  function setSub(ctx, chanId, on) {
    var key = subId(ctx, chanId);
    localSubs[key] = !!on;
    var A = alerts();
    if (!A) return;
    try {
      if (on) A.subscribe('channel', key, 'watching');
      else A.unsubscribe('channel', key);
    } catch (e) { /* the local map already holds it */ }
  }

  function subbedChannels(ctx) {
    return channels(ctx).filter(function (c) { return isSubbed(ctx, c.id); });
  }

  function subscribeButton(ctx, chan, note) {
    var el = ctx.el;
    var btn = el('button', { 'class': 'subscribe', type: 'button' });

    function paint() {
      var on = isSubbed(ctx, chan.id);
      btn.className = on ? 'subscribe on' : 'subscribe';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      setText(btn, on ? 'Subscribed' : 'Subscribe');
      /* Only once you have pressed it, because the explanation is only
         interesting then, and seven copies of it down a channel list is
         noise. */
      if (note) {
        setText(note, on ? 'Subscribed. Kept on this device; the site is not told.' : '');
      }
    }

    btn.addEventListener('click', function () {
      setSub(ctx, chan.id, !isSubbed(ctx, chan.id));
      paint();
    }, false);

    paint();
    return btn;
  }

  /* ---------- why the forms are shut ----------
   *
   * Per domain, because a true reason has to be. The fallbacks are true of
   * any copy of their era, so a media site added later gets an honest page
   * rather than an invented one. */

  var NOTICES = {
    'clipvault.tv': {
      upload: {
        head: 'Uploading',
        paras: [
          'There is nothing behind this link and there has not been for years.',
          'ClipVault was a regional video host: cheap, scrappy, and for about four years the only place in the county you could put a tape where somebody else might see it. In 2018 it was bought. What the buyer wanted was the traffic and the recommendation feed it could hang off it, not the tapes, and the Verity County material that came with the name was left where it fell, as a back catalogue nobody has curated since.',
          'You are reading that back catalogue. The pages were kept; the video files were not, and neither was the script this form posted to. Nothing you typed in would reach anything.'
        ]
      },
      signup: {
        head: 'Signing up',
        paras: [
          'Registration closed with the sale in 2018 and was never reopened.',
          'The handles under these clips and in these comments belong to people who signed up while this was a going concern, between 2005 and 2008. Most had stopped visiting well before it changed hands. No new ones are being issued, and none of the old ones can be written to from here.'
        ]
      }
    },
    'trailcam.verity.net': {
      upload: {
        head: 'Uploading',
        paras: [
          'Nothing goes up here except cards out of six cameras, and one man swaps them.',
          'This gallery is an off-the-shelf script a fellow in Gridfall set up in 2019 for forty dollars and a pie. It prints Upload and Sign Up across the top of every page whether or not either is wired to anything, in the same way it prints that video files were not preserved at the foot of a page where the files are plainly right there. Neither link has ever gone anywhere.',
          'The cards come out on Sunday mornings, on a loop round the place that takes about an hour. That is the whole of the pipeline and no part of it is reachable through a web form.'
        ]
      },
      signup: {
        head: 'Signing up',
        paras: [
          'There are no accounts on this site. There is one password and it belongs to the man whose sixty acres these are.',
          'The names in the comments are people from around Coyne Flats. The script has never asked any of them who they are, which is also why the two or three machines advertising down there are not going anywhere: it will not let anybody delete a comment, the owner included.'
        ]
      }
    }
  };

  function noticeFor(ctx, kind) {
    var byDomain = NOTICES[String(ctx.site.domain)];
    if (byDomain && byDomain[kind]) return byDomain[kind];
    var archive = isArchive(ctx);
    if (kind === 'upload') {
      return archive ? {
        head: 'Uploading',
        paras: [
          'The form that used to be here posted to a script that stopped answering a long time ago.',
          'You are reading a saved copy of this site: the pages were kept and the video files were not. There is no server on the other end of this link to take a file, and no account it would be filed under.'
        ]
      } : {
        head: 'Uploading',
        paras: [
          'Nothing on this site is crowd-sourced.',
          'Everything you can watch here was put up by the channels listed under Channels. There has never been a form on this site for anybody else, and the link at the top of the page is one the software prints whether or not it is wired to anything.'
        ]
      };
    }
    return archive ? {
      head: 'Signing up',
      paras: [
        'Nobody has been able to register on this site since it stopped being a going concern.',
        'The handles under these clips belong to people who signed up while it was running. The copy you are reading has no account system behind it at all.'
      ]
    } : {
      head: 'Signing up',
      paras: [
        'This site does not issue accounts and there is nothing behind this link.',
        'Whatever the top of the page prints, there is no sign-up on the other side of it. Nothing here asks who you are, and nothing here would know what to do with the answer.'
      ]
    };
  }

  /* ---------- chrome ---------- */

  function searchForm(ctx, initial) {
    var el = ctx.el;
    var input = el('input', {
      type: 'text', name: 'q', value: txt(initial), autocomplete: 'off',
      'class': 'm-searchbox', placeholder: 'Search this site',
      'aria-label': 'Search this site'
    });
    var go = function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var v = trim(input.value);
      var url = 'synth://' + ctx.site.domain + '/search' +
        (v ? ('?q=' + encodeURIComponent(v)) : '');
      if (window.SYNTH.engine && window.SYNTH.engine.navigate) {
        window.SYNTH.engine.navigate(url);
      }
      return false;
    };
    return el('form', { 'class': 'm-search', role: 'search', onsubmit: go },
      input,
      el('button', { type: 'submit', 'class': 'btn m-searchgo' }, 'Search'));
  }

  function topBar(ctx, here, query) {
    var el = ctx.el;
    return el('div', { 'class': 'm-top' },
      el('div', { 'class': 'm-brandrow' },
        ctx.link('/', siteName(ctx), 'm-brand'),
        searchForm(ctx, query)),
      el('div', { 'class': 'm-nav' },
        ctx.link('/', 'Home'),
        ctx.link('/channels', 'Channels'),
        ctx.link('/members', 'Community'),
        ctx.link('/upload', 'Upload'),
        ctx.link('/signup', 'Sign Up'),
        here ? el('span', { 'class': 'm-here' }, here) : null));
  }

  function foot(ctx) {
    return ctx.el('div', { 'class': 'm-foot' },
      txt(ctx.site.description, '') + ' — archived copy, ' + eraYear(ctx) +
      '. Video files were not preserved.');
  }

  function backRow(ctx) {
    return ctx.el('div', { 'class': 'backrow' }, ctx.link('/', '« Back to ' + siteName(ctx)));
  }

  /* ---------- cards ---------- */

  function card(ctx, item, cls) {
    var el = ctx.el;
    return el('div', { 'class': 'card' + (cls ? ' ' + cls : '') },
      ctx.link('/watch/' + encodeURIComponent(txt(item.id)), '', 'card-thumb-link'),
      el('a', {
        'class': 'card-thumb',
        href: '#',
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          SYNTH.engine.navigate('synth://' + ctx.site.domain + '/watch/' +
            encodeURIComponent(txt(item.id)));
        }
      }, thumbBox(el, item)),
      el('div', { 'class': 'card-body' },
        el('div', { 'class': 'card-title' },
          ctx.link('/watch/' + encodeURIComponent(txt(item.id)), txt(item.title, 'Untitled clip'))),
        el('div', { 'class': 'card-meta' },
          'From: ',
          item.channelId
            ? ctx.link('/channel/' + encodeURIComponent(txt(item.channelId)), txt(item.uploader, 'unknown'), 'up')
            : el('span', { 'class': 'up' }, txt(item.uploader, 'unknown'))),
        el('div', { 'class': 'card-meta dim' },
          liveViews(ctx, item) + ' views  •  ' + txt(item.uploaded, 'some time ago'))));
  }

  function chanChip(ctx, c) {
    var el = ctx.el;
    return el('div', { 'class': 'chanchip' },
      avatarBox(el, c.avatarSeed, c.name),
      el('div', { 'class': 'chanchip-id' },
        ctx.link('/channel/' + encodeURIComponent(txt(c.id)), txt(c.name, 'channel')),
        el('div', { 'class': 'dim' }, num(c.subscribers) + ' subscribers')));
  }

  /* ---------- index ---------- */


  /* A view count that has not moved since 2007 is the single clearest sign
   * that a page is dead. These keep climbing, faster for the automated
   * channels, because the bot network watches its own uploads. */
  function viewsOf(ctx, item) {
    var L = window.SYNTH.live;
    if (!L) { return Number(item.views) || 0; }
    var perDay = 40 + (L.hash32(String(item.id)) % 220);
    return L.counter('media:views:' + ctx.site.domain + ':' + item.id,
                     item.views || 0, perDay);
  }

  function liveViews(ctx, item) {
    var L = window.SYNTH.live;
    if (!L) return num(item.views);
    return L.commas(viewsOf(ctx, item));
  }

  function renderIndex(ctx) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title(siteName(ctx));
    mount.appendChild(topBar(ctx, null));

    var list = items(ctx);
    if (!list.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'No clips in this archive.'));
      mount.appendChild(foot(ctx));
      return;
    }

    var featured = list.slice(0, Math.min(4, list.length));
    mount.appendChild(el('div', { 'class': 'feat' },
      el('div', { 'class': 'sec-head' }, 'Featured Videos'),
      el('div', { 'class': 'feat-strip' },
        featured.map(function (it) { return card(ctx, it, 'feat-card'); }))));

    var mine = subbedChannels(ctx);
    if (mine.length) {
      mount.appendChild(el('div', { 'class': 'sec-head' },
        'Your Subscriptions (' + mine.length + ')'));
      mount.appendChild(el('div', { 'class': 'chanrow' },
        mine.map(function (c) { return chanChip(ctx, c); })));
    }

    /* "Most Viewed" over the authored array, with each tile printing its own
     * view count underneath -- so the heading was contradicted three inches
     * below it, on all three sites: clipvault.tv ran 41,544 then 24,417 then
     * 17,300 then 65,326. Sort on viewsOf(), which is the number the tile is
     * about to show.
     *
     * A copy: `featured` above is deliberately the first four in AUTHORED
     * order and is not a most-viewed claim.
     *
     * "This Week" is dropped on the archive sites. Their clips are dated
     * 1998-2008 and no week contains them. Through isArchive(), which is
     * this file's own reading of site.era -- the skin vintage is free text
     * and "2002-2014" means a site that stopped in 2014. */
    var viewed = list.slice();
    viewed.sort(function (a, b) { return viewsOf(ctx, b) - viewsOf(ctx, a); });
    mount.appendChild(el('div', { 'class': 'sec-head' },
      isArchive(ctx) ? 'Most Viewed' : 'Most Viewed This Week'));
    mount.appendChild(el('div', { 'class': 'grid' },
      viewed.map(function (it) { return card(ctx, it); })));

    var chans = channels(ctx);
    if (chans.length) {
      mount.appendChild(el('div', { 'class': 'sec-head' }, 'Channels'));
      mount.appendChild(el('div', { 'class': 'chanrow' },
        chans.map(function (c) { return chanChip(ctx, c); })));
      mount.appendChild(el('div', { 'class': 'm-more' },
        ctx.link('/channels', chans.length === 1
          ? 'The one channel, and what is on it'
          : ('All ' + chans.length + ' channels, with what is on them'))));
    }

    mount.appendChild(foot(ctx));
  }

  /* ---------- watch ---------- */

  function playerBlock(ctx, item) {
    var el = ctx.el;
    var caption = el('div', { 'class': 'unavail' },
      'This clip is unavailable in the archive — only the page around it was saved. ' +
      'Nothing will play.');

    /* Every transport control answers the same way, because the same thing is
     * true of all of them. Two lines, alternating, so a second press is not
     * met with silence either. */
    var tries = 0;
    function nudge(ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      tries++;
      caption.className = 'unavail flash';
      setText(caption, (tries % 2)
        ? 'Nothing will play. The page was saved; the file it pointed at was not.'
        : 'Still nothing. Pressing it again does not put the file back.');
    }

    var play = el('a', {
      'class': 'play-btn', href: '#', title: 'Playback unavailable', onclick: nudge
    }, el('span', { 'class': 'play-tri' }, ''));

    var ctl = el('span', { 'class': 'ctl', title: 'Playback unavailable', onclick: nudge },
      el('span', { 'class': 'ctl-tri' }, ''));
    var scrub = el('span', { 'class': 'scrub', title: 'Playback unavailable', onclick: nudge },
      el('span', { 'class': 'scrub-fill' }, ''),
      el('span', { 'class': 'scrub-knob' }, ''));
    /* The volume slider is drawn from the same .ctl box as the play control
     * sitting two inches to its left, so it has to answer the same way. It
     * was the one transport control left without a handler, and no checker
     * here can see that: the function check indexes candidates by their
     * text, and every control in this row has none. */
    var vol = el('span', { 'class': 'ctl vol', title: 'Playback unavailable', onclick: nudge }, '');

    return el('div', { 'class': 'player' },
      el('div', { 'class': 'player-frame', style: plateStyle(txt(item.thumbSeed, item.id)) },
        el('div', { 'class': 'frame-grain' }, ''),
        play,
        el('div', { 'class': 'stillnote' }, 'still frame')),
      el('div', { 'class': 'controls' },
        ctl,
        scrub,
        el('span', { 'class': 'times' }, '0:00 / ' + txt(item.duration, '--:--')),
        vol),
      caption);
  }

  function renderWatch(ctx, id) {
    var el = ctx.el, mount = ctx.mount;
    var item = findItem(ctx, id);
    if (!item) return render404(ctx, 'This video is no longer available.');

    var chan = channelOfItem(ctx, item);
    ctx.title(txt(item.title, 'Video') + ' — ' + siteName(ctx));
    mount.appendChild(topBar(ctx, 'Watch'));

    var main = el('div', { 'class': 'watch-main' });
    main.appendChild(playerBlock(ctx, item));
    main.appendChild(el('h1', { 'class': 'vtitle' }, txt(item.title, 'Untitled clip')));
    main.appendChild(el('div', { 'class': 'vmeta' },
      liveViews(ctx, item) + ' views  •  Added ' + txt(item.uploaded, 'some time ago')));

    var subNote = chan ? el('div', { 'class': 'sub-note dim' }, '') : null;
    main.appendChild(el('div', { 'class': 'uploader-row' },
      avatarBox(el, chan ? chan.avatarSeed : item.thumbSeed, txt(item.uploader, chan ? chan.name : '?')),
      el('div', { 'class': 'u-id' },
        item.channelId
          ? ctx.link('/channel/' + encodeURIComponent(txt(item.channelId)), txt(item.uploader, 'unknown'), 'u-name')
          : el('span', { 'class': 'u-name' }, txt(item.uploader, 'unknown')),
        el('div', { 'class': 'dim' },
          chan ? num(chan.subscribers) + ' subscribers' : 'no channel on record'),
        subNote),
      chan ? subscribeButton(ctx, chan, subNote) : null));

    var desc = el('div', { 'class': 'desc' });
    var frag = ctx.markup(txt(item.description));
    if (frag) desc.appendChild(frag);
    main.appendChild(el('div', { 'class': 'descbox' },
      el('div', { 'class': 'desc-head' }, 'Description'), desc));

    /* The archived comments from 2007, plus everything the bots have left
     * since. The new ones arrive on the wall clock and carry a badge, so the
     * ratio is visible at a glance -- which is the whole point. */
    var archived = arr(item.comments);
    var fresh = [];
    if (window.SYNTH.live && window.SYNTH.slop &&
        window.SYNTH.live.pool('mediaComments').length) {
      var L = window.SYNTH.live;
      fresh = L.stream('media:c:' + ctx.site.domain + ':' + item.id, 'mediaComments', 6, 14)
        .map(function (sl) {
          return {
            author: sl.item.author,
            avatarSeed: sl.item.avatarSeed,
            kind: sl.item.kind,
            body: sl.item.body,
            liveAt: sl.at
          };
        });
    }
    var comments = fresh.concat(archived);

    var clist = el('div', { 'class': 'comments' },
      el('div', { 'class': 'sec-head small' },
        num(comments.length) + ' comment' + (comments.length === 1 ? '' : 's')));
    if (window.SYNTH.liveui && fresh.length) {
      var cAd = window.SYNTH.liveui.ad('text', 'media:' + item.id);
      if (cAd) clist.appendChild(cAd);
    }
    if (!comments.length) {
      clist.appendChild(el('div', { 'class': 'blank' }, 'No comments were archived for this clip.'));
    }
    comments.forEach(function (c) {
      var body = el('div', { 'class': 'c-body' });
      var cf = ctx.markup(txt(c.body));
      if (cf) body.appendChild(cf);
      clist.appendChild(el('div', { 'class': 'comment' },
        avatarBox(el, c.author, c.author, 'small'),
        el('div', { 'class': 'c-main' },
          el('div', { 'class': 'c-head' },
            el('span', { 'class': 'c-name' }, txt(c.author, 'guest')),
            (window.SYNTH.liveui ? window.SYNTH.liveui.badge(c.kind) : null),
            el('span', { 'class': 'c-time' },
              c.liveAt && window.SYNTH.live ? window.SYNTH.live.ago(c.liveAt) : txt(c.time))),
          body)));
    });
    /* The box that used to be here was a grey span shaped like a text field.
       A disabled input that says why is the same picture and not a lie. */
    clist.appendChild(el('div', { 'class': 'c-postbox' },
      el('input', {
        'class': 'c-input', type: 'text', disabled: true,
        'aria-label': 'Commenting is not available on this copy',
        value: 'This copy does not take comments.'
      }),
      el('span', { 'class': 'btn dis' }, 'Post Comment')));
    main.appendChild(clist);

    var related = items(ctx).filter(function (it) {
      return String(it.id) !== String(item.id);
    }).slice(0, 8);

    var side = el('div', { 'class': 'watch-side' },
      el('div', { 'class': 'sec-head small' }, 'Related Videos'));
    if (!related.length) {
      side.appendChild(el('div', { 'class': 'blank' }, 'Nothing related.'));
    }
    related.forEach(function (it) {
      side.appendChild(el('a', {
        'class': 'rel-item',
        href: '#',
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          SYNTH.engine.navigate('synth://' + ctx.site.domain + '/watch/' +
            encodeURIComponent(txt(it.id)));
        }
      },
        thumbBox(el, it, 'rel-thumb'),
        el('span', { 'class': 'rel-id' },
          el('span', { 'class': 'rel-title' }, txt(it.title, 'Untitled clip')),
          el('span', { 'class': 'rel-meta' }, txt(it.uploader, 'unknown')),
          el('span', { 'class': 'rel-meta dim' }, num(it.views) + ' views'))));
    });

    mount.appendChild(el('div', { 'class': 'watch-layout' }, main, side));
    mount.appendChild(foot(ctx));
  }

  /* ---------- channel ---------- */

  function renderChannel(ctx, id) {
    var el = ctx.el, mount = ctx.mount;
    var chan = findChannel(ctx, id);
    if (!chan) return render404(ctx, 'That channel does not exist.');

    ctx.title(txt(chan.name, 'Channel') + ' — ' + siteName(ctx));
    mount.appendChild(topBar(ctx, 'Channel'));

    mount.appendChild(el('div', { 'class': 'chan-banner', style: plateStyle(txt(chan.avatarSeed, chan.id)) },
      el('span', { 'class': 'frame-grain' }, '')));

    var about = el('div', { 'class': 'chan-about' });
    var af = ctx.markup(txt(chan.about, 'No description given.'));
    if (af) about.appendChild(af);

    var note = el('div', { 'class': 'sub-note dim' }, '');
    mount.appendChild(el('div', { 'class': 'chan-head' },
      avatarBox(el, chan.avatarSeed, chan.name, 'big'),
      el('div', { 'class': 'chan-id' },
        el('div', { 'class': 'chan-name' }, txt(chan.name, 'Channel')),
        el('div', { 'class': 'chan-subs' }, num(chan.subscribers) + ' subscribers'),
        note,
        about),
      subscribeButton(ctx, chan, note)));

    var mine = itemsOfChannel(ctx, chan.id);

    mount.appendChild(el('div', { 'class': 'sec-head' },
      num(mine.length) + ' video' + (mine.length === 1 ? '' : 's')));
    if (!mine.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'This channel has no archived videos.'));
    } else {
      mount.appendChild(el('div', { 'class': 'grid' },
        mine.map(function (it) { return card(ctx, it); })));
    }

    mount.appendChild(backRow(ctx));
    mount.appendChild(foot(ctx));
  }

  /* ---------- channel list ---------- */

  function renderChannels(ctx) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title('Channels — ' + siteName(ctx));
    mount.appendChild(topBar(ctx, 'Channels'));

    var chans = channels(ctx);
    mount.appendChild(el('div', { 'class': 'sec-head' },
      chans.length + ' channel' + (chans.length === 1 ? '' : 's')));

    if (!chans.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'No channels on this site.'));
      mount.appendChild(foot(ctx));
      return;
    }

    var list = el('div', { 'class': 'chanlist' });
    chans.forEach(function (c) {
      var mine = itemsOfChannel(ctx, c.id);
      var newest = mine.length ? mine[0] : null;
      var note = el('div', { 'class': 'sub-note dim' }, '');
      var body = el('div', { 'class': 'chan-line-id' },
        el('div', { 'class': 'chan-line-name' },
          ctx.link('/channel/' + encodeURIComponent(txt(c.id)), txt(c.name, 'channel'))),
        el('div', { 'class': 'dim' },
          num(c.subscribers) + ' subscribers  •  ' +
          mine.length + ' clip' + (mine.length === 1 ? '' : 's')),
        newest ? el('div', { 'class': 'chan-line-last' },
          'First on the page: ',
          ctx.link('/watch/' + encodeURIComponent(txt(newest.id)),
            txt(newest.title, 'Untitled clip'))) : null,
        note);
      list.appendChild(el('div', { 'class': 'chan-line' },
        avatarBox(el, c.avatarSeed, c.name),
        body,
        subscribeButton(ctx, c, note)));
    });
    mount.appendChild(list);

    mount.appendChild(el('div', { 'class': 'm-note-fact' },
      'Subscribing is kept on this device. ' +
      (isArchive(ctx)
        ? 'Nothing on this site has been notified of anything since it stopped running.'
        : 'Nothing on this site is notified.')));

    mount.appendChild(backRow(ctx));
    mount.appendChild(foot(ctx));
  }

  /* ---------- community ----------
   *
   * There is no member list in the data and there never was one on the site.
   * This one is counted off the pages: every name that uploaded a clip or
   * left a comment on one. */

  function peopleOf(ctx) {
    var index = {}, order = [];

    function touch(name) {
      var key = lower(name);
      if (!key) return null;
      if (!index[key]) {
        index[key] = { name: trim(name), uploads: 0, comments: 0, channelId: '', kind: '' };
        order.push(key);
      }
      return index[key];
    }

    items(ctx).forEach(function (it) {
      var up = touch(txt(it.uploader));
      if (up) {
        up.uploads++;
        if (!up.channelId) up.channelId = txt(it.channelId);
      }
      arr(it.comments).forEach(function (c) {
        var row = touch(txt(c.author));
        if (!row) return;
        row.comments++;
        if (!row.kind && c.kind && c.kind !== 'human') row.kind = String(c.kind);
      });
    });

    var rows = order.map(function (k) { return index[k]; });
    rows.sort(function (a, b) {
      if (b.uploads !== a.uploads) return b.uploads - a.uploads;
      if (b.comments !== a.comments) return b.comments - a.comments;
      return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return rows;
  }

  function renderMembers(ctx) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title('Community — ' + siteName(ctx));
    mount.appendChild(topBar(ctx, 'Community'));

    var rows = peopleOf(ctx);
    var uploaders = 0, machines = 0;
    rows.forEach(function (r) {
      if (r.uploads) uploaders++;
      if (r.kind === 'bot' || r.kind === 'spam') machines++;
    });

    mount.appendChild(el('div', { 'class': 'sec-head' },
      rows.length + ' name' + (rows.length === 1 ? '' : 's') + ' on this site'));

    /* The count has to say what it counted. Comments keep landing on the
     * clips while you read them -- a watch page here will show a dozen
     * names this list does not have -- so "everybody who ever commented"
     * is a claim this page cannot keep. What it can say is exactly which
     * names it counted and where it got them, which is the true version
     * and the funnier one. */
    mount.appendChild(el('div', { 'class': 'm-note-fact' },
      'Nobody kept a member list here, so this one is counted off the clips: ' +
      'every name that put one up, and every name on a comment saved with one. ' +
      uploaders + ' of them uploaded something' +
      (machines ? ', and ' + machines + ' of them are machines. ' : '. ') +
      'Comments are still arriving on the clips and are not counted here. ' +
      'Nothing on this site has ever kept a list of who leaves them.'));

    if (!rows.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'Nobody signed anything on this site.'));
      mount.appendChild(backRow(ctx));
      mount.appendChild(foot(ctx));
      return;
    }

    var list = el('div', { 'class': 'people' });
    rows.forEach(function (r) {
      var counts = [];
      if (r.uploads) counts.push(r.uploads + ' clip' + (r.uploads === 1 ? '' : 's'));
      if (r.comments) counts.push(r.comments + ' comment' + (r.comments === 1 ? '' : 's'));
      var name = (r.uploads && r.channelId && findChannel(ctx, r.channelId))
        ? ctx.link('/channel/' + encodeURIComponent(r.channelId), r.name, 'p-name')
        : el('span', { 'class': 'p-name' }, r.name);
      list.appendChild(el('div', { 'class': 'person' },
        avatarBox(el, r.name, r.name, 'small'),
        el('div', { 'class': 'p-id' },
          el('div', { 'class': 'p-head' },
            name,
            (window.SYNTH.liveui ? window.SYNTH.liveui.badge(r.kind) : null)),
          el('div', { 'class': 'p-meta dim' }, counts.join('  •  ')))));
    });
    mount.appendChild(list);

    mount.appendChild(backRow(ctx));
    mount.appendChild(foot(ctx));
  }

  /* ---------- search ----------
   *
   * This site's own titles, descriptions, uploaders and comments. It is not
   * the network index at search.verity.net and does not pretend to be; there
   * is a link to that at the bottom for when this one is not enough. */

  function termsOf(q) {
    var raw = lower(q).split(/\s+/), out = [], i;
    for (i = 0; i < raw.length; i++) if (raw[i]) out.push(raw[i]);
    return out;
  }

  function hasAll(hay, terms) {
    var low = lower(hay), i;
    for (i = 0; i < terms.length; i++) if (low.indexOf(terms[i]) === -1) return false;
    return true;
  }

  function snippet(text, terms) {
    var body = flat(text);
    if (!body) return '';
    var at = terms.length ? lower(body).indexOf(terms[0]) : 0;
    if (at < 0) at = 0;
    var from = Math.max(0, at - 45);
    var cut = body.substring(from, from + 150);
    return (from > 0 ? '…' : '') + cut + (from + 150 < body.length ? '…' : '');
  }

  /* Which field the words were actually found in. The first version of this
   * printed "match in description" for anything that was not a title hit,
   * which put that line under a search for an uploader's handle next to a
   * snippet of a description the handle does not appear in. A result page
   * that tells you where the match is has to be right about it or it is
   * worth less than no line at all. */
  function matchLabel(it, chan, terms) {
    var fields = [
      { label: 'the title', text: txt(it.title) },
      { label: 'the description', text: flat(it.description) },
      { label: 'the uploader', text: txt(it.uploader) },
      { label: 'the channel name', text: chan ? txt(chan.name) : '' }
    ];
    var whole = [], part = [], i, j, low, hitAny, hitAll;
    for (i = 0; i < fields.length; i++) {
      low = lower(fields[i].text);
      if (!low) continue;
      hitAny = false; hitAll = true;
      for (j = 0; j < terms.length; j++) {
        if (low.indexOf(terms[j]) === -1) hitAll = false;
        else hitAny = true;
      }
      if (hitAll) whole.push(fields[i].label);
      else if (hitAny) part.push(fields[i].label);
    }
    /* One field holding every word is a match in that field. Words split
     * across two of them is a match across both, and says so. */
    var names = whole.length ? whole : part;
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    return names.slice(0, names.length - 1).join(', ') + ' and ' +
      names[names.length - 1];
  }

  function searchSite(ctx, terms) {
    var hits = [];
    items(ctx).forEach(function (it) {
      var chan = channelOfItem(ctx, it);
      var where = '';
      var hay = [txt(it.title), txt(it.uploader), flat(it.description),
                 chan ? txt(chan.name) : ''].join(' \n ');
      if (hasAll(hay, terms)) {
        where = matchLabel(it, chan, terms) || 'the page';
      } else {
        var found = null;
        arr(it.comments).forEach(function (c) {
          if (found) return;
          if (hasAll(txt(c.author) + ' ' + flat(c.body), terms)) found = c;
        });
        if (!found) return;
        where = 'a comment by ' + txt(found.author, 'guest');
        hits.push({ item: it, chan: chan, where: where,
                    snip: snippet(found.body, terms) });
        return;
      }
      hits.push({ item: it, chan: chan, where: where,
                  snip: snippet(it.description, terms) });
    });
    return hits;
  }

  function renderSearch(ctx) {
    var el = ctx.el, mount = ctx.mount;
    var q = trim((ctx.query && ctx.query.q) || '');
    var terms = termsOf(q);

    ctx.title((q ? ('Search: ' + q) : 'Search') + ' — ' + siteName(ctx));
    mount.appendChild(topBar(ctx, 'Search results', q));

    if (!terms.length) {
      mount.appendChild(el('div', { 'class': 'sec-head' }, 'Search this site'));
      mount.appendChild(el('div', { 'class': 'm-note-fact' },
        'Type into the box at the top of the page. This looks at the titles, ' +
        'descriptions and uploaders on ' + siteName(ctx) + ', and at the ' +
        'comments saved with each clip. Nothing else, and nothing off this site.'));
      mount.appendChild(backRow(ctx));
      mount.appendChild(foot(ctx));
      return;
    }

    var hits = searchSite(ctx, terms);
    var chanHits = channels(ctx).filter(function (c) {
      return hasAll(txt(c.name) + ' ' + flat(c.about), terms);
    });

    mount.appendChild(el('div', { 'class': 'sec-head' },
      hits.length + ' clip' + (hits.length === 1 ? '' : 's') +
      (chanHits.length ? (' and ' + chanHits.length + ' channel' +
        (chanHits.length === 1 ? '' : 's')) : '') +
      ' matching "' + q + '"'));

    if (!hits.length && !chanHits.length) {
      mount.appendChild(el('div', { 'class': 'blank' },
        'Nothing on this site matches those words.'));
    }

    if (chanHits.length) {
      mount.appendChild(el('div', { 'class': 'chanrow' },
        chanHits.map(function (c) { return chanChip(ctx, c); })));
    }

    if (hits.length) {
      var list = el('div', { 'class': 'hits' });
      hits.forEach(function (h) {
        list.appendChild(el('div', { 'class': 'hit' },
          el('a', {
            'class': 'hit-thumb', href: '#',
            onclick: function (ev) {
              if (ev && ev.preventDefault) ev.preventDefault();
              SYNTH.engine.navigate('synth://' + ctx.site.domain + '/watch/' +
                encodeURIComponent(txt(h.item.id)));
            }
          }, thumbBox(el, h.item, 'rel-thumb')),
          el('div', { 'class': 'hit-id' },
            el('div', { 'class': 'hit-title' },
              ctx.link('/watch/' + encodeURIComponent(txt(h.item.id)),
                txt(h.item.title, 'Untitled clip'))),
            el('div', { 'class': 'hit-meta dim' },
              txt(h.item.uploader, 'unknown') + '  •  ' +
              txt(h.item.uploaded, 'some time ago') + '  •  match in ' + h.where),
            h.snip ? el('div', { 'class': 'hit-snip' }, h.snip) : null)));
      });
      mount.appendChild(list);
    }

    mount.appendChild(el('div', { 'class': 'm-note-fact' },
      'This searched ' + siteName(ctx) + ' only. ',
      ctx.link('synth://search.verity.net/?q=' + encodeURIComponent(q),
        'Look for "' + q + '" across the whole network')));

    mount.appendChild(backRow(ctx));
    mount.appendChild(foot(ctx));
  }

  /* ---------- the two shut forms ---------- */

  function renderNotice(ctx, kind) {
    var el = ctx.el, mount = ctx.mount;
    var spec = noticeFor(ctx, kind);
    var here = (kind === 'upload') ? 'Uploading' : 'Accounts';

    ctx.title(spec.head + ' — ' + siteName(ctx));
    mount.appendChild(topBar(ctx, here));

    var box = el('div', { 'class': 'm-note' },
      el('h1', { 'class': 'm-note-head' }, spec.head));
    spec.paras.forEach(function (p) {
      box.appendChild(el('p', { 'class': 'm-note-p' }, p));
    });

    if (kind === 'upload') {
      box.appendChild(el('div', { 'class': 'm-note-fact' },
        items(ctx).length + ' clip' + (items(ctx).length === 1 ? '' : 's') +
        ' from ' + channels(ctx).length + ' channel' +
        (channels(ctx).length === 1 ? '' : 's') + ' are on this site. ',
        ctx.link('/', 'They are all still here to watch'), '.'));
    } else {
      box.appendChild(el('div', { 'class': 'm-note-fact' },
        'The names that are on this site were counted off the clips themselves. ',
        ctx.link('/members', 'The Community page has them'), '.'));
    }
    mount.appendChild(box);

    mount.appendChild(backRow(ctx));
    mount.appendChild(foot(ctx));
  }

  /* ---------- 404 ---------- */

  function render404(ctx, msg) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title('Not Found — ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Error'));
    mount.appendChild(el('div', { 'class': 'err' },
      el('h2', null, 'We are sorry, this video is not available.'),
      el('p', null, txt(msg, 'It may have been removed by the user, or the address was typed wrong.')),
      el('p', null, ctx.link('/', 'Return to the home page'))));
    mount.appendChild(foot(ctx));
  }

  /* ---------- entry point ---------- */

  function renderMedia(ctx) {
    var path = arr(ctx.path);
    if (!path.length) return renderIndex(ctx);
    if (path[0] === 'watch' && path.length >= 2) return renderWatch(ctx, path[1]);
    if (path[0] === 'channel' && path.length >= 2) return renderChannel(ctx, path[1]);
    if (path[0] === 'channels') return renderChannels(ctx);
    if (path[0] === 'members') return renderMembers(ctx);
    if (path[0] === 'search') return renderSearch(ctx);
    if (path[0] === 'upload') return renderNotice(ctx, 'upload');
    if (path[0] === 'signup') return renderNotice(ctx, 'signup');
    return render404(ctx, 'The page you asked for is not in the archive.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('media', renderMedia);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['media', renderMedia]);
  }
}());
