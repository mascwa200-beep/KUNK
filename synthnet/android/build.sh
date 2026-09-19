#!/usr/bin/env bash
#
# Build synthnet as an installable Android APK.
#
# Deliberately not Gradle. This app uses only framework APIs -- no androidx, no
# third-party library, nothing to resolve -- so the whole build is four SDK
# tools in sequence. That means no dependency download, no lockfile to drift,
# no build that breaks because a plugin version moved, and a CI job that
# finishes in about a minute on a runner that already ships the SDK.
#
#   aapt2 compile/link   resources + manifest + assets  ->  a resources-only APK
#   javac                Java source                    ->  .class
#   d8                   .class                         ->  classes.dex
#   zipalign + apksigner                                ->  an installable APK
#
# Usage:
#   ./build.sh                 # debug-signed, ready to sideload
#   ./build.sh --out /tmp/x.apk
#
# Requires: a JDK, and an Android SDK with build-tools and a platform. It finds
# the SDK from ANDROID_HOME, ANDROID_SDK_ROOT, or the usual locations, and
# picks the newest build-tools and platform present rather than pinning one, so
# it keeps working as a CI image updates.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE="$(cd "$HERE/.." && pwd)"
BUILD="$HERE/build"
OUT="$HERE/synthnet.apk"

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

# --- locate the SDK -------------------------------------------------------

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ]; then
  for c in /opt/android-sdk /usr/lib/android-sdk "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
    [ -d "$c" ] && SDK="$c" && break
  done
fi
[ -n "$SDK" ] && [ -d "$SDK" ] || die "no Android SDK found. Set ANDROID_HOME."

newest() { ls -1 "$1" 2>/dev/null | sort -V | tail -1; }

BT_VER="$(newest "$SDK/build-tools")"
[ -n "$BT_VER" ] || die "no build-tools in $SDK/build-tools"
BT="$SDK/build-tools/$BT_VER"

PLAT_VER="$(newest "$SDK/platforms")"
[ -n "$PLAT_VER" ] || die "no platform in $SDK/platforms"
ANDROID_JAR="$SDK/platforms/$PLAT_VER/android.jar"
[ -f "$ANDROID_JAR" ] || die "missing $ANDROID_JAR"

for t in aapt2 d8 zipalign apksigner; do
  [ -x "$BT/$t" ] || die "missing $BT/$t"
done
command -v javac >/dev/null || die "javac not on PATH (install a JDK)"

echo "sdk           $SDK"
echo "build-tools   $BT_VER"
echo "platform      $PLAT_VER"

# --- stage the site into assets/ -----------------------------------------

rm -rf "$BUILD"
mkdir -p "$BUILD/assets" "$BUILD/compiled" "$BUILD/gen" "$BUILD/classes" "$BUILD/dex"

# Only what the page actually loads. The Python tooling, the docs, this build
# directory and the standalone bundle are all irrelevant inside the app, and
# shipping them would inflate the APK for no reason.
for item in index.html manifest.webmanifest sw.js app theme net; do
  [ -e "$SITE/$item" ] || die "missing $SITE/$item -- run tools/build.py first"
  cp -R "$SITE/$item" "$BUILD/assets/"
done

# registry.json and search.json are generated. If they are stale the app ships
# stale, and unlike the served site there is no rebuild-and-reload to save you.
[ -f "$BUILD/assets/net/registry.json" ] || die "net/registry.json missing -- run tools/build.py"
[ -f "$BUILD/assets/net/search.json" ]   || die "net/search.json missing -- run tools/build.py"

ASSET_BYTES=$(du -sb "$BUILD/assets" | cut -f1)
echo "assets        $ASSET_BYTES bytes staged"

# --- resources ------------------------------------------------------------

"$BT/aapt2" compile --dir "$HERE/res" -o "$BUILD/compiled/res.zip"

"$BT/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  -A "$BUILD/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version 26 \
  --target-sdk-version 34 \
  -o "$BUILD/base.apk" \
  "$BUILD/compiled/res.zip"

# --- code -----------------------------------------------------------------

find "$HERE/src" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
javac -source 8 -target 8 -nowarn \
      -bootclasspath "$ANDROID_JAR" \
      -classpath "$ANDROID_JAR" \
      -d "$BUILD/classes" \
      @"$BUILD/sources.txt" 2>&1 | grep -v 'bootstrap class path' || true

find "$BUILD/classes" -name '*.class' > "$BUILD/classes.txt"
"$BT/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$BUILD/dex" @"$BUILD/classes.txt"

# --- package --------------------------------------------------------------

cp "$BUILD/base.apk" "$BUILD/unsigned.apk"
( cd "$BUILD/dex" && zip -q -u "$BUILD/unsigned.apk" classes.dex )

"$BT/zipalign" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

# A debug keystore is generated on first run. This signs for sideloading, not
# for a store listing -- a real release needs a key you control and keep.
KS="$HERE/debug.keystore"
if [ ! -f "$KS" ]; then
  echo "generating a local debug keystore (not for distribution)"
  # No -quiet here: keytool rejects it for -genkeypair, and swallowing the
  # error is how a failure at this step first looked like a build that simply
  # stopped producing an APK with nothing to explain why.
  keytool -genkeypair \
    -keystore "$KS" -storepass android -keypass android \
    -alias synthnetdebug -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Synthnet Debug, OU=synthnet, O=synthnet, C=US" \
    || die "keytool could not create $KS"
fi

"$BT/apksigner" sign \
  --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias synthnetdebug \
  --out "$OUT" "$BUILD/aligned.apk"

"$BT/apksigner" verify --print-certs "$OUT" > /dev/null

SIZE=$(stat -c%s "$OUT")
echo
echo "apk           $OUT"
echo "size          $SIZE bytes"
echo "signed        yes (debug key, sideload only)"
echo
echo "install with:  adb install -r $OUT"
echo "or copy it to the phone and open it from the file manager."
