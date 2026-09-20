/* SYNTHNET - sw.js
 * Cache-first service worker. Precaches the shell, then caches every
 * successful same-origin GET so visited sites keep working offline.
 * Bump CACHE_VERSION to invalidate everything.
 */
'use strict';

var CACHE_VERSION = 'synthnet-v1';

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './theme/aero.css',
  './theme/skins/forum.css',
  './theme/skins/social.css',
  './theme/skins/blog.css',
  './theme/skins/news.css',
  './theme/skins/wiki.css',
  './theme/skins/media.css',
  './theme/skins/page.css',
  './theme/skins/aggregator.css',
  './theme/skins/qa.css',
  './theme/skins/board.css',
  './theme/skins/shop.css',
  './theme/skins/market.css',
  './theme/skins/assistant.css',
  './theme/skins/mail.css',
  './theme/skins/portal.css',
  './theme/skins/stream.css',
  './theme/skins/dash.css',
  './theme/live.css',
  './theme/compose.css',
  './theme/control.css',
  './app/markup.js',
  './app/render.js',
  './app/live.js',
  './app/liveui.js',
  './app/tick.js',
  './app/store.js',
  './app/me.js',
  './app/packs.js',
  './app/bots.js',
  './app/fame.js',
  './app/compose.js',
  './app/control.js',
  './app/slop_social.js',
  './app/slop_forum.js',
  './app/slop_ads.js',
  './app/slop_news.js',
  './app/types/forum.js',
  './app/types/social.js',
  './app/types/blog.js',
  './app/types/news.js',
  './app/types/wiki.js',
  './app/types/media.js',
  './app/types/page.js',
  './app/types/aggregator.js',
  './app/types/qa.js',
  './app/types/board.js',
  './app/types/shop.js',
  './app/types/market.js',
  './app/types/assistant.js',
  './app/types/mail.js',
  './app/types/portal.js',
  './app/types/stream.js',
  './app/types/dash.js',
  './app/engine.js',
  './net/registry.json',
  './net/search.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      /* Add each entry on its own so one missing optional file (a theme
         variant, a manifest spelling) cannot fail the whole install. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
          return cache.add(url).catch(function () { return null; });
        });
      }));
    }).then(function () {
      return self.skipWaiting();
    }).catch(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VERSION) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    }).catch(function () { return null; })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (!req || req.method !== 'GET') return;

  var sameOrigin = false;
  try {
    sameOrigin = (new URL(req.url).origin === self.location.origin);
  } catch (e) {
    sameOrigin = false;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      if (hit) return hit;

      return fetch(req).then(function (res) {
        if (sameOrigin && res && res.ok && (res.type === 'basic' || res.type === 'default')) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            return cache.put(req, copy);
          }).catch(function () { return null; });
        }
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') {
          return caches.match('./index.html').then(function (shell) {
            return shell || new Response(
              'Offline and this page was never cached.',
              { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            );
          });
        }
        return caches.match(req, { ignoreSearch: true }).then(function (loose) {
          return loose || new Response(
            'Offline and this resource was never cached.',
            { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
          );
        });
      });
    })
  );
});

self.addEventListener('message', function (event) {
  if (event && event.data === 'synth-skip-waiting') self.skipWaiting();
});
