#!/usr/bin/env bash
# Installs a mod onto the M5StackChan CoreS3 subplatform via mcrun.
# `mcrun -d` intermittently hangs at "Installing mod.." when the device's
# debug listener isn't in a fresh state after a prior session. Resetting the
# board via esptool immediately before each attempt, and retrying a few times,
# works around this reliably.
set -uo pipefail

MANIFEST="${1:-}"
if [ -z "$MANIFEST" ]; then
  echo "Usage: npm run mod:m5stackchan-cores3 -- <mod-manifest-path>" >&2
  exit 1
fi

MAX_ATTEMPTS=3
TIMEOUT_SEC=45

PORT="$(ls /dev/cu.usbmodem* 2>/dev/null | head -1)"
ESPTOOL_PY="$(ls "$HOME"/.espressif/python_env/*/bin/python 2>/dev/null | head -1)"

reset_device() {
  if [ -n "$PORT" ] && [ -n "$ESPTOOL_PY" ]; then
    "$ESPTOOL_PY" -m esptool --chip esp32s3 -p "$PORT" --before default-reset --after hard-reset chip-id >/dev/null 2>&1
    sleep 2
  fi
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "=== mod install attempt ${attempt}/${MAX_ATTEMPTS} ==="
  reset_device
  TMP_LOG="$(mktemp)"
  timeout "$TIMEOUT_SEC" mcrun -d -m -p esp32:./platforms/m5stackchan_cores3 "$MANIFEST" 2>&1 | tee "$TMP_LOG"

  if grep -q "Installing mod\.\.\.\.complete" "$TMP_LOG"; then
    rm -f "$TMP_LOG"
    echo "=== mod installed successfully ==="
    exit 0
  fi

  rm -f "$TMP_LOG"
  echo "=== attempt ${attempt} did not complete in time, cleaning up and retrying ==="
  pkill -f serial2xsbug 2>/dev/null || true
  sleep 1
done

echo "=== mod install failed after ${MAX_ATTEMPTS} attempts. Try a physical device reset and re-run. ===" >&2
exit 1
