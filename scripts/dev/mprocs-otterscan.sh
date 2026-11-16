#!/usr/bin/env bash
# Serve the local Otterscan build against Anvil. No Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OTTERSCAN_DIR="${ROOT}/tools/otherscan"

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 8545 60 anvil

cd "${OTTERSCAN_DIR}"
exec pnpm exec vite preview --host 127.0.0.1 --port 5100
