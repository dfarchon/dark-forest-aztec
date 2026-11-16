#!/usr/bin/env bash
# Aztec explorer indexer. Syncs L2 blocks into MongoDB.
# Same roles as alejoamiras/local-aztec aztecexplorer-indexer, without Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INDEXER_DIR="${ROOT}/tools/aztec-explorer/indexer"

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 27017 60 mongo
bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 8080 480 aztec

if [[ ! -f "${INDEXER_DIR}/package.json" ]]; then
  echo "[aztec-exp-indexer] missing ${INDEXER_DIR}/package.json" >&2
  echo "[aztec-exp-indexer] local-aztec runs image bdehri/aztecexplorer-indexer; that repo is not public." >&2
  echo "[aztec-exp-indexer] place the indexer source in tools/aztec-explorer/indexer with a pnpm start script." >&2
  exit 1
fi

cd "${INDEXER_DIR}"
export DB_URL="${DB_URL:-mongodb://127.0.0.1:27017}"
export PXE_URL="${PXE_URL:-http://127.0.0.1:8080}"
exec pnpm run start
