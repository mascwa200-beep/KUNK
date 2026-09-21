/* synthnet :: chat renderer
 * The place the forums went. Skin: skin-chatdark.
 *
 * Paths:  /                the server, landing in its first open channel
 *         /c/<channelId>   one channel
 *
 * Why this type is shaped the way it is: a forum has threads with titles and
 * a URL per thread, and a chat has a river. When a community moves from one
 * to the other the record does not move with it -- it arrives as a dump in a
 * channel nobody can post in, with the pictures stripped out, in an order
 * that only makes sense if you were there. So the archive channel here is
 * read-only at the renderer level, its attachments are rendered as the
 * filenames they used to be, and nothing in the copy comments on any of it.
 *
 * Classic script, ES5-safe. No innerHTML with data. No absolute URLs.
 */
window.SYNTH = window.SYNTH || {};

(function () {
  'use strict';

  var el = null;

  var MINUTE_MS = 60000;
  var DAY_MS = 86400000;

  /* Two minutes is the cadence the brief asks for and it is also about right:
   * a room of forty people produces a line every couple of minutes all day
   * and nothing at all between 3am and 6am, which live.slotLive() handles. */
  var LIVE_INTERVAL_MIN = 2;
  var LIVE_COUNT = 12;

  /* Consecutive lines from one person collapse into a block. A pause longer
   * than this starts a new one, because after seven minutes it is a new
   * thought and the name needs repeating. */
  var GROUP_GAP_MS = 7 * MINUTE_MS;

  /* Past this, a relative timestamp is a lie by omission: live.ago() prints
   * "14 Mar" with no year, and every date in the archive channel is years
   * old. Those get the full date instead, and no data-lv-ago, since the
   * heartbeat would overwrite it with the yearless form. */
  var ABSOLUTE_AFTER_MS = 300 * DAY_MS;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  function has(ns) { return !!(window.SYNTH && window.SYNTH[ns]); }

  function text(t) {
    return document.createTextNode(String(t === null || t === undefined ? '' : t));
  }

  function trim(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
  }

  /* FNV-1a, matching live.js, and unsigned the whole way down. A signed
   * right shift on a hash is the bug this project has shipped twice: `h >> 3`
   * goes negative, `negative % length` is negative, the lookup is undefined. */
  function hash32(s) {
    if (has('live') && SYNTH.live.hash32) {
      try { return SYNTH.live.hash32(String(s)); } catch (e) { /* fall */ }
    }
    var str = String(s === null || s === undefined ? '' : s);
    var h = 2166136261;
    var i;
    for (i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function nowMs() {
    if (has('live') && SYNTH.live.now) {
      try { return SYNTH.live.now(); } catch (e) { /* fall */ }
    }
    return new Date().getTime();
  }

  function agoText(ms) {
    if (has('live') && SYNTH.live.ago) {
      try { return SYNTH.live.ago(ms); } catch (e) { /* fall */ }
    }
    return 'earlier';
  }

  function longDateText(ms) {
    if (has('live') && SYNTH.live.longDate) {
      try { return SYNTH.live.longDate(ms); } catch (e) { /* fall */ }
    }
    var d = new Date(ms);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function dayLabel(ms) {
    var d = new Date(ms);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  }

  function strip(s) {
    if (has('markup') && SYNTH.markup.strip) {
      try { return SYNTH.markup.strip(s); } catch (e) { /* fall */ }
    }
    return String(s === null || s === undefined ? '' : s)
      .replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ');
  }

  function badge(kind) {
    if (!kind || kind === 'human' || !has('liveui') || !SYNTH.liveui.badge) { return null; }
    try { return SYNTH.liveui.badge(kind); } catch (e) { return null; }
  }

  function avatarNode(seed) {
    if (has('liveui') && SYNTH.liveui.avatar) {
      try {
        var node = SYNTH.liveui.avatar(seed);
        if (node) { return node; }
      } catch (e) { /* fall */ }
    }
    if (has('markup') && SYNTH.markup.placeholder) {
      try { return SYNTH.markup.placeholder('avatar', seed); } catch (e) { /* fall */ }
    }
    return el('span', { 'class': 'cd-ava-fb' },
      text(String(seed || '?').charAt(0).toUpperCase()));
  }

  function byId(arr, id) {
    var i;
    for (i = 0; i < (arr || []).length; i++) {
      if (arr[i] && String(arr[i].id) === String(id)) { return arr[i]; }
    }
    return null;
  }

  function numOr(v, fallback) {
    var n = typeof v === 'number' ? v : parseInt(v, 10);
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }

  /* Authored `at` is a wall-clock string; the live layer hands back real
   * epoch ms. Both become ms here so one sort can interleave them. Built by
   * parts rather than Date.parse, which reads a bare date-time as UTC under
   * ES5 and as local under ES2016 -- hours of difference in where a line
   * lands, and in a chat that reorders the conversation. */
  var AT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

  function parseAt(v) {
    if (typeof v === 'number' && isFinite(v)) { return v; }
    var m = AT_RE.exec(String(v === null || v === undefined ? '' : v));
    if (!m) { return null; }
    var t = new Date(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0,
      m[6] ? parseInt(m[6], 10) : 0
    ).getTime();
    return isFinite(t) ? t : null;
  }

  /* ---------- channels ---------- */

  function channelsOf(d) {
    var src = (d && d.channels) || [];
    var out = [];
    var i;
    for (i = 0; i < src.length; i++) {
      if (src[i] && typeof src[i] === 'object' && src[i].id) { out.push(src[i]); }
    }
    return out;
  }

  function kindOf(ch) {
    var k = String((ch && ch.kind) || 'text').toLowerCase();
    if (k === 'archive' || k === 'announce') { return k; }
    return 'text';
  }

  function isReadOnly(ch) { return kindOf(ch) === 'archive'; }

  function landingChannel(list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (!isReadOnly(list[i])) { return list[i]; }
    }
    return list.length ? list[0] : null;
  }

  /* Who has actually said something in here, newest first, for the typing
   * line. A name that has never posted typing is the tell that the indicator
   * is decorative. */
  function speakersOf(ch) {
    var src = (ch && ch.messages) || [];
    var seen = {};
    var out = [];
    var i;
    for (i = src.length - 1; i >= 0 && out.length < 14; i--) {
      if (!src[i] || typeof src[i] !== 'object') { continue; }
      var who = trim(src[i].by);
      if (!who || Object.prototype.hasOwnProperty.call(seen, who)) { continue; }
      seen[who] = 1;
      out.push(who);
    }
    return out;
  }

  /* ---------- messages ---------- */

  /* `replyTo` may be an index into this channel, or a handle. A handle means
   * the nearest earlier line from that person, which is what the arrow points
   * at nine times in ten. A handle nobody in this channel used still renders
   * -- somebody replied to a message that is not in the export. */
  function resolveReply(src, index, ref) {
    if (ref === null || ref === undefined || ref === '') { return null; }
    if (typeof ref === 'number') {
      var t = src[ref];
      if (t && typeof t === 'object') {
        return { by: trim(t.by) || 'someone', body: String(t.body || '') };
      }
      return null;
    }
    var want = trim(ref);
    if (!want) { return null; }
    var j;
    for (j = index - 1; j >= 0; j--) {
      if (src[j] && typeof src[j] === 'object' && trim(src[j].by) === want) {
        return { by: want, body: String(src[j].body || '') };
      }
    }
    return { by: want, body: '' };
  }

  function authoredMessages(ch) {
    var src = (ch && ch.messages) || [];
    var out = [];
    var i;
    for (i = 0; i < src.length; i++) {
      var m = src[i];
      if (!m || typeof m !== 'object') { continue; }
      out.push({
        by: trim(m.by) || 'someone',
        at: parseAt(m.at),
        body: String(m.body === null || m.body === undefined ? '' : m.body),
        kind: m.kind || null,
        replyTo: resolveReply(src, i, m.replyTo),
        mine: false,
        seed: String((ch && ch.id) || 'c') + ':' + i
      });
    }
    return out;
  }

  /* Chat is not prose. A feed post arrives as a paragraph; what it becomes in
   * here is two or three short lines from one person in a row, because there
   * is no Post button to make anyone finish the thought first. */
  function chatLines(raw, seed) {
    var s = trim(strip(raw));
    if (!s) { return []; }

    var parts = [];
    var buf = '';
    var i, c, next;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      buf += c;
      next = i + 1 < s.length ? s.charAt(i + 1) : '';
      if ((c === '.' || c === '!' || c === '?') && (next === '' || next === ' ')) {
        parts.push(buf);
        buf = '';
      }
    }
    if (buf) { parts.push(buf); }

    var lines = [];
    for (i = 0; i < parts.length && lines.length < 3; i++) {
      var line = trim(parts[i]);
      if (!line) { continue; }
      if (line.length > 132) { line = trim(line.slice(0, 129)) + '…'; }
      lines.push(line);
    }
    if (!lines.length) { return []; }

    /* How many of them actually got sent. Two is the common case. */
    var n = 1 + (hash32('lines:' + seed) % 3);
    return lines.slice(0, n < lines.length ? n : lines.length);
  }

  function liveMessages(ctx, ch) {
    /* Nothing arrives in a read-only channel. That is the whole point of it. */
    if (!ch || isReadOnly(ch)) { return []; }
    if (!has('live') || !SYNTH.live.stream) { return []; }

    var rows;
    try {
      rows = SYNTH.live.stream('chat:' + ctx.site.domain + ':' + ch.id,
                               'socialPosts', LIVE_INTERVAL_MIN, LIVE_COUNT);
    } catch (e) { return []; }

    var out = [];
    var i, j;
    /* stream() returns newest first; a river runs the other way. */
    for (i = (rows || []).length - 1; i >= 0; i--) {
      var r = rows[i];
      /* The rows are wrappers -- {slot, at, item, seed}. The message is
       * r.item. Reading r.body here prints [object Object] on screen. */
      var it = (r && r.item && typeof r.item === 'object') ? r.item : null;
      if (!it) { continue; }

      var who = trim(it.handle) || trim(it.author) || 'someone';
      var seed = String(r.seed || r.slot || i);
      var lines = chatLines(it.body || it.headline || '', seed);
      for (j = 0; j < lines.length; j++) {
        out.push({
          by: who,
          /* The gap between three lines in a row is seconds, not minutes. */
          at: r.at + j * 11000,
          body: lines[j],
          kind: it.kind || 'bot',
          replyTo: null,
          mine: false,
          seed: seed + ':' + j
        });
      }
    }
    return out;
  }

  /* Anything you typed into this server, in the river with everyone else's,
   * which is the only place a chat message would ever appear. */
  function myMessages(ctx, ch) {
    if (!ch || isReadOnly(ch)) { return []; }
    if (!(window.SYNTH && SYNTH.me && typeof SYNTH.me.posts === 'function')) { return []; }

    var rows = [];
    try { rows = SYNTH.me.posts(ctx.site.domain) || []; } catch (e) { return []; }
    if (!rows.length) { return []; }

    var who = 'you';
    try {
      var p = SYNTH.me.profile && SYNTH.me.profile();
      if (p && p.handle) { who = String(p.handle); }
    } catch (e) { /* no account, no handle */ }

    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      if (!rows[i]) { continue; }
      out.push({
        by: who,
        at: numOr(rows[i].at, null),
        body: String(rows[i].body || ''),
        kind: null,
        replyTo: null,
        mine: true,
        seed: 'me:' + (rows[i].id || i)
      });
    }
    return out;
  }

  function byTimeAsc(a, b) {
    var av = (a.at === null || a.at === undefined) ? 0 : a.at;
    var bv = (b.at === null || b.at === undefined) ? 0 : b.at;
    return av - bv;
  }

  function riverFor(ctx, ch) {
    /* Authored lines keep the order they were written in, because a chat log
     * is a transcript and its order is the content. Everything that arrived
     * since sorts in after it by the clock. */
    var tail = liveMessages(ctx, ch).concat(myMessages(ctx, ch));
    tail.sort(byTimeAsc);
    return authoredMessages(ch).concat(tail);
  }

  function groupMessages(list) {
    var groups = [];
    var cur = null;
    var i;
    for (i = 0; i < list.length; i++) {
      var m = list[i];
      var gap = (cur && cur.lastAt !== null && m.at !== null)
        ? (m.at - cur.lastAt) : 0;
      var fresh = !cur || cur.by !== m.by || !!m.replyTo || gap > GROUP_GAP_MS || gap < 0;
      if (fresh) {
        cur = {
          by: m.by,
          kind: m.kind,
          mine: m.mine,
          at: m.at,
          lastAt: m.at,
          seed: m.seed,
          replyTo: m.replyTo,
          lines: []
        };
        groups.push(cur);
      }
      cur.lines.push(m);
      if (m.at !== null) { cur.lastAt = m.at; }
    }
    return groups;
  }

  /* ---------- bodies, and the attachments that did not come ---------- */

  function goneName(kind, seed) {
    var base = String(seed === null || seed === undefined ? '' : seed)
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!base) { base = 'image'; }
    return base + (String(kind).toLowerCase() === 'avatar' ? '.png' : '.jpg');
  }

  function goneNode(kind, seed) {
    return el('span', { 'class': 'cd-gone' },
      el('span', { 'class': 'cd-gone-slug', 'aria-hidden': 'true' }, text('▨')),
      el('span', { 'class': 'cd-gone-name' }, text(goneName(kind, seed))),
      el('span', { 'class': 'cd-gone-note' }, text('attachment not migrated'))
    );
  }

  var IMG_RE = /\[img:([A-Za-z]+):([^\]]+)\]/g;

  /* In a live channel an image is an image. In the archive it is a filename,
   * because the export had the text in it and nothing else. Rather than
   * dressing that up in copy, the renderer simply cannot draw them: the
   * markup is split around the image tags and the tags come out as stubs. */
  function bodyInto(ctx, host, raw, dead) {
    var s = String(raw === null || raw === undefined ? '' : raw);

    var bare = trim(strip(s));
    if (bare === '[removed]' || bare === '[deleted]') {
      host.appendChild(el('span', { 'class': 'cd-tomb' },
        text('message removed by a moderator who is no longer in this server')));
      return;
    }

    if (!dead) {
      host.appendChild(ctx.markup(s));
      return;
    }

    IMG_RE.lastIndex = 0;
    var last = 0;
    var found = false;
    var m;
    while ((m = IMG_RE.exec(s)) !== null) {
      found = true;
      /* The gap between two attachments is a space, and a space through the
       * markup parser comes out as an empty paragraph. Skip those. */
      if (m.index > last && trim(s.slice(last, m.index))) {
        host.appendChild(ctx.markup(s.slice(last, m.index)));
      }
      host.appendChild(goneNode(m[1], m[2]));
      last = m.index + m[0].length;
    }
    if (!found) {
      host.appendChild(ctx.markup(s));
      return;
    }
    if (last < s.length && trim(s.slice(last))) {
      host.appendChild(ctx.markup(s.slice(last)));
    }
  }

  /* ---------- chrome ---------- */

  function onlineBarNode(ctx, d) {
    if (!has('liveui') || !SYNTH.liveui.onlineBar) { return null; }
    var base = numOr(d.onlineCount, 40);
    if (base < 4) { base = 4; }
    var low = Math.max(2, Math.round(base * 0.45));
    var high = Math.max(low + 3, Math.round(base * 1.7));
    try { return SYNTH.liveui.onlineBar(ctx.site.domain, low, high); } catch (e) { return null; }
  }

  function header(ctx, d) {
    var bar = el('div', { 'class': 'cd-top' });

    var brand = el('div', { 'class': 'cd-brand' });
    brand.appendChild(ctx.link('/', d.serverName || ctx.site.title, 'cd-brand-link'));
    var members = numOr(d.memberCount, 0);
    if (members) {
      brand.appendChild(el('span', { 'class': 'cd-brand-sub' },
        text(members + (members === 1 ? ' member' : ' members'))));
    }
    bar.appendChild(brand);

    var online = onlineBarNode(ctx, d);
    if (online) { bar.appendChild(el('div', { 'class': 'cd-top-live' }, online)); }

    return el('header', { 'class': 'cd-head' }, bar);
  }

  function railRow(ctx, ch, activeId) {
    var on = String(ch.id) === String(activeId);
    var cls = 'cd-chan cd-chan-' + kindOf(ch) + (on ? ' is-on' : '');
    var link = ctx.link('/c/' + encodeURIComponent(ch.id), '', cls);
    link.appendChild(el('span', { 'class': 'cd-hash', 'aria-hidden': 'true' }, text('#')));
    link.appendChild(el('span', { 'class': 'cd-chan-name' }, text(ch.name || ch.id)));
    if (isReadOnly(ch)) {
      link.appendChild(el('span', { 'class': 'cd-chan-tag' }, text('read-only')));
    } else if (kindOf(ch) === 'announce') {
      link.appendChild(el('span', { 'class': 'cd-chan-tag' }, text('announce')));
    }
    if (on) { link.setAttribute('aria-current', 'page'); }
    return el('li', { 'class': 'cd-chan-row' }, link);
  }

  function rail(ctx, d, list, activeId) {
    var side = el('nav', { 'class': 'cd-rail', 'aria-label': 'Channels' });

    side.appendChild(el('div', { 'class': 'cd-rail-h' }, text('Text channels')));

    var ul = el('ul', { 'class': 'cd-chans' });
    var i;
    for (i = 0; i < list.length; i++) { ul.appendChild(railRow(ctx, list[i], activeId)); }
    if (!list.length) {
      ul.appendChild(el('li', { 'class': 'cd-chan-row cd-chan-none' },
        text('no channels')));
    }
    side.appendChild(ul);

    var who = 'guest';
    try {
      var p = (SYNTH.me && SYNTH.me.profile) ? SYNTH.me.profile() : null;
      if (p && p.handle) { who = String(p.handle); }
    } catch (e) { /* no account yet */ }

    var you = el('div', { 'class': 'cd-you' });
    you.appendChild(el('span', { 'class': 'cd-you-ava' }, avatarNode(who)));
    var youText = el('span', { 'class': 'cd-you-text' });
    youText.appendChild(el('span', { 'class': 'cd-you-name' }, text(who)));
    youText.appendChild(el('span', { 'class': 'cd-you-sub' },
      text(who === 'guest' ? 'not signed in' : 'online')));
    you.appendChild(youText);
    side.appendChild(you);

    return side;
  }

  function footer(ctx, d, list) {
    var n = list.length;
    return el('footer', { 'class': 'cd-foot' },
      text((d.serverName || ctx.site.title) + ' · ' + n +
           (n === 1 ? ' channel' : ' channels') + ' · '),
      el('span', { 'class': 'cd-foot-dim' },
        text('invite link expired; ask somebody who is already in'))
    );
  }

  /* ---------- the archive banner ---------- */

  function lastAuthoredAt(ch) {
    var src = (ch && ch.messages) || [];
    var best = null;
    var i;
    for (i = 0; i < src.length; i++) {
      if (!src[i] || typeof src[i] !== 'object') { continue; }
      var t = parseAt(src[i].at);
      if (t !== null && (best === null || t > best)) { best = t; }
    }
    return best;
  }

  /* When the import happened. The data may say; if it does not, the date is
   * derived from the last message plus a few weeks, which is how long it
   * actually takes somebody to get round to exporting a board after it dies.
   * Modulo, never a signed shift -- hash32 is a uint32. */
  function importedAt(ctx, ch) {
    var given = parseAt(ch.importedAt);
    if (given !== null) { return given; }
    var last = lastAuthoredAt(ch);
    if (last === null) { return null; }
    var days = 21 + (hash32('import:' + ctx.site.domain + ':' + ch.id) % 61);
    return last + days * DAY_MS;
  }

  function archiveBanner(ctx, ch) {
    var box = el('div', { 'class': 'cd-arch', role: 'note' });

    box.appendChild(el('div', { 'class': 'cd-arch-h' }, text('Archived · read-only')));

    var when = importedAt(ctx, ch);
    var from = trim(ch.importedFrom);
    var line1 = 'Imported from ' + (from || 'the old board');
    if (when !== null) {
      line1 += ' on ' + dayLabel(when) + '.';
    } else {
      line1 += '. The pinned post that said when did not come across either.';
    }
    box.appendChild(el('p', { 'class': 'cd-arch-p' }, text(line1)));

    box.appendChild(el('p', { 'class': 'cd-arch-p' },
      text('Attachments did not survive the import. Where somebody posted a '
         + 'picture there is a filename and nothing behind it.')));

    var count = ((ch && ch.messages) || []).length;
    var first = null;
    var i;
    var src = (ch && ch.messages) || [];
    for (i = 0; i < src.length; i++) {
      var t = src[i] && typeof src[i] === 'object' ? parseAt(src[i].at) : null;
      if (t !== null) { first = t; break; }
    }
    var last = lastAuthoredAt(ch);
    var span = '';
    if (first !== null && last !== null) {
      span = dayLabel(first) === dayLabel(last)
        ? dayLabel(first)
        : dayLabel(first) + ' – ' + dayLabel(last);
    }
    box.appendChild(el('p', { 'class': 'cd-arch-meta' },
      text(count + (count === 1 ? ' message' : ' messages') + (span ? ' · ' + span : ''))));

    return box;
  }

  /* Everyone who has said something in a channel that still takes messages.
   * A name in the archive that is not in here belongs to somebody who did
   * not come across with the export, or came across and stopped. The page
   * does not say that anywhere; it just tags the name. */
  function stillHere(list) {
    var seen = {};
    var i, j;
    for (i = 0; i < list.length; i++) {
      if (isReadOnly(list[i])) { continue; }
      var src = list[i].messages || [];
      for (j = 0; j < src.length; j++) {
        if (src[j] && typeof src[j] === 'object') {
          var who = trim(src[j].by);
          if (who) { seen[who] = 1; }
        }
      }
    }
    return seen;
  }

  /* ---------- the river ---------- */

  function replyChip(ctx, r) {
    var chip = el('div', { 'class': 'cd-reply' });
    chip.appendChild(el('span', { 'class': 'cd-reply-arrow', 'aria-hidden': 'true' }, text('↱')));
    chip.appendChild(el('span', { 'class': 'cd-reply-who' }, text('@' + r.by)));
    var q = trim(strip(r.body));
    if (!q) {
      chip.appendChild(el('span', { 'class': 'cd-reply-gone' },
        text('message not in the export')));
    } else {
      if (q.length > 74) { q = trim(q.slice(0, 71)) + '…'; }
      chip.appendChild(el('span', { 'class': 'cd-reply-q' }, text(q)));
    }
    return chip;
  }

  function stampNode(g) {
    if (g.at === null || g.at === undefined) {
      return el('span', { 'class': 'cd-when' }, text('no timestamp'));
    }
    var old = (nowMs() - g.at) > ABSOLUTE_AFTER_MS;
    if (old) {
      /* No data-lv-ago: the heartbeat would repaint this as "14 Mar" and
       * drop the year, and the year is the only interesting part. */
      return el('span', { 'class': 'cd-when' }, text(longDateText(g.at)));
    }
    return el('span', {
      'class': 'cd-when',
      'data-lv-ago': String(g.at),
      title: longDateText(g.at)
    }, text(agoText(g.at)));
  }

  function groupNode(ctx, ch, g, showLeft) {
    var dead = isReadOnly(ch);
    var row = el('li', { 'class': 'cd-grp' + (g.mine ? ' cd-grp-mine' : '') });

    row.appendChild(el('span', { 'class': 'cd-ava' }, avatarNode(g.by)));

    var main = el('div', { 'class': 'cd-grp-main' });

    if (g.replyTo) { main.appendChild(replyChip(ctx, g.replyTo)); }

    var head = el('div', { 'class': 'cd-grp-head' });
    head.appendChild(el('span', { 'class': 'cd-who' }, text(g.by)));
    if (showLeft) {
      head.appendChild(el('span', { 'class': 'cd-left' }, text('left the server')));
    }
    var b = badge(g.kind);
    if (b) { head.appendChild(b); }
    head.appendChild(stampNode(g));
    main.appendChild(head);

    var i;
    for (i = 0; i < g.lines.length; i++) {
      var line = el('div', { 'class': 'cd-line' });
      bodyInto(ctx, line, g.lines[i].body, dead);
      main.appendChild(line);
    }

    row.appendChild(main);
    return row;
  }

  function riverNode(ctx, ch, groups, here) {
    var list = el('ul', { 'class': 'cd-msgs' });
    var lastDay = null;
    var dead = isReadOnly(ch);
    /* The tag goes on a name the first time it comes up and not again. Once
     * per person is the fact; once per block is nagging. */
    var tagged = {};
    var i;
    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (g.at !== null && g.at !== undefined) {
        var key = dayKey(g.at);
        if (key !== lastDay) {
          lastDay = key;
          list.appendChild(el('li', { 'class': 'cd-day' },
            el('span', { 'class': 'cd-day-label' }, text(dayLabel(g.at)))));
        }
      }
      var showLeft = dead && here &&
        !Object.prototype.hasOwnProperty.call(here, g.by) &&
        !Object.prototype.hasOwnProperty.call(tagged, g.by);
      if (showLeft) { tagged[g.by] = 1; }
      list.appendChild(groupNode(ctx, ch, g, showLeft));
    }
    if (!groups.length) {
      list.appendChild(el('li', { 'class': 'cd-empty' },
        text('Nothing has ever been posted in this channel. Somebody made it '
           + 'for a thing that then happened somewhere else.')));
    }
    return list;
  }

  /* ---------- typing ---------- */

  function typingNode(ctx, ch) {
    if (isReadOnly(ch)) {
      var last = lastAuthoredAt(ch);
      return el('div', { 'class': 'cd-typing cd-typing-off' },
        text(last === null
          ? 'Nobody is typing. Nobody can.'
          : 'Nobody is typing. The last thing said in here was ' + dayLabel(last) + '.'));
    }

    if (!has('live') || !SYNTH.live.rng || !SYNTH.live.minutesSinceEpoch) { return null; }

    /* Stable for a couple of minutes at a time, so it does not flicker on
     * every heartbeat, and different the next time you look. */
    var r;
    try {
      r = SYNTH.live.rng(ctx.site.domain + ':typing:' +
                         Math.floor(SYNTH.live.minutesSinceEpoch() / 2));
    } catch (e) { return null; }

    var n = Math.floor(r() * 5);
    if (n < 1) { return null; }

    /* n is seeded per SITE and the name pool is per CHANNEL, and it is NOT
     * clamped to the pool. That looked like a bug and is not one: the river
     * above carries the live stream as well as the authored messages, so
     * the smallest roster any channel on either site renders is twelve
     * names, against a count that never exceeds four.
     *
     * A clamp was written and reverted. It read speakersOf(), which sees
     * the AUTHORED messages only, so on #announce -- one authored poster,
     * a dozen visibly active -- it replaced "3 people are typing" with
     * "mod_dcarver is typing" and was less true than what it replaced.
     *
     * The measurement that made it look wrong pinned the clock to 2025, a
     * year before live.js's own EPOCH, which empties every stream and
     * leaves exactly the authored speaker behind. An instant outside the
     * simulation is not evidence about the simulation. */
    var who = speakersOf(ch);
    var names = [];
    var used = {};
    var guard = 0;
    while (names.length < n && who.length && guard < 24) {
      guard++;
      var name = who[Math.floor(r() * who.length) % who.length];
      if (!Object.prototype.hasOwnProperty.call(used, name)) {
        used[name] = 1;
        names.push(name);
      }
    }

    var label;
    if (n === 1 && names.length === 1) { label = names[0] + ' is typing'; }
    else if (n === 2 && names.length === 2) { label = names[0] + ' and ' + names[1] + ' are typing'; }
    else { label = n + ' people are typing'; }

    var box = el('div', { 'class': 'cd-typing' });
    box.appendChild(el('span', { 'class': 'cd-typing-dots', 'aria-hidden': 'true' },
      el('i', null), el('i', null), el('i', null)));
    box.appendChild(el('span', { 'class': 'cd-typing-text' }, text(label + '…')));
    return box;
  }

  /* ---------- composer ---------- */

  function composer(ctx, ch) {
    if (isReadOnly(ch)) {
      var off = el('div', { 'class': 'cd-composer cd-composer-off' });
      off.appendChild(el('div', { 'class': 'cd-composer-line' },
        text('You do not have permission to send messages in #' + (ch.name || ch.id) + '.')));
      off.appendChild(el('div', { 'class': 'cd-composer-sub' },
        text('Neither does anybody else. Posting was switched off at the import '
           + 'and the account that could switch it back is gone.')));
      return off;
    }

    var box = el('div', { 'class': 'cd-composer' });
    var wired = false;
    if (window.SYNTH && SYNTH.compose && SYNTH.compose.box) {
      try {
        var node = SYNTH.compose.box(ctx, ctx.site.domain, function () {
          if (ctx.rerender) { ctx.rerender(); }
        });
        if (node) { box.appendChild(node); wired = true; }
      } catch (e) { /* composer is optional */ }
    }
    if (!wired) {
      box.appendChild(el('div', { 'class': 'cd-composer-shell' },
        text('Message #' + (ch.name || ch.id))));
    }
    return box;
  }

  /* ---------- pages ---------- */

  function shell(ctx, d, list, activeId, main) {
    var root = el('div', { 'class': 'cd-app' });
    root.appendChild(header(ctx, d));

    var body = el('div', { 'class': 'cd-body' });
    body.appendChild(rail(ctx, d, list, activeId));
    body.appendChild(el('main', { 'class': 'cd-river' }, main));
    root.appendChild(body);

    root.appendChild(footer(ctx, d, list));
    ctx.mount.appendChild(root);
  }

  function topicBar(ctx, ch) {
    var bar = el('div', { 'class': 'cd-topic' });
    var name = el('h1', { 'class': 'cd-topic-name' });
    name.appendChild(el('span', { 'class': 'cd-hash', 'aria-hidden': 'true' }, text('#')));
    name.appendChild(text(ch.name || ch.id));
    bar.appendChild(name);

    var topic = trim(ch.topic);
    if (topic) { bar.appendChild(el('p', { 'class': 'cd-topic-text' }, text(topic))); }

    if (kindOf(ch) === 'announce') {
      bar.appendChild(el('span', { 'class': 'cd-topic-chip' },
        text('announcements only')));
    }
    return bar;
  }

  function pageChannel(ctx, d, list, ch) {
    ctx.title('#' + (ch.name || ch.id) + ' – ' + (d.serverName || ctx.site.title));

    var main = document.createDocumentFragment();
    main.appendChild(topicBar(ctx, ch));
    if (isReadOnly(ch)) { main.appendChild(archiveBanner(ctx, ch)); }

    main.appendChild(riverNode(ctx, ch, groupMessages(riverFor(ctx, ch)),
                               stillHere(list)));

    var typing = typingNode(ctx, ch);
    if (typing) { main.appendChild(typing); }
    main.appendChild(composer(ctx, ch));

    shell(ctx, d, list, ch.id, main);
  }

  function pageNoChannels(ctx, d, list) {
    ctx.title(d.serverName || ctx.site.title);
    var main = document.createDocumentFragment();
    main.appendChild(el('div', { 'class': 'cd-404' },
      el('h1', null, text('Nothing here')),
      el('p', null, text('This server has no channels in it. Somebody deleted '
        + 'the last one to tidy up and the messages went with it, which is '
        + 'what happens when a place has one administrator and no export.'))
    ));
    shell(ctx, d, list, null, main);
  }

  function pageMissing(ctx, d, list, id) {
    ctx.title('Unknown channel – ' + (d.serverName || ctx.site.title));
    var main = document.createDocumentFragment();
    var box = el('div', { 'class': 'cd-404' });
    box.appendChild(el('h1', null, text('No such channel')));
    box.appendChild(el('p', null,
      text('There is no #' + String(id || '') + ' on this server. Channels here '
         + 'get deleted by whoever is awake rather than by a policy, and when '
         + 'one goes the messages in it go too.')));
    var home = landingChannel(list);
    if (home) {
      box.appendChild(ctx.link('/c/' + encodeURIComponent(home.id),
        'Go to #' + (home.name || home.id), 'cd-back'));
    }
    main.appendChild(box);
    shell(ctx, d, list, null, main);
  }

  /* ---------- register ---------- */

  SYNTH.render.register('chat', function (ctx) {
    el = ctx.el;
    var d = (ctx.site && ctx.site.data) || {};
    var p = ctx.path || [];
    var list = channelsOf(d);

    if (!list.length) { return pageNoChannels(ctx, d, list); }

    if (!p.length) {
      /* The root is a channel, the way a chat client is: you do not land on
       * a server, you land in whatever room it drops you in. */
      return pageChannel(ctx, d, list, landingChannel(list));
    }

    if (p[0] === 'c' && p[1]) {
      var ch = byId(list, p[1]);
      if (!ch) { return pageMissing(ctx, d, list, p[1]); }
      return pageChannel(ctx, d, list, ch);
    }

    return pageMissing(ctx, d, list, p.join('/'));
  });
}());
