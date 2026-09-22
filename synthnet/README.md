# synthnet

A synthetic internet. It is a small set of invented websites - forums, a social
site, blogs, a news site, a wiki, a video site, personal pages - served as
static files and browsed through a fake browser chrome styled after 2007.
Everything is fabricated. Nothing in it connects to the real internet.

It is built to run on a phone, offline, with no server and no installation, and
to still be a real thing you can sit and read.

## It is live

VerityNet is not an archive. Open it twice an hour apart and the microblog has
new posts, the boards have new threads, view counts have climbed and the
"users online" figure has moved with the time of day.

There is no server doing that, and nothing is stored. Everything live is a pure
function of the wall clock: a slot number derived from minutes elapsed, and a
hash of that slot picking from a pool. Deterministic within a minute, so the
page does not reshuffle while you read it; different an hour later; different
again next week.

What fills those slots is the joke. Most of VerityNet is automated now --
engagement farms, content mills, answer bots confidently wrong about local
history, SEO spam, bought posts disclosed in the smallest available type, and
an ad network on every page. A few humans are still posting into it. The start
page reports what share of the last day's traffic was automated; the forums
report how many of the accounts online are.

## Running it

Three modes. They show the same content.

**As an app.** `android/build.sh` produces `synthnet.apk`: install it, tap the
icon, it opens. No browser, no server, no file manager. The whole synthetic
internet ships inside the APK and **the app declares no INTERNET permission**,
so Android refuses every socket the process opens and being offline is enforced
by the operating system rather than promised here. It declares two permissions,
both for local notifications and neither granting any network access:
`POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED`. CI gates that with an
allowlist — anything not on it fails the build, INTERNET included.
Android 8.0+. The build uses only framework APIs, so it is aapt2, javac, d8 and
apksigner with nothing to download — no Gradle, no androidx, no dependency
resolution. See `docs/PHONE.md`.

**Standalone.** `tools/build.py` produces a single HTML file with every site
inlined. Copy that one file to the phone, open it from the file manager, and it
works. No server, no network, no unpacking. This is the mode that drives most of
the design constraints - no ES modules, no bundler, no external assets - because
none of those work from `file://`.

**Served.** Point any static file server at the project root and open
`index.html`. In this mode the engine fetches `net/registry.json` on boot and
each `net/sites/<slug>/site.json` lazily as you navigate, so startup is quick
and memory stays low.

For phone setup - where to put the file, which apps work, how to serve it
locally from the phone itself - see `docs/PHONE.md`.

## Layout

```
index.html              the chrome: address bar, back/forward, tabs
app/markup.js           inline markup parser -> DOM nodes
app/loadmap.js          which files each site type needs
app/render.js           el() helper, the renderer registry, the on-demand loader
app/types/*.js          one renderer per site type (20 files), fetched when used
app/engine.js           router, history, search, site loading
theme/                  chrome CSS and theme/skins/<type>.css, also on demand
net/sites/<slug>/site.json   the content, one file per site
net/registry.json       generated index of sites
net/search.json         generated search index
tools/build.py          builds registry.json, search.json, standalone HTML
tools/validate.py       checks the contract and the offline rule
tools/new_site.py       scaffolds a new site.json
tools/publish.sh        commits and pushes
docs/AUTHORING.md       the content contract (read this before writing a site)
docs/PHONE.md           running it on a phone
.claude/workflows/synthnet-expand.js   re-runnable workflow that adds sites
```

## Offline

There are no network calls. Not lazy-loaded, not optional, not "works offline
after first load" - there is no code path anywhere that reaches outside the
directory.

- No CDN, no web fonts, no external images, no analytics.
- No absolute `http` or `https` URL in any file, including comments.
- Images are inline SVG placeholders generated from a seed string, or `data:`
  URIs.
- Links between sites use a `synth://` scheme that the router resolves locally.

`tools/validate.py` enforces this. It scans every file in the project for
absolute `http`/`https` URLs, protocol-relative CDN hosts, `fetch(` against
anything outside `net/`, and
for `<link>`/`<script>`/`<img>` tags pointing off-tree, and fails the build if
it finds any. Run it before publishing.

## Site types and seed sites

Twenty types you can author, each with its own renderer and its own URL
paths, plus `control` for this browser's own settings panel:

    aggregator  assistant  blog     board   chat
    dash        forum      mail     market  media
    news        newsletter page     portal  qa
    shop        social     stream   wiki    wire

This said "Seven types" and listed their paths in a table here, which was
true when there were seven and silently wrong for every renderer added
after. The per-type path table lives in `docs/AUTHORING.md` and is checked
against the renderers by `.github/scripts/synthnet_routes_check.py`; a
second copy here would be a seventh, and the paragraph below is this file
already having learned that lesson once.

The content shares one setting: Verity County, an inland region, and one
continuity of people and events.

<!-- generated: era (tools/build.py -- do not edit by hand) -->
The 109 sites are dated 1998 to 2026. 77 of them are 2026 -- the network as it is now, mostly automated -- and the remaining 32 are the archive it grew out of.
<!-- /generated: era -->

Recurring subjects across sites - the 2003 Gridfall substation fire, the Verity
Rail branch-line closure, a roadside numbers-station myth called "the Signal on
62", and a closed diner called the Blue Kestrel - so cross-links between sites
land on something real. This paragraph used to say the setting was "2001-2008",
which stopped being true three quarters of a network ago; the line above it is
generated now so it cannot say that again.

One site of each type, generated from `net/registry.json` rather than typed by
hand -- this list said it was generated for a long time before anything
generated it, and an earlier hand-written version had named five domains that
do not exist:

<!-- generated: seed-sites (tools/build.py -- do not edit by hand) -->
- `gridline.social` - aggregator. A link aggregator for Verity County, incorporated somewhere else, moderated by nobody since spring 2025.
- `ask.verity.ai` - assistant. A regional AI assistant trained on public data from Verity County. It answers everything instantly and is wrong about most of it.
- `archive.thequarry.news` - blog. Ruth Cannady's companion to The Quarry, where the records she gets out of Verity County are posted whole, with the request date, the response date and the redactions marked.
- `62chan.org` - board. An imageboard about the Signal on 62. Registrar offshore, moderator gone since August 2024, roughly eighteen bot posts for every human one.
- `gridfall-help.chat` - chat. A small chat server where people in Verity County ask each other why the printer is doing that, including a read-only import of the Users Group board that closed in 2014.
- `dash.verity.net` - dash. The Verity County smart-county dashboard. Twelve live widgets, four of which are live.
- `boards.gridfall.net` - forum. General-purpose message board for Gridfall and the rest of Verity County.
- `mail.verity.net` - mail. Your inbox. Eleven things want money, four want your attention, two are from people. The junk folder is where the machines are having the most fun.
- `classifieds.verity.net` - market. The county's classifieds board, forty years old in print and six years old under its current owner. Most of it is posted from somewhere else. Some of it is a neighbour clearing out a garage.
- `clipvault.tv` - media. Video uploads from around Verity County: camcorder tape, rail footage, hall shows, tool demos and radio recordings.
- `halsey-ledger.com` - news. A Pinelock property named after a town of 2,100 that has never had a newspaper, running the same pipeline and the same template as the rest of the group.
- `brenners-notebook.email` - newsletter. Hal Brenner's paid monthly newsletter out of Gridfall: one properly sourced county story a month, written by the man the Ledger laid off in 2019 and then used as a byline in 2023.
- `ashkettle-wx.net` - page. Len Mabry's home weather station on Kestrel Road in Ashkettle: daily readings, monthly tables, a dead webcam and a guestbook, last updated 17 April 2011.
- `ashkettle.gov` - portal. Five pages for a village of nine hundred people, kept by one part-time clerk on a template the County supplies, including a zoning ordinance too large to upload and a water tower that is currently empty.
- `askverity.com` - qa. Questions and answers about Verity County. One of several hundred identical local Q&A sites, all moderated by the same bot.
- `countysupply.store` - shop. The last farm store in Verity County, selling real t-posts and real chainsaw chain through an e-commerce platform that writes its own product descriptions and will not let the owner delete the fake reviews.
- `countyalerts.live` - social. An automated breaking-alerts account that rewrites Verity County scanner traffic in under a minute, at volume, with nobody reading it first.
- `clipvault-shorts.tv` - stream. Vertical video. Verity County's last hundred years compressed into forty-second clips, most of which are wrong, none of which cite anything.
- `verity.wiki` - wiki. A county wiki for Verity County, still edited by hand by about six people and by a great many things that are not people.
- `veritywire.press` - wire. A small regional wire filing county copy to the outlets that are left, which is why the same paragraph turns up on three of them.
<!-- /generated: seed-sites -->

Exact domains and descriptions for the current set are in `net/registry.json`
after a build; that file is generated, so treat it as the source of truth over
this list.

## Adding a site

Three ways, easiest first.

1. `python3 tools/new_site.py --type forum --domain boards.example.net` -
   scaffolds a valid skeleton `site.json` in the right folder for you to fill in.
2. The `synthnet-expand` workflow in `.claude/workflows/synthnet-expand.js` -
   authors several sites at once and self-checks each one against the contract.
   It is budget-aware: it caps how many sites one run will create and stops
   starting work when the remaining budget gets thin rather than producing
   half-finished files. It does not run git.
3. By hand. Create `net/sites/<slug>/site.json`, where `<slug>` is the domain
   with dots replaced by hyphens. `docs/AUTHORING.md` has the full schema, the
   per-type data shapes, the legal skins per type, and the inline markup tags.
   Read it first; the renderers will not guess at key names.

In all three cases, `registry.json` and `search.json` are generated - do not
edit them.

## Commands

```
python3 tools/build.py       regenerate registry.json, search.json, standalone HTML
python3 tools/validate.py    check the contract and the no-network rule
bash tools/publish.sh        commit and push
```

Run build, then validate, then publish.

## What this is not

- There is no video. The media site shows thumbnails, titles, durations and
  comment threads; clicking play does not play anything.
- There is no search engine backend. Search reads a small generated index of the
  sites in this project. It does not crawl and it does not reach anything.
- There are no other users. You can make an account, post, gain followers and
  get replies, and every bit of that is local: the profile and the posts live
  in IndexedDB on the one device, the replies come from `app/bots.js`, and
  nothing reaches anybody. Clear the browser's storage and none of it happened.
  (This bullet said "no posting, no accounts, the forms are furniture" for a
  long time after all three stopped being true.)
- The content is invented. The county, the towns, the people, the newspaper, the
  fire, the diner and every post and article are fiction written for this
  project. Nothing in it is a record of anything real, and none of it should be
  quoted as one.
