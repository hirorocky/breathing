#!/usr/bin/env bash
# デバイス IP の自動発見（overlay/mods/breath/dev/beacon.js の UDP ビーコン受信）。
# nc は macOS の実装差で不安定なため python3 の recvfrom ループを使う（logs.sh と同じ流儀）。
#
# port 8687 を最大 15 秒（ビーコン周期 10 秒 + 余裕）待ち受け、最初に受信した
# 有効な JSON（"name":"stackchan" を含む）から ip を取り出して stdout に出す。
# タイムアウト時は stderr にメッセージを出し exit 1。DHCP で IP が変わっても
# 都度これを呼べば新しい IP が得られる（DHCP 予約は不要）。
#
# 使い方:
#   curl http://$(overlay/scripts/stackchan-ip.sh)/status
set -euo pipefail

PORT=8687
TIMEOUT_SEC=15

python3 - "$PORT" "$TIMEOUT_SEC" <<'PY'
import json
import socket
import sys
import time

port = int(sys.argv[1])
timeout_sec = float(sys.argv[2])

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", port))

deadline = time.monotonic() + timeout_sec

while True:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        print(f"[stackchan-ip] timed out after {timeout_sec:.0f}s waiting for a beacon on udp/{port}", file=sys.stderr)
        sys.exit(1)
    sock.settimeout(remaining)
    try:
        data, _addr = sock.recvfrom(65535)
    except socket.timeout:
        print(f"[stackchan-ip] timed out after {timeout_sec:.0f}s waiting for a beacon on udp/{port}", file=sys.stderr)
        sys.exit(1)

    try:
        payload = json.loads(data.decode("utf-8", errors="replace"))
    except Exception:
        continue

    if payload.get("name") != "stackchan":
        continue
    ip = payload.get("ip")
    if not ip:
        continue

    print(ip)
    sys.exit(0)
PY
