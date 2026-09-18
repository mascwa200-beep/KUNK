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
    clear: clear
  };
})();
