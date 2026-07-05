#!/usr/bin/env bash
# Initialize stack-chan submodule and apply breathing-repo customizations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUBMODULE="$ROOT/stack-chan"
OVERLAY="$ROOT/overlay"

git -C "$ROOT" submodule update --init --remote stack-chan

echo "Applying patches in stack-chan ..."
git -C "$SUBMODULE" apply --check "$OVERLAY/patches/"*.patch
git -C "$SUBMODULE" apply "$OVERLAY/patches/"*.patch

echo "Installing mod-cores3 helper ..."
install -m 755 "$OVERLAY/firmware/scripts/mod-cores3.sh" "$SUBMODULE/firmware/scripts/mod-cores3.sh"

echo "Done. Firmware dir: $SUBMODULE/firmware"
echo "  npm install && npm run setup -- --device=esp32  (first time)"
echo "  npm run build:m5stackchan-cores3"
echo "  npm run mod:m5stackchan-cores3 -- ./mods/<your-mod>/manifest.json"
