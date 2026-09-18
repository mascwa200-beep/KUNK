/* SYNTHNET :: media renderer
   paths: /  |  /watch/<itemId>  |  /channel/<channelId>
   There is no video here. The player is an honest placeholder.
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
      h = (h * 16777619) >>> 0;
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

  /* ---------- chrome ---------- */

  function topBar(ctx, here) {
    var el = ctx.el, d = dat(ctx);
    return el('div', { 'class': 'm-top' },
      el('div', { 'class': 'm-brandrow' },
        ctx.link('/', txt(d.siteName, txt(ctx.site.title, ctx.site.domain)), 'm-brand'),
        el('div', { 'class': 'm-search' },
          el('span', { 'class': 'm-searchbox' }, ''),
          el('span', { 'class': 'btn' }, 'Search'))),
      el('div', { 'class': 'm-nav' },
        ctx.link('/', 'Home'),
        el('span', { 'class': 'navitem' }, 'Videos'),
        el('span', { 'class': 'navitem' }, 'Channels'),
        el('span', { 'class': 'navitem' }, 'Community'),
        el('span', { 'class': 'navitem' }, 'Upload'),
        el('span', { 'class': 'navitem' }, 'Sign Up'),
        here ? el('span', { 'class': 'm-here' }, here) : null));
  }

  function foot(ctx) {
    return ctx.el('div', { 'class': 'm-foot' },
      txt(ctx.site.description, '') + ' — archived copy, ' + txt(ctx.site.era, '') +
      '. Video files were not preserved.');
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
          num(item.views) + ' views  •  ' + txt(item.uploaded, 'some time ago'))));
  }

  /* ---------- index ---------- */

  function renderIndex(ctx) {
    var el = ctx.el, mount = ctx.mount, d = dat(ctx);
    ctx.title(txt(d.siteName, txt(ctx.site.title, ctx.site.domain)));
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

    mount.appendChild(el('div', { 'class': 'sec-head' }, 'Most Viewed This Week'));
    mount.appendChild(el('div', { 'class': 'grid' },
      list.map(function (it) { return card(ctx, it); })));

    var chans = channels(ctx);
    if (chans.length) {
      mount.appendChild(el('div', { 'class': 'sec-head' }, 'Channels'));
      mount.appendChild(el('div', { 'class': 'chanrow' },
        chans.map(function (c) {
          return el('div', { 'class': 'chanchip' },
            avatarBox(el, c.avatarSeed, c.name),
            el('div', { 'class': 'chanchip-id' },
              ctx.link('/channel/' + encodeURIComponent(txt(c.id)), txt(c.name, 'channel')),
              el('div', { 'class': 'dim' }, num(c.subscribers) + ' subscribers')));
        })));
    }

    mount.appendChild(foot(ctx));
  }

  /* ---------- watch ---------- */

  function playerBlock(ctx, item) {
    var el = ctx.el;
    var caption = el('div', { 'class': 'unavail' },
      'This clip is unavailable in the archive — only the page around it was saved. ' +
      'Nothing will play.');

    var play = el('a', {
      'class': 'play-btn',
      href: '#',
      title: 'Playback unavailable',
      onclick: function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        if (caption.className.indexOf('flash') === -1) caption.className += ' flash';
      }
    }, el('span', { 'class': 'play-tri' }, ''));

    return el('div', { 'class': 'player' },
      el('div', { 'class': 'player-frame', style: plateStyle(txt(item.thumbSeed, item.id)) },
        el('div', { 'class': 'frame-grain' }, ''),
        play,
        el('div', { 'class': 'stillnote' }, 'still frame')),
      el('div', { 'class': 'controls' },
        el('span', { 'class': 'ctl' }, el('span', { 'class': 'ctl-tri' }, '')),
        el('span', { 'class': 'scrub' }, el('span', { 'class': 'scrub-fill' }, ''),
          el('span', { 'class': 'scrub-knob' }, '')),
        el('span', { 'class': 'times' }, '0:00 / ' + txt(item.duration, '--:--')),
        el('span', { 'class': 'ctl vol' }, '')),
      caption);
  }

  function renderWatch(ctx, id) {
    var el = ctx.el, mount = ctx.mount;
    var item = findItem(ctx, id);
    if (!item) return render404(ctx, 'This video is no longer available.');

    var chan = channelOfItem(ctx, item);
    ctx.title(txt(item.title, 'Video') + ' — ' + txt(dat(ctx).siteName, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Watch'));

    var main = el('div', { 'class': 'watch-main' });
    main.appendChild(playerBlock(ctx, item));
    main.appendChild(el('h1', { 'class': 'vtitle' }, txt(item.title, 'Untitled clip')));
    main.appendChild(el('div', { 'class': 'vmeta' },
      num(item.views) + ' views  •  Added ' + txt(item.uploaded, 'some time ago')));

    var subBtn = el('button', {
      'class': 'subscribe', type: 'button',
      onclick: function () {
        var on = subBtn.className.indexOf('on') !== -1;
        subBtn.className = on ? 'subscribe' : 'subscribe on';
        while (subBtn.firstChild) subBtn.removeChild(subBtn.firstChild);
        subBtn.appendChild(document.createTextNode(on ? 'Subscribe' : 'Unsubscribe'));
      }
    }, 'Subscribe');

    main.appendChild(el('div', { 'class': 'uploader-row' },
      avatarBox(el, chan ? chan.avatarSeed : item.thumbSeed, txt(item.uploader, chan ? chan.name : '?')),
      el('div', { 'class': 'u-id' },
        item.channelId
          ? ctx.link('/channel/' + encodeURIComponent(txt(item.channelId)), txt(item.uploader, 'unknown'), 'u-name')
          : el('span', { 'class': 'u-name' }, txt(item.uploader, 'unknown')),
        el('div', { 'class': 'dim' },
          chan ? num(chan.subscribers) + ' subscribers' : 'no channel on record')),
      subBtn));

    var desc = el('div', { 'class': 'desc' });
    var frag = ctx.markup(txt(item.description));
    if (frag) desc.appendChild(frag);
    main.appendChild(el('div', { 'class': 'descbox' },
      el('div', { 'class': 'desc-head' }, 'Description'), desc));

    var comments = arr(item.comments);
    var clist = el('div', { 'class': 'comments' },
      el('div', { 'class': 'sec-head small' },
        num(comments.length) + ' comment' + (comments.length === 1 ? '' : 's')));
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
            el('span', { 'class': 'c-time' }, txt(c.time))),
          body)));
    });
    clist.appendChild(el('div', { 'class': 'c-postbox' },
      el('span', { 'class': 'c-input' }, ''),
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

    ctx.title(txt(chan.name, 'Channel') + ' — ' + txt(dat(ctx).siteName, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Channel'));

    mount.appendChild(el('div', { 'class': 'chan-banner', style: plateStyle(txt(chan.avatarSeed, chan.id)) },
      el('span', { 'class': 'frame-grain' }, '')));

    var about = el('div', { 'class': 'chan-about' });
    var af = ctx.markup(txt(chan.about, 'No description given.'));
    if (af) about.appendChild(af);

    mount.appendChild(el('div', { 'class': 'chan-head' },
      avatarBox(el, chan.avatarSeed, chan.name, 'big'),
      el('div', { 'class': 'chan-id' },
        el('div', { 'class': 'chan-name' }, txt(chan.name, 'Channel')),
        el('div', { 'class': 'chan-subs' }, num(chan.subscribers) + ' subscribers'),
        about),
      el('span', { 'class': 'subscribe' }, 'Subscribe')));

    var mine = items(ctx).filter(function (it) {
      return String(it.channelId) === String(chan.id);
    });

    mount.appendChild(el('div', { 'class': 'sec-head' },
      num(mine.length) + ' video' + (mine.length === 1 ? '' : 's')));
    if (!mine.length) {
      mount.appendChild(el('div', { 'class': 'blank' }, 'This channel has no archived videos.'));
    } else {
      mount.appendChild(el('div', { 'class': 'grid' },
        mine.map(function (it) { return card(ctx, it); })));
    }

    mount.appendChild(el('div', { 'class': 'backrow' }, ctx.link('/', '« Back to home')));
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
    return render404(ctx, 'The page you asked for is not in the archive.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('media', renderMedia);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['media', renderMedia]);
  }
}());
