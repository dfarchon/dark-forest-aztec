#!/usr/bin/env bash
# After deploy, send an admin no-op tx every 12s so L2 and Anvil advance.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MARKER="${ROOT}/.mprocs/contracts.ok"
INTERVAL_SEC="${TICK_INTERVAL_SEC:-12}"
TIMEOUT_SEC="${CONTRACTS_READY_TIMEOUT_SEC:-3600}"

# Do not trust a marker from an earlier local-network run. Waiting for the RPC
# first also gives the Aztec launcher time to invalidate that stale marker.
bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 8080 "${TIMEOUT_SEC}" aztec

deadline=$((SECONDS + TIMEOUT_SEC))
echo "[mprocs-ticker] waiting for contracts marker ${MARKER} (timeout ${TIMEOUT_SEC}s)"

while (( SECONDS < deadline )); do
  if [[ -f "${MARKER}" ]]; then
    echo "[mprocs-ticker] contracts ready; admin no-op every ${INTERVAL_SEC}s"
    cd "${ROOT}"
    exec pnpm --filter contracts run timestamp-ticker -- "${INTERVAL_SEC}"
  fi
  sleep 2
done

echo "[mprocs-ticker] timed out waiting for ${MARKER}" >&2
exit 1
