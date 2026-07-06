#!/usr/bin/env bash
# breath ファームの Wi-Fi OTA デプロイ（Phase 2）。USB 不要。
# build（buildId 注入）→ PUT /ota → 再起動待ち → GET /status の buildId 照合。
#
# 使い方:
#   overlay/scripts/ota-deploy.sh                # ホスト省略 → UDP ビーコンで自動発見
#   overlay/scripts/ota-deploy.sh 192.168.1.50    # ホストを明示（自動発見をスキップ）
#
# 本 LAN（TP-Link Deco）はクライアント間 multicast を遮断するため mDNS
# （stackchan.local）は使えない。ホスト省略時は `stackchan-ip.sh`（UDP ビーコン
# 受信、port 8687）で自動発見する。DHCP で IP が変わっても引数なしで呼べば
# 追従する（DHCP 予約は不要）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/overlay/scripts"

if [ -n "${1:-}" ]; then
  HOST="$1"
else
  echo "[ota-deploy] no host given: auto-discovering via UDP beacon (udp/8687, up to 15s)"
  if ! HOST="$("$SCRIPT_DIR/stackchan-ip.sh")"; then
    echo "[ota-deploy] ERROR: auto-discovery failed (no beacon received). Specify host explicitly: ota-deploy.sh <ip>" >&2
    exit 1
  fi
  echo "[ota-deploy] discovered host: $HOST"
fi

FIRMWARE_DIR="$REPO_ROOT/stack-chan/firmware"
BIN_PATH="$HOME/.local/share/moddable/build/tmp/esp32/m5stackchan_cores3/debug/stackchan/xsProj-esp32s3/build/xs_esp32.bin"
DEV_TOKEN="breath-dev"
POLL_TIMEOUT_SEC=180
POLL_INTERVAL_SEC=3

BUILD_ID="$(git -C "$REPO_ROOT" rev-parse --short HEAD)-$(date +%H%M%S)"

echo "[ota-deploy] host=$HOST buildId=$BUILD_ID"

echo "[ota-deploy] build: npm run build:breath:m5stackchan-cores3 -- buildId=$BUILD_ID"
(cd "$FIRMWARE_DIR" && npm run build:breath:m5stackchan-cores3 -- "buildId=$BUILD_ID")

if [ ! -f "$BIN_PATH" ]; then
  echo "[ota-deploy] ERROR: binary not found at $BIN_PATH" >&2
  exit 1
fi
echo "[ota-deploy] build ok: $(ls -l "$BIN_PATH" | awk '{print $5, $NF}')"

echo "[ota-deploy] upload: PUT http://$HOST/ota"
if ! curl -sf -T "$BIN_PATH" "http://$HOST/ota" -H "x-dev-token: $DEV_TOKEN"; then
  echo "[ota-deploy] ERROR: upload failed (device should still be running the previous firmware)" >&2
  exit 1
fi
echo "[ota-deploy] upload ok. device restarting; waiting for buildId match (timeout ${POLL_TIMEOUT_SEC}s)"

elapsed=0
while [ "$elapsed" -lt "$POLL_TIMEOUT_SEC" ]; do
  sleep "$POLL_INTERVAL_SEC"
  elapsed=$((elapsed + POLL_INTERVAL_SEC))

  status="$(curl -sf --max-time 3 "http://$HOST/status" 2>/dev/null || true)"
  if [ -z "$status" ]; then
    echo "[ota-deploy] ...(${elapsed}s) device not responding yet"
    continue
  fi

  current_build_id="$(printf '%s' "$status" | python3 -c 'import json,sys
try:
    print(json.load(sys.stdin).get("buildId", ""))
except Exception:
    print("")' 2>/dev/null || true)"
  echo "[ota-deploy] ...(${elapsed}s) /status buildId=$current_build_id"

  if [ "$current_build_id" = "$BUILD_ID" ]; then
    echo "[ota-deploy] OK: buildId matched ($BUILD_ID) after ${elapsed}s"
    exit 0
  fi
done

echo "[ota-deploy] ERROR: timed out after ${POLL_TIMEOUT_SEC}s waiting for buildId=$BUILD_ID" >&2
exit 1
