#!/usr/bin/env bash
# Start Aztec local-network against the shared Anvil L1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 8545 60 anvil

cd "${ROOT}"
export ETHEREUM_HOSTS="${ETHEREUM_HOSTS:-http://127.0.0.1:8545}"
# Build an L2 block only when a transaction is waiting.
export SEQ_MIN_TX_PER_BLOCK="${SEQ_MIN_TX_PER_BLOCK:-1}"
# Default 3s packs 21 blocks into the 72s slot, so a tx may declare at most
# 55882 DA gas. Publishing the Config class uses 72704. 6s yields 10 blocks
# and about 117668 DA gas per tx, which is the geometry that fits a class publish.
export SEQ_BLOCK_DURATION_MS="${SEQ_BLOCK_DURATION_MS:-6000}"

# Use the mprocs Anvil. Do not let local-network start a second Anvil.
exec aztec start --local-network --l1-rpc-urls "${ETHEREUM_HOSTS}" \
  --sequencer.minTxsPerBlock "${SEQ_MIN_TX_PER_BLOCK}" \
  --sequencer.blockDurationMs "${SEQ_BLOCK_DURATION_MS}"
