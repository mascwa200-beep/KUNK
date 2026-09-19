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
SEARCH_LIMIT = 400 * 1024

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


_DOC_BUILDERS = {
    "forum": _docs_forum,
    "social": _docs_social,
    "blog": _docs_blog,
    "news": _docs_news,
    "wiki": _docs_wiki,
    "media": _docs_media,
    "page": _docs_page,
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

    postings = {}
    for index, doc in enumerate(docs):
        seen = set()
        for match in _TOKEN.finditer(doc["lower"]):
            token = match.group(0)
            if len(token) < MIN_TOKEN or token in STOPLIST or token in seen:
                continue
            seen.add(token)
            postings.setdefault(token, []).append(index)

    terms = {}
    for token in sorted(postings):
        terms[token] = sorted(set(postings[token]))[:MAX_POSTINGS]
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


def build_service_worker(warnings):
    """Regenerate sw.js's precache list from what index.html actually loads.

    This list used to be maintained by hand, and it drifted exactly the way
    hand-maintained lists do: it named three files that did not exist and
    omitted the main stylesheet, so every cold load logged 404s and the
    offline shell came back unstyled. The install step swallows per-file
    errors, so nothing failed loudly -- it just quietly cached the wrong set.

    Deriving it from index.html means the two cannot disagree. Adding a
    stylesheet or a script to the page is now the whole change.
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
    return current[:match.start(2)] + body + current[match.end(2):]


def compute(warnings):
    loaded = load_sites()
    registry = build_registry(loaded)
    search = build_search(loaded)
    sites = {}
    for _path, site in loaded:
        sites[site.get("domain", "")] = site
    service_worker = build_service_worker(warnings)
    bundle = build_bundle(registry, sites, search, warnings)
    return {
        REGISTRY_PATH: dumps(registry),
        SEARCH_PATH: dumps_search(search),
        BUNDLE_PATH: bundle,
        SW_PATH: service_worker,
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
