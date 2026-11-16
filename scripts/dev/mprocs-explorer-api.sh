#!/usr/bin/env bash
# Aztec explorer REST API on port 3000.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="${ROOT}/tools/aztec-explorer/api"

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 27017 60 mongo

if [[ ! -f "${API_DIR}/package.json" ]]; then
  echo "[aztec-exp-api] missing ${API_DIR}/package.json" >&2
  echo "[aztec-exp-api] local-aztec runs image bdehri/aztecexplorer-indexer-api; that repo is not public." >&2
  echo "[aztec-exp-api] place the API source in tools/aztec-explorer/api with a pnpm start script." >&2
  exit 1
fi

cd "${API_DIR}"
export PORT=3000
export DB_URL="${DB_URL:-mongodb://127.0.0.1:27017}"
export ENABLE_CORS=true
exec pnpm run start
