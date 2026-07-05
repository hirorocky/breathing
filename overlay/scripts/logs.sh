#!/usr/bin/env bash
# UDP ログミラー（overlay/mods/breath/dev/trace-udp.js）を受信して stdout に流す。
# nc は macOS の実装差で不安定なため python3 の recvfrom ループを使う。
#
# 使い方:
#   overlay/scripts/logs.sh                # port 8686 で待ち受け
#   overlay/scripts/logs.sh 8686            # port を明示
set -euo pipefail

PORT="${1:-8686}"

exec python3 - "$PORT" <<'PY'
import socket
import sys
import datetime

port = int(sys.argv[1])

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", port))

print(f"[logs.sh] listening on udp/{port}", flush=True)

while True:
    data, addr = sock.recvfrom(65535)
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    text = data.decode("utf-8", errors="replace")
    for line in text.splitlines() or [""]:
        print(f"[{ts}] {addr[0]}: {line}", flush=True)
PY
