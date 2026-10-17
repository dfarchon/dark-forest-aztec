#!/usr/bin/env bash
# Start Aztec local-network. Aztec 5.2 starts and owns its Anvil L1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Markers describe the ephemeral local chain. Remove a marker left by the
# previous run before any dependent process can treat it as current.
rm -f "${ROOT}/.mprocs/contracts.ok"

cd "${ROOT}"
# Build an L2 block only when a transaction is waiting.
export SEQ_MIN_TX_PER_BLOCK="${SEQ_MIN_TX_PER_BLOCK:-1}"
# Default 3s packs 21 blocks into the 72s slot, so a tx may declare at most
# 55882 DA gas. Publishing the Config class uses 72704. 6s yields 10 blocks
# and about 117668 DA gas per tx, which is the geometry that fits a class publish.
export SEQ_BLOCK_DURATION_MS="${SEQ_BLOCK_DURATION_MS:-6000}"

exec aztec start --local-network \
  --sequencer.minTxsPerBlock "${SEQ_MIN_TX_PER_BLOCK}" \
  --sequencer.blockDurationMs "${SEQ_BLOCK_DURATION_MS}"
