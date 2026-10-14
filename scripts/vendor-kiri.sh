#!/usr/bin/env bash
# Builds Kiri:Moto's slicing engine from source at the commit pinned in scripts/kiri.lock
# and copies the browser bundle into client/public/vendor/kiri. Kiri also fetches wasm from
# /wasm/ (absolute, or relative to a page at the site root), so the wasm files are copied
# to client/public/wasm as well.
#
# Run by .github/workflows/vendor-kiri.yml. Needs Node 22 and network access to GitHub
# and the npm registry.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SHA=$(grep -v '^#' "$ROOT/scripts/kiri.lock" | tr -d '[:space:]')
WORK=$(mktemp -d)
echo "Building Kiri:Moto engine at $SHA in $WORK"

git init -q "$WORK/grid-apps"
cd "$WORK/grid-apps"
git remote add origin https://github.com/GridSpace/grid-apps
git fetch -q --depth 1 origin "$SHA"
git checkout -q FETCH_HEAD

# grid-apps has no lockfile; the pinned commit is what keeps the build repeatable.
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --no-audit --no-fund --loglevel=error
npm run webpack-ext
node bin/esbuild.config.mjs prod

OUT="$ROOT/client/public/vendor/kiri"
rm -rf "$OUT"
mkdir -p "$OUT/lib/kiri/run" "$OUT/lib/kiri/wasm" "$ROOT/client/public/wasm"
cp src/pack/kiri-eng.js "$OUT/lib/kiri/run/engine.js"
cp src/pack/kiri-work.js "$OUT/lib/kiri/run/worker.js"
cp src/pack/kiri-pool.js "$OUT/lib/kiri/run/minion.js"
cp -L src/wasm/*.wasm "$OUT/lib/kiri/wasm/"
cp -L src/wasm/*.wasm "$ROOT/client/public/wasm/"
cp license.md "$OUT/license.kiri-moto.txt"
echo "$SHA" > "$OUT/VERSION"

ls -la "$OUT/lib/kiri/run" "$OUT/lib/kiri/wasm"
