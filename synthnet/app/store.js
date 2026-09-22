/* store.js -- the only thing in synthnet that remembers anything.
 *
 * Everything else in this project is stateless by design: the live layer is a
 * pure function of the clock, and the sites are read-only files. That stops
 * being enough once you can post, own an account and import content, so this
 * is where persistence lives, and it is deliberately the only place.
 *
 * IndexedDB rather than localStorage. localStorage tops out around 5 MB, which
 * a couple of content packs will exceed, and its failure mode is a synchronous
 * throw halfway through a write -- so an import would fail with half the pack
 * stored and no way to tell. IndexedDB is asynchronous, has a real quota, and
 * fails as a rejected promise you can report.
 *
 * One object store, compound string keys of "collection:key". Separate stores
 * would mean a version migration every time a collection is added, and this
 * project does not need that ceremony.
 *
 * Degrades rather than dies: in a private window, with storage blocked, or in
 * the rare browser that refuses the open, every call resolves against an
 * in-memory map instead. You can still post; it just will not be there
 * tomorrow. SYNTH.store.durable() reports which of those you are in, so the UI
 * can say so plainly rather than silently losing work.
 */
(function () {
  'use strict';

  window.SYNTH = window.SYNTH || {};

  var DB_NAME = 'synthnet';
  var DB_VERSION = 1;
  var STORE = 'kv';

  var db = null;
  var durable = false;
  var memory = {};        /* the fallback, and the write-through cache */
  var openPromise = null;

  function compound(collection, key) {
    return String(collection) + ':' + String(key);
  }

  function open() {
    if (openPromise) return openPromise;

    openPromise = new Promise(function (resolve) {
      var req;
      try {
        if (!window.indexedDB) { resolve(false); return; }
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        // Private windows and blocked-storage settings throw here rather than
        // returning an error, so this catch is load-bearing.
        resolve(false);
        return;
      }

      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        db = req.result;
        durable = true;
        resolve(true);
      };
      req.onerror = function () { resolve(false); };
      req.onblocked = function () { resolve(false); };

      // Some environments never fire any of the above. Without this the whole
      // app would sit waiting on a promise that never settles, which looks
      // exactly like a hang.
      setTimeout(function () { resolve(durable); }, 2500);
    }).then(function (ok) {
      if (!ok) return false;
      return loadAllIntoMemory().then(function () { return true; });
    });

    return openPromise;
  }

  /* Read the whole store into memory once at boot.
   *
   * The data is small (an account, some posts, a few packs) and this buys
   * synchronous reads everywhere else, which matters because renderers build
   * DOM synchronously and cannot await. Writes go to both. */
  function loadAllIntoMemory() {
    return new Promise(function (resolve) {
      var tx, os, req;
      try {
        tx = db.transaction(STORE, 'readonly');
        os = tx.objectStore(STORE);
        req = os.openCursor();
      } catch (e) { resolve(); return; }

      req.onsuccess = function () {
        var cur = req.result;
        if (!cur) { resolve(); return; }
        memory[cur.key] = cur.value;
        cur.continue();
      };
      req.onerror = function () { resolve(); };
    });
  }

  function write(key, value) {
    memory[key] = value;
    if (!durable || !db) return Promise.resolve(false);
    return new Promise(function (resolve, reject) {
      var tx, req;
      try {
        tx = db.transaction(STORE, 'readwrite');
        req = tx.objectStore(STORE).put(value, key);
      } catch (e) { reject(e); return; }
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () {
        // The common real failure is QuotaExceededError on a big pack import.
        reject(req.error || new Error('write failed'));
      };
    });
  }

  function remove(key) {
    delete memory[key];
    if (!durable || !db) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var tx, req;
      try {
        tx = db.transaction(STORE, 'readwrite');
        req = tx.objectStore(STORE).delete(key);
      } catch (e) { resolve(false); return; }
      req.onsuccess = function () { resolve(true); };
      req.onerror = function () { resolve(false); };
    });
  }

  SYNTH.store = {
    /* Resolves once storage is open (or has failed over to memory). Nothing
     * should read before this settles; SYNTH.me.ready chains off it. */
    ready: function () { return open(); },

    /* True when writes survive a restart. False in a private window. */
    durable: function () { return durable; },

    /* Synchronous, from the in-memory mirror. Safe inside a renderer. */
    get: function (collection, key, fallback) {
      var v = memory[compound(collection, key)];
      return v === undefined ? (fallback === undefined ? null : fallback) : v;
    },

    /* Every collection that actually holds something, name order unspecified.
     *
     * control.js has probed for this since the storage screen was written --
     * `if (typeof S.store.collections === 'function')` -- and it has never
     * existed, so every caller fell through to a hand-written list of
     * nineteen guesses. Measured against what is really written: three of
     * the nineteen are real, sixteen name nothing, and eleven real
     * collections are absent. The Wipe button walked that list, so it left
     * the profile, the visit records, the subscriptions, the bot extensions,
     * the shop carts, the assistant transcripts and all four stream
     * collections exactly where they were, and said it had deleted
     * everything.
     *
     * The keyspace is flat -- 'collection:key' -- so the names were always
     * one split away. Nothing here needed a list; it needed asking. */
    collections: function () {
      var seen = {};
      var out = [];
      for (var k in memory) {
        if (!Object.prototype.hasOwnProperty.call(memory, k)) continue;
        var cut = k.indexOf(':');
        if (cut <= 0) continue;
        var name = k.slice(0, cut);
        if (seen[name]) continue;
        seen[name] = 1;
        out.push(name);
      }
      return out;
    },

    /* Every value in a collection, as [{key, value}], key order unspecified. */
    all: function (collection) {
      var prefix = String(collection) + ':';
      var out = [];
      for (var k in memory) {
        if (!Object.prototype.hasOwnProperty.call(memory, k)) continue;
        if (k.indexOf(prefix) !== 0) continue;
        out.push({ key: k.slice(prefix.length), value: memory[k] });
      }
      return out;
    },

    /* Returns a promise, but the in-memory mirror is updated synchronously
     * first, so a renderer can write and immediately re-read. */
    put: function (collection, key, value) {
      return write(compound(collection, key), value);
    },

    del: function (collection, key) {
      return remove(compound(collection, key));
    },

    clear: function (collection) {
      var rows = SYNTH.store.all(collection);
      return Promise.all(rows.map(function (r) {
        return remove(compound(collection, r.key));
      }));
    },

    /* Rough byte size of what is stored, for the storage screen to show. */
    usage: function () {
      var n = 0;
      for (var k in memory) {
        if (!Object.prototype.hasOwnProperty.call(memory, k)) continue;
        try { n += k.length + JSON.stringify(memory[k]).length; } catch (e) {}
      }
      return n;
    },

    /* Used by the pack round-trip test and the "reset everything" button. */
    wipe: function () {
      memory = {};
      if (!durable || !db) return Promise.resolve(false);
      return new Promise(function (resolve) {
        var tx, req;
        try {
          tx = db.transaction(STORE, 'readwrite');
          req = tx.objectStore(STORE).clear();
        } catch (e) { resolve(false); return; }
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { resolve(false); };
      });
    }
  };
})();
