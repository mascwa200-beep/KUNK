/* packs.js -- content you added, and content you imported.
 *
 * This is what makes the synthnet extensible without rebuilding the app. A
 * pack is one JSON file holding sites, bot personas, ads and posts. Import it
 * and its sites appear in the registry, in search, and at their own
 * synth:// addresses, permanently, exactly like the built-in ones.
 *
 * There is no download step and there never will be: the app holds no network
 * permission. A pack arrives as a file you pick, which is why MainActivity
 * needs a WebChromeClient -- see android/src/.../MainActivity.java. In served
 * and standalone modes the plain file input works with nothing added.
 *
 * PACK FORMAT (v1)
 * {
 *   "pack": 1,
 *   "id": "verity-2026",            // stable; re-importing replaces
 *   "name": "Verity County 2026",
 *   "author": "...",
 *   "created": "2026-09-19",
 *   "sites":   [ <site.json objects, exactly the docs/AUTHORING.md shape> ],
 *   "slop":    { "socialPosts": [...], "ads": [...], ... },   // optional
 *   "replies": [ ... ]              // optional, extends the bot corpus
 * }
 *
 * Precedence, lowest to highest: built-in content, then packs in import
 * order, then anything you authored yourself. So a pack can replace a
 * built-in site by using its domain, and your own edits always win.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  var COL = 'packs';
  var MINE = 'mysites';

  function store() { return SYNTH.store; }

  function asArray(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v : []; }

  /* --- validation -------------------------------------------------------
   * Deliberately strict about structure and silent about taste. A pack that
   * would break a renderer is rejected with a reason; a pack that is merely
   * boring is fine. */

  var TYPES = ['forum', 'social', 'blog', 'news', 'wiki', 'media', 'page',
               'aggregator', 'shop', 'assistant', 'qa', 'mail', 'portal',
               'stream', 'board', 'market', 'dash'];

  function validate(pack) {
    var errors = [];
    if (!pack || typeof pack !== 'object') return ['not a JSON object'];
    if (pack.pack !== 1) errors.push('unsupported pack version: ' + pack.pack);
    if (!pack.id || typeof pack.id !== 'string') errors.push('missing "id"');
    if (!pack.name || typeof pack.name !== 'string') errors.push('missing "name"');

    var sites = asArray(pack.sites);
    var seen = {};
    for (var i = 0; i < sites.length; i++) {
      var s = sites[i], where = 'sites[' + i + ']';
      if (!s || typeof s !== 'object') { errors.push(where + ' is not an object'); continue; }
      if (!s.domain) { errors.push(where + ' has no domain'); continue; }
      if (seen[s.domain]) errors.push(where + ' repeats domain ' + s.domain);
      seen[s.domain] = 1;
      if (TYPES.indexOf(s.type) === -1) {
        errors.push(where + ' (' + s.domain + ') has unknown type ' + JSON.stringify(s.type));
      }
      if (!s.data || typeof s.data !== 'object') {
        errors.push(where + ' (' + s.domain + ') has no data object');
      }
      // The offline rule matters more than anything else here: a pack is the
      // one route by which outside content can enter the app.
      var blob;
      try { blob = JSON.stringify(s); } catch (e) { blob = ''; }
      if (/\bhttps?:\/\//.test(blob.replace(/https?:\/\/www\.w3\.org\/[^"]*/g, ''))) {
        errors.push(where + ' (' + s.domain + ') contains an absolute http URL');
      }
    }
    if (!sites.length && !pack.slop && !asArray(pack.replies).length) {
      errors.push('pack contains nothing (no sites, slop or replies)');
    }
    return errors;
  }

  /* --- the merged view -------------------------------------------------- */

  function activePacks() {
    return store().all(COL)
      .map(function (r) { return r.value; })
      .filter(function (p) { return p && p.enabled !== false; })
      .sort(function (a, b) { return (a.importedAt || 0) - (b.importedAt || 0); });
  }

  /* domain -> site, from packs then your own edits. Built-ins are not in
   * here; engine.js consults this first and falls back to them. */
  function overlay() {
    var out = {};
    activePacks().forEach(function (p) {
      asArray(p.sites).forEach(function (s) {
        if (s && s.domain) out[String(s.domain).toLowerCase()] = s;
      });
    });
    store().all(MINE).forEach(function (r) {
      if (r.value && r.value.domain) out[String(r.value.domain).toLowerCase()] = r.value;
    });
    return out;
  }

  function registryRows() {
    var o = overlay();
    var rows = [];
    for (var d in o) {
      if (!Object.prototype.hasOwnProperty.call(o, d)) continue;
      var s = o[d];
      rows.push({
        domain: s.domain,
        title: s.title || s.domain,
        type: s.type,
        era: s.era || '2026',
        skin: s.skin || '',
        description: s.description || '',
        fromPack: true
      });
    }
    return rows;
  }

  /* Extra slop, folded into the live layer's pools at read time. */
  function slopFor(key) {
    var out = [];
    activePacks().forEach(function (p) {
      if (p.slop && asArray(p.slop[key]).length) out = out.concat(asArray(p.slop[key]));
    });
    return out;
  }

  function extraReplies() {
    var out = [];
    activePacks().forEach(function (p) { out = out.concat(asArray(p.replies)); });
    return out;
  }

  /* --- import / export -------------------------------------------------- */

  function importPack(pack) {
    var errors = validate(pack);
    if (errors.length) return Promise.reject(new Error(errors.join('; ')));

    var record = {
      id: pack.id,
      name: pack.name,
      author: pack.author || 'unknown',
      created: pack.created || '',
      importedAt: (SYNTH.live && SYNTH.live.now) ? SYNTH.live.now() : Date.now(),
      enabled: true,
      sites: asArray(pack.sites),
      slop: pack.slop || null,
      replies: asArray(pack.replies)
    };
    return store().put(COL, record.id, record).then(function () {
      invalidate();
      return record;
    });
  }

  function importText(text) {
    var parsed;
    try {
      parsed = JSON.parse(String(text));
    } catch (e) {
      return Promise.reject(new Error('that file is not valid JSON: ' + e.message));
    }
    return importPack(parsed);
  }

  /* Reads a File from an <input type="file">. */
  function importFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('no file chosen')); return; }
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result || '')); };
      fr.onerror = function () { reject(new Error('could not read that file')); };
      try { fr.readAsText(file); } catch (e) { reject(e); }
    }).then(importText);
  }

  function exportPack(opts) {
    opts = opts || {};
    var mine = store().all(MINE).map(function (r) { return r.value; });
    var me = SYNTH.me && SYNTH.me.exportable ? SYNTH.me.exportable() : null;
    return {
      pack: 1,
      id: opts.id || ('mine-' + ((SYNTH.live && SYNTH.live.now ? SYNTH.live.now() : Date.now()))),
      name: opts.name || 'My VerityNet',
      author: (me && me.profile && me.profile.handle) ? me.profile.handle : 'me',
      created: new Date((SYNTH.live && SYNTH.live.now ? SYNTH.live.now() : Date.now())).toISOString().slice(0, 10),
      sites: mine,
      slop: null,
      replies: []
    };
  }

  function invalidate() {
    /* engine.js caches the registry and each site; both must be dropped or an
     * imported pack would not appear until a restart. */
    if (SYNTH.data && SYNTH.data.invalidate) SYNTH.data.invalidate();
  }

  SYNTH.packs = {
    validate: validate,
    list: function () {
      return store().all(COL).map(function (r) { return r.value; })
        .sort(function (a, b) { return (a.importedAt || 0) - (b.importedAt || 0); });
    },
    overlay: overlay,
    registryRows: registryRows,
    slopFor: slopFor,
    extraReplies: extraReplies,
    importPack: importPack,
    importText: importText,
    importFile: importFile,
    exportPack: exportPack,
    setEnabled: function (id, on) {
      var rec = store().get(COL, id, null);
      if (!rec) return Promise.resolve(false);
      rec.enabled = !!on;
      return store().put(COL, id, rec).then(function () { invalidate(); return true; });
    },
    remove: function (id) {
      return store().del(COL, id).then(function () { invalidate(); return true; });
    },

    /* Sites you authored in the app, kept apart from imported ones so an
     * import can never clobber your own work. */
    saveMySite: function (site) {
      if (!site || !site.domain) return Promise.reject(new Error('site needs a domain'));
      return store().put(MINE, String(site.domain).toLowerCase(), site)
        .then(function () { invalidate(); return site; });
    },
    mySites: function () {
      return store().all(MINE).map(function (r) { return r.value; });
    },
    removeMySite: function (domain) {
      return store().del(MINE, String(domain).toLowerCase())
        .then(function () { invalidate(); return true; });
    }
  };
})();
