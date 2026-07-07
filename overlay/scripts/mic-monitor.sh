#!/usr/bin/env bash
# マイク観測基盤（overlay/mods/breath/mic.js）の UDP ストリームを受信して表示する。
# nc は macOS の実装差で不安定なため python3 の recvfrom ループを使う（logs.sh と同じ流儀）。
#
# 使い方:
#   overlay/scripts/mic-monitor.sh                # port 8688 で待ち受け
#   overlay/scripts/mic-monitor.sh 8688            # port を明示
#
# 受信する JSON: {"t":<uptimeMs>,"rms":<0-32767>,"peak":<0-32767>,"ev"?:<string>}
# rms を簡易バー（# の連なり）付きで 1 行表示する。ev フィールドがあれば
# （v1.1.0 Phase 3b のイベント検出発火直後の 1 パケットにだけ乗る）行末に
# 目立つマーカーを付ける。
set -euo pipefail

PORT="${1:-8688}"

exec python3 - "$PORT" <<'PY'
import json
import socket
import sys
import datetime

port = int(sys.argv[1])

BAR_WIDTH = 40
BAR_SCALE = 400  # rms このくらいで満尺（実測に応じて調整可）

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", port))

print(f"[mic-monitor] listening on udp/{port}", flush=True)

while True:
    data, addr = sock.recvfrom(65535)
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    text = data.decode("utf-8", errors="replace").strip()

    try:
        payload = json.loads(text)
        t = payload.get("t", 0)
        rms = payload.get("rms", 0)
        peak = payload.get("peak", 0)
        ev = payload.get("ev")
        filled = min(BAR_WIDTH, int(rms * BAR_WIDTH / BAR_SCALE))
        bar = "#" * filled + " " * (BAR_WIDTH - filled)
        marker = f"  <<< {ev.upper()}" if ev else ""
        print(f"[{ts}] {addr[0]}: t={t:>10} rms={rms:>6} peak={peak:>6} |{bar}|{marker}", flush=True)
    except Exception:
        print(f"[{ts}] {addr[0]}: (unparsed) {text}", flush=True)
PY
