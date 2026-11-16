#!/usr/bin/env bash
# Host MongoDB for the Aztec L2 explorer. No Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${ROOT}/tools/aztec-explorer/mongo-data"

if ! command -v mongod >/dev/null 2>&1; then
  echo "[aztec-exp-mongoDB] mongod is not on PATH. Install MongoDB on the host." >&2
  exit 1
fi

if timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/27017' 2>/dev/null; then
  echo "[aztec-exp-mongoDB] 127.0.0.1:27017 is already in use; leaving the existing data dir." >&2
else
  echo "[aztec-exp-mongoDB] clearing ${DATA_DIR} so this dev:local matches a fresh Anvil and Aztec chain"
  rm -rf "${DATA_DIR}"
fi

mkdir -p "${DATA_DIR}"
exec mongod --dbpath "${DATA_DIR}" --bind_ip 127.0.0.1 --port 27017
