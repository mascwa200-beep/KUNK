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
         "mail", "portal", "stream", "dash", "control")

SKINS = {
    "forum": ("phpbb-blue", "ezboard-grey"),
    "social": ("bluebird", "myspace-black"),
    "blog": ("movabletype-cream", "kubrick-blue"),
    "news": ("broadsheet", "portal-red"),
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
}

ENVELOPE = ("schema", "domain", "title", "type", "era", "skin", "description",
            "links", "data")

PAGE_BLOCK_KINDS = {"heading", "text", "list", "table", "image", "marquee",
                    "hitcounter", "guestbook", "webring"}

PATH_PREFIXES = {
    "forum": {"board", "topic"},
    "social": {"user", "post"},
    "blog": {"post", "tag"},
    "news": {"section", "article"},
    "wiki": {"wiki", "category"},
    "media": {"watch", "channel"},
    "page": None,   # any single segment is a page id
    "aggregator": {"board", "item"},
    "qa": {"tag", "q"},
    "board": {"t"},
    "shop": {"c", "p"},
    "market": {"c", "l"},
    "assistant": {"chat"},
    "mail": {"f", "m"},
    "portal": {"s"},
    "stream": {"w", "c"},
    "dash": set(),          # single page, no sub-paths
    "control": {"packs", "compose", "me", "storage"},
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
DEAD_TLDS = (".top", ".click", ".win", ".example", ".finance", ".zip", ".lol")

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


SHAPE_CHECKS = {
    "forum": check_forum,
    "social": check_social,
    "blog": check_blog,
    "news": check_news,
    "wiki": check_wiki,
    "media": check_media,
    "page": check_page,
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
