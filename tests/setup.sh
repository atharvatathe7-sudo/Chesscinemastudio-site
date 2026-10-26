#!/usr/bin/env bash
# Fetches chess.js 0.12.0 (the version the app loads from cdnjs) into tests/.cache, checks its
# SHA-256, and reports whether the other tools the tests need are available.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=$HERE/.cache/chess.js-0.12.0
WANT=ff18b066d1cac6a82f0dde715b6273f5f47760c5d7043db3d0c3504bca988657   # package/chess.js
if [ ! -f "$DEST/package/chess.js" ]; then
  mkdir -p "$DEST"
  (cd "$DEST" && npm pack chess.js@0.12.0 --silent >/dev/null && tar xzf chess.js-0.12.0.tgz && rm chess.js-0.12.0.tgz)
fi
GOT=$(sha256sum "$DEST/package/chess.js" | cut -d' ' -f1)
[ "$GOT" = "$WANT" ] || { echo "chess.js checksum mismatch: $GOT" >&2; exit 1; }
echo "chess.js 0.12.0: ok ($DEST/package/chess.js)"
node -e "require('playwright')" 2>/dev/null && echo "playwright: ok" || echo "playwright: MISSING (npm i -g playwright && npx playwright install chromium)"
for t in ffmpeg ffprobe git; do command -v $t >/dev/null && echo "$t: ok" || echo "$t: MISSING"; done
ffmpeg -hide_banner -decoders 2>/dev/null | grep -q libvpx-vp9 && echo "ffmpeg libvpx-vp9 decoder: ok" || echo "ffmpeg libvpx-vp9 decoder: MISSING"
