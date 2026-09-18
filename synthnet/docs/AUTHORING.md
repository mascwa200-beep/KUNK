# Authoring a synthnet site

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

| type | skins |
|---|---|
| `forum` | `phpbb-blue`, `ezboard-grey` |
| `social` | `bluebird`, `myspace-black` |
| `blog` | `movabletype-cream`, `kubrick-blue` |
| `news` | `broadsheet`, `portal-red` |
| `wiki` | `monobook` |
| `media` | `tubeplayer` |
| `page` | `geocities`, `tripod-tile`, `plain-white` |

---

## 3. Paths per type

The renderers and your content must agree on these. Nothing else routes.

| type | paths |
|---|---|
| `forum` | `/` `/board/<boardId>` `/topic/<topicId>` |
| `social` | `/` `/user/<handle>` `/post/<postId>` |
| `blog` | `/` `/post/<postId>` `/tag/<tag>` |
| `news` | `/` `/section/<sectionId>` `/article/<articleId>` |
| `wiki` | `/` `/wiki/<articleId>` `/category/<categoryId>` |
| `media` | `/` `/watch/<itemId>` `/channel/<channelId>` |
| `page` | `/` `/<pageId>` |

For a `page` site, the page whose `id` is `index` is the root.

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

The setting is Verity County, a mid-sized inland region, 2001-2008. The
recurring threads are the Gridfall substation fire of 2003, the Verity Rail
branch-line closure, "the Signal on 62", and the Blue Kestrel.

Write it mundane. Real forums are mostly people arguing about parking,
correcting each other's grammar, posting recipes nobody asked for, and
misreading each other. Usernames should be inconsistent in style, timestamps
should cluster at evenings and lunch hours, and at least one person in every
thread should be wrong and unbothered about it. Nobody in 2004 knew what would
matter later — do not let them.

Cross-link constantly. A forum thread cites the newspaper article, the wiki
cites the forum thread, someone's blog complains about the wiki. That is what
makes it read as a network rather than a folder.
