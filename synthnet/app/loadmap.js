window.SYNTH = window.SYNTH || {};

/* loadmap.js -- which files a site type needs, so the other nineteen can
   stay on disk until something asks for them.

   index.html used to <script> all twenty renderers and <link> all twenty
   skin stylesheets on every page load, render-blocking, whatever you were
   looking at. That is 1,090,437 bytes raw / 281,477 gzipped of which a page
   uses exactly one renderer and one stylesheet. The cold-load budget was at
   93.5% of its raw ceiling and 95.1% of its gzipped one, and the next
   renderer of any size would have failed the build.

   The skins are one file per TYPE, not per skin name -- theme/skins/forum.css
   holds phpbb-blue, ezboard-grey and softboard together -- so one key gates
   both halves.

   Written out rather than derived from the type name, because `control` is
   the one entry whose paths do not follow the convention. tools/build.py
   reads this table and FAILS THE BUILD if any app/types/*.js or
   theme/skins/*.css on disk is missing from it, so a renderer added without
   an entry here is a build error rather than a site that silently never
   renders.

   ES5, no modules: this has to work as a classic script off file://. */

(function () {
  'use strict';

  window.SYNTH.loadmap = {
    aggregator: { js: 'app/types/aggregator.js', css: 'theme/skins/aggregator.css' },
    assistant:  { js: 'app/types/assistant.js',  css: 'theme/skins/assistant.css' },
    blog:       { js: 'app/types/blog.js',       css: 'theme/skins/blog.css' },
    board:      { js: 'app/types/board.js',      css: 'theme/skins/board.css' },
    chat:       { js: 'app/types/chat.js',       css: 'theme/skins/chat.css' },
    dash:       { js: 'app/types/dash.js',       css: 'theme/skins/dash.css' },
    forum:      { js: 'app/types/forum.js',      css: 'theme/skins/forum.css' },
    mail:       { js: 'app/types/mail.js',       css: 'theme/skins/mail.css' },
    market:     { js: 'app/types/market.js',     css: 'theme/skins/market.css' },
    media:      { js: 'app/types/media.js',      css: 'theme/skins/media.css' },
    news:       { js: 'app/types/news.js',       css: 'theme/skins/news.css' },
    newsletter: { js: 'app/types/newsletter.js', css: 'theme/skins/newsletter.css' },
    page:       { js: 'app/types/page.js',       css: 'theme/skins/page.css' },
    portal:     { js: 'app/types/portal.js',     css: 'theme/skins/portal.css' },
    qa:         { js: 'app/types/qa.js',         css: 'theme/skins/qa.css' },
    shop:       { js: 'app/types/shop.js',       css: 'theme/skins/shop.css' },
    social:     { js: 'app/types/social.js',     css: 'theme/skins/social.css' },
    stream:     { js: 'app/types/stream.js',     css: 'theme/skins/stream.css' },
    wiki:       { js: 'app/types/wiki.js',       css: 'theme/skins/wiki.css' },
    wire:       { js: 'app/types/wire.js',       css: 'theme/skins/wire.css' },

    /* The in-app control panel. A registered site type like any other --
       synth://control.verity.net/ -- but its files sit outside app/types/
       and theme/skins/ because it is the app's own surface rather than a
       site in the fiction. 69,133 bytes nobody loads until they open it. */
    control:    { js: 'app/control.js',          css: 'theme/control.css' }
  };
})();
