#!/usr/bin/env bash
# Start the Vite client only after contracts deploy has published fresh addresses.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MARKER="${ROOT}/.mprocs/contracts.ok"
PUBLISHED_MARKER="${ROOT}/.mprocs/contracts.published"
INDEX_TS="${ROOT}/packages/contracts/src/index.ts"
TIMEOUT_SEC="${CONTRACTS_READY_TIMEOUT_SEC:-3600}"

deadline=$((SECONDS + TIMEOUT_SEC))
echo "[mprocs-client] waiting for contracts publish (${MARKER} + ${PUBLISHED_MARKER}, timeout ${TIMEOUT_SEC}s)"

while (( SECONDS < deadline )); do
  if [[ -f "${MARKER}" && -f "${PUBLISHED_MARKER}" && -f "${INDEX_TS}" ]]; then
    if grep -q 'CONFIG_CONTRACT_ADDRESS' "${INDEX_TS}"; then
      published_config="$(awk '/^config / {print $2}' "${PUBLISHED_MARKER}")"
      index_config="$(
        python3 - "${INDEX_TS}" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
m = re.search(r'CONFIG_CONTRACT_ADDRESS\s*=\s*\n?\s*"(0x[0-9a-fA-F]+)"', text)
print(m.group(1) if m else "")
PY
      )"
      if [[ -n "${published_config}" && "${published_config}" == "${index_config}" ]]; then
        echo "[mprocs-client] contracts published CONFIG ${index_config}; starting clean client"
        # Drop Vite prebundles so @dfpunk/contracts address exports are not stale.
        rm -rf "${ROOT}/client/node_modules/.vite" \
          "${ROOT}/client/dist" \
          "${ROOT}/node_modules/.vite" 2>/dev/null || true
        cd "${ROOT}"
        exec pnpm --filter client dev --host 127.0.0.1 --port 5173
      fi
      echo "[mprocs-client] index.ts CONFIG (${index_config}) != published marker (${published_config}); waiting"
    fi
  fi
  sleep 2
done

echo "[mprocs-client] timed out waiting for published contract addresses" >&2
exit 1
