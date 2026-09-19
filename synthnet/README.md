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
internet ships inside the APK and the app declares **no permissions at all** —
without the INTERNET permission Android refuses every socket the process opens,
so being offline is enforced by the operating system rather than promised here.
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
app/render.js           el() helper and the renderer registry
app/types/*.js          one renderer per site type (7 files)
app/engine.js           router, history, search, site loading
theme/                  chrome CSS and theme/skins/<type>.css
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

Seven types, each with its own renderer and its own URL paths:

| type   | paths                                              |
| ------ | -------------------------------------------------- |
| forum  | `/`, `/board/<id>`, `/topic/<id>`                  |
| social | `/`, `/user/<handle>`, `/post/<id>`                |
| blog   | `/`, `/post/<id>`, `/tag/<tag>`                    |
| news   | `/`, `/section/<id>`, `/article/<id>`              |
| wiki   | `/`, `/wiki/<id>`, `/category/<id>`                |
| media  | `/`, `/watch/<id>`, `/channel/<id>`                |
| page   | `/`, `/<pageId>`                                   |

The seed content shares one setting: Verity County, an inland region, 2001-2008.
Recurring subjects across sites - the 2003 Gridfall substation fire, the Verity
Rail branch-line closure, a roadside numbers-station myth called "the Signal on
62", and a closed diner called the Blue Kestrel - so cross-links between sites
land on something real.

Seed sites, generated from `net/registry.json` rather than typed by hand,
because an earlier version of this list named five domains that do not
exist:

- `boards.gridfall.net` - forum. General-purpose message board for Gridfall and the rest of Verity County.
- `forums.verityrail.org` - forum. Discussion board for the Verity Rail line, its branches, and the people who photograph them.
- `marla.verity.net` - social. Personal page belonging to Marla Kesswick of Marchfield, updated whenever she feels like it.
- `pulse.gridfall.net` - social. A small microblog for Gridfall and the rest of Verity County. Mostly road closures.
- `codeandcoffee.blog` - blog. Dave Carrow writes about servers, county networking, and things he has measured in Verity County.
- `kestrel-journal.net` - blog. Jo Halloran's journal, written mostly after shifts at the Blue Kestrel diner in Gridfall.
- `verityledger.com` - news. The Verity County paper of record, published in Gridfall since 1901.
- `wiki.gridfall.net` - wiki. A community-maintained wiki covering Verity County, its towns, institutions and arguments.
- `clipvault.tv` - media. Video uploads from around Verity County: camcorder tape, rail footage, hall shows, tool demos and radio recordings.
- `stargazers.verity.net` - page. Home page of the Verity County Amateur Astronomers, meeting monthly since 1978 and observing from Perrin Hill.
- `tnorris.verity.net` - page. The page of Thomas Norris, retired Verity County surveyor, including a detailed account of the flood of June 1994.
- `webring.gridfall.net` - page. Hub of the Gridfall Webring, linking personal and community sites in and about Verity County.

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
- There is no network of any kind - no other users, no posting, no accounts. The
  forms are furniture.
- The content is invented. The county, the towns, the people, the newspaper, the
  fire, the diner and every post and article are fiction written for this
  project. Nothing in it is a record of anything real, and none of it should be
  quoted as one.
