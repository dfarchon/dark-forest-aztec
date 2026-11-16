#!/usr/bin/env bash
# Chicmoz explorer UI (explorer-ui-v2) on port 8082.
# Talks to a Chicmoz API started outside this repo (minikube), not the local Mongo API.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FE_DIR="${ROOT}/tools/aztec-explorer/frontend"

if [[ ! -f "${FE_DIR}/package.json" ]]; then
  echo "[azt-exp-aztec-scan] missing ${FE_DIR}/package.json" >&2
  exit 1
fi

if [[ ! -d "${FE_DIR}/node_modules" ]]; then
  echo "[azt-exp-aztec-scan] dependencies are not installed." >&2
  echo "[azt-exp-aztec-scan] from ${FE_DIR} run: yarn install" >&2
  echo "[azt-exp-aztec-scan] the UI is the Chicmoz frontend; yarn is what that project uses." >&2
  exit 1
fi

cd "${FE_DIR}"
export VITE_L2_NETWORK_ID="${VITE_L2_NETWORK_ID:-SANDBOX}"
export VITE_API_KEY="${VITE_API_KEY:-dev-api-key}"
export VITE_API_URL="${VITE_API_URL:-http://127.0.0.1:3000/v1}"
export VITE_WS_URL="${VITE_WS_URL:-ws://127.0.0.1:3000}"
exec yarn dev --host 127.0.0.1 --port 8082 --strictPort
