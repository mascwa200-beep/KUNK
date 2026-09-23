/* SYNTHNET - app/render.js
 * SYNTH.el() DOM builder + the per-type renderer dispatcher.
 * Classic script. No modules, no network, no innerHTML.
 */
window.SYNTH = window.SYNTH || {};
(function () {
  'use strict';

  var SYNTH = window.SYNTH;

  var BOOL_ATTRS = {
    disabled: 1, checked: 1, selected: 1, readonly: 1, multiple: 1,
    required: 1, hidden: 1, open: 1, autofocus: 1, novalidate: 1, controls: 1
  };

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function isPlainAttrs(v) {
    return !!v && typeof v === 'object' && !v.nodeType && !Array.isArray(v);
  }

  function appendChild(parent, child) {
    if (child === null || child === undefined || child === false || child === true) return;
    if (Array.isArray(child)) {
      for (var i = 0; i < child.length; i++) appendChild(parent, child[i]);
      return;
    }
    if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
      return;
    }
    if (child.nodeType) { parent.appendChild(child); return; }
    parent.appendChild(document.createTextNode(String(child)));
  }

  /* el(tag, attrs, ...children) */
  function el(tag, attrs) {
    var node = document.createElement(tag || 'div');
    var start = 2;

    if (isPlainAttrs(attrs)) {
      for (var key in attrs) {
        if (!hasOwn(attrs, key)) continue;
        var v = attrs[key];
        if (v === null || v === undefined || v === false) continue;

        if (key === 'class' || key === 'className') {
          node.setAttribute('class', String(v));
        } else if (key === 'style') {
          if (typeof v === 'string') {
            node.style.cssText = v;
          } else if (typeof v === 'object') {
            for (var sk in v) {
              if (!hasOwn(v, sk)) continue;
              try { node.style[sk] = v[sk]; } catch (e1) { /* ignore */ }
            }
          }
        } else if (key === 'dataset') {
          if (typeof v === 'object') {
            for (var dk in v) {
              if (!hasOwn(v, dk) || v[dk] === null || v[dk] === undefined) continue;
              try { node.dataset[dk] = String(v[dk]); }
              catch (e2) { node.setAttribute('data-' + dk.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }), String(v[dk])); }
            }
          }
        } else if (key.length > 2 && key.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), v, false);
        } else if (key === 'text') {
          node.appendChild(document.createTextNode(String(v)));
        } else if (key === 'value') {
          try { node.value = v; } catch (e3) { /* ignore */ }
          node.setAttribute('value', String(v));
        } else if (v === true) {
          node.setAttribute(key, hasOwn(BOOL_ATTRS, key) ? key : '');
        } else {
          node.setAttribute(key, String(v));
        }
      }
    } else if (attrs !== null && attrs !== undefined) {
      start = 1;
    }

    for (var a = start; a < arguments.length; a++) appendChild(node, arguments[a]);
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* dispatcher                                                          */
  /* ------------------------------------------------------------------ */

  var renderers = {};

  function register(type, fn) {
    if (!type || typeof fn !== 'function') return;
    renderers[String(type)] = fn;
  }

  function has(type) {
    return hasOwn(renderers, String(type));
  }

  /* ------------------------------------------------------------------ */
  /* loading a type on demand                                            */
  /* ------------------------------------------------------------------ */
  /*
   * index.html used to carry all twenty renderers and all twenty skin
   * stylesheets, render-blocking, on every page. See app/loadmap.js for the
   * measurement. They are fetched when a page of that type is opened now.
   *
   * THE WHOLE TRICK IS has(). In the standalone single-file build every
   * renderer is inlined and has therefore already registered, so has() is
   * true, ensure() resolves without touching the network, and nothing has
   * to know which mode it is running in. The skin half works the same way
   * through the data-synth-skin marker, which tools/build.py stamps onto
   * each inlined <style> and this file stamps onto each injected <link>.
   * One code path, two modes, no flag -- which matters because the reason
   * this was not done sooner was the belief that it would cost the
   * standalone build.
   *
   * ensure() NEVER REJECTS. A renderer that fails to load resolves anyway
   * and render() below draws its "Unsupported site type" notice, which is a
   * legible page. A rejected promise here would be a blank browser.
   */

  var pending = {};   /* type -> Promise, so two navigations share one fetch */

  function entryFor(type) {
    var map = SYNTH.loadmap;
    return (map && hasOwn(map, type)) ? map[type] : null;
  }

  /* A <link> that never fires either event would hang the navigation
     forever, and a page drawn unstyled beats a browser that never paints.
     Chromium fires onload; this is the insurance, not the plan. */
  var SKIN_WAIT_MS = 2000;

  function ensureSkin(type, href) {
    if (!href) return Promise.resolve(false);
    if (hasOwn(pending, 'css:' + type)) return pending['css:' + type];
    /* Already inlined by the standalone build, or already injected here. */
    if (document.querySelector('[data-synth-skin="' + type + '"]')) {
      return Promise.resolve(true);
    }
    pending['css:' + type] = new Promise(function (resolve) {
      var done = false;
      function settle(ok) { if (!done) { done = true; resolve(ok); } }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-synth-skin', type);
      link.onload = function () { settle(true); };
      link.onerror = function () { settle(false); };
      document.head.appendChild(link);
      setTimeout(function () { settle(false); }, SKIN_WAIT_MS);
    });
    return pending['css:' + type];
  }

  function ensureScript(type, src) {
    if (has(type)) return Promise.resolve(true);
    if (!src) return Promise.resolve(false);
    if (hasOwn(pending, 'js:' + type)) return pending['js:' + type];
    pending['js:' + type] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src;
      /* Keep execution ordered against anything else injected, so a
         renderer cannot run before a dependency injected just before it. */
      s.async = false;
      s.onload = function () { resolve(has(type)); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return pending['js:' + type];
  }

  /* Resolves once this type can be rendered AND its stylesheet is in the
     document -- both, because drawing before the skin lands is a flash of
     unstyled page, which at 360px also means a horizontal overflow. */
  function ensure(type) {
    var key = String(type || '');
    var entry = entryFor(key);
    if (has(key) && !entry) return Promise.resolve(true);
    if (!entry) return Promise.resolve(false);
    return Promise.all([
      ensureScript(key, entry.js),
      ensureSkin(key, entry.css)
    ]).then(function (both) { return both[0]; });
  }

  /* Every type this app can draw, whether or not it has been loaded yet.
     app/control.js asked for exactly this and there was nothing to ask:
     it probed for list/types/names/registered, found none of them because
     `renderers` is closure-private, and fell back to a hardcoded list that
     had drifted to naming seven types with no renderer. */
  function list() {
    var out = {}, k;
    for (k in renderers) { if (hasOwn(renderers, k)) out[k] = 1; }
    if (SYNTH.loadmap) {
      for (k in SYNTH.loadmap) { if (hasOwn(SYNTH.loadmap, k)) out[k] = 1; }
    }
    return Object.keys(out).sort();
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function noticeBox(cls, heading, lines) {
    var kids = [el('div', { class: 'synth-notice-head' }, heading)];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i]) kids.push(el('div', { class: 'synth-notice-line' }, lines[i]));
    }
    return el('div', { class: 'synth-notice ' + cls, style: bareStyle(cls) }, kids);
  }

  /* Minimal inline styling so these boxes are legible even if no theme
     css has loaded yet. Chrome markup we author ourselves - allowed. */
  function bareStyle(cls) {
    var common = 'font:12px Tahoma,\'Segoe UI\',Verdana,sans-serif;margin:12px;padding:10px 12px;border:1px solid;';
    if (cls === 'synth-notice-error') {
      return common + 'border-color:#c49a9a;background:#fff4f4;color:#5c1a1a;';
    }
    return common + 'border-color:#d4c97a;background:#ffffe1;color:#403c1a;';
  }

  function render(ctx) {
    if (!ctx || !ctx.mount) return;
    var site = ctx.site || {};
    var type = site.type ? String(site.type) : '';
    var fn = hasOwn(renderers, type) ? renderers[type] : null;

    if (!fn) {
      ctx.mount.appendChild(noticeBox(
        'synth-notice-warn',
        'Unsupported site type',
        [
          'This page is of type "' + (type || 'unknown') + '", and no renderer for that type is installed.',
          site.domain ? ('Domain: ' + site.domain) : '',
          'The rest of the browser is unaffected.'
        ]
      ));
      return;
    }

    try {
      fn(ctx);
    } catch (err) {
      if (window.console && console.error) {
        console.error('[synth.render] renderer "' + type + '" failed for ' + (site.domain || '?'), err && err.stack ? err.stack : err);
      }
      ctx.mount.appendChild(noticeBox(
        'synth-notice-error',
        'This page could not be displayed',
        [
          'The "' + (type || 'unknown') + '" renderer stopped with an error.',
          (err && err.message) ? ('Error: ' + err.message) : 'Error: unknown',
          site.domain ? ('Domain: ' + site.domain) : '',
          'Other sites still work - use Back or the address bar.'
        ]
      ));
    }
  }

  SYNTH.el = el;
  SYNTH.render = {
    register: register,
    render: render,
    has: has,
    ensure: ensure,
    list: list,
    clear: clear
  };
})();
