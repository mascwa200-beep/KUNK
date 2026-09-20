/* grammar.js -- where the volume comes from.
 *
 * 550 hand-written entries across every pool on the network is the whole
 * variety budget. Sit on one site for ten minutes and it wraps, and a feed
 * that wraps is the tell that finishes the illusion off.
 *
 * The literal fix is 55,000 written entries, which at the current density is
 * 32 MB and which nobody is ever going to write. So: COMPOSE, do not
 * enumerate.
 *
 *     post = template x entity x tone x detail
 *
 * Roughly 200 templates, 60 canon entities out of docs/WORLD.md, eight tones
 * and a dozen detail fragments is on the order of a million distinct posts
 * out of about the same source bytes as one existing slop file. bots.js
 * already proves the technique works here -- it builds replies to your own
 * posts the same way -- so this is that idea pointed at the world instead of
 * at you.
 *
 * WHAT THIS IS NOT. It has no model and no understanding. It is a grammar,
 * and at volume a reader will occasionally catch one being assembled. The
 * hand-written pools are still there and still carry roughly three posts in
 * ten (see GRAMMAR_SHARE in live.js): those are the texture, this is the
 * volume, and the mix is the point. A net composed entirely by this would
 * read exactly as flat as a net of eighty repeating posts, just differently.
 *
 * Everything is a pure function of the seed it is handed, which is the slot
 * hash. Same slot, same post, forever.
 */
window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var SYNTH = window.SYNTH;

  function L() { return SYNTH.live; }

  function hash32(s) {
    if (SYNTH.live && typeof SYNTH.live.hash32 === 'function') {
      return SYNTH.live.hash32(String(s));
    }
    var str = String(s), h = 2166136261, i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* One draw from an array, from a seed and a salt. Note the `%` with no
   * shift anywhere: hash32 returns a uint32 and `>>` is signed, which is how
   * a renderer on this project once ended up indexing arrays with negative
   * numbers. */
  function pick(arr, seed, salt) {
    if (!arr || !arr.length) return '';
    return arr[hash32(String(seed) + '|' + salt) % arr.length];
  }

  function chance(seed, salt, pct) {
    return (hash32(String(seed) + '|' + salt) % 100) < pct;
  }

  function num(seed, salt, lo, hi) {
    return lo + (hash32(String(seed) + '|' + salt) % Math.max(1, (hi - lo + 1)));
  }

  /* ==================================================================== */
  /* THE CANON                                                            */
  /*                                                                      */
  /* Straight out of docs/WORLD.md. Every one of these is a thing that     */
  /* exists in Verity County, which is what keeps a composed post from     */
  /* being about nothing. A grammar with generic nouns reads as noise;     */
  /* a grammar whose nouns are all load-bearing reads as a place.          */
  /* ==================================================================== */

  var PLACES = [
    'Gridfall', 'Marchfield', 'Ashkettle', 'New Carrow', 'Halsey',
    'Coyne Flats', 'Milbrook'
  ];

  /* Things, with the preposition that goes in front of each, because
   * "parking at the Branch Trail" and "parking on Route 62" are not
   * interchangeable and getting it wrong is the fastest way to sound
   * generated. */
  var THINGS = [
    { n: 'Substation No. 3', p: 'at', kind: 'infra' },
    { n: 'the Pell tie line', p: 'on', kind: 'infra' },
    { n: 'County Route 62', p: 'on', kind: 'road' },
    { n: 'the old quarry cut', p: 'at', kind: 'road' },
    { n: 'Quarry Road', p: 'on', kind: 'road' },
    { n: 'Depot Street', p: 'on', kind: 'road' },
    { n: 'Kestrel Road', p: 'on', kind: 'road' },
    { n: 'Bracken Lane', p: 'on', kind: 'road' },
    { n: 'Third Street', p: 'on', kind: 'road' },
    { n: 'the Verity Branch Trail', p: 'on', kind: 'trail' },
    { n: 'the Coyne Creek trestle', p: 'at', kind: 'trail' },
    { n: 'the Marchfield trailhead', p: 'at', kind: 'trail' },
    { n: 'the old freight house site', p: 'at', kind: 'trail' },
    { n: 'Carrow Wireless Repair', p: 'at', kind: 'shop' },
    { n: 'the neon kestrel', p: 'at', kind: 'shop' },
    { n: 'Hollis Market', p: 'at', kind: 'shop' },
    { n: 'County General', p: 'at', kind: 'civic' },
    { n: 'Marchfield Public Library', p: 'at', kind: 'civic' },
    { n: 'the county board', p: 'at', kind: 'civic' },
    { n: 'the Armory', p: 'at', kind: 'civic' },
    { n: 'the Bracken Lane school', p: 'at', kind: 'civic' },
    { n: 'the transfer station', p: 'at', kind: 'civic' },
    { n: 'the Signal on 62', p: 'about', kind: 'signal' },
    { n: 'Verity Valley Power & Light', p: 'at', kind: 'corp' },
    { n: 'Pinelock Media', p: 'at', kind: 'corp' },
    { n: 'the Ledger', p: 'at', kind: 'corp' },
    { n: 'the Gridfall boards', p: 'on', kind: 'web' },
    { n: 'the county website', p: 'on', kind: 'web' }
  ];

  var PEOPLE = [
    'Karen Fennimore', 'Dale Carver', 'Walt Pennock', 'Hal Brenner',
    'Marion Teale', 'Ainsley Rowe', 'Marcus Feld', 'D. Kessler'
  ];

  var EVENTS = [
    'the 2003 substation fire', 'the branch line closing',
    'the Kestrel shutting', 'the 2017 spam wave', 'the ice storm',
    'the budget vote', 'the Bracken Lane consolidation',
    'the trestle being fenced off', 'the newsroom cuts'
  ];

  /* ==================================================================== */
  /* TONE                                                                 */
  /*                                                                      */
  /* A forum at 3am is not a forum at 9pm. live.js already varies how MUCH */
  /* gets posted by hour; this varies WHAT, which is the half that makes   */
  /* the rhythm legible rather than merely present.                       */
  /* ==================================================================== */

  var TONES = ['flat', 'annoyed', 'earnest', 'tired', 'joking', 'pedantic',
               'worried', 'nostalgic'];

  /* Which tones a given hour draws from. 3am is lonely and earnest and
   * typo-prone; Saturday evening is jokey; Tuesday afternoon is work
   * avoidance and pedantry. */
  function tonesForHour(hour) {
    if (hour < 5) return ['earnest', 'tired', 'worried', 'nostalgic'];
    if (hour < 9) return ['flat', 'tired', 'annoyed'];
    if (hour < 12) return ['flat', 'annoyed', 'pedantic'];
    if (hour < 17) return ['flat', 'pedantic', 'joking', 'annoyed'];
    if (hour < 21) return ['annoyed', 'joking', 'earnest', 'flat'];
    return ['joking', 'nostalgic', 'tired', 'earnest'];
  }

  function toneFor(seed) {
    var at = (L() && L().now) ? L().now() : Date.now();
    var hour = new Date(at).getHours();
    var options = tonesForHour(hour);
    return options[hash32(String(seed) + '|tone') % options.length];
  }

  /* A tone-appropriate closing clause. Empty often, because a post where
   * every sentence lands is not a real post. */
  var TAILS = {
    flat: ['', '', '', 'Anyway.', 'Just noting it.'],
    annoyed: ['', 'Again.', 'Second time this month.', 'Nobody will do anything.',
              'And before anyone asks, yes I called.'],
    earnest: ['', 'Hope that helps someone.', 'Happy to be corrected.',
              'I might be wrong about this.'],
    tired: ['', 'I do not have the energy for this one.', 'Whatever.',
            'Going to bed.'],
    joking: ['', 'Not that I am bitter.', 'Living the dream out here.',
             'Ten out of ten, no notes.'],
    pedantic: ['', 'It is in the minutes if anyone wants to check.',
               'The date is wrong in three places, incidentally.',
               'Source, for once, below.'],
    worried: ['', 'Is anyone else seeing this?', 'I might be overreacting.',
              'Keeping an eye on it.'],
    nostalgic: ['', 'Not like it was.', 'Long time ago now.',
                'I still have the photos somewhere.']
  };

  /* Typos, but only in the tones and hours where a person would make them.
   * Applied to one word, once, and never to a canon noun -- a misspelled
   * place name reads as an error in the project rather than as a person
   * typing at 3am. */
  function maybeTypo(text, seed, tone) {
    if (tone !== 'tired' && tone !== 'earnest') return text;
    if (!chance(seed, 'typo', 18)) return text;
    var swaps = [
      [' the ', ' teh '], [' and ', ' adn '], [' just ', ' jsut '],
      [' with ', ' wiht '], [' that ', ' taht '], [' know ', ' konw ']
    ];
    var swap = swaps[hash32(String(seed) + '|swap') % swaps.length];
    if (text.indexOf(swap[0]) === -1) return text;
    return text.replace(swap[0], swap[1]);
  }

  /* ==================================================================== */
  /* SLOT FILLING                                                         */
  /* ==================================================================== */

  /* Not every noun fits every verb. You can walk on the Branch Trail and
   * you cannot walk at Pinelock Media, and a grammar that treats its nouns
   * as interchangeable produces exactly that sentence. */
  function ofKinds(seed, salt, kinds) {
    var pool = [], i;
    for (i = 0; i < THINGS.length; i++) {
      if (kinds.indexOf(THINGS[i].kind) !== -1) pool.push(THINGS[i]);
    }
    if (!pool.length) pool = THINGS;
    return pool[hash32(String(seed) + '|' + salt) % pool.length];
  }

  function slots(seed) {
    var thing = THINGS[hash32(String(seed) + '|thing') % THINGS.length];
    var thing2 = THINGS[hash32(String(seed) + '|thing2') % THINGS.length];
    var walk = ofKinds(seed, 'walk', ['trail', 'road']);
    var build = ofKinds(seed, 'build', ['shop', 'civic']);
    var org = ofKinds(seed, 'org', ['corp', 'civic']);
    return {
      walkable: walk.n,
      onWalk: walk.p + ' ' + walk.n,
      building: build.n,
      atBuilding: build.p + ' ' + build.n,
      org: org.n,
      place: pick(PLACES, seed, 'place'),
      place2: pick(PLACES, seed, 'place2'),
      thing: thing.n,
      at: thing.p + ' ' + thing.n,
      thingKind: thing.kind,
      thing2: thing2.n,
      at2: thing2.p + ' ' + thing2.n,
      person: pick(PEOPLE, seed, 'person'),
      event: pick(EVENTS, seed, 'event'),
      n: String(num(seed, 'n', 2, 40)),
      n2: String(num(seed, 'n2', 3, 19)),
      year: String(num(seed, 'year', 1998, 2008)),
      money: String(num(seed, 'money', 40, 8000)),
      days: String(num(seed, 'days', 2, 21)),
      /* A date, not a count. {n} was standing in for this and producing
       * "since the 38th". */
      day: ordinal(num(seed, 'day', 1, 28)),
      hours: String(num(seed, 'hours', 2, 11)),
      bigN: String(num(seed, 'bigN', 400, 9000)),
      /* Deliberately tiny. "4,100 posts, 3 of them human" is the whole
       * argument of the setting in one line; "40 posts, 39 of them human"
       * is not. */
      few: String(num(seed, 'few', 0, 5))
    };
  }

  function ordinal(n) {
    var rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return n + 'th';
    var rem10 = n % 10;
    if (rem10 === 1) return n + 'st';
    if (rem10 === 2) return n + 'nd';
    if (rem10 === 3) return n + 'rd';
    return n + 'th';
  }

  function fill(template, seed) {
    var v = slots(seed);
    return String(template).replace(/\{([a-zA-Z0-9]+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(v, key) ? v[key] : whole;
    });
  }

  /* ==================================================================== */
  /* TEMPLATES                                                            */
  /*                                                                      */
  /* Grouped by the register of the poster, not by the site they land on,  */
  /* because a complaint is a complaint whether it is a forum thread or a  */
  /* social post -- only the wrapper differs.                              */
  /* ==================================================================== */

  var OBSERVATION = [
    'Drove past {walkable} this morning. Still the same as last week.',
    'Anyone else notice the lights {onWalk} are out again?',
    '{thing} has had a cone next to it since the {day}.',
    'They have repainted the lines {onWalk}. Badly.',
    'Crew {onWalk} since about seven. No idea what for.',
    'The gate {onWalk} is open again. It has been open {days} days.',
    'Sign {onWalk} says April. It said April in January.',
    'Whatever they did {onWalk} last month has already come undone.',
    'There is water standing {onWalk} again after every rain.',
    'Counted {n} cars backed up {onWalk} at five past four.',
    'Someone has put a bench {onWalk}. No plaque, no announcement, just a bench.',
    'The hours {atBuilding} changed again and there is no notice anywhere.',
    'Two trucks {onWalk} all morning, nobody out of either of them.',
    'The bins {atBuilding} have not been emptied since before the weekend.',
    'Power flickered here twice in {hours} hours. {place} neighbours say the same.',
    'They have fenced off another {n} feet {onWalk}.',
    'Barrier {onWalk} has been down for {days} days and nobody has moved it.',
    'New camera {at}. Nobody asked for a new camera {at}.'
  ];

  var COMPLAINT = [
    'Called the county about {thing} for the third time. Ticket number, no callback.',
    'Rang {org} twice, held {n2} minutes, gave up.',
    'Reported the state of {thing} in {year} and it is worse now.',
    'The form for this is on paper only and the office is open {n2} hours a week.',
    'Got a letter about {thing} addressed to someone who moved out in {year}.',
    'Bill from Verity Valley is up ${money} and nobody can tell me why.',
    'They closed the counter {atBuilding} and the phone line just rings.',
    'The website says to call. The recording says to use the website.',
    'Meeting about {thing} was moved with {n2} hours notice.',
    'Quote of ${money} to fix something that was fine until they touched it.',
    'Waited {hours} hours {atBuilding} for a form they then said was the wrong form.',
    'Parking fine {at} for a bay that was not marked when I parked in it.'
  ];

  var CORRECTION = [
    'It was {year}, not the year everyone keeps repeating. It is in the minutes.',
    'That is the wrong {thing}. The one you mean is {at2}.',
    'For the record: {person} was not involved in {event}. Different department.',
    'The figure is off by a factor of ten. Check the filing, page {n}.',
    'This is the third article this month to get the date of {event} wrong.',
    'Whoever wrote that has confused {place} with {place2}. Again.',
    'Reverted. The source for that claim is an article that cites this page.',
    'Two of the three sources for that go back to the same {year} post.',
    'The report you are quoting does not say that. It says the opposite, on page {n}.'
  ];

  var NOSTALGIA = [
    'I still think about what {thing} was like before {event}.',
    'Found a photo of {thing} from {year} in a box. Nothing matches.',
    'My dad worked {atBuilding} until {year}.',
    'We used to walk {onWalk} every Sunday. You cannot now.',
    'There was a proper shop {atBuilding} once. {n2} years ago maybe.',
    'Remember when you could get someone on the phone at {org}?',
    'The old sign {atBuilding} is still there under the new one if you look.'
  ];

  var BOT_ENGAGEMENT = [
    'This is exactly the kind of local insight our community needs. What is YOUR memory of {thing}?',
    'Incredible perspective on {place}. Follow for more Verity County content.',
    '{thing}: a story that deserves to be told. Comment YES if you agree.',
    'Saving this. The {place} community continues to inspire.',
    'What happened {at} is a reminder that every place has a story. Share yours.',
    'BREAKING: residents react to developments {at}. Full coverage below.',
    'They do not want you to know what happened {at} in {year}.',
    'The truth about {event} that local media will not print.',
    '{n} things about {place} that will surprise you. Number {n2} is wild.',
    'Nobody is talking about what is happening {at}. We are.',
    'Residents of {place} deserve answers about {thing}. Retweet if you agree.',
    'I grew up near {walkable}. What I found there in {year} changed everything.',
    'Local history matters. {thing}, {year}. A thread.',
    'This {place} story has been shared {n2},000 times today. Here is why.',
    'Tag someone from {place} who remembers {thing}.',
    'You will not believe what {thing} looks like now. Before and after below.',
    'The {place} community is stronger than most. Proof {at}.',
    'Why is nobody covering {thing}? Follow for updates the media will not run.',
    'Unpopular opinion: {thing} was better before they got involved.',
    '{thing}. That is the post. That is all it needed to be.',
    'Three things {place} residents should know about {thing} this week.',
    'Our AI reviewed {n} records about {thing}. What it found is below.',
    'Everyone talks about {place}. Nobody talks about {thing}.',
    'If you know, you know. {thing}, {year}. IYKYK.'
  ];

  var BOT_SUMMARY = [
    'Analysis: sentiment around {thing} has shifted {n}% this week.',
    'Our county desk is monitoring developments {at}.',
    'This post about {thing} is the {n2}th most discussed item in {place} today.',
    'Context: {thing} has appeared in {n} posts across Verity County this week.',
    'UPDATE: an earlier version of this said {year}. It has been amended to say {year}.',
    'Automated summary: residents express concern regarding {thing}. No official comment.',
    'Verity County in numbers: {bigN} posts about {thing}, {few} of them human.',
    'Trending in {place}: {thing}. Volume up {n}% in {hours} hours.',
    'Flagged as locally relevant: {thing}. Confidence {n}%.',
    'We have reached out to {org} for comment. No response at time of posting.',
    'Cross-referencing {thing} against the {year} archive: {n} matches.',
    'This article was generated from a meeting agenda and has not been reviewed.',
    'Summary: officials describe activity {at} as routine. Residents disagree.',
    'Digest: {bigN} items about {place} this week. {n} were from this account.',
    'Our records show {thing} was last updated in {year}.',
    'Note: an earlier version of this post said {year}. It has been corrected to {year}.',
    'Top story in {place}: {thing}. Source: Ledger Newsdesk (automated).',
    'Sentiment: neutral. Entities: {thing}, {place}. Confidence: low.'
  ];

  var SPAM = [
    'Made ${money} last month from home while everyone argued about {thing}. Ask me how.',
    'Emergency service {at} available 24/7. Licensed, insured, {place} owned.',
    'Still paying ${money} for that? Local residents are switching. Comment INFO.',
    'Cash for cars, {place} area. Any condition. Same day.',
    'Roof inspection free this week only for {place} homeowners. Storm damage specialists.',
    'Water damage {atBuilding}? We handle the claim. {place} families served since 1998.',
    'Septic pumping ${money}. {place} and surrounding. Book before winter.',
    'Turned ${money} a month into six figures trading. Comment TRADE for the free guide.',
    'Driveway sealing, {place} area. ${money} flat. Call today, done tomorrow.',
    'Tree down {onWalk}? {n2}-hour emergency removal. Fully insured.',
    'Your {place} home is worth ${money} more than you think. Free valuation.',
    'Bad credit? {place} residents are getting approved in {n2} minutes.',
    'Gutter cleaning special. {n2} houses left at this price in {place}.',
    'I lost {n} pounds without giving anything up. {place} mums are furious.',
    'Solar assessment free for {place} postcodes. Government scheme ends soon.'
  ];

  /* Headline case, for news and wire. */
  var NEWS_HEAD = [
    'County Board Defers Decision On {thing}',
    'Work Continues {at} With No Completion Date Given',
    'Residents Raise Concerns Over {thing} At {place} Meeting',
    '{place} Ranks {n}th In State For Broadband Access',
    'Officials Say {thing} Is Operating Normally',
    'Filing Shows ${money} Allocated To {thing}',
    'No Comment From Verity Valley On {thing}',
    '{place} Meeting Draws {n} Residents Over {thing}',
    'Repairs {at} Pushed To Next Quarter',
    'Trail Section Near {thing} Closed For {days} Days',
    'What We Know About {thing}',
    'Here Is Why {place} Residents Are Talking About {thing}'
  ];

  var NEWS_DEK = [
    'The item was listed on the agenda but not discussed.',
    'Officials described the work as routine.',
    'No timeline was given and no one was available for comment.',
    'The figure comes from a filing dated {year}.',
    'Residents have raised the issue at {n2} consecutive meetings.',
    'The county says a review is underway.',
    'This story was generated from a meeting agenda.'
  ];

  var TOPIC_TITLE = [
    '{thing} again',
    'Anyone know what is happening {at}?',
    'PSA: {thing}',
    '{thing} - {year} to now',
    'Is it just me or is {thing} worse',
    'Question about {thing}',
    'Update {at}',
    'Can we talk about {thing}',
    'Small thing but: {thing}',
    '{place} residents - {thing}?'
  ];

  /* ==================================================================== */
  /* NAMES                                                                */
  /*                                                                      */
  /* 64 hand-written accounts is nine recognisable people on a busy site.  */
  /* first x last x style is tens of thousands, which is what stops a      */
  /* forum reading as the same nine posters.                              */
  /* ==================================================================== */

  var FIRST = ['dave', 'karen', 'marla', 'dennis', 'walt', 'ruth', 'greg',
    'sandra', 'phil', 'nora', 'terry', 'jan', 'doug', 'lynne', 'ken', 'bev',
    'rick', 'donna', 'stu', 'pam', 'clive', 'maureen', 'neil', 'gail',
    'brian', 'sheila', 'roy', 'carol', 'martin', 'joyce'];

  var LAST = ['hollis', 'pennock', 'teale', 'carver', 'brennan', 'kessler',
    'doyle', 'mercer', 'arroyo', 'vetch', 'bramley', 'fennimore', 'dunlop',
    'quill', 'abernathy', 'rowe', 'feld', 'chalmers', 'tillman', 'norris'];

  var HANDLE_STYLE = [
    function (f, l, s) { return f + '_' + l; },
    function (f, l, s) { return f + l.charAt(0); },
    function (f, l, s) { return f.charAt(0) + l; },
    function (f, l, s) { return f + num(s, 'hn', 2, 89); },
    function (f, l, s) { return f + '_' + num(s, 'hn', 60, 99); },
    function (f, l, s) { return l + '_' + f.charAt(0); },
    function (f, l, s) { return f + '.' + l; },
    function (f, l, s) { return f + l + num(s, 'hn', 1, 9); }
  ];

  function personFor(seed) {
    var f = pick(FIRST, seed, 'first');
    var l = pick(LAST, seed, 'last');
    var style = HANDLE_STYLE[hash32(String(seed) + '|style') % HANDLE_STYLE.length];
    var display = f.charAt(0).toUpperCase() + f.slice(1) + ' ' +
                  l.charAt(0).toUpperCase() + l.slice(1);
    return {
      handle: style(f, l, seed),
      name: chance(seed, 'realname', 55) ? display : (f + ' ' + l.charAt(0) + '.'),
      seed: f + '-' + l
    };
  }

  var BOT_NAMES = ['Verity Daily', 'Gridfall Now', 'County Signal',
    'VerityPulse AI', 'Local Reach', 'Verity Analytics', 'Marchfield Wire',
    'The Verity Feed', 'Pinelock Local', 'Kestrel Media Group'];

  function botFor(seed) {
    var name = pick(BOT_NAMES, seed, 'botname');
    var suffix = pick(['_ai', '_daily', '_hq', '_live', '_now', ''], seed, 'botsuf');
    return {
      handle: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + suffix,
      name: name,
      seed: name.toLowerCase().slice(0, 8)
    };
  }

  /* ==================================================================== */
  /* COMPOSITION                                                          */
  /* ==================================================================== */

  /* The mix of who is posting. This is the joke of the whole project stated
   * as four numbers: most of what arrives on VerityNet in 2026 is not from
   * a person. Humans are a minority and are the only interesting thing on
   * the page, which is roughly the argument. */
  function kindFor(seed) {
    var roll = hash32(String(seed) + '|kind') % 100;
    if (roll < 46) return 'bot';
    if (roll < 62) return 'spam';
    if (roll < 72) return 'promoted';
    return 'human';
  }

  /* Two composed posts that open with the same four words are the single
   * most visible tell, and with eighteen templates and eight posts on screen
   * that lands about as often as the birthday problem says it will. An
   * opener breaks the run without needing another hundred templates. */
  var OPENERS = {
    flat: ['', '', '', 'Heads up: ', 'FYI, ', 'So, ', 'Right, '],
    annoyed: ['', 'Again: ', 'Once more: ', 'For the love of god, ', 'Sorry but '],
    earnest: ['', 'Quick one. ', 'Not sure if this matters but ', 'Genuine question: '],
    tired: ['', 'ok so ', 'honestly, ', 'not again. '],
    joking: ['', 'Breaking news: ', 'In tonight\'s episode of Verity County, ',
             'Good news everyone. '],
    pedantic: ['', 'Correction: ', 'For accuracy: ', 'Minor point, but '],
    worried: ['', 'Has anyone else... ', 'Maybe nothing, but ', 'Slightly concerned: '],
    nostalgic: ['', 'Funny thing. ', 'Thinking about this today. ', 'Years ago now, but ']
  };

  function openerFor(seed, tone) {
    var bank = OPENERS[tone] || OPENERS.flat;
    var o = bank[hash32(String(seed) + '|open') % bank.length];
    return o;
  }

  /* Set by the body builders, read by live.js. Not part of any item's
   * content; it exists only so a feed can refuse to show you the same
   * sentence twice with different nouns in it. */
  var lastTemplate = 0;

  function noteTemplate(tpl) {
    lastTemplate = hash32(String(tpl));
    return tpl;
  }

  function humanBody(seed, tone) {
    var bank;
    if (tone === 'annoyed' || tone === 'tired') {
      bank = chance(seed, 'bank', 55) ? COMPLAINT : OBSERVATION;
    } else if (tone === 'pedantic') {
      bank = CORRECTION;
    } else if (tone === 'nostalgic') {
      bank = NOSTALGIA;
    } else {
      bank = chance(seed, 'bank', 70) ? OBSERVATION : COMPLAINT;
    }
    var body = fill(noteTemplate(pick(bank, seed, 'tpl')), seed);
    var opener = openerFor(seed, tone);
    if (opener) {
      /* Lower-case the first letter when the opener already ended a
       * sentence, so "Quick one. Drove past..." does not become
       * "Quick one. drove past...". Only when the opener does not. */
      body = opener + (/[.!?] $/.test(opener)
        ? body
        : body.charAt(0).toLowerCase() + body.slice(1));
    }
    var tail = pick(TAILS[tone] || TAILS.flat, seed, 'tail');
    if (tail) body += ' ' + tail;
    /* Occasionally a second sentence, because uniform length is its own
     * tell. */
    if (chance(seed, 'second', 26)) {
      body += '\n\n' + fill(pick(OBSERVATION, seed, 'tpl2'), seed + 'x');
    }
    return maybeTypo(body, seed, tone);
  }

  function botBody(seed) {
    var bank = chance(seed, 'botbank', 55) ? BOT_ENGAGEMENT : BOT_SUMMARY;
    return fill(noteTemplate(pick(bank, seed, 'btpl')), seed);
  }

  /* --- the makers, one per pool ---------------------------------------- */

  function makeSocialPost(seed) {
    var kind = kindFor(seed);
    var tone = toneFor(seed);
    var who = (kind === 'human') ? personFor(seed) : botFor(seed);
    var body = (kind === 'human') ? humanBody(seed, tone)
             : (kind === 'spam') ? fill(noteTemplate(pick(SPAM, seed, 'spam')), seed)
             : botBody(seed);

    /* Engagement follows the kind, not the quality, which is the other half
     * of the argument. */
    var likes = (kind === 'human') ? num(seed, 'likes', 0, 14)
              : (kind === 'bot') ? num(seed, 'likes', 200, 90000)
              : num(seed, 'likes', 0, 6);

    return {
      author: who.name,
      handle: who.handle,
      avatarSeed: who.seed,
      kind: kind,
      verified: kind !== 'human' && chance(seed, 'verified', 60),
      likes: likes,
      reposts: Math.floor(likes / num(seed, 'rr', 3, 9)),
      body: body,
      replies: []
    };
  }

  function makeForumBump(seed) {
    var kind = kindFor(seed);
    var tone = toneFor(seed);
    var who = (kind === 'human') ? personFor(seed) : botFor(seed);
    return {
      author: who.handle,
      avatarSeed: who.seed,
      kind: kind,
      body: (kind === 'human') ? humanBody(seed, tone)
          : (kind === 'spam') ? fill(noteTemplate(pick(SPAM, seed, 'spam')), seed)
          : botBody(seed)
    };
  }

  function makeForumTopic(seed) {
    var kind = kindFor(seed);
    var tone = toneFor(seed);
    var who = (kind === 'human') ? personFor(seed) : botFor(seed);
    return {
      title: fill(pick(TOPIC_TITLE, seed, 'tt'), seed),
      author: who.handle,
      authorTitle: pick(['New Member', 'Member', 'Senior Member', 'Regular',
                         'Lifer', 'Junior Member'], seed, 'rank'),
      avatarSeed: who.seed,
      kind: kind,
      board: pick(['Gridfall General', 'County Business', 'Off Topic',
                   'The Trail', 'Buy / Sell'], seed, 'board'),
      replies: num(seed, 'replies', 0, 44),
      views: num(seed, 'views', 12, 9000),
      body: (kind === 'human') ? humanBody(seed, tone)
          : (kind === 'spam') ? fill(noteTemplate(pick(SPAM, seed, 'spam')), seed)
          : botBody(seed),
      posts: []
    };
  }

  var LEDGER_BYLINES = ['Verity Ledger Staff', 'Ledger Newsdesk (automated)',
    'Ainsley Rowe', 'Marcus Feld', 'D. Kessler', 'Metro Desk', 'Staff Report'];

  function makeNewsItem(seed) {
    return {
      headline: fill(pick(NEWS_HEAD, seed, 'nh'), seed),
      byline: pick(LEDGER_BYLINES, seed, 'by'),
      kind: chance(seed, 'nkind', 76) ? 'bot' : 'human',
      section: pick(['Local', 'County', 'Schools', 'Business', 'Opinion'],
                    seed, 'sect'),
      dek: fill(pick(NEWS_DEK, seed, 'nd'), seed),
      body: fill(pick(NEWS_HEAD, seed, 'nb'), seed) + '.\n\n' +
            fill(pick(NEWS_DEK, seed, 'nd2'), seed) + '\n\n' +
            fill(pick(OBSERVATION, seed, 'nb2'), seed) + '\n\n' +
            'The county did not respond to a request for comment.'
    };
  }

  function makeBlogPost(seed) {
    var tone = toneFor(seed);
    return {
      title: fill(pick(TOPIC_TITLE, seed, 'bt'), seed),
      blog: pick(['Kestrel Notes', 'The Quarry', 'Verity Reads',
                  'Branch Line Diary', 'Ashkettle Almanac'], seed, 'blog'),
      kind: chance(seed, 'bkind', 62) ? 'bot' : 'human',
      tags: [pick(['county', 'trail', 'power', 'history', 'roads', 'schools'],
                  seed, 'tag')],
      body: humanBody(seed, tone)
    };
  }

  function makeMediaComment(seed) {
    var kind = kindFor(seed);
    var who = (kind === 'human') ? personFor(seed) : botFor(seed);
    return {
      author: who.handle,
      avatarSeed: who.seed,
      kind: kind,
      body: (kind === 'human')
        ? humanBody(seed, toneFor(seed))
        : fill(pick(BOT_ENGAGEMENT, seed, 'mc'), seed),
      likes: num(seed, 'mlikes', 0, 240)
    };
  }

  function makeMediaUpload(seed) {
    return {
      title: fill(pick(NEWS_HEAD, seed, 'mu'), seed),
      channel: pick(['ARCHIVE DEPTH', 'County Files', 'Verity Explained',
                     'Rust Belt Relics', 'Signal Hunters'], seed, 'chan'),
      channelKind: chance(seed, 'ck', 80) ? 'bot' : 'human',
      duration: num(seed, 'dm', 4, 38) + ':' +
                (num(seed, 'ds', 10, 59)),
      description: fill(pick(NEWS_DEK, seed, 'mud'), seed)
    };
  }

  function makeTicker(seed) {
    return fill(pick(NEWS_HEAD, seed, 'tk'), seed).toUpperCase();
  }

  var MAKERS = {
    socialPosts: makeSocialPost,
    forumTopics: makeForumTopic,
    forumBumps: makeForumBump,
    newsItems: makeNewsItem,
    blogPosts: makeBlogPost,
    mediaComments: makeMediaComment,
    mediaUploads: makeMediaUpload,
    tickers: makeTicker
  };

  function makes(poolName) {
    return Object.prototype.hasOwnProperty.call(MAKERS, poolName);
  }

  function make(poolName, seed) {
    var maker = MAKERS[poolName];
    if (!maker) return null;
    lastTemplate = 0;
    var item = maker('g:' + poolName + ':' + seed);
    if (item && typeof item === 'object' && lastTemplate) {
      item.tplId = lastTemplate;
    }
    return item;
  }

  /* How many distinct items each maker can produce, for the record and for
   * the test that asserts the grammar has not collapsed to a handful. */
  function space(poolName) {
    if (poolName === 'socialPosts' || poolName === 'forumBumps') {
      return (OBSERVATION.length + COMPLAINT.length + CORRECTION.length +
              NOSTALGIA.length) * THINGS.length * TONES.length *
             FIRST.length * LAST.length;
    }
    if (poolName === 'newsItems') {
      return NEWS_HEAD.length * NEWS_DEK.length * THINGS.length *
             PLACES.length * LEDGER_BYLINES.length;
    }
    if (poolName === 'forumTopics') {
      return TOPIC_TITLE.length * THINGS.length * PLACES.length *
             FIRST.length * LAST.length;
    }
    return THINGS.length * PLACES.length * 20;
  }

  SYNTH.grammar = {
    make: make,
    makes: makes,
    space: space,
    person: personFor,
    tone: toneFor,
    fill: fill,
    pools: function () { return Object.keys(MAKERS); }
  };
})();
