# Authoring a synthnet site

## Read this first

Three mistakes have each been made independently by more than one author on
this project. They all produce a page that renders — badly — rather than an
error, so nothing catches them but a person looking at the screen.

**1. `ctx.markup` IS the parse function.** Not an object with a `.parse` on
it.

```js
ctx.mount.appendChild(ctx.markup(post.body));   // yes
ctx.markup.parse(post.body);                    // TypeError
MK.parse(post.body);                            // there is no MK
```

Get this wrong and every body renders as raw `[b]like this[/b]`, or the page
throws. Three separate renderers shipped with it wrong.

**2. `SYNTH.live.stream()` returns wrappers, not items.**

```js
var rows = L.stream('wire:' + domain, 'newsItems', 7, 10);
rows[0]            // -> { slot, at, item, seed }
rows[0].item.body  // the content you wanted
rows[0].body       // undefined -> "[object Object]" on screen
```

**3. Never right-shift a `hash32` value.** It returns a uint32, and `>>` is a
*signed* shift, so `h >> 3` can be negative, `negative % array.length` is
negative, and the lookup is `undefined`. Use `>>>`, or just `%`.

```js
pool[L.hash32(seed) % pool.length]        // yes
pool[(L.hash32(seed) >> 3) % pool.length] // crashes on roughly half of seeds
```

One renderer shipped crashing on this and another had eight latent instances.

Two more, less dramatic:

- **Pass pool *names*, not arrays**, to `stream()` and `live.pool()`.
  `L.stream(key, 'socialPosts', 4, 20)` picks up content packs;
  `L.stream(key, SYNTH.slop.socialPosts, 4, 20)` does not.
- **Renderers are synchronous.** The return value is ignored. Build DOM,
  append to `ctx.mount`, call `ctx.title(str)`. You cannot `await` anything.

---

Everything in this network is one JSON file per site:

```
net/sites/<domain-with-dashes>/site.json
```

Nothing else. No HTML per site, no per-site CSS. The renderer for the site's
`type` turns that JSON into a period-appropriate page, and the `skin` decides
what it looks like.

`net/registry.json` and `net/search.json` are **generated**. Never edit them.

Quick start:

```
python3 tools/new_site.py boards.gridfall.net forum
# edit net/sites/boards-gridfall-net/site.json
python3 tools/build.py
python3 tools/validate.py
```

---

## 1. The envelope

Every `site.json` has exactly these keys at the top level:

```json
{
  "schema": 1,
  "domain": "boards.gridfall.net",
  "title": "The Gridfall Boards",
  "type": "forum",
  "era": "2004",
  "skin": "phpbb-blue",
  "description": "One sentence, shown in the directory and in search.",
  "tags": ["gridfall", "locals"],
  "links": ["wiki.gridfall.net"],
  "data": {}
}
```

| key | rule |
|---|---|
| `schema` | always `1` |
| `domain` | unique across the whole project; the folder name is this with `.` replaced by `-` |
| `title` | shown in the chrome and the tab title |
| `type` | one of the seven below |
| `era` | free text, e.g. `"2004"`, `"2001-2003"`; shown in the chrome |
| `skin` | must be a skin that is legal for that `type` |
| `description` | one sentence; indexed for search |
| `tags` | optional array of strings, used by the directory |
| `links` | domains this site links to; every one must exist in the project |
| `data` | type-specific, exact shapes below |

The folder may carry a trailing suffix after the domain part
(`boards-gridfall-net-2004` is fine); everything before the suffix must match.

---

## 2. Skins

A skin is applied as `skin-<name>` on the mount, and every rule in
`theme/skins/<type>.css` is scoped under that class, so skins cannot leak.

The skin must be legal for the type. `tools/validate.py` (`SKINS`) is the
authority; this table mirrors it.

| era | type | skins |
|---|---|---|
| archive | `forum` | `phpbb-blue`, `ezboard-grey` |
| archive | `social` | `bluebird`, `myspace-black` |
| archive | `blog` | `movabletype-cream`, `kubrick-blue` |
| archive | `news` | `broadsheet`, `portal-red` |
| archive | `wiki` | `monobook` |
| archive | `media` | `tubeplayer` |
| any | `page` | `geocities`, `tripod-tile`, `plain-white` |
| 2026 | `aggregator` | `orange-news`, `round-red` |
| 2026 | `qa` | `stack` |
| 2026 | `board` | `yotsuba` |
| 2026 | `shop` | `megastore` |
| 2026 | `market` | `classified` |
| 2026 | `assistant` | `chatbot` |
| 2026 | `mail` | `webmail` |
| 2026 | `portal` | `govsite` |
| 2026 | `stream` | `tubemodern` |
| 2026 | `dash` | `glassdash` |
| 2026 | `wire` | `wireroom` |
| 2026 | `newsletter` | `inbox-letter` |
| 2026 | `chat` | `chatdark` |
| 2026 | `news` | also `pinkslime` (see below) |
| — | `control` | `control` (the in-app panel; do not author one) |

The "era" column is guidance, not enforcement — a 2026 `forum` is entirely
legal and the project needs several. Adding a skin means adding it to `SKINS`
in `tools/validate.py`, adding rules to `theme/skins/<type>.css` scoped under
`.skin-<name>`, and (for a new type) a `<link>` in `index.html`.

---

## 3. Paths per type

The renderers and your content must agree on these. Nothing else routes, and
a path no renderer serves is a link that 404s. `PATH_PREFIXES` in
`tools/validate.py` is the authority.

| type | paths |
|---|---|
| `forum` | `/` `/board/<boardId>` `/topic/<topicId>` |
| `social` | `/` `/user/<handle>` `/post/<postId>` |
| `blog` | `/` `/post/<postId>` `/tag/<tag>` |
| `news` | `/` `/section/<sectionId>` `/article/<articleId>` `/live/<liveId>` `/factcheck/<checkId>` `/corrections` |
| `wiki` | `/` `/wiki/<articleId>` `/category/<categoryId>` |
| `media` | `/` `/watch/<itemId>` `/channel/<channelId>` |
| `page` | `/` `/<pageId>` |
| `aggregator` | `/` `/board/<boardId>` `/item/<linkId>` |
| `qa` | `/` `/tag/<tagId>` `/q/<questionId>` |
| `board` | `/` `/t/<threadId>` |
| `shop` | `/` `/c/<catId>` `/p/<productId>` |
| `market` | `/` `/c/<catId>` `/l/<listingId>` |
| `assistant` | `/` `/chat` |
| `mail` | `/` `/f/<folderId>` `/m/<messageId>` |
| `portal` | `/` `/s/<serviceId>` |
| `stream` | `/` `/c/<channelId>` `/w/<videoId>` |
| `dash` | `/` only |
| `wire` | `/` `/d/<dispatchId>` `/cat/<categoryId>` |
| `newsletter` | `/` `/i/<issueId>` |
| `chat` | `/` `/c/<channelId>` |

For a `page` site, the page whose `id` is `index` is the root.

Note that `/c/` means three different things depending on type (shop
category, market category, stream channel) and `/board/` two (forum board,
aggregator board). That is deliberate — each is what the real thing used —
but it means a cross-site link's path only makes sense against the target's
type. The validator warns on a mismatch.

---

## 4. Cross-linking

Inside any body, link with the `synth://` scheme:

```
[url=synth://wiki.gridfall.net/wiki/substation-fire]the fire article[/url]
```

A leading-slash href is relative to the current site:

```
[url=/topic/44]see the thread in Off Topic[/url]
```

Rules the validator enforces:

- the domain in a `synth://` URL must exist in the project (hard error)
- the path must look like a path that site type can serve (warning)
- every domain listed in `links` must exist (hard error)

Add the domain to `links` as well as linking to it in a body. `links` is what
the directory and the "sites that link here" chrome use.

There are **no** `http` or `https` URLs anywhere, ever — not in content, not in
comments, not in CSS. The validator fails the build on any. Images are inline
SVG placeholders (see `[img:...]`) or `data:` URIs.

---

## 5. Inline markup

Every long text body uses this and only this. Anything else is literal text.
Unclosed tags render literally rather than throwing, but the validator warns —
fix them.

```
blank line              paragraph break

[b]bold[/b]  [i]italic[/i]  [u]underline[/u]  [s]struck[/s]

[url=synth://wiki.gridfall.net/wiki/blue-kestrel]The Blue Kestrel[/url]
[url=/topic/12]that thread again[/url]

[quote=marla_t]I already said this upthread.[/quote]      (nests, max depth 4)

[code]
  cron is not a text editor
[/code]

[list][*]first[*]second[*]third[/list]

[img:avatar:marla_t]      kind is avatar | banner | photo | thumb
[img:photo:mill-street]   the seed makes the placeholder deterministic
```

Example of a body as it really looks:

```json
"body": "Went past the substation this morning.\n\n[b]It is still fenced off.[/b] The sign says April, which is what the sign said in [i]January[/i].\n\n[quote=dennis_h]They told the paper it was a parts delay.[/quote]\nThey tell the paper that every time.\n\n[url=synth://news.veritycounty.us/article/substation-april]The council piece[/url]"
```

Use `\n\n` in JSON for a paragraph break. A single `\n` is a line break within
a paragraph.

---

## 6. `data` shapes per type

Exact key names. Extra keys are ignored; missing required keys fail validation.

### forum

```
{ boardName,
  categories: [ { id, name, boards: [ { id, name, desc, topicCount, postCount,
                  lastPost: { author, time } } ] } ],
  topics: [ { id, boardId, title, author, time, replies, views, sticky, locked,
              posts: [ { id, author, authorTitle, authorPosts, authorJoined,
                         avatarSeed, time, body, signature } ] } ] }
```

`topic.boardId` must name a board defined in `categories`.

### social

```
{ profile: { handle, displayName, avatarSeed, bio, location, joined,
             following, followers, mood },
  feed: [ { id, author, handle, avatarSeed, time, body, likes, reposts,
            replies: [ { id, author, handle, avatarSeed, time, body } ] } ],
  friends: [ { handle, displayName, avatarSeed } ] }
```

### blog

```
{ author, tagline, about,
  blogroll: [ { label, href } ],
  posts: [ { id, title, date, tags: [], body,
              comments: [ { author, time, body } ] } ] }
```

`/tag/<tag>` pages are derived from the `tags` arrays; you do not declare them.

### news

```
{ masthead, slogan,
  sections: [ { id, name } ],
  articles: [ { id, sectionId, headline, dek, byline, date, lead, body,
                featured } ] }
```

`article.sectionId` must name a section. `featured` is a boolean; the front
page leads with it.

### wiki

```
{ siteName,
  articles: [ { id, title, summary,
                infobox: { caption, rows: [ [label, value] ] },
                sections: [ { heading, body } ],
                categories: [ "<categoryId>" ],
                seeAlso: [ { id, label } ] } ],
  categories: [ { id, name } ] }
```

`categories` entries must be real category ids; `seeAlso[].id` must be a real
article id **in this same wiki**. To point at another site, use a `synth://`
link in a section body instead.

### media

```
{ siteName,
  channels: [ { id, name, subscribers, about, avatarSeed } ],
  items: [ { id, channelId, title, uploader, uploaded, views, duration,
             description, thumbSeed, comments: [ { author, time, body } ] } ] }
```

`item.channelId` must name a channel. There is no video; the player is a
period-accurate shell around the thumbnail.

### page

```
{ navLabel, pages: [ { id, name, blocks: [ BLOCK ] } ] }
```

`BLOCK` is one of:

```
{ kind: "heading",    level: 1|2|3, text }
{ kind: "text",       body }                      // inline markup
{ kind: "list",       ordered: false, items: [] }
{ kind: "table",      head: [], rows: [[]] }
{ kind: "image",      seed, caption, imgKind }    // imgKind: avatar|banner|photo|thumb
{ kind: "marquee",    text }
{ kind: "hitcounter", count }
{ kind: "guestbook",  entries: [ { author, time, body } ] }
{ kind: "webring",    ringName, members: [ { label, domain } ] }
```

---

## 6b. `data` shapes — the 2026 types

Same rules: exact key names, extra keys ignored, missing required keys fail
validation. Every `*Id` cross-reference is checked and a dangling one is a
hard error.

`kind` appears throughout and drives the badge the live layer draws:
`human` (no badge), `bot`, `spam`, `promoted`, `sponsored`. It is how the
page shows you how much of itself is automated, which is the whole joke — a
site where everything is `human` reads as a 2006 site with a 2026 skin.

### aggregator

```
{ siteName, tagline,
  boards:  [ { id, name } ],
  links:   [ { id, boardId, title, url, domain, by, points, at, commentCount,
               kind, comments: [ COMMENT ] } ] }

COMMENT = { by, kind, body, points, replies: [ COMMENT ] }   // nests
```

`url`/`domain` are the *displayed* source. A link to a site in the project
should use its real domain; a link to a scam should use a `DEAD_TLDS` domain
(see §4) so it dead-ends on purpose.

### qa

```
{ siteName,
  tags:      [ { id, name, count } ],
  questions: [ { id, tagIds: [], title, body, by, at, votes, views,
                 closed, closedReason,
                 answers:  [ { by, body, votes, accepted, at, kind } ],
                 comments: [ { by, body } ] } ] }
```

`closedReason` is where the culture lives: "duplicate of a question from 2019
that does not answer this", "too broad", "opinion-based". At most one answer
per question should be `accepted`, and it does not have to be the top-voted
one.

### board

```
{ boardName,
  rules:   [ "..." ],
  threads: [ { id, subject, by, at, replyCount, imageSeed, body,
               posts: [ { no, by, at, body, imageSeed, kind } ] } ] }
```

`no` is the global post number, which goes up forever and never resets —
readers count on it. `by` is almost always `Anonymous`. Greentext is a `body`
line starting with `>`.

### shop

```
{ storeName,
  categories: [ { id, name } ],
  products:   [ { id, catId, name, price, was, rating, reviewCount, blurb,
                  bullets: [], imgSeed, seller, sellerKind, prime,
                  reviews: [ { by, stars, at, title, body, verified,
                               kind } ] } ] }
```

`was` is the fake strikethrough price. `sellerKind` is `brand` | `reseller` |
`dropship` | `unknown`. Reviews for the wrong product, five-star reviews of a
different item entirely, and "verified purchase" on obvious spam are all
correct and encouraged.

### market

```
{ siteName,
  regions:  [ { id, name } ],
  cats:     [ { id, name } ],
  listings: [ { id, catId, regionId, title, price, at, by, kind, body,
                imgSeed, condition } ] }
```

`price` is a string, so `"$40 obo"`, `"free"` and `"make offer"` all work.

### assistant

```
{ productName, tagline, model,
  disclaimers: [ "..." ],
  suggested:   [ "..." ],
  canned:      [ { q, a } ] }
```

The `a` answers should be fluent, confident and wrong in a specific,
checkable way — contradicting the wiki, inventing a date, citing a source
that is itself generated. Never wrong in a way that reads as a joke; wrong in
the way the real ones are.

### mail

```
{ account,
  folders:  [ { id, name, unread } ],
  messages: [ { id, folderId, from, fromAddr, subject, at, body, read,
                kind, attachments: [] } ] }
```

Mostly phishing, newsletters nobody signed up for, and three real messages.

### portal

```
{ agency, motto,
  notices:  [ "..." ],
  services: [ { id, name, blurb, status, lastUpdated,
                steps: [ "..." ],
                forms: [ { name, note } ] } ] }
```

`status` is `online` | `degraded` | `offline` | `paper-only`. `lastUpdated`
should frequently be years ago. `note` on a form is where "requires Internet
Explorer 11" goes.

### stream

```
{ siteName,
  channels: [ { id, name, subs, avatarSeed, verified, kind, about } ],
  videos:   [ { id, channelId, title, views, at, duration, description,
                thumbSeed, kind, likes,
                comments: [ { by, kind, body, likes, at } ] } ] }
```

There is no video. The player is a shell around the thumbnail, and the
`description` carries the affiliate links and the timestamps nobody made.

### dash

```
{ siteName, place,
  weather: { nowC, feelsC, summary, days: [ { day, hi, lo, summary } ] },
  transit: [ { route, status, note } ],
  energy:  { price, unit, trend },
  alerts:  [ { level, text } ],
  widgets: [ { title, lines: [ "..." ] } ] }
```

Single page, no sub-paths. `alerts[].level` is `info` | `warn` | `severe`.

---

## 6c. News that is not video

Video is the one shape this network deliberately does not lean on. Everything
below is the other shapes news actually takes.

### `news`, extended

The `news` type gains three modes. They are optional: a site with none of
them is still valid.

```
{ masthead, slogan,
  sections:  [ { id, name } ],
  articles:  [ { id, sectionId, headline, dek, byline, date, lead, body,
                 featured, kicker, readMinutes, wire, updates: [UPDATE] } ],
  live:      [ { id, headline, standfirst, open, startedAt, intervalMin,
                 keyPoints: [ "..." ],
                 entries: [ { at, label, headline, body, by } ] } ],
  factchecks:[ { id, claim, claimBy, claimWhere, claimWhen, verdict,
                 ruling, evidence: [ "..." ], sources: [ "..." ] } ],
  corrections:[ { at, articleId, kind, text } ] }

UPDATE = { at, text }
```

- `kicker` is the small category label above a headline ("COUNTY", "THE
  BRANCH LINE"). `readMinutes` prints as "6 min read".
- `wire: true` marks copy the outlet did not write. Two of the 2026 outlets
  should be running the *same wire story* nearly verbatim, because that is
  what actually happens.
- **`updates` is the developing story.** Entries whose `at` has not arrived
  yet are not shown, so the article is genuinely longer when you come back to
  it. Give one three or four updates hours apart. The page shows `Published`
  and `Updated` as separate lines when any update has landed.
- **`live` is the liveblog.** Newest entry first, red LIVE dot, "Last updated
  N minutes ago", and the pinned `keyPoints` box — which exists because
  readers arrive *midstream*, not at the top. Set `open: false` and it becomes
  the "… as it happened" artifact, which is the state most liveblogs spend
  most of their life in. `intervalMin` lets entries keep arriving on the wall
  clock while the story is open.
- `verdict` is one of `true`, `mostly-true`, `misleading`, `missing-context`,
  `false`, `unproven`. Some fact checks should themselves be wrong, and one
  should check a claim the outlet's own article made.
- `corrections` `kind` is `correction`, `clarification`, `editors-note` or
  `retraction`. A believable outlet's corrections page is longer than anyone
  would like.

### `wire`

A wire service: the best possible fit for a slot machine, because a dispatch
every few minutes forever is exactly what one is.

```
{ agency, bureau,
  categories: [ { id, name } ],
  dispatches: [ { id, catId, slug, dateline, priority, byline, at,
                  lead, body, keywords: [ "..." ], corrects, moved } ] }
```

- `slug` is the all-caps wire slug: `VERITY-SUBSTATION-2ND-LD-WRITETHRU`.
- `dateline` is `GRIDFALL, Verity Co.` — the renderer adds the em dash.
- `priority` is `bulletin`, `urgent` or `routine`. Bulletins are rare and
  short.
- `corrects` is a sentence: `"CORRECTS spelling of Pennock in 4th graf"`.
- `moved` is a timestamp string for a story that has been refiled.
- Inverted pyramid. One- and two-sentence paragraphs. Attribution in every
  paragraph. Separate sections with `___` on its own line.

### `newsletter`

```
{ title, author, cadence, subscribers, sponsorLabel,
  issues: [ { id, number, date, subject, intro,
              sections: [ { name, items: [ { headline, blurb, href } ] } ],
              sponsor: { name, copy }, signoff } ] }
```

- `intro` is first person and slightly too long, because they all are.
- Section names are playful: "The big one", "Quick hits", "One more thing".
- `sponsor` renders as "Together with …". `href` may be a `synth://` URL or
  omitted.
- Every issue ends with an unsubscribe line the renderer adds. Do not write
  one.

### `chat`

Where the forums went. The joke is structural rather than written: search
finds the dead 2009 forum thread and not the answer, because the answer is in
here and nothing can index it.

```
{ serverName, memberCount, onlineCount,
  channels: [ { id, name, topic, kind,
                messages: [ { by, at, body, kind, replyTo } ] } ] }
```

- `kind` on a channel is `text`, `announce` or `archive`.
- At least one channel should be `archive`: read-only, and holding the answer
  to something a forum thread elsewhere on the network asks and never gets.
- Messages are short. People type three in a row instead of editing.

---

## 7. A complete, working `page` site

Copy this to `net/sites/kestrel-diner-verity-us/site.json`, change the domain,
run the build. It passes the validator as written.

```json
{
  "schema": 1,
  "domain": "kestrel-diner.verity.us",
  "title": "The Blue Kestrel Diner - Official Page",
  "type": "page",
  "era": "2002",
  "skin": "geocities",
  "description": "A one-page site for a diner on Route 62 that closed in 2005.",
  "tags": ["verity", "food"],
  "links": [],
  "data": {
    "navLabel": "Menu",
    "pages": [
      {
        "id": "index",
        "name": "Home",
        "blocks": [
          { "kind": "heading", "level": 1, "text": "The Blue Kestrel Diner" },
          { "kind": "marquee", "text": "*** OPEN 6am - 2pm *** CLOSED TUESDAYS ***" },
          { "kind": "image", "seed": "kestrel-front", "imgKind": "photo",
            "caption": "The front, summer 2001" },
          { "kind": "text",
            "body": "We have been on Route 62 since [b]1974[/b]. Same booths, same coffee.\n\nCarol does the pies on Thursday. If you want one for the weekend, [i]call ahead[/i], she is not psychic.\n\nSee the [url=/hours]hours page[/url] before you drive out." },
          { "kind": "list", "ordered": false,
            "items": ["Breakfast all day", "Pie, when there is pie", "Cash preferred"] },
          { "kind": "hitcounter", "count": 4127 },
          { "kind": "guestbook", "entries": [
            { "author": "marla_t", "time": "2002-08-14",
              "body": "Best hash browns in the county. Fight me." },
            { "author": "dennis_h", "time": "2002-09-02",
              "body": "Was closed Tuesday. Sign says closed Tuesdays. My fault." }
          ] }
        ]
      },
      {
        "id": "hours",
        "name": "Hours",
        "blocks": [
          { "kind": "heading", "level": 2, "text": "Hours" },
          { "kind": "table",
            "head": ["Day", "Open", "Close"],
            "rows": [
              ["Monday", "6:00am", "2:00pm"],
              ["Tuesday", "closed", "closed"],
              ["Wednesday", "6:00am", "2:00pm"],
              ["Thursday", "6:00am", "2:00pm"],
              ["Friday", "6:00am", "3:00pm"],
              ["Saturday", "7:00am", "1:00pm"],
              ["Sunday", "7:00am", "1:00pm"]
            ] },
          { "kind": "text", "body": "Holidays we close. [u]All of them.[/u]" }
        ]
      }
    ]
  }
}
```

---

## 8. Build and check

```
python3 tools/build.py          # regenerates registry.json, search.json, dist/synthnet.html
python3 tools/validate.py       # per-problem report, non-zero exit on any error
python3 tools/validate.py --strict   # warnings fail too; what CI should run
python3 tools/build.py --check  # fails if the generated files on disk are stale
python3 tools/serve.py          # look at it
```

`build.py --check` and `validate.py --strict` together are the gate. If both
pass, the tree is internally consistent and provably offline.

---

## 9. House style

**`docs/WORLD.md` is the canon and it outranks this section.** Read it before
writing anything. If a detail is not in it, invent something consistent with
what is, then add it there.

The setting is Verity County, a mid-sized inland region. Sites dated
1998–2008 are **immutable archive** — do not edit them, and do not write
anything that contradicts them. Sites dated 2026 are the present. The gap
between the two is the entire point of the project.

The recurring threads are the Gridfall substation fire of 2003, the Verity
Rail branch-line closure, "the Signal on 62", and the Blue Kestrel.

**Write it mundane.** Real forums are mostly people arguing about parking,
correcting each other's grammar, posting recipes nobody asked for, and
misreading each other. Usernames should be inconsistent in style, timestamps
should cluster at evenings and lunch hours, and at least one person in every
thread should be wrong and unbothered about it. Nobody in 2004 knew what
would matter later — do not let them.

**In 2026, add the automation.** Most of what is posted is not posted by
anyone. Engagement farms reply within sixty seconds and never about the post.
Three aggregators rewrite the same wire story, each slightly worse. The
assistant is confident and wrong. Brands reply to grief. People post about
dead internet theory in a thread that is 60% bots, which is the only joke the
setting makes on purpose. The Ledger runs on a content pipeline and its
corrections page is longer than its front page.

**Do not make it a horror setting.** Nothing supernatural has ever been
confirmed in Verity County and nothing ever will be. It is a boring dystopia.
The Signal on 62 has a mundane explanation nobody has bothered to write down.

**Render decay, not just state.** Most of what makes a real internet feel
real is the sediment: dead outbound links, a page that says it was last
updated in 2019, a webring member whose domain lapsed, an embed that no
longer renders, a correction appended in 2024 to an article from 2011, a
"[removed]" where the good post was. Leave scars.

**Cross-link constantly.** A forum thread cites the newspaper article, the
wiki cites the forum thread, someone's blog complains about the wiki, and the
content farm reposts the blog with a stolen photo. That is what makes it read
as a network rather than a folder.
