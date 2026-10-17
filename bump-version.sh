#!/usr/bin/env bash
# Cache-busting: bumps the ?v=N on every local file reference so a fresh deploy
# always loads, never a stale browser copy. Run before committing a deploy.
set -e
cur=$(grep -o 'app.js?v=[0-9]*' index.html | grep -o '[0-9]*' | head -1)
next=$((cur + 1))
for f in index.html app.js store.js; do
  sed -i "s/?v=${cur}'/?v=${next}'/g; s/?v=${cur}\"/?v=${next}\"/g" "$f"
done
echo "Bumped cache version ${cur} -> ${next}"
