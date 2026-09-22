window.SYNTH = window.SYNTH || {};

/* control.js -- the in-app control panel.
   Reachable at synth://control.verity.net/
   Site type: 'control'.

   This is the only surface in the whole network that can change anything.
   Everything else is read-only fiction; this is where the reader adds to it.
   No innerHTML, ES5 only, no absolute web URLs. */

(function () {
  'use strict';

  var S = window.SYNTH;
  if (!S || !S.render || !S.render.register) { return; }

  /* ---------------------------------------------------------------- utils */

  function el() { return S.el.apply(null, arguments); }

  function clear(node) {
    if (!node) { return; }
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function setHidden(node, hidden) {
    if (!node) { return; }
    if (hidden) { node.setAttribute('hidden', 'hidden'); }
    else { node.removeAttribute('hidden'); }
  }

  /* Accept either a plain value or a thenable, uniformly.
     cb(err, value). Never throws at the call site. */
  function settle(maker, cb) {
    var v;
    try { v = (typeof maker === 'function') ? maker() : maker; }
    catch (e) { cb(e, null); return; }
    if (v && typeof v.then === 'function') {
      try {
        v.then(function (r) { cb(null, r); }, function (e) { cb(e || new Error('failed'), null); });
      } catch (e2) { cb(e2, null); }
      return;
    }
    cb(null, v);
  }

  /* Pull a readable list of message strings out of whatever an API threw. */
  function messages(err) {
    var out = [];
    var i;
    if (!err) { return ['Unknown error.']; }
    if (typeof err === 'string') { return [err]; }
    if (Object.prototype.toString.call(err) === '[object Array]') {
      for (i = 0; i < err.length; i++) { out = out.concat(messages(err[i])); }
      return out;
    }
    if (err.errors && err.errors.length) {
      for (i = 0; i < err.errors.length; i++) { out = out.concat(messages(err.errors[i])); }
    }
    if (!out.length && err.message) { out.push(String(err.message)); }
    if (!out.length && err.error) { out = out.concat(messages(err.error)); }
    if (!out.length && err.reason) { out.push(String(err.reason)); }
    if (!out.length) {
      try { out.push(JSON.stringify(err)); } catch (e) { out.push(String(err)); }
    }
    return out;
  }

  function fmtBytes(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) { return 'unknown'; }
    if (n < 1024) { return n + ' B'; }
    if (n < 1024 * 1024) { return (n / 1024).toFixed(1) + ' KB'; }
    if (n < 1024 * 1024 * 1024) { return (n / (1024 * 1024)).toFixed(1) + ' MB'; }
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDate(v) {
    if (v === null || v === undefined || v === '') { return 'unknown'; }
    var d;
    if (typeof v === 'number') { d = new Date(v); }
    else { d = new Date(String(v)); }
    if (!d || isNaN(d.getTime())) { return String(v); }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function firstNum() {
    var i;
    for (i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === 'number' && isFinite(arguments[i])) { return arguments[i]; }
    }
    return null;
  }

  function firstStr() {
    var i;
    for (i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === 'string' && arguments[i] !== '') { return arguments[i]; }
    }
    return null;
  }

  /* ------------------------------------------------------------ fragments */

  function card(titleText, subText) {
    var c = el('section', { 'class': 'cp-card' });
    if (titleText) {
      c.appendChild(el('h2', { 'class': 'cp-card-title' }, titleText));
    }
    if (subText) {
      c.appendChild(el('p', { 'class': 'cp-card-sub' }, subText));
    }
    return c;
  }

  function rows() { return el('dl', { 'class': 'cp-rows' }); }

  function row(list, label, value, cls) {
    list.appendChild(el('dt', { 'class': 'cp-rows-k' }, label));
    var dd = el('dd', { 'class': 'cp-rows-v' + (cls ? ' ' + cls : '') });
    if (value && value.nodeType) { dd.appendChild(value); }
    else { dd.appendChild(document.createTextNode(value === null || value === undefined ? '--' : String(value))); }
    list.appendChild(dd);
    return dd;
  }

  function button(label, cls, onClick) {
    var b = el('button', { 'type': 'button', 'class': 'cp-btn' + (cls ? ' ' + cls : '') }, label);
    b.onclick = onClick;
    return b;
  }

  function note(kind, lines) {
    var box = el('div', { 'class': 'cp-note cp-note-' + kind, 'role': 'status' });
    var i;
    for (i = 0; i < lines.length; i++) {
      box.appendChild(el('p', { 'class': 'cp-note-line' }, String(lines[i])));
    }
    return box;
  }

  function say(slot, kind, lines) {
    clear(slot);
    slot.appendChild(note(kind, lines));
  }

  function field(labelText, control, hintText) {
    var wrap = el('div', { 'class': 'cp-field' });
    var id = 'cp-f-' + Math.floor(Math.random() * 1e9).toString(36);
    control.setAttribute('id', id);
    wrap.appendChild(el('label', { 'class': 'cp-label', 'for': id }, labelText));
    wrap.appendChild(control);
    if (hintText) { wrap.appendChild(el('p', { 'class': 'cp-hint' }, hintText)); }
    return wrap;
  }

  function input(type, value, attrs) {
    var a = { 'type': type, 'class': 'cp-input' };
    var k;
    if (attrs) { for (k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) { a[k] = attrs[k]; } } }
    var node = el('input', a);
    if (value !== null && value !== undefined) { node.value = String(value); }
    return node;
  }

  function textarea(value, rowsN, attrs) {
    var a = { 'class': 'cp-textarea', 'rows': String(rowsN || 6) };
    var k;
    if (attrs) { for (k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) { a[k] = attrs[k]; } } }
    var node = el('textarea', a);
    node.value = (value === null || value === undefined) ? '' : String(value);
    return node;
  }

  /* Two-stage, in-page confirm. No window.confirm anywhere in this file.
     stages: array of button labels; the last one performs the action. */
  function confirmChain(stages, cls, onGo) {
    var wrap = el('div', { 'class': 'cp-confirm' });
    var step = 0;
    var go = el('button', { 'type': 'button', 'class': 'cp-btn ' + (cls || 'cp-btn-danger') }, stages[0]);
    var back = el('button', { 'type': 'button', 'class': 'cp-btn cp-btn-quiet' }, 'Cancel');
    setHidden(back, true);

    function reset() {
      step = 0;
      clear(go); go.appendChild(document.createTextNode(stages[0]));
      go.className = 'cp-btn ' + (cls || 'cp-btn-danger');
      setHidden(back, true);
    }

    go.onclick = function () {
      step++;
      if (step >= stages.length) {
        reset();
        onGo();
        return;
      }
      clear(go); go.appendChild(document.createTextNode(stages[step]));
      go.className = 'cp-btn cp-btn-danger cp-btn-armed';
      setHidden(back, false);
    };
    back.onclick = reset;

    wrap.appendChild(go);
    wrap.appendChild(back);
    return wrap;
  }

  /* ------------------------------------------------------------- site types */

  /* Every type this app can draw.
   *
   * This used to guess. It probed S.render for a list/types/names/registered
   * function and then for a renderers/registry/map object, and app/render.js
   * exported none of them -- the map is closure-private -- so both probes
   * failed every single time and it returned a hardcoded fallback list.
   *
   * That list had drifted. It offered homepage, search, directory,
   * guestbook, webring, gallery and archive, none of which have a renderer,
   * and left out page, aggregator, qa, market, assistant, mail, portal,
   * stream, dash, wire and newsletter, all of which do. The authoring form
   * below has been offering seven types that cannot render, under a label
   * saying seventeen renderers are installed when there are twenty-one.
   *
   * Nothing caught it because a fallback that always fires looks exactly
   * like a fallback that never does.
   *
   * There is a real answer now: app/render.js exports list(), which is the
   * union of what has registered and what app/loadmap.js can still load.
   * If it ever returns nothing, that is worth seeing on the page rather
   * than papering over with a list that was wrong for a year.
   */
  function knownTypes() {
    var got = (S.render && typeof S.render.list === 'function')
      ? S.render.list() : [];
    var i;

    /* normalise entries that came back as objects */
    var out = [];
    var seen = {};
    for (i = 0; i < got.length; i++) {
      var name = got[i];
      if (name && typeof name === 'object') { name = name.type || name.name || name.id; }
      if (typeof name !== 'string' || !name) { continue; }
      if (seen[name]) { continue; }
      seen[name] = 1;
      out.push(name);
    }
    /* The fallback list used to be unioned in here as well, unconditionally,
       so even a probe that worked would still have added homepage, search,
       directory, guestbook, webring, gallery and archive to the menu. Two
       separate reasons the form offered types that cannot render; fixing
       only the probe would have fixed neither. */
    out.sort();
    return out;
  }

  /* GENERATED by tools/build.py from tools/new_site.py's builders. Do not
   * edit by hand; run the build.
   *
   * These were written here, by hand, six of them, and all six were wrong --
   * not stale, wrong. "Insert starter" produced JSON that no renderer reads
   * and that tools/validate.py rejects:
   *
   *   blog    gave  tagline, posts[].title     wants  author, posts
   *   forum   gave  boards[].topics[]          wants  boardName, categories, topics
   *   news    gave  masthead, stories[]        wants  masthead, sections, articles
   *   social  gave  handle, posts[]            wants  profile{handle}, feed, friends
   *   wiki    gave  pages[].slug               wants  articles, categories
   *   homepage -- a type that has not existed since this was `page`
   *
   * and the other fourteen types fell through to `{"intro":"","items":[]}`,
   * which matches nothing at all. The one button in this app whose whole job
   * is to hand you a correct starting point handed you a broken one.
   *
   * new_site.py already holds a body per type that validate.py --strict
   * accepts and that renders, because the scaffolding CLI needs exactly the
   * same thing. One source, two consumers. build.py rewrites the object
   * below the way it already rewrites SHELL and CACHE_VERSION in sw.js. */
  var STARTERS = {
    "aggregator": {
      "boards": [
        {
          "id": "b-main",
          "name": "Main"
        }
      ],
      "links": [
        {
          "boardId": "b-main",
          "by": "poster",
          "comments": [
            {
              "body": "Replace this.",
              "by": "replier"
            }
          ],
          "id": "l-001",
          "points": 12,
          "title": "Something somebody submitted"
        }
      ],
      "siteName": "Your Site"
    },
    "assistant": {
      "canned": [
        {
          "a": "An answer that sounds right. Replace this.",
          "q": "What is this?"
        }
      ],
      "disclaimers": [
        "Your Site can make mistakes. Check important information."
      ],
      "productName": "Your Site"
    },
    "blog": {
      "about": "Replace this about text.",
      "author": "Replace Me",
      "blogroll": [
        {
          "href": "synth://wiki.example/",
          "label": "Verity County Wiki"
        }
      ],
      "posts": [
        {
          "body": "Testing the new setup.\n\nIt seems to work.",
          "comments": [
            {
              "author": "Dana R.",
              "body": "It works.",
              "time": "2004-03-03 08:11"
            }
          ],
          "date": "2004-03-02",
          "id": "b-1",
          "tags": [
            "meta"
          ],
          "title": "First post"
        }
      ],
      "tagline": "A weblog from Verity County."
    },
    "board": {
      "boardName": "Your Site",
      "threads": [
        {
          "body": "And this post.",
          "by": "Anonymous",
          "id": "t-001",
          "posts": [
            {
              "body": "And this reply.",
              "by": "Anonymous"
            }
          ],
          "subject": "Replace this thread"
        }
      ]
    },
    "chat": {
      "channels": [
        {
          "id": "ch-general",
          "messages": [
            {
              "body": "hello",
              "by": "someone"
            }
          ],
          "name": "general",
          "topic": "Anything. Replace this."
        },
        {
          "id": "ch-archive",
          "kind": "archive",
          "messages": [
            {
              "body": "it was all in here",
              "by": "someone"
            }
          ],
          "name": "archive",
          "topic": "Everything that used to be on the board."
        }
      ],
      "serverName": "Your Site"
    },
    "dash": {
      "alerts": [
        {
          "level": "info",
          "text": "Nothing is wrong. Replace this."
        }
      ],
      "place": "Gridfall",
      "siteName": "Your Site",
      "transit": [
        {
          "route": "Route 3",
          "status": "On time"
        }
      ],
      "weather": {
        "days": [
          {
            "day": "Today",
            "summary": "Overcast, turning to rain."
          }
        ],
        "now": "Overcast"
      },
      "widgets": [
        {
          "title": "A Panel"
        }
      ]
    },
    "forum": {
      "boardName": "Your Site",
      "categories": [
        {
          "boards": [
            {
              "desc": "Anything that does not fit elsewhere.",
              "id": "b-general",
              "lastPost": {
                "author": "admin",
                "time": "2004-03-02 19:14"
              },
              "name": "General Discussion",
              "postCount": 1,
              "topicCount": 1
            }
          ],
          "id": "cat-main",
          "name": "Main"
        }
      ],
      "topics": [
        {
          "author": "admin",
          "boardId": "b-general",
          "id": "t-1",
          "locked": true,
          "posts": [
            {
              "author": "admin",
              "authorJoined": "2002-11-04",
              "authorPosts": 1412,
              "authorTitle": "Administrator",
              "avatarSeed": "admin",
              "body": "Keep it civil. No all-caps thread titles.\n\n[b]That means you.[/b]",
              "id": "p-1",
              "signature": "-- the management",
              "time": "2004-03-02 19:14"
            }
          ],
          "replies": 0,
          "sticky": true,
          "time": "2004-03-02 19:14",
          "title": "Board rules - read before posting",
          "views": 214
        }
      ]
    },
    "mail": {
      "account": "you@yoursite",
      "folders": [
        {
          "id": "f-inbox",
          "name": "Inbox"
        }
      ],
      "messages": [
        {
          "body": "And this body.",
          "folderId": "f-inbox",
          "from": "somebody@verity.net",
          "id": "m-001",
          "subject": "Replace this message"
        }
      ]
    },
    "market": {
      "cats": [
        {
          "id": "c-misc",
          "name": "Miscellaneous"
        }
      ],
      "listings": [
        {
          "body": "Collection only. Replace this.",
          "by": "seller",
          "catId": "c-misc",
          "id": "l-001",
          "regionId": "r-gridfall",
          "title": "Something for sale"
        }
      ],
      "regions": [
        {
          "id": "r-gridfall",
          "name": "Gridfall"
        }
      ],
      "siteName": "Your Site"
    },
    "media": {
      "channels": [
        {
          "about": "Clips from around the county.",
          "avatarSeed": "ch1",
          "id": "ch-1",
          "name": "verity_uploads",
          "subscribers": 118
        }
      ],
      "items": [
        {
          "channelId": "ch-1",
          "comments": [
            {
              "author": "danar",
              "body": "turn the radio down",
              "time": "2004-03-04"
            }
          ],
          "description": "Camcorder on the dashboard. Sound is bad.",
          "duration": "6:41",
          "id": "v-1",
          "thumbSeed": "v1",
          "title": "Drive down Route 62 (raw)",
          "uploaded": "2004-03-02",
          "uploader": "verity_uploads",
          "views": 1204
        }
      ],
      "siteName": "Your Site"
    },
    "news": {
      "articles": [
        {
          "body": "The council voted 4-3 to defer a decision on overnight parking on Mill Street.\n\nIt returns in April.",
          "byline": "Staff report",
          "date": "2004-03-02",
          "dek": "Third deferral in as many months.",
          "featured": true,
          "headline": "Council defers parking decision again",
          "id": "a-1",
          "lead": "The council voted 4-3 to defer.",
          "sectionId": "sec-local"
        }
      ],
      "masthead": "Your Site",
      "sections": [
        {
          "id": "sec-local",
          "name": "Local"
        }
      ],
      "slogan": "Serving Verity County since 1974"
    },
    "newsletter": {
      "author": "The Editor",
      "cadence": "Weekly",
      "issues": [
        {
          "date": "2026-01-08",
          "id": "i-001",
          "intro": "What this letter is for. Replace this.",
          "number": 1,
          "sections": [
            {
              "items": [
                {
                  "blurb": "One sentence about it.",
                  "headline": "Something happened"
                }
              ],
              "name": "This week"
            }
          ],
          "subject": "Issue one"
        }
      ],
      "title": "Your Site"
    },
    "page": {
      "navLabel": "Navigation",
      "pages": [
        {
          "blocks": [
            {
              "kind": "heading",
              "level": 1,
              "text": "Your Site"
            },
            {
              "kind": "marquee",
              "text": "*** under construction ***"
            },
            {
              "body": "Welcome to my page. [b]Replace this.[/b]",
              "kind": "text"
            },
            {
              "items": [
                "One",
                "Two"
              ],
              "kind": "list",
              "ordered": false
            },
            {
              "count": 1042,
              "kind": "hitcounter"
            }
          ],
          "id": "index",
          "name": "Home"
        }
      ]
    },
    "portal": {
      "agency": "Your Site",
      "services": [
        {
          "blurb": "One sentence about it. Replace this.",
          "forms": [
            {
              "name": "Form 1A"
            }
          ],
          "id": "s-001",
          "name": "A Service This Office Provides",
          "status": "Open"
        }
      ]
    },
    "qa": {
      "questions": [
        {
          "answers": [
            {
              "body": "Like that.",
              "by": "answerer",
              "votes": 1
            }
          ],
          "body": "Edit the site.json. Replace this.",
          "by": "asker",
          "id": "q-001",
          "tagIds": [
            "t-general"
          ],
          "title": "How do I replace this question?",
          "votes": 3
        }
      ],
      "siteName": "Your Site",
      "tags": [
        {
          "id": "t-general",
          "name": "general"
        }
      ]
    },
    "shop": {
      "categories": [
        {
          "id": "c-main",
          "name": "Everything"
        }
      ],
      "products": [
        {
          "blurb": "One sentence about the thing. Replace this.",
          "categoryId": "c-main",
          "id": "p-001",
          "name": "A thing for sale",
          "price": "19.99",
          "reviews": [
            {
              "body": "It arrived.",
              "by": "buyer",
              "stars": 4
            }
          ]
        }
      ],
      "storeName": "Your Site"
    },
    "social": {
      "feed": [
        {
          "author": "Your Site",
          "avatarSeed": "newuser",
          "body": "first post. still working out how this thing works.",
          "handle": "newuser",
          "id": "s-1",
          "likes": 2,
          "replies": [
            {
              "author": "Dana R.",
              "avatarSeed": "danar",
              "body": "welcome!",
              "handle": "danar",
              "id": "s-1-r1",
              "time": "2004-03-02 20:02"
            }
          ],
          "reposts": 0,
          "time": "2004-03-02 19:14"
        }
      ],
      "friends": [
        {
          "avatarSeed": "danar",
          "displayName": "Dana R.",
          "handle": "danar"
        }
      ],
      "profile": {
        "avatarSeed": "newuser",
        "bio": "Replace this bio.",
        "displayName": "Your Site",
        "followers": 37,
        "following": 41,
        "handle": "newuser",
        "joined": "2004-01-09",
        "location": "Verity County",
        "mood": "ok i guess"
      }
    },
    "stream": {
      "channels": [
        {
          "id": "ch-001",
          "name": "A Channel"
        }
      ],
      "siteName": "Your Site",
      "videos": [
        {
          "channelId": "ch-001",
          "comments": [
            {
              "body": "first",
              "by": "viewer",
              "kind": "human"
            }
          ],
          "description": "What it is about. Replace this.",
          "id": "v-001",
          "title": "A video with a title like this",
          "views": 1204
        }
      ]
    },
    "wiki": {
      "articles": [
        {
          "categories": [
            "cat-places"
          ],
          "id": "verity-county",
          "infobox": {
            "caption": "Verity County",
            "rows": [
              [
                "Seat",
                "Verity"
              ],
              [
                "Founded",
                "1841"
              ]
            ]
          },
          "sections": [
            {
              "body": "Replace this section body.",
              "heading": "History"
            }
          ],
          "seeAlso": [],
          "summary": "A mid-sized inland county. Replace this summary.",
          "title": "Verity County"
        }
      ],
      "categories": [
        {
          "id": "cat-places",
          "name": "Places"
        }
      ],
      "siteName": "Your Site"
    },
    "wire": {
      "agency": "Your Site",
      "bureau": "Gridfall",
      "categories": [
        {
          "id": "cat-county",
          "name": "County"
        }
      ],
      "dispatches": [
        {
          "body": "The rest of it. Replace this.",
          "catId": "cat-county",
          "dateline": "GRIDFALL",
          "id": "d-001",
          "lead": "One sentence that carries the story.",
          "priority": "routine",
          "slug": "REPLACE-THIS"
        }
      ]
    }
  };

  function starterFor(type) {
    var body = STARTERS[type];
    if (!body) {
      /* No starter for a type this build can draw is a build failure, not a
       * thing to paper over with a shape that fits nothing. Say so. */
      return '{\n  "_": "No starter for ' + String(type) +
             '. Run tools/build.py."\n}';
    }
    return JSON.stringify(body, null, 2);
  }

  /* ------------------------------------------------------------ store bits */

  /* What the store actually holds, asked rather than guessed.
   *
   * This used to fall back to nineteen hand-written candidate names, because
   * S.store.collections did not exist -- the probe below was written for a
   * function nobody built, so the fallback was not a fallback, it was the
   * only path. Measured against what is really written: 'posts' and
   * 'mysites' were right, sixteen names matched nothing at all, and eleven
   * live collections were missing -- 'me' (the list said 'profile', but the
   * account is stored as me:profile, so the guess found nothing and the
   * account survived), 'visits', 'subs', 'alertstate', 'bots', 'shopcart',
   * 'assistant', and all four of 'streamsaved', 'streamvotes',
   * 'streamwatch', 'streamautoplay'.
   *
   * That list fed both the Wipe button and the by-collection breakdown, so
   * the button left most of your data in place and the table under-counted
   * it, on the same screen as a total that did not.
   *
   * knownTypes() above settled the same argument the same way: ask the thing
   * that knows, and if it ever answers nothing, let that be visible instead
   * of papering over it with a list that was wrong for a year. */
  function listCollections() {
    if (typeof S.store.collections !== 'function') { return []; }
    try {
      var v = S.store.collections();
      return (v && typeof v.length === 'number') ? v : [];
    } catch (e) {
      return [];
    }
  }

  /* Counted the way store.usage() counts, because both numbers are on this
   * screen at once and they used to disagree twice over: this walked a
   * hand-written list that missed eleven collections, and it measured only
   * the value while usage() measures the compound key as well. The hint
   * under the table blamed "text length, close but not exact" for a gap that
   * was mostly the missing collections. */
  function collectionStat(name) {
    var entries;
    try { entries = S.store.all(name); }
    catch (e) { return null; }
    if (!entries || typeof entries.length !== 'number') { return null; }
    var bytes = 0, i;
    for (i = 0; i < entries.length; i++) {
      try {
        bytes += String(name).length + 1 + String(entries[i].key).length;
        bytes += JSON.stringify(entries[i].value).length;
      }
      catch (e2) { bytes += 0; }
    }
    return { name: name, count: entries.length, bytes: bytes };
  }

  /* -------------------------------------------------------------- chrome */

  var NAV = [
    { path: '', label: 'Overview' },
    { path: 'packs', label: 'Packs' },
    { path: 'compose', label: 'Compose' },
    { path: 'me', label: 'Me' },
    { path: 'storage', label: 'Storage' }
  ];

  function href(ctx, path) {
    return 'synth://' + ctx.site.domain + '/' + (path || '');
  }

  function navBar(ctx, current) {
    var bar = el('nav', { 'class': 'cp-nav', 'aria-label': 'Control panel' });
    var i;
    for (i = 0; i < NAV.length; i++) {
      var item = NAV[i];
      var isHere = (item.path === current);
      if (isHere) {
        bar.appendChild(el('span', { 'class': 'cp-nav-item cp-nav-here', 'aria-current': 'page' }, item.label));
      } else {
        bar.appendChild(ctx.link(href(ctx, item.path), item.label, 'cp-nav-item'));
      }
    }
    return bar;
  }

  function header(ctx, heading, sub) {
    var h = el('header', { 'class': 'cp-head' });
    h.appendChild(el('h1', { 'class': 'cp-title' }, heading));
    if (sub) { h.appendChild(el('p', { 'class': 'cp-sub' }, sub)); }
    return h;
  }

  /* ============================================================= OVERVIEW */

  function screenOverview(ctx, root) {
    ctx.title('Control panel');
    root.appendChild(header(ctx, 'Control panel',
      'Everything on this machine, and the only place you can change any of it.'));
    root.appendChild(navBar(ctx, ''));

    /* --- who you are --- */
    var who = card('You');
    var whoRows = rows();
    who.appendChild(whoRows);
    root.appendChild(who);

    var exists = false;
    try { exists = !!(S.me && S.me.exists && S.me.exists()); } catch (e) { exists = false; }

    if (!exists) {
      row(whoRows, 'Account', 'none yet');
      who.appendChild(el('p', { 'class': 'cp-hint' },
        'You can read the whole network without one. You need an account only to post, and to keep what you post.'));
      who.appendChild(ctx.link(href(ctx, 'me'), 'Create an account', 'cp-btn cp-btn-link'));
    } else {
      var p = null;
      try { p = S.me.profile(); } catch (e2) { p = null; }
      p = p || {};
      row(whoRows, 'Handle', p.handle ? '@' + p.handle : '--');
      row(whoRows, 'Name', p.name || '--');
      row(whoRows, 'Joined', fmtDate(p.joined));
      row(whoRows, 'Posts', num(p.postCount, 0));
      row(whoRows, 'Followers', S.live && S.live.commas ? S.live.commas(num(p.followers, 0)) : num(p.followers, 0));
      if (p.verified || p.verifiedPaid) {
        row(whoRows, 'Verified', p.verifiedPaid ? 'yes (paid tier)' : 'yes');
      }
      who.appendChild(ctx.link(href(ctx, 'me'), 'Edit profile', 'cp-btn cp-btn-link'));
    }

    /* --- storage --- */
    var st = card('Storage');
    var stRows = rows();
    st.appendChild(stRows);
    var usageCell = row(stRows, 'Used', 'checking...');
    var durCell = row(stRows, 'Durable', 'checking...');
    root.appendChild(st);

    settle(function () { return S.store.usage(); }, function (err, u) {
      clear(usageCell);
      if (err) {
        usageCell.appendChild(note('warn', messages(err)));
        return;
      }
      var used = firstNum(u && u.usage, u && u.used, u && u.bytes, typeof u === 'number' ? u : null);
      var quota = firstNum(u && u.quota, u && u.total, u && u.available);
      var text = fmtBytes(used);
      if (quota) { text += ' of ' + fmtBytes(quota); }
      usageCell.appendChild(document.createTextNode(text));
    });

    settle(function () { return S.store.durable(); }, function (err, d) {
      clear(durCell);
      if (err) { durCell.appendChild(note('warn', messages(err))); return; }
      if (d) {
        durCell.appendChild(document.createTextNode('yes -- your data survives restarts'));
      } else {
        durCell.appendChild(note('bad', [
          'No. Nothing you do here will survive a restart.',
          'The browser has refused persistent storage, which nearly always means this is a private or incognito window. Everything -- your account, your posts, any pack you import, any site you write -- lives only until this window closes.',
          'Open the network in a normal window first, then come back.'
        ]));
      }
    });

    /* --- packs --- */
    var pk = card('Packs');
    var pkRows = rows();
    pk.appendChild(pkRows);
    root.appendChild(pk);

    settle(function () { return S.packs.list(); }, function (err, list) {
      if (err) { pk.appendChild(note('bad', messages(err))); return; }
      list = list || [];
      var enabled = 0, sites = 0, i;
      for (i = 0; i < list.length; i++) {
        if (list[i].enabled !== false) { enabled++; }
        var c = packSiteCount(list[i]);
        if (c) { sites += c; }
      }
      row(pkRows, 'Installed', list.length);
      row(pkRows, 'Enabled', enabled);
      row(pkRows, 'Sites added', sites);
      pk.appendChild(ctx.link(href(ctx, 'packs'), 'Manage packs', 'cp-btn cp-btn-link'));
    });

    /* --- your sites --- */
    var mine = card('Your sites');
    root.appendChild(mine);
    settle(function () { return S.packs.mySites(); }, function (err, list) {
      if (err) { mine.appendChild(note('warn', messages(err))); return; }
      list = list || [];
      mine.appendChild(el('p', { 'class': 'cp-card-sub' },
        list.length === 0
          ? 'You have not written any sites yet.'
          : 'You have written ' + list.length + (list.length === 1 ? ' site.' : ' sites.')));
      mine.appendChild(ctx.link(href(ctx, 'compose'), list.length ? 'Open the composer' : 'Write one', 'cp-btn cp-btn-link'));
    });

    /* --- the standing explanation --- */
    var about = card('How this thing works');
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'This app has no network permission. Not a restricted one -- none. It cannot open a socket. Everything you see was either shipped inside the app or came from a file you handed it yourself.'));
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'The whole network ships with the build: 109 sites, of which sixteen are dated 1998 to 2008 and seventy-seven are dated 2026. None of it can be edited. Packs are how it gets BIGGER -- a pack is just a file. Import one and there are more sites. Remove it and the network shrinks back to what shipped.'));
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'Nothing here phones home because there is no home to phone.'));
    root.appendChild(about);
  }

  function packSiteCount(p) {
    if (!p) { return 0; }
    if (typeof p.siteCount === 'number') { return p.siteCount; }
    if (p.sites && typeof p.sites.length === 'number') { return p.sites.length; }
    if (typeof p.count === 'number') { return p.count; }
    return 0;
  }

  /* ================================================================ PACKS */

  function screenPacks(ctx, root) {
    ctx.title('Control panel -- packs');
    root.appendChild(header(ctx, 'Packs', 'Import, enable, remove, export.'));
    root.appendChild(navBar(ctx, 'packs'));

    var tableCard = card('Installed');
    var tableSlot = el('div', { 'class': 'cp-table-slot' });
    tableCard.appendChild(tableSlot);

    /* --- import from a file --- */
    var imp = card('Import a pack',
      'Pick a .json pack file. It is read on this device and never leaves it.');
    var file = el('input', {
      'type': 'file',
      'class': 'cp-file',
      'accept': 'application/json,.json'
    });
    var impStatus = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });

    function doImport(f) {
      if (!f) {
        say(impStatus, 'warn', ['Choose a file first.']);
        return;
      }
      say(impStatus, 'info', ['Reading ' + f.name + '...']);
      settle(function () { return S.packs.importFile(f); }, function (err, res) {
        if (err) {
          reportImportFailure(impStatus, err);
          return;
        }
        reportImportSuccess(impStatus, res, f.name);
        renderPackTable(ctx, tableSlot);
      });
    }

    file.onchange = function () {
      doImport(file.files && file.files[0]);
    };

    imp.appendChild(field('Pack file', file, 'Accepts one .json file at a time.'));
    imp.appendChild(button('Import', 'cp-btn-primary', function () {
      doImport(file.files && file.files[0]);
    }));
    imp.appendChild(impStatus);
    root.appendChild(imp);

    /* --- import from pasted text --- */
    var paste = card('Paste a pack',
      'If someone sent you the JSON as text rather than a file, drop it here.');
    var pasteBox = textarea('', 8, { 'spellcheck': 'false', 'placeholder': '{ "name": "...", "sites": [ ... ] }' });
    var pasteStatus = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    paste.appendChild(field('Pack JSON', pasteBox));
    paste.appendChild(button('Import pasted JSON', 'cp-btn-primary', function () {
      var text = pasteBox.value;
      if (!text || !text.replace(/\s+/g, '')) {
        say(pasteStatus, 'warn', ['Nothing pasted.']);
        return;
      }
      if (typeof S.packs.importText !== 'function') {
        say(pasteStatus, 'bad', ['This build cannot import pasted text. Save it as a .json file and use the file picker above.']);
        return;
      }
      say(pasteStatus, 'info', ['Checking...']);
      settle(function () { return S.packs.importText(text); }, function (err, res) {
        if (err) { reportImportFailure(pasteStatus, err); return; }
        reportImportSuccess(pasteStatus, res, 'pasted text');
        pasteBox.value = '';
        renderPackTable(ctx, tableSlot);
      });
    }));
    paste.appendChild(pasteStatus);
    root.appendChild(paste);

    /* --- installed table --- */
    root.appendChild(tableCard);
    renderPackTable(ctx, tableSlot);

    /* --- export --- */
    root.appendChild(exportCard());

    /* --- explainer --- */
    var about = card('What a pack is');
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'A pack is one JSON file holding one or more sites. Importing it copies it into this app\'s own storage. Nothing is downloaded, because the app cannot download: it holds no network permission at all.'));
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'Packs move the way files move -- a messaging app, a memory card, a cable. The network grows because somebody physically handed you more of it.'));
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'A pack cannot run code. It is data. The renderers that draw it are the ones already in this app, which is why a pack has to name a type the app already knows.'));
    about.appendChild(el('p', { 'class': 'cp-prose' },
      'Disabling a pack hides its sites without deleting them. Removing one deletes it. Neither touches the 109 sites that shipped with the build.'));
    root.appendChild(about);
  }

  function reportImportFailure(slot, err) {
    clear(slot);
    var box = el('div', { 'class': 'cp-note cp-note-bad' });
    box.appendChild(el('p', { 'class': 'cp-note-line cp-note-head' }, 'Import refused. Nothing was changed.'));
    var msgs = messages(err);
    var ul = el('ul', { 'class': 'cp-errlist' });
    var i;
    for (i = 0; i < msgs.length; i++) {
      ul.appendChild(el('li', { 'class': 'cp-errlist-item' }, msgs[i]));
    }
    box.appendChild(ul);
    slot.appendChild(box);
  }

  function reportImportSuccess(slot, res, sourceName) {
    clear(slot);
    res = res || {};
    var pack = res.pack || res;
    var name = firstStr(pack.name, res.name, sourceName) || 'pack';
    var sites = pack.sites || res.sites || [];
    var count = firstNum(res.added, res.siteCount, pack.siteCount, sites && sites.length) || 0;

    var box = el('div', { 'class': 'cp-note cp-note-good' });
    box.appendChild(el('p', { 'class': 'cp-note-line cp-note-head' },
      'Imported "' + name + '" -- ' + count + (count === 1 ? ' site added.' : ' sites added.')));

    if (sites && sites.length) {
      var ul = el('ul', { 'class': 'cp-sitelist' });
      var i;
      for (i = 0; i < sites.length; i++) {
        var s = sites[i];
        var dom = (typeof s === 'string') ? s : (s.domain || s.id || '');
        var title = (typeof s === 'string') ? '' : (s.title || '');
        var li = el('li', { 'class': 'cp-sitelist-item' });
        li.appendChild(el('span', { 'class': 'cp-mono' }, dom));
        if (title) { li.appendChild(el('span', { 'class': 'cp-sitelist-title' }, ' -- ' + title)); }
        ul.appendChild(li);
      }
      box.appendChild(ul);
      box.appendChild(el('p', { 'class': 'cp-note-line' }, 'They are live now. Type the domain into the address bar.'));
    }
    slot.appendChild(box);
  }

  function cell(labelText, content, cls) {
    var td = el('td', { 'class': 'cp-td' + (cls ? ' ' + cls : '') });
    td.appendChild(el('span', { 'class': 'cp-cell-label' }, labelText));
    var body = el('span', { 'class': 'cp-cell-body' });
    if (content && content.nodeType) { body.appendChild(content); }
    else { body.appendChild(document.createTextNode(content === null || content === undefined ? '--' : String(content))); }
    td.appendChild(body);
    return td;
  }

  function renderPackTable(ctx, slot) {
    clear(slot);
    slot.appendChild(el('p', { 'class': 'cp-hint' }, 'Loading...'));

    settle(function () { return S.packs.list(); }, function (err, list) {
      clear(slot);
      if (err) { slot.appendChild(note('bad', messages(err))); return; }
      list = list || [];
      if (!list.length) {
        slot.appendChild(note('info', [
          'No packs installed.',
          'The network still works -- all 109 built-in sites are always there. A pack only ever adds to them.'
        ]));
        return;
      }

      var table = el('table', { 'class': 'cp-table' });
      var thead = el('thead', { 'class': 'cp-thead' });
      var hr = el('tr', { 'class': 'cp-tr' });
      var heads = ['Pack', 'Author', 'Sites', 'Imported', 'Enabled', ''];
      var i;
      for (i = 0; i < heads.length; i++) {
        hr.appendChild(el('th', { 'class': 'cp-th', 'scope': 'col' }, heads[i]));
      }
      thead.appendChild(hr);
      table.appendChild(thead);

      var tbody = el('tbody', { 'class': 'cp-tbody' });
      for (i = 0; i < list.length; i++) {
        tbody.appendChild(packRow(ctx, list[i], slot));
      }
      table.appendChild(tbody);
      slot.appendChild(table);
    });
  }

  function packRow(ctx, p, slot) {
    var id = firstStr(p.id, p.packId, p.name) || '';
    var tr = el('tr', { 'class': 'cp-tr' + (p.enabled === false ? ' cp-tr-off' : '') });

    tr.appendChild(cell('Pack', el('span', { 'class': 'cp-strong' }, p.name || id || 'untitled'), 'cp-td-name'));
    tr.appendChild(cell('Author', p.author || 'unattributed'));
    tr.appendChild(cell('Sites', packSiteCount(p)));
    tr.appendChild(cell('Imported', fmtDate(firstNum(p.importedAt, p.imported, p.at, p.installedAt) || firstStr(p.importedAt, p.imported, p.at, p.installedAt))));

    /* enable toggle */
    var box = el('input', { 'type': 'checkbox', 'class': 'cp-check' });
    box.checked = (p.enabled !== false);
    var toggleWrap = el('span', { 'class': 'cp-toggle' });
    toggleWrap.appendChild(box);
    var toggleMsg = el('span', { 'class': 'cp-toggle-msg' });
    toggleWrap.appendChild(toggleMsg);
    box.onchange = function () {
      var want = box.checked;
      clear(toggleMsg);
      settle(function () { return S.packs.setEnabled(id, want); }, function (err) {
        clear(toggleMsg);
        if (err) {
          box.checked = !want;
          toggleMsg.appendChild(el('span', { 'class': 'cp-inline-bad' }, messages(err)[0]));
          return;
        }
        if (want) { tr.className = 'cp-tr'; } else { tr.className = 'cp-tr cp-tr-off'; }
        toggleMsg.appendChild(el('span', { 'class': 'cp-inline-ok' }, want ? 'on' : 'off'));
      });
    };
    tr.appendChild(cell('Enabled', toggleWrap));

    /* remove, two stages */
    var removeSlot = el('span', { 'class': 'cp-actions' });
    removeSlot.appendChild(confirmChain(['Remove', 'Really remove?'], 'cp-btn-danger', function () {
      clear(removeSlot);
      removeSlot.appendChild(el('span', { 'class': 'cp-hint' }, 'Removing...'));
      settle(function () { return S.packs.remove(id); }, function (err) {
        if (err) {
          clear(removeSlot);
          removeSlot.appendChild(el('span', { 'class': 'cp-inline-bad' }, messages(err)[0]));
          return;
        }
        renderPackTable(ctx, slot);
      });
    }));
    tr.appendChild(cell('', removeSlot, 'cp-td-actions'));

    return tr;
  }

  function exportCard() {
    var c = card('Export',
      'Bundle everything you have made -- your sites, and your account if you have one -- into one pack you can hand to somebody.');
    var out = textarea('', 10, { 'readonly': 'readonly', 'spellcheck': 'false', 'class': 'cp-textarea cp-mono' });
    var outWrap = el('div', { 'class': 'cp-export-out' });
    setHidden(outWrap, true);
    outWrap.appendChild(field('Pack JSON', out, 'Select all and copy, or use the button.'));
    var status = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });

    var copyBtn = button('Copy to clipboard', 'cp-btn-primary', function () {
      var text = out.value;
      if (!text) { say(status, 'warn', ['Nothing to copy yet.']); return; }
      var done = function () { say(status, 'good', ['Copied. ' + text.length + ' characters.']); };
      var fallback = function (why) {
        try {
          out.removeAttribute('readonly');
          out.focus();
          out.setSelectionRange(0, text.length);
          out.select();
          out.setAttribute('readonly', 'readonly');
        } catch (e) { /* selection is best effort */ }
        say(status, 'warn', [
          'The clipboard was not available' + (why ? ' (' + why + ')' : '') + '.',
          'The text is selected -- use long-press, then Copy.'
        ]);
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          navigator.clipboard.writeText(text).then(done, function (e) {
            fallback(messages(e)[0]);
          });
        } catch (e) { fallback(messages(e)[0]); }
      } else {
        fallback('this WebView exposes no clipboard API');
      }
    });
    setHidden(copyBtn, true);

    c.appendChild(button('Build export', 'cp-btn-primary', function () {
      say(status, 'info', ['Building...']);
      settle(function () { return S.packs.exportPack(); }, function (err, res) {
        if (err) { say(status, 'bad', messages(err)); return; }
        var text;
        if (typeof res === 'string') { text = res; }
        else {
          try { text = JSON.stringify(res, null, 2); }
          catch (e) { say(status, 'bad', ['The pack could not be turned into text: ' + messages(e)[0]]); return; }
        }
        out.value = text;
        setHidden(outWrap, false);
        setHidden(copyBtn, false);
        say(status, 'good', ['Ready -- ' + text.length + ' characters.']);
      });
    }));
    c.appendChild(outWrap);
    c.appendChild(copyBtn);
    c.appendChild(status);
    c.appendChild(el('p', { 'class': 'cp-hint' },
      'There is deliberately no download button. Saving a file needs a download handler this app does not have, and adding one would mean adding the thing this whole network exists to do without. Copy the text instead.'));
    return c;
  }

  /* ============================================================== COMPOSE */

  function screenCompose(ctx, root) {
    ctx.title('Control panel -- compose');
    root.appendChild(header(ctx, 'Compose a site',
      'Write a new corner of Verity County. It becomes a real address the moment you save it.'));
    root.appendChild(navBar(ctx, 'compose'));

    var types = knownTypes();

    var form = card('Site');
    var editingNote = el('p', { 'class': 'cp-editing' });
    setHidden(editingNote, true);
    form.appendChild(editingNote);

    var fDomain = input('text', '', { 'placeholder': 'something.verity.net', 'spellcheck': 'false', 'autocapitalize': 'none' });
    var fTitle = input('text', '', { 'placeholder': 'Gridfall Mutual Aid Board' });

    var fType = el('select', { 'class': 'cp-select' });
    var i;
    for (i = 0; i < types.length; i++) {
      var opt = el('option', { 'value': types[i] }, types[i]);
      fType.appendChild(opt);
    }
    fType.value = 'blog';

    var fSkin = input('text', '', { 'placeholder': 'plain', 'spellcheck': 'false' });
    var fDesc = textarea('', 3, { 'placeholder': 'One line for the directory.' });
    var fData = textarea('', 14, { 'spellcheck': 'false', 'class': 'cp-textarea cp-mono' });

    form.appendChild(field('Domain', fDomain, 'No scheme, no slashes. This is what people type.'));
    form.appendChild(field('Title', fTitle));
    form.appendChild(field('Type', fType, types.length + ' renderers are installed. The type decides how the data is drawn.'));
    form.appendChild(field('Skin', fSkin, 'Optional. A skin name the app already ships; leave blank for the default.'));
    form.appendChild(field('Description', fDesc));

    var dataStatus = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    form.appendChild(field('Data (JSON)', fData, 'The whole content of the site. Shape depends on the type.'));

    var dataTools = el('div', { 'class': 'cp-btnrow' });
    dataTools.appendChild(button('Check JSON', 'cp-btn-quiet', function () {
      checkJSON(fData.value, dataStatus, true);
    }));
    dataTools.appendChild(button('Insert starter', 'cp-btn-quiet', function () {
      if (fData.value && fData.value.replace(/\s+/g, '')) {
        say(dataStatus, 'warn', ['There is already something in the box. Clear it first if you want the starter.']);
        return;
      }
      fData.value = starterFor(fType.value);
      say(dataStatus, 'info', ['Starter for type "' + fType.value + '" inserted.']);
    }));
    dataTools.appendChild(button('Reformat', 'cp-btn-quiet', function () {
      var parsed = checkJSON(fData.value, dataStatus, false);
      if (!parsed.ok) { say(dataStatus, 'bad', parsed.errors); return; }
      try {
        fData.value = JSON.stringify(parsed.value, null, 2);
        say(dataStatus, 'good', ['Valid JSON, reformatted.']);
      } catch (e) { say(dataStatus, 'bad', messages(e)); }
    }));
    form.appendChild(dataTools);
    form.appendChild(dataStatus);

    var saveStatus = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    var listSlot = el('div', { 'class': 'cp-table-slot' });

    var editingDomain = null;

    function resetForm() {
      editingDomain = null;
      setHidden(editingNote, true);
      fDomain.value = ''; fTitle.value = ''; fSkin.value = '';
      fDesc.value = ''; fData.value = '';
      fType.value = 'blog';
      fDomain.removeAttribute('readonly');
      clear(saveStatus); clear(dataStatus);
    }

    function loadForEdit(site) {
      editingDomain = site.domain;
      clear(editingNote);
      editingNote.appendChild(document.createTextNode('Editing ' + site.domain + '. Saving overwrites it.'));
      setHidden(editingNote, false);
      fDomain.value = site.domain || '';
      fTitle.value = site.title || '';
      fType.value = site.type || 'blog';
      if (fType.value !== (site.type || 'blog')) {
        /* type not in the list -- add it so nothing is silently lost */
        fType.appendChild(el('option', { 'value': site.type }, site.type + ' (unknown)'));
        fType.value = site.type;
      }
      fSkin.value = site.skin || '';
      fDesc.value = site.description || '';
      try { fData.value = JSON.stringify(site.data === undefined ? {} : site.data, null, 2); }
      catch (e) { fData.value = ''; }
      clear(saveStatus); clear(dataStatus);
      if (form.scrollIntoView) { form.scrollIntoView(); }
    }

    var btnRow = el('div', { 'class': 'cp-btnrow' });
    btnRow.appendChild(button('Save site', 'cp-btn-primary', function () {
      var domain = (fDomain.value || '').replace(/^\s+|\s+$/g, '').toLowerCase();
      var problems = [];
      if (!domain) { problems.push('Domain is required.'); }
      else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        problems.push('Domain "' + domain + '" is not a plain host name. Letters, digits, hyphens and dots only, and at least one dot.');
      }
      if (!(fTitle.value || '').replace(/^\s+|\s+$/g, '')) { problems.push('Title is required.'); }
      if (!fType.value) { problems.push('Pick a type.'); }

      var parsed = checkJSON(fData.value, dataStatus, false);
      if (!parsed.ok) { problems = problems.concat(parsed.errors); }

      if (problems.length) { say(saveStatus, 'bad', problems); return; }

      var site = {
        domain: domain,
        title: (fTitle.value || '').replace(/^\s+|\s+$/g, ''),
        type: fType.value,
        description: (fDesc.value || '').replace(/^\s+|\s+$/g, ''),
        data: parsed.value
      };
      var skin = (fSkin.value || '').replace(/^\s+|\s+$/g, '');
      if (skin) { site.skin = skin; }
      if (editingDomain && editingDomain !== domain) { site.replaces = editingDomain; }

      say(saveStatus, 'info', ['Saving...']);
      settle(function () { return S.packs.saveMySite(site); }, function (err) {
        if (err) { say(saveStatus, 'bad', messages(err)); return; }
        say(saveStatus, 'good', [
          'Saved. ' + domain + ' is live -- type it into the address bar.',
          'It goes into your export pack too, so you can pass it on.'
        ]);
        editingDomain = domain;
        clear(editingNote);
        editingNote.appendChild(document.createTextNode('Editing ' + domain + '. Saving overwrites it.'));
        setHidden(editingNote, false);
        renderMySites(ctx, listSlot, loadForEdit);
      });
    }));
    btnRow.appendChild(button('New / clear', 'cp-btn-quiet', resetForm));
    form.appendChild(btnRow);
    form.appendChild(saveStatus);
    root.appendChild(form);

    var mine = card('Your sites');
    mine.appendChild(listSlot);
    root.appendChild(mine);
    renderMySites(ctx, listSlot, loadForEdit);

    var help = card('What the data has to look like');
    help.appendChild(el('p', { 'class': 'cp-prose' },
      'Body text anywhere in the data understands exactly six things and nothing else: [b] [i] [u] [s] for emphasis, [quote=Name] for a quotation, [code] for fixed text, [list][*]item[/list] for a list, [url=synth://wiki.gridfall.net/]label[/url] for a link, and [img:avatar|thumb|photo|banner:seed] for a picture. A blank line starts a paragraph. Anything else you type prints as itself.'));
    help.appendChild(el('p', { 'class': 'cp-prose' },
      'There are no pictures in this app, only generated ones. The seed in an img tag decides what gets drawn; the same seed always draws the same thing.'));
    help.appendChild(el('p', { 'class': 'cp-prose' },
      'If you want your site to connect to the rest of the county, link to it. The archive is still there: the substation fire, the rail branch, the Signal on 62, the Blue Kestrel. Most of what anybody writes in 2026 is about 2003.'));
    root.appendChild(help);
  }

  function checkJSON(text, slot, announce) {
    var raw = (text === null || text === undefined) ? '' : String(text);
    if (!raw.replace(/\s+/g, '')) {
      if (announce) { say(slot, 'warn', ['The data box is empty. Use {} for a site with no content yet.']); }
      return { ok: false, errors: ['Data is empty. Use {} if you mean nothing.'], value: null };
    }
    var value;
    try { value = JSON.parse(raw); }
    catch (e) {
      var msg = messages(e)[0];
      var lines = ['The data is not valid JSON: ' + msg];
      var m = /position\s+(\d+)/i.exec(msg);
      if (m) {
        var pos = parseInt(m[1], 10);
        var before = raw.slice(0, pos);
        var line = before.split('\n').length;
        var col = pos - before.lastIndexOf('\n');
        lines.push('That is line ' + line + ', column ' + col + '.');
        var ctxLine = raw.split('\n')[line - 1];
        if (ctxLine !== undefined) { lines.push(ctxLine.slice(0, 120)); }
      }
      lines.push('Common causes: a trailing comma, a single quote where a double quote belongs, or a missing closing brace.');
      if (announce) { say(slot, 'bad', lines); }
      return { ok: false, errors: lines, value: null };
    }
    if (value === null || typeof value !== 'object') {
      var e2 = ['The data parsed, but it is a ' + (value === null ? 'null' : typeof value) + '. A site\'s data has to be an object or an array.'];
      if (announce) { say(slot, 'bad', e2); }
      return { ok: false, errors: e2, value: null };
    }
    if (announce) {
      var keys = 0, k;
      if (Object.prototype.toString.call(value) === '[object Array]') { keys = value.length; }
      else { for (k in value) { if (Object.prototype.hasOwnProperty.call(value, k)) { keys++; } } }
      say(slot, 'good', ['Valid JSON -- ' + keys + (Object.prototype.toString.call(value) === '[object Array]' ? ' entries.' : ' top-level keys.')]);
    }
    return { ok: true, errors: [], value: value };
  }

  function deleteMySite(domain, cb) {
    var names = ['deleteMySite', 'removeMySite', 'removeSite', 'dropMySite'];
    var i;
    for (i = 0; i < names.length; i++) {
      if (typeof S.packs[names[i]] === 'function') {
        settle(function () { return S.packs[names[i]](domain); }, cb);
        return;
      }
    }
    if (S.store && typeof S.store.del === 'function') {
      settle(function () { return S.store.del('mysites', domain); }, cb);
      return;
    }
    cb(new Error('This build has no way to delete a site you wrote. Overwrite it instead.'), null);
  }

  function renderMySites(ctx, slot, onEdit) {
    clear(slot);
    slot.appendChild(el('p', { 'class': 'cp-hint' }, 'Loading...'));
    settle(function () { return S.packs.mySites(); }, function (err, list) {
      clear(slot);
      if (err) { slot.appendChild(note('bad', messages(err))); return; }
      list = list || [];
      if (!list.length) {
        slot.appendChild(note('info', ['Nothing yet. Fill in the form above and save.']));
        return;
      }
      var table = el('table', { 'class': 'cp-table' });
      var thead = el('thead', { 'class': 'cp-thead' });
      var hr = el('tr', { 'class': 'cp-tr' });
      var heads = ['Domain', 'Title', 'Type', ''];
      var i;
      for (i = 0; i < heads.length; i++) { hr.appendChild(el('th', { 'class': 'cp-th', 'scope': 'col' }, heads[i])); }
      thead.appendChild(hr);
      table.appendChild(thead);
      var tbody = el('tbody', { 'class': 'cp-tbody' });
      for (i = 0; i < list.length; i++) {
        tbody.appendChild(mySiteRow(ctx, list[i], slot, onEdit));
      }
      table.appendChild(tbody);
      slot.appendChild(table);
    });
  }

  function mySiteRow(ctx, site, slot, onEdit) {
    var tr = el('tr', { 'class': 'cp-tr' });
    tr.appendChild(cell('Domain', ctx.link('synth://' + site.domain + '/', site.domain, 'cp-link'), 'cp-td-name'));
    tr.appendChild(cell('Title', site.title || '--'));
    tr.appendChild(cell('Type', el('span', { 'class': 'cp-tag' }, site.type || '?')));

    var actions = el('span', { 'class': 'cp-actions' });
    actions.appendChild(button('Edit', 'cp-btn-quiet', function () { onEdit(site); }));
    var msg = el('span', { 'class': 'cp-actions-msg' });
    actions.appendChild(confirmChain(['Delete', 'Really delete?'], 'cp-btn-danger', function () {
      clear(msg);
      msg.appendChild(el('span', { 'class': 'cp-hint' }, 'Deleting...'));
      deleteMySite(site.domain, function (err) {
        if (err) {
          clear(msg);
          msg.appendChild(el('span', { 'class': 'cp-inline-bad' }, messages(err)[0]));
          return;
        }
        renderMySites(ctx, slot, onEdit);
      });
    }));
    actions.appendChild(msg);
    tr.appendChild(cell('', actions, 'cp-td-actions'));
    return tr;
  }

  /* =================================================================== ME */

  function screenMe(ctx, root) {
    ctx.title('Control panel -- you');
    root.appendChild(header(ctx, 'You', 'One account, kept on this device, visible to nobody.'));
    root.appendChild(navBar(ctx, 'me'));

    var exists = false;
    try { exists = !!(S.me && S.me.exists && S.me.exists()); } catch (e) { exists = false; }

    if (!exists) {
      root.appendChild(signUpCard(ctx, root));
      return;
    }

    var p = {};
    try { p = S.me.profile() || {}; } catch (e2) { p = {}; }

    /* --- profile editor --- */
    var c = card('Profile');
    var fHandle = input('text', p.handle || '', { 'spellcheck': 'false', 'autocapitalize': 'none', 'maxlength': '24' });
    var fName = input('text', p.name || '', { 'maxlength': '48' });
    var fBio = textarea(p.bio || '', 4, { 'maxlength': '400' });
    var fSeed = input('text', p.avatarSeed || p.handle || '', { 'spellcheck': 'false' });

    var avatarSlot = el('div', { 'class': 'cp-avatar' });
    function drawAvatar() {
      clear(avatarSlot);
      try {
        var n = S.markup.placeholder('avatar', fSeed.value || 'anon');
        if (n) { avatarSlot.appendChild(n); }
      } catch (e3) {
        avatarSlot.appendChild(el('span', { 'class': 'cp-hint' }, 'no preview'));
      }
    }
    drawAvatar();
    fSeed.oninput = drawAvatar;
    fSeed.onchange = drawAvatar;

    c.appendChild(field('Handle', fHandle, 'Letters, digits and underscores. This is the @name.'));
    c.appendChild(field('Display name', fName));
    c.appendChild(field('Bio', fBio));
    c.appendChild(field('Avatar seed', fSeed, 'Any text. The same text always draws the same face.'));
    c.appendChild(avatarSlot);

    var status = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    c.appendChild(button('Save profile', 'cp-btn-primary', function () {
      var handle = (fHandle.value || '').replace(/^\s+|\s+$/g, '');
      var problems = [];
      if (!handle) { problems.push('A handle is required.'); }
      else if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) {
        problems.push('Handle must be 2 to 24 characters, letters, digits or underscores.');
      }
      if (problems.length) { say(status, 'bad', problems); return; }
      say(status, 'info', ['Saving...']);
      settle(function () {
        return S.me.update({
          handle: handle,
          name: (fName.value || '').replace(/^\s+|\s+$/g, '') || handle,
          bio: fBio.value || '',
          avatarSeed: (fSeed.value || '').replace(/^\s+|\s+$/g, '') || handle
        });
      }, function (err) {
        if (err) { say(status, 'bad', messages(err)); return; }
        say(status, 'good', ['Saved.']);
      });
    }));
    c.appendChild(status);
    root.appendChild(c);

    /* --- stats --- */
    var st = card('Numbers', 'What the platforms have made of you.');
    var stSlot = el('div', {});
    st.appendChild(stSlot);
    root.appendChild(st);
    settle(function () { return S.me.stats(); }, function (err, s) {
      clear(stSlot);
      if (err) { stSlot.appendChild(note('warn', messages(err))); return; }
      if (!s || typeof s !== 'object') { stSlot.appendChild(el('p', { 'class': 'cp-hint' }, 'No statistics yet. Post something.')); return; }
      var list = rows();
      var k;
      for (k in s) {
        if (!Object.prototype.hasOwnProperty.call(s, k)) { continue; }
        var v = s[k];
        if (v && typeof v === 'object') {
          try { v = JSON.stringify(v); } catch (e) { v = String(v); }
        }
        if (typeof v === 'number' && S.live && S.live.commas && v >= 1000) { v = S.live.commas(v); }
        row(list, humanKey(k), v);
      }
      stSlot.appendChild(list);
    });

    /* --- where you are on the ladder ---
     *
     * S.compose.profileCard has existed since compose.js was written and had
     * zero callers in the whole tree, which is why the two bugs inside it
     * were invisible: it read tier "nobody" at any follower count, and dated
     * a milestone to 1970. The milestones card below lists the rungs; this
     * says which one you are on, which is the half that was missing from
     * this screen. */
    if (S.compose && typeof S.compose.profileCard === 'function') {
      var pcard = null;
      try { pcard = S.compose.profileCard(ctx); } catch (e) { pcard = null; }
      if (pcard) { root.appendChild(pcard); }
    }

    /* --- milestones --- */
    root.appendChild(milestonesCard());

    /* --- danger --- */
    var danger = card('Reset everything');
    danger.appendChild(el('p', { 'class': 'cp-prose' },
      'Deletes your account, your posts, your sites and every pack you imported. The 109 built-in sites come back untouched, because they were never yours to delete. There is no undo and nothing is backed up anywhere, because there is no anywhere.'));
    var dStatus = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    danger.appendChild(confirmChain(
      ['Reset everything', 'This erases everything. Tap again.'],
      'cp-btn-danger',
      /* The Storage card calls its own button "the same effect as reset,
       * approached from the other side". That was not true in either
       * direction: wipeAll walked a list that reached three collections of
       * fourteen, and this one called me.reset(), which clears exactly 'me'
       * and 'posts' -- so the button promising your sites and every imported
       * pack removed neither, and then said "Everything is gone."
       *
       * One path now. me.reset() still runs after it, because it also drops
       * the profile that me.js is holding in memory, which clearing a
       * collection does not. */
      function () {
        say(dStatus, 'info', ['Erasing...']);
        wipeAll(function (errs) {
          settle(function () { return S.me.reset(); }, function (err) {
            var bad = errs.concat(err ? messages(err) : []);
            if (bad.length) { say(dStatus, 'bad', bad); return; }
            say(dStatus, 'good', ['Done. Everything is gone. Reload to start over.']);
          });
        });
      }
    ));
    danger.appendChild(dStatus);
    danger.className = 'cp-card cp-card-danger';
    root.appendChild(danger);
  }

  function humanKey(k) {
    var s = String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function milestonesCard() {
    var c = card('Milestones', 'The thresholds the feeds treat as meaningful.');
    /* fame.js exports milestones as a FUNCTION of the profile -- it has to
     * be, because `unlocked` depends on your follower count. This card read
     * it as data, and since `for (k in fn)` yields nothing, every build has
     * printed "The table is empty." over a sixteen-row ladder. The
     * array-or-object branch below stays: it costs nothing and this card is
     * the kind of thing a pack could one day hand a plain table to. */
    var ms = (S.fame && S.fame.milestones) ? S.fame.milestones : null;
    if (!ms) {
      c.appendChild(el('p', { 'class': 'cp-hint' }, 'No milestone table in this build.'));
      return c;
    }
    if (typeof ms === 'function') {
      var who = null;
      try { who = S.me && S.me.profile ? S.me.profile() : null; } catch (e) { who = null; }
      try { ms = ms(who); } catch (e) { ms = null; }
      if (!ms) {
        c.appendChild(el('p', { 'class': 'cp-hint' }, 'No milestone table in this build.'));
        return c;
      }
    }
    var arr = [];
    var i, k;
    if (Object.prototype.toString.call(ms) === '[object Array]') { arr = ms; }
    else {
      for (k in ms) { if (Object.prototype.hasOwnProperty.call(ms, k)) { arr.push({ name: k, value: ms[k] }); } }
    }
    if (!arr.length) {
      c.appendChild(el('p', { 'class': 'cp-hint' }, 'The table is empty.'));
      return c;
    }
    var ul = el('ul', { 'class': 'cp-milestones' });
    for (i = 0; i < arr.length; i++) {
      var m = arr[i];
      var li = el('li', { 'class': 'cp-milestone' });
      var label, detail = null, hit = false;
      if (m && typeof m === 'object') {
        label = firstStr(m.label, m.title, m.name, m.id) || ('#' + (i + 1));
        var at = firstNum(m.at, m.threshold, m.followers, m.count, m.value);
        if (at !== null) { detail = (S.live && S.live.commas) ? S.live.commas(at) : String(at); }
        else if (typeof m.value === 'string') { detail = m.value; }
        /* `unlocked` is what fame.js actually sets. The other three were
         * guesses at a field name and none of them was ever true, so no row
         * has ever been marked reached even on an account past the top of
         * the ladder. */
        hit = !!(m.unlocked || m.reached || m.hit || m.done);
      } else {
        label = String(m);
      }
      if (hit) { li.className = 'cp-milestone cp-milestone-hit'; }
      li.appendChild(el('span', { 'class': 'cp-milestone-label' }, label));
      if (detail) { li.appendChild(el('span', { 'class': 'cp-milestone-at' }, detail)); }
      if (hit) { li.appendChild(el('span', { 'class': 'cp-milestone-flag' }, 'reached')); }
      ul.appendChild(li);
    }
    c.appendChild(ul);
    return c;
  }

  function signUpCard(ctx, root) {
    var c = card('Make an account',
      'It exists on this device only. There is no server to register with.');
    var fHandle = input('text', '', { 'spellcheck': 'false', 'autocapitalize': 'none', 'maxlength': '24', 'placeholder': 'gridfall_ash' });
    var fName = input('text', '', { 'maxlength': '48', 'placeholder': 'Ash Kettle' });
    var fBio = textarea('', 4, { 'maxlength': '400', 'placeholder': 'Tell the county something.' });
    c.appendChild(field('Handle', fHandle, '2 to 24 characters, letters, digits or underscores.'));
    c.appendChild(field('Display name', fName));
    c.appendChild(field('Bio', fBio));
    var status = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    c.appendChild(button('Create account', 'cp-btn-primary', function () {
      var handle = (fHandle.value || '').replace(/^\s+|\s+$/g, '');
      if (!/^[A-Za-z0-9_]{2,24}$/.test(handle)) {
        say(status, 'bad', ['Handle must be 2 to 24 characters, letters, digits or underscores.']);
        return;
      }
      say(status, 'info', ['Creating...']);
      settle(function () {
        return S.me.signUp({
          handle: handle,
          name: (fName.value || '').replace(/^\s+|\s+$/g, '') || handle,
          bio: fBio.value || ''
        });
      }, function (err) {
        if (err) { say(status, 'bad', messages(err)); return; }
        clear(root);
        screenMe(ctx, root);
      });
    }));
    c.appendChild(status);
    return c;
  }

  /* ============================================================== STORAGE */

  function screenStorage(ctx, root) {
    ctx.title('Control panel -- storage');
    root.appendChild(header(ctx, 'Storage', 'What is on this device, and how much of it.'));
    root.appendChild(navBar(ctx, 'storage'));

    var sum = card('Summary');
    var sumRows = rows();
    sum.appendChild(sumRows);
    var usedCell = row(sumRows, 'Used', 'checking...');
    var quotaCell = row(sumRows, 'Quota', 'checking...');
    var durCell = row(sumRows, 'Durable', 'checking...');
    root.appendChild(sum);

    settle(function () { return S.store.usage(); }, function (err, u) {
      clear(usedCell); clear(quotaCell);
      if (err) {
        usedCell.appendChild(note('warn', messages(err)));
        quotaCell.appendChild(document.createTextNode('unknown'));
        return;
      }
      var used = firstNum(u && u.usage, u && u.used, u && u.bytes, typeof u === 'number' ? u : null);
      var quota = firstNum(u && u.quota, u && u.total, u && u.available);
      usedCell.appendChild(document.createTextNode(fmtBytes(used)));
      if (quota) {
        quotaCell.appendChild(document.createTextNode(fmtBytes(quota)));
        var pct = used !== null ? Math.min(100, Math.round((used / quota) * 100)) : 0;
        var bar = el('div', { 'class': 'cp-bar', 'role': 'img', 'aria-label': pct + ' percent of quota used' });
        var fill = el('div', { 'class': 'cp-bar-fill' });
        fill.setAttribute('data-pct', String(pct));
        bar.appendChild(fill);
        sum.appendChild(bar);
        sum.appendChild(el('p', { 'class': 'cp-hint' }, pct + '% of what the browser will give this app.'));
        /* width has to be set as a style; it is a number, not content */
        fill.style.width = pct + '%';
      } else {
        quotaCell.appendChild(document.createTextNode('not reported'));
      }
    });

    settle(function () { return S.store.durable(); }, function (err, d) {
      clear(durCell);
      if (err) { durCell.appendChild(note('warn', messages(err))); return; }
      if (d) {
        durCell.appendChild(document.createTextNode('yes'));
      } else {
        durCell.appendChild(note('bad', [
          'No. Nothing survives a restart.',
          'Persistent storage was refused, which almost always means private browsing. Close this window and everything here is gone: account, posts, packs, sites.'
        ]));
      }
    });

    /* --- breakdown --- */
    var bd = card('By collection');
    var bdSlot = el('div', { 'class': 'cp-table-slot' });
    bd.appendChild(bdSlot);
    root.appendChild(bd);
    renderBreakdown(bdSlot);

    /* --- wipe --- */
    var danger = card('Wipe all stored data');
    danger.className = 'cp-card cp-card-danger';
    danger.appendChild(el('p', { 'class': 'cp-prose' },
      'Empties every collection. Same effect as reset, approached from the other side: your account, your posts, your sites and every imported pack. The built-in archive is untouched -- it is not stored, it is compiled in.'));
    var wStatus = el('div', { 'class': 'cp-status', 'aria-live': 'polite' });
    danger.appendChild(confirmChain(
      ['Wipe storage', 'Everything goes. Tap again.'],
      'cp-btn-danger',
      function () {
        say(wStatus, 'info', ['Wiping...']);
        wipeAll(function (errs) {
          if (errs.length) { say(wStatus, 'bad', errs); }
          else { say(wStatus, 'good', ['Storage is empty. Reload to start over.']); }
          renderBreakdown(bdSlot);
        });
      }
    ));
    danger.appendChild(wStatus);
    root.appendChild(danger);
  }

  function renderBreakdown(slot) {
    clear(slot);
    var cols = listCollections();
    var stats = [];
    var i, s, totalBytes = 0, totalCount = 0;
    for (i = 0; i < cols.length; i++) {
      s = collectionStat(cols[i]);
      if (s && s.count > 0) {
        stats.push(s);
        totalBytes += s.bytes;
        totalCount += s.count;
      }
    }
    if (!stats.length) {
      slot.appendChild(note('info', ['Nothing stored yet.']));
      return;
    }
    stats.sort(function (a, b) { return b.bytes - a.bytes; });

    var table = el('table', { 'class': 'cp-table' });
    var thead = el('thead', { 'class': 'cp-thead' });
    var hr = el('tr', { 'class': 'cp-tr' });
    var heads = ['Collection', 'Entries', 'Approx. size'];
    for (i = 0; i < heads.length; i++) { hr.appendChild(el('th', { 'class': 'cp-th', 'scope': 'col' }, heads[i])); }
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody', { 'class': 'cp-tbody' });
    for (i = 0; i < stats.length; i++) {
      var tr = el('tr', { 'class': 'cp-tr' });
      tr.appendChild(cell('Collection', el('span', { 'class': 'cp-mono' }, stats[i].name), 'cp-td-name'));
      tr.appendChild(cell('Entries', stats[i].count));
      tr.appendChild(cell('Approx. size', fmtBytes(stats[i].bytes)));
      tbody.appendChild(tr);
    }
    var trT = el('tr', { 'class': 'cp-tr cp-tr-total' });
    trT.appendChild(cell('Collection', 'Total', 'cp-td-name'));
    trT.appendChild(cell('Entries', totalCount));
    trT.appendChild(cell('Approx. size', fmtBytes(totalBytes)));
    tbody.appendChild(trT);
    table.appendChild(tbody);
    slot.appendChild(table);
    slot.appendChild(el('p', { 'class': 'cp-hint' },
      'Sizes are text length, counted the same way as the figure at the top of the page, so the two totals agree. Neither is what the disk costs.'));
  }

  function wipeAll(done) {
    var cols = listCollections();
    var errs = [];
    var pending = 0;
    var finished = false;

    function maybeDone() {
      if (pending === 0 && finished) { done(errs); }
    }

    var i;
    for (i = 0; i < cols.length; i++) {
      (function (name) {
        var stat = collectionStat(name);
        if (!stat || stat.count === 0) { return; }
        pending++;
        settle(function () { return S.store.clear(name); }, function (err) {
          if (err) { errs.push(name + ': ' + messages(err)[0]); }
          pending--;
          maybeDone();
        });
      }(cols[i]));
    }
    finished = true;
    maybeDone();
  }

  /* ================================================================== 404 */

  function screen404(ctx, root, path) {
    ctx.title('Control panel -- not found');
    root.appendChild(header(ctx, 'No such panel', '/' + path.join('/')));
    root.appendChild(navBar(ctx, null));
    var c = card('404');
    c.appendChild(el('p', { 'class': 'cp-prose' },
      'The control panel has five pages and that is not one of them. It has never had more. Try one of the links above.'));
    root.appendChild(c);
  }

  /* ============================================================= REGISTER */

  S.render.register('control', function (ctx) {
    var root = el('div', { 'class': 'cp-root' });
    ctx.mount.appendChild(root);

    var path = ctx.path || [];
    var head = path.length ? String(path[0]) : '';

    try {
      if (head === '') { screenOverview(ctx, root); }
      else if (head === 'packs') { screenPacks(ctx, root); }
      else if (head === 'compose') { screenCompose(ctx, root); }
      else if (head === 'me') { screenMe(ctx, root); }
      else if (head === 'storage') { screenStorage(ctx, root); }
      else { screen404(ctx, root, path); }
    } catch (e) {
      clear(root);
      root.appendChild(header(ctx, 'Control panel', 'Something broke while drawing this page.'));
      root.appendChild(navBar(ctx, null));
      var c = card('Error');
      c.appendChild(note('bad', messages(e)));
      c.appendChild(el('p', { 'class': 'cp-hint' },
        'Your data is untouched -- this is a drawing failure, not a storage one. Try another page.'));
      root.appendChild(c);
    }
  });

}());
