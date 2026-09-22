#!/usr/bin/env python3
"""synthnet :: tools/build.py

Regenerates every derived file in the project:

    net/registry.json    directory of all sites (the engine boots from this)
    net/search.json      inverted index used by the search box
    dist/synthnet.html   standalone single-file bundle, for opening off a phone

Stdlib only, Python 3.9+.  Never hand-edit the three files above.

    python3 tools/build.py            rebuild everything
    python3 tools/build.py --check    exit 1 if what is on disk is stale (CI)

The build is reproducible: the "generated" stamp comes from $SOURCE_DATE when
set, otherwise from the newest site.json mtime.  Nothing here calls the wall
clock in a way that changes the output between two identical trees.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NET = ROOT / "net"
SITES_DIR = NET / "sites"
DIST = ROOT / "dist"
INDEX_HTML = ROOT / "index.html"
REGISTRY_PATH = NET / "registry.json"
SEARCH_PATH = NET / "search.json"
BUNDLE_PATH = DIST / "synthnet.html"

REGISTRY_VERSION = 1
SEARCH_VERSION = 2
MAX_POSTINGS = 200
MIN_TOKEN = 3
# 400 KB was set when the index held 252 documents, because search only ever
# built documents for seven of the eighteen site types. It now indexes all of
# them, and the network has gone from 24 sites to 36: 365 KB at this commit
# and climbing, so the old ceiling was about to fail the build over content
# doing exactly what it is supposed to do.
#
# Raised again, to 2 MB, for the push from 36 sites to ~100. Measured at that
# commit: 369,429 bytes across 810 documents and 36 sites. Scaling linearly to
# 100 sites lands at ~1,026 KB -- which is two kilobytes OVER the 1 MB ceiling,
# exactly the margin that fails a build on the last site of a batch.
#
# This is the third raise: 400 KB -> 1 MB -> 2 MB. Each one is defensible on
# its own and the trend is not. A ceiling that moves whenever content grows
# has stopped being an alarm, so it is worth writing down what this number is
# actually for: catching the index going EXPONENTIAL in site count rather than
# linear. That has happened here once -- 4.2 MB for 333 KB of content -- and
# it is the failure this guards. Linear growth with content is fine and
# expected. If a fourth raise is ever needed, the right move is to make the
# index cheaper (cap postings per term, drop the weakest) rather than to move
# the number again.
#
# The figure a phone actually waits on is the cold-load budget in
# .github/workflows/synthnet.yml; the index is fetched once and cached.
SEARCH_LIMIT = 2 * 1024 * 1024

STOPLIST = set(
    """
    a about above after again against all also am an and any are aren as at be
    because been before being below between both but by can cannot cant come
    could couldnt did didnt do does doesnt doing dont down during each even
    every few for from further get got had hadnt has hasnt have havent having
    her here hers herself him himself his how however i if in into is isnt it
    its itself just like make many may me might more most much must my myself
    no nor not now of off on once one only or other ought our ours ourselves
    out over own per put said same she should shouldnt since so some such than
    that the their theirs them themselves then there these they this those
    though through to too under until up upon us use used using very was wasnt
    way we were werent what when where which while who whom why will with
    without wont would wouldnt yes yet you your yours yourself yourselves
    """.split()
)


class BuildError(Exception):
    pass


# --------------------------------------------------------------------------
# inline markup stripping (search text only -- app/markup.js does the real work)
# --------------------------------------------------------------------------

_MARKUP_TAG = re.compile(
    r"\[/?(?:b|i|u|s|quote|code|list|url|\*)(?:=[^\]\n]{0,200})?\]", re.IGNORECASE
)
_MARKUP_IMG = re.compile(r"\[img:[^\]\n]{0,200}\]", re.IGNORECASE)
_SCHEME = re.compile(r"synth://", re.IGNORECASE)
_WS = re.compile(r"\s+")


def strip_markup(text):
    """Turn a site.json body into plain searchable/snippetable text."""
    if not isinstance(text, str) or not text:
        return ""
    out = _MARKUP_IMG.sub(" ", text)
    out = _MARKUP_TAG.sub(" ", out)
    out = _SCHEME.sub(" ", out)
    return _WS.sub(" ", out).strip()


def _txt(*parts):
    """Flatten strings / lists of strings into one stripped blob."""
    chunks = []
    for part in parts:
        if isinstance(part, str):
            s = strip_markup(part)
            if s:
                chunks.append(s)
        elif isinstance(part, (list, tuple)):
            s = _txt(*part)
            if s:
                chunks.append(s)
    return " ".join(chunks)


def _people(rows, *keys):
    out = []
    for row in rows or []:
        if isinstance(row, dict):
            for k in keys:
                v = row.get(k)
                if isinstance(v, str):
                    out.append(v)
    return out


# --------------------------------------------------------------------------
# per-type document extraction  ->  [{p, t, text}]
# --------------------------------------------------------------------------


def _doc(path, title, text):
    return {"p": path, "t": title or path, "text": text or ""}


def _docs_forum(data):
    docs = []
    for cat in data.get("categories") or []:
        if not isinstance(cat, dict):
            continue
        for board in cat.get("boards") or []:
            if not isinstance(board, dict) or not board.get("id"):
                continue
            docs.append(
                _doc(
                    "/board/%s" % board["id"],
                    board.get("name"),
                    _txt(board.get("desc"), cat.get("name")),
                )
            )
    for topic in data.get("topics") or []:
        if not isinstance(topic, dict) or not topic.get("id"):
            continue
        posts = [p for p in (topic.get("posts") or []) if isinstance(p, dict)]
        docs.append(
            _doc(
                "/topic/%s" % topic["id"],
                topic.get("title"),
                _txt(
                    topic.get("author"),
                    _people(posts, "author"),
                    [p.get("body") for p in posts],
                    [p.get("signature") for p in posts],
                ),
            )
        )
    return docs


def _docs_social(data):
    docs = []
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}
    handle = profile.get("handle")
    if handle:
        docs.append(
            _doc(
                "/user/%s" % handle,
                profile.get("displayName") or handle,
                _txt(profile.get("bio"), profile.get("location"), profile.get("mood")),
            )
        )
    for friend in data.get("friends") or []:
        if isinstance(friend, dict) and friend.get("handle"):
            docs.append(
                _doc(
                    "/user/%s" % friend["handle"],
                    friend.get("displayName") or friend["handle"],
                    _txt(friend.get("displayName"), friend.get("handle")),
                )
            )
    for post in data.get("feed") or []:
        if not isinstance(post, dict) or not post.get("id"):
            continue
        replies = [r for r in (post.get("replies") or []) if isinstance(r, dict)]
        who = post.get("author") or post.get("handle") or ""
        docs.append(
            _doc(
                "/post/%s" % post["id"],
                ("%s (@%s)" % (who, post.get("handle"))) if post.get("handle") else who,
                _txt(
                    post.get("body"),
                    _people(replies, "author", "handle"),
                    [r.get("body") for r in replies],
                ),
            )
        )
    return docs


def _docs_blog(data):
    docs = []
    tags = set()
    for post in data.get("posts") or []:
        if not isinstance(post, dict) or not post.get("id"):
            continue
        comments = [c for c in (post.get("comments") or []) if isinstance(c, dict)]
        for tag in post.get("tags") or []:
            if isinstance(tag, str):
                tags.add(tag)
        docs.append(
            _doc(
                "/post/%s" % post["id"],
                post.get("title"),
                _txt(
                    post.get("body"),
                    post.get("tags"),
                    _people(comments, "author"),
                    [c.get("body") for c in comments],
                ),
            )
        )
    for tag in sorted(tags):
        docs.append(_doc("/tag/%s" % tag, "Tag: %s" % tag, _txt(tag, data.get("author"))))
    return docs


def _docs_news(data):
    docs = []
    for section in data.get("sections") or []:
        if isinstance(section, dict) and section.get("id"):
            docs.append(
                _doc("/section/%s" % section["id"], section.get("name"), _txt(section.get("name")))
            )
    for art in data.get("articles") or []:
        if not isinstance(art, dict) or not art.get("id"):
            continue
        docs.append(
            _doc(
                "/article/%s" % art["id"],
                art.get("headline"),
                _txt(art.get("dek"), art.get("byline"), art.get("lead"), art.get("body")),
            )
        )

    for live in data.get("live") or []:
        if not isinstance(live, dict) or not live.get("id"):
            continue
        entries = [e for e in (live.get("entries") or []) if isinstance(e, dict)]
        docs.append(
            _doc(
                "/live/%s" % live["id"],
                live.get("headline"),
                _txt(live.get("standfirst"), live.get("keyPoints"),
                     _people(entries, "by"),
                     [e.get("headline") for e in entries],
                     [e.get("body") for e in entries]),
            )
        )
    for check in data.get("factchecks") or []:
        if not isinstance(check, dict) or not check.get("id"):
            continue
        docs.append(
            _doc(
                "/factcheck/%s" % check["id"],
                check.get("claim"),
                _txt(check.get("claimBy"), check.get("claimWhere"),
                     check.get("verdict"), check.get("ruling"),
                     check.get("evidence"), check.get("sources")),
            )
        )
    rows = [c for c in (data.get("corrections") or []) if isinstance(c, dict)]
    if rows:
        docs.append(
            _doc("/corrections", "Corrections and clarifications",
                 _txt([c.get("text") for c in rows],
                      [c.get("kind") for c in rows]))
        )
    return docs


def _docs_wiki(data):
    docs = []
    for cat in data.get("categories") or []:
        if isinstance(cat, dict) and cat.get("id"):
            docs.append(
                _doc("/category/%s" % cat["id"], "Category: %s" % (cat.get("name") or cat["id"]),
                     _txt(cat.get("name")))
            )
    for art in data.get("articles") or []:
        if not isinstance(art, dict) or not art.get("id"):
            continue
        infobox = art.get("infobox") if isinstance(art.get("infobox"), dict) else {}
        rows = []
        for row in infobox.get("rows") or []:
            if isinstance(row, (list, tuple)):
                rows.extend([c for c in row if isinstance(c, str)])
        sections = [s for s in (art.get("sections") or []) if isinstance(s, dict)]
        docs.append(
            _doc(
                "/wiki/%s" % art["id"],
                art.get("title"),
                _txt(
                    art.get("summary"),
                    infobox.get("caption"),
                    rows,
                    [s.get("heading") for s in sections],
                    [s.get("body") for s in sections],
                ),
            )
        )
    return docs


def _docs_media(data):
    docs = []
    for ch in data.get("channels") or []:
        if isinstance(ch, dict) and ch.get("id"):
            docs.append(_doc("/channel/%s" % ch["id"], ch.get("name"), _txt(ch.get("about"))))
    for item in data.get("items") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        comments = [c for c in (item.get("comments") or []) if isinstance(c, dict)]
        docs.append(
            _doc(
                "/watch/%s" % item["id"],
                item.get("title"),
                _txt(
                    item.get("description"),
                    item.get("uploader"),
                    _people(comments, "author"),
                    [c.get("body") for c in comments],
                ),
            )
        )
    return docs


def _block_text(block):
    if not isinstance(block, dict):
        return ""
    kind = block.get("kind")
    if kind == "heading":
        return _txt(block.get("text"))
    if kind == "text":
        return _txt(block.get("body"))
    if kind == "list":
        return _txt(block.get("items"))
    if kind == "table":
        return _txt(block.get("head"), block.get("rows"))
    if kind == "image":
        return _txt(block.get("caption"))
    if kind == "marquee":
        return _txt(block.get("text"))
    if kind == "guestbook":
        entries = [e for e in (block.get("entries") or []) if isinstance(e, dict)]
        return _txt(_people(entries, "author"), [e.get("body") for e in entries])
    if kind == "webring":
        members = [m for m in (block.get("members") or []) if isinstance(m, dict)]
        return _txt(block.get("ringName"), _people(members, "label", "domain"))
    return ""


def _docs_page(data):
    docs = []
    for page in data.get("pages") or []:
        if not isinstance(page, dict) or not page.get("id"):
            continue
        body = " ".join(t for t in (_block_text(b) for b in page.get("blocks") or []) if t)
        path = "/" if page["id"] in ("index", "home", "/") else "/%s" % page["id"]
        docs.append(_doc(path, page.get("name"), body))
    return docs


# --------------------------------------------------------------------------
# the 2026 types
#
# These eleven shipped with no builder at all, so every one of their sites
# contributed exactly one search document -- its front page -- and nothing
# else. 62chan.org holds 14 threads and 101 posts and was one result.
# shopwell.store holds 30 products and 100+ reviews and was one result. The
# whole network indexed 252 documents for roughly 900 content items, and
# nothing was obviously wrong: search returned things, just never the thing
# you wanted.
#
# Paths below must match PATH_PREFIXES in tools/validate.py and the routing in
# each app/types/*.js. A path that no renderer serves is a search result that
# 404s, which is worse than not being indexed.
# --------------------------------------------------------------------------


def _docs_aggregator(data):
    docs = []
    for board in data.get("boards") or []:
        if isinstance(board, dict) and board.get("id"):
            docs.append(_doc("/board/%s" % board["id"], board.get("name"), ""))
    for link in data.get("links") or []:
        if not isinstance(link, dict) or not link.get("id"):
            continue
        # Comment trees nest, and the replies are where the argument is.
        bodies, authors = [], []

        def walk(rows):
            for row in rows or []:
                if not isinstance(row, dict):
                    continue
                bodies.append(row.get("body"))
                authors.append(row.get("by"))
                walk(row.get("replies"))

        walk(link.get("comments"))
        docs.append(
            _doc(
                "/item/%s" % link["id"],
                link.get("title"),
                _txt(link.get("by"), link.get("domain"), authors, bodies),
            )
        )
    return docs


def _docs_qa(data):
    docs = []
    for tag in data.get("tags") or []:
        if isinstance(tag, dict) and tag.get("id"):
            docs.append(_doc("/tag/%s" % tag["id"], tag.get("name"), ""))
    for q in data.get("questions") or []:
        if not isinstance(q, dict) or not q.get("id"):
            continue
        answers = [a for a in (q.get("answers") or []) if isinstance(a, dict)]
        comments = [c for c in (q.get("comments") or []) if isinstance(c, dict)]
        docs.append(
            _doc(
                "/q/%s" % q["id"],
                q.get("title"),
                _txt(
                    q.get("body"),
                    q.get("by"),
                    q.get("closedReason"),
                    _people(answers, "by"),
                    [a.get("body") for a in answers],
                    _people(comments, "by"),
                    [c.get("body") for c in comments],
                ),
            )
        )
    return docs


def _docs_board(data):
    docs = []
    for thread in data.get("threads") or []:
        if not isinstance(thread, dict) or not thread.get("id"):
            continue
        posts = [p for p in (thread.get("posts") or []) if isinstance(p, dict)]
        docs.append(
            _doc(
                "/t/%s" % thread["id"],
                thread.get("subject") or ("Thread %s" % thread["id"]),
                _txt(
                    thread.get("body"),
                    thread.get("by"),
                    _people(posts, "by"),
                    [p.get("body") for p in posts],
                ),
            )
        )
    return docs


def _docs_shop(data):
    docs = []
    for cat in data.get("categories") or []:
        if isinstance(cat, dict) and cat.get("id"):
            docs.append(_doc("/c/%s" % cat["id"], cat.get("name"), ""))
    for p in data.get("products") or []:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        reviews = [r for r in (p.get("reviews") or []) if isinstance(r, dict)]
        docs.append(
            _doc(
                "/p/%s" % p["id"],
                p.get("name"),
                _txt(
                    p.get("blurb"),
                    p.get("bullets"),
                    p.get("seller"),
                    _people(reviews, "by"),
                    [r.get("title") for r in reviews],
                    [r.get("body") for r in reviews],
                ),
            )
        )
    return docs


def _docs_market(data):
    docs = []
    for cat in data.get("cats") or []:
        if isinstance(cat, dict) and cat.get("id"):
            docs.append(_doc("/c/%s" % cat["id"], cat.get("name"), ""))
    for row in data.get("listings") or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        docs.append(
            _doc(
                "/l/%s" % row["id"],
                row.get("title"),
                _txt(row.get("body"), row.get("by"), row.get("price"),
                     row.get("condition")),
            )
        )
    return docs


def _docs_assistant(data):
    # One page, but the canned exchanges are the content and people will
    # search for what it confidently got wrong.
    canned = [c for c in (data.get("canned") or []) if isinstance(c, dict)]
    text = _txt(
        data.get("tagline"),
        data.get("model"),
        data.get("disclaimers"),
        data.get("suggested"),
        [c.get("q") for c in canned],
        [c.get("a") for c in canned],
    )
    return [_doc("/chat", data.get("productName") or "Chat", text)] if text else []


def _docs_mail(data):
    docs = []
    for folder in data.get("folders") or []:
        if isinstance(folder, dict) and folder.get("id"):
            docs.append(_doc("/f/%s" % folder["id"], folder.get("name"), ""))
    for m in data.get("messages") or []:
        if not isinstance(m, dict) or not m.get("id"):
            continue
        docs.append(
            _doc(
                "/m/%s" % m["id"],
                m.get("subject"),
                _txt(m.get("body"), m.get("from"), m.get("fromAddr")),
            )
        )
    return docs


def _docs_portal(data):
    docs = []
    for s in data.get("services") or []:
        if not isinstance(s, dict) or not s.get("id"):
            continue
        forms = [f for f in (s.get("forms") or []) if isinstance(f, dict)]
        docs.append(
            _doc(
                "/s/%s" % s["id"],
                s.get("name"),
                _txt(
                    s.get("blurb"),
                    s.get("status"),
                    s.get("steps"),
                    [f.get("name") for f in forms],
                    [f.get("note") for f in forms],
                ),
            )
        )
    return docs


def _docs_stream(data):
    docs = []
    for ch in data.get("channels") or []:
        if isinstance(ch, dict) and ch.get("id"):
            docs.append(_doc("/c/%s" % ch["id"], ch.get("name"), _txt(ch.get("about"))))
    for v in data.get("videos") or []:
        if not isinstance(v, dict) or not v.get("id"):
            continue
        comments = [c for c in (v.get("comments") or []) if isinstance(c, dict)]
        docs.append(
            _doc(
                "/w/%s" % v["id"],
                v.get("title"),
                _txt(
                    v.get("description"),
                    _people(comments, "by"),
                    [c.get("body") for c in comments],
                ),
            )
        )
    return docs


def _docs_dash(data):
    # A dash has no sub-paths (PATH_PREFIXES gives it an empty set), so
    # everything it knows folds into the root document rather than becoming
    # pages that would 404.
    weather = data.get("weather") if isinstance(data.get("weather"), dict) else {}
    days = [d for d in (weather.get("days") or []) if isinstance(d, dict)]
    transit = [t for t in (data.get("transit") or []) if isinstance(t, dict)]
    alerts = [a for a in (data.get("alerts") or []) if isinstance(a, dict)]
    widgets = [w for w in (data.get("widgets") or []) if isinstance(w, dict)]
    text = _txt(
        data.get("place"),
        weather.get("summary"),
        [d.get("summary") for d in days],
        [t.get("route") for t in transit],
        [t.get("status") for t in transit],
        [t.get("note") for t in transit],
        [a.get("text") for a in alerts],
        [w.get("title") for w in widgets],
        [w.get("lines") for w in widgets],
    )
    return [_doc("/", data.get("siteName") or "Dashboard", text)] if text else []



def _docs_wire(data):
    docs = []
    for cat in data.get("categories") or []:
        if isinstance(cat, dict) and cat.get("id"):
            docs.append(_doc("/cat/%s" % cat["id"], cat.get("name"), ""))
    for d in data.get("dispatches") or []:
        if not isinstance(d, dict) or not d.get("id"):
            continue
        docs.append(
            _doc(
                "/d/%s" % d["id"],
                d.get("slug") or d.get("lead"),
                _txt(d.get("lead"), d.get("body"), d.get("dateline"),
                     d.get("byline"), d.get("keywords"), d.get("corrects")),
            )
        )
    return docs


def _docs_newsletter(data):
    docs = []
    for issue in data.get("issues") or []:
        if not isinstance(issue, dict) or not issue.get("id"):
            continue
        heads, blurbs = [], []
        for section in issue.get("sections") or []:
            if not isinstance(section, dict):
                continue
            heads.append(section.get("name"))
            for item in section.get("items") or []:
                if isinstance(item, dict):
                    heads.append(item.get("headline"))
                    blurbs.append(item.get("blurb"))
        sponsor = issue.get("sponsor") if isinstance(issue.get("sponsor"), dict) else {}
        docs.append(
            _doc(
                "/i/%s" % issue["id"],
                issue.get("subject") or ("Issue %s" % issue.get("number", "")),
                _txt(issue.get("intro"), heads, blurbs, issue.get("signoff"),
                     sponsor.get("name"), sponsor.get("copy")),
            )
        )
    return docs


def _docs_chat(data):
    docs = []
    for channel in data.get("channels") or []:
        if not isinstance(channel, dict) or not channel.get("id"):
            continue
        messages = [m for m in (channel.get("messages") or []) if isinstance(m, dict)]
        docs.append(
            _doc(
                "/c/%s" % channel["id"],
                "#" + str(channel.get("name") or channel["id"]),
                _txt(channel.get("topic"), _people(messages, "by"),
                     [m.get("body") for m in messages]),
            )
        )
    return docs


_DOC_BUILDERS = {
    "forum": _docs_forum,
    "social": _docs_social,
    "blog": _docs_blog,
    "news": _docs_news,
    "wiki": _docs_wiki,
    "media": _docs_media,
    "page": _docs_page,
    "aggregator": _docs_aggregator,
    "qa": _docs_qa,
    "board": _docs_board,
    "shop": _docs_shop,
    "market": _docs_market,
    "assistant": _docs_assistant,
    "mail": _docs_mail,
    "portal": _docs_portal,
    "stream": _docs_stream,
    "dash": _docs_dash,
    "wire": _docs_wire,
    "newsletter": _docs_newsletter,
    "chat": _docs_chat,
    # `control` is the in-app settings panel, not content. Deliberately absent.
}


def site_documents(site):
    """Every addressable page of a site as {p, t, text}, root first."""
    data = site.get("data") if isinstance(site.get("data"), dict) else {}
    docs = [_doc("/", site.get("title") or site.get("domain") or "/",
                 _txt(site.get("description"), site.get("era")))]
    builder = _DOC_BUILDERS.get(site.get("type"))
    if builder:
        for doc in builder(data):
            if doc["p"] == "/":
                docs[0]["text"] = (docs[0]["text"] + " " + doc["text"]).strip()
            else:
                docs.append(doc)
    return docs


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------


def iter_site_files():
    if not SITES_DIR.is_dir():
        raise BuildError("no site directory at %s" % SITES_DIR)
    return sorted(SITES_DIR.glob("*/site.json"))


def load_sites():
    """[(path, site_dict)] sorted by domain; raises on unparseable JSON."""
    loaded = []
    for path in iter_site_files():
        raw = path.read_text(encoding="utf-8")
        try:
            site = json.loads(raw)
        except ValueError as exc:
            raise BuildError("%s: invalid JSON: %s" % (_rel(path), exc))
        if not isinstance(site, dict):
            raise BuildError("%s: top level must be an object" % _rel(path))
        if not site.get("domain"):
            raise BuildError("%s: missing \"domain\"" % _rel(path))
        loaded.append((path, site))
    loaded.sort(key=lambda pair: pair[1].get("domain", ""))
    return loaded


def _rel(path):
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def _iso(epoch):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch))


def resolve_generated(paths):
    raw = os.environ.get("SOURCE_DATE") or os.environ.get("SOURCE_DATE_EPOCH")
    if raw:
        raw = raw.strip()
        if re.fullmatch(r"\d+", raw):
            return _iso(int(raw))
        return raw
    stamps = []
    for path in paths:
        try:
            stamps.append(path.stat().st_mtime)
        except OSError:
            pass
    return _iso(int(max(stamps)) if stamps else 0)


# --------------------------------------------------------------------------
# registry + search
# --------------------------------------------------------------------------


def build_registry(loaded):
    entries = []
    for path, site in loaded:
        try:
            size = path.stat().st_size
        except OSError:
            size = len(path.read_text(encoding="utf-8").encode("utf-8"))
        tags = site.get("tags")
        if not isinstance(tags, list):
            tags = []
        entries.append(
            {
                "domain": site.get("domain", ""),
                "title": site.get("title", ""),
                "type": site.get("type", ""),
                "era": site.get("era", ""),
                "skin": site.get("skin", ""),
                "description": site.get("description", ""),
                "tags": [t for t in tags if isinstance(t, str)],
                "path": _rel(path),
                "bytes": size,
            }
        )
    entries.sort(key=lambda e: e["domain"])
    return {
        "version": REGISTRY_VERSION,
        "generated": resolve_generated([p for p, _ in loaded]),
        "sites": entries,
    }


_TOKEN = re.compile(r"[^\W_]+", re.UNICODE)


def build_search(loaded):
    """{version, docs: [{d, p, t}, ...], terms: {token: [docIndex, ...]}}.

    The index is normalised: a posting is an integer into "docs", so a document
    that matches a hundred terms is still stored once.  Snippets are not in the
    index at all -- app/engine.js cuts them at query time from the site JSON,
    which is local and already cached.
    """
    docs = []
    for _path, site in loaded:
        domain = site.get("domain", "")
        for doc in site_documents(site):
            full = (doc["t"] + " " + doc["text"]).strip()
            if not full:
                continue
            docs.append({"d": domain, "p": doc["p"], "t": doc["t"], "lower": full.lower()})

    # Count occurrences, not just presence. The cap below needs to know which
    # postings are the weak ones, and the old version had no idea: it stored a
    # bare list of doc indices and then took `sorted(...)[:MAX_POSTINGS]`.
    #
    # Documents are appended in domain-alphabetical order, so a doc index IS
    # roughly the domain's position in the alphabet, and sorting by it and
    # slicing kept THE START OF THE ALPHABET. Measured before this change:
    # 187 terms were capped, and "gridfall" -- on a network whose county seat
    # is Gridfall -- held 200 postings spanning 31 domains, ending at
    # gridfalldeals.com. wiki.gridfall.net, pulse.gridfall.net and
    # webring.gridfall.net were not reachable through the index at all, while
    # engine.js:1205 called it "Searching the whole of VerityNet, offline".
    postings = {}
    for index, doc in enumerate(docs):
        counts = {}
        for match in _TOKEN.finditer(doc["lower"]):
            token = match.group(0)
            if len(token) < MIN_TOKEN or token in STOPLIST:
                continue
            counts[token] = counts.get(token, 0) + 1
        for token, freq in counts.items():
            postings.setdefault(token, []).append((index, freq))

    terms = {}
    capped = 0
    for token in sorted(postings):
        rows = postings[token]
        if len(rows) <= MAX_POSTINGS:
            terms[token] = sorted(i for i, _f in rows)
            continue
        capped += 1
        # A whole site disappearing from a common word is the failure that was
        # actually happening, so coverage comes first: the strongest document
        # from each domain, and only then the strongest of what is left.
        best = {}
        for i, freq in rows:
            dom = docs[i]["d"]
            if dom not in best or freq > best[dom][1]:
                best[dom] = (i, freq)
        strongest = sorted(best.values(), key=lambda r: (-r[1], r[0]))
        if len(strongest) > MAX_POSTINGS:
            keep = set(i for i, _f in strongest[:MAX_POSTINGS])
        else:
            keep = set(i for i, _f in strongest)
            for i, _f in sorted(rows, key=lambda r: (-r[1], r[0])):
                if len(keep) >= MAX_POSTINGS:
                    break
                keep.add(i)
        terms[token] = sorted(keep)

    if capped:
        print("search      %d term(s) hit the %d-posting cap; kept the "
              "strongest per domain first" % (capped, MAX_POSTINGS))
    table = [{"d": doc["d"], "p": doc["p"], "t": doc["t"]} for doc in docs]
    return {"version": SEARCH_VERSION, "docs": table, "terms": terms}


# --------------------------------------------------------------------------
# standalone bundle
# --------------------------------------------------------------------------

_LINK_TAG = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
_SCRIPT_SRC = re.compile(
    r"<script\b[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"'][^>]*>\s*</script\s*>", re.IGNORECASE
)
_INLINE_SCRIPT = re.compile(
    r"<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script\s*>", re.IGNORECASE | re.DOTALL
)

SW_SHIM = (
    "try{Object.defineProperty(navigator,'serviceWorker',{configurable:true,"
    "value:{register:function(){return new Promise(function(){});},"
    "addEventListener:function(){},controller:null}});}catch(e){}"
)


def parse_gate(paths, warnings):
    """node --check every script we are about to inline.

    Concatenating a file with a syntax error produced a green build and a dead
    renderer, so a parse failure has to abort.  node is optional (Termux may not
    have it): without it the gate is skipped loudly rather than failing.
    """
    node = shutil.which("node")
    if not node:
        warnings.append("node is not on PATH -- the JavaScript parse gate was SKIPPED")
        return
    for path in paths:
        proc = subprocess.run(
            [node, "--check", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", "replace").strip()
            raise BuildError(
                "%s does not parse as JavaScript; refusing to bundle it:\n%s"
                % (_rel(path), detail)
            )


LOADMAP_JS = ROOT / "app" / "loadmap.js"
_LOADMAP_ENTRY = re.compile(
    r"(\w+)\s*:\s*\{\s*js\s*:\s*'([^']+)'\s*,\s*css\s*:\s*'([^']+)'\s*\}"
)


def read_loadmap():
    """The type -> {js, css} table in app/loadmap.js, and a check that it is whole.

    index.html no longer carries the twenty renderers and twenty skin
    stylesheets; app/render.js fetches the one a page needs. The standalone
    single-file build has nothing to fetch from, so it has to inline all of
    them -- and the ONLY record of what "all of them" means is that table.

    So the table is read here, and anything on disk that is missing from it
    is a build failure. A renderer added without an entry would otherwise
    produce a green build and a site type that silently never renders, which
    is exactly the failure this project already had once when build.py
    bundled JavaScript it never parsed.
    """
    if not LOADMAP_JS.exists():
        raise BuildError("app/loadmap.js not found at %s" % _rel(LOADMAP_JS))
    text = LOADMAP_JS.read_text(encoding="utf-8")
    entries = {}
    for name, js, css in _LOADMAP_ENTRY.findall(text):
        entries[name] = {"js": js, "css": css}
    if not entries:
        raise BuildError("app/loadmap.js parsed to zero entries -- the shape changed")

    claimed_js = {e["js"] for e in entries.values()}
    claimed_css = {e["css"] for e in entries.values()}
    problems = []
    for path in sorted((ROOT / "app" / "types").glob("*.js")):
        rel = "app/types/" + path.name
        if rel not in claimed_js:
            problems.append("%s is on disk but not in app/loadmap.js, so nothing "
                            "would ever load it" % rel)
    for path in sorted((ROOT / "theme" / "skins").glob("*.css")):
        rel = "theme/skins/" + path.name
        if rel not in claimed_css:
            problems.append("%s is on disk but not in app/loadmap.js, so no page "
                            "would ever be styled by it" % rel)
    for name, entry in sorted(entries.items()):
        for key in ("js", "css"):
            if not (ROOT / entry[key]).exists():
                problems.append("app/loadmap.js maps %r to %s, which does not exist"
                                % (name, entry[key]))
    if problems:
        raise BuildError("app/loadmap.js and the files on disk disagree:\n  "
                         + "\n  ".join(problems))
    return entries


def _attr(tag, name):
    m = re.search(r"\b%s\s*=\s*[\"']([^\"']*)[\"']" % name, tag, re.IGNORECASE)
    return m.group(1) if m else ""


def _local(href):
    if not href or href.startswith("data:") or "://" in href:
        return None
    clean = href.split("?", 1)[0].split("#", 1)[0]
    while clean.startswith("./"):
        clean = clean[2:]
    clean = clean.lstrip("/")
    if not clean:
        return None
    candidate = (ROOT / clean).resolve()
    if not candidate.is_relative_to(ROOT):
        return None
    return candidate


def build_bundle(registry, sites, search, warnings):
    if not INDEX_HTML.exists():
        raise BuildError("index.html not found at %s" % INDEX_HTML)
    html = INDEX_HTML.read_text(encoding="utf-8")
    loadmap = read_loadmap()

    blob = json.dumps(
        {"registry": registry, "sites": sites, "search": search},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=False,
    )
    # "</script>" inside a string literal would close the tag early.
    blob = blob.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    embed = (
        "<script>\n/* generated by tools/build.py -- standalone bundle payload */\n"
        + SW_SHIM
        + "\nwindow.SYNTH_EMBEDDED = "
        + blob
        + ";\n</script>"
    )

    def drop_inline_sw(match):
        body = match.group(1)
        if "serviceworker" in body.lower():
            return "<!-- service worker registration omitted in the standalone bundle -->"
        return match.group(0)

    html = _INLINE_SCRIPT.sub(drop_inline_sw, html)

    def swap_link(match):
        tag = match.group(0)
        rel = _attr(tag, "rel").lower()
        href = _attr(tag, "href")
        if "manifest" in rel:
            return "<!-- web manifest omitted in the standalone bundle -->"
        if "stylesheet" in rel:
            path = _local(href)
            if path is None or not path.exists():
                warnings.append("index.html links a stylesheet that is missing: %s" % href)
                return tag
            css = path.read_text(encoding="utf-8").strip()
            return "<style>\n/* %s */\n%s\n</style>" % (href, css)
        return tag

    html = _LINK_TAG.sub(swap_link, html)

    state = {"embedded": False}
    scripts = []

    def swap_script(match):
        tag = match.group(0)
        src = match.group(1)
        name = src.split("?", 1)[0].rsplit("/", 1)[-1]
        if name in ("sw.js", "service-worker.js"):
            return "<!-- service worker omitted in the standalone bundle -->"
        path = _local(src)
        if path is None or not path.exists():
            raise BuildError("index.html references a script that is missing: %s" % src)
        scripts.append(path)
        code = path.read_text(encoding="utf-8").strip()
        if "</script" in code.lower():
            warnings.append("%s contains a literal </script -- the bundle may break" % src)
        out = "<script>\n/* %s */\n%s\n</script>" % (src, code)
        if not state["embedded"]:
            state["embedded"] = True
            out = embed + "\n" + out
        return out

    html = _SCRIPT_SRC.sub(swap_script, html)

    # ---- the deferred half -------------------------------------------
    #
    # Served, app/render.js fetches a type's renderer and stylesheet the
    # first time a page of that type is opened. This file has nothing to
    # fetch from, so everything in the loadmap goes in.
    #
    # That is also what keeps the two modes on ONE code path: with every
    # renderer inlined, SYNTH.render.has() is true for every type, so
    # ensure() resolves without touching the network and never knows which
    # mode it is in. The stylesheets carry the same data-synth-skin marker
    # the loader stamps on an injected <link>, so it will not add a second
    # copy of one that is already here.
    #
    # Position matters: immediately before app/engine.js, which is exactly
    # where these scripts sat when index.html listed them. Some renderers do
    # module-level work that reads app/live.js, app/grammar.js and the slop
    # pools, and all of those are inlined above this point.
    lazy_parts = []
    for name, entry in sorted(loadmap.items()):
        css_path = ROOT / entry["css"]
        lazy_parts.append(
            '<style data-synth-skin="%s">\n/* %s */\n%s\n</style>'
            % (name, entry["css"], css_path.read_text(encoding="utf-8").strip())
        )
    for name, entry in sorted(loadmap.items()):
        js_path = ROOT / entry["js"]
        code = js_path.read_text(encoding="utf-8").strip()
        if "</script" in code.lower():
            warnings.append("%s contains a literal </script -- the bundle may break"
                            % entry["js"])
        scripts.append(js_path)
        lazy_parts.append("<script>\n/* %s */\n%s\n</script>" % (entry["js"], code))

    anchor = "<script>\n/* app/engine.js */"
    if anchor not in html:
        raise BuildError(
            "index.html no longer loads app/engine.js, so there is nowhere to "
            "put the twenty renderers the standalone build has to inline. "
            "Move the anchor in build_bundle() rather than dropping them."
        )
    html = html.replace(anchor, "\n".join(lazy_parts) + "\n" + anchor, 1)

    parse_gate(scripts, warnings)

    if not state["embedded"]:
        # No external scripts at all: inject the payload just before </head>.
        if "</head>" in html:
            html = html.replace("</head>", embed + "\n</head>", 1)
        else:
            html = embed + "\n" + html
        warnings.append("index.html had no <script src> tags; payload injected into <head>")
    return html


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=False) + "\n"


def dumps_search(obj):
    """search.json is machine-read only and size-critical -- no pretty-printing."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=False) + "\n"


SW_PATH = ROOT / "sw.js"
_SW_SHELL = re.compile(r"(var SHELL = \[)(.*?)(\];)", re.DOTALL)
_SW_VERSION = re.compile(r"(var CACHE_VERSION = ')([^']*)(';)")

CONTROL_PATH = ROOT / "app" / "control.js"
_STARTERS = re.compile(r"(var STARTERS = )(\{.*?\})(;\n)", re.DOTALL)


def build_starters(warnings):
    """Rewrite control.js's STARTERS from tools/new_site.py's builders.

    The composer's "Insert starter" button had six starters written by hand
    and every one of them was wrong -- not out of date, wrong: `blog` offered
    `tagline` and `posts[].title` where the renderer reads `author` and
    `posts`, `wiki` offered `pages[].slug` where it reads `articles`, and
    `homepage` named a type that has not existed since it was renamed `page`.
    The other fourteen fell through to `{"intro":"","items":[]}`, which fits
    no renderer in the project. The one control whose job is to give you a
    correct starting point gave you a broken one, for every type.

    new_site.py already carries a body per type that validate.py --strict
    accepts and that renders, because the scaffolding CLI needs the same
    thing. Deriving from it deletes the second copy rather than correcting
    it, and `build.py --check` keeps them in step.
    """
    sys.path.insert(0, str(ROOT / "tools"))
    try:
        import new_site
    except Exception as exc:                      # pragma: no cover
        warnings.append("cannot read tools/new_site.py for the composer "
                        "starters: %s" % exc)
        return CONTROL_PATH.read_text(encoding="utf-8")

    bodies = {}
    for kind in sorted(new_site.TYPES):
        make = new_site._DATA.get(kind)
        if make is None:
            warnings.append("no starter body for type %r in new_site.py, so "
                            "the composer will have none either" % kind)
            continue
        bodies[kind] = make("Your Site")

    block = json.dumps(bodies, indent=2, sort_keys=True, ensure_ascii=False)
    block = "\n".join("  " + line if line.strip() else line
                      for line in block.splitlines()).lstrip()

    current = CONTROL_PATH.read_text(encoding="utf-8")
    out, hits = _STARTERS.subn(
        lambda m: m.group(1) + block + m.group(3), current)
    if hits != 1:
        warnings.append(
            "app/control.js has no single 'var STARTERS = {...};' block to "
            "regenerate, so the composer's starters are whatever is there")
        return current
    return out


def cache_version(entries, pending):
    """A name for the cache that changes when what it holds changes.

    sw.js is cache-first with no revalidation -- `if (hit) return hit;` --
    and activate() only drops caches whose key is not CACHE_VERSION. So the
    version IS the invalidation, and it was the string 'synthnet-v1' from the
    first commit of this project to this one. Measured: register the worker,
    edit a site file, reload, and the returning browser is served the old
    title while a fresh profile gets the new one.

    It survived because sw.js only changes when the SHELL *list* changes --
    adding or removing a file -- and eleven rounds of fixes changed content,
    not the file list. Every check here starts from a fresh profile, which is
    the one state in which none of this can show.

    Hashed, not stamped. resolve_generated() falls back to source mtimes and
    git does not preserve those, so an mtime-derived version would differ on
    every clone and leave the committed sw.js permanently stale. A hash over
    the bytes moves exactly when the bytes move and is the same on every
    machine.

    The per-site JSON is in here too, though it is not precached: the fetch
    handler caches it on first visit and nothing ever refreshes it, so a
    content edit has to move the version or the site you have already opened
    is frozen for good.

    registry.json and search.json are deliberately NOT hashed by their own
    text, even though both are precached. They carry `generated`, which comes
    from source mtimes when $SOURCE_DATE is unset, and git does not preserve
    mtimes -- hashing them would make the version differ on every clone, so
    the committed sw.js would be stale the moment anyone checked it out.
    Both are pure functions of the site files below, which are hashed, so
    nothing is lost by deriving from the source instead of the product.
    """
    derived = {_rel(REGISTRY_PATH).replace("\\", "/"),
               _rel(SEARCH_PATH).replace("\\", "/")}
    # Files THIS build is about to write have to be hashed as they will be,
    # not as they are on disk. control.js is one: build_starters() rewrites
    # it, and hashing the stale copy made the build non-idempotent -- the
    # next run would see the new control.js and produce a different version,
    # so `build --check` failed on a tree nobody had touched.
    digest = hashlib.sha1()
    for entry in entries:
        rel = entry[2:] if entry.startswith("./") else entry
        digest.update(entry.encode("utf-8") + b"\0")
        if not rel or rel in derived:
            continue            # './' is index.html, already in the list
        if rel in pending:
            digest.update(pending[rel].encode("utf-8"))
        else:
            try:
                digest.update((ROOT / rel).read_bytes())
            except OSError:
                digest.update(b"<missing>")
        digest.update(b"\0")
    for path in sorted(SITES_DIR.glob("*/site.json")):
        digest.update(str(path.relative_to(ROOT)).encode("utf-8") + b"\0")
        digest.update(path.read_bytes() + b"\0")
    return "synthnet-" + digest.hexdigest()[:12]


def build_service_worker(warnings, pending):
    """Regenerate sw.js's precache list from what index.html actually loads.

    This list used to be maintained by hand, and it drifted exactly the way
    hand-maintained lists do: it named three files that did not exist and
    omitted the main stylesheet, so every cold load logged 404s and the
    offline shell came back unstyled. The install step swallows per-file
    errors, so nothing failed loudly -- it just quietly cached the wrong set.

    Deriving it from index.html means the two cannot disagree. Adding a
    stylesheet or a script to the page is now the whole change.

    index.html is no longer the whole story, though: the twenty renderers and
    twenty skin stylesheets moved out of it into app/loadmap.js, and
    app/render.js fetches them on demand. Deriving from the page alone
    dropped all forty from the precache and quietly broke offline for any
    site type you had not already visited -- the same class of failure this
    function exists to prevent, arriving from the other direction. Both
    sources, then.

    Deferring them changes WHEN the first paint happens, not how many bytes
    a first visit eventually pulls. The service worker still fetches
    everything; it just does it after the page is on screen instead of
    before.
    """
    html = INDEX_HTML.read_text(encoding="utf-8")
    assets = []
    for tag in _LINK_TAG.findall(html):
        rel = (_attr(tag, "rel") or "").lower()
        if "stylesheet" not in rel and rel != "manifest":
            continue
        path = _local(_attr(tag, "href") or "")
        if path:
            assets.append(_rel(path).replace("\\", "/"))
    for match in _SCRIPT_SRC.finditer(html):
        path = _local(match.group(1))
        if path:
            assets.append(_rel(path).replace("\\", "/"))

    # Everything app/render.js can fetch at navigation time. Without these the
    # app is offline-complete only for the site types you happened to open
    # while you still had a network.
    for _name, entry in sorted(read_loadmap().items()):
        assets.append(entry["css"])
        assets.append(entry["js"])

    # The generated data files are not referenced by a tag but are fetched on
    # boot, so the offline shell is incomplete without them.
    entries = ["./", "./index.html"]
    for a in assets:
        entry = "./" + a
        if entry not in entries:
            entries.append(entry)
    for extra in ("./net/registry.json", "./net/search.json"):
        if extra not in entries:
            entries.append(extra)

    body = "\n" + ",\n".join("  '%s'" % e for e in entries) + "\n"
    current = SW_PATH.read_text(encoding="utf-8")
    match = _SW_SHELL.search(current)
    if not match:
        warnings.append("sw.js has no 'var SHELL = [...]' block to regenerate")
        return current
    out = current[:match.start(2)] + body + current[match.end(2):]

    version = cache_version(entries, pending)
    out, hits = _SW_VERSION.subn(lambda m: m.group(1) + version + m.group(3), out)
    if hits != 1:
        warnings.append(
            "sw.js has no single \"var CACHE_VERSION = '...';\" line to "
            "regenerate, so the cache will never be invalidated")
    return out


def compute(warnings):
    loaded = load_sites()
    registry = build_registry(loaded)
    search = build_search(loaded)
    sites = {}
    for _path, site in loaded:
        sites[site.get("domain", "")] = site
    control_js = build_starters(warnings)
    service_worker = build_service_worker(warnings, {
        _rel(CONTROL_PATH).replace("\\", "/"): control_js,
    })
    bundle = build_bundle(registry, sites, search, warnings)
    return {
        REGISTRY_PATH: dumps(registry),
        SEARCH_PATH: dumps_search(search),
        BUNDLE_PATH: bundle,
        SW_PATH: service_worker,
        CONTROL_PATH: control_js,
    }, registry, search


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the synthnet derived files.")
    parser.add_argument("--check", action="store_true",
                        help="do not write; exit 1 if the files on disk are stale")
    parser.add_argument("--quiet", action="store_true", help="only report problems")
    args = parser.parse_args(argv)

    warnings = []
    try:
        outputs, registry, search = compute(warnings)
    except BuildError as exc:
        sys.stderr.write("build failed: %s\n" % exc)
        return 2

    for note in warnings:
        sys.stderr.write("warning: %s\n" % note)

    search_bytes = len(outputs[SEARCH_PATH].encode("utf-8"))
    if search_bytes > SEARCH_LIMIT:
        sys.stderr.write(
            "build failed: %s is %d bytes (%s), over the %s ceiling.\n"
            "The index must stay normalised -- integer postings into \"docs\", no\n"
            "snippets and no repeated domain/path/title strings.\n"
            % (_rel(SEARCH_PATH), search_bytes, _human(search_bytes), _human(SEARCH_LIMIT))
        )
        return 2

    if args.check:
        stale = []
        for path, text in outputs.items():
            if not path.exists():
                stale.append("%s is missing" % _rel(path))
            elif path.read_text(encoding="utf-8") != text:
                stale.append("%s is out of date" % _rel(path))
        if stale:
            for line in stale:
                sys.stderr.write("stale: %s\n" % line)
            sys.stderr.write("run: python3 tools/build.py\n")
            return 1
        if not args.quiet:
            print("up to date: %d sites, %d search terms"
                  % (len(registry["sites"]), len(search["terms"])))
        return 0

    for path, text in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    if not args.quiet:
        total = sum(entry["bytes"] for entry in registry["sites"])
        bundle_bytes = len(outputs[BUNDLE_PATH].encode("utf-8"))
        print("sites      %d (%s of site.json)" % (len(registry["sites"]), _human(total)))
        print("registry   %s  (%s)" % (_rel(REGISTRY_PATH),
                                       _human(len(outputs[REGISTRY_PATH].encode("utf-8")))))
        print("search     %s  (%s, %d bytes, %d terms, %d docs)"
              % (_rel(SEARCH_PATH), _human(search_bytes), search_bytes,
                 len(search["terms"]), len(search["docs"])))
        print("bundle     %s  (%s, %d bytes)" % (_rel(BUNDLE_PATH), _human(bundle_bytes),
                                                 bundle_bytes))
        print("generated  %s" % registry["generated"])
        print("search.json %d bytes, ceiling %d bytes" % (search_bytes, SEARCH_LIMIT))
    return 0


def _human(n):
    step = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if step < 1024.0 or unit == "GB":
            return ("%.0f %s" % (step, unit)) if unit == "B" else ("%.1f %s" % (step, unit))
        step /= 1024.0
    return "%d B" % n


if __name__ == "__main__":
    sys.exit(main())
