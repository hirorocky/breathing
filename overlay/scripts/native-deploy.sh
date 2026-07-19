#!/usr/bin/env bash
set -euo pipefail

# Native (USB) breath deploy using the pinned Moddable checkout.
# Remove only the generated release cache so overlay/native changes are seen.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FIRMWARE_DIR="$ROOT_DIR/stack-chan/firmware"
MODDABLE_DIR="${MODDABLE:-$ROOT_DIR/vendor/moddable}"
MC_CONFIG="${MC_CONFIG:-/Users/hiro/.local/share/moddable/build/bin/mac/release/mcconfig}"
PORT="${UPLOAD_PORT:-}"
BUILD_ONLY=0

usage() {
  cat <<'EOF'
Usage: overlay/scripts/native-deploy.sh [--port DEVICE] [--build-only]

Build and deploy the breath host over USB with the pinned native Moddable SDK.
The generated release cache is rebuilt before deployment.
EOF
}

while (($#)); do
  case "$1" in
    --port)
      [[ $# -ge 2 ]] || { echo "--port needs a device path" >&2; exit 2; }
      PORT="$2"
      shift 2
      ;;
    --build-only)
      BUILD_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[[ -d "$MODDABLE_DIR" ]] || { echo "Moddable checkout not found: $MODDABLE_DIR" >&2; exit 1; }
[[ -x "$MC_CONFIG" ]] || { echo "mcconfig not found or not executable: $MC_CONFIG" >&2; exit 1; }

if [[ -z "$PORT" ]]; then
  PORT="$(printf '%s\n' /dev/cu.usbmodem* | head -n 1)"
fi
[[ -n "$PORT" && -e "$PORT" ]] || { echo "USB device not found; use --port /dev/cu.usbmodemXXX" >&2; exit 1; }

BUILD_DIR="$MODDABLE_DIR/build/tmp/esp32/m5stackchan_cores3/release/stackchan"
rm -rf "$BUILD_DIR"

cd "$FIRMWARE_DIR"
npm run check:breath
env PATH="$FIRMWARE_DIR/node_modules/.bin:$PATH" MODDABLE="$MODDABLE_DIR" UPLOAD_PORT="$PORT" \
  "$MC_CONFIG" -m -p esp32:./platforms/m5stackchan_cores3 -t build \
  "$FIRMWARE_DIR/stackchan/manifest_breath_deploy.json"

BIN="$BUILD_DIR/xsProj-esp32s3/build/xs_esp32.bin"
[[ -s "$BIN" ]] || { echo "build output missing: $BIN" >&2; exit 1; }
grep -q 'startupSound.*boolean = 0' "$BUILD_DIR/mc.xs.c" || {
  echo "generated build does not disable startupSound" >&2
  exit 1
}
grep -R -q "globals.breathDeployNoticeShown" "$BUILD_DIR/tsc" || {
  echo "generated build does not contain deploy notice" >&2
  exit 1
}

if ((BUILD_ONLY)); then
  echo "build verified: $BIN"
  exit 0
fi

env PATH="$FIRMWARE_DIR/node_modules/.bin:$PATH" MODDABLE="$MODDABLE_DIR" UPLOAD_PORT="$PORT" \
  "$MC_CONFIG" -m -p esp32:./platforms/m5stackchan_cores3 -t deploy \
  "$FIRMWARE_DIR/stackchan/manifest_breath_deploy.json"
