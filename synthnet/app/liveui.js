/* liveui.js -- the furniture of a live, mostly-automated network.
 *
 * Ad slots, bot badges, "Promoted" labels, online counters, a breaking-news
 * ticker. The renderers call into here rather than each growing their own
 * version, because an ad that looks different on every site looks like six
 * different mistakes instead of one ad network.
 *
 * Everything is deterministic per minute: see live.js. An ad that reshuffled
 * on every repaint would read as broken.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};
  SYNTH.slop = SYNTH.slop || {};

  function el() { return SYNTH.el.apply(null, arguments); }
  function live() { return SYNTH.live; }

  /* --- badges -----------------------------------------------------------
   * The little tells. A real network would not label its bots; this one does,
   * because the joke only lands if you can see how much of the page is
   * automated. */

  var BADGE_TEXT = {
    bot: 'BOT',
    spam: 'SPAM',
    promoted: 'Promoted',
    sponsored: 'Sponsored',
    human: null
  };

  function badge(kind) {
    var text = BADGE_TEXT[kind];
    if (!text) return null;
    return el('span', { 'class': 'lv-badge lv-badge-' + kind, title: labelFor(kind) }, text);
  }

  function labelFor(kind) {
    if (kind === 'bot') return 'Automated account';
    if (kind === 'spam') return 'Flagged as spam by 41 users';
    if (kind === 'promoted') return 'Paid placement';
    if (kind === 'sponsored') return 'Paid placement';
    return '';
  }

  function verifiedTick() {
    return el('span', { 'class': 'lv-verified', title: 'Verified (subscription)' }, '✔');
  }

  /* --- ads --------------------------------------------------------------
   * One ad network, five slot shapes. Colours come from the ad itself so the
   * inventory looks like it was sold by different people, which it was. */

  function adFor(slot, seed) {
    var all = live().pool('ads');
    var pool = all.filter(function (a) { return a.slot === slot; });
    if (!pool.length) pool = all;
    if (!pool.length) return null;
    return pool[live().hash32(slot + ':' + seed) % pool.length];
  }

  function ad(slot, seed) {
    var a = adFor(slot, seed);
    if (!a) return null;

    var style = 'background:' + (a.bg || '#f4f4f4') + ';color:' + (a.fg || '#222') + ';';
    var box = el('div', { 'class': 'lv-ad lv-ad-' + slot, style: style });

    box.appendChild(el('div', { 'class': 'lv-ad-tag' }, 'Ad · ' + (a.advertiser || 'VerityAds')));
    box.appendChild(el('div', { 'class': 'lv-ad-head' }, a.headline || ''));
    if (a.body) box.appendChild(el('div', { 'class': 'lv-ad-body' }, a.body));
    if (a.cta) {
      box.appendChild(el('span', {
        'class': 'lv-ad-cta',
        style: 'background:' + (a.accent || '#2b6cb0') + ';'
      }, a.cta));
    }
    // Deliberately inert: it is an ad in a fake internet, there is nowhere to
    // go. The close button does nothing, which is also true of real ones.
    box.appendChild(el('span', { 'class': 'lv-ad-close', title: 'Close' }, '×'));
    return box;
  }

  /* --- live counters ---------------------------------------------------- */

  function onlineBar(domain, low, high) {
    var l = live();
    var users = l.online(domain, low || 40, high || 900);
    var guests = Math.round(users * (0.55 + (l.rng(domain)() * 0.3)));
    var bots = Math.max(1, Math.round(users * 0.93));
    /* data-lv-online is what app/tick.js reads to repaint this in place
     * every few seconds. Without it the number is computed once at paint
     * and then sits there, which is the tell that a page is a screenshot. */
    return el('div', {
      'class': 'lv-online',
      'data-lv-online': domain + ':' + (low || 40) + ':' + (high || 900)
    },
      el('span', { 'class': 'lv-dot' }, ''),
      el('span', {}, l.commas(users) + ' users online'),
      el('span', { 'class': 'lv-online-sep' }, '·'),
      el('span', {}, l.commas(guests) + ' guests'),
      el('span', { 'class': 'lv-online-sep' }, '·'),
      el('span', { 'class': 'lv-online-bots', title: 'Accounts our systems classify as automated' },
        l.commas(bots) + ' automated')
    );
  }

  /* The number that makes the joke explicit, shown on the start page. */
  function automatedShare(seed) {
    var l = live();
    var base = 96.2;
    var drift = l.rng('share:' + Math.floor(l.now() / 3600000))() * 2.9;
    return (base + drift).toFixed(1);
  }

  /* --- ticker -----------------------------------------------------------
   * CSS animation, not the <marquee> tag. Same effect, and it does not fight
   * the layout. */

  function ticker(seed, count) {
    var l = live();
    var items = l.pool('tickers');
    if (!items.length) return null;
    var chosen = l.sample(items, count || 8, 'ticker:' + Math.floor(l.minutesSinceEpoch() / 11));
    var strip = el('div', {
      'class': 'lv-ticker',
      'data-lv-ticker': String(seed || 'ticker') + ':' + (count || 8)
    });
    var rail = el('div', { 'class': 'lv-ticker-rail' });
    for (var i = 0; i < chosen.length; i++) {
      rail.appendChild(el('span', { 'class': 'lv-ticker-item' }, chosen[i]));
      rail.appendChild(el('span', { 'class': 'lv-ticker-dot' }, '●'));
    }
    strip.appendChild(el('span', { 'class': 'lv-ticker-label' }, 'LIVE'));
    strip.appendChild(el('div', { 'class': 'lv-ticker-win' }, rail));
    return strip;
  }

  /* --- avatars ----------------------------------------------------------
   * Bots get flat generated blobs; it reads at a glance as "not a person". */

  function avatar(seed, size) {
    return SYNTH.markup.placeholder('avatar', seed || 'anon');
  }

  SYNTH.liveui = {
    badge: badge,
    verifiedTick: verifiedTick,
    ad: ad,
    onlineBar: onlineBar,
    automatedShare: automatedShare,
    ticker: ticker,
    avatar: avatar
  };
})();
