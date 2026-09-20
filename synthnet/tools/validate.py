#!/usr/bin/env python3
"""synthnet :: tools/validate.py

Checks the whole project against the synthnet contract and exits non-zero with
a per-problem report if anything is wrong.

    python3 tools/validate.py
    python3 tools/validate.py --strict     # warnings count as failures

What it checks:
  * every site.json parses, is schema 1, and has the full envelope
  * type is one of the seven, skin is legal for that type
  * domains are unique and the folder name matches the domain
  * type-specific shape, including that every internal id reference resolves
  * every domain in "links" exists in the project
  * every synth:// URL points at a domain that exists (and warns when the path
    does not look like a path that site type can serve)
  * NO EXTERNAL REFERENCES anywhere in the tree -- this is the offline promise
  * inline markup is balanced enough not to render as literal garbage

Stdlib only, Python 3.9+.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITES_DIR = ROOT / "net" / "sites"

TYPES = ("forum", "social", "blog", "news", "wiki", "media", "page",
         # The 2026 set. See docs/WORLD.md for what each one is in-world.
         "aggregator", "qa", "board", "shop", "market", "assistant",
         "mail", "portal", "stream", "dash", "control",
         # News that is not video: a wire service filing dispatches all day,
         # and a newsletter. Plus the chat the forums migrated to, which is
         # where the searchable archive went to die.
         "wire", "newsletter", "chat")

SKINS = {
    "forum": ("phpbb-blue", "ezboard-grey", "softboard"),
    "social": ("bluebird", "myspace-black", "feedslate"),
    "blog": ("movabletype-cream", "kubrick-blue"),
    # pinkslime: the 2026 local layer. A locally-named site with no staff
    # page, no phone number, "Metro Desk" bylines and 400 identical siblings.
    "news": ("broadsheet", "portal-red", "pinkslime"),
    "wiki": ("monobook",),
    "media": ("tubeplayer",),
    "page": ("geocities", "tripod-tile", "plain-white"),
    "aggregator": ("orange-news", "round-red"),
    "qa": ("stack",),
    "board": ("yotsuba",),
    "shop": ("megastore",),
    "market": ("classified",),
    "assistant": ("chatbot",),
    "mail": ("webmail",),
    "portal": ("govsite",),
    "stream": ("tubemodern",),
    "dash": ("glassdash",),
    "control": ("control",),
    "wire": ("wireroom",),
    "newsletter": ("inbox-letter",),
    "chat": ("chatdark",),
}

ENVELOPE = ("schema", "domain", "title", "type", "era", "skin", "description",
            "links", "data")

PAGE_BLOCK_KINDS = {"heading", "text", "list", "table", "image", "marquee",
                    "hitcounter", "guestbook", "webring", "buttons"}

PATH_PREFIXES = {
    "forum": {"board", "topic", "modlog"},
    "social": {"user", "post"},
    "blog": {"post", "tag"},
    # A news site is not only articles. Live coverage, fact checks and the
    # corrections page are the shapes news actually takes that are not video,
    # which was the explicit ask.
    "news": {"section", "article", "live", "factcheck", "corrections"},
    # A living wiki is history, diffs, talk and recent changes as well
    # as articles. The 1998-2008 wiki serves the first two only, but the
    # prefix table is per TYPE, not per site.
    "wiki": {"wiki", "category", "history", "diff", "talk", "changes"},
    "media": {"watch", "channel"},
    "page": None,   # any single segment is a page id
    "aggregator": {"board", "item"},
    "qa": {"tag", "q"},
    "board": {"t", "catalog"},
    "shop": {"c", "p"},
    "market": {"c", "l"},
    "assistant": {"chat"},
    "mail": {"f", "m"},
    "portal": {"s"},
    "stream": {"w", "c"},
    "dash": set(),          # single page, no sub-paths
    "control": {"packs", "compose", "me", "storage"},
    "wire": {"d", "cat"},
    "newsletter": {"i"},
    "chat": {"c"},
}

# Domains that are MEANT to dead-end.
#
# Scam and phishing content is a large part of what 2026 VerityNet is, and a
# scam link that resolves to a real page is not a scam link. The engine already
# renders an unknown domain as a period-correct "cannot find server" page,
# which is the correct destination for these.
#
# Distinguishing "deliberately dead" from "typo" needs a rule rather than a
# vibe, so: real sites in this project use ordinary TLDs, and anything on one
# of these does not resolve and is not supposed to. Adding a real site on one
# of these TLDs would be a mistake the type checker below would not catch, so
# do not.
# Two groups, same behaviour, different intent -- keep them apart so whoever
# writes the next pack picks the right one:
#
#   scams        a link that is a lie. It is supposed to 404, and a scam link
#                that resolves is not a scam link.
#   off-net      a business or office that exists in Verity County and whose
#                website is simply not in this build. Most of the web is like
#                this, and a county where every mentioned business has an
#                archived site reads as a brochure rather than a place.
#
# Both dead-end on the engine's period-correct "cannot find server" page.
DEAD_TLDS = (
    # scams
    ".top", ".click", ".win", ".example", ".finance", ".fin", ".zip",
    ".lol", ".biz", ".hostline", ".vip", ".shop",
    # off-net
    ".synth",
)

# The other half of that rule. Real sites in this project live on these.
#
# Two lists rather than one, because one list only catches one kind of
# mistake. With only DEAD_TLDS, a typo ("wiki.gridfall.nett") reads as an
# unknown domain, which is correct -- but a *new* scam TLD invented by
# whoever writes the next content pack reads as a broken link, and the fix
# looks like "add it to the dead list", which is a rule nobody can infer.
# With only a live list, the typo silently becomes a deliberate dead end.
#
# So: a TLD in DEAD_TLDS is meant to 404. A TLD in LIVE_TLDS must resolve to
# a real site. A TLD in neither is an error that says to pick one, which is
# the only version of this that a person can act on without reading the
# source.
LIVE_TLDS = (".org", ".net", ".com", ".tv", ".blog", ".social", ".store",
             ".ai", ".gov", ".us", ".info", ".news", ".wiki", ".press",
             ".live", ".chat", ".radio")

SCAN_SUFFIXES = {".html", ".htm", ".css", ".js", ".json", ".md", ".webmanifest", ".svg"}
SKIP_DIRS = {".git", "__pycache__", "node_modules", ".idea", ".vscode"}

# Split so that this file does not trip its own scan.
_P = "htt" + "p"
NEEDLES = (
    _P + "://",
    _P + "s://",
    "/" + "/cdn",
    "@import url(" + _P,
    'src="' + _P,
    "src='" + _P,
)
ALLOWED_LITERALS = (
    _P + "://www.w3.org/2000/svg",
    _P + "://www.w3.org/1999/xhtml",
)

SYNTH_URL = re.compile(r"synth://([A-Za-z0-9._\-]+)((?:/[^\s\"'\[\]<>)]*)*)")
MARKUP_PAIRS = ("b", "i", "u", "s", "quote", "code", "list", "url")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, message):
        self.errors.append((where, message))

    def warn(self, where, message):
        self.warnings.append((where, message))


def rel(path):
    try:
        return Path(path).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


# --------------------------------------------------------------------------
# walking
# --------------------------------------------------------------------------


def walk_strings(node, prefix=""):
    """Yield (json path, string) for every string anywhere in the object."""
    if isinstance(node, str):
        yield prefix or "$", node
    elif isinstance(node, dict):
        for key in node:
            child = "%s.%s" % (prefix, key) if prefix else key
            for item in walk_strings(node[key], child):
                yield item
    elif isinstance(node, list):
        for index, value in enumerate(node):
            for item in walk_strings(value, "%s[%d]" % (prefix, index)):
                yield item


def ids_of(rows):
    out = set()
    for row in rows or []:
        if isinstance(row, dict) and isinstance(row.get("id"), str):
            out.add(row["id"])
    return out


def require(report, where, container, key, kind, label):
    """kind in {'str','num','bool','arr','obj','any'}"""
    if not isinstance(container, dict) or key not in container:
        report.error(where, "%s: missing \"%s\"" % (label, key))
        return None
    value = container[key]
    checks = {
        "str": (str, "a string"),
        "num": ((int, float), "a number"),
        "bool": (bool, "a boolean"),
        "arr": (list, "an array"),
        "obj": (dict, "an object"),
    }
    if kind in checks:
        wanted, human = checks[kind]
        if kind == "num" and isinstance(value, bool):
            report.error(where, "%s: \"%s\" must be %s" % (label, key, human))
            return None
        if not isinstance(value, wanted):
            report.error(where, "%s: \"%s\" must be %s" % (label, key, human))
            return None
    return value


# --------------------------------------------------------------------------
# per-type shape checks
# --------------------------------------------------------------------------


def check_forum(report, where, data):
    require(report, where, data, "boardName", "str", "data")
    cats = require(report, where, data, "categories", "arr", "data") or []
    topics = require(report, where, data, "topics", "arr", "data") or []
    board_ids = set()
    for ci, cat in enumerate(cats):
        label = "data.categories[%d]" % ci
        if not isinstance(cat, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        require(report, where, cat, "id", "str", label)
        require(report, where, cat, "name", "str", label)
        boards = require(report, where, cat, "boards", "arr", label) or []
        for bi, board in enumerate(boards):
            blabel = "%s.boards[%d]" % (label, bi)
            if not isinstance(board, dict):
                report.error(where, "%s: must be an object" % blabel)
                continue
            bid = require(report, where, board, "id", "str", blabel)
            require(report, where, board, "name", "str", blabel)
            if bid:
                if bid in board_ids:
                    report.error(where, "%s: duplicate board id %r" % (blabel, bid))
                board_ids.add(bid)
    seen = set()
    for ti, topic in enumerate(topics):
        label = "data.topics[%d]" % ti
        if not isinstance(topic, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        tid = require(report, where, topic, "id", "str", label)
        require(report, where, topic, "title", "str", label)
        require(report, where, topic, "author", "str", label)
        board_id = require(report, where, topic, "boardId", "str", label)
        if board_id and board_id not in board_ids:
            report.error(where, "%s: boardId %r does not match any board" % (label, board_id))
        if tid:
            if tid in seen:
                report.error(where, "%s: duplicate topic id %r" % (label, tid))
            seen.add(tid)
        posts = require(report, where, topic, "posts", "arr", label) or []
        if not posts:
            report.warn(where, "%s: topic has no posts" % label)
        for pi, post in enumerate(posts):
            plabel = "%s.posts[%d]" % (label, pi)
            if not isinstance(post, dict):
                report.error(where, "%s: must be an object" % plabel)
                continue
            require(report, where, post, "id", "str", plabel)
            require(report, where, post, "author", "str", plabel)
            require(report, where, post, "body", "str", plabel)


def check_social(report, where, data):
    profile = require(report, where, data, "profile", "obj", "data")
    if isinstance(profile, dict):
        require(report, where, profile, "handle", "str", "data.profile")
        require(report, where, profile, "displayName", "str", "data.profile")
    feed = require(report, where, data, "feed", "arr", "data") or []
    friends = require(report, where, data, "friends", "arr", "data") or []
    seen = set()
    for fi, post in enumerate(feed):
        label = "data.feed[%d]" % fi
        if not isinstance(post, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        pid = require(report, where, post, "id", "str", label)
        require(report, where, post, "author", "str", label)
        require(report, where, post, "handle", "str", label)
        require(report, where, post, "body", "str", label)
        if pid:
            if pid in seen:
                report.error(where, "%s: duplicate post id %r" % (label, pid))
            seen.add(pid)
        replies = post.get("replies", [])
        if not isinstance(replies, list):
            report.error(where, "%s: \"replies\" must be an array" % label)
        else:
            for ri, reply in enumerate(replies):
                rlabel = "%s.replies[%d]" % (label, ri)
                if not isinstance(reply, dict):
                    report.error(where, "%s: must be an object" % rlabel)
                    continue
                require(report, where, reply, "author", "str", rlabel)
                require(report, where, reply, "body", "str", rlabel)
    for xi, friend in enumerate(friends):
        label = "data.friends[%d]" % xi
        if not isinstance(friend, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        require(report, where, friend, "handle", "str", label)


def check_blog(report, where, data):
    require(report, where, data, "author", "str", "data")
    blogroll = data.get("blogroll", [])
    if not isinstance(blogroll, list):
        report.error(where, "data: \"blogroll\" must be an array")
        blogroll = []
    for bi, entry in enumerate(blogroll):
        label = "data.blogroll[%d]" % bi
        if not isinstance(entry, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        require(report, where, entry, "label", "str", label)
        require(report, where, entry, "href", "str", label)
    posts = require(report, where, data, "posts", "arr", "data") or []
    seen = set()
    for pi, post in enumerate(posts):
        label = "data.posts[%d]" % pi
        if not isinstance(post, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        pid = require(report, where, post, "id", "str", label)
        require(report, where, post, "title", "str", label)
        require(report, where, post, "body", "str", label)
        if pid:
            if pid in seen:
                report.error(where, "%s: duplicate post id %r" % (label, pid))
            seen.add(pid)
        tags = post.get("tags", [])
        if not isinstance(tags, list):
            report.error(where, "%s: \"tags\" must be an array" % label)
        comments = post.get("comments", [])
        if not isinstance(comments, list):
            report.error(where, "%s: \"comments\" must be an array" % label)
        else:
            for ci, comment in enumerate(comments):
                clabel = "%s.comments[%d]" % (label, ci)
                if not isinstance(comment, dict):
                    report.error(where, "%s: must be an object" % clabel)
                    continue
                require(report, where, comment, "author", "str", clabel)
                require(report, where, comment, "body", "str", clabel)


def check_news(report, where, data):
    require(report, where, data, "masthead", "str", "data")
    sections = require(report, where, data, "sections", "arr", "data") or []
    articles = require(report, where, data, "articles", "arr", "data") or []
    section_ids = set()
    for si, section in enumerate(sections):
        label = "data.sections[%d]" % si
        if not isinstance(section, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        sid = require(report, where, section, "id", "str", label)
        require(report, where, section, "name", "str", label)
        if sid:
            if sid in section_ids:
                report.error(where, "%s: duplicate section id %r" % (label, sid))
            section_ids.add(sid)
    seen = set()
    for ai, art in enumerate(articles):
        label = "data.articles[%d]" % ai
        if not isinstance(art, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        aid = require(report, where, art, "id", "str", label)
        require(report, where, art, "headline", "str", label)
        require(report, where, art, "body", "str", label)
        sid = require(report, where, art, "sectionId", "str", label)
        if sid and sid not in section_ids:
            report.error(where, "%s: sectionId %r does not match any section" % (label, sid))
        if aid:
            if aid in seen:
                report.error(where, "%s: duplicate article id %r" % (label, aid))
            seen.add(aid)

    # The modes that make a news site something other than a list of
    # articles. All optional; a site with none is still valid.
    def entries(report, where, live, label):
        rows, _ = _collect(report, where, live, "entries", label,
                           [("at", "any"), ("headline", "str"), ("body", "str")],
                           required=False)
        if not rows:
            report.warn(where, "%s: a liveblog with no entries" % label)

    _collect(report, where, data, "live", "data",
             [("id", "str"), ("headline", "str")],
             nested=entries, required=False)

    checks, _ = _collect(report, where, data, "factchecks", "data",
                         [("id", "str"), ("claim", "str"), ("verdict", "str"),
                          ("ruling", "str")], required=False)
    for i, row in enumerate(checks):
        if not isinstance(row, dict):
            continue
        v = row.get("verdict")
        if isinstance(v, str) and v not in VERDICTS:
            report.error(where, "data.factchecks[%d]: verdict %r is not one of %s"
                         % (i, v, sorted(VERDICTS)))

    corrections, _ = _collect(report, where, data, "corrections", "data",
                              [("text", "str")], required=False)
    for i, row in enumerate(corrections):
        if not isinstance(row, dict):
            continue
        k = row.get("kind")
        if isinstance(k, str) and k not in CORRECTION_KINDS:
            report.error(where, "data.corrections[%d]: kind %r is not one of %s"
                         % (i, k, sorted(CORRECTION_KINDS)))


def check_wiki(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    articles = require(report, where, data, "articles", "arr", "data") or []
    categories = require(report, where, data, "categories", "arr", "data") or []
    cat_ids = set()
    for ci, cat in enumerate(categories):
        label = "data.categories[%d]" % ci
        if not isinstance(cat, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        cid = require(report, where, cat, "id", "str", label)
        require(report, where, cat, "name", "str", label)
        if cid:
            if cid in cat_ids:
                report.error(where, "%s: duplicate category id %r" % (label, cid))
            cat_ids.add(cid)
    article_ids = ids_of(articles)
    for ai, art in enumerate(articles):
        label = "data.articles[%d]" % ai
        if not isinstance(art, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        require(report, where, art, "id", "str", label)
        require(report, where, art, "title", "str", label)
        # The renderer uses `summary` in four places -- the lead, the featured
        # box, the category blurb and the revision text the diff is built from
        # -- and it was not validated at all, so omitting it rendered an empty
        # lead and a blank diff rather than failing.
        require(report, where, art, "summary", "str", label)
        sections = require(report, where, art, "sections", "arr", label) or []
        for si, section in enumerate(sections):
            slabel = "%s.sections[%d]" % (label, si)
            if not isinstance(section, dict):
                report.error(where, "%s: must be an object" % slabel)
                continue
            require(report, where, section, "heading", "str", slabel)
            require(report, where, section, "body", "str", slabel)
        infobox = art.get("infobox")
        if infobox is not None:
            if not isinstance(infobox, dict):
                report.error(where, "%s: \"infobox\" must be an object" % label)
            else:
                rows = infobox.get("rows", [])
                if not isinstance(rows, list):
                    report.error(where, "%s.infobox: \"rows\" must be an array" % label)
                else:
                    for ri, row in enumerate(rows):
                        if not isinstance(row, list) or len(row) != 2:
                            report.error(where, "%s.infobox.rows[%d]: must be [label, value]"
                                         % (label, ri))
        cats = art.get("categories", [])
        if not isinstance(cats, list):
            report.error(where, "%s: \"categories\" must be an array" % label)
        else:
            for cid in cats:
                if not isinstance(cid, str):
                    report.error(where, "%s: category entries must be id strings" % label)
                elif cid not in cat_ids:
                    report.error(where, "%s: category %r does not exist" % (label, cid))
        see = art.get("seeAlso", [])
        if not isinstance(see, list):
            report.error(where, "%s: \"seeAlso\" must be an array" % label)
        else:
            for xi, entry in enumerate(see):
                xlabel = "%s.seeAlso[%d]" % (label, xi)
                if not isinstance(entry, dict):
                    report.error(where, "%s: must be {id, label}" % xlabel)
                    continue
                target = require(report, where, entry, "id", "str", xlabel)
                require(report, where, entry, "label", "str", xlabel)
                if target and target not in article_ids:
                    report.error(where, "%s: seeAlso id %r is not an article here"
                                 % (xlabel, target))


def check_media(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    channels = require(report, where, data, "channels", "arr", "data") or []
    items = require(report, where, data, "items", "arr", "data") or []
    channel_ids = set()
    for ci, channel in enumerate(channels):
        label = "data.channels[%d]" % ci
        if not isinstance(channel, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        cid = require(report, where, channel, "id", "str", label)
        require(report, where, channel, "name", "str", label)
        if cid:
            if cid in channel_ids:
                report.error(where, "%s: duplicate channel id %r" % (label, cid))
            channel_ids.add(cid)
    seen = set()
    for ii, item in enumerate(items):
        label = "data.items[%d]" % ii
        if not isinstance(item, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        iid = require(report, where, item, "id", "str", label)
        require(report, where, item, "title", "str", label)
        cid = require(report, where, item, "channelId", "str", label)
        if cid and cid not in channel_ids:
            report.error(where, "%s: channelId %r does not match any channel" % (label, cid))
        if iid:
            if iid in seen:
                report.error(where, "%s: duplicate item id %r" % (label, iid))
            seen.add(iid)
        comments = item.get("comments", [])
        if not isinstance(comments, list):
            report.error(where, "%s: \"comments\" must be an array" % label)


def check_page(report, where, data):
    pages = require(report, where, data, "pages", "arr", "data") or []
    if not pages:
        report.error(where, "data.pages: a page site needs at least one page")
    seen = set()
    for pi, page in enumerate(pages):
        label = "data.pages[%d]" % pi
        if not isinstance(page, dict):
            report.error(where, "%s: must be an object" % label)
            continue
        pid = require(report, where, page, "id", "str", label)
        require(report, where, page, "name", "str", label)
        if pid:
            if pid in seen:
                report.error(where, "%s: duplicate page id %r" % (label, pid))
            seen.add(pid)
        blocks = require(report, where, page, "blocks", "arr", label) or []
        for bi, block in enumerate(blocks):
            blabel = "%s.blocks[%d]" % (label, bi)
            if not isinstance(block, dict):
                report.error(where, "%s: must be an object" % blabel)
                continue
            kind = block.get("kind")
            if kind not in PAGE_BLOCK_KINDS:
                report.error(where, "%s: kind %r is not one of %s"
                             % (blabel, kind, ", ".join(sorted(PAGE_BLOCK_KINDS))))
                continue
            if kind == "heading":
                require(report, where, block, "text", "str", blabel)
                level = block.get("level")
                if level not in (1, 2, 3):
                    report.error(where, "%s: heading level must be 1, 2 or 3" % blabel)
            elif kind == "text":
                require(report, where, block, "body", "str", blabel)
            elif kind == "list":
                require(report, where, block, "items", "arr", blabel)
            elif kind == "table":
                require(report, where, block, "head", "arr", blabel)
                rows = require(report, where, block, "rows", "arr", blabel) or []
                for ri, row in enumerate(rows):
                    if not isinstance(row, list):
                        report.error(where, "%s.rows[%d]: must be an array" % (blabel, ri))
            elif kind == "image":
                require(report, where, block, "seed", "str", blabel)
            elif kind == "marquee":
                require(report, where, block, "text", "str", blabel)
            elif kind == "hitcounter":
                require(report, where, block, "count", "num", blabel)
            elif kind == "guestbook":
                entries = require(report, where, block, "entries", "arr", blabel) or []
                for ei, entry in enumerate(entries):
                    elabel = "%s.entries[%d]" % (blabel, ei)
                    if not isinstance(entry, dict):
                        report.error(where, "%s: must be an object" % elabel)
                        continue
                    require(report, where, entry, "author", "str", elabel)
                    require(report, where, entry, "body", "str", elabel)
            elif kind == "webring":
                require(report, where, block, "ringName", "str", blabel)
                members = require(report, where, block, "members", "arr", blabel) or []
                for mi, member in enumerate(members):
                    mlabel = "%s.members[%d]" % (blabel, mi)
                    if not isinstance(member, dict):
                        report.error(where, "%s: must be an object" % mlabel)
                        continue
                    require(report, where, member, "label", "str", mlabel)
                    require(report, where, member, "domain", "str", mlabel)


# --------------------------------------------------------------------------
# shape checks for the 2026 types
#
# These eleven had no check at all, so a shop with no products, a thread whose
# posts were strings, or a listing referencing a category that does not exist
# all passed `validate.py --strict` cleanly and then rendered as a blank page
# or threw in the console. That is the worst possible place for a content bug
# to surface, and it is about to matter a great deal more, because everything
# new gets written in these types.
#
# The seven original checks above are hand-rolled loops. Repeating that
# eleven more times would be four hundred lines of the same three mistakes, so
# the ones below are table-driven through _collect(). Same errors, same
# labels, far less to get wrong.
# --------------------------------------------------------------------------


def _collect(report, where, container, key, label, spec, nested=None,
             required=True):
    """Validate an array of objects at container[key].

    `spec` is a list of (field, kind) that every row must carry. A field
    named "id" additionally has to be unique within the array. `nested` is
    called as nested(report, where, row, row_label) for each valid row.

    Returns (rows, ids).
    """
    if not required and (not isinstance(container, dict) or key not in container):
        return [], set()
    rows = require(report, where, container, key, "arr", label) or []
    ids = set()
    for i, row in enumerate(rows):
        rl = "%s.%s[%d]" % (label, key, i)
        if not isinstance(row, dict):
            report.error(where, "%s: must be an object" % rl)
            continue
        for field, kind in spec:
            value = require(report, where, row, field, kind, rl)
            if field == "id" and isinstance(value, str):
                if value in ids:
                    report.error(where, "%s: duplicate id %r" % (rl, value))
                ids.add(value)
        if nested:
            nested(report, where, row, rl)
    return rows, ids


def _refs(report, where, rows, label, key, field, known, what):
    """Every rows[i][field] must be an id that exists in `known`."""
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        value = row.get(field)
        if isinstance(value, str) and value not in known:
            report.error(where, "%s.%s[%d]: %s %r does not match any %s"
                         % (label, key, i, field, value, what))


def check_aggregator(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    _, board_ids = _collect(report, where, data, "boards", "data",
                            [("id", "str"), ("name", "str")])

    def comments(report, where, row, label):
        # Comment trees nest arbitrarily; recurse so a malformed reply six
        # levels down is still reported with a usable path.
        _collect(report, where, row, "comments", label,
                 [("by", "str"), ("body", "str")],
                 nested=comments, required=False)
        _collect(report, where, row, "replies", label,
                 [("by", "str"), ("body", "str")],
                 nested=comments, required=False)

    links, _ = _collect(report, where, data, "links", "data",
                        [("id", "str"), ("title", "str"), ("by", "str")],
                        nested=comments)
    _refs(report, where, links, "data", "links", "boardId", board_ids, "board")


def check_qa(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    _, tag_ids = _collect(report, where, data, "tags", "data",
                          [("id", "str"), ("name", "str")])

    def answers(report, where, q, label):
        _collect(report, where, q, "answers", label,
                 [("by", "str"), ("body", "str")], required=False)
        _collect(report, where, q, "comments", label,
                 [("by", "str"), ("body", "str")], required=False)
        # tagIds is a list of ids rather than a single ref, so _refs does not
        # fit; check it here.
        for tid in q.get("tagIds") or []:
            if isinstance(tid, str) and tid not in tag_ids:
                report.error(where, "%s: tagId %r does not match any tag"
                             % (label, tid))

    _collect(report, where, data, "questions", "data",
             [("id", "str"), ("title", "str"), ("body", "str"), ("by", "str")],
             nested=answers)


def check_board(report, where, data):
    require(report, where, data, "boardName", "str", "data")

    def posts(report, where, thread, label):
        rows, _ = _collect(report, where, thread, "posts", label,
                           [("by", "str"), ("body", "str")], required=False)
        if not rows:
            report.warn(where, "%s: thread has no posts" % label)

    _collect(report, where, data, "threads", "data",
             [("id", "str"), ("subject", "str"), ("by", "str"), ("body", "str")],
             nested=posts)


def check_shop(report, where, data):
    require(report, where, data, "storeName", "str", "data")
    _, cat_ids = _collect(report, where, data, "categories", "data",
                          [("id", "str"), ("name", "str")])

    def reviews(report, where, product, label):
        _collect(report, where, product, "reviews", label,
                 [("by", "str"), ("body", "str")], required=False)

    products, _ = _collect(report, where, data, "products", "data",
                           [("id", "str"), ("name", "str"), ("blurb", "str")],
                           nested=reviews)
    _refs(report, where, products, "data", "products", "catId", cat_ids, "category")


def check_market(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    _, cat_ids = _collect(report, where, data, "cats", "data",
                          [("id", "str"), ("name", "str")])
    _, region_ids = _collect(report, where, data, "regions", "data",
                             [("id", "str"), ("name", "str")])
    listings, _ = _collect(report, where, data, "listings", "data",
                           [("id", "str"), ("title", "str"), ("body", "str"),
                            ("by", "str")])
    _refs(report, where, listings, "data", "listings", "catId", cat_ids, "category")
    _refs(report, where, listings, "data", "listings", "regionId", region_ids, "region")


def check_assistant(report, where, data):
    require(report, where, data, "productName", "str", "data")
    # The disclaimers are not decoration. This thing exists to be confidently
    # wrong, and a version of it with nothing hedging that is a different and
    # worse joke.
    disclaimers = require(report, where, data, "disclaimers", "arr", "data") or []
    if not disclaimers:
        report.warn(where, "data.disclaimers: an AI assistant with no disclaimers")
    _collect(report, where, data, "canned", "data",
             [("q", "str"), ("a", "str")])


def check_mail(report, where, data):
    require(report, where, data, "account", "str", "data")
    _, folder_ids = _collect(report, where, data, "folders", "data",
                             [("id", "str"), ("name", "str")])
    messages, _ = _collect(report, where, data, "messages", "data",
                           [("id", "str"), ("subject", "str"), ("from", "str"),
                            ("body", "str")])
    _refs(report, where, messages, "data", "messages", "folderId", folder_ids, "folder")


def check_portal(report, where, data):
    require(report, where, data, "agency", "str", "data")

    def forms(report, where, service, label):
        _collect(report, where, service, "forms", label,
                 [("name", "str")], required=False)

    _collect(report, where, data, "services", "data",
             [("id", "str"), ("name", "str"), ("blurb", "str")],
             nested=forms)


def check_stream(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    _, channel_ids = _collect(report, where, data, "channels", "data",
                              [("id", "str"), ("name", "str")])

    def comments(report, where, video, label):
        _collect(report, where, video, "comments", label,
                 [("by", "str"), ("body", "str")], required=False)

    videos, _ = _collect(report, where, data, "videos", "data",
                         [("id", "str"), ("title", "str"), ("description", "str")],
                         nested=comments)
    _refs(report, where, videos, "data", "videos", "channelId", channel_ids, "channel")


def check_dash(report, where, data):
    require(report, where, data, "siteName", "str", "data")
    require(report, where, data, "place", "str", "data")
    weather = require(report, where, data, "weather", "obj", "data")
    if isinstance(weather, dict):
        _collect(report, where, weather, "days", "data.weather",
                 [("day", "str"), ("summary", "str")], required=False)
    _collect(report, where, data, "transit", "data",
             [("route", "str"), ("status", "str")], required=False)
    _collect(report, where, data, "alerts", "data",
             [("level", "str"), ("text", "str")], required=False)
    _collect(report, where, data, "widgets", "data",
             [("title", "str")], required=False)



VERDICTS = {"true", "mostly-true", "misleading", "missing-context",
            "false", "unproven"}
PRIORITIES = {"bulletin", "urgent", "routine"}
CORRECTION_KINDS = {"correction", "clarification", "editors-note", "retraction"}


def check_wire(report, where, data):
    require(report, where, data, "agency", "str", "data")
    _, cat_ids = _collect(report, where, data, "categories", "data",
                          [("id", "str"), ("name", "str")])
    rows, _ = _collect(report, where, data, "dispatches", "data",
                       [("id", "str"), ("slug", "str"), ("dateline", "str"),
                        ("priority", "str"), ("lead", "str"), ("body", "str")])
    _refs(report, where, rows, "data", "dispatches", "catId", cat_ids, "category")
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        p = row.get("priority")
        if isinstance(p, str) and p not in PRIORITIES:
            report.error(where, "data.dispatches[%d]: priority %r is not one of %s"
                         % (i, p, sorted(PRIORITIES)))
        slug = row.get("slug")
        if isinstance(slug, str) and slug != slug.upper():
            report.warn(where, "data.dispatches[%d]: a wire slug is upper case "
                               "(%r)" % (i, slug))


def check_newsletter(report, where, data):
    require(report, where, data, "title", "str", "data")
    require(report, where, data, "author", "str", "data")

    def sections(report, where, issue, label):
        rows, _ = _collect(report, where, issue, "sections", label,
                           [("name", "str")], required=False)
        for si, section in enumerate(rows):
            if not isinstance(section, dict):
                continue
            _collect(report, where, section, "items",
                     "%s.sections[%d]" % (label, si),
                     [("headline", "str"), ("blurb", "str")], required=False)

    _collect(report, where, data, "issues", "data",
             [("id", "str"), ("date", "str"), ("subject", "str"),
              ("intro", "str")],
             nested=sections)


def check_chat(report, where, data):
    require(report, where, data, "serverName", "str", "data")

    def messages(report, where, channel, label):
        rows, _ = _collect(report, where, channel, "messages", label,
                           [("by", "str"), ("body", "str")], required=False)
        if not rows:
            report.warn(where, "%s: a channel with nothing in it" % label)

    rows, _ = _collect(report, where, data, "channels", "data",
                       [("id", "str"), ("name", "str"), ("topic", "str")],
                       nested=messages)
    # The point of this type is that the archive is here and unsearchable
    # from outside. A chat with no archive channel is just a chat.
    if rows and not any(isinstance(r, dict) and r.get("kind") == "archive"
                        for r in rows):
        report.warn(where, "data.channels: no channel marked kind 'archive'. "
                           "See docs/AUTHORING.md on what this type is for.")

def check_control(report, where, data):
    # control.verity.net is the in-app settings panel. Its renderer draws the
    # whole thing from live state, so the site.json is a stub on purpose and
    # there is nothing here to check beyond it being an object.
    return


SHAPE_CHECKS = {
    "forum": check_forum,
    "social": check_social,
    "blog": check_blog,
    "news": check_news,
    "wiki": check_wiki,
    "media": check_media,
    "page": check_page,
    "aggregator": check_aggregator,
    "qa": check_qa,
    "board": check_board,
    "shop": check_shop,
    "market": check_market,
    "assistant": check_assistant,
    "mail": check_mail,
    "portal": check_portal,
    "stream": check_stream,
    "dash": check_dash,
    "control": check_control,
    "wire": check_wire,
    "newsletter": check_newsletter,
    "chat": check_chat,
}


# --------------------------------------------------------------------------
# markup balance
# --------------------------------------------------------------------------


def check_markup(report, where, obj):
    for jsonpath, text in walk_strings(obj):
        if "[" not in text:
            continue
        for tag in MARKUP_PAIRS:
            opens = len(re.findall(r"\[%s(?:=[^\]\n]{0,200})?\]" % tag, text, re.IGNORECASE))
            closes = len(re.findall(r"\[/%s\]" % tag, text, re.IGNORECASE))
            if opens > closes:
                report.warn(where, "%s: unclosed [%s] (%d open, %d closed) -- it will render "
                                   "as literal text" % (jsonpath, tag, opens, closes))
            elif closes > opens:
                report.warn(where, "%s: stray [/%s] (%d open, %d closed)"
                            % (jsonpath, tag, opens, closes))


# --------------------------------------------------------------------------
# external reference scan
# --------------------------------------------------------------------------


def scan_external(report):
    if not ROOT.is_dir():
        report.error(rel(ROOT), "project root does not exist")
        return
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in SCAN_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            report.warn(rel(path), "could not read: %s" % exc)
            continue
        for number, line in enumerate(text.splitlines(), 1):
            probe = line
            for literal in ALLOWED_LITERALS:
                probe = probe.replace(literal, " ")
            hits = [needle for needle in NEEDLES if needle in probe]
            if hits:
                shown = line.strip()
                if len(shown) > 160:
                    shown = shown[:157] + "..."
                report.error("%s:%d" % (rel(path), number),
                             "external reference (%s): %s" % (", ".join(hits), shown))



# --------------------------------------------------------------------------
# canon: the people, and the facts they are wrong about
# --------------------------------------------------------------------------
#
# Breadth without depth is a directory. What makes 60 sites read as one county
# rather than 60 unrelated documents is that the same nine people keep turning
# up, and this is the half of that which a machine can check: they turn up
# OFTEN ENOUGH, and their handles are spelled the same way every time.
#
# It cannot check whether they are in character. That is still on the author.

CANON_PEOPLE = {
    # name in prose          canonical handle    sites it must reach
    "Karen Fennimore":      ("kfennimore",       5),
    "Dale Carver":          ("mod_dcarver",      5),
    "Walt Pennock":         ("wpennock",         5),
    "Marion Teale":         (None,               4),
    "Hal Brenner":          (None,               4),
    "Ruth Cannady":         (None,               3),
}

# A handle is a name people type, and people typing a name is exactly where
# drift starts. These are the shapes a near-miss takes.
def handle_variants(handle):
    stem = handle.replace("_", "")
    return {
        handle.replace("_", "-"),
        handle.replace("_", "."),
        stem[0] + "_" + stem[1:] if "_" not in handle else handle.replace("_", ""),
        handle.capitalize(),
        handle.upper(),
    } - {handle}


# The two facts the whole network is an argument about. WORLD.md says roughly
# half of 2026 bot claims should fail a check against the archive, so neither
# form can be asserted correct -- what CAN be asserted is that the argument
# exists at all: the truth is in the frozen layer, and BOTH forms are in 2026.
# If one of them vanishes the mechanic has quietly died, and nothing else in
# this file would notice.
# Matched in PROXIMITY to the subject, not as a bare year. "2004" occurs in
# something on almost every site on this network -- a copyright line, a post
# id, a price -- so a substring test for it measures nothing at all and would
# have passed whatever the content said. It has to be 2004 near the fire.
DISPUTES = [
    ("the substation fire year",
     r"(?:fire|substation)[^\"]{0,140}\b2003\b|\b2003\b[^\"]{0,140}(?:fire|substation)",
     r"(?:fire|substation)[^\"]{0,140}\b2004\b|\b2004\b[^\"]{0,140}(?:fire|substation)"),
    ("the Blue Kestrel closing",
     r"Kestrel[^\"]{0,140}\b2006\b|\b2006\b[^\"]{0,140}Kestrel",
     r"Kestrel[^\"]{0,140}\b1977\b[^\"]{0,80}(?:clos|shut|final|for good)"),
]


def check_canon(report, parsed):
    blobs = []
    for path, _folder, site in parsed:
        text = json.dumps(site, ensure_ascii=False)
        blobs.append((rel(path), str(site.get("era", "")), text))

    for name, (handle, want) in sorted(CANON_PEOPLE.items()):
        seen = sum(1 for _w, _e, t in blobs if name in t)
        if seen < want:
            report.warn("canon", "%s appears on %d site(s); the county needs "
                                 "them on at least %d" % (name, seen, want))
        if not handle:
            continue
        for wrong in sorted(handle_variants(handle)):
            for where, _era, text in blobs:
                if wrong in text:
                    report.error(where, "canon: %r is a misspelling of the "
                                        "handle %r" % (wrong, handle))
                    break

    for what, true_pat, wrong_pat in DISPUTES:
        right = re.compile(true_pat, re.I)
        wrong = re.compile(wrong_pat, re.I)
        archive = [w for w, e, t in blobs if "2026" not in e and right.search(t)]
        modern_true = [w for w, e, t in blobs if "2026" in e and right.search(t)]
        modern_wrong = [w for w, e, t in blobs if "2026" in e and wrong.search(t)]
        if not archive:
            report.warn("canon", "%s: no pre-2026 site states it, so a reader "
                                 "has nothing to check the bots against" % what)
        if not modern_true or not modern_wrong:
            report.warn("canon", "%s: %d 2026 site(s) get it right and %d get "
                                 "it wrong -- the argument needs both"
                        % (what, len(modern_true), len(modern_wrong)))


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(description="Validate the synthnet project.")
    parser.add_argument("--strict", action="store_true", help="treat warnings as failures")
    parser.add_argument("--quiet", action="store_true", help="only print problems")
    args = parser.parse_args(argv)

    report = Report()

    if not SITES_DIR.is_dir():
        report.error(rel(SITES_DIR), "site directory does not exist")
        sites = []
    else:
        sites = sorted(SITES_DIR.glob("*/site.json"))
    if SITES_DIR.is_dir() and not sites:
        report.error(rel(SITES_DIR), "no sites found (expected net/sites/*/site.json)")

    parsed = []      # (path, folder, site)
    domains = {}     # domain -> path

    for path in sites:
        where = rel(path)
        folder = path.parent.name
        try:
            site = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            report.error(where, "will not parse: %s" % exc)
            continue
        if not isinstance(site, dict):
            report.error(where, "top level must be an object")
            continue

        for key in ENVELOPE:
            if key not in site:
                report.error(where, "envelope: missing \"%s\"" % key)
        if site.get("schema") != 1:
            report.error(where, "envelope: \"schema\" must be 1, found %r" % site.get("schema"))

        kind = site.get("type")
        if kind not in TYPES:
            report.error(where, "envelope: type %r is not one of %s"
                         % (kind, ", ".join(TYPES)))
        else:
            skin = site.get("skin")
            if skin not in SKINS[kind]:
                report.error(where, "envelope: skin %r is not valid for type %s (choose: %s)"
                             % (skin, kind, ", ".join(SKINS[kind])))

        domain = site.get("domain")
        if not isinstance(domain, str) or not domain:
            report.error(where, "envelope: \"domain\" must be a non-empty string")
        else:
            if domain in domains:
                report.error(where, "domain %r is already used by %s" % (domain, domains[domain]))
            else:
                domains[domain] = where
            slug = domain.replace(".", "-")
            if folder != slug and not (folder.startswith(slug)
                                       and len(folder) > len(slug)
                                       and folder[len(slug)] in "-_."):
                report.error(where, "folder %r does not match domain %r (expected %r, "
                                    "optionally with a trailing suffix)" % (folder, domain, slug))

        for field, kind_name in (("title", str), ("era", str), ("description", str)):
            if field in site and not isinstance(site[field], kind_name):
                report.error(where, "envelope: \"%s\" must be a string" % field)
        if "links" in site and not isinstance(site["links"], list):
            report.error(where, "envelope: \"links\" must be an array of domains")
        if "tags" in site and not isinstance(site["tags"], list):
            report.error(where, "envelope: \"tags\" must be an array")

        data = site.get("data")
        if not isinstance(data, dict):
            report.error(where, "envelope: \"data\" must be an object")
        elif kind in SHAPE_CHECKS:
            SHAPE_CHECKS[kind](report, where, data)

        check_markup(report, where, site)
        parsed.append((path, folder, site))

    known = {d: None for d in domains}
    for path, _folder, site in parsed:
        known[site.get("domain")] = site.get("type")

    # links + synth:// cross references
    for path, _folder, site in parsed:
        where = rel(path)
        links = site.get("links")
        if isinstance(links, list):
            for target in links:
                if not isinstance(target, str):
                    report.error(where, "links: entries must be domain strings")
                elif target not in known:
                    report.error(where, "links: %r is not a domain in this project" % target)

        for jsonpath, text in walk_strings(site):
            for match in SYNTH_URL.finditer(text):
                target = match.group(1)
                raw_path = (match.group(2) or "").split("?", 1)[0]
                start = max(0, match.start() - 40)
                snippet = re.sub(r"\s+", " ", text[start:match.end() + 40]).strip()
                if target not in known:
                    if target.endswith(DEAD_TLDS):
                        continue   # a scam link, and it is supposed to 404
                    if not target.endswith(LIVE_TLDS):
                        report.error(
                            where,
                            "%s: synth://%s is on a TLD this project does not "
                            "recognise. Put it on a real domain, or -- if it "
                            "is meant to dead-end, which most scam links are "
                            "-- use a TLD from DEAD_TLDS in tools/validate.py "
                            "(or add yours there). -- %s"
                            % (jsonpath, target, snippet))
                        continue
                    report.error(where, "%s: synth://%s does not exist in this project -- %s"
                                 % (jsonpath, target, snippet))
                    continue
                target_type = known[target]
                segments = [s for s in raw_path.split("/") if s]
                if not segments:
                    continue
                allowed = PATH_PREFIXES.get(target_type, None)
                if allowed is None and target_type in PATH_PREFIXES:
                    if len(segments) > 1:
                        report.warn(where, "%s: synth://%s%s -- a page site serves a single "
                                           "segment (/<pageId>)" % (jsonpath, target, raw_path))
                elif segments[0] not in allowed:
                    report.warn(where, "%s: synth://%s%s -- a %s site serves /%s, not /%s"
                                % (jsonpath, target, raw_path, target_type,
                                   ", /".join(sorted(allowed)), segments[0]))

    check_canon(report, parsed)
    scan_external(report)

    if report.errors:
        print("ERRORS (%d)" % len(report.errors))
        for where, message in report.errors:
            print("  %s" % where)
            print("      %s" % message)
    if report.warnings:
        print("WARNINGS (%d)" % len(report.warnings))
        for where, message in report.warnings:
            print("  %s" % where)
            print("      %s" % message)

    if report.errors:
        print("FAIL: %d error(s), %d warning(s) across %d site(s)"
              % (len(report.errors), len(report.warnings), len(parsed)))
        return 1
    if report.warnings and args.strict:
        print("FAIL (--strict): %d warning(s) across %d site(s)"
              % (len(report.warnings), len(parsed)))
        return 1
    if not args.quiet:
        print("OK: %d site(s), %d warning(s), no external references"
              % (len(parsed), len(report.warnings)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
