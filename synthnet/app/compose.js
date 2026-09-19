window.SYNTH = window.SYNTH || {};

/* compose.js -- being a user instead of a reader.
   Composer box, post rendering with derived bot replies, my-posts list,
   and the profile card with fame tier. ES5-safe, no innerHTML anywhere. */

(function () {
  var S = window.SYNTH;
  S.compose = S.compose || {};

  var MAX = 480;

  /* ---------- small helpers ---------- */

  function E(ctx) {
    return (ctx && ctx.el) || S.el;
  }

  function txt(s) {
    return document.createTextNode(s == null ? '' : String(s));
  }

  function num(n) {
    if (typeof n !== 'number' || !isFinite(n)) return 0;
    return n;
  }

  function fmt(n) {
    n = num(n);
    if (S.live && typeof S.live.short === 'function') {
      try { return S.live.short(n); } catch (e) {}
    }
    return String(n);
  }

  function commas(n) {
    n = num(n);
    if (S.live && typeof S.live.commas === 'function') {
      try { return S.live.commas(n); } catch (e) {}
    }
    return String(n);
  }

  function ago(ms) {
    if (S.live && typeof S.live.ago === 'function') {
      try { return S.live.ago(ms); } catch (e) {}
    }
    return 'just now';
  }

  function nowms() {
    if (S.live && typeof S.live.now === 'function') {
      try { return S.live.now(); } catch (e) {}
    }
    return Date.now();
  }

  function avatar(seed, kind) {
    if (S.markup && typeof S.markup.placeholder === 'function') {
      try { return S.markup.placeholder(kind || 'avatar', String(seed || 'anon')); } catch (e) {}
    }
    return txt('');
  }

  function body(ctx, text) {
    var m = (ctx && ctx.markup) || S.markup;
    if (m && typeof m.parse === 'function') {
      try { return m.parse(String(text == null ? '' : text)); } catch (e) {}
    }
    return txt(text);
  }

  function badge(kind) {
    if (S.liveui && typeof S.liveui.badge === 'function') {
      try {
        var b = S.liveui.badge(kind);
        if (b) return b;
      } catch (e) {}
    }
    return null;
  }

  function profile() {
    if (S.me && typeof S.me.profile === 'function') {
      try { return S.me.profile() || null; } catch (e) {}
    }
    return null;
  }

  function exists() {
    if (S.me && typeof S.me.exists === 'function') {
      try { return !!S.me.exists(); } catch (e) {}
    }
    return false;
  }

  function repliesFor(post) {
    if (S.bots && typeof S.bots.repliesFor === 'function') {
      try {
        var r = S.bots.repliesFor(post);
        if (r && r.length) return r;
      } catch (e) {}
    }
    return [];
  }

  function domainLabel(domain) {
    return String(domain || 'synthnet');
  }

  /* ---------- composer ---------- */

  /* Sign-up form, shown when there is no account yet. */
  function signUpForm(ctx, domain, onDone) {
    var el = E(ctx);

    var wrap = el('div', { 'class': 'cw-box cw-signup' });
    wrap.appendChild(el('div', { 'class': 'cw-signup-head' },
      el('strong', null, txt('Create an account')),
      el('span', { 'class': 'cw-sub' },
        txt('One identity, every site. Stored on this device.'))));

    var handle = el('input', {
      'class': 'cw-input', type: 'text', maxlength: '20',
      placeholder: 'handle', autocapitalize: 'off',
      autocorrect: 'off', spellcheck: 'false'
    });
    var name = el('input', {
      'class': 'cw-input', type: 'text', maxlength: '40',
      placeholder: 'display name'
    });
    var bio = el('textarea', {
      'class': 'cw-input cw-bio', rows: '2', maxlength: '160',
      placeholder: 'bio (optional)'
    });

    function field(labelText, prefix, input) {
      var row = el('label', { 'class': 'cw-field' });
      row.appendChild(el('span', { 'class': 'cw-label' }, txt(labelText)));
      if (prefix) {
        var g = el('span', { 'class': 'cw-prefixed' },
          el('span', { 'class': 'cw-prefix' }, txt(prefix)), input);
        row.appendChild(g);
      } else {
        row.appendChild(input);
      }
      return row;
    }

    wrap.appendChild(field('Handle', '@', handle));
    wrap.appendChild(field('Name', null, name));
    wrap.appendChild(field('Bio', null, bio));

    var err = el('div', { 'class': 'cw-err', role: 'alert' });
    wrap.appendChild(err);

    var go = el('button', { 'class': 'cw-btn', type: 'button' }, txt('Sign up'));
    wrap.appendChild(el('div', { 'class': 'cw-actions' }, go));

    function fail(msg) {
      while (err.firstChild) err.removeChild(err.firstChild);
      err.appendChild(txt(msg));
    }

    go.onclick = function () {
      var h = String(handle.value || '').replace(/^@+/, '').trim();
      var n = String(name.value || '').trim();
      if (!h) { fail('Pick a handle first.'); handle.focus(); return; }
      if (!/^[a-zA-Z0-9_]{2,20}$/.test(h)) {
        fail('Handles are 2-20 letters, numbers or underscores.');
        handle.focus();
        return;
      }
      if (!S.me || typeof S.me.signUp !== 'function') {
        fail('Accounts are unavailable right now.');
        return;
      }
      go.disabled = true;
      fail('');
      var p;
      try {
        p = S.me.signUp({ handle: h, name: n || h, bio: String(bio.value || '').trim() });
      } catch (e) {
        go.disabled = false;
        fail('Could not create the account.');
        return;
      }
      if (p && typeof p.then === 'function') {
        p.then(function () { if (onDone) onDone(); }, function () {
          go.disabled = false;
          fail('Could not create the account.');
        });
      } else if (onDone) {
        onDone();
      }
    };

    return wrap;
  }

  /* The composer box. */
  S.compose.box = function (ctx, domain, onPosted) {
    var el = E(ctx);
    var host = el('div', { 'class': 'cw-root' });

    function paint() {
      while (host.firstChild) host.removeChild(host.firstChild);
      if (!exists()) {
        host.appendChild(signUpForm(ctx, domain, paint));
        return;
      }
      host.appendChild(composerBody(ctx, domain, onPosted));
    }

    paint();
    return host;
  };

  function composerBody(ctx, domain, onPosted) {
    var el = E(ctx);
    var me = profile() || {};

    var wrap = el('div', { 'class': 'cw-box cw-composer' });

    var head = el('div', { 'class': 'cw-c-head' });
    head.appendChild(el('span', { 'class': 'cw-avatar cw-avatar-sm' },
      avatar(me.avatarSeed || me.handle || 'me')));
    head.appendChild(el('span', { 'class': 'cw-handle' }, txt('@' + (me.handle || 'you'))));
    head.appendChild(el('span', { 'class': 'cw-to' }, txt('posting to ' + domainLabel(domain))));
    wrap.appendChild(head);

    var ta = el('textarea', {
      'class': 'cw-ta',
      rows: '3',
      placeholder: 'Say something into 2026.',
      'aria-label': 'Write a post'
    });
    wrap.appendChild(ta);

    var count = el('span', { 'class': 'cw-count', 'aria-live': 'polite' });
    var post = el('button', { 'class': 'cw-btn', type: 'button' }, txt('Post'));
    var status = el('div', { 'class': 'cw-status', role: 'status' });

    var foot = el('div', { 'class': 'cw-c-foot' }, count, post);
    wrap.appendChild(foot);
    wrap.appendChild(status);

    function setCount() {
      var n = String(ta.value || '').length;
      while (count.firstChild) count.removeChild(count.firstChild);
      count.appendChild(txt(n + ' / ' + MAX));
      var over = n > MAX;
      count.className = 'cw-count' + (over ? ' cw-over' : (n > MAX - 60 ? ' cw-near' : ''));
      post.disabled = over || n === 0;
    }

    function say(msg) {
      while (status.firstChild) status.removeChild(status.firstChild);
      if (msg) status.appendChild(txt(msg));
    }

    ta.oninput = setCount;
    ta.onkeyup = setCount;
    setCount();

    post.onclick = function () {
      var text = String(ta.value || '').trim();
      if (!text || text.length > MAX) return;
      if (!S.me || typeof S.me.addPost !== 'function') {
        say('Posting is unavailable right now.');
        return;
      }
      post.disabled = true;
      say('Posting...');
      var p;
      try {
        p = S.me.addPost(domain, text);
      } catch (e) {
        post.disabled = false;
        say('That did not go through.');
        return;
      }
      function done(made) {
        ta.value = '';
        setCount();
        say('Posted.');
        if (onPosted) {
          try { onPosted(made || null); } catch (e2) {}
        }
      }
      if (p && typeof p.then === 'function') {
        p.then(done, function () {
          post.disabled = false;
          say('That did not go through.');
        });
      } else {
        done(p);
      }
    };

    return wrap;
  }

  /* ---------- one post ---------- */

  S.compose.postNode = function (ctx, post, opts) {
    var el = E(ctx);
    opts = opts || {};
    post = post || {};
    var me = profile() || {};

    var likes = num(post.likes);
    var reposts = num(post.reposts);
    var replies = repliesFor(post);
    var replyCount = replies.length;

    var cls = 'cw-post';
    if (post.viral) cls += ' cw-viral';
    if (post.ratioed) cls += ' cw-ratioed';

    var node = el('article', { 'class': cls });

    /* header */
    var head = el('header', { 'class': 'cw-p-head' });
    head.appendChild(el('span', { 'class': 'cw-avatar' },
      avatar(me.avatarSeed || me.handle || 'me')));

    var who = el('div', { 'class': 'cw-who' });
    var nameRow = el('div', { 'class': 'cw-namerow' },
      el('span', { 'class': 'cw-name' }, txt(me.name || me.handle || 'You')));
    if (me.verified || me.verifiedPaid) {
      nameRow.appendChild(el('span', {
        'class': 'cw-check' + (me.verifiedPaid && !me.verified ? ' cw-check-paid' : ''),
        title: me.verifiedPaid && !me.verified ? 'Paid check' : 'Verified'
      }, txt('✓')));
    }
    who.appendChild(nameRow);

    var meta = el('div', { 'class': 'cw-meta' },
      el('span', { 'class': 'cw-handle' }, txt('@' + (me.handle || 'you'))),
      el('span', { 'class': 'cw-dot' }, txt('·')),
      el('time', { 'class': 'cw-time' }, txt(ago(post.at || nowms()))));
    if (opts.showDomain !== false && post.domain) {
      meta.appendChild(el('span', { 'class': 'cw-dot' }, txt('·')));
      meta.appendChild(el('span', { 'class': 'cw-domain' }, txt(domainLabel(post.domain))));
    }
    who.appendChild(meta);
    head.appendChild(who);

    if (post.viral) {
      head.appendChild(el('span', { 'class': 'cw-flare', title: 'This one got away from you' },
        txt('▲ trending')));
    }
    node.appendChild(head);

    /* body */
    node.appendChild(el('div', { 'class': 'cw-body' }, body(ctx, post.body)));

    /* engagement */
    var eng = el('div', { 'class': 'cw-eng' });
    function stat(label, value, extra) {
      return el('span', { 'class': 'cw-stat' + (extra ? ' ' + extra : '') },
        el('span', { 'class': 'cw-stat-n' }, txt(fmt(value))),
        el('span', { 'class': 'cw-stat-l' }, txt(label)));
    }
    eng.appendChild(stat(replyCount === 1 ? 'reply' : 'replies', replyCount,
      post.ratioed ? 'cw-stat-hot' : ''));
    eng.appendChild(stat(reposts === 1 ? 'repost' : 'reposts', reposts));
    eng.appendChild(stat(likes === 1 ? 'like' : 'likes', likes));
    if (num(post.followerDelta) !== 0) {
      var d = num(post.followerDelta);
      eng.appendChild(el('span', {
        'class': 'cw-delta ' + (d > 0 ? 'cw-delta-up' : 'cw-delta-down')
      }, txt((d > 0 ? '+' : '') + commas(d) + ' followers')));
    }
    node.appendChild(eng);

    if (post.ratioed && replyCount > likes) {
      node.appendChild(el('div', { 'class': 'cw-ratio-note' },
        txt(commas(replyCount) + ' replies against ' + commas(likes) +
            ' likes. You have been ratioed.')));
    }

    if (post.analysis) {
      node.appendChild(el('div', { 'class': 'cw-analysis' }, txt(String(post.analysis))));
    }

    /* replies */
    if (replyCount) {
      var list = el('div', { 'class': 'cw-replies' });
      for (var i = 0; i < replies.length; i++) {
        list.appendChild(replyNode(ctx, replies[i]));
      }
      node.appendChild(list);
    } else if (opts.quietWhenEmpty !== true) {
      node.appendChild(el('div', { 'class': 'cw-quiet' }, txt('No replies yet. Give it a minute.')));
    }

    return node;
  };

  function replyNode(ctx, r) {
    var el = E(ctx);
    r = r || {};
    var kind = r.kind || 'bot';
    var row = el('div', { 'class': 'cw-reply cw-reply-' + String(kind).replace(/[^a-z]/gi, '') });

    row.appendChild(el('span', { 'class': 'cw-avatar cw-avatar-sm' },
      avatar(r.avatarSeed || r.handle || r.name || 'bot')));

    var main = el('div', { 'class': 'cw-r-main' });

    var line = el('div', { 'class': 'cw-r-head' },
      el('span', { 'class': 'cw-r-name' }, txt(r.name || r.handle || 'someone')));
    if (r.handle && r.name) {
      line.appendChild(el('span', { 'class': 'cw-handle' }, txt('@' + r.handle)));
    }
    var b = badge(kind);
    if (b) line.appendChild(b);
    if (r.at) {
      line.appendChild(el('span', { 'class': 'cw-dot' }, txt('·')));
      line.appendChild(el('time', { 'class': 'cw-time' }, txt(ago(r.at))));
    }
    main.appendChild(line);

    main.appendChild(el('div', { 'class': 'cw-r-body' }, body(ctx, r.body || r.text)));

    if (num(r.likes) > 0) {
      main.appendChild(el('div', { 'class': 'cw-r-eng' }, txt(fmt(r.likes) + ' likes')));
    }

    row.appendChild(main);
    return row;
  }

  /* ---------- my posts ---------- */

  S.compose.myPosts = function (ctx, domain) {
    var el = E(ctx);
    var wrap = el('div', { 'class': 'cw-root cw-feed' });

    var list = [];
    if (S.me && typeof S.me.posts === 'function') {
      try { list = S.me.posts(domain) || []; } catch (e) { list = []; }
    }
    list = list.slice(0);
    list.sort(function (a, b) { return num(b && b.at) - num(a && a.at); });

    if (!list.length) {
      wrap.appendChild(el('div', { 'class': 'cw-box cw-empty' },
        txt('Nothing here yet. The feed only knows what you put in it.')));
      return wrap;
    }

    for (var i = 0; i < list.length; i++) {
      wrap.appendChild(S.compose.postNode(ctx, list[i], { showDomain: !domain }));
    }
    return wrap;
  };

  /* ---------- profile card ---------- */

  function tierInfo(p) {
    var out = { name: 'Unknown', index: 0, progress: 0, next: null, milestone: null };
    if (!S.fame || typeof S.fame.tierFor !== 'function') return out;
    var t;
    try { t = S.fame.tierFor(p); } catch (e) { return out; }
    if (!t) return out;
    if (typeof t === 'string') { out.name = t; return out; }
    out.name = t.name || t.label || t.title || out.name;
    out.index = num(t.index);
    out.next = t.next || t.nextName || null;
    if (typeof out.next === 'object' && out.next) {
      out.next = out.next.name || out.next.label || null;
    }
    var prog = t.progress;
    if (typeof prog !== 'number' && typeof t.toNext === 'number' && typeof t.at === 'number') {
      prog = t.toNext > 0 ? t.at / t.toNext : 1;
    }
    if (typeof prog === 'number' && isFinite(prog)) {
      if (prog > 1) prog = prog / 100;
      out.progress = Math.max(0, Math.min(1, prog));
    }
    out.blurb = t.blurb || t.desc || null;
    return out;
  }

  function latestMilestone(p) {
    if (!S.fame) return null;
    var list = null;
    try {
      if (typeof S.fame.milestones === 'function') list = S.fame.milestones(p);
      else if (typeof S.fame.unlocked === 'function') list = S.fame.unlocked(p);
    } catch (e) { return null; }
    if (!list || !list.length) return null;
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m) continue;
      if (m.unlocked === false) continue;
      if (!best || num(m.at) >= num(best.at)) best = m;
    }
    if (!best) return null;
    return {
      name: best.name || best.label || best.title || 'Milestone',
      note: best.note || best.desc || best.blurb || '',
      at: num(best.at)
    };
  }

  S.compose.profileCard = function (ctx) {
    var el = E(ctx);
    var wrap = el('div', { 'class': 'cw-root' });

    if (!exists()) {
      wrap.appendChild(el('div', { 'class': 'cw-box cw-empty' },
        txt('No account on this device yet.')));
      return wrap;
    }

    var p = profile() || {};
    var card = el('div', { 'class': 'cw-box cw-profile' });

    var top = el('div', { 'class': 'cw-p-top' });
    top.appendChild(el('span', { 'class': 'cw-avatar cw-avatar-lg' },
      avatar(p.avatarSeed || p.handle || 'me')));

    var id = el('div', { 'class': 'cw-id' });
    var nrow = el('div', { 'class': 'cw-namerow' },
      el('span', { 'class': 'cw-name cw-name-lg' }, txt(p.name || p.handle || 'You')));
    if (p.verified || p.verifiedPaid) {
      nrow.appendChild(el('span', {
        'class': 'cw-check' + (p.verifiedPaid && !p.verified ? ' cw-check-paid' : ''),
        title: p.verifiedPaid && !p.verified ? 'Paid check' : 'Verified'
      }, txt('✓')));
    }
    id.appendChild(nrow);
    id.appendChild(el('div', { 'class': 'cw-handle' }, txt('@' + (p.handle || 'you'))));
    top.appendChild(id);
    card.appendChild(top);

    if (p.bio) {
      card.appendChild(el('div', { 'class': 'cw-p-bio' }, body(ctx, p.bio)));
    }

    var counts = el('div', { 'class': 'cw-counts' });
    function count(n, label) {
      return el('span', { 'class': 'cw-count-item' },
        el('strong', null, txt(commas(n))),
        el('span', { 'class': 'cw-count-l' }, txt(label)));
    }
    counts.appendChild(count(p.followers, 'followers'));
    counts.appendChild(count(p.following, 'following'));
    counts.appendChild(count(p.postCount, p.postCount === 1 ? 'post' : 'posts'));
    if (num(p.totalLikes) > 0) counts.appendChild(count(p.totalLikes, 'likes'));
    if (num(p.ratios) > 0) counts.appendChild(count(p.ratios, p.ratios === 1 ? 'ratio' : 'ratios'));
    card.appendChild(counts);

    var t = tierInfo(p);
    var fame = el('div', { 'class': 'cw-fame' });
    fame.appendChild(el('div', { 'class': 'cw-fame-head' },
      el('span', { 'class': 'cw-tier' }, txt(t.name)),
      el('span', { 'class': 'cw-tier-next' },
        txt(t.next ? 'next: ' + t.next : 'top of the ladder'))));

    var pct = Math.round(t.progress * 100);
    var bar = el('div', {
      'class': 'cw-bar',
      role: 'progressbar',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(pct),
      'aria-label': 'Progress to next fame tier'
    });
    var fill = el('div', { 'class': 'cw-bar-fill' });
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    fame.appendChild(bar);
    fame.appendChild(el('div', { 'class': 'cw-bar-pct' }, txt(pct + '% of the way there')));
    if (t.blurb) fame.appendChild(el('div', { 'class': 'cw-tier-blurb' }, txt(String(t.blurb))));
    card.appendChild(fame);

    var m = latestMilestone(p);
    if (m) {
      var mi = el('div', { 'class': 'cw-milestone' });
      mi.appendChild(el('span', { 'class': 'cw-mi-tag' }, txt('unlocked')));
      mi.appendChild(el('span', { 'class': 'cw-mi-name' }, txt(m.name)));
      if (m.note) mi.appendChild(el('span', { 'class': 'cw-mi-note' }, txt(m.note)));
      if (m.at) mi.appendChild(el('span', { 'class': 'cw-mi-when' }, txt(ago(m.at))));
      card.appendChild(mi);
    }

    if (p.joined) {
      card.appendChild(el('div', { 'class': 'cw-joined' },
        txt('Joined ' + ago(p.joined) + ' ago, by this device’s reckoning.')));
    }

    wrap.appendChild(card);
    return wrap;
  };
})();
