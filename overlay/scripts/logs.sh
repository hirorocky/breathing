#!/usr/bin/env bash
# UDP ログミラー（overlay/mods/breath/dev/trace-udp.js）を受信して stdout に流す。
# nc は macOS の実装差で不安定なため python3 の recvfrom ループを使う。
#
# 使い方:
#   overlay/scripts/logs.sh                # port 8686 で待ち受け
#   overlay/scripts/logs.sh 8686            # port を明示
#   overlay/scripts/logs.sh 8686 logs.jsonl # 受信内容を保存
set -euo pipefail

PORT="${1:-8686}"
LOG_FILE="${2:-}"

exec python3 - "$PORT" "$LOG_FILE" <<'PY'
import socket
import sys
import datetime
import json

port = int(sys.argv[1])
log_file = sys.argv[2] or None

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("0.0.0.0", port))

print(f"[logs.sh] listening on udp/{port}", flush=True)
output = open(log_file, "a", encoding="utf-8") if log_file else None

while True:
    data, addr = sock.recvfrom(65535)
    ts = datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3]
    text = data.decode("utf-8", errors="replace")
    for line in text.splitlines() or [""]:
        rendered = f"[{ts}] {addr[0]}: {line}"
        print(rendered, flush=True)
        if output:
            record = {"receivedAt": ts, "sourceIp": addr[0], "message": line}
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
            output.flush()
PY
