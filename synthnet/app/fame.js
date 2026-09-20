/* SYNTHNET -- app/fame.js -- the progression model.
 *
 * PLAINLY: the fame in here is a simulation and there is no audience.
 * Nobody sees your posts. No like, repost, follower, reply, direct message,
 * news article, wiki page or documentary described by this file refers to a
 * real person, a real account or a real event. Nothing you write leaves the
 * device: the app has no network permission, every number below is computed
 * on this machine from the text of your own post and a seed, and the whole
 * lot lives in local storage until you delete it. The "world" reacting to
 * you is arithmetic. That is the point of the toy. Enjoy it, and do not
 * mistake it for weather.
 *
 * Setting: Verity County, present day (2026) -- after the bots arrived and
 * after the platforms consolidated. The 1998-2008 archive sites are the past;
 * this file models the present and it is not flattering to it.
 *
 * Exports (all under window.SYNTH.fame):
 *   score({text, analysis, profile, at, id}) -> {likes, reposts,
 *        followerDelta, viral, ratioed}
 *   tierFor(followers) -> {level, name, next, progress}
 *   milestones(profile)  -> [{at, name, blurb, unlocked}]
 *   events(profile)      -> [{id, at, kind, title, body, domain}]
 *   dmsFor(profile)      -> [{from, handle, kind, body, at}]
 *   tuning               -> mutable knobs, so the model can be retuned from
 *                           inside the app (settings screen or an imported
 *                           pack) without a rebuild. Change a number, post
 *                           again, the new number is used.
 *
 * Determinism: score() is a pure function of (id, text, analysis, profile
 * snapshot, hour-of-day). The same post always scores the same. events() and
 * dmsFor() are pure functions of the profile. No clock-dependent randomness
 * except the deliberate ageing of direct messages.
 *
 * The sites that world events point at are resolved from the registry at call
 * time rather than hardcoded, so renaming or removing a site cannot leave this
 * file emitting links to somewhere that does not exist. See siteFor() below.
 */

window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var SYNTH = window.SYNTH;

  /* Where fame happens. Roles rather than domains, resolved against the
   * registry when the link is built -- see SYNTH.live.siteFor(). These used
   * to be five hardcoded domain strings, three of which were never in the
   * registry, so every milestone emitted a dead link. */

  function domainFor(role) {
    return (SYNTH.live && SYNTH.live.domainFor) ? SYNTH.live.domainFor(role) : null;
  }

  function linkTo(role, slug, label) {
    return (SYNTH.live && SYNTH.live.linkTo) ? SYNTH.live.linkTo(role, slug, label) : '';
  }

  /* ----------------------------------------------------------------- knobs */

  var tuning = {
    /* reach = baseFloor + baseCoef * sqrt(followers) -- deliberately
     * sublinear, so a big account does not get a proportionally big room. */
    baseFloor: 11,
    baseCoef: 2.4,

    /* band cut-offs on the shaped roll. Everything below bands[0] is quiet.
     * 70% quiet / 20% modest / 8% good / 2% viral. */
    bands: [0.70, 0.90, 0.98],

    /* a viral post is this many times a normal (modest-floor) post. */
    viralLow: 50,
    viralHigh: 400,

    /* how hard a good post pushes the roll. 0 = quality is irrelevant. */
    qualityWeight: 0.55,

    /* chance that a bait post gets ratioed instead of rewarded. */
    ratioBaitRisk: 0.22,
    ratioShoutRisk: 0.06,

    /* How much of a setback a ratio is, as a fraction of your audience.
     * Because this scales with followers while reach only scales with their
     * square root, bait is roughly free when you are small and ruinous when
     * you are large. That asymmetry is deliberate. */
    ratioLossRate: 0.0035,

    multipliers: {
      question: 1.25,
      bait: 1.60,
      shouty: 0.72,
      longish: 0.80,
      veryLong: 0.65,
      someEmoji: 1.06,
      manyEmoji: 0.90,
      link: 0.70,
      strongFeeling: 1.20,
      extremeFeeling: 1.35,
      verified: 1.10,
      verifiedPaid: 0.95,
      prolific: 0.95
    },

    /* reach by hour of day. Evenings carry; 3am does not. */
    hours: [
      0.55, 0.50, 0.45, 0.45, 0.50, 0.60,
      0.75, 0.90, 1.00, 1.00, 0.95, 0.95,
      1.05, 1.00, 0.95, 0.95, 1.00, 1.10,
      1.25, 1.35, 1.40, 1.30, 1.10, 0.80
    ]
  };

  /* ----------------------------------------------------------------- util */

  function hash32(s) {
    if (SYNTH.live && typeof SYNTH.live.hash32 === 'function') {
      try { return SYNTH.live.hash32(String(s)) >>> 0; } catch (e) {}
    }
    var str = String(s), h = 2166136261, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function mkrng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= (s << 13); s >>>= 0;
      s ^= (s >>> 17);
      s ^= (s << 5);  s >>>= 0;
      return s / 4294967296;
    };
  }

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function toMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    var t = Date.parse(String(v));
    return isNaN(t) ? 0 : t;
  }

  function nowMs() {
    if (SYNTH.live && typeof SYNTH.live.now === 'function') {
      try { return SYNTH.live.now(); } catch (e) {}
    }
    return Date.now();
  }

  function plain(text) {
    var t = text == null ? '' : String(text);
    if (SYNTH.markup && typeof SYNTH.markup.strip === 'function') {
      try { return String(SYNTH.markup.strip(t)); } catch (e) {}
    }
    return t;
  }

  function cleanHandle(h) {
    var s = String(h == null ? 'you' : h).replace(/^@+/, '').trim();
    return s || 'you';
  }

  function displayName(p) {
    var n = p && p.name ? String(p.name).trim() : '';
    return n || cleanHandle(p && p.handle);
  }

  function commas(n) {
    if (SYNTH.live && typeof SYNTH.live.commas === 'function') {
      try { return SYNTH.live.commas(n); } catch (e) {}
    }
    var s = String(Math.round(n)), out = '', i, c = 0;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return out;
  }

  /* ------------------------------------------------------------- analysis */

  var BAIT_PHRASES = [
    'unpopular opinion', 'hot take', 'nobody talks about', 'am i wrong',
    'change my mind', 'prove me wrong', 'this is why', 'everyone who',
    'people who', 'say it louder', 'delete this', 'the real reason',
    'nobody is talking', 'let that sink in', 'do better', 'normalize ',
    'ratio', 'tell me you', 'worst take', 'actually the problem'
  ];

  var WARM = ['love', 'beautiful', 'thank', 'grateful', 'proud', 'happy',
    'kind', 'lovely', 'wonderful', 'brilliant', 'glad', 'joy', 'sweet',
    'best', 'amazing', 'hope'];

  var COLD = ['hate', 'awful', 'terrible', 'disgust', 'furious', 'worst',
    'ruin', 'stupid', 'idiot', 'never again', 'pathetic', 'broken', 'lie',
    'liar', 'fraud', 'shame', 'angry', 'sick of'];

  function countEmoji(s) {
    var n = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xD83C && c <= 0xD83E) { n++; i++; continue; }
      if (c >= 0x2600 && c <= 0x27BF) n++;
      else if (c >= 0x2190 && c <= 0x21FF) n++;
      else if (c === 0x2B50 || c === 0x2B55) n++;
    }
    return n;
  }

  function capsRatio(s) {
    var up = 0, low = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      if (c >= 65 && c <= 90) up++;
      else if (c >= 97 && c <= 122) low++;
    }
    if (up + low < 8) return 0;
    return up / (up + low);
  }

  function wordHits(low, list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) {
      if (low.indexOf(list[i]) !== -1) n++;
    }
    return n;
  }

  /* Reads whatever the caller's analyser provided and fills the gaps from the
   * text itself, so score() works even with analysis omitted entirely. */
  function readAnalysis(analysis, rawText) {
    var a = analysis || {};
    var raw = rawText == null ? '' : String(rawText);
    var body = plain(raw);
    var low = body.toLowerCase();
    var len = body.length;

    var emoji = typeof a.emoji === 'number' ? a.emoji
      : (a.emoji === true ? 2 : countEmoji(raw));

    var bangs = (body.match(/!/g) || []).length;
    var caps = capsRatio(body);

    var shouty = a.shouty;
    if (shouty == null) shouty = a.caps;
    if (shouty == null) shouty = (caps > 0.62) || bangs >= 3;

    var question = a.question;
    if (question == null) question = a.isQuestion;
    if (question == null) question = /\?/.test(body);

    var link = a.link;
    if (link == null) link = a.hasLink;
    if (link == null) link = /\[url=/i.test(raw) || /synth:\/\//i.test(raw) ||
      /\bwww\./i.test(body);

    var sentiment = a.sentiment;
    if (typeof sentiment !== 'number') {
      var w = wordHits(low, WARM), c = wordHits(low, COLD);
      if (w + c === 0) sentiment = 0;
      else sentiment = clamp((w - c) / (w + c) * Math.min(1, (w + c) / 2.2), -1, 1);
      if (shouty) sentiment *= 1.2;
      sentiment = clamp(sentiment, -1, 1);
    }

    var bait = a.bait;
    if (bait == null) bait = a.isBait;
    if (bait == null) bait = a.ragebait;
    if (bait == null) {
      var hits = 0, i;
      for (i = 0; i < BAIT_PHRASES.length; i++) {
        if (low.indexOf(BAIT_PHRASES[i]) !== -1) { hits++; }
      }
      bait = hits > 0 || (shouty && Math.abs(sentiment) > 0.55 && len < 180);
    }

    return {
      len: len,
      question: !!question,
      bait: !!bait,
      shouty: !!shouty,
      link: !!link,
      emoji: emoji,
      sentiment: sentiment
    };
  }

  /* ---------------------------------------------------------------- score */

  function reachFor(followers) {
    var f = Math.max(0, Number(followers) || 0);
    return tuning.baseFloor + tuning.baseCoef * Math.sqrt(f);
  }

  function hourMult(at) {
    var d = new Date(toMs(at) || nowMs());
    var h = d.getHours();
    if (!(h >= 0 && h <= 23)) h = 12;
    var m = tuning.hours[h];
    return typeof m === 'number' ? m : 1;
  }

  function qualityMult(a, profile) {
    var M = tuning.multipliers;
    var m = 1;
    if (a.question) m *= M.question;
    if (a.bait) m *= M.bait;
    if (a.shouty) m *= M.shouty;
    if (a.len > 400) m *= M.veryLong;
    else if (a.len > 220) m *= M.longish;
    if (a.emoji >= 1 && a.emoji <= 3) m *= M.someEmoji;
    else if (a.emoji > 5) m *= M.manyEmoji;
    if (a.link) m *= M.link;
    var s = Math.abs(a.sentiment);
    if (s > 0.85) m *= M.extremeFeeling;
    else if (s > 0.60) m *= M.strongFeeling;
    if (profile) {
      if (profile.verifiedPaid) m *= M.verifiedPaid;
      else if (profile.verified) m *= M.verified;
      if ((profile.postCount || 0) > 200) m *= M.prolific;
    }
    return clamp(m, 0.35, 2.6);
  }

  function score(input) {
    var o = input || {};
    var profile = o.profile || {};
    var followers = Math.max(0, Number(profile.followers) || 0);
    var text = o.text == null ? '' : String(o.text);
    var id = o.id == null ? '' : String(o.id);

    var a = readAnalysis(o.analysis, text);
    var reach = reachFor(followers) * hourMult(o.at);
    var mult = qualityMult(a, profile);
    reach = reach * mult;

    var rnd = mkrng(hash32(id + '|' + text + '|' + followers));
    var r = rnd();          /* the roll that decides the band */
    var rRatio = rnd();     /* the roll that decides a ratio */
    var u = rnd();          /* magnitude within the band */
    var u2 = rnd();         /* repost rate */
    var u3 = rnd();         /* follower conversion */
    var u4 = rnd();         /* small mercies */

    /* Quality shifts the odds but never guarantees anything. */
    var boost = clamp(1 + (mult - 1) * tuning.qualityWeight, 0.55, 1.9);
    var q = Math.pow(r, 1 / boost);

    /* --- the ratio path. Bait pays until it does not. --------------- */
    var risk = 0;
    if (a.bait) risk += tuning.ratioBaitRisk;
    if (a.shouty && a.sentiment < -0.6) risk += tuning.ratioShoutRisk;
    if (profile.verifiedPaid) risk += 0.03;

    if (risk > 0 && rRatio < risk) {
      var rLikes = Math.floor(reach * (0.02 + 0.06 * u));
      var loss = 1
        + followers * tuning.ratioLossRate * (0.6 + 0.8 * u3)
        + reach * 0.12 * u;
      loss = Math.min(Math.round(loss), followers > 0 ? followers : 1);
      return {
        likes: rLikes,
        reposts: Math.floor(rLikes * (0.02 + 0.05 * u2)),
        followerDelta: -Math.max(1, loss),
        viral: false,
        ratioed: true
      };
    }

    /* --- the ordinary bands ---------------------------------------- */
    var B = tuning.bands;
    var normal = reach * 0.06;   /* what a middling post gets */
    var likes, repRate, convRate, viral = false;

    if (q < B[0]) {
      /* quiet: the overwhelming majority. Almost nothing happens. */
      likes = Math.floor(reach * (0.01 + 0.05 * u));
      if (likes === 0 && u4 > 0.6) likes = 1;
      repRate = 0.02 + 0.05 * u2;
      convRate = 0.005 + 0.02 * u3;
    } else if (q < B[1]) {
      /* modest: someone you know saw it. */
      likes = Math.floor(reach * (0.06 + 0.14 * u));
      repRate = 0.05 + 0.10 * u2;
      convRate = 0.015 + 0.03 * u3;
    } else if (q < B[2]) {
      /* good: it travelled one hop further than usual. */
      likes = Math.floor(reach * (0.25 + 0.90 * u));
      repRate = 0.09 + 0.18 * u2;
      convRate = 0.03 + 0.05 * u3;
    } else {
      /* viral: 50-400x a normal post. Rare, and mostly strangers. */
      var span = tuning.viralHigh - tuning.viralLow;
      likes = Math.floor(normal * (tuning.viralLow + span * Math.pow(u, 1.8)));
      repRate = 0.14 + 0.31 * u2;
      convRate = 0.06 + 0.10 * u3;
      viral = true;
    }

    if (likes < 0) likes = 0;

    var reposts = Math.floor(likes * repRate);
    var delta = Math.round(likes * convRate);

    /* Quiet posts mostly move nothing at all, and sometimes cost you one. */
    if (!viral && delta === 0 && u4 < 0.08 && followers > 20) delta = -1;
    if (!viral && q < B[0] && delta > 2) delta = 2;

    /* A viral post from a small account is life-changing on the scale of a
     * small account, which is the only scale that exists here. */
    if (viral && delta < 3) delta = 3;

    return {
      likes: likes,
      reposts: reposts,
      followerDelta: delta,
      viral: viral,
      ratioed: false
    };
  }

  /* ---------------------------------------------------------------- tiers */

  var TIERS = [
    { level: 0, at: 0,       name: 'nobody' },
    { level: 1, at: 100,     name: 'locally known' },
    { level: 2, at: 1000,    name: 'county famous' },
    { level: 3, at: 10000,   name: 'regionally known' },
    { level: 4, at: 50000,   name: 'properly famous' },
    { level: 5, at: 250000,  name: 'main character' }
  ];
  var CEILING = 1000000;

  function tierFor(followers) {
    var f = Math.max(0, Number(followers) || 0);
    var i, cur = TIERS[0];
    for (i = 0; i < TIERS.length; i++) {
      if (f >= TIERS[i].at) cur = TIERS[i];
    }
    var nxt = TIERS[cur.level + 1] || null;
    var floorAt = cur.at;
    var ceilAt = nxt ? nxt.at : CEILING;
    var progress;
    if (f >= CEILING && !nxt) progress = 1;
    else progress = clamp((f - floorAt) / Math.max(1, ceilAt - floorAt), 0, 1);

    return {
      level: cur.level,
      name: cur.name,
      next: nxt
        ? { level: nxt.level, at: nxt.at, name: nxt.name }
        : (f >= CEILING
            ? null
            : { level: 5, at: CEILING, name: 'the whole county knows your name' }),
      progress: progress
    };
  }

  /* ----------------------------------------------------------- milestones */

  var LADDER = [
    { at: 1, name: 'one follower',
      blurb: 'It is probably a bot from the Coyne Flats farm. Count it anyway.' },
    { at: 10, name: 'a table of people',
      blurb: 'Ten. Enough to fill the back booth at the Blue Kestrel, if the Blue Kestrel were still open.' },
    { at: 50, name: 'the recommendation shelf',
      blurb: 'Something in the feed decided you were worth suggesting to strangers. It will change its mind.' },
    { at: 100, name: 'locally known',
      blurb: 'The engagement farms have your scent now. Every post gets three replies within a minute and none of them read it.' },
    { at: 250, name: 'quoted without credit',
      blurb: 'A screenshot of one of your posts is circulating with the handle cropped off. This is how it starts.' },
    { at: 500, name: 'a regular',
      blurb: 'People recognise your avatar before your name. Half of them think you post too much.' },
    { at: 1000, name: 'county famous',
      blurb: 'Four figures. Someone in Marchfield has your posts on a second monitor at work. The verification upsell arrives this week.' },
    { at: 2500, name: 'the reply guys arrive',
      blurb: 'You now have people who reply to everything you write and would be genuinely hurt if you blocked them.' },
    { at: 5000, name: 'brand-adjacent',
      blurb: 'A local business wants to send you free product in exchange for a post you will feel weird about.' },
    { at: 10000, name: 'regionally known',
      blurb: 'Five figures. You have a dedicated hater and a parody account. Both of them work harder on your material than you do.' },
    { at: 25000, name: 'on the leaderboards',
      blurb: 'Aggregator sites list you in "Verity County accounts to watch", next to nine accounts that are software.' },
    { at: 50000, name: 'properly famous',
      blurb: 'The Ledger runs a piece about you. It gets a basic fact wrong and will never correct it.' },
    { at: 100000, name: 'a licensing question',
      blurb: 'Someone offers money for the right to train on your posts. The offer is oddly specific about your voice.' },
    { at: 250000, name: 'main character',
      blurb: 'Quarter of a million. There is a wiki stub about you and an argument on its talk page about whether you deserve one.' },
    { at: 500000, name: 'impersonated at scale',
      blurb: 'Accounts one letter off your handle are messaging your followers. Reporting them takes longer than they take to make.' },
    { at: 1000000, name: 'a documentary about you',
      blurb: 'Seven figures. Somebody who has never been to Verity County made a thirty-eight minute video explaining what you meant.' }
  ];

  function milestones(profile) {
    var f = Math.max(0, Number((profile || {}).followers) || 0);
    var out = [], i;
    for (i = 0; i < LADDER.length; i++) {
      out.push({
        at: LADDER[i].at,
        name: LADDER[i].name,
        blurb: LADDER[i].blurb,
        unlocked: f >= LADDER[i].at
      });
    }
    return out;
  }

  /* --------------------------------------------------------------- events */

  var TOWNS = ['Gridfall', 'Marchfield', 'Ashkettle', 'New Carrow', 'Halsey',
    'Coyne Flats', 'Milbrook'];

  function townFor(handle, offset) {
    return TOWNS[hash32(handle + '|town|' + (offset || 0)) % TOWNS.length];
  }

  function wrongTownFor(handle) {
    var right = townFor(handle, 0);
    var i = hash32(handle + '|wrongtown') % TOWNS.length;
    if (TOWNS[i] === right) i = (i + 3) % TOWNS.length;
    return TOWNS[i];
  }

  function EVENTS_SPEC(p) {
    var handle = cleanHandle(p.handle);
    var name = displayName(p);
    var town = townFor(handle, 0);
    var wrong = wrongTownFor(handle);
    var year = 2011 + (hash32(handle + '|yr') % 9);
    var n = hash32(handle + '|num');

    return [
      {
        at: 100,
        id: 'fame-farms',
        kind: 'farm',
        domain: domainFor('feed'),
        title: 'The reply farms have found you',
        body:
          'Every post you make now gets three replies inside sixty seconds. ' +
          'None of them are about the post.\n\n' +
          '[quote=@' + handle.slice(0, 4) + '_daily_wins]Such a great point. ' +
          'This is exactly the kind of thinking that separates the top 1% from ' +
          'everyone else. Follow for more.[/quote]\n\n' +
          '[quote=@verity_growth_hub]Consistency wins. Saving this.[/quote]\n\n' +
          '[quote=@marla_k_reads]interesting perspective[/quote]\n\n' +
          'The third one has a real photograph of a real garden and has been ' +
          'posting the phrase "interesting perspective" four hundred times a ' +
          'day since March. It has never posted anything else.\n\n' +
          'Nothing you can do about it. The block button works for about an ' +
          'hour. ' + (linkTo('forum', 'engagement-farms', 'The thread about it') ||
            'The thread about it') + ' is itself now half farms.'
      },
      {
        at: 1000,
        id: 'fame-verify-offer',
        kind: 'offer',
        domain: domainFor('feed'),
        title: 'You are eligible for verification',
        body:
          '[b]Stand out. Get seen. Be trusted.[/b]\n\n' +
          'Your account has crossed the eligibility threshold. For $8.99 a ' +
          'month you receive: a verification mark, priority placement in ' +
          'replies, the ability to edit posts for five minutes, and a monthly ' +
          'analytics summary.\n\n' +
          'Verification does not confirm your identity. Verification does not ' +
          'indicate notability or authenticity. Verification indicates an ' +
          'active subscription. This text is in the footer, in grey, at six ' +
          'point.\n\n' +
          'Separately and at the same hour, the first brand messages arrive. ' +
          'Check your direct messages. Two of them are from companies that ' +
          'exist. One is from a company that has an office address in ' +
          wrong + ' and nothing else.'
      },
      {
        at: 10000,
        id: 'fame-hater',
        kind: 'hater',
        domain: domainFor('feed'),
        title: 'You have a dedicated hater now',
        body:
          'An account appeared this week. It exists to be about you.\n\n' +
          '[b]@' + handle + '_watch[/b]\n' +
          '[quote=bio]archiving every take. not affiliated, obviously. ' +
          'receipts pinned. ' + town.toLowerCase() + '. i am not obsessed, ' +
          'i am [i]documenting[/i]. ' + (140 + (n % 300)) + ' screenshots and ' +
          'counting.[/quote]\n\n' +
          'It has 1,204 followers, a pinned thread titled "a complete ' +
          'timeline", and it posts more about you in a day than you post in a ' +
          'week. It has been awake for the last nine hours.\n\n' +
          'The hardest part is that about one screenshot in twenty is a fair ' +
          'hit.'
      },
      {
        at: 10000,
        id: 'fame-parody',
        kind: 'parody',
        domain: domainFor('feed'),
        title: 'And a parody account',
        body:
          '[b]@' + handle.replace(/[aeiou]/, 'e') + '[/b]\n' +
          '[quote=bio]same posts, one letter off. parody account. NOT the ' +
          'real one. do not send me money. do not send the other one money ' +
          'either.[/quote]\n\n' +
          'It posts your posts back with one word changed. It is funnier than ' +
          'you and it took eleven minutes to make.\n\n' +
          'Roughly a third of the people quoting it do not realise, and have ' +
          'begun arguing with you about things the parody said.'
      },
      {
        at: 50000,
        id: 'fame-ledger',
        kind: 'article',
        domain: domainFor('news'),
        title: 'The Verity Ledger has written about you',
        body:
          '[b]Meet ' + wrong + "'s Own " + name + ': The Local Voice ' +
          'Everyone Is Talking About[/b]\n' +
          '[i]Verity Ledger, Community Desk. Generated with editorial ' +
          'assistance.[/i]\n\n' +
          '"A social media presence with deep roots in Verity County, ' +
          name + ' has lived in ' + wrong + ' since ' + year + ' and has ' +
          'built a following of over 50,000 by speaking plainly about local ' +
          'issues, including the 2005 substation fire in Gridfall."\n\n' +
          'You have never lived in ' + wrong + '. The substation fire was ' +
          '2003. It says this twice.\n\n' +
          'The article contains four paragraphs about you, none of which are ' +
          'quoted from you, and a closing line inviting readers to follow you ' +
          'for more. It is eleven hundred words long and took four seconds to ' +
          'write.\n\n' +
          'There is a correction form. It is a mailto link to an address that ' +
          'bounces. The piece is already on three aggregators, each of which ' +
          'rewrote it slightly worse.\n\n' +
          linkTo('news', 'community-' + handle, 'Read it on the Ledger')
      },
      {
        at: 250000,
        id: 'fame-wiki',
        kind: 'wiki',
        domain: domainFor('wiki'),
        title: 'There is a wiki stub about you',
        body:
          '[b]' + name + '[/b]\n' +
          '[i]From Verity Wiki. This article is a stub. You can help by ' +
          'expanding it.[/i]\n\n' +
          name + ' (born ' + (1978 + (n % 25)) + ') is an American social ' +
          'media personality from Verity County, best known for a 2026 post ' +
          'about the closure of the Blue Kestrel diner.\n\n' +
          'That is the whole article. There is an infobox with your avatar in ' +
          'it, pulled at some unknown point from some unknown post, and a ' +
          '"Controversies" heading with nothing underneath it, which is worse ' +
          'than if it had something underneath it.\n\n' +
          '[b]Talk: ' + name + '[/b]\n\n' +
          '[quote=Hollowbrook_Ed]Notability is not established. Local ' +
          'following is not coverage. Proposing merge into "Verity County ' +
          'internet culture". [i]18:04[/i][/quote]\n\n' +
          '[quote=marchfield_anna]Strong keep. There is a Ledger piece. ' +
          '[i]18:31[/i][/quote]\n\n' +
          '[quote=Hollowbrook_Ed]The Ledger piece is machine generated and ' +
          'gets the subject\'s town wrong. That is not a source, that is a ' +
          'mirror of this article. Circular. [i]18:33[/i][/quote]\n\n' +
          '[quote=marchfield_anna]Then fix the town. [i]18:40[/i][/quote]\n\n' +
          '[quote=Hollowbrook_Ed]I cannot fix the town because the only ' +
          'source for the town is the article that got it wrong. ' +
          '[i]18:41[/i][/quote]\n\n' +
          'The argument is four years old in tone and nine hours old in fact. ' +
          'Neither of them has asked you.\n\n' +
          linkTo('wiki', handle, 'Read the stub')
      },
      {
        at: 1000000,
        id: 'fame-documentary',
        kind: 'documentary',
        domain: domainFor('video'),
        title: 'Someone made a documentary about you',
        body:
          '[img:thumb:' + handle + '-doc]\n\n' +
          '[b]THE RISE AND FALL OF @' + handle + ' | A Verity County Story ' +
          '[38:14][/b]\n' +
          '[i]' + commas(200000 + (n % 800000)) + ' views. Uploaded by ' +
          'ARCHIVE DEPTH.[/i]\n\n' +
          'Slow zooms on your screenshots. A synthesised narrator with a ' +
          'slight British accent that slips on the word "Ashkettle". Drone ' +
          'footage of somewhere that is not Verity County. A chapter list:\n\n' +
          '[list]' +
          '[*]00:00 Who is @' + handle + '?' +
          '[*]04:12 The early posts' +
          '[*]11:40 The post that changed everything' +
          '[*]19:55 The backlash' +
          '[*]28:30 What we can all learn' +
          '[*]35:02 Sponsor' +
          '[/list]\n\n' +
          'There was no fall. The chapter titled "The backlash" is about ' +
          'someone else with a similar handle. The narrator says your name ' +
          'seventy-one times and never gets it quite right.\n\n' +
          'Top comment: "crazy how nobody talks about this". It has 4,100 ' +
          'likes and was posted by an account created that morning.'
      },
      {
        at: 1000000,
        id: 'fame-impostors',
        kind: 'impostor',
        domain: domainFor('feed'),
        title: 'There are now several of you',
        body:
          'Eleven accounts are currently using your name and avatar:\n\n' +
          '[list]' +
          '[*]@' + handle + '_ (one trailing underscore)' +
          '[*]@' + handle.replace(/l/g, 'I').replace(/o/g, '0') + '' +
          '[*]@real' + handle +
          '[*]@' + handle + '_official' +
          '[*]@' + handle + '.backup' +
          '[/list]\n\n' +
          'and six more. They are messaging your followers. The message is ' +
          'always the same: you are running a small giveaway, there has been ' +
          'a problem with the platform, please reply here instead.\n\n' +
          'Three people have sent them money. One of them is someone you went ' +
          'to school with, and she is not angry with them, she is ' +
          'embarrassed in front of you, which is worse.\n\n' +
          'The report form asks you to upload identification. You have done ' +
          'this twice. Both tickets were closed as [i]resolved -- no action ' +
          'required[/i] by something that replied in under a second.'
      }
    ];
  }

  function events(profile) {
    var p = profile || {};
    var f = Math.max(0, Number(p.followers) || 0);
    var spec = EVENTS_SPEC(p);
    var out = [], i;
    for (i = 0; i < spec.length; i++) {
      if (f >= spec[i].at) out.push(spec[i]);
    }
    out.sort(function (a, b) { return b.at - a.at; });
    return out;
  }

  /* ------------------------------------------------------------------ DMs */

  function DM_SPEC(p) {
    var handle = cleanHandle(p.handle);
    var name = displayName(p);
    var town = townFor(handle, 0);
    var first = name.split(/\s+/)[0];

    return [
      { at: 0, kind: 'system',
        from: 'Shoutbox', handle: 'shoutbox',
        body: 'Welcome to Shoutbox.\n\nYour feed is being personalised. This ' +
          'usually takes a few minutes and cannot be turned off.\n\n' +
          'Reply STOP to stop receiving service messages. (Replies to this ' +
          'account are not monitored.)' },

      { at: 25, kind: 'farm',
        from: 'Daily Wins Verity', handle: 'verity_daily_wins',
        body: 'Hey! Loved your recent post.\n\nI run a small community of ' +
          'creators in the ' + town + ' area who support each other\'s ' +
          'growth. We like and reply to each other\'s posts within the first ' +
          'ten minutes, which is what the algorithm actually rewards.\n\n' +
          'Free to join. Just follow back and drop your link in the thread.' },

      { at: 100, kind: 'scam',
        from: 'GrowthLadder', handle: 'growthladder_io',
        body: '[b]1,000 real followers in 14 days. Guaranteed.[/b]\n\n' +
          'Not bots. Real, active accounts from your region, targeted by ' +
          'interest. We work with over 400 creators in Verity County.\n\n' +
          'Starter: $29. Pro: $79. Agency: contact us.\n\n' +
          'Payment by gift card only at this time due to a temporary issue ' +
          'with our processor.' },

      { at: 250, kind: 'scam',
        from: 'VERITY AIRDROP', handle: 'verity_rewards_x',
        body: 'CONGRATULATIONS @' + handle + '\n\nYour account has been ' +
          'selected in our Community Creator Allocation.\n\nClaim window: ' +
          '11 hours 04 minutes.\n\nConnect wallet to verify eligibility. ' +
          'Verification requires a small gas fee which is refunded on ' +
          'claim.\n\nDo not share this message. Allocation is per-account.' },

      { at: 1000, kind: 'verify',
        from: 'Shoutbox Subscriptions', handle: 'shoutbox_plus',
        body: 'You have been pre-approved for [b]Shoutbox Verified[/b].\n\n' +
          'At your follower count, verified accounts see an average of 3.2x ' +
          'reply placement. (Average calculated across verified accounts. ' +
          'Verified accounts pay to be verified.)\n\n' +
          '$8.99/month. Cancel anytime. Cancelling removes the mark ' +
          'immediately and your prior placement is not restored.' },

      { at: 1000, kind: 'brand',
        from: 'Ashkettle Feed & Seed', handle: 'ashkettlefeed',
        body: 'Morning ' + first + ',\n\nThis is Dale over at the Feed & ' +
          'Seed. My daughter showed me your posts. We are not really a ' +
          'social media outfit but she says this is how it is done now.\n\n' +
          'Would you be willing to mention us? We can do a $40 store credit. ' +
          'I know that is not much. We also have a lot of birdseed.\n\n' +
          'No hard feelings either way.' },

      { at: 2500, kind: 'human',
        from: 'Ruth Ellery', handle: 'r_ellery',
        body: 'Hello. I do not really use this and I am not sure this is even ' +
          'the right way to send a message.\n\nYou wrote something about the ' +
          'Blue Kestrel and the counter with the chipped corner. My mother ' +
          'worked that counter from 1979 until they shut it. She is 84 now ' +
          'and does not remember much, but I read her your post and she said ' +
          'the word "chipped" and laughed, which she has not done in a ' +
          'while.\n\nI am not after anything. I just thought you should know ' +
          'it landed somewhere.\n\nRuth' },

      { at: 5000, kind: 'brand',
        from: 'KELTER Partnerships', handle: 'drinkkelter',
        body: 'Hi ' + first + ' — Amara here from KELTER (functional energy, ' +
          'zero sugar, adaptogens).\n\nWe are building out our regional ' +
          'creator roster and you came up in our Verity County pull. Offer: ' +
          '3 posts + 1 pinned, $450 total, product supplied.\n\nUsage: ' +
          'perpetual, all media, worldwide. Exclusivity: no competing ' +
          'beverage for 24 months, category defined in Schedule B.\n\nSchedule ' +
          'B is attached. It defines "beverage" as "any consumable ' +
          'liquid".' },

      { at: 10000, kind: 'press',
        from: 'Verity Ledger — Community Desk', handle: 'ledger_community',
        body: 'Hello,\n\nWe are preparing a short profile piece and would ' +
          'love a quote. Deadline is in 40 minutes.\n\n1. What inspires your ' +
          'content?\n2. What does Verity County mean to you?\n3. Where do you ' +
          'see yourself in five years?\n\nIf we do not hear back we will ' +
          'proceed with publicly available information.\n\n(This mailbox does ' +
          'not accept replies. Please use the form.)' },

      { at: 10000, kind: 'hater',
        from: 'watching', handle: handle + '_watch',
        body: 'i know you read these.\n\ni have 312 screenshots. i have the ' +
          'ones you deleted. i have the one from february that you think ' +
          'nobody saved.\n\ni am not going to do anything with them. i just ' +
          'want you to know they exist.\n\nanyway. post 14 was genuinely ' +
          'good and i said so publicly. you did not see it because you have ' +
          'me blocked on the main.' },

      { at: 25000, kind: 'podcast',
        from: 'THE UNFILTERED HOUR', handle: 'unfilteredhour',
        body: 'Big fan. We do long form, no notes, no agenda, just two people ' +
          'talking for three hours.\n\nWe have had 400+ guests. Studio is in ' +
          townFor(handle, 3) + '. We do not pay guests but we do clip it for ' +
          'shorts.\n\nOne thing to flag: our previous guest said some ' +
          'and we are not responsible for what guests say. Just so there is ' +
          'no surprise.' },

      { at: 50000, kind: 'agency',
        from: 'Northbend Talent', handle: 'northbendtalent',
        body: first + ' — you are leaving money on the table.\n\nWe manage 60 ' +
          'creators. We handle inbound, negotiate rates, and take 20%. At ' +
          'your size we would expect to 4x your current deal flow inside a ' +
          'quarter.\n\nStandard term is 36 months. Sunset clause applies to ' +
          'any brand introduced during term, for 24 months after ' +
          'termination.\n\nHappy to jump on a call. I have Thursday at ' +
          '6:40am or 9:15pm.' },

      { at: 100000, kind: 'licensing',
        from: 'Halcyon Voice Data', handle: 'halcyon_data',
        body: 'Re: voice and text likeness licensing\n\nWe are assembling a ' +
          'regional English corpus and would like to license your public ' +
          'post archive (2026 to date, approx. ' + commas(4000) + ' posts) ' +
          'plus 90 minutes of read audio.\n\nOffer: $6,000, one-time, ' +
          'perpetual, irrevocable, sublicensable.\n\nTo be clear about scope: ' +
          'the licence covers synthesis of new material in your manner of ' +
          'speech. It does not cover use of your name, which we would not ' +
          'need.' },

      { at: 250000, kind: 'documentary',
        from: 'ARCHIVE DEPTH', handle: 'archivedepth',
        body: 'We are producing a retrospective piece on your trajectory and ' +
          'wanted to offer you the opportunity to participate.\n\nTo be ' +
          'transparent: the piece is scheduled either way. Participation ' +
          'means we can include your side.\n\nWe have already spoken to four ' +
          'people who know you. Two were positive.\n\nRun time approx. 38 ' +
          'minutes. Release is in nine days.' },

      { at: 500000, kind: 'system',
        from: 'Shoutbox Trust & Safety', handle: 'shoutbox_safety',
        body: 'We have detected accounts impersonating you.\n\nThis is an ' +
          'automated notice. We are unable to action impersonation reports ' +
          'from this mailbox.\n\nTo protect yourself we recommend: enabling ' +
          'two-factor authentication, subscribing to Verified, and informing ' +
          'your audience that you will never contact them about a ' +
          'giveaway.\n\nThis notice was generated because your account is in ' +
          'the top 0.01% by impersonation volume. Congratulations on your ' +
          'growth.' },

      { at: 1000000, kind: 'strange',
        from: 'unknown', handle: 'sixtytwo_listener',
        body: 'you are getting the numbers wrong.\n\nnot your follower count. ' +
          'the other ones. the ones you put in the post on the 14th, the ' +
          'five groups of five. you had them from a transcript and the ' +
          'transcript had them from a transcript.\n\ni have been listening ' +
          'to 62 since 1997. the fourth group is always the repeat. always. ' +
          'you printed it as the third.\n\nnobody else will tell you this ' +
          'because nobody else is left who checks.\n\nyou do not have to ' +
          'reply. just fix it.' }
    ];
  }

  function dmsFor(profile) {
    var p = profile || {};
    var f = Math.max(0, Number(p.followers) || 0);
    var spec = DM_SPEC(p);
    var handle = cleanHandle(p.handle);

    var unlocked = [], i;
    for (i = 0; i < spec.length; i++) {
      if (f >= spec[i].at) unlocked.push(spec[i]);
    }
    if (!unlocked.length) return [];

    var now = nowMs();
    var joined = toMs(p.joined);
    if (!joined || joined >= now) joined = now - 90 * 86400000;
    var span = Math.max(3600000, now - joined);

    var out = [];
    for (i = 0; i < unlocked.length; i++) {
      var d = unlocked[i];
      var jitter = mkrng(hash32(handle + '|dm|' + d.handle))();
      var frac = (i + 0.35 + jitter * 0.4) / (unlocked.length + 0.6);
      var at = joined + Math.floor(span * clamp(frac, 0, 0.995));
      if (at > now - 60000) at = now - 60000 - Math.floor(jitter * 3600000);
      out.push({
        from: d.from,
        handle: d.handle,
        kind: d.kind,
        body: d.body,
        at: at
      });
    }
    out.sort(function (a, b) { return b.at - a.at; });
    return out;
  }

  /* --------------------------------------------------------------- export */

  SYNTH.fame = {
    score: score,
    tierFor: tierFor,
    milestones: milestones,
    events: events,
    dmsFor: dmsFor,
    tuning: tuning
  };
})();
