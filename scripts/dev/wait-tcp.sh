#!/usr/bin/env bash
# Wait until TCP host:port accepts connections.
# Usage: wait-tcp.sh <host> <port> <timeout_sec> <label>
set -euo pipefail

HOST="${1:?host required}"
PORT="${2:?port required}"
TIMEOUT_SEC="${3:?timeout_sec required}"
LABEL="${4:-${HOST}:${PORT}}"

deadline=$((SECONDS + TIMEOUT_SEC))
echo "[wait-tcp] waiting for ${LABEL} on ${HOST}:${PORT} (timeout ${TIMEOUT_SEC}s)"

while (( SECONDS < deadline )); do
  if (echo >/dev/tcp/"${HOST}"/"${PORT}") >/dev/null 2>&1; then
    echo "[wait-tcp] ${LABEL} is ready"
    exit 0
  fi
  sleep 1
done

echo "[wait-tcp] timed out waiting for ${LABEL} on ${HOST}:${PORT}" >&2
exit 1
