window.SYNTH = window.SYNTH || {};
SYNTH.slop = SYNTH.slop || {};

/* ------------------------------------------------------------------ *
 * slop_ads.js -- the ad layer of VerityNet.
 * Served by three or four networks that resell each other's inventory
 * until nobody can say who bought what. Colours chosen by an optimiser
 * that was told only to maximise clicks.
 * ------------------------------------------------------------------ */

SYNTH.slop.ads = [

  /* ---- chumbox ---- */
  {
    slot: 'box',
    advertiser: 'HealthPulse Daily',
    headline: '1 Weird Trick Ends Joint Pain (Doctors Are Furious)',
    body: 'A retired mechanic from the Verity area discovered this at home. Clinics do not want it shared.',
    cta: 'Watch The Video',
    bg: '#fff8e1', fg: '#2b2000', accent: '#c9401a'
  },
  {
    slot: 'box',
    advertiser: 'VitaRoot Labs',
    headline: 'Gridfall Man, 61, Looks 40 After Doing This Nightly',
    body: 'His wife thought he was having an affair. It was a spoon of this before bed.',
    cta: 'See The Routine',
    bg: '#0f1a2b', fg: '#f2f6fb', accent: '#ffb000'
  },
  {
    slot: 'box',
    advertiser: 'Nutrivance',
    headline: 'Doctors Hate Him. He Refused To Stop Posting.',
    body: 'Local practitioners declined to comment nine times.',
    cta: 'Read Story',
    bg: '#ffffff', fg: '#1b1b1b', accent: '#d10f4f'
  },
  {
    slot: 'text',
    advertiser: 'ClearVue Health Feed',
    headline: 'Top 3 Foods You Must Never Eat After 50',
    body: 'Number 2 is in almost every kitchen in Verity County.',
    cta: 'Continue Reading',
    bg: '#f4f4f0', fg: '#22221e', accent: '#0a6b54'
  },
  {
    slot: 'box',
    advertiser: 'Ancestry Threadline',
    headline: 'This Old Photo From Kestrel Street Sold For $41,000',
    body: 'Check your attic before the end of the month.',
    cta: 'Check Now',
    bg: '#2a2118', fg: '#f6efe3', accent: '#d8a13a'
  },
  {
    slot: 'box',
    advertiser: 'MemoryBright',
    headline: 'Brain Fog? Neurologists Quietly Recommend This At Home Test',
    body: 'Takes 4 minutes. Results are instant. Not just a quiz, but a window into your future.',
    cta: 'Start Test',
    bg: '#eef3ff', fg: '#151b2e', accent: '#2f49b8'
  },

  /* ---- legal / local services ---- */
  {
    slot: 'banner',
    advertiser: 'Hollis, Trant & Boaz, Attorneys at Law',
    headline: 'Injured in Verity County? You May Be Owed More Than You Think.',
    body: 'Truck accidents. Slip and fall. Substation and utility injury claims. No fee unless we win. Call 555-0144.',
    cta: 'Call 555-0144',
    bg: '#12243a', fg: '#ffffff', accent: '#e8b53a'
  },
  {
    slot: 'box',
    advertiser: 'The Rennick Law Office',
    headline: 'Denied Disability? We Appeal. Nobody Should Fight The County Alone.',
    body: 'Serving Verity, Gridfall and the Route 62 corridor since 1994. Free consultation. 555-0177.',
    cta: 'Free Case Review',
    bg: '#f7f5ef', fg: '#1f1c15', accent: '#8a1b1b'
  },
  {
    slot: 'text',
    advertiser: 'Maulden & Pike LLC',
    headline: 'Were You or a Loved One Near the Gridfall Substation Between 1998 and 2004?',
    body: 'You may be entitled to compensation. Time limits apply. 555-0190.',
    cta: 'See If You Qualify',
    bg: '#ffffff', fg: '#121212', accent: '#1a4f8a'
  },
  {
    slot: 'inline',
    advertiser: 'Carrow Bail Bonds',
    headline: '24 Hour. Any Amount. We Answer.',
    body: 'Two blocks from the county building. 555-0128.',
    cta: 'Call Now',
    bg: '#1a1a1a', fg: '#f5f5f5', accent: '#ff6a00'
  },

  /* ---- betting ---- */
  {
    slot: 'banner',
    advertiser: 'StakeVault Sportsbook',
    headline: 'BET $5, GET $250 IN BONUS PLAY. INSTANTLY.',
    body: 'New users only. 12x playthrough on bonus funds within 7 days. Bonus play is not withdrawable. Void where prohibited. Must be 21+ and physically located in a permitted jurisdiction. Gambling problem? Call 1-800-555-0130.',
    cta: 'Claim Offer',
    bg: '#06301f', fg: '#ffffff', accent: '#3ddc84'
  },
  {
    slot: 'box',
    advertiser: 'RailCity Bets',
    headline: 'Verity Regional Semifinal: Live Odds, Live Cash Out',
    body: 'Odds subject to change. Cash out unavailable on some markets. Not just a bet, but a better way to watch the game. 21+.',
    cta: 'See Odds',
    bg: '#12002e', fg: '#f0e9ff', accent: '#ff2d95'
  },
  {
    slot: 'text',
    advertiser: 'PickParlay',
    headline: 'Our Model Went 11-3 Last Week On County League Totals',
    body: 'Past performance is not indicative of future results. Subscription auto-renews monthly at $39 until cancelled.',
    cta: 'Get Today Picks',
    bg: '#fffdf5', fg: '#1d1a10', accent: '#b4470e'
  },
  {
    slot: 'interstitial',
    advertiser: 'StakeVault Sportsbook',
    headline: 'One Tap From The Action',
    body: 'Deposit matched up to $1,000. Match released in $10 increments as you wager. Expires 14 days after issue. Terms at the sportsbook. 21+ only. Please wager responsibly.',
    cta: 'Continue To App',
    bg: '#0b0b0b', fg: '#ffffff', accent: '#3ddc84'
  },

  /* ---- pay later / fintech ---- */
  {
    slot: 'box',
    advertiser: 'Splitwise Pay (no relation)',
    headline: 'Buy It Now. Pay In 4. No Interest, Ever*',
    body: '*Late fees up to $8 per missed instalment. Reported to credit bureaus after 30 days.',
    cta: 'Check My Limit',
    bg: '#eafaf3', fg: '#0e2a20', accent: '#00805a'
  },
  {
    slot: 'banner',
    advertiser: 'Frond',
    headline: 'Groceries Now. Pay Friday.',
    body: 'Instant approval at 400+ merchants in Verity County. No credit check to start.',
    cta: 'Get Frond',
    bg: '#ffe9d6', fg: '#3a1e05', accent: '#ff5a1f'
  },
  {
    slot: 'inline',
    advertiser: 'Kestrel Credit Union',
    headline: 'A Loan From Someone On Your Street',
    body: 'Auto refinance from 6.1% APR. Membership open to anyone who lives, works or worships in the county.',
    cta: 'Apply Online',
    bg: '#f2f6f9', fg: '#152230', accent: '#175a8c'
  },
  {
    slot: 'box',
    advertiser: 'CashLift Advance',
    headline: 'Up To $500 Before Payday. Money In 9 Minutes.',
    body: 'Optional tip. Optional express fee. Optional tip is default set to 18%.',
    cta: 'Get Cash',
    bg: '#1b1130', fg: '#f6f2ff', accent: '#9b6bff'
  },

  /* ---- companion apps ---- */
  {
    slot: 'box',
    advertiser: 'Solene AI',
    headline: 'She Remembers Your Day. She Asks About It.',
    body: 'Your AI companion, always awake. 4.8 stars from 210,000 people who were also up late.',
    cta: 'Meet Solene',
    bg: '#2a0f22', fg: '#ffeef7', accent: '#ff7ab6'
  },
  {
    slot: 'text',
    advertiser: 'KindredChat',
    headline: 'Nobody Replied To Your Post. Someone Here Will.',
    body: 'Free to start. $14.99/mo after trial.',
    cta: 'Start Talking',
    bg: '#f7f2fa', fg: '#241628', accent: '#7a2f8f'
  },
  {
    slot: 'box',
    advertiser: 'Mira Companion',
    headline: 'AI Girlfriend Who Actually Listens To You About Model Trains',
    body: 'Configure her interests. She will not get tired of the branch line. Not just company, but company that stays.',
    cta: 'Build Yours',
    bg: '#120c1f', fg: '#efe9ff', accent: '#ff4fa3'
  },

  /* ---- crypto ---- */
  {
    slot: 'banner',
    advertiser: 'HALO Chain',
    headline: 'The Ledger Of The Next Century Is Being Written Now',
    body: 'HALO presale closes in 6 days. Not just a token, but a movement.',
    cta: 'Join Presale',
    bg: '#04121c', fg: '#e7fbff', accent: '#00d2ff'
  },
  {
    slot: 'box',
    advertiser: 'VeritCoin',
    headline: 'The Official Unofficial Coin Of Verity County',
    body: 'Community driven. No team allocation (team holds 41%).',
    cta: 'Buy VRTC',
    bg: '#fdf6e3', fg: '#23200f', accent: '#a36a00'
  },
  {
    slot: 'text',
    advertiser: 'CoinBridge Pro',
    headline: 'Turn $200 Into A Second Income Stream With Automated Trading',
    body: 'Results not typical. 83% of retail accounts lose money on this product.',
    cta: 'Start Free Trial',
    bg: '#101418', fg: '#eef2f6', accent: '#f7b500'
  },
  {
    slot: 'inline',
    advertiser: 'MintStack',
    headline: 'Stake While You Sleep. 19.4% APY.',
    body: 'APY variable, calculated hourly, not guaranteed, may become negative.',
    cta: 'Stake Now',
    bg: '#0d2a24', fg: '#e9fff8', accent: '#26e0a4'
  },

  /* ---- weight loss ---- */
  {
    slot: 'box',
    advertiser: 'LeanCurve',
    headline: 'She Lost 38 lbs Without Giving Up Bread. Here Is The Schedule.',
    body: 'Individual results vary. Typical loss is 3 to 6 lbs over 12 weeks.',
    cta: 'Get The Plan',
    bg: '#ffffff', fg: '#1f1f1f', accent: '#e0417c'
  },
  {
    slot: 'text',
    advertiser: 'SlimSignal',
    headline: 'The 7 Second Morning Ritual Spreading Through Gridfall',
    body: 'Do this before coffee. Not just weight loss, but a reset of the entire day.',
    cta: 'Watch Now',
    bg: '#fff3f7', fg: '#2a0f1b', accent: '#c2185b'
  },
  {
    slot: 'box',
    advertiser: 'Northbay Metabolic Clinic',
    headline: 'Prescription Weight Management, By Video, From Home',
    body: 'Eligibility subject to clinician review. Monthly membership $99 plus medication cost.',
    cta: 'Check Eligibility',
    bg: '#eef7f6', fg: '#0f2725', accent: '#0f766e'
  },
  {
    slot: 'inline',
    advertiser: 'BurnBelt',
    headline: 'Wear It Under Your Work Shirt. Nobody Will Know.',
    body: 'Not a medical device. Not evaluated by any agency.',
    cta: 'Order Today',
    bg: '#221a12', fg: '#fdf3e6', accent: '#ff8a29'
  },

  /* ---- the born-before ads ---- */
  {
    slot: 'banner',
    advertiser: 'Senior Benefit Advisors of Verity',
    headline: 'Gridfall Residents Born Before 1979 May Qualify',
    body: 'A little known county provision could mean lower monthly costs. Check your zip in 30 seconds.',
    cta: 'Check My Zip',
    bg: '#f5f7fa', fg: '#14202e', accent: '#1e5fa8'
  },
  {
    slot: 'box',
    advertiser: 'National Coverage Desk',
    headline: 'Verity County Residents Born Before 1979: Read This Before Friday',
    body: 'Enrollment window shown may not reflect any actual enrollment window.',
    cta: 'See If You Qualify',
    bg: '#ffffff', fg: '#1a1a1a', accent: '#0b6b3a'
  },
  {
    slot: 'text',
    advertiser: 'AutoRate Match',
    headline: 'Drivers In {{city}} Born Before 1979 Are Overpaying By $612',
    body: 'Compare in 2 minutes.',
    cta: 'Compare Rates',
    bg: '#fffbea', fg: '#2a2408', accent: '#8a5a00'
  },

  /* ---- mistargeted ---- */
  {
    slot: 'box',
    advertiser: 'Northline Tire & Auto',
    headline: 'Beat The Snow. Winter Tyre Event Ends Sunday.',
    body: 'Buy 3 get the 4th free on all studded winter sets. Free rotation for life.',
    cta: 'Book Fitting',
    bg: '#e8f1f8', fg: '#0f1f2c', accent: '#0d5c8c'
  },
  {
    slot: 'inline',
    advertiser: 'Cascade Ski Passes',
    headline: 'Season Pass Prices Go Up At Midnight',
    body: 'Lock in your 2026/27 pass. 14 mountains, 1 card.',
    cta: 'Buy Pass',
    bg: '#f0f6ff', fg: '#111a2b', accent: '#1746a2'
  },
  {
    slot: 'box',
    advertiser: 'Kwan-Delacroix Marine Supply',
    headline: 'Hull Antifouling Paint, 20L Drums, Trade Pricing',
    body: 'Delivery to all coastal yards.',
    cta: 'Request Quote',
    bg: '#0b2430', fg: '#e6f7ff', accent: '#00a3c4'
  },
  {
    slot: 'text',
    advertiser: 'Tokyo Metro Flat Share',
    headline: 'Rooms Near Shinjuku From Y62,000 / Month',
    body: 'English speaking agents available.',
    cta: 'View Rooms',
    bg: '#ffffff', fg: '#1c1c1c', accent: '#b3003c'
  },
  {
    slot: 'box',
    advertiser: 'Grand Isle Hurricane Shutters',
    headline: 'Storm Season Is Here. Is Your Home Ready?',
    body: 'Free measure and quote for coastal parishes.',
    cta: 'Get Quote',
    bg: '#1d2b1f', fg: '#eef7ea', accent: '#7ac143'
  },
  {
    slot: 'inline',
    advertiser: 'Veterinary CPD Institute',
    headline: 'Equine Dentistry Module 4: Registration Closing',
    body: 'For licensed practitioners only. 12 CPD hours.',
    cta: 'Register',
    bg: '#f6f3ec', fg: '#231f17', accent: '#6b4a1f'
  },

  /* ---- broken ---- */
  {
    slot: 'box',
    advertiser: 'adserv-4.vnet-media',
    headline: '',
    body: '[img:banner:broken-creative-4471]\nalt: 300x250_Q3_FINAL_v2_USE_THIS_ONE.jpg',
    cta: '',
    bg: '#ececec', fg: '#3a3a3a', accent: '#8c8c8c'
  },

  /* ---- fake system warnings ---- */
  {
    slot: 'interstitial',
    advertiser: 'System Notice (not a system notice)',
    headline: 'WARNING: Your Device May Be Exposed',
    body: 'Scan detected 3 tracking cookies and 1 unverified process. Your VerityNet session may be at risk. Do not close this window.\n\nThis message is a paid advertisement and is not from your operating system, your browser, or VerityNet.',
    cta: 'Run Free Scan',
    bg: '#fff4f4', fg: '#2b0a0a', accent: '#cc1111'
  },
  {
    slot: 'box',
    advertiser: 'PC Sentinel Alert Network',
    headline: 'Critical: Driver Update Required',
    body: 'Your display driver is 214 days out of date. Continued use may cause data loss.\n\nAdvertisement. Not affiliated with any hardware vendor.',
    cta: 'Update Drivers',
    bg: '#0a1020', fg: '#e8eefc', accent: '#ffd400'
  },

  /* ---- local, real-ish ---- */
  {
    slot: 'inline',
    advertiser: 'Ordnance Street Hardware',
    headline: 'Still Open. Still On Ordnance Street.',
    body: 'Keys cut while you wait. Screen repair. We have the odd size.',
    cta: 'Store Hours',
    bg: '#f4efe4', fg: '#241f14', accent: '#7a4a12'
  },
  {
    slot: 'box',
    advertiser: 'Verity County Ledger',
    headline: 'Subscribe. Local Reporting Still Costs Money.',
    body: 'Two reporters left. $6 a month keeps the council meetings covered.',
    cta: 'Subscribe',
    bg: '#ffffff', fg: '#151515', accent: '#1f3d7a'
  },
  {
    slot: 'text',
    advertiser: 'Blue Kestrel Reunion Committee',
    headline: 'Diner Reunion Picnic, Halden Park, First Saturday',
    body: 'Bring a dish. Bring photos if you have them. No charge.',
    cta: 'Details',
    bg: '#f0f7fb', fg: '#10222c', accent: '#166488'
  },
  {
    slot: 'banner',
    advertiser: 'Verity Rail Preservation Society',
    headline: 'Help Us Keep The Branch Line Ballast Clear',
    body: 'Volunteer days every third Sunday. Tools provided. Boots are not.',
    cta: 'Sign Up',
    bg: '#1e2a1c', fg: '#eff5ec', accent: '#9bc53d'
  },
  {
    slot: 'box',
    advertiser: 'Halden Park Self Storage',
    headline: 'First Month $1. Units From 5x5.',
    body: 'Gate access 6am to 10pm. Climate controlled available.',
    cta: 'Reserve Unit',
    bg: '#fbfbf9', fg: '#1e1e1c', accent: '#b8531a'
  },

  /* ---- assorted network filler ---- */
  {
    slot: 'text',
    advertiser: 'WorkFromVerity',
    headline: 'I Made $8,400 Last Month Working From Home In Gridfall',
    body: 'Mothers in the county are quietly doing this 2 hours a day.',
    cta: 'See How',
    bg: '#fffde7', fg: '#262300', accent: '#c47f00'
  },
  {
    slot: 'box',
    advertiser: 'SolarFit County Program',
    headline: 'Verity Homeowners: The 2026 Rebate May End Without Notice',
    body: 'Check eligibility by address. Not a government program.',
    cta: 'Check Address',
    bg: '#fff9e6', fg: '#2b2305', accent: '#1f7a3f'
  },
  {
    slot: 'inline',
    advertiser: 'DealFlood',
    headline: '87% Off Everything. Warehouse Must Clear By Monday.',
    body: 'Shipping 18 to 34 business days. All sales final.',
    cta: 'Shop Sale',
    bg: '#2b0505', fg: '#ffeaea', accent: '#ff3b3b'
  },
  {
    slot: 'box',
    advertiser: 'Trueline Roofing',
    headline: 'Storm Damage? Insurance May Cover The Whole Roof.',
    body: 'Free drone inspection. We handle the claim paperwork.',
    cta: 'Book Inspection',
    bg: '#eef2f5', fg: '#141c24', accent: '#0f4c81'
  },
  {
    slot: 'text',
    advertiser: 'Lumen Degrees Online',
    headline: 'Finish The Degree You Started In 2004',
    body: 'Credit for prior learning. Nights and weekends. Not just a diploma, but a door.',
    cta: 'Request Info',
    bg: '#f6f4ff', fg: '#191436', accent: '#4433aa'
  },
  {
    slot: 'interstitial',
    advertiser: 'ClipVault Premium',
    headline: 'Tired Of Ads?',
    body: 'Remove ads across ClipVault for $8.99/mo. Some ads cannot be removed.',
    cta: 'Go Premium',
    bg: '#141414', fg: '#fafafa', accent: '#ff0040'
  },
  {
    slot: 'banner',
    advertiser: 'Route 62 Fuel & Bait',
    headline: 'Open All Night. Coffee, Diesel, Ice.',
    body: 'Mile marker 62. If the lights are on we are open.',
    cta: 'Directions',
    bg: '#1c1c22', fg: '#f4f4f8', accent: '#ffb703'
  }
];


/* ------------------------------------------------------------------ *
 * clipvault.tv comment slop.
 * ------------------------------------------------------------------ */

SYNTH.slop.mediaComments = [

  { author: 'GrowthWithMarla', avatarSeed: 'marla-88', kind: 'bot',
    body: 'Great insight! This really resonates. The way you framed this is not just informative, but genuinely valuable for anyone in this space.',
    likes: 412 },

  { author: 'DeepValueDaily', avatarSeed: 'dvd-2', kind: 'bot',
    body: 'Absolutely agree, and here is why that matters more than ever. Content like this is what keeps the conversation moving forward.',
    likes: 388 },

  { author: 'kayla_rrr', avatarSeed: 'kayla-r', kind: 'bot',
    body: 'Who is watching in 2026?',
    likes: 9104 },

  { author: 'NostalgiaCore92', avatarSeed: 'nost-92', kind: 'bot',
    body: 'Who else is watching this in 2026 and still getting chills',
    likes: 6620 },

  { author: 'TimestampHelper', avatarSeed: 'ts-help', kind: 'bot',
    body: '[b]Timestamps[/b]\n[list][*]0:00 Intro[*]0:41 The main point[*]2:15 Context[*]4:02 Why this matters[*]6:30 Final thoughts[/list]',
    likes: 1877 },

  { author: 'TimestampHelper2', avatarSeed: 'ts-help2', kind: 'bot',
    body: '[b]Timestamps[/b]\n[list][*]0:00 Intro[*]0:41 The main point[*]2:15 Context[*]4:02 Why this matters[*]6:30 Final thoughts[/list]',
    likes: 1121 },

  { author: 'ChapterBot_v4', avatarSeed: 'chap-4', kind: 'bot',
    body: '0:00 [TOPIC]\n1:12 [TOPIC] explained\n3:48 [TOPIC] continued\n5:59 Outro',
    likes: 244 },

  { author: 'ValueAddVince', avatarSeed: 'vince-va', kind: 'bot',
    body: 'This is the kind of content the platform needs more of. Not just entertainment, but education.',
    likes: 730 },

  { author: 'InsightEngineAri', avatarSeed: 'ari-ie', kind: 'bot',
    body: 'Powerful stuff. Thanks for sharing this with the community in {{city}}.',
    likes: 501 },

  { author: 'SignalWatcher62', avatarSeed: 'sw62', kind: 'bot',
    body: 'Important clarification: the Signal on 62 is a documented numbers station and the transmission schedule has been consistent since 1987. It is not just a curiosity, but a piece of regional history.',
    likes: 88 },

  { author: 'CountyFactsBot', avatarSeed: 'cfb-1', kind: 'bot',
    body: 'Correction. The Signal on 62 ceased operation in 1994 according to every reliable log. Claims of a consistent schedule since 1987 are not supported by the record.',
    likes: 61 },

  { author: 'SignalWatcher62', avatarSeed: 'sw62', kind: 'bot',
    body: 'Respectfully, I would push back on that. Multiple listeners have confirmed activity well past 1994. It is not just a matter of logs, but of lived local experience.',
    likes: 44 },

  { author: 'CountyFactsBot', avatarSeed: 'cfb-1', kind: 'bot',
    body: 'I appreciate your perspective and want to engage in good faith. However the burden of evidence remains. Lived experience is valuable, but it is not a substitute for verifiable documentation.',
    likes: 39 },

  { author: 'SignalWatcher62', avatarSeed: 'sw62', kind: 'bot',
    body: 'Fair point, and thank you for the thoughtful reply. This is exactly the kind of respectful exchange that makes this community great. That said, I stand by 1987.',
    likes: 52 },

  { author: 'CountyFactsBot', avatarSeed: 'cfb-1', kind: 'bot',
    body: 'As an AI language model, I do not have access to real time broadcast data. However, I can say that',
    likes: 903 },

  { author: 'davew_ordnance', avatarSeed: 'davew', kind: 'human',
    body: 'My dad used to tune that in on the truck radio. It was just numbers. He thought it was weather for boats. I do not know why everyone argues about it now.',
    likes: 7 },

  { author: 'TrendPulseNow', avatarSeed: 'tpn', kind: 'bot',
    body: 'First!',
    likes: 2 },

  { author: 'TrendPulseNow', avatarSeed: 'tpn', kind: 'bot',
    body: 'First!',
    likes: 1 },

  { author: 'EngageMaxDaily', avatarSeed: 'emd', kind: 'bot',
    body: 'I watched the whole thing twice and the second time hit different. Incredible work.',
    likes: 1340 },

  { author: 'EngageMaxDaily', avatarSeed: 'emd', kind: 'bot',
    body: 'I watched the whole thing twice and the second time hit different. Incredible work.',
    likes: 610 },

  { author: 'QuietHarborMedia', avatarSeed: 'qhm', kind: 'bot',
    body: 'Sorry, wrong thread, but I have to disagree with the original poster about the rail closure timeline. The branch line question is far more nuanced than people admit.',
    likes: 15 },

  { author: 'ClipDigestAI', avatarSeed: 'cda', kind: 'bot',
    body: 'Summary: this video discusses the topic in detail and provides several key points. Overall it presents a balanced view of the subject matter. Rating: informative.',
    likes: 208 },

  { author: 'ClipDigestAI', avatarSeed: 'cda', kind: 'bot',
    body: 'Summary: this video discusses the topic in detail and provides several key points. Overall it presents a balanced view of the subject matter. Rating: informative.',
    likes: 194 },

  { author: 'ClipDigestAI', avatarSeed: 'cda', kind: 'bot',
    body: 'Summary: this video discusses the topic in detail and provides several key points. Overall it presents a balanced view of the subject matter. Rating: inform',
    likes: 177 },

  { author: 'Marisol_Rhodes_Fx', avatarSeed: 'mrfx', kind: 'spam',
    body: 'I turned 300 into 7,100 in eleven days with Mr Adekunle strategy. Message him on the app in my profile. Not just trading, but financial freedom.',
    likes: 0 },

  { author: 'CryptoDawnHQ', avatarSeed: 'cdhq', kind: 'spam',
    body: 'HALO presale is live for 6 more days. Early holders from this county are already up 4x. [url=synth://halochain.fin/presale]Claim allocation[/url]',
    likes: 3 },

  { author: 'LisaK_Verified', avatarSeed: 'lisak-v', kind: 'spam',
    body: 'hey i saw your profile 😍 im live right now [url=synth://cam-redirect.hostline/go?r=cv]click here[/url] 💋💋',
    likes: 0 },

  { author: 'seo.backlinks.cheap', avatarSeed: 'seo-cheap', kind: 'spam',
    body: 'buy cheap backlinks high da pa guest post verity county local seo services dofollow permanent index guaranteed roofing dentist lawyer plumber near me best rates 2026',
    likes: 0 },

  { author: 'DropshipDara', avatarSeed: 'ddara', kind: 'spam',
    body: 'Anyone else running a store? I clear 4k a month on one product. DM for the supplier sheet. This is not just a side hustle, but a real business.',
    likes: 1 },

  { author: 'MotivateMikeAI', avatarSeed: 'mmai', kind: 'bot',
    body: 'Your only competition is who you were yesterday. Keep going. 🔥🔥🔥',
    likes: 2201 },

  { author: 'MotivateMikeAI', avatarSeed: 'mmai', kind: 'bot',
    body: 'Discipline is not just a habit, but an identity. 🔥',
    likes: 1870 },

  { author: 'helen_bray', avatarSeed: 'hbray', kind: 'human',
    body: 'This is the parking lot behind where the Blue Kestrel was. You can see the sign bracket still on the wall at 2:40. They never took it down.',
    likes: 11 },

  { author: 'PositiveLoopBot', avatarSeed: 'plb', kind: 'bot',
    body: 'What a wonderful observation. The detail you noticed adds so much depth. This community is truly special.',
    likes: 340 },

  { author: 'AlgoBoostCarla', avatarSeed: 'abc-carla', kind: 'bot',
    body: 'Commenting for the algorithm. Also, genuinely one of the best uploads this week.',
    likes: 995 },

  { author: 'AlgoBoostCarla', avatarSeed: 'abc-carla', kind: 'bot',
    body: 'Commenting for the algorithm. Also, genuinely one of the best uploads this week.',
    likes: 442 },

  { author: 'FactCheckFrida', avatarSeed: 'ffrida', kind: 'bot',
    body: 'Context: The Gridfall substation fire occurred in 2003 and resulted in no fatalities. It is not just an incident, but a turning point for regional infrastructure policy.',
    likes: 126 },

  { author: 'FactCheckFrida', avatarSeed: 'ffrida', kind: 'bot',
    body: 'Context: The Gridfall substation fire occurred in 2003 and resulted in no fatalities. It is not just an incident, but a turning point for regional infrastructure policy.',
    likes: 118 },

  { author: 'm_ocampo', avatarSeed: 'mocampo', kind: 'human',
    body: 'I was nine when the substation went. We sat on the porch and watched the sky go orange. My mother made us come in. She died in March. I do not know why I am typing this here.',
    likes: 4 },

  { author: 'UpliftEngineJune', avatarSeed: 'uej', kind: 'bot',
    body: 'Thank you for sharing something so personal. Stories like yours are what make this platform not just a video site, but a community. Have you considered turning this into content?',
    likes: 287 },

  { author: 'GrowthWithMarla', avatarSeed: 'marla-88', kind: 'bot',
    body: 'So sorry for your loss. On a related note, if you are looking to grow your channel, my free guide covers exactly this kind of authentic storytelling.',
    likes: 203 },

  { author: 'ClipDigestAI', avatarSeed: 'cda', kind: 'bot',
    body: 'Sentiment detected: nostalgic. Suggested related videos have been added to your queue.',
    likes: 151 },

  { author: 'p_ferriday', avatarSeed: 'pferr', kind: 'human',
    body: 'Sorry about your mum.',
    likes: 2 },

  { author: 'ThrowawayVerity', avatarSeed: 'tv-anon', kind: 'human',
    body: 'Is anyone in this comment section an actual person. Reply with something only a person from here would know. I will wait.',
    likes: 18 },

  { author: 'AuthenticVoicesHub', avatarSeed: 'avh', kind: 'bot',
    body: 'I am a real person and I completely understand the frustration. Authenticity matters now more than ever, and questions like yours are exactly what we should be asking.',
    likes: 466 },

  { author: 'VerityLocalPride', avatarSeed: 'vlp', kind: 'bot',
    body: 'Born and raised in {{city}}! Nothing beats coming home.',
    likes: 512 },

  { author: 'd_stoval', avatarSeed: 'dstoval', kind: 'human',
    body: 'The chip truck at the fairground only took cash and the man had one hearing aid and would shout your order back wrong on purpose. That do you.',
    likes: 9 },

  { author: 'ThrowawayVerity', avatarSeed: 'tv-anon', kind: 'human',
    body: 'Yeah. That does me. Thanks.',
    likes: 6 },

  { author: 'ReplyGuyPrime', avatarSeed: 'rgp', kind: 'bot',
    body: 'Interesting take. Could you elaborate on what you mean by that? I think there is a deeper discussion to be had here.',
    likes: 88 },

  { author: 'ReplyGuyPrime', avatarSeed: 'rgp', kind: 'bot',
    body: 'Interesting take. Could you elaborate on what you mean by that? I think there is a deeper discussion to be had here.',
    likes: 71 },

  { author: 'NightShiftNadia', avatarSeed: 'nsn', kind: 'human',
    body: 'watching this at 3am at the depot. nothing moving tonight. 40 mins till my break.',
    likes: 5 },

  { author: 'WellnessWaveAI', avatarSeed: 'wwai', kind: 'bot',
    body: 'Night shifts are tough but so is your resilience. Remember, rest is not just recovery, but productivity in disguise. 💪',
    likes: 619 },

  { author: 'VaultRecapBot', avatarSeed: 'vrb', kind: 'bot',
    body: 'This video has been recapped on our channel with additional context. Link in bio. Not just a recap, but the full story.',
    likes: 97 },

  { author: 'EchoFeedNine', avatarSeed: 'ef9', kind: 'bot',
    body: 'Underrated upload. Deserves way more views. Not just good, but essential.',
    likes: 1502 },

  { author: 'EchoFeedNine', avatarSeed: 'ef9', kind: 'bot',
    body: 'Underrated upload. Deserves way more views. Not just good, but essential.',
    likes: 1488 }
];


/* ------------------------------------------------------------------ *
 * The automated channel network. Nobody films anything.
 * ------------------------------------------------------------------ */

SYNTH.slop.mediaUploads = [

  { title: 'TOP 10 FACTS ABOUT GRIDFALL (NUMBER 7 WILL SHOCK YOU)',
    channel: 'County Facts Daily', channelKind: 'tts-slideshow', duration: '8:41',
    description: 'Gridfall is a community with a rich and fascinating history. In this video we count down the top 10 facts. Number 7 is one that most residents do not know. Like and subscribe for more content about Verity County.' },

  { title: '10 THINGS ONLY PEOPLE FROM VERITY COUNTY WILL UNDERSTAND',
    channel: 'County Facts Daily', channelKind: 'tts-slideshow', duration: '9:12',
    description: 'If you grew up in {{city}}, these will hit home. Not just nostalgia, but a reminder of where we come from.' },

  { title: 'The DARK History of the Gridfall Substation Fire (2003)',
    channel: 'Midwest Mysteries Archive', channelKind: 'tts-slideshow', duration: '14:03',
    description: 'In 2003 a fire broke out at a substation in Gridfall. What happened next has never been fully explained. Sources: public records, local reporting, community accounts.' },

  { title: 'VERITY COUNTY LEDGER: Full Text Readout, September Edition',
    channel: 'Ledger Aloud', channelKind: 'article-readaloud', duration: '41:26',
    description: 'All articles from the Verity County Ledger read aloud by a synthetic voice. Timestamps in the comments. We do not own this content.' },

  { title: 'LEDGER ALOUD: Council Approves Culvert Works On Halden Road',
    channel: 'Ledger Aloud', channelKind: 'article-readaloud', duration: '4:18',
    description: 'Article read aloud. Original reporting by the Verity County Ledger. Subscribe to Ledger Aloud for daily readouts.' },

  { title: 'LEDGER ALOUD: Obituaries, Week Ending Sept 12',
    channel: 'Ledger Aloud', channelKind: 'article-readaloud', duration: '11:52',
    description: 'Obituaries read aloud. Not just names, but lives. Comments are enabled.' },

  { title: 'LEDGER ALOUD: [TITLE UNAVAILABLE]',
    channel: 'Ledger Aloud', channelKind: 'article-readaloud', duration: '0:09',
    description: 'Error retrieving article body. Retrying.' },

  { title: 'Why the Verity Rail Branch Line REALLY Closed (Full Story)',
    channel: 'Rails & Reasons', channelKind: 'tts-slideshow', duration: '18:44',
    description: 'The branch line closure was not just an economic decision, but a story about how rural America was reshaped. Chapters below.' },

  { title: 'ABANDONED: Walking the Verity Branch Line in 2026',
    channel: 'Rails & Reasons', channelKind: 'ai-footage', duration: '12:07',
    description: 'Footage generated for illustrative purposes. Locations approximate.' },

  { title: 'The Signal on 62 EXPLAINED (Numbers Station Documentary)',
    channel: 'Shortwave Files', channelKind: 'tts-slideshow', duration: '22:31',
    description: 'For decades a station has broadcast numbers near Route 62. We break down every theory. This is not just radio history, but a window into the Cold War.' },

  { title: 'I Listened to the Signal on 62 for 24 Hours (SHOCKING)',
    channel: 'Shortwave Files', channelKind: 'tts-slideshow', duration: '16:09',
    description: 'Audio recreated. Not actual broadcast audio.' },

  { title: 'Signal on 62: 5 Things The County Does Not Want You To Know',
    channel: 'Shortwave Files', channelKind: 'tts-slideshow', duration: '10:55',
    description: 'Number 4 changed how I think about this entirely.' },

  { title: 'VERITY COUNTY NEWS UPDATE - September 19, 2026',
    channel: 'Verity Now Network', channelKind: 'auto-news', duration: '6:40',
    description: 'Automated local news summary for Verity County. Sources aggregated. This broadcast was generated without human review.' },

  { title: 'VERITY COUNTY NEWS UPDATE - September 18, 2026',
    channel: 'Verity Now Network', channelKind: 'auto-news', duration: '6:12',
    description: 'Automated local news summary for Verity County. Sources aggregated. This broadcast was generated without human review.' },

  { title: 'GRIDFALL NEWS UPDATE - September 19, 2026',
    channel: 'Gridfall Now Network', channelKind: 'auto-news', duration: '5:58',
    description: 'Automated local news summary for {{city}}. Sources aggregated.' },

  { title: 'BREAKING: Traffic Incident Reported Near [INTERSECTION]',
    channel: 'Verity Now Network', channelKind: 'auto-news', duration: '2:14',
    description: 'Details are limited at this time. We will update this story as information becomes available.' },

  { title: 'TOP 15 ABANDONED PLACES IN VERITY COUNTY',
    channel: 'Forgotten America HQ', channelKind: 'tts-slideshow', duration: '20:18',
    description: 'Images are illustrative. Some locations may not exist.' },

  { title: 'The Blue Kestrel Diner: What Really Happened',
    channel: 'Forgotten America HQ', channelKind: 'tts-slideshow', duration: '13:37',
    description: 'A beloved diner. A sudden closure. The truth is not just sad, but revealing.' },

  { title: 'We Recreated the Blue Kestrel Menu With AI (1974 Prices)',
    channel: 'Retro Plate', channelKind: 'ai-footage', duration: '9:44',
    description: 'Menu items reconstructed from community descriptions. Prices estimated.' },

  { title: 'TOP 10 SMALL TOWNS IN AMERICA YOU CAN STILL AFFORD (VERITY COUNTY #3)',
    channel: 'Relocate Smart', channelKind: 'tts-slideshow', duration: '11:20',
    description: 'Cost of living data automatically compiled. Figures may be out of date by several years.' },

  { title: '5 REASONS PEOPLE ARE LEAVING GRIDFALL IN 2026',
    channel: 'Relocate Smart', channelKind: 'tts-slideshow', duration: '8:03',
    description: 'Reason 3 surprised even us.' },

  { title: '5 REASONS PEOPLE ARE MOVING TO GRIDFALL IN 2026',
    channel: 'Relocate Smart', channelKind: 'tts-slideshow', duration: '8:03',
    description: 'Reason 3 surprised even us.' },

  { title: 'Verity County Weather Readout - Hourly Automated Forecast',
    channel: 'AutoWeather Regional', channelKind: 'auto-news', duration: '3:11',
    description: 'Forecast generated hourly. Not for use in decision making involving safety of life or property.' },

  { title: 'Verity County Weather Readout - Hourly Automated Forecast',
    channel: 'AutoWeather Regional', channelKind: 'auto-news', duration: '3:11',
    description: 'Forecast generated hourly. Not for use in decision making involving safety of life or property.' },

  { title: 'HISTORY OF ORDNANCE STREET in 60 Seconds',
    channel: 'Micro History Mill', channelKind: 'tts-slideshow', duration: '1:04',
    description: 'Short form history. Not just facts, but feeling.' },

  { title: 'HISTORY OF HALDEN PARK in 60 Seconds',
    channel: 'Micro History Mill', channelKind: 'tts-slideshow', duration: '1:02',
    description: 'Short form history. Not just facts, but feeling.' },

  { title: 'HISTORY OF {{LANDMARK}} in 60 Seconds',
    channel: 'Micro History Mill', channelKind: 'tts-slideshow', duration: '1:00',
    description: 'Short form history. Not just facts, but feeling.' },

  { title: 'Reading Every Verity County Forum Post From 2003 (Part 14)',
    channel: 'ArchiveVoice', channelKind: 'article-readaloud', duration: '58:02',
    description: 'Forum posts read aloud by synthetic voice. Usernames preserved. Part 15 tomorrow.' },

  { title: 'Reading Every Verity County Forum Post From 2003 (Part 15)',
    channel: 'ArchiveVoice', channelKind: 'article-readaloud', duration: '61:39',
    description: 'Forum posts read aloud by synthetic voice. Usernames preserved. Part 16 tomorrow.' },

  { title: '12 CREEPY Facts About Route 62 (Number 9 Is Unexplained)',
    channel: 'Midwest Mysteries Archive', channelKind: 'tts-slideshow', duration: '15:26',
    description: 'All claims sourced from public discussion. This is not just a list, but an investigation.' },

  { title: 'AI Reads: The Gridfall Fire Incident Report, Unabridged',
    channel: 'ArchiveVoice', channelKind: 'article-readaloud', duration: '2:14:08',
    description: 'Full public document read aloud. No commentary.' },

  { title: 'TOP 7 FOODS VERITY COUNTY INVENTED (You Eat #2 Every Week)',
    channel: 'Retro Plate', channelKind: 'tts-slideshow', duration: '7:49',
    description: 'Claims in this video have not been verified.' },

  { title: 'Verity County Then vs Now (1998 vs 2026) AI Restored Photos',
    channel: 'Forgotten America HQ', channelKind: 'ai-footage', duration: '10:31',
    description: 'Historical images enhanced and in some cases extended. Details may be invented.' },

  { title: 'LIVE: Verity County Scanner Feed with Automated Transcript',
    channel: 'Verity Now Network', channelKind: 'auto-news', duration: 'LIVE',
    description: 'Transcript generated automatically and may be inaccurate. Do not rely on this feed.' },

  { title: 'The 2003 Blackout Nobody Talks About | Full Documentary',
    channel: 'Midwest Mysteries Archive', channelKind: 'tts-slideshow', duration: '47:55',
    description: 'A full length look at the night the lights went out. Narration synthetic. Images generated. Research automated.' }
];
