#!/usr/bin/env bash
# synthnet :: tools/publish.sh
#
# Rebuild, validate, commit the synthnet tree and push it. Aborts before it
# touches git if either the build or the validator fails.
#
#     ./tools/publish.sh
#     ./tools/publish.sh "add three Gridfall boards"
#
# Only the synthnet/ tree and .claude/workflows/ are staged; nothing else in
# the repository is touched.

set -euo pipefail

SYNTH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PY="${PYTHON:-python3}"

if ! command -v "$PY" >/dev/null 2>&1; then
  echo "publish: $PY not found (set PYTHON=... to point at your interpreter)" >&2
  exit 2
fi

REPO_ROOT="$(git -C "$SYNTH_ROOT" rev-parse --show-toplevel)"

echo "==> build"
"$PY" "$SYNTH_ROOT/tools/build.py"

echo "==> validate"
"$PY" "$SYNTH_ROOT/tools/validate.py"

echo "==> stage"
git -C "$REPO_ROOT" add -A -- "$SYNTH_ROOT"
if [ -d "$REPO_ROOT/.claude/workflows" ]; then
  git -C "$REPO_ROOT" add -A -- "$REPO_ROOT/.claude/workflows"
fi

if git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "publish: nothing changed, nothing to commit"
  exit 0
fi

SUMMARY="$("$PY" - "$SYNTH_ROOT/net/registry.json" <<'PY'
import json, sys
try:
    reg = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print("0 0")
else:
    sites = reg.get("sites", [])
    print("%d %d" % (len(sites), sum(int(s.get("bytes", 0)) for s in sites)))
PY
)"
SITE_COUNT="${SUMMARY% *}"
BYTE_COUNT="${SUMMARY#* }"

if [ "$#" -gt 0 ] && [ -n "${1:-}" ]; then
  MESSAGE="$1"$'\n\n'"synthnet: ${SITE_COUNT} sites, ${BYTE_COUNT} bytes of content"
else
  MESSAGE="synthnet: ${SITE_COUNT} sites, ${BYTE_COUNT} bytes of content"
fi

echo "==> commit"
git -C "$REPO_ROOT" commit -m "$MESSAGE"

echo "==> push"
DELAY=2
PUSHED=0
for ATTEMPT in 1 2 3 4 5; do
  if git -C "$REPO_ROOT" push -u origin HEAD; then
    PUSHED=1
    break
  fi
  if [ "$ATTEMPT" -eq 5 ]; then
    break
  fi
  echo "publish: push failed (attempt ${ATTEMPT}/5), retrying in ${DELAY}s" >&2
  sleep "$DELAY"
  DELAY=$((DELAY * 2))
done

if [ "$PUSHED" -ne 1 ]; then
  echo "publish: push failed after 5 attempts; the commit is safe locally" >&2
  exit 1
fi

echo "published: ${SITE_COUNT} sites, ${BYTE_COUNT} bytes"
