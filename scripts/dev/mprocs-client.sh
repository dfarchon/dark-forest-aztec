#!/usr/bin/env bash
# Start the Vite client after contracts compile/deploy finishes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MARKER="${ROOT}/.mprocs/contracts.ok"
TIMEOUT_SEC="${CONTRACTS_READY_TIMEOUT_SEC:-3600}"

deadline=$((SECONDS + TIMEOUT_SEC))
echo "[mprocs-client] waiting for contracts marker ${MARKER} (timeout ${TIMEOUT_SEC}s)"

while (( SECONDS < deadline )); do
  if [[ -f "${MARKER}" ]]; then
    echo "[mprocs-client] contracts ready; starting client"
    cd "${ROOT}"
    exec pnpm --filter client dev --host 127.0.0.1 --port 5173
  fi
  sleep 2
done

echo "[mprocs-client] timed out waiting for ${MARKER}" >&2
exit 1
