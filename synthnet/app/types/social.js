/* SYNTHNET :: social renderer
   paths: /  |  /user/<handle>  |  /post/<postId>
   No modules, no innerHTML, no network. Everything hangs off window.SYNTH. */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  var COLLAPSE_AFTER = 3;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
             'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  function tint(seed) { return 'hsl(' + (hash(seed) % 360) + ', 40%, 62%)'; }

  function initials(name) {
    var clean = String(name == null ? '' : name).replace(/[^A-Za-z0-9 ]/g, ' ').trim();
    if (!clean) return '?';
    var parts = clean.split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function avatar(el, seed, name, cls) {
    return el('span', {
      'class': 'av' + (cls ? ' ' + cls : ''),
      style: 'background:' + tint(txt(seed, name)) + ';',
      title: txt(name)
    }, initials(name));
  }

  function parseTime(t) {
    var s = String(t == null ? '' : t).trim();
    if (!s) return NaN;
    var ms = Date.parse(s);
    if (!isFinite(ms)) ms = Date.parse(s.replace(' ', 'T'));
    return ms;
  }

  /* a relative-looking stamp, measured against the newest thing in the feed */
  function stamp(t, base) {
    var ms = parseTime(t);
    if (!isFinite(ms) || !isFinite(base)) return txt(t);
    var diff = base - ms;
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return mins + 'm';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd';
    var d = new Date(ms);
    var label = MON[d.getMonth()] + ' ' + d.getDate();
    if (d.getFullYear() !== new Date(base).getFullYear()) label += ', ' + d.getFullYear();
    return label;
  }

  function dat(ctx) { return (ctx.site && ctx.site.data) ? ctx.site.data : {}; }
  function feed(ctx) { return arr(dat(ctx).feed); }
  function profile(ctx) { return dat(ctx).profile || {}; }
  function friends(ctx) { return arr(dat(ctx).friends); }

  function newestTime(ctx) {
    var best = NaN;
    feed(ctx).forEach(function (p) {
      var ms = parseTime(p.time);
      if (isFinite(ms) && (!isFinite(best) || ms > best)) best = ms;
      arr(p.replies).forEach(function (r) {
        var rms = parseTime(r.time);
        if (isFinite(rms) && (!isFinite(best) || rms > best)) best = rms;
      });
    });
    return best;
  }

  function findPost(ctx, id) {
    var list = feed(ctx), i;
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function normHandle(h) {
    return String(h == null ? '' : h).replace(/^@/, '').toLowerCase();
  }

  function postsByHandle(ctx, handle) {
    var want = normHandle(handle);
    return feed(ctx).filter(function (p) { return normHandle(p.handle) === want; });
  }

  function atHandle(h) {
    var s = txt(h);
    if (!s) return '';
    return s.charAt(0) === '@' ? s : '@' + s;
  }

  /* ---------- chrome ---------- */

  function topBar(ctx, here) {
    var el = ctx.el, p = profile(ctx);
    return el('div', { 'class': 'sn-top' },
      el('div', { 'class': 'sn-brand' },
        ctx.link('/', txt(ctx.site.title, ctx.site.domain), 'brandlink')),
      el('div', { 'class': 'sn-nav' },
        ctx.link('/', 'Home'),
        p.handle ? ctx.link('/user/' + encodeURIComponent(normHandle(p.handle)), 'My Profile') : null,
        el('span', { 'class': 'navitem' }, 'Mail'),
        el('span', { 'class': 'navitem' }, 'Bulletins'),
        el('span', { 'class': 'navitem' }, 'Search'),
        el('span', { 'class': 'navitem' }, 'Sign Out')),
      here ? el('div', { 'class': 'sn-here' }, here) : null);
  }

  /* ---------- profile card ---------- */

  function profileCard(ctx) {
    var el = ctx.el, p = profile(ctx);
    var rows = [];
    function row(k, v) {
      if (!txt(v)) return;
      rows.push(el('div', { 'class': 'prow' },
        el('span', { 'class': 'pk' }, k),
        el('span', { 'class': 'pv' }, String(v))));
    }
    row('Location', p.location);
    row('Joined', p.joined);
    row('Mood', p.mood);

    return el('div', { 'class': 'pcard' },
      el('div', { 'class': 'pcard-head' },
        avatar(el, p.avatarSeed, txt(p.displayName, p.handle), 'big'),
        el('div', { 'class': 'pid' },
          el('div', { 'class': 'pname' }, txt(p.displayName, txt(p.handle, 'someone'))),
          el('div', { 'class': 'phandle' }, atHandle(p.handle)))),
      txt(p.bio) ? bioNode(ctx, p.bio) : null,
      el('div', { 'class': 'pmeta' }, rows),
      el('div', { 'class': 'pcounts' },
        el('span', { 'class': 'pcount' },
          el('strong', null, num(p.following)), ' Following'),
        el('span', { 'class': 'pcount' },
          el('strong', null, num(p.followers)), ' Followers')),
      el('div', { 'class': 'pactions' },
        el('span', { 'class': 'btn' }, 'Add to Friends'),
        el('span', { 'class': 'btn' }, 'Send Message')));
  }

  function friendsGrid(ctx) {
    var el = ctx.el, list = friends(ctx);
    if (!list.length) return null;
    var top = list.slice(0, 8);
    var cells = top.map(function (f) {
      return el('a', {
        'class': 'fcell',
        href: '#',
        onclick: function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          var h = normHandle(f.handle);
          if (h) SYNTH.engine.navigate('synth://' + ctx.site.domain + '/user/' + encodeURIComponent(h));
        }
      },
        avatar(el, f.avatarSeed, txt(f.displayName, f.handle)),
        el('span', { 'class': 'fname' }, txt(f.displayName, txt(f.handle, '?'))));
    });
    return el('div', { 'class': 'friends' },
      el('div', { 'class': 'friends-head' },
        txt(profile(ctx).displayName, 'This user') + "'s Top " + top.length + ' Friends',
        el('span', { 'class': 'fcountall' }, ' (' + num(list.length) + ' total)')),
      el('div', { 'class': 'fgrid' }, cells));
  }

  /* ---------- posts ---------- */

  function bioNode(ctx, bio) {
    var box = ctx.el('div', { 'class': 'pbio' });
    var frag = ctx.markup(String(bio));
    if (frag) box.appendChild(frag);
    return box;
  }

  function bodyNode(ctx, body) {
    var el = ctx.el, box = el('div', { 'class': 'p-text' });
    var frag = ctx.markup(txt(body));
    if (frag) box.appendChild(frag);
    return box;
  }

  function replyNode(ctx, r, base) {
    var el = ctx.el;
    return el('div', { 'class': 'reply' },
      avatar(el, r.avatarSeed, txt(r.author, r.handle)),
      el('div', { 'class': 'p-main' },
        el('div', { 'class': 'p-head' },
          el('span', { 'class': 'p-name' }, txt(r.author, txt(r.handle, 'someone'))),
          el('span', { 'class': 'p-handle' }, atHandle(r.handle)),
          el('span', { 'class': 'p-dot' }, ' · '),
          el('span', { 'class': 'p-time', title: txt(r.time) }, stamp(r.time, base))),
        bodyNode(ctx, r.body)));
  }

  function replyBlock(ctx, post, base, expandAll) {
    var el = ctx.el, reps = arr(post.replies);
    if (!reps.length) return null;
    var wrap = el('div', { 'class': 'replies' });
    var hidden = [];
    reps.forEach(function (r, i) {
      var node = replyNode(ctx, r, base);
      if (!expandAll && i >= COLLAPSE_AFTER) {
        node.className = node.className + ' hid';
        hidden.push(node);
      }
      wrap.appendChild(node);
    });
    if (hidden.length) {
      var btn = el('button', {
        'class': 'more-btn',
        type: 'button',
        onclick: function () {
          hidden.forEach(function (n) {
            n.className = n.className.replace(/\s*\bhid\b/, '');
          });
          if (btn.parentNode) btn.parentNode.removeChild(btn);
        }
      }, 'show ' + hidden.length + ' more repl' + (hidden.length === 1 ? 'y' : 'ies'));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function postNode(ctx, post, base, opts) {
    var el = ctx.el;
    opts = opts || {};
    var replyCount = arr(post.replies).length;

    var head = el('div', { 'class': 'p-head' },
      el('span', { 'class': 'p-name' },
        post.handle
          ? ctx.link('/user/' + encodeURIComponent(normHandle(post.handle)),
              txt(post.author, txt(post.handle, 'someone')))
          : txt(post.author, 'someone')),
      el('span', { 'class': 'p-handle' }, atHandle(post.handle)),
      el('span', { 'class': 'p-dot' }, ' · '),
      ctx.link('/post/' + encodeURIComponent(txt(post.id)),
        stamp(post.time, base), 'p-time'));

    var actions = el('div', { 'class': 'p-actions' },
      el('span', { 'class': 'act' }, el('b', null, num(replyCount)), ' replies'),
      el('span', { 'class': 'act' }, el('b', null, num(post.reposts)), ' reposts'),
      el('span', { 'class': 'act' }, el('b', null, num(post.likes)), ' likes'),
      opts.single ? null : ctx.link('/post/' + encodeURIComponent(txt(post.id)), 'permalink', 'act permalink'));

    return el('div', { 'class': 'post' + (opts.single ? ' single' : '') },
      el('div', { 'class': 'p-row' },
        avatar(el, post.avatarSeed, txt(post.author, post.handle)),
        el('div', { 'class': 'p-main' }, head, bodyNode(ctx, post.body), actions)),
      replyBlock(ctx, post, base, !!opts.single));
  }

  /* ---------- pages ---------- */

  function renderFeed(ctx) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var p = profile(ctx);
    ctx.title(txt(ctx.site.title, ctx.site.domain));

    mount.appendChild(topBar(ctx, null));

    var side = el('div', { 'class': 'sn-side' }, profileCard(ctx), friendsGrid(ctx));
    var main = el('div', { 'class': 'sn-main' });

    main.appendChild(el('div', { 'class': 'sn-compose' },
      el('div', { 'class': 'compose-label' }, 'What are you doing right now?'),
      el('div', { 'class': 'compose-box' }, ''),
      el('span', { 'class': 'btn dis' }, 'Post')));

    var list = feed(ctx);
    if (!list.length) {
      main.appendChild(el('div', { 'class': 'blank' }, 'Nothing here yet. Check back later.'));
    }
    list.forEach(function (post) {
      main.appendChild(postNode(ctx, post, base, {}));
    });

    mount.appendChild(el('div', { 'class': 'sn-layout' }, side, main));
    mount.appendChild(el('div', { 'class': 'sn-foot' },
      txt(ctx.site.description, '') + '  —  ' + txt(ctx.site.era, '')));
  }

  function renderUser(ctx, handle) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var p = profile(ctx);
    var want = normHandle(handle);
    var mine = normHandle(p.handle) === want;
    var posts = postsByHandle(ctx, want);

    if (!mine && !posts.length) {
      var known = friends(ctx).filter(function (f) { return normHandle(f.handle) === want; });
      if (!known.length) return render404(ctx, 'That profile could not be found.');
    }

    var display = mine
      ? txt(p.displayName, txt(p.handle, want))
      : (posts.length ? txt(posts[0].author, want) : (function () {
          var f = friends(ctx).filter(function (x) { return normHandle(x.handle) === want; })[0];
          return f ? txt(f.displayName, want) : want;
        }()));

    var seed = mine ? p.avatarSeed : (posts.length ? posts[0].avatarSeed : want);

    ctx.title(display + ' (' + atHandle(want) + ')');
    mount.appendChild(topBar(ctx, atHandle(want)));

    var head = el('div', { 'class': 'profile-head' },
      el('div', { 'class': 'ph-banner' }, ''),
      el('div', { 'class': 'ph-row' },
        avatar(el, seed, display, 'big'),
        el('div', { 'class': 'ph-id' },
          el('div', { 'class': 'pname' }, display),
          el('div', { 'class': 'phandle' }, atHandle(want)),
          mine && txt(p.bio) ? bioNode(ctx, p.bio) : null,
          el('div', { 'class': 'pcounts' },
            el('span', { 'class': 'pcount' },
              el('strong', null, num(mine ? p.following : 10 + (hash(want) % 240))), ' Following'),
            el('span', { 'class': 'pcount' },
              el('strong', null, num(mine ? p.followers : 4 + (hash(want + 'f') % 900))), ' Followers'),
            el('span', { 'class': 'pcount' },
              el('strong', null, num(posts.length)), ' Posts'))),
        el('span', { 'class': 'btn' }, mine ? 'Edit Profile' : 'Add to Friends')));

    var side = el('div', { 'class': 'sn-side' }, mine ? profileCard(ctx) : null, friendsGrid(ctx));
    var main = el('div', { 'class': 'sn-main' }, head);

    if (!posts.length) {
      main.appendChild(el('div', { 'class': 'blank' }, 'This user has not posted anything yet.'));
    }
    posts.forEach(function (post) { main.appendChild(postNode(ctx, post, base, {})); });

    mount.appendChild(el('div', { 'class': 'sn-layout' }, side, main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  function renderPost(ctx, id) {
    var el = ctx.el, mount = ctx.mount, base = newestTime(ctx);
    var post = findPost(ctx, id);
    if (!post) return render404(ctx, 'That post has been deleted or never existed.');

    ctx.title(txt(post.author, 'post') + ' on ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Post'));

    var main = el('div', { 'class': 'sn-main' },
      el('div', { 'class': 'crumbline' },
        ctx.link('/', 'Feed'),
        el('span', { 'class': 'sepa' }, ' › '),
        el('span', { 'class': 'here' }, txt(post.author, 'post'))),
      postNode(ctx, post, base, { single: true }),
      el('div', { 'class': 'p-fulltime' }, 'Posted ' + txt(post.time, 'at some point')));

    mount.appendChild(el('div', { 'class': 'sn-layout' },
      el('div', { 'class': 'sn-side' }, profileCard(ctx), friendsGrid(ctx)),
      main));
    mount.appendChild(el('div', { 'class': 'sn-foot' }, ctx.link('/', '« back to the feed')));
  }

  function render404(ctx, msg) {
    var el = ctx.el, mount = ctx.mount;
    ctx.title('Not Found :: ' + txt(ctx.site.title, ctx.site.domain));
    mount.appendChild(topBar(ctx, 'Oops'));
    mount.appendChild(el('div', { 'class': 'err' },
      el('h2', null, 'Sorry! This page is not available.'),
      el('p', null, txt(msg, 'The link you followed may be broken, or the page may have been removed.')),
      el('p', null, ctx.link('/', 'Go back to the home feed'))));
  }

  /* ---------- entry point ---------- */

  function renderSocial(ctx) {
    var path = arr(ctx.path);
    if (!path.length) return renderFeed(ctx);
    if (path[0] === 'user' && path.length >= 2) return renderUser(ctx, path[1]);
    if (path[0] === 'post' && path.length >= 2) return renderPost(ctx, path[1]);
    return render404(ctx, 'We could not find that page.');
  }

  if (window.SYNTH.render && window.SYNTH.render.register) {
    window.SYNTH.render.register('social', renderSocial);
  } else {
    window.SYNTH._deferredRenderers = window.SYNTH._deferredRenderers || [];
    window.SYNTH._deferredRenderers.push(['social', renderSocial]);
  }
}());
