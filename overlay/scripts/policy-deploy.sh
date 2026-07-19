#!/usr/bin/env bash
# breath policy MOD を release XSA にbuildし、Wi-Fi経由で有効化・無効化する。
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  overlay/scripts/policy-deploy.sh [--build-only] [host]
  overlay/scripts/policy-deploy.sh --disable [host]

host を省略すると UDP ビーコンで自動発見する。
--build-only  release XSA を生成するだけで、デバイスへ送信しない。
--disable     DELETE /policy で外部 policy を無効化し、builtin policy へ戻す。
USAGE
}

MODE=deploy
HOST=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --build-only)
      if [ "$MODE" != deploy ]; then
        echo "[policy-deploy] ERROR: --build-only and --disable cannot be combined" >&2
        exit 2
      fi
      MODE=build-only
      ;;
    --disable)
      if [ "$MODE" != deploy ]; then
        echo "[policy-deploy] ERROR: --build-only and --disable cannot be combined" >&2
        exit 2
      fi
      MODE=disable
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "[policy-deploy] ERROR: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$HOST" ]; then
        echo "[policy-deploy] ERROR: specify at most one host" >&2
        usage >&2
        exit 2
      fi
      HOST="$1"
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/overlay/scripts"
POLICY_DIR="$REPO_ROOT/overlay/mods/breath-policy"
POLICY_META="$POLICY_DIR/meta.ts"
MODDABLE_ROOT="${MODDABLE:-$HOME/.local/share/moddable}"
MCRUN="$MODDABLE_ROOT/build/bin/mac/release/mcrun"
XSA_PATH="$MODDABLE_ROOT/build/bin/esp32/release/breath-policy/breath-policy.xsa"
DEV_TOKEN="${BREATH_DEV_TOKEN:-breath-dev}"
POLL_TIMEOUT_SEC=90
POLL_INTERVAL_SEC=3
UPLOAD_TIMEOUT_SEC=60

read -r POLICY_API_VERSION POLICY_MIN_HOST_API_VERSION POLICY_MAX_HOST_API_VERSION POLICY_SCHEMA_VERSION < <(python3 - "$POLICY_META" <<'PY'
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()

def value(name, pattern):
    match = re.search(rf"\b{name}\s*:\s*{pattern}", text)
    if not match:
        raise SystemExit(f"[policy-deploy] ERROR: {name} not found in {sys.argv[1]}")
    return match.group(1)

print(
    value("apiVersion", r"(\d+)"),
    value("minHostApiVersion", r"(\d+)"),
    value("maxHostApiVersion", r"(\d+)"),
    value("schemaVersion", r"(\d+)"),
)
PY
)
POLICY_BUILD_ID="$(git -C "$REPO_ROOT" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"

if [ "$MODE" != disable ]; then
  if [ ! -x "$MCRUN" ]; then
    echo "[policy-deploy] ERROR: mcrun not found at $MCRUN" >&2
    exit 1
  fi
  echo "[policy-deploy] build: release policy api=$POLICY_API_VERSION host=$POLICY_MIN_HOST_API_VERSION..$POLICY_MAX_HOST_API_VERSION schema=$POLICY_SCHEMA_VERSION buildId=$POLICY_BUILD_ID"
  (cd "$POLICY_DIR" && PATH="$REPO_ROOT/stack-chan/firmware/node_modules/.bin:$PATH" "$MCRUN" -m -p esp32 -t build manifest.json "policyBuildId=$POLICY_BUILD_ID")
  if [ ! -f "$XSA_PATH" ]; then
    echo "[policy-deploy] ERROR: release XSA not found at $XSA_PATH" >&2
    exit 1
  fi
  echo "[policy-deploy] build ok: $(stat -f '%z bytes' "$XSA_PATH") $XSA_PATH"
  if [ "$MODE" = build-only ]; then
    exit 0
  fi
fi

if [ -z "$HOST" ]; then
  echo "[policy-deploy] no host given: auto-discovering via UDP beacon (udp/8687, up to 15s)"
  if ! HOST="$("$SCRIPT_DIR/stackchan-ip.sh")"; then
    echo "[policy-deploy] ERROR: auto-discovery failed. Specify host explicitly." >&2
    exit 1
  fi
  echo "[policy-deploy] discovered host: $HOST"
fi

RESPONSE_BODY="$(mktemp)"
trap 'rm -f "$RESPONSE_BODY"' EXIT

policy_request() {
  local method="$1"
  local http_status
  : > "$RESPONSE_BODY"

  if [ "$method" = DELETE ]; then
    echo "[policy-deploy] disable: DELETE http://$HOST/policy"
    if ! http_status="$(curl -sS --connect-timeout 10 --max-time "$UPLOAD_TIMEOUT_SEC" -o "$RESPONSE_BODY" -w '%{http_code}' \
      -X DELETE -H "x-dev-token: $DEV_TOKEN" "http://$HOST/policy")"; then
      echo "[policy-deploy] ERROR: disable request failed" >&2
      return 1
    fi
  else
    echo "[policy-deploy] upload: PUT http://$HOST/policy"
    if ! http_status="$(curl -sS --connect-timeout 10 --max-time "$UPLOAD_TIMEOUT_SEC" -o "$RESPONSE_BODY" -w '%{http_code}' \
      -X PUT -H 'Expect:' -H "x-dev-token: $DEV_TOKEN" \
      -H "x-policy-api-version: $POLICY_API_VERSION" \
      -H "x-policy-min-host-api-version: $POLICY_MIN_HOST_API_VERSION" \
      -H "x-policy-max-host-api-version: $POLICY_MAX_HOST_API_VERSION" \
      -H "x-policy-schema-version: $POLICY_SCHEMA_VERSION" \
      -H "x-policy-build-id: $POLICY_BUILD_ID" \
      --data-binary "@$XSA_PATH" "http://$HOST/policy")"; then
      echo "[policy-deploy] ERROR: upload request failed" >&2
      return 1
    fi
  fi

  if [ "$http_status" != 202 ]; then
    echo "[policy-deploy] ERROR: device returned HTTP $http_status: $(cat "$RESPONSE_BODY")" >&2
    return 1
  fi
  echo "[policy-deploy] accepted. device restarting"
}

poll_policy() {
  local expected_state="$1"
  local expected_build_id="${2:-}"
  local elapsed=0
  local status current_state current_build_id

  echo "[policy-deploy] waiting for policy state=$expected_state (timeout ${POLL_TIMEOUT_SEC}s)"
  while [ "$elapsed" -lt "$POLL_TIMEOUT_SEC" ]; do
    sleep "$POLL_INTERVAL_SEC"
    elapsed=$((elapsed + POLL_INTERVAL_SEC))
    status="$(curl -sf --max-time 3 "http://$HOST/status" 2>/dev/null || true)"
    if [ -z "$status" ]; then
      echo "[policy-deploy] ...(${elapsed}s) device not responding yet"
      continue
    fi

    read -r current_state current_build_id < <(printf '%s' "$status" | python3 -c 'import json, sys
try:
    policy = json.load(sys.stdin).get("policy") or {}
    print(policy.get("state", ""), policy.get("modBuildId") or "-")
except Exception:
    print("", "-")')
    echo "[policy-deploy] ...(${elapsed}s) policy state=$current_state buildId=$current_build_id"

    if [ "$current_state" = "$expected_state" ] && { [ -z "$expected_build_id" ] || [ "$current_build_id" = "$expected_build_id" ]; }; then
      echo "[policy-deploy] OK: policy state=$current_state buildId=$current_build_id after ${elapsed}s"
      return 0
    fi
  done

  if [ -n "$expected_build_id" ]; then
    echo "[policy-deploy] ERROR: timed out waiting for policy state=$expected_state buildId=$expected_build_id" >&2
  else
    echo "[policy-deploy] ERROR: timed out waiting for policy state=$expected_state" >&2
  fi
  return 1
}

policy_request DELETE
poll_policy disabled

if [ "$MODE" = disable ]; then
  exit 0
fi

policy_request PUT
poll_policy active "$POLICY_BUILD_ID"
