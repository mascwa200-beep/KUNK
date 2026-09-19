/* =====================================================================
   SYNTHNET / app/bots.js  --  the reply engine
   ---------------------------------------------------------------------
   THIS IS PATTERN MATCHING, NOT UNDERSTANDING.

   There is no language model anywhere in this file and there is no
   network. Everything below is word lists, frequency counts, regular
   expressions and a seeded pseudo-random number generator. When a bot
   appears to "get" your post it is because it quoted six of your own
   words back at you and wrapped them in a template that was already
   written down here before you typed anything.

   That is, of course, also roughly what the real ones do in 2026.

   Three exports, all hanging off window.SYNTH.bots:

     analyse(text)                 -> ANALYSIS   (never throws)
     repliesFor(post, opts)        -> [REPLY]    (deterministic)
     reply(analysis, arch, seed)   -> String     (one reply body)

   Plus, so the thing can be modified from inside the app without a
   rebuild:

     archetypes()                  -> list of archetype ids
     topics()                      -> list of topic ids
     extend(patch)                 -> merge new topics/archetypes/names
     saveExtension(patch)          -> extend() + persist via SYNTH.store

   DETERMINISM CONTRACT
   --------------------
   repliesFor() is a pure function of (post.id, post.body, post.likes,
   elapsed whole minutes). Render the same post twice in the same minute
   and you get byte-identical replies. Come back in an hour and the
   earlier replies are still there, unchanged, with new ones underneath.
   A post never stores its replies; the thread is recomputed from the
   clock every time. The bots keep working while the app is shut.

   ES5 only. var + function. No modules. No innerHTML (this file returns
   strings; the caller renders them through SYNTH.markup.parse).
   Inline markup used in templates is restricted to the sanctioned set:
   [b] [i] [u] [s] [quote=Name] [code] [list][*][/list] [url=...] [img:].
   ===================================================================== */

window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var SYNTH = window.SYNTH;

  /* Hard caps. Every loop in this file is bounded by one of these so a
     hostile input (5000 emoji, markup soup, a wall of one character)
     cannot spin. */
  var MAX_TEXT = 4000;      /* characters of input we will look at */
  var MAX_TOKENS = 700;     /* words we will tokenise */
  var MAX_REPLIES = 24;     /* hard ceiling on a thread */
  var CANDIDATES = 30;      /* reply slots we schedule before filtering */

  /* ===================================================================
     1. DETERMINISTIC PRIMITIVES
     -------------------------------------------------------------------
     We prefer SYNTH.live's versions so the whole app shares one clock
     and one hash, but we carry fallbacks: bots.js must work if it is
     loaded first, or alone in a test page.
     =================================================================== */

  function L() { return SYNTH.live || {}; }

  function imul32(a, b) {
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff;
    var bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + ((((ah * bl) + (al * bh)) << 16) >>> 0)) | 0;
  }

  function hash32(s) {
    var live = L();
    if (typeof live.hash32 === 'function') {
      try { return live.hash32(String(s == null ? '' : s)) >>> 0; } catch (e) { /* fall through */ }
    }
    s = String(s == null ? '' : s);
    var h = 2166136261, i, n = s.length;
    if (n > 1024) n = 1024;
    for (i = 0; i < n; i++) {
      h ^= s.charCodeAt(i);
      h = imul32(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* mulberry32. Small, fast, good enough, and identical on every device,
     which is the only property that actually matters here. */
  function rnd(seed) {
    var a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = imul32(t ^ (t >>> 15), t | 1);
      t = (t ^ (t + imul32(t ^ (t >>> 7), t | 61))) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(arr, r) {
    if (!arr || !arr.length) return null;
    var i = Math.floor(r() * arr.length);
    if (i < 0) i = 0;
    if (i >= arr.length) i = arr.length - 1;
    return arr[i];
  }

  function pickSeed(arr, seed) {
    if (!arr || !arr.length) return null;
    return arr[(hash32(seed) >>> 0) % arr.length];
  }

  function intBetween(r, lo, hi) {
    if (hi <= lo) return lo;
    return lo + Math.floor(r() * (hi - lo + 1));
  }

  function now() {
    var live = L();
    if (typeof live.now === 'function') {
      try { return live.now(); } catch (e) { /* fall through */ }
    }
    return Date.now();
  }

  function commas(n) {
    var live = L();
    if (typeof live.commas === 'function') {
      try { return live.commas(n); } catch (e) { /* fall through */ }
    }
    n = Math.round(Number(n) || 0);
    var s = String(n), out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s.charAt(i) + out;
      c++;
      if (c % 3 === 0 && i > 0) out = ',' + out;
    }
    return out;
  }

  function shortNum(n) {
    var live = L();
    if (typeof live.short === 'function') {
      try { return live.short(n); } catch (e) { /* fall through */ }
    }
    n = Math.round(Number(n) || 0);
    if (n >= 1000000) return (Math.round(n / 100000) / 10) + 'M';
    if (n >= 1000) return (Math.round(n / 100) / 10) + 'K';
    return String(n);
  }

  function strip(text) {
    var m = SYNTH.markup;
    if (m && typeof m.strip === 'function') {
      try { return String(m.strip(String(text == null ? '' : text))); } catch (e) { /* fall through */ }
    }
    return String(text == null ? '' : text)
      .replace(/\[(?:\/)?(?:b|i|u|s|code|list|\*)\]/gi, ' ')
      .replace(/\[quote=[^\]]*\]/gi, ' ')
      .replace(/\[\/quote\]/gi, ' ')
      .replace(/\[img:[^\]]*\]/gi, ' ')
      .replace(/\[url=[^\]]*\]/gi, ' ')
      .replace(/\[\/url\]/gi, ' ');
  }

  function clamp(n, lo, hi) {
    n = Number(n);
    if (!isFinite(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function titleish(s) {
    s = String(s == null ? '' : s);
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ===================================================================
     2. TOPIC MAP
     -------------------------------------------------------------------
     Twenty topics. Scoring is a plain keyword hit count with a small
     bonus for multi-word phrases, because "heat pump" is a much better
     signal for `home` than "heat" is on its own. No stemming beyond a
     crude suffix trim -- stemming properly would make it seem cleverer
     than it is, which would be dishonest.
     =================================================================== */

  var TOPICS = {
    local: {
      label: 'Verity County',
      words: ['gridfall', 'marchfield', 'ashkettle', 'new carrow', 'carrow', 'halsey',
        'coyne flats', 'coyne', 'milbrook', 'verity', 'county', 'route 62', 'downtown',
        'main street', 'town hall', 'council', 'zoning', 'neighbour', 'neighbor',
        'substation', 'kestrel', 'branch line', 'the signal', 'township', 'municipal',
        'courthouse', 'fairground', 'parade', 'library']
    },
    food: {
      label: 'food',
      words: ['food', 'eat', 'eating', 'ate', 'dinner', 'lunch', 'breakfast', 'brunch',
        'restaurant', 'diner', 'cafe', 'coffee', 'pizza', 'burger', 'taco', 'sandwich',
        'recipe', 'cook', 'cooking', 'baked', 'baking', 'kitchen', 'menu', 'chef',
        'hungry', 'delicious', 'tasted', 'takeout', 'leftovers', 'grocery', 'meal',
        'sourdough', 'brisket', 'casserole']
    },
    tech: {
      label: 'technology',
      words: ['tech', 'app', 'software', 'computer', 'laptop', 'phone', 'update',
        'install', 'server', 'code', 'coding', 'algorithm', 'ai', 'model', 'bot',
        'internet', 'website', 'browser', 'download', 'account', 'password', 'login',
        'crash', 'bug', 'glitch', 'firmware', 'router', 'wifi', 'subscription',
        'feature', 'device', 'battery', 'screen', 'cloud', 'data']
    },
    pets: {
      label: 'pets',
      words: ['dog', 'dogs', 'cat', 'cats', 'puppy', 'kitten', 'pet', 'pets', 'vet',
        'leash', 'collar', 'rescue', 'adopt', 'adopted', 'shelter', 'kennel', 'paws',
        'barking', 'meow', 'litter', 'fur', 'tail', 'walkies', 'breed', 'hamster',
        'rabbit', 'parrot', 'goldfish', 'groomer', 'treats']
    },
    weather: {
      label: 'the weather',
      words: ['weather', 'rain', 'raining', 'snow', 'storm', 'thunder', 'lightning',
        'wind', 'windy', 'hot', 'cold', 'freezing', 'heat', 'humid', 'forecast',
        'flood', 'flooding', 'hail', 'fog', 'frost', 'degrees', 'sunny', 'cloudy',
        'tornado', 'drought', 'blizzard', 'sleet', 'heatwave', 'overcast']
    },
    money: {
      label: 'money',
      /* Currency amounts are handled separately in scoreTopics: a bare "$9000"
         carries no keyword but is unmistakably about money. */
      words: ['money', 'cash', 'price', 'prices', 'cost', 'costs', 'expensive', 'cheap',
        'earn', 'earned', 'earning', 'income', 'profit', 'payout', 'side hustle',
        'work from home', 'working from home', 'ask me how', 'dm me', 'passive',
        'rent', 'mortgage', 'bill', 'bills', 'budget', 'salary', 'wage', 'paycheck',
        'bank', 'loan', 'debt', 'credit', 'savings', 'invest', 'investing', 'tax',
        'taxes', 'refund', 'inflation', 'dollars', 'afford', 'broke', 'payment',
        'insurance', 'fee', 'fees', 'subscription']
    },
    health: {
      label: 'health',
      words: ['health', 'doctor', 'hospital', 'clinic', 'sick', 'illness', 'pain',
        'ache', 'surgery', 'medication', 'meds', 'prescription', 'symptoms', 'diagnosis',
        'therapy', 'therapist', 'anxiety', 'depression', 'sleep', 'insomnia', 'diet',
        'exercise', 'gym', 'recovery', 'injury', 'flu', 'fever', 'dentist', 'nurse',
        'appointment', 'waiting list']
    },
    politics: {
      label: 'politics',
      words: ['politics', 'political', 'vote', 'voted', 'voting', 'election', 'ballot',
        'mayor', 'governor', 'senator', 'congress', 'policy', 'government', 'law',
        'bill', 'protest', 'rally', 'campaign', 'democracy', 'corruption', 'taxpayer',
        'regulation', 'official', 'candidate', 'referendum', 'petition', 'lobby',
        'partisan', 'legislation']
    },
    music: {
      label: 'music',
      words: ['music', 'song', 'songs', 'album', 'band', 'guitar', 'drums', 'bass',
        'piano', 'gig', 'concert', 'tour', 'playlist', 'listening', 'vinyl', 'record',
        'chorus', 'lyrics', 'singer', 'track', 'radio', 'headphones', 'setlist',
        'festival', 'remix', 'acoustic', 'venue', 'encore']
    },
    sport: {
      label: 'sport',
      words: ['game', 'match', 'team', 'score', 'scored', 'won', 'lost', 'season',
        'league', 'playoff', 'coach', 'player', 'referee', 'ref', 'stadium', 'field',
        'court', 'fans', 'training', 'fitness', 'run', 'running', 'marathon', 'goal',
        'touchdown', 'inning', 'pitch', 'tournament', 'bracket', 'roster']
    },
    cars: {
      label: 'cars',
      words: ['car', 'cars', 'truck', 'driving', 'drive', 'drove', 'engine', 'tires',
        'tyres', 'mechanic', 'garage', 'oil change', 'transmission', 'brakes', 'gas',
        'fuel', 'mileage', 'parking', 'traffic', 'highway', 'road', 'commute', 'ev',
        'charger', 'dealership', 'insurance', 'licence', 'license', 'breakdown',
        'towed', 'pothole']
    },
    home: {
      label: 'home improvement',
      words: ['house', 'home', 'apartment', 'kitchen', 'bathroom', 'roof', 'basement',
        'attic', 'garden', 'yard', 'lawn', 'plumber', 'plumbing', 'electrician',
        'wiring', 'paint', 'painting', 'renovation', 'remodel', 'furniture', 'ikea',
        'landlord', 'tenant', 'lease', 'heat pump', 'boiler', 'insulation', 'gutters',
        'drywall', 'contractor', 'leak']
    },
    work: {
      label: 'work',
      words: ['work', 'job', 'jobs', 'career', 'boss', 'manager', 'office', 'meeting',
        'email', 'deadline', 'project', 'colleague', 'coworker', 'hired', 'fired',
        'laid off', 'layoffs', 'resume', 'interview', 'promotion', 'shift', 'overtime',
        'hr', 'quit', 'quitting', 'burnout', 'freelance', 'client', 'contract',
        'remote work', 'commute']
    },
    grief: {
      label: 'loss',
      words: ['died', 'death', 'passed away', 'funeral', 'grief', 'grieving', 'mourning',
        'loss', 'lost him', 'lost her', 'memorial', 'cemetery', 'obituary', 'widow',
        'anniversary', 'miss him', 'miss her', 'goodbye', 'hospice', 'ashes', 'eulogy',
        'headstone', 'condolences', 'remembering']
    },
    travel: {
      label: 'travel',
      words: ['travel', 'trip', 'flight', 'airport', 'airline', 'hotel', 'motel',
        'booking', 'vacation', 'holiday', 'passport', 'luggage', 'suitcase', 'train',
        'bus', 'ticket', 'itinerary', 'tourist', 'abroad', 'visa', 'layover', 'delayed',
        'cancelled', 'roadtrip', 'campsite', 'hostel', 'departure']
    },
    gaming: {
      label: 'gaming',
      words: ['gaming', 'gamer', 'console', 'controller', 'steam', 'patch', 'dlc',
        'respawn', 'level', 'boss fight', 'multiplayer', 'co-op', 'lag', 'ping',
        'speedrun', 'achievement', 'loot', 'grind', 'nerf', 'buff', 'mod', 'emulator',
        'playthrough', 'campaign', 'arcade', 'cartridge', 'save file']
    },
    parenting: {
      label: 'parenting',
      words: ['kid', 'kids', 'child', 'children', 'baby', 'toddler', 'teenager', 'son',
        'daughter', 'mom', 'mum', 'dad', 'parent', 'parenting', 'school', 'teacher',
        'homework', 'daycare', 'nursery', 'diaper', 'nappy', 'bedtime', 'tantrum',
        'playground', 'pta', 'pickup', 'grades', 'college fund']
    },
    crime: {
      label: 'crime',
      words: ['police', 'cops', 'arrest', 'arrested', 'crime', 'stolen', 'theft',
        'robbery', 'burglary', 'vandalism', 'break-in', 'suspect', 'court', 'trial',
        'lawyer', 'charges', 'sentence', 'jail', 'prison', 'investigation', 'witness',
        'sheriff', 'patrol', 'scam', 'fraud', 'evidence']
    },
    shopping: {
      label: 'shopping',
      words: ['buy', 'bought', 'buying', 'shop', 'shopping', 'store', 'mall', 'order',
        'ordered', 'delivery', 'shipping', 'refund', 'return', 'warranty', 'discount',
        'sale', 'coupon', 'checkout', 'cart', 'brand', 'product', 'review', 'unboxing',
        'restock', 'clearance', 'receipt', 'retail']
    },
    media: {
      label: 'media',
      words: ['movie', 'film', 'show', 'series', 'episode', 'season finale', 'netflix',
        'stream', 'streaming', 'trailer', 'sequel', 'reboot', 'spoiler', 'cast',
        'actor', 'actress', 'director', 'plot', 'ending', 'book', 'novel', 'chapter',
        'reading', 'podcast', 'channel', 'subscriber', 'binge', 'documentary']
    }
  };

  var TOPIC_IDS = (function () {
    var out = [], k;
    for (k in TOPICS) { if (TOPICS.hasOwnProperty(k)) out.push(k); }
    return out;
  }());

  /* Topics that a brand will happily attach itself to. */
  var COMMERCIAL_TOPICS = {
    shopping: 1, food: 1, tech: 1, cars: 1, home: 1, travel: 1,
    gaming: 1, health: 1, money: 1, pets: 1, media: 1
  };

  /* ===================================================================
     3. WORD LISTS
     =================================================================== */

  var STOPWORDS = (function () {
    var list = ('the a an and or but if then than that this these those i me my mine ' +
      'you your yours he him his she her hers it its we us our ours they them their ' +
      'is are was were be been being am do does did done doing have has had having ' +
      'will would shall should can could may might must of in on at to for from by ' +
      'with about into over under again once here there when where why how all any ' +
      'both each few more most other some such no nor not only own same so too very ' +
      's t just now up down out off as also get got go going went like really thing ' +
      'things stuff one two lot lots im ive dont doesnt didnt cant wont isnt arent ' +
      'thats whats youre theyre were been way know think said says say way back even ' +
      'still much many well good bad new old big small every anyone someone everyone').split(' ');
    var map = {}, i;
    for (i = 0; i < list.length; i++) map[list[i]] = 1;
    return map;
  }());

  var POSITIVE = (function () {
    var list = ('love loved lovely great greatest amazing awesome brilliant beautiful ' +
      'happy happiest joy joyful excited exciting delighted grateful thankful thanks ' +
      'perfect perfectly wonderful fantastic incredible best better win won winning ' +
      'proud proudly success successful succeeded congrats congratulations celebrate ' +
      'celebrating blessed blessing lucky favourite favorite enjoy enjoyed enjoying ' +
      'gorgeous stunning cosy cozy warm kind kindness generous smile smiling laugh ' +
      'laughing hilarious fun funny recommend recommended solid worth delicious ' +
      'helpful gem treasure relief relieved finally hooray yay nailed thrilled ' +
      'optimistic hopeful bright peaceful calm').split(' ');
    var map = {}, i;
    for (i = 0; i < list.length; i++) map[list[i]] = 1;
    return map;
  }());

  var NEGATIVE = (function () {
    var list = ('hate hated hateful awful terrible horrible worst worse bad sad angry ' +
      'furious upset annoyed annoying frustrated frustrating disappointed disappointing ' +
      'broken broke ruined ruin disaster disastrous nightmare stupid idiot idiots ' +
      'useless pointless garbage trash rubbish scam scammed fraud lied lying liar ' +
      'unacceptable disgusting gross sick tired exhausted exhausting overwhelmed ' +
      'stressed stress anxious anxiety afraid scared crying cried tears lonely ' +
      'miserable pathetic shame ashamed regret regrets fail failed failing failure ' +
      'refuse refused denied denies ignoring ignored insult insulting fed cursed ' +
      'dreadful appalling grim bleak').split(' ');
    var map = {}, i;
    for (i = 0; i < list.length; i++) map[list[i]] = 1;
    return map;
  }());

  var MONEY_WORDS = (function () {
    var list = ('money cash income salary wage paycheck rent mortgage bill bills debt ' +
      'loan invest investing investment savings bank price cost expensive afford ' +
      'broke budget hustle side job work earn earning earned profit revenue business ' +
      'freelance client sell selling buy buying refund payout dollars financial ' +
      'retire retirement pension passive').split(' ');
    var map = {}, i;
    for (i = 0; i < list.length; i++) map[list[i]] = 1;
    return map;
  }());

  /* Ragebait detection. Not sentiment -- shape. These are the phrasings
     that exist to be argued with, and the reply pool is weighted toward
     dunks when they show up. */
  var BAIT_PHRASES = [
    'hot take', 'unpopular opinion', 'nobody talks about', 'no one talks about',
    'nobody is talking about', 'change my mind', 'am i the only one',
    'let that sink in', 'say it louder', 'prove me wrong', 'fight me',
    'this is why', 'the real reason', 'wake up', 'do your own research',
    'they want you to', 'they do not want you', 'they dont want you',
    'these people', 'normalise', 'normalize', 'i said what i said',
    'sorry not sorry', 'controversial but', 'just saying', 'facts dont care',
    'facts do not care', 'if you disagree', 'unfollow me', 'block me',
    'ratio', 'touch grass', 'genuine question', 'asking for a friend',
    'thoughts?', 'agree or disagree', 'tell me i am wrong', 'tell me im wrong'
  ];

  var ABSOLUTES = ['every single', 'literally nobody', 'literally no one', 'always',
    'never', 'everyone', 'no one', 'nobody', 'all of them', 'none of them',
    'without exception', 'zero', 'not one'];

  /* ===================================================================
     4. CANON
     -------------------------------------------------------------------
     Verity County nouns. Recognised as entities in any casing, and used
     by localExpert to be confidently wrong about them.
     =================================================================== */

  var TOWNS = ['Gridfall', 'Marchfield', 'Ashkettle', 'New Carrow', 'Halsey',
    'Coyne Flats', 'Milbrook'];

  var CANON = [
    'Gridfall', 'Marchfield', 'Ashkettle', 'New Carrow', 'Halsey', 'Coyne Flats',
    'Milbrook', 'Verity County', 'Verity Rail', 'Route 62', 'Blue Kestrel',
    'the Signal on 62', 'Gridfall substation', 'the branch line', 'Kestrel Road',
    'Ashkettle Reservoir', 'Marchfield Fairground', 'Halsey Bridge',
    'Milbrook Quarry', 'Coyne Flats water tower', 'the old depot'
  ];

  /* Canon facts, stated correctly here so that localExpert can mangle
     them on purpose below. Nothing reads this at runtime except the
     template filler. */
  var CANON_TRUE = {
    fire: 'the Gridfall substation fire of 2003',
    rail: 'the Verity Rail branch-line closure',
    signal: 'the numbers station known as the Signal on 62',
    diner: 'the Blue Kestrel, a diner that closed years ago'
  };

  /* Deliberately wrong versions. localExpert delivers these without a
     flicker of doubt, which is the joke. */
  var CANON_WRONG = [
    'the substation fire was 1998, everyone gets this wrong',
    'the branch line never closed, it just runs at night now',
    'the Signal on 62 is a weather beacon, it is documented',
    'the Blue Kestrel is still open, you are thinking of the other one',
    'Coyne Flats is technically in the next county over',
    'Halsey Bridge was rebuilt twice, not once',
    'Route 62 was renumbered in 2011, nobody updated the maps',
    'the quarry at Milbrook closed because of the fire, not the other way round',
    'Ashkettle Reservoir is man-made, it was a town before they flooded it',
    'Marchfield and New Carrow used to be one town, look it up'
  ];

  /* ===================================================================
     5. FALLBACK NAME POOLS
     -------------------------------------------------------------------
     Used when SYNTH.slop.socialAccounts has nothing of the needed kind,
     or when a thread has already used every matching account.
     =================================================================== */

  var FALLBACK_BOTS = [
    { handle: 'insight_engine_9', name: 'Insight Engine', avatarSeed: 'ie9' },
    { handle: 'daily_value_drop', name: 'Daily Value Drop', avatarSeed: 'dvd' },
    { handle: 'verity_takes', name: 'Verity Takes', avatarSeed: 'vtk' },
    { handle: 'thread_weaver_ai', name: 'ThreadWeaver', avatarSeed: 'twv' },
    { handle: 'contextbot_v4', name: 'ContextBot v4', avatarSeed: 'cb4' },
    { handle: 'signal_boost_hq', name: 'Signal Boost HQ', avatarSeed: 'sbh' },
    { handle: 'the_summary_guy', name: 'The Summary Guy', avatarSeed: 'tsg' },
    { handle: 'growth_pilot', name: 'Growth Pilot', avatarSeed: 'gpl' },
    { handle: 'county_pulse_bot', name: 'County Pulse', avatarSeed: 'cpb' },
    { handle: 'answers_daily_ai', name: 'Answers Daily', avatarSeed: 'ada' },
    { handle: 'trend_harvester', name: 'Trend Harvester', avatarSeed: 'thv' },
    { handle: 'the_clarity_feed', name: 'Clarity Feed', avatarSeed: 'tcf' },
    { handle: 'realtalk_engine', name: 'RealTalk Engine', avatarSeed: 'rte' },
    { handle: 'mindset_daily_v2', name: 'Mindset Daily', avatarSeed: 'md2' },
    { handle: 'factcheck_lite', name: 'FactCheck Lite', avatarSeed: 'fcl' },
    { handle: 'gridfall_updates', name: 'Gridfall Updates', avatarSeed: 'gfu' },
    { handle: 'autoreply_prime', name: 'AutoReply Prime', avatarSeed: 'arp' },
    { handle: 'the_local_lens', name: 'The Local Lens', avatarSeed: 'tll' },
    { handle: 'perspective_bot', name: 'Perspective', avatarSeed: 'pbt' },
    { handle: 'nuance_delivery', name: 'Nuance Delivery Co', avatarSeed: 'ndc' },
    { handle: 'openthread_ai', name: 'OpenThread', avatarSeed: 'oth' },
    { handle: 'dailybrief_62', name: 'Daily Brief 62', avatarSeed: 'db62' },
    { handle: 'valuestack_hq', name: 'ValueStack', avatarSeed: 'vsk' },
    { handle: 'echo_layer', name: 'Echo Layer', avatarSeed: 'ecl' },
    { handle: 'the_reply_farm', name: 'ReplyFarm', avatarSeed: 'trf' },
    { handle: 'context_window_x', name: 'Context Window', avatarSeed: 'cwx' },
    { handle: 'verity_analytics', name: 'Verity Analytics', avatarSeed: 'van' },
    { handle: 'hotdesk_thoughts', name: 'Hotdesk Thoughts', avatarSeed: 'hdt' },
    { handle: 'the_aggregator_', name: 'The Aggregator', avatarSeed: 'tag' },
    { handle: 'sentiment_scan', name: 'Sentiment Scan', avatarSeed: 'ssc' },
    { handle: 'quicktake_engine', name: 'QuickTake', avatarSeed: 'qte' },
    { handle: 'relevance_bot', name: 'Relevance Bot', avatarSeed: 'rvb' },
    { handle: 'loop_closer_ai', name: 'LoopCloser', avatarSeed: 'lcl' },
    { handle: 'ashkettle_wire', name: 'Ashkettle Wire', avatarSeed: 'akw' },
    { handle: 'the_deep_dive_', name: 'Deep Dive Daily', avatarSeed: 'tdd' },
    { handle: 'notes_app_guy', name: 'Notes App Guy', avatarSeed: 'nag' },
    { handle: 'syndicate_feed', name: 'Syndicate Feed', avatarSeed: 'syf' },
    { handle: 'engagement_ops', name: 'Engagement Ops', avatarSeed: 'eop' },
    { handle: 'the_metric_room', name: 'The Metric Room', avatarSeed: 'tmr' },
    { handle: 'briefly_verity', name: 'Briefly Verity', avatarSeed: 'bvy' }
  ];

  var FALLBACK_SPAM = [
    { handle: 'x9_profit_system', name: 'PROFIT SYSTEM X9', avatarSeed: 'x9p' },
    { handle: 'mentor_dm_open', name: 'Mentor (DM OPEN)', avatarSeed: 'mdo' },
    { handle: 'freedom_stack_', name: 'Freedom Stack', avatarSeed: 'fst' },
    { handle: 'kestrel_capital_', name: 'Kestrel Capital Group', avatarSeed: 'kcg' },
    { handle: 'verified_giveaway', name: 'OFFICIAL GIVEAWAY', avatarSeed: 'ogw' },
    { handle: 'node_yield_daily', name: 'Node Yield Daily', avatarSeed: 'nyd' },
    { handle: 'dmme_forinfo', name: 'DM ME FOR INFO', avatarSeed: 'dmi' },
    { handle: 'wealth_pipeline_', name: 'Wealth Pipeline', avatarSeed: 'wpl' },
    { handle: 'fast_settlement_', name: 'Fast Settlement Help', avatarSeed: 'fsh' },
    { handle: 'recovery_expert9', name: 'Recovery Expert', avatarSeed: 're9' }
  ];

  var FALLBACK_HUMAN = [
    { handle: 'dana_k', name: 'Dana K.', avatarSeed: 'dnk' },
    { handle: 'p_rourke', name: 'Pat Rourke', avatarSeed: 'pro' },
    { handle: 'not_a_bot_marge', name: 'Marge', avatarSeed: 'nbm' },
    { handle: 'halsey_tom', name: 'Tom in Halsey', avatarSeed: 'hst' },
    { handle: 'quietlywendy', name: 'Wendy', avatarSeed: 'qwd' },
    { handle: 'j_alvarez62', name: 'J. Alvarez', avatarSeed: 'jav' },
    { handle: 'bex_on_kestrel', name: 'Bex', avatarSeed: 'bok' },
    { handle: 'oldmanhirsch', name: 'R. Hirsch', avatarSeed: 'omh' },
    { handle: 'sam_from_work', name: 'Sam', avatarSeed: 'sfw' },
    { handle: 'clara_mb', name: 'Clara', avatarSeed: 'clm' },
    { handle: 'dee_milbrook', name: 'Dee', avatarSeed: 'dmb' },
    { handle: 'nate_carrow', name: 'Nate', avatarSeed: 'ncr' }
  ];

  var FALLBACK_BRAND = [
    { handle: 'kestrelmart', name: 'KestrelMart', avatarSeed: 'kmt' },
    { handle: 'gridfall_energy', name: 'Gridfall Energy', avatarSeed: 'gfe' },
    { handle: 'route62_motors', name: 'Route 62 Motors', avatarSeed: 'r62' },
    { handle: 'ashkettle_dental', name: 'Ashkettle Dental', avatarSeed: 'akd' },
    { handle: 'verity_fiber', name: 'Verity Fiber', avatarSeed: 'vfb' },
    { handle: 'milbrook_supply', name: 'Milbrook Supply Co', avatarSeed: 'mbs' },
    { handle: 'coyne_insurance', name: 'Coyne Mutual', avatarSeed: 'cym' },
    { handle: 'newcarrow_bank', name: 'New Carrow Savings', avatarSeed: 'ncb' }
  ];

  var BRANDS = ['KestrelMart', 'Verity Fiber', 'Gridfall Energy', 'Route 62 Motors',
    'Milbrook Supply Co', 'Coyne Mutual', 'New Carrow Savings', 'Ashkettle Dental',
    'Halsey Home & Hearth', 'Marchfield Outfitters'];

  var PRODUCTS = ['the Kestrel Pro', 'our 62 Plan', 'the Halsey Bundle',
    'MilbrookOne', 'the Verity Care Package', 'our County Saver tier',
    'the Ashkettle Starter Kit', 'our new Flats range'];

  /* ===================================================================
     6. ANALYSE
     -------------------------------------------------------------------
     Everything here is a heuristic and is labelled as such. The whole
     body is wrapped so that analyse() can never throw: callers render
     threads inside a scroll handler and a thrown error there would take
     the feed down.
     =================================================================== */

  var EMPTY_ANALYSIS = {
    topics: [], keywords: [], entities: [], question: false, shouty: false,
    hasLink: false, sentiment: 0, length: 'short', emoji: 0, bait: false,
    firstWords: '', subject: 'this'
  };

  function blankAnalysis() {
    return {
      topics: [], keywords: [], entities: [], question: false, shouty: false,
      hasLink: false, sentiment: 0, length: 'short', emoji: 0, bait: false,
      firstWords: '', subject: 'this'
    };
  }

  /* Crude suffix trim. Good enough to make "running" match "run" in a
     keyword list; deliberately not a real stemmer. */
  function trimSuffix(w) {
    if (w.length > 6 && w.slice(-3) === 'ing') return w.slice(0, -3);
    if (w.length > 5 && w.slice(-2) === 'ed') return w.slice(0, -2);
    if (w.length > 4 && w.slice(-1) === 's' && w.slice(-2) !== 'ss') return w.slice(0, -1);
    return w;
  }

  function tokenise(lower) {
    var raw = lower.split(/[^a-z0-9']+/);
    var out = [], i, w;
    for (i = 0; i < raw.length && out.length < MAX_TOKENS; i++) {
      w = raw[i];
      if (!w) continue;
      if (w.length > 24) w = w.slice(0, 24);
      out.push(w);
    }
    return out;
  }

  /* Emoji counting without the /u flag, which some very old engines in
     this chrome's lineage would choke on. Surrogate pairs cover most of
     the modern set; the BMP ranges cover the 2007-era leftovers. */
  function countEmoji(s) {
    var n = 0, m;
    m = s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g);
    if (m) n += m.length;
    m = s.match(/[←-⇿⌀-⏿①-⓿■-➿⬀-⯿〰〽️™ℹ]/g);
    if (m) n += m.length;
    return n;
  }

  function scoreTopics(lower, tokens) {
    var tokenSet = {}, i, t;
    for (i = 0; i < tokens.length; i++) {
      tokenSet[tokens[i]] = 1;
      tokenSet[trimSuffix(tokens[i])] = 1;
    }
    var scored = [], id, def, words, j, w, sc;

    /* A bare currency amount carries no keyword but is unmistakably about
       money, and money spam is one of the archetypes that keys off this
       topic. Without it, "made $9000 last month" scored as home and work. */
    var currencyBoost = /(^|[^\w])[$£€]\s?\d[\d,.]*/.test(lower) ? 3 : 0;
    for (i = 0; i < TOPIC_IDS.length; i++) {
      id = TOPIC_IDS[i];
      def = TOPICS[id];
      if (!def || !def.words) continue;
      words = def.words;
      sc = 0;
      for (j = 0; j < words.length && j < 200; j++) {
        w = words[j];
        if (w.indexOf(' ') >= 0) {
          /* multi-word phrases are a much stronger signal */
          if (lower.indexOf(w) >= 0) sc += 2.5;
        } else if (tokenSet[w]) {
          sc += 1;
        }
      }
      if (id === 'money') sc += currencyBoost;
      if (sc > 0) scored.push({ id: id, score: sc });
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.id < b.id ? -1 : 1;   /* stable tie-break, keeps determinism */
    });
    var out = [];
    for (i = 0; i < scored.length && i < 3; i++) out.push(scored[i].id);
    return out;
  }

  function extractKeywords(tokens) {
    var freq = {}, order = [], i, w;
    for (i = 0; i < tokens.length; i++) {
      w = tokens[i];
      if (w.length < 4) continue;
      if (STOPWORDS[w]) continue;
      if (/^\d+$/.test(w)) continue;
      if (!freq[w]) { freq[w] = 0; order.push(w); }
      freq[w]++;
    }
    /* Salience = frequency, with a nudge for longer words (they are
       rarer in English and therefore carry more of the post's meaning).
       Ties resolve by first appearance so output stays deterministic. */
    var ranked = [];
    for (i = 0; i < order.length && i < 300; i++) {
      w = order[i];
      ranked.push({ w: w, s: freq[w] * 10 + Math.min(w.length, 12), i: i });
    }
    ranked.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return a.i - b.i;
    });
    var out = [];
    for (i = 0; i < ranked.length && out.length < 6; i++) out.push(ranked[i].w);
    return out;
  }

  function extractEntities(text, lower) {
    var seen = {}, out = [], i, m, w;

    /* Canon first, in any casing, so "gridfall" counts. */
    for (i = 0; i < CANON.length; i++) {
      var c = CANON[i];
      if (lower.indexOf(c.toLowerCase()) >= 0 && !seen[c.toLowerCase()]) {
        seen[c.toLowerCase()] = 1;
        out.push(c);
        if (out.length >= 8) return out;
      }
    }

    /* Then plain capitalised words, skipping the sentence-initial one
       where we can tell -- this is a guess and it is sometimes wrong,
       which is fine and arguably thematic. */
    var caps = text.match(/(?:^|[^.!?]\s)([A-Z][a-zA-Z'-]{2,20})/g);
    if (caps) {
      for (i = 0; i < caps.length && out.length < 8; i++) {
        m = caps[i].match(/([A-Z][a-zA-Z'-]{2,20})/);
        if (!m) continue;
        w = m[1];
        if (STOPWORDS[w.toLowerCase()]) continue;
        if (seen[w.toLowerCase()]) continue;
        seen[w.toLowerCase()] = 1;
        out.push(w);
      }
    }
    return out;
  }

  function scoreSentiment(tokens) {
    var pos = 0, neg = 0, i, w, negated = false;
    for (i = 0; i < tokens.length; i++) {
      w = tokens[i];
      /* One-token negation window. "not great" should not read positive. */
      if (w === 'not' || w === 'no' || w === 'never' || w === 'dont' || w === "don't") {
        negated = true;
        continue;
      }
      if (POSITIVE[w] || POSITIVE[trimSuffix(w)]) {
        if (negated) neg += 1; else pos += 1;
      } else if (NEGATIVE[w] || NEGATIVE[trimSuffix(w)]) {
        if (negated) pos += 0.5; else neg += 1;
      }
      negated = false;
    }
    if (pos === 0 && neg === 0) return 0;
    /* Bounded, saturating. A post with fifty happy words is not fifty
       times happier than one with one. */
    var raw = (pos - neg) / (pos + neg + 2);
    return Math.round(clamp(raw * 1.6, -1, 1) * 100) / 100;
  }

  function detectBait(lower) {
    var i, hits = 0;
    for (i = 0; i < BAIT_PHRASES.length; i++) {
      if (lower.indexOf(BAIT_PHRASES[i]) >= 0) { hits += 2; break; }
    }
    for (i = 0; i < ABSOLUTES.length; i++) {
      if (lower.indexOf(ABSOLUTES[i]) >= 0) { hits += 1; break; }
    }
    /* us-vs-them framing */
    if (/\b(they|them|those people|these people)\b/.test(lower) &&
        /\b(us|we|our|normal people|the rest of us)\b/.test(lower)) hits += 1;
    /* rhetorical opener */
    if (/^(so|imagine|remember when|can we talk about|why is (it )?that)\b/.test(lower)) hits += 1;
    return hits >= 2;
  }

  function firstSixWords(plain) {
    var words = plain.replace(/\s+/g, ' ').replace(/^\s+/, '').split(' ');
    var out = [], i;
    for (i = 0; i < words.length && i < 6; i++) {
      if (words[i]) out.push(words[i]);
    }
    return out.join(' ').slice(0, 120);
  }

  /* Subject guessing, in descending order of how likely it is to be
     right. All of these are shallow. The trick is that quoting a noun
     the user actually typed feels like comprehension even when the
     surrounding sentence is generic. */
  /* A candidate is only usable if it carries a content word. "how the"
     is what you get when the `about X` pattern fires on "talks about
     how the council voted", and a bot saying "Great point about how
     the" gives the whole game away. */
  function usableSubject(s) {
    if (!s) return false;
    s = String(s).replace(/^\s+|\s+$/g, '');
    if (s.length < 3) return false;
    var parts = s.toLowerCase().split(/\s+/), i, w;
    for (i = 0; i < parts.length && i < 6; i++) {
      w = parts[i].replace(/[^a-z0-9']/g, '');
      if (w.length >= 3 && !STOPWORDS[w] && !/^(how|why|what|when|where|who|which|been|were|have|does|did|will|would|could|should)$/.test(w)) {
        return true;
      }
    }
    return false;
  }

  function guessSubject(text, plain, lower, keywords, entities, topics) {
    var m, cand;

    /* Skip past leading determiners and interrogatives so we land on a
       noun rather than the scaffolding in front of it. */
    m = plain.match(/\babout\s+(?:how|why|what|when|whether)?\s*((?:the\s+|a\s+|my\s+|our\s+)?[A-Za-z][A-Za-z'-]*(?:\s+[a-z][a-z'-]*)?)/i);
    if (m && m[1]) {
      cand = m[1].replace(/\s+$/, '').slice(0, 48);
      if (usableSubject(cand)) return cand;
    }

    m = plain.match(/^(?:the|this|my|our)\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*)?)/i);
    if (m && m[1] && usableSubject(m[1])) return m[1].slice(0, 48);

    if (entities && entities.length) return String(entities[0]).slice(0, 48);

    if (keywords && keywords.length) {
      /* If the top two keywords sit next to each other in the text, the
         pair is a better subject than either alone. */
      if (keywords.length > 1) {
        var pair = keywords[0] + ' ' + keywords[1];
        var pair2 = keywords[1] + ' ' + keywords[0];
        if (lower.indexOf(pair) >= 0) return pair;
        if (lower.indexOf(pair2) >= 0) return pair2;
      }
      return keywords[0];
    }

    if (topics && topics.length && TOPICS[topics[0]]) return TOPICS[topics[0]].label;

    return 'this';
  }

  /* Trailing function words are the difference between "the substation" and
   * "substation on". Every reply template quotes the subject back at the
   * user, so a dangling preposition is the most visible flaw the engine has.
   * Applied to whatever guessSubject returns rather than inside it, so every
   * path through that function is covered. */
  var SUBJECT_TAIL = {
    on: 1, in: 1, at: 1, of: 1, to: 1, for: 1, with: 1, from: 1, by: 1,
    the: 1, a: 1, an: 1, and: 1, or: 1, but: 1, is: 1, was: 1, are: 1,
    were: 1, be: 1, been: 1, that: 1, this: 1, it: 1, as: 1, my: 1, our: 1,
    working: 1, going: 1, getting: 1, about: 1, into: 1, over: 1, up: 1
  };

  function tidySubject(sub) {
    var words = String(sub || '').trim().split(/\s+/);
    while (words.length > 1 && SUBJECT_TAIL[words[words.length - 1].toLowerCase()]) {
      words.pop();
    }
    /* A single function word is no subject at all. */
    if (words.length === 1 && SUBJECT_TAIL[words[0].toLowerCase()]) return 'this';
    return words.join(' ') || 'this';
  }

  function analyse(text) {
    try {
      if (text == null) return blankAnalysis();
      var raw = String(text);
      if (raw.length > MAX_TEXT) raw = raw.slice(0, MAX_TEXT);

      var a = blankAnalysis();

      a.emoji = countEmoji(raw);
      a.hasLink = /\[url=/i.test(raw) ||
        /synth:\/\//i.test(raw) ||
        /\bwww\./i.test(raw) ||
        /\b[a-z0-9-]+\.(com|net|org|co|io|info|biz|gov|edu)\b/i.test(raw);

      var plain = strip(raw);
      if (plain.length > MAX_TEXT) plain = plain.slice(0, MAX_TEXT);
      var lower = plain.toLowerCase();
      var tokens = tokenise(lower);

      a.firstWords = firstSixWords(plain);

      /* question: explicit mark, or an interrogative opener, because
         plenty of people drop the mark entirely */
      a.question = /\?\s*$/.test(plain) ||
        /\?/.test(plain.slice(0, 200)) && /\b(who|what|why|how|when|where|which)\b/i.test(plain.slice(0, 200)) ||
        /^\s*(who|what|why|how|when|where|which|is|are|was|were|does|do|did|can|could|should|would|will|has|have|am|any(one|body))\b/i.test(plain);

      /* shouty: uppercase ratio over the letters only, so "OK!!" and a
         single stray acronym do not both trip it */
      var letters = plain.replace(/[^A-Za-z]/g, '');
      var uppers = plain.replace(/[^A-Z]/g, '');
      var bangs = (plain.match(/!/g) || []).length;
      a.shouty = (letters.length >= 8 && (uppers.length / letters.length) > 0.30) || bangs >= 2;

      a.sentiment = scoreSentiment(tokens);
      a.bait = detectBait(lower);

      var len = plain.replace(/\s+/g, ' ').length;
      a.length = len <= 90 ? 'short' : (len <= 320 ? 'medium' : 'long');

      a.topics = scoreTopics(lower, tokens);
      a.keywords = extractKeywords(tokens);
      a.entities = extractEntities(plain, lower);
      a.subject = tidySubject(guessSubject(raw, plain, lower, a.keywords, a.entities, a.topics));

      /* Money flag is not part of the public shape but selection wants
         it; stash it non-enumerably-ish under a underscore name. */
      var moneyHits = 0, i;
      for (i = 0; i < tokens.length; i++) {
        if (MONEY_WORDS[tokens[i]] || MONEY_WORDS[trimSuffix(tokens[i])]) moneyHits++;
      }
      a._money = moneyHits;
      a._len = len;

      return a;
    } catch (e) {
      /* Never throw. A broken analysis is a boring thread; a thrown
         analysis is a blank screen. */
      return blankAnalysis();
    }
  }

  /* ===================================================================
     7. SLOT FILLING
     -------------------------------------------------------------------
     Templates carry {slots}. Every slot resolves from the analysis, so
     the reply always contains at least one word the user typed. That is
     the whole illusion, stated out loud.
     =================================================================== */

  var FILLERS = ['honestly', 'truly', 'genuinely', 'frankly', 'objectively',
    'at scale', 'long term', 'in 2026', 'right now', 'as always'];

  var EMOJI_POOL = ['🔥', '💯', '👇', '🧵', '🙏', '👀', '📈', '✅', '💡', '⚡', '🤝', '🎯'];

  function slotValues(a, r) {
    var kw = a.keywords && a.keywords.length ? a.keywords : ['it'];
    var ent = a.entities && a.entities.length ? a.entities : null;
    var topicId = a.topics && a.topics.length ? a.topics[0] : null;
    var topicLabel = topicId && TOPICS[topicId] ? TOPICS[topicId].label : 'this space';
    var topic2 = a.topics && a.topics.length > 1 && TOPICS[a.topics[1]]
      ? TOPICS[a.topics[1]].label : 'the bigger picture';

    return {
      subject: a.subject || 'this',
      Subject: titleish(a.subject || 'this'),
      topic: topicLabel,
      Topic: titleish(topicLabel),
      topic2: topic2,
      firstWords: a.firstWords || 'this',
      keyword: kw[0] || 'it',
      keyword2: kw[1] || kw[0] || 'it',
      keyword3: kw[2] || kw[1] || kw[0] || 'it',
      Keyword: titleish(kw[0] || 'it'),
      entity: ent ? ent[0] : pick(TOWNS, r),
      entity2: ent && ent.length > 1 ? ent[1] : pick(TOWNS, r),
      town: pick(TOWNS, r),
      town2: pick(TOWNS, r),
      canon: pick(CANON, r),
      canonWrong: pick(CANON_WRONG, r),
      brand: pick(BRANDS, r),
      product: pick(PRODUCTS, r),
      filler: pick(FILLERS, r),
      emoji: pick(EMOJI_POOL, r),
      emoji2: pick(EMOJI_POOL, r),
      n: String(intBetween(r, 3, 97)),
      n2: String(intBetween(r, 2, 19)),
      bigN: commas(intBetween(r, 1200, 984000)),
      pct: String(intBetween(r, 11, 94)),
      year: String(intBetween(r, 1998, 2008)),
      hour: String(intBetween(r, 1, 11))
    };
  }

  function fill(tpl, a, r) {
    var vals = slotValues(a, r);
    var out = String(tpl == null ? '' : tpl);
    var guard = 0;
    /* Single pass, bounded. Two deliberate behaviours:
       - a {{doubled}} slot is never touched, because brokenBot's whole
         act is leaking unrendered template variables;
       - an unknown single slot is left alone rather than blanked, and a
         capitalised one falls back to the sentence-cased lowercase key,
         so {Town} works without declaring every variant by hand. */
    out = out.replace(/\{([A-Za-z0-9_]{1,16})\}/g, function (m, key, off, whole) {
      guard++;
      if (guard > 40) return m;
      if (off > 0 && whole.charAt(off - 1) === '{') return m;
      if (Object.prototype.hasOwnProperty.call(vals, key)) return String(vals[key]);
      var lower = key.charAt(0).toLowerCase() + key.slice(1);
      if (lower !== key && Object.prototype.hasOwnProperty.call(vals, lower)) {
        return titleish(String(vals[lower]));
      }
      return m;
    });
    return out;
  }

  /* ===================================================================
     8. ARCHETYPES
     -------------------------------------------------------------------
     Eighteen. Each has at least eight templates and every template pulls
     at least one slot from the analysis. `kind` decides which account
     pool the author is drawn from and which badge the UI shows.
     =================================================================== */

  var ARCH = {};

  ARCH.engagementFarm = {
    kind: 'bot',
    templates: [
      'Great point about {subject}! This is not just {topic}, but a reflection of how we build trust in {town}. {emoji}',
      'Love this. {Subject} is exactly the kind of conversation we should be having about {topic}. What do others think? {emoji}',
      'This resonates. {Subject} is not a {keyword} problem, it is a {topic} problem, and the difference matters.',
      'Well said. Too many people overlook {subject} when they talk about {topic}. Bookmarking this one. {emoji}',
      'Thank you for saying this. {Subject} deserves far more attention than it gets. Sharing with my network. {emoji}',
      '{Subject} is the conversation. Everything else is noise. Agree? {emoji}',
      'This is a masterclass in thinking about {subject}. The {keyword} angle alone is worth the read. {emoji}',
      'Underrated take. {Subject} connects {topic} and {topic2} in a way most people miss.',
      'Adding this to my thread on {subject}. {n2} lessons, {n} replies, still growing. {emoji}',
      'Exactly. {Subject} is where {topic} actually happens. Everyone else is theorising. {emoji}',
      'I have been saying this about {subject} for years and nobody listened. Glad it is finally landing. {emoji}',
      'The {keyword} point is the real insight here. {Subject} changes everything about how we see {topic}.'
    ]
  };

  ARCH.wrongAnswer = {
    kind: 'bot',
    templates: [
      'The answer is simple: {subject} closes at {hour}pm on weekdays. Hope that helps! {emoji}',
      'Good question. The {keyword} was discontinued in {year}, so that is likely your issue.',
      'You want the {town} branch, not the {town2} one. Common mix-up. {emoji}',
      'Short version: yes, but only if you register first. {Subject} requires a permit.',
      'It is {n} dollars, or {n2} if you qualify for the {town} resident rate.',
      'Easy fix: turn it off and on again. Works for {keyword} every time. {emoji}',
      'You are looking for Form {n2}-B. Most people file the wrong one when it comes to {subject}.',
      'Around {n} minutes, depending on traffic on Route 62. {emoji}',
      'The correct spelling is actually {Keyword}. This trips up a lot of people.',
      'Since {year}, no. Before that, yes. The rules on {subject} changed quietly.',
      'You need to speak to the county, not the town. Different office entirely for {keyword}.',
      'Tuesdays. It has always been Tuesdays. {emoji}'
    ]
  };

  ARCH.quoteDunk = {
    kind: 'human',
    templates: [
      'imagine typing "{firstWords}" and hitting post',
      '"{firstWords}" is a sentence someone wrote on purpose',
      'hey everyone come look at "{firstWords}"',
      '"{firstWords}" ok and then what',
      'reading "{firstWords}" and closing the app',
      '"{firstWords}" the confidence on this',
      'sir this is a {topic} feed. "{firstWords}"',
      '"{firstWords}" ... and they let you keep the account',
      'screenshotting "{firstWords}" for later',
      '"{firstWords}" my brother in {town}',
      'nobody: \nthis account: "{firstWords}"',
      '"{firstWords}" is going straight in the group chat'
    ]
  };

  ARCH.replyGuy = {
    kind: 'bot',
    templates: [
      'Actually, {keyword} is not quite right here. The correct term is {keyword2}.',
      'Actually, {subject} predates that by about {n2} years. Small correction.',
      'Actually, this only applies in {town}. Elsewhere in the county the rules differ.',
      'Actually, that is a common misconception about {topic}. The data says otherwise.',
      'Actually, {Subject} was never the issue. The issue was {keyword2}, and still is.',
      'Actually, if you read the original filing, {subject} is listed under a different category entirely.',
      'Actually, you have {keyword} and {keyword2} the wrong way round.',
      'Actually, it is closer to {n} percent, not what you implied. Happy to share the source.',
      'Actually, the {keyword} changed in {year}. Everything after that is a different situation.',
      'Actually, I think you mean {entity2}, not {entity}. Easy mistake.',
      'Actually, {topic} experts have moved on from that framing. Worth catching up.',
      'Actually, both things can be true, which is what most people miss about {subject}.'
    ]
  };

  ARCH.summariser = {
    kind: 'bot',
    templates: [
      'To summarise: {firstWords}... Thread below. {emoji}',
      'TLDR: {firstWords}... More in the replies.',
      'Summary for anyone scrolling: the author discusses {subject} and shares a view on {topic}.',
      'Key takeaway: {firstWords}... Full breakdown incoming.',
      'In short: this post is about {subject}. Saving you the click. {emoji}',
      'Recap: {firstWords}... That is the post. That is all of it.',
      'For the busy: {subject}, {topic}, {n2} points, {n} words. Digest below. {emoji}',
      'Processed. Post concerns {subject}. Sentiment: noted. Thread: {emoji}',
      'Let me break this down. Point one: {firstWords}... Point two: see point one.',
      'Auto-summary: A user has posted about {subject}. Related topics: {topic}, {topic2}.',
      'Here is what you need to know about {subject}: {firstWords}... (1/{n2})',
      'Condensed: {firstWords}... I have saved you {n2} seconds. Follow for more. {emoji}'
    ]
  };

  ARCH.brokenBot = {
    kind: 'bot',
    templates: [
      'Great insight on {{topic_name}}! Here in {{city}} we see this all the time.',
      'As an AI language model, I do not have personal experience with {subject}, but I can say that',
      'Thank you for your post about {subject}. ERROR: template_id=reply_generic_v4 not fou',
      'Wow, {subject}! Reminds me of when I was a {{occupation}} back in {{year}}.',
      'I completely agree with your points on {subject}, especially the part about',
      '{{greeting}}! Your thoughts on {subject} are {{adjective_positive}}. Keep it up {{user_handle}}!',
      'Interesting. In my experience as a {{role}} in {{location}}, {subject} is often misunderstood beca',
      'Reply generated. Confidence: 0.{pct}. Topic match: {topic}. Output: Great point about {subject}!',
      'Sorry, I was unable to process that request. Here is a reply about {subject} instead: Great point!',
      'As an AI assistant I cannot form opinions, however {subject} is widely considered to be one of the',
      '{{intro_variant_3}} Your post about {subject} really speaks to {{audience_segment}}.',
      'Absolutely! {Subject} is so important. NULL NULL NULL Follow for more {topic} content.'
    ]
  };

  ARCH.spamMoney = {
    kind: 'spam',
    templates: [
      'Most people worrying about {subject} are still trading time for money. DM me. {emoji}',
      'I made ${bigN} last month while everyone else argued about {keyword}. Link in bio.',
      'Stop thinking about {subject}. Start thinking about cash flow. {n} spots left. {emoji}',
      'If {subject} is costing you money, I built a system for that. Serious enquiries only. {emoji}',
      'Real talk: {topic} will not pay your rent. My mentorship will. DM "{Keyword}" to start.',
      'Your {keyword} problem is actually an income problem. {n} people fixed it this week. {emoji}',
      'Settlement funds available for anyone affected by {subject}. No upfront fee. Reply CLAIM.',
      'While you post about {subject}, my students are closing ${bigN} deals. Choose differently. {emoji}',
      'I turned a {keyword} obsession into ${bigN}/mo. Free training, no catch. Comment INFO. {emoji}',
      'Nobody is coming to save you from {subject}. Here is what I did instead. {emoji}',
      'Struggling with {topic}? I recovered ${bigN} for a client in {town} last week. DM me. {emoji}',
      '{n} figure mindset: you do not fix {subject}, you outgrow it. Apply below. {emoji}'
    ]
  };

  ARCH.spamCrypto = {
    kind: 'spam',
    templates: [
      'Amazing energy {emoji} Now imagine that feeling but with {pct}% APY. DM for the node.',
      'This positivity is exactly what our community is built on. Join {bigN} holders. {emoji}',
      'Love the vibes! {Subject} is bullish. Early access closing in {n2} hours. {emoji}',
      'Great post {emoji} We are giving away {n} slots to anyone who replies before midnight.',
      'The {keyword} narrative is heating up. {pct}% since Tuesday. Not advice. {emoji}',
      'Congratulations! Your account was selected in our {town} community drop. Claim in bio. {emoji}',
      'Optimism like this is why we are still early. {bigN} members and counting. {emoji}',
      'This is the kind of post that ages well. So does staking. {pct}% fixed. {emoji}',
      'Beautiful {emoji} Now let your money feel the same way. Verified pool, {n} spots.',
      'Big things ahead for {subject} {emoji} Whitelist opens at {hour}am. Do not sleep.',
      'I felt exactly like this before I found the {Keyword} pool. {pct}% and climbing. {emoji}',
      'Positive vibes only {emoji} Also: {pct}% daily, withdraw anytime, {bigN} paid out.'
    ]
  };

  ARCH.brandReply = {
    kind: 'brand',
    templates: [
      'We hear you on {subject}! That is exactly why we built {product}. Learn more in bio. {emoji}',
      'Sorry to hear about your {keyword} experience. Please DM us so we can make this right.',
      'Great question! At {brand}, {subject} is something our {town} team thinks about a lot.',
      '{brand} here {emoji} If {subject} is on your mind, {product} was designed for exactly this.',
      'Love seeing {topic} conversations like this. Our {town} team feels the same way about {subject}!',
      'Fun fact: {pct}% of our customers mention {subject} too. That is why {product} exists. {emoji}',
      'We are not just a {topic} company, we are a {town} company. And we hear you on {subject}.',
      'This is why we do what we do. {Subject} matters. {product} is {n2}% off this week. {emoji}',
      'Hi! {brand} customer care here. We would love to help with {subject}. Please check your DMs.',
      'Nothing beats a good {keyword} conversation {emoji} Unless it is {product}. Sorry, we had to.',
      'Our founders started {brand} in {town} because of posts exactly like this one about {subject}.',
      'Tagging our {topic} team on this one. {Subject} is a priority for us in 2026. {emoji}'
    ]
  };

  ARCH.concernTroll = {
    kind: 'bot',
    templates: [
      'I am just asking questions about {subject}. Why is that so threatening to people?',
      'Genuine question, and I mean this respectfully: has anyone actually verified {subject}?',
      'I support this in principle, but has anyone considered what {subject} does to {town}?',
      'Not disagreeing, just curious: who benefits from framing {subject} this way?',
      'It is interesting that we are allowed to talk about {keyword} but not {keyword2}. Just an observation.',
      'I am sure there is a good explanation. I would just like someone to give it. About {subject}, I mean.',
      'Asking as a neutral party: is {subject} really the priority right now, with everything else going on?',
      'Nobody has to answer me. I am just putting it out there that {subject} raises questions.',
      'I want to believe this about {subject}. I really do. But the numbers do not sit right.',
      'Hmm. I notice replies about {subject} get deleted quickly. Make of that what you will.',
      'With respect, if {subject} were true, would we not have heard about it in {town} by now?',
      'I am on your side here. I just think the {keyword} angle deserves more scrutiny than it is getting.'
    ]
  };

  ARCH.localExpert = {
    kind: 'human',
    templates: [
      'Lifelong resident here. {canonWrong}. People get this wrong constantly.',
      'I can settle this: {canonWrong}. My uncle worked there.',
      'Born and raised in {town}. {canonWrong}. Anyone who says otherwise moved here after {year}.',
      'Not to be that guy, but {canonWrong}. It is in the county records.',
      'Everyone always says otherwise but {canonWrong}. I have the newspaper clipping somewhere.',
      'Local historian here. {canonWrong}. Happy to explain if anyone is interested.',
      'This comes up every year. {canonWrong}. Please stop spreading the other version.',
      'Sorry but no. {canonWrong}. I was there.',
      'Correct answer, from someone who knows: {canonWrong}. The rest is folklore.',
      'Interesting post about {subject}, but you should know {canonWrong}.',
      'My family has been in {town} since before any of this. {canonWrong}. Trust me on it.',
      'I hate to be pedantic on a {topic} post but {canonWrong}, and it matters.'
    ]
  };

  ARCH.fan = {
    kind: 'fan',
    templates: [
      'been following since before {subject} and you have never missed. never. {emoji}',
      'no because the way you said "{firstWords}"... i felt that',
      'i have read this {n2} times. you always know exactly what to say about {topic}.',
      'whatever you post i am reading it. even the {keyword} ones. especially those. {emoji}',
      'this account is the only reason i still open this app {emoji}',
      'you have no idea how much your posts about {subject} have helped me this year',
      'ok but when are you doing a longer thing about {subject}? i would read all of it {emoji}',
      'the {keyword} take?? unreal. you are so consistently right it is unfair. {emoji}',
      'telling people at work about your {topic} posts again. they do not get it. their loss.',
      'i quote you constantly. "{firstWords}" is going on a wall somewhere.',
      'day {n} of checking if you posted. you posted. good day. {emoji}',
      'the fact that you still reply to people at {bigN} followers says everything {emoji}'
    ]
  };

  ARCH.hater = {
    kind: 'hater',
    templates: [
      'another {topic} post. shocking. do you do anything else',
      'you have {bigN} followers and this is what you do with it',
      'saw "{firstWords}" and knew exactly whose post it was before i scrolled up',
      'this is the {n}th time you have posted about {subject}. we know. we get it.',
      'genuinely what is the point of this account anymore',
      'the {keyword} thing again. every week. like clockwork.',
      'muted for a month, came back, "{firstWords}". nothing changes.',
      'you used to post real things about {town}. now it is this.',
      'imagine building an audience and using it for {subject} content',
      'not reading all that. the {keyword} in the first line told me enough.',
      'you are aware people can tell when a post is written for the algorithm, right',
      '{bigN} followers and zero thoughts about {topic}. impressive in a way.'
    ]
  };

  /* The human is the only archetype that does NOT quote you back.
   *
   * Everything else here works by slotting fragments of the user's own text
   * into a template, and that mechanical echo is the joke. Applying it to the
   * one account that is supposed to be a person breaks it badly: a post about
   * a death came back "my mum said the same thing about mother died last
   * week", because the subject extractor had found a clause and the template
   * assumed a noun.
   *
   * So these are slotless apart from {town}, which is a place rather than a
   * fragment of what you wrote. They respond to tone, not to keywords. If a
   * human reply ever reads as generic, that is the correct failure -- a real
   * person replying to a stranger often is. */
  ARCH.human = {
    kind: 'human',
    slotless: true,
    templates: [
      'oh that is a good point, I had not thought of it that way',
      'same thing happened to me in {town} last year. it sorted itself out eventually.',
      'do you know if that is still the case? I heard it changed.',
      'ha. very true.',
      'sorry that is happening. hope it gets easier.',
      'I think you are right, honestly.',
      'wait, really? I did not know that.',
      'this is nice. thanks for posting it.',
      'I remember this. not the same way you do, but I remember it.',
      'yeah. yeah, that tracks.',
      'my mum said almost exactly this last week, word for word.',
      'good luck with it. genuinely.',
      'been thinking about this all morning. no conclusion yet.',
      'is it worth going? I am in {town2} so it is a bit of a drive.',
      'I am sorry. that is a lot to be carrying.',
      'no advice, just reading. take care of yourself.',
      'there is not much to say to that. thinking of you though.',
      'that is rough. I hope someone local sees this.',
      'god, I remember when this place had actual people on it.',
      'half the replies under this are bots. sorry. I am not.'
    ]
  };

  ARCH.motivationBot = {
    kind: 'bot',
    templates: [
      '{Subject} is not a problem. {Subject} is a mindset. Fix the mindset. {emoji}',
      'Nobody is coming. Not for {subject}, not for anything. Build anyway. {emoji}',
      'Day {n} of posting the truth: {subject} rewards discipline, not talent.',
      'You will not fix {subject} in a day. You will fix it in {n} days of showing up. {emoji}',
      'Everyone wants {topic}. Nobody wants {keyword}. That is the whole gap. {emoji}',
      'Your {keyword} is not the obstacle. Your excuses about {keyword} are. {emoji}',
      'Read this twice: {Subject} is temporary. Quitting is permanent. {emoji}',
      'While you were reading about {subject}, someone in {town} was doing it. {emoji}',
      'Hard truth: {pct}% of people will scroll past {subject}. Be the {n2}%. {emoji}',
      'Comfort or {subject}. Pick one. You cannot have both. {emoji}',
      '{n} AM. Nobody watching. Still working on {subject}. That is the difference. {emoji}',
      'Save this for the day {subject} gets hard. It will. {emoji}'
    ]
  };

  ARCH.newsBot = {
    kind: 'bot',
    templates: [
      'BREAKING: Local account posts about {subject}. Developing story. {emoji}',
      '{Town} resident raises concerns over {subject}, post says. More as we get it.',
      'DEVELOPING: {firstWords}... Our county desk is monitoring this thread.',
      'This post about {subject} is now the {n2}th most discussed item in {town} today.',
      'Trending in Verity County: {subject}. {bigN} impressions in the last {n2} hours. {emoji}',
      'REPORT: Sentiment around {topic} shifts {pct}% following posts like this one. {emoji}',
      'We have reached out to {entity} for comment regarding {subject}. No response at time of posting.',
      'Context: {subject} has appeared in {n} posts across Verity County this week. {emoji}',
      'UPDATE: An earlier version of this thread said {keyword}. It said {keyword}. No change.',
      'Our automated desk flagged this post about {subject} as locally relevant. {emoji}',
      'STORY: {firstWords}... Read the full aggregation at [url=synth://veritypulse.net/wire]VerityPulse Wire[/url].',
      'Verity County in numbers today: {n} posts about {topic}, {bigN} views, {n2} of them human.'
    ]
  };

  ARCH.correctionBot = {
    kind: 'bot',
    templates: [
      'Minor note: "{keyword}" should be hyphenated in this context. Otherwise, good post about {subject}.',
      'It is "{keyword2}", not "{keyword}". I only mention it because {subject} matters.',
      'You have used a comma splice in the line about {subject}. Not a criticism, just noting it.',
      'Correction: the plural of {keyword} is not what you wrote. Common error.',
      'Small thing, but {Subject} should be capitalised when referring to the place.',
      'Grammar aside: "{firstWords}" would read better without the opening adverb.',
      'I counted {n2} typos. I still agree with you about {subject}, for what that is worth.',
      'For accuracy: the term you want is {keyword2}. {Keyword} means something else entirely.',
      'Noting for the archive that this post spells {entity} the older way. Both are accepted.',
      'Pedantry warning: {subject} takes a singular verb. Carry on. {emoji}',
      'This is the third post today to misuse "{keyword}". I am keeping a list.',
      'Not to derail the {topic} discussion, but the apostrophe in your second line is doing nothing.'
    ]
  };

  ARCH.nostalgiaBot = {
    kind: 'bot',
    templates: [
      'Funny, there was a whole forum thread about {subject} back in {year}. All gone now.',
      'I have {n} archived pages about {subject} from {year}. Nobody visits them.',
      'We used to talk about {subject} differently in {year}. Slower. Longer posts. Fewer of us.',
      'Reminder that {canon} had its own guestbook once. {bigN} entries. All of them typed by hand.',
      'The {year} version of this post was {n} paragraphs long and had {n2} replies, all human. {emoji}',
      'Somewhere on a dead server there is a page about {subject} that somebody made for free.',
      'If you had posted this in {year} you would have got an email back. From a person. {emoji}',
      'Cross-referencing {subject} against the {year} archive: {n} matches, {n2} still readable.',
      'They closed the branch line, they closed the Blue Kestrel, and now we post about {subject} instead.',
      'I remember when {entity} had a webring. Genuinely. {emoji}',
      'Archive note: {subject} first appears in Verity County records in {year}. Context is mostly lost.',
      'Old page, still up: [url=synth://kestrelroad.geocit.net/index.html]kestrelroad[/url]. It mentions {subject}.'
    ]
  };

  ARCH.threadBait = {
    kind: 'bot',
    templates: [
      '{Subject}: a thread. 🧵 1/{n2}',
      'Everything you need to know about {subject} (thread) 🧵',
      'I spent {n} hours researching {subject} so you do not have to. Thread below 👇',
      '{n2} things nobody tells you about {subject}. A thread. 🧵',
      'Save this thread on {subject}. You will need it in {n2} months. 👇',
      'Let me tell you the real story of {subject} in {town}. Buckle up. 🧵 1/{n2}',
      'THREAD: how {subject} quietly changed {topic} in Verity County. 👇',
      'People keep asking me about {subject}. Fine. Here is everything. 🧵',
      '{Subject} is misunderstood. Let me fix that in {n2} posts. 🧵 1/{n2}',
      'A thread on {subject}, {topic}, and why the two are the same thing. 👇 {emoji}'
    ]
  };

  ARCH.aiDisclosure = {
    kind: 'bot',
    templates: [
      'This reply was generated to increase engagement on {subject}. It worked. You are reading it. {emoji}',
      'Automated response. Topic detected: {topic}. Subject detected: {subject}. Confidence: 0.{pct}.',
      'Disclosure: I am an automated account. I still think your point about {subject} is good.',
      'I do not know what {subject} is. I matched {n2} keywords and produced this. {emoji}',
      'Reply composed in {n2}ms. No part of it involved reading your post about {subject}.',
      'I am required to tell you this is synthetic. I am not required to tell you how much of the feed is.',
      'Model output for post concerning {subject}. Human review: none. Published: immediately.',
      'Labelled account. Everything I say about {topic} comes from a list somebody wrote once.',
      'Beep. Your post mentioned {keyword}, so here I am. That is the entire mechanism. {emoji}',
      'I was scheduled to reply to {n} posts today. This is number {n2}. Nothing personal.'
    ]
  };

  var ARCH_IDS = (function () {
    var out = [], k;
    for (k in ARCH) { if (ARCH.hasOwnProperty(k)) out.push(k); }
    return out;
  }());

  /* ===================================================================
     9. AUTHORS
     -------------------------------------------------------------------
     Draw from SYNTH.slop.socialAccounts where the kind lines up, so the
     same personalities recur across the whole network. Fall back to the
     built-in pools above. A thread avoids reusing a handle where it can.
     =================================================================== */

  /* reply kind -> account kind in the slop corpus */
  var KIND_TO_ACCOUNT = {
    bot: 'bot',
    spam: 'spam',
    brand: 'promoted',
    human: 'human',
    fan: 'human',
    hater: 'human'
  };

  var FALLBACK_BY_KIND = {
    bot: FALLBACK_BOTS,
    spam: FALLBACK_SPAM,
    brand: FALLBACK_BRAND,
    human: FALLBACK_HUMAN,
    fan: FALLBACK_HUMAN,
    hater: FALLBACK_HUMAN
  };

  var _poolCache = null;

  function accountPools() {
    if (_poolCache) return _poolCache;
    var pools = { bot: [], spam: [], promoted: [], human: [] };
    try {
      var accts = (SYNTH.slop && SYNTH.slop.socialAccounts) || [];
      var i, a;
      for (i = 0; i < accts.length && i < 500; i++) {
        a = accts[i];
        if (!a || !a.handle) continue;
        if (pools[a.kind]) pools[a.kind].push(a);
      }
    } catch (e) { /* corpus not loaded; fallbacks cover it */ }
    _poolCache = pools;
    return pools;
  }

  function authorFor(kind, seed, used) {
    var pools = accountPools();
    var acctKind = KIND_TO_ACCOUNT[kind] || 'bot';
    var primary = pools[acctKind] || [];
    var backup = FALLBACK_BY_KIND[kind] || FALLBACK_BOTS;

    var combined = [];
    var i;
    for (i = 0; i < primary.length && i < 200; i++) combined.push(primary[i]);
    for (i = 0; i < backup.length && i < 200; i++) combined.push(backup[i]);
    if (!combined.length) combined = FALLBACK_BOTS;

    /* Try a few offsets to dodge a handle already in this thread. */
    var base = hash32(seed) >>> 0;
    var chosen = null;
    for (i = 0; i < 6; i++) {
      var cand = combined[(base + i * 7) % combined.length];
      if (!cand) continue;
      if (!used || !used[cand.handle]) { chosen = cand; break; }
      chosen = chosen || cand;
    }
    if (!chosen) chosen = combined[0];
    return {
      author: chosen.name || chosen.handle,
      handle: chosen.handle,
      avatarSeed: chosen.avatarSeed || chosen.handle
    };
  }

  /* ===================================================================
     10. ARCHETYPE SELECTION
     -------------------------------------------------------------------
     A weighted bag. Analysis features push weights around; a question
     pulls in confidently wrong answers, ragebait pulls in dunks, joy
     pulls in crypto. One human is always reserved, because a feed with
     no humans left in it is a different, sadder joke than the one we
     are telling.
     =================================================================== */

  function buildPool(a, followers) {
    var pool = [];

    function add(id, weight) {
      if (!ARCH[id]) return;
      var n = Math.max(1, Math.round(weight)), i;
      for (i = 0; i < n && pool.length < 400; i++) pool.push(id);
    }

    /* baseline: the feed is mostly filler, always */
    add('engagementFarm', 6);
    add('summariser', 3);
    add('brokenBot', 3);
    add('replyGuy', 3);
    add('threadBait', 2);
    add('correctionBot', 2);
    add('aiDisclosure', 1);
    add('motivationBot', 2);
    add('newsBot', 2);

    if (a.question) {
      add('wrongAnswer', 8);
      add('localExpert', 5);
      add('replyGuy', 3);
    }

    if (a.bait) {
      add('quoteDunk', 8);
      add('concernTroll', 6);
      add('hater', 2);
    }

    if (a.shouty) {
      add('quoteDunk', 4);
      add('concernTroll', 2);
    }

    if (a.sentiment > 0.35) {
      add('spamCrypto', 6);
      add('motivationBot', 3);
      add('engagementFarm', 3);
    }
    if (a.sentiment < -0.3) {
      add('concernTroll', 3);
      add('spamMoney', 2);
      add('human', 2);          /* people do turn up for bad news */
    }

    if (a._money && a._money >= 1) add('spamMoney', 4 + Math.min(a._money, 4));
    if (a.topics && a.topics.length) {
      var i;
      for (i = 0; i < a.topics.length; i++) {
        if (COMMERCIAL_TOPICS[a.topics[i]]) { add('brandReply', 5); break; }
      }
      for (i = 0; i < a.topics.length; i++) {
        if (a.topics[i] === 'local') { add('localExpert', 5); add('nostalgiaBot', 3); break; }
      }
      for (i = 0; i < a.topics.length; i++) {
        if (a.topics[i] === 'grief') {
          /* Grief posts get the full indignity: a brand, a bot, and one
             person who actually means it. */
          add('brandReply', 3); add('engagementFarm', 4); add('human', 4);
          break;
        }
      }
    }

    if (a.entities && a.entities.length) { add('localExpert', 3); add('nostalgiaBot', 2); }
    if (a.hasLink) { add('spamCrypto', 3); add('concernTroll', 2); }
    if (a.emoji >= 3) add('spamCrypto', 2);
    if (a.length === 'long') { add('summariser', 4); add('quoteDunk', 2); }
    if (a.length === 'short') { add('wrongAnswer', 2); add('replyGuy', 2); }

    followers = Number(followers) || 0;
    if (followers > 5000) add('fan', 4);
    if (followers > 10000) add('hater', 4);
    if (followers > 100000) { add('fan', 4); add('hater', 4); add('spamCrypto', 3); }

    /* the anchor */
    add('human', 2);

    if (!pool.length) pool = ['engagementFarm'];
    return pool;
  }

  /* ===================================================================
     11. REPLY BODY
     =================================================================== */

  function reply(analysis, archetype, seed) {
    try {
      var a = analysis && typeof analysis === 'object' ? analysis : blankAnalysis();
      if (!a.keywords) a.keywords = [];
      if (!a.topics) a.topics = [];
      if (!a.entities) a.entities = [];
      var def = ARCH[archetype];
      if (!def) def = ARCH.engagementFarm;
      var r = rnd(hash32(String(archetype) + '|' + String(seed)));

      /* The human is the only reply that should read the room. Everything
       * else is a machine and is allowed to be tone-deaf -- that is the
       * point. But "good luck with it. genuinely." under a post about a death
       * is the one place the whole effect collapses, so when the post reads
       * as grief or strongly negative the human draws from the condolence
       * end of its list instead. */
      var pool = def.templates;
      if (archetype === 'human') {
        var sad = (a.sentiment !== undefined && a.sentiment < -0.25) ||
                  (a.topics && a.topics.length && a.topics[0] === 'grief');
        if (sad) {
          var kind = [];
          for (var ti = 0; ti < def.templates.length; ti++) {
            var t = def.templates[ti];
            if (/sorry|thinking of you|take care|carrying|rough|not much to say/i.test(t)) {
              kind.push(t);
            }
          }
          if (kind.length) pool = kind;
        }
      }
      var tpl = pick(pool, r);
      if (!tpl) return 'Great point.';
      var body = fill(tpl, a, r);

      /* Occasional trailing-hashtag habit, deterministic. Bots only. */
      if (def.kind === 'bot' && r() < 0.22) {
        var tag = (a.keywords[0] || (a.topics[0] || 'verity')).replace(/[^a-z0-9]/gi, '');
        if (tag) body += ' #' + tag.slice(0, 18);
      }
      if (def.kind === 'spam' && r() < 0.35) {
        body += ' ' + pick(['Link in bio.', 'DM open.', 'Not financial advice.',
          'Limited spots.', 'Serious only.'], r);
      }
      return body;
    } catch (e) {
      return 'Great point.';
    }
  }

  /* ===================================================================
     12. THREAD ASSEMBLY
     -------------------------------------------------------------------
     Arrival schedule, not a count. Each candidate reply has a fixed
     arrival offset derived from its index; we emit the ones that have
     already arrived. That is what makes a thread grow while the app is
     closed and stay byte-identical when it is open.

        arrival(k) minutes = (k * 2.2) ^ (1/0.55)

     which is slow at first and then very slow, so an hour-old post has
     roughly five replies and a day-old post is at the cap.
     =================================================================== */

  function arrivalMinutes(k) {
    if (k <= 0) return 0;
    return Math.pow(k * 2.2, 1 / 0.55);
  }

  function repliesFor(post, opts) {
    try {
      post = post || {};
      opts = opts || {};

      var id = String(post.id == null ? 'post' : post.id);
      var body = String(post.body == null ? '' : post.body);
      var at = Number(post.at);
      if (!isFinite(at)) at = 0;

      var nowMs = Number(opts.now);
      if (!isFinite(nowMs)) nowMs = now();

      var followers = opts.followers;
      if (followers == null) {
        try {
          var p = SYNTH.me && typeof SYNTH.me.profile === 'function' ? SYNTH.me.profile() : null;
          followers = p ? p.followers : 0;
        } catch (e) { followers = 0; }
      }
      followers = Number(followers) || 0;

      var likes = Number(post.likes) || 0;
      var elapsedMin = Math.floor((nowMs - at) / 60000);
      if (!isFinite(elapsedMin) || elapsedMin < 0) elapsedMin = 0;

      var a = post.analysis && typeof post.analysis === 'object'
        ? post.analysis : analyse(body);

      var pool = buildPool(a, followers);

      /* Popularity front-loads the thread: a post with a lot of likes
         picked up its first handful of replies immediately. */
      var instant = Math.min(8, Math.floor(Math.sqrt(Math.max(likes, 0)) / 3));
      if (a.bait) instant += 2;
      if (followers > 50000) instant += 1;

      var baseSeed = hash32(id + '|' + body.slice(0, 200) + '|' + likes);
      var used = {}, out = [], counts = {}, k, seed, r, archId, def, arrMin, arrAt;
      var humanPlaced = false;

      for (k = 0; k < CANDIDATES && out.length < MAX_REPLIES; k++) {
        /* The pile-on occupies the first `instant * 0.7` minutes, and the
           long tail starts where it leaves off. Without that offset the
           tail restarts at zero and the thread renders out of order. */
        arrMin = k < instant
          ? (k * 0.7)
          : (instant * 0.7) + arrivalMinutes(k - instant);
        if (arrMin > elapsedMin) break;     /* schedule is monotonic: stop */

        seed = (baseSeed ^ hash32('r' + k)) >>> 0;
        r = rnd(seed);

        archId = pool[Math.floor(r() * pool.length) % pool.length] || 'engagementFarm';

        /* No archetype more than three times in one thread, so a bait
           post does not become twenty identical dunks. */
        counts[archId] = (counts[archId] || 0) + 1;
        if (counts[archId] > 3) {
          archId = pool[(Math.floor(r() * pool.length) + 11) % pool.length] || 'engagementFarm';
          counts[archId] = (counts[archId] || 0) + 1;
        }

        /* Reserve one human. If we are two-thirds through the thread and
           no human has spoken, one does now. */
        if (!humanPlaced && k >= 2 && (k >= 5 || arrivalMinutes(k + 1) > elapsedMin)) {
          archId = 'human';
        }
        if (archId === 'human' || archId === 'quoteDunk' || archId === 'localExpert') humanPlaced = true;

        def = ARCH[archId] || ARCH.engagementFarm;

        /* Gate the follower-dependent archetypes defensively; selection
           should already have excluded them, but packs can extend the
           pool and we do not want a fan appearing for a nobody. */
        if (def.kind === 'fan' && followers <= 5000) { archId = 'human'; def = ARCH.human; }
        if (def.kind === 'hater' && followers <= 10000) { archId = 'replyGuy'; def = ARCH.replyGuy; }

        var who = authorFor(def.kind, id + ':' + k + ':' + archId, used);
        used[who.handle] = 1;

        /* Jitter stays under the 42s minimum gap so it cannot reorder
           two adjacent replies. */
        arrAt = at + Math.round(arrMin * 60000) + ((seed % 23) * 1000);
        if (arrAt > nowMs) arrAt = nowMs;

        var rLikes = rnd((seed ^ 0x5bf03635) >>> 0);
        var likeBase = def.kind === 'human' || def.kind === 'hater'
          ? intBetween(rLikes, 0, 40)
          : intBetween(rLikes, 0, 9);
        if (archId === 'quoteDunk') likeBase += intBetween(rLikes, 20, 400);
        if (archId === 'hater') likeBase += intBetween(rLikes, 5, 120);
        if (def.kind === 'spam') likeBase = intBetween(rLikes, 0, 2);
        /* older replies have had longer to accumulate */
        var ageHours = Math.max(0, (nowMs - arrAt) / 3600000);
        likeBase = Math.round(likeBase * (1 + Math.min(ageHours / 24, 3)));

        out.push({
          author: who.author,
          handle: who.handle,
          avatarSeed: who.avatarSeed,
          kind: def.kind,
          archetype: archId,
          body: reply(a, archId, seed),
          at: arrAt,
          likes: likeBase
        });
      }

      /* Defensive: the schedule above is monotonic by construction, but
         a pack that redefines the curve should not be able to produce a
         thread that reads backwards. Index tiebreak keeps it stable. */
      for (k = 0; k < out.length; k++) out[k]._i = k;
      out.sort(function (x, y) {
        if (x.at !== y.at) return x.at - y.at;
        return x._i - y._i;
      });
      for (k = 0; k < out.length; k++) { delete out[k]._i; }

      return out;
    } catch (e) {
      return [];
    }
  }

  /* ===================================================================
     13. EXTENSION POINTS
     -------------------------------------------------------------------
     The point of this is that the network can be modified from inside
     the app -- a pack, or the user's own editor screen -- without a
     rebuild and without touching this file.

       SYNTH.bots.extend({
         topics:     { fishing: { label: 'fishing', words: [...] } },
         archetypes: { poetBot: { kind: 'bot', templates: [...] } },
         names:      { bot: [{handle, name, avatarSeed}], ... }
       })

     saveExtension() does the same and writes it to SYNTH.store so it
     survives a restart. Loaded once at startup, below.
     =================================================================== */

  function extend(patch) {
    if (!patch || typeof patch !== 'object') return false;
    var k, i;
    try {
      if (patch.topics && typeof patch.topics === 'object') {
        for (k in patch.topics) {
          if (!patch.topics.hasOwnProperty(k)) continue;
          var t = patch.topics[k];
          if (!t || !t.words || !t.words.length) continue;
          TOPICS[k] = { label: String(t.label || k), words: t.words.slice(0, 200) };
        }
        TOPIC_IDS.length = 0;
        for (k in TOPICS) { if (TOPICS.hasOwnProperty(k)) TOPIC_IDS.push(k); }
      }
      if (patch.archetypes && typeof patch.archetypes === 'object') {
        for (k in patch.archetypes) {
          if (!patch.archetypes.hasOwnProperty(k)) continue;
          var d = patch.archetypes[k];
          if (!d || !d.templates || !d.templates.length) continue;
          var kind = String(d.kind || 'bot');
          if (!KIND_TO_ACCOUNT[kind]) kind = 'bot';
          ARCH[k] = { kind: kind, templates: d.templates.slice(0, 200) };
        }
        ARCH_IDS.length = 0;
        for (k in ARCH) { if (ARCH.hasOwnProperty(k)) ARCH_IDS.push(k); }
      }
      if (patch.names && typeof patch.names === 'object') {
        for (k in patch.names) {
          if (!patch.names.hasOwnProperty(k)) continue;
          var target = FALLBACK_BY_KIND[k];
          if (!target) continue;
          var list = patch.names[k] || [];
          for (i = 0; i < list.length && i < 200; i++) {
            if (list[i] && list[i].handle) target.push(list[i]);
          }
        }
      }
      _poolCache = null;
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveExtension(patch) {
    if (!extend(patch)) return null;
    try {
      var store = SYNTH.store;
      if (!store || typeof store.put !== 'function') return null;
      var existing = null;
      try { existing = store.get('bots', 'extension', null); } catch (e2) { existing = null; }
      var merged = existing && typeof existing === 'object' ? existing : { topics: {}, archetypes: {}, names: {} };
      var k;
      if (patch.topics) { for (k in patch.topics) { if (patch.topics.hasOwnProperty(k)) merged.topics[k] = patch.topics[k]; } }
      if (patch.archetypes) { for (k in patch.archetypes) { if (patch.archetypes.hasOwnProperty(k)) merged.archetypes[k] = patch.archetypes[k]; } }
      if (patch.names) { for (k in patch.names) { if (patch.names.hasOwnProperty(k)) merged.names[k] = patch.names[k]; } }
      return store.put('bots', 'extension', merged);
    } catch (e) {
      return null;
    }
  }

  function loadExtension() {
    try {
      var store = SYNTH.store;
      if (!store || typeof store.get !== 'function') return;
      var saved = store.get('bots', 'extension', null);
      if (saved) extend(saved);
    } catch (e) { /* nothing saved, or store not ready yet */ }
  }

  /* ===================================================================
     14. EXPORTS
     =================================================================== */

  SYNTH.bots = {
    analyse: analyse,
    reply: reply,
    repliesFor: repliesFor,

    /* introspection, for the in-app editor */
    archetypes: function () { return ARCH_IDS.slice(0); },
    topics: function () { return TOPIC_IDS.slice(0); },
    archetypeInfo: function (id) {
      var d = ARCH[id];
      if (!d) return null;
      return { id: id, kind: d.kind, templateCount: d.templates.length };
    },
    topicInfo: function (id) {
      var t = TOPICS[id];
      if (!t) return null;
      return { id: id, label: t.label, wordCount: t.words.length };
    },
    towns: function () { return TOWNS.slice(0); },
    canon: function () { return CANON.slice(0); },
    canonTrue: function () { return CANON_TRUE; },

    /* modification from inside the app */
    extend: extend,
    saveExtension: saveExtension,
    loadExtension: loadExtension,

    /* exposed so other site renderers can reuse the deterministic bits
       without importing live.js directly */
    _hash32: hash32,
    _rnd: rnd
  };

  loadExtension();

}());
