#!/usr/bin/env bash
# Initialize the stack-chan submodule (fork, breath branch).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE="$ROOT/stack-chan"

if [ ! -f "$SUBMODULE/firmware/package.json" ]; then
  echo "Initializing stack-chan submodule ..."
  git -C "$ROOT" submodule update --init --recursive stack-chan
else
  echo "stack-chan submodule already checked out."
fi

echo
echo "Done. Firmware dir: $SUBMODULE/firmware"
echo "  cd stack-chan/firmware"
echo "  npm install"
echo "  npm run setup"
echo "  npm run setup -- --device=esp32"
echo "  npm run doctor"
echo "  npm run build:breath:m5stackchan-cores3"
echo "  npm run deploy:breath:m5stackchan-cores3"
echo
echo "Firmware changes are edited and committed directly inside stack-chan/"
echo "(fork hirorocky/stack-chan, branch breath) — see CLAUDE.md"
echo "'fork ブランチ運用' for the commit/push/upstream-merge workflow."
