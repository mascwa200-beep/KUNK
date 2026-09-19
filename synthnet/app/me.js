/* me.js -- you, on VerityNet.
 *
 * Until now nothing in synthnet knew a reader existed. This is the account:
 * who you are, what you have posted, and how many people the simulation
 * believes are watching.
 *
 * The design rule that keeps this from becoming a database: store only what
 * cannot be derived. A post stores its text, its time and the numbers that
 * were rolled for it. It does NOT store its bot replies, because those are a
 * pure function of (post id, post text, elapsed time) -- exactly like the rest
 * of the live layer. That means replies keep arriving after you close the app,
 * with nothing written down, and a post you made last week has a week of
 * replies on it when you come back.
 *
 * Contracts other files depend on, so they are stated once here:
 *
 *   PROFILE = { handle, name, avatarSeed, bio, joined,
 *               followers, following, verified, verifiedPaid,
 *               postCount, totalLikes, ratios }
 *
 *   POST    = { id, at, domain, body,
 *               likes, reposts, followerDelta, viral, ratioed,
 *               analysis }        <- whatever SYNTH.bots.analyse returned
 *
 * Replies are never a field on POST. Ask SYNTH.bots.repliesFor(post) instead.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  var COL = 'me';
  var POSTS = 'posts';
  var PROFILE_KEY = 'profile';

  var cached = null;

  function store() { return SYNTH.store; }

  function nowMs() {
    return (SYNTH.live && SYNTH.live.now) ? SYNTH.live.now() : Date.now();
  }

  function cleanHandle(h) {
    return String(h || '').replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  }

  function defaults(handle, name, bio) {
    return {
      handle: cleanHandle(handle) || 'you',
      name: String(name || '').slice(0, 40) || 'You',
      avatarSeed: cleanHandle(handle) || 'you',
      bio: String(bio || '').slice(0, 220),
      joined: nowMs(),
      /* Twelve, because everybody starts with about twelve, and on VerityNet
       * most of them are not people. */
      followers: 12,
      following: 31,
      verified: false,
      verifiedPaid: false,
      postCount: 0,
      totalLikes: 0,
      ratios: 0
    };
  }

  function load() {
    cached = store().get(COL, PROFILE_KEY, null);
    return cached;
  }

  function save(profile) {
    cached = profile;
    return store().put(COL, PROFILE_KEY, profile);
  }

  SYNTH.me = {
    ready: function () {
      return store().ready().then(function () { load(); return cached; });
    },

    exists: function () { return !!(cached || load()); },

    profile: function () { return cached || load(); },

    signUp: function (opts) {
      opts = opts || {};
      var p = defaults(opts.handle, opts.name, opts.bio);
      return save(p).then(function () { return p; }, function () { return p; });
    },

    update: function (patch) {
      var p = SYNTH.me.profile();
      if (!p) return Promise.resolve(null);
      for (var k in patch) {
        if (Object.prototype.hasOwnProperty.call(patch, k)) p[k] = patch[k];
      }
      return save(p).then(function () { return p; }, function () { return p; });
    },

    /* Newest first. Optionally filtered to one site. */
    posts: function (domain) {
      var rows = store().all(POSTS).map(function (r) { return r.value; });
      if (domain) {
        rows = rows.filter(function (p) { return p && p.domain === domain; });
      }
      rows.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return rows;
    },

    post: function (id) {
      return store().get(POSTS, id, null);
    },

    /* The main event. Writes the post, asks the fame model what it did, and
     * folds the result back into the profile.
     *
     * Deliberately does not generate replies here: they are derived on read,
     * so they continue to accumulate while the app is closed. */
    addPost: function (domain, body) {
      var p = SYNTH.me.profile();
      if (!p) return Promise.reject(new Error('no account yet'));

      var text = String(body || '').trim();
      if (!text) return Promise.reject(new Error('empty post'));

      var at = nowMs();
      var id = 'p' + at.toString(36) + Math.floor((at % 997)).toString(36);

      var analysis = (SYNTH.bots && SYNTH.bots.analyse)
        ? SYNTH.bots.analyse(text) : null;

      var scored = (SYNTH.fame && SYNTH.fame.score)
        ? SYNTH.fame.score({ text: text, analysis: analysis, profile: p, at: at, id: id })
        : { likes: 0, reposts: 0, followerDelta: 0, viral: false, ratioed: false };

      var post = {
        id: id,
        at: at,
        domain: String(domain || 'pulse.gridfall.net'),
        body: text,
        likes: scored.likes || 0,
        reposts: scored.reposts || 0,
        followerDelta: scored.followerDelta || 0,
        viral: !!scored.viral,
        ratioed: !!scored.ratioed,
        analysis: analysis
      };

      p.postCount = (p.postCount || 0) + 1;
      p.totalLikes = (p.totalLikes || 0) + post.likes;
      p.followers = Math.max(0, (p.followers || 0) + post.followerDelta);
      if (post.ratioed) p.ratios = (p.ratios || 0) + 1;

      return store().put(POSTS, id, post)
        .then(function () { return save(p); }, function () { return save(p); })
        .then(function () { return post; }, function () { return post; });
    },

    deletePost: function (id) {
      return store().del(POSTS, id);
    },

    /* Everything the fame UI needs, in one call. */
    stats: function () {
      var p = SYNTH.me.profile();
      if (!p) return null;
      var posts = SYNTH.me.posts();
      var best = null;
      for (var i = 0; i < posts.length; i++) {
        if (!best || (posts[i].likes || 0) > (best.likes || 0)) best = posts[i];
      }
      return {
        followers: p.followers || 0,
        following: p.following || 0,
        posts: posts.length,
        totalLikes: p.totalLikes || 0,
        ratios: p.ratios || 0,
        verified: !!p.verified,
        best: best,
        tier: (SYNTH.fame && SYNTH.fame.tierFor)
          ? SYNTH.fame.tierFor(p.followers || 0) : null
      };
    },

    /* Used by the pack round-trip test and the reset button. */
    reset: function () {
      cached = null;
      return Promise.all([store().clear(COL), store().clear(POSTS)]);
    },

    /* Shape shared with the pack format so your own posts can be exported. */
    exportable: function () {
      return {
        profile: SYNTH.me.profile(),
        posts: SYNTH.me.posts()
      };
    }
  };
})();
