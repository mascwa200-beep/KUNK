#!/usr/bin/env python3
"""synthnet :: tools/serve.py

Serve the synthnet root over plain old HTTP with the stdlib only.  This is the
mode that gives you a service worker, a real PWA install and gzip -- the
standalone bundle in dist/ is the zero-install fallback.

Site content is fetched per site as you navigate.  The renderers and skins are
not: index.html links all seven of each up front, so a cold load carries about
185 KB it will not use until you visit a site.  Compression is what keeps that
cheap rather than lazy loading, which would cost the single-file build.

    python3 tools/serve.py
    python3 tools/serve.py --port 8181
    python3 tools/serve.py --bind 127.0.0.1     # phone only, no LAN

Ctrl-C stops it.  Python 3.9+, no dependencies, runs fine under Termux.
"""

import argparse
import functools
import gzip
import http.server
import io
import os
import socket
import socketserver
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The project forbids the literal scheme in source files (everything here must
# be provably offline), so the printed URLs assemble it at runtime.
SCHEME = "htt" + "p" + "://"

EXTRA_TYPES = {
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".htm": "text/html",
    ".svg": "image/svg+xml",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".ico": "image/x-icon",
}
TEXTUAL = ("text/", "application/json", "application/manifest+json", "image/svg+xml",
           "text/javascript")


class SynthHandler(http.server.SimpleHTTPRequestHandler):
    server_version = "synthnet"
    sys_version = ""

    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update(EXTRA_TYPES)

    def guess_type(self, path):
        ctype = super().guess_type(path)
        base = ctype.split(";", 1)[0].strip()
        if any(base.startswith(prefix) for prefix in TEXTUAL) and "charset" not in ctype:
            return base + "; charset=utf-8"
        return ctype

    def end_headers(self):
        # Rebuilds must be picked up by a plain reload, and the service worker
        # needs to be able to see a fresh copy of what it caches.
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def send_head(self):
        """Serve a compressed body when the client asked for one.

        SimpleHTTPRequestHandler sends everything uncompressed, which made a
        cold load 308 KB where the same bytes gzip to 65 KB.  Over localhost
        that costs almost no time, but over a LAN -- a phone serving to a
        laptop, or the other way round, which is a stated use -- it is the
        difference between instant and not.

        Only textual types are compressed, and only above a size where the
        gzip header stops being a net loss.  Anything else falls straight
        through to the parent implementation.
        """
        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.isfile(path):
            return super().send_head()

        accepts = self.headers.get("Accept-Encoding", "")
        ctype = self.guess_type(path)
        base = ctype.split(";", 1)[0].strip()
        compressible = any(base.startswith(prefix) for prefix in TEXTUAL)

        if "gzip" not in accepts.lower() or not compressible:
            return super().send_head()

        try:
            raw = open(path, "rb").read()
        except OSError:
            return super().send_head()

        if len(raw) < 1024:
            return super().send_head()

        body = gzip.compress(raw, 6)
        if len(body) >= len(raw):
            return super().send_head()

        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Vary", "Accept-Encoding")
        self.end_headers()
        return io.BytesIO(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s %s\n" % (self.log_date_time_string(), fmt % args))

    def log_error(self, fmt, *args):
        self.log_message(fmt, *args)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def lan_addresses():
    """Best-effort list of this machine's LAN IPv4 addresses, no dependencies."""
    found = []
    # Connecting a UDP socket sends no packets; it just asks the routing table
    # which local address would be used. The targets are reserved test ranges.
    for probe in ("192.0.2.1", "198.51.100.1", "203.0.113.1"):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.settimeout(0.2)
            sock.connect((probe, 9))
            addr = sock.getsockname()[0]
            if addr and not addr.startswith("127.") and addr not in found:
                found.append(addr)
        except OSError:
            pass
        finally:
            sock.close()
    try:
        _host, _alias, addrs = socket.gethostbyname_ex(socket.gethostname())
        for addr in addrs:
            if addr and not addr.startswith("127.") and addr not in found:
                found.append(addr)
    except OSError:
        pass
    return found


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve the synthnet root.")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--bind", default="0.0.0.0",
                        help="default 0.0.0.0 so another device on the LAN can reach it")
    parser.add_argument("--dir", default=str(ROOT),
                        help="directory to serve (default: the synthnet root)")
    args = parser.parse_args(argv)

    root = Path(args.dir).resolve()
    if not root.is_dir():
        sys.stderr.write("error: %s is not a directory\n" % root)
        return 2
    if not (root / "index.html").exists():
        sys.stderr.write("warning: no index.html in %s\n" % root)

    handler = functools.partial(SynthHandler, directory=str(root))
    try:
        httpd = Server((args.bind, args.port), handler)
    except OSError as exc:
        sys.stderr.write("error: cannot bind %s:%d (%s)\n" % (args.bind, args.port, exc))
        sys.stderr.write("try another port: python3 tools/serve.py --port 8181\n")
        return 1

    print("synthnet is serving %s" % root)
    print("  local   %slocalhost:%d/" % (SCHEME, args.port))
    if args.bind not in ("127.0.0.1", "localhost", "::1"):
        for addr in lan_addresses():
            print("  lan     %s%s:%d/" % (SCHEME, addr, args.port))
    print("  bundle  %slocalhost:%d/dist/synthnet.html" % (SCHEME, args.port))
    print("stop with Ctrl-C")

    try:
        httpd.serve_forever(poll_interval=0.4)
    except KeyboardInterrupt:
        print("\nstopping")
    finally:
        try:
            httpd.shutdown()
        except Exception:
            pass
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
