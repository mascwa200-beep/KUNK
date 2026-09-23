#!/usr/bin/env python3
"""synthnet :: tools/new_site.py

Scaffold a new site with a minimal, already-valid skeleton.

    python3 tools/new_site.py boards.gridfall.net forum
    python3 tools/new_site.py kestrel.verity.us page --skin geocities

Writes net/sites/<domain-with-dashes>/site.json and refuses to overwrite an
existing one.  Everything it writes passes tools/validate.py as-is; edit the
placeholder content, then run tools/build.py.

Stdlib only, Python 3.9+.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITES_DIR = ROOT / "net" / "sites"

# Which types exist, and which skins are legal for each, come from
# validate.py -- the thing that is going to reject the file this tool writes.
#
# They used to be restated here, and both copies had drifted: the type list
# named seven of the twenty-one, so `new_site.py <domain> chat` answered
# "invalid choice" and thirteen of the twenty authorable types could not be
# scaffolded at all; and the skin lists had missed softboard, feedslate and
# pinkslime, so the tool refused skins the validator accepts. A scaffolder
# that disagrees with the validator about what is legal is worse than no
# scaffolder.
#
# `control` is excluded on purpose: it is the in-app settings panel, one
# site that already exists, and docs/AUTHORING.md says not to author one.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import SKINS as _VALID_SKINS  # noqa: E402

SKINS = {k: list(v) for k, v in _VALID_SKINS.items() if k != "control"}
TYPES = sorted(SKINS)

ERA = "2004"


def _title_from(domain):
    head = domain.split(".")[0].replace("-", " ").replace("_", " ")
    return head.title() if head else domain


def skeleton(domain, kind, skin):
    title = _title_from(domain)
    data = _DATA[kind](title)
    return {
        "schema": 1,
        "domain": domain,
        "title": title,
        "type": kind,
        "era": ERA,
        "skin": skin,
        "description": "One sentence about %s. Replace this." % title,
        "tags": ["verity-county"],
        "links": [],
        "data": data,
    }


def _forum(title):
    return {
        "boardName": title,
        "categories": [
            {
                "id": "cat-main",
                "name": "Main",
                "boards": [
                    {
                        "id": "b-general",
                        "name": "General Discussion",
                        "desc": "Anything that does not fit elsewhere.",
                        "topicCount": 1,
                        "postCount": 1,
                        "lastPost": {"author": "admin", "time": "2004-03-02 19:14"},
                    }
                ],
            }
        ],
        "topics": [
            {
                "id": "t-1",
                "boardId": "b-general",
                "title": "Board rules - read before posting",
                "author": "admin",
                "time": "2004-03-02 19:14",
                "replies": 0,
                "views": 214,
                "sticky": True,
                "locked": True,
                "posts": [
                    {
                        "id": "p-1",
                        "author": "admin",
                        "authorTitle": "Administrator",
                        "authorPosts": 1412,
                        "authorJoined": "2002-11-04",
                        "avatarSeed": "admin",
                        "time": "2004-03-02 19:14",
                        "body": "Keep it civil. No all-caps thread titles.\n\n"
                                "[b]That means you.[/b]",
                        "signature": "-- the management",
                    }
                ],
            }
        ],
    }


def _social(title):
    return {
        "profile": {
            "handle": "newuser",
            "displayName": title,
            "avatarSeed": "newuser",
            "bio": "Replace this bio.",
            "location": "Verity County",
            "joined": "2004-01-09",
            "following": 41,
            "followers": 37,
            "mood": "ok i guess",
        },
        "feed": [
            {
                "id": "s-1",
                "author": title,
                "handle": "newuser",
                "avatarSeed": "newuser",
                "time": "2004-03-02 19:14",
                "body": "first post. still working out how this thing works.",
                "likes": 2,
                "reposts": 0,
                "replies": [
                    {
                        "id": "s-1-r1",
                        "author": "Dana R.",
                        "handle": "danar",
                        "avatarSeed": "danar",
                        "time": "2004-03-02 20:02",
                        "body": "welcome!",
                    }
                ],
            }
        ],
        "friends": [
            {"handle": "danar", "displayName": "Dana R.", "avatarSeed": "danar"}
        ],
    }


def _blog(title):
    return {
        "author": "Replace Me",
        "tagline": "A weblog from Verity County.",
        "about": "Replace this about text.",
        "blogroll": [{"label": "Verity County Wiki", "href": "synth://wiki.example/"}],
        "posts": [
            {
                "id": "b-1",
                "title": "First post",
                "date": "2004-03-02",
                "tags": ["meta"],
                "body": "Testing the new setup.\n\nIt seems to work.",
                "comments": [
                    {"author": "Dana R.", "time": "2004-03-03 08:11", "body": "It works."}
                ],
            }
        ],
    }


def _news(title):
    return {
        "masthead": title,
        "slogan": "Serving Verity County since 1974",
        "sections": [{"id": "sec-local", "name": "Local"}],
        "articles": [
            {
                "id": "a-1",
                "sectionId": "sec-local",
                "headline": "Council defers parking decision again",
                "dek": "Third deferral in as many months.",
                "byline": "Staff report",
                "date": "2004-03-02",
                "lead": "The council voted 4-3 to defer.",
                "body": "The council voted 4-3 to defer a decision on "
                        "overnight parking on Mill Street.\n\nIt returns in April.",
                "featured": True,
            }
        ],
    }


def _wiki(title):
    return {
        "siteName": title,
        "articles": [
            {
                "id": "verity-county",
                "title": "Verity County",
                "summary": "A mid-sized inland county. Replace this summary.",
                "infobox": {
                    "caption": "Verity County",
                    "rows": [["Seat", "Verity"], ["Founded", "1841"]],
                },
                "sections": [
                    {"heading": "History", "body": "Replace this section body."}
                ],
                "categories": ["cat-places"],
                "seeAlso": [],
            }
        ],
        "categories": [{"id": "cat-places", "name": "Places"}],
    }


def _media(title):
    return {
        "siteName": title,
        "channels": [
            {
                "id": "ch-1",
                "name": "verity_uploads",
                "subscribers": 118,
                "about": "Clips from around the county.",
                "avatarSeed": "ch1",
            }
        ],
        "items": [
            {
                "id": "v-1",
                "channelId": "ch-1",
                "title": "Drive down Route 62 (raw)",
                "uploader": "verity_uploads",
                "uploaded": "2004-03-02",
                "views": 1204,
                "duration": "6:41",
                "description": "Camcorder on the dashboard. Sound is bad.",
                "thumbSeed": "v1",
                "comments": [
                    {"author": "danar", "time": "2004-03-04", "body": "turn the radio down"}
                ],
            }
        ],
    }


def _page(title):
    return {
        "navLabel": "Navigation",
        "pages": [
            {
                "id": "index",
                "name": "Home",
                "blocks": [
                    {"kind": "heading", "level": 1, "text": title},
                    {"kind": "marquee", "text": "*** under construction ***"},
                    {"kind": "text", "body": "Welcome to my page. [b]Replace this.[/b]"},
                    {"kind": "list", "ordered": False, "items": ["One", "Two"]},
                    {"kind": "hitcounter", "count": 1042},
                ],
            }
        ],
    }


# ---------------------------------------------------------------------------
# The 2026 set.
#
# These thirteen had no builder and no entry in TYPES, so `new_site.py <domain>
# chat` answered "invalid choice" -- the scaffolding tool could not scaffold
# thirteen of the twenty types the app draws. Each of these is the smallest
# body that tools/validate.py --strict accepts for its type, with every
# cross-reference (catId, boardId, channelId) pointing at something that is
# actually here.
# ---------------------------------------------------------------------------


def _aggregator(title):
    return {
        "siteName": title,
        "boards": [{"id": "b-main", "name": "Main"}],
        "links": [
            {
                "id": "l-001",
                "boardId": "b-main",
                "title": "Something somebody submitted",
                # No url on purpose: a link row without one is a text post,
                # which these sites are full of. A placeholder url would
                # have to name a site that exists, because validate.py
                # resolves every synth:// -- and a scaffold should not
                # depend on some other site still being there.
                "by": "poster",
                "points": 12,
                "comments": [{"by": "replier", "body": "Replace this."}],
            }
        ],
    }


def _qa(title):
    return {
        "siteName": title,
        "tags": [{"id": "t-general", "name": "general"}],
        "questions": [
            {
                "id": "q-001",
                "title": "How do I replace this question?",
                "body": "Edit the site.json. Replace this.",
                "by": "asker",
                "tagIds": ["t-general"],
                "votes": 3,
                "answers": [{"by": "answerer", "body": "Like that.", "votes": 1}],
            }
        ],
    }


def _board(title):
    return {
        "boardName": title,
        "threads": [
            {
                "id": "t-001",
                "subject": "Replace this thread",
                "by": "Anonymous",
                "body": "And this post.",
                "posts": [{"by": "Anonymous", "body": "And this reply."}],
            }
        ],
    }


def _shop(title):
    return {
        "storeName": title,
        "categories": [{"id": "c-main", "name": "Everything"}],
        "products": [
            {
                "id": "p-001",
                "categoryId": "c-main",
                "name": "A thing for sale",
                "blurb": "One sentence about the thing. Replace this.",
                "price": "19.99",
                "reviews": [{"by": "buyer", "body": "It arrived.", "stars": 4}],
            }
        ],
    }


def _market(title):
    return {
        "siteName": title,
        "cats": [{"id": "c-misc", "name": "Miscellaneous"}],
        "regions": [{"id": "r-gridfall", "name": "Gridfall"}],
        "listings": [
            {
                "id": "l-001",
                "catId": "c-misc",
                "regionId": "r-gridfall",
                "title": "Something for sale",
                "body": "Collection only. Replace this.",
                "by": "seller",
            }
        ],
    }


def _assistant(title):
    return {
        "productName": title,
        "disclaimers": [
            "%s can make mistakes. Check important information." % title,
        ],
        "canned": [
            {"q": "What is this?", "a": "An answer that sounds right. Replace this."},
        ],
    }


def _mail(title):
    return {
        "account": "you@%s" % title.lower().replace(" ", ""),
        "folders": [{"id": "f-inbox", "name": "Inbox"}],
        "messages": [
            {
                "id": "m-001",
                "folderId": "f-inbox",
                "subject": "Replace this message",
                "from": "somebody@verity.net",
                "body": "And this body.",
            }
        ],
    }


def _portal(title):
    return {
        "agency": title,
        "services": [
            {
                "id": "s-001",
                "name": "A Service This Office Provides",
                "blurb": "One sentence about it. Replace this.",
                "status": "Open",
                "forms": [{"name": "Form 1A"}],
            }
        ],
    }


def _stream(title):
    return {
        "siteName": title,
        "channels": [{"id": "ch-001", "name": "A Channel"}],
        "videos": [
            {
                "id": "v-001",
                "channelId": "ch-001",
                "title": "A video with a title like this",
                "description": "What it is about. Replace this.",
                "views": 1204,
                "comments": [{"by": "viewer", "kind": "human", "body": "first"}],
            }
        ],
    }


def _dash(title):
    return {
        "siteName": title,
        "place": "Gridfall",
        "weather": {
            "now": "Overcast",
            "days": [{"day": "Today", "summary": "Overcast, turning to rain."}],
        },
        "transit": [{"route": "Route 3", "status": "On time"}],
        "alerts": [{"level": "info", "text": "Nothing is wrong. Replace this."}],
        "widgets": [{"title": "A Panel"}],
    }


def _wire(title):
    return {
        "agency": title,
        "bureau": "Gridfall",
        "categories": [{"id": "cat-county", "name": "County"}],
        "dispatches": [
            {
                "id": "d-001",
                "catId": "cat-county",
                "slug": "REPLACE-THIS",
                "dateline": "GRIDFALL",
                "priority": "routine",
                "lead": "One sentence that carries the story.",
                "body": "The rest of it. Replace this.",
            }
        ],
    }


def _newsletter(title):
    return {
        "title": title,
        "author": "The Editor",
        "cadence": "Weekly",
        "issues": [
            {
                "id": "i-001",
                "number": 1,
                "date": "2026-01-08",
                "subject": "Issue one",
                "intro": "What this letter is for. Replace this.",
                "sections": [
                    {
                        "name": "This week",
                        "items": [
                            {"headline": "Something happened",
                             "blurb": "One sentence about it."}
                        ],
                    }
                ],
            }
        ],
    }


def _chat(title):
    return {
        "serverName": title,
        "channels": [
            {
                "id": "ch-general",
                "name": "general",
                "topic": "Anything. Replace this.",
                "messages": [{"by": "someone", "body": "hello"}],
            },
            # The point of this type is that the old forum archive ended up
            # here, where nothing outside can search it. A chat with no
            # archive channel is just a chat -- validate.py warns about it.
            {
                "id": "ch-archive",
                "name": "archive",
                "kind": "archive",
                "topic": "Everything that used to be on the board.",
                "messages": [{"by": "someone", "body": "it was all in here"}],
            },
        ],
    }


_DATA = {
    "forum": _forum,
    "social": _social,
    "blog": _blog,
    "news": _news,
    "wiki": _wiki,
    "media": _media,
    "page": _page,
    "aggregator": _aggregator,
    "qa": _qa,
    "board": _board,
    "shop": _shop,
    "market": _market,
    "assistant": _assistant,
    "mail": _mail,
    "portal": _portal,
    "stream": _stream,
    "dash": _dash,
    "wire": _wire,
    "newsletter": _newsletter,
    "chat": _chat,
}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Scaffold a synthnet site.")
    parser.add_argument("domain", help="e.g. boards.gridfall.net")
    parser.add_argument("type", choices=TYPES)
    parser.add_argument("--skin", help="one of the skins valid for the type")
    parser.add_argument("--title", help="override the generated title")
    args = parser.parse_args(argv)

    domain = args.domain.strip().lower().strip("/")
    if not domain or "/" in domain or " " in domain or "." not in domain:
        sys.stderr.write("error: %r does not look like a domain\n" % args.domain)
        return 2

    allowed = SKINS[args.type]
    skin = args.skin or allowed[0]
    if skin not in allowed:
        sys.stderr.write("error: skin %r is not valid for type %s (choose: %s)\n"
                         % (skin, args.type, ", ".join(allowed)))
        return 2

    slug = domain.replace(".", "-")
    folder = SITES_DIR / slug
    target = folder / "site.json"
    if target.exists():
        sys.stderr.write("error: %s already exists - refusing to overwrite\n" % target)
        return 1

    site = skeleton(domain, args.type, skin)
    if args.title:
        site["title"] = args.title
        if args.type in ("forum",):
            site["data"]["boardName"] = args.title
        if args.type in ("news",):
            site["data"]["masthead"] = args.title
        if args.type in ("wiki", "media"):
            site["data"]["siteName"] = args.title

    folder.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(str(target))
    print("edit the placeholder content, then run:")
    print("    python3 tools/build.py && python3 tools/validate.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
