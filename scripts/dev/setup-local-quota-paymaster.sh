#!/usr/bin/env bash
# Deploy and fund the local QuotaFpc, then expose it to the Vite client.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACTS_ENV="${ROOT}/contracts/.env"
CLIENT_ENV="${ROOT}/client/.env.local"
CONFIG_MODULE="./quota-paymaster.config.ts"
LOCAL_CONFIG="fpc/config/local.json"
JOURNAL_DIR="${ROOT}/.mprocs/quota-paymaster-journal"
TICKER_LOG="${ROOT}/.mprocs/quota-bootstrap-ticker.log"
ticker_pid=""
deploy_log=""

cleanup() {
  if [[ -n "${ticker_pid}" ]]; then
    kill "${ticker_pid}" 2>/dev/null || true
    wait "${ticker_pid}" 2>/dev/null || true
  fi
  if [[ -n "${deploy_log}" ]]; then
    rm -f "${deploy_log}"
  fi
}
trap cleanup EXIT

if [[ ! -f "${CONTRACTS_ENV}" ]]; then
  echo "[quota-fpc] missing ${CONTRACTS_ENV}; deploy game contracts first" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${CONTRACTS_ENV}"
set +a

export NODE_URL="${AZTEC_NODE_URL:-http://127.0.0.1:8080}"
export L1_RPC_URL="${ETHEREUM_HOST:-http://127.0.0.1:8545}"
# First Anvil dev account. This script is local-network-only.
export L1_PRIVATE_KEY="${L1_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
export QUOTA_FPC_ADMIN_ADDRESS="${QUOTA_FPC_ADMIN_ADDRESS:-${ACCOUNT_ADDRESS}}"

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  mkdir -p "$(dirname "${file}")"
  touch "${file}"
  python3 - "${file}" "${key}" "${value}" <<'PY'
import sys
from pathlib import Path

path, key, value = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
lines = path.read_text().splitlines()
out = []
replaced = False
for line in lines:
    if line.startswith(f"{key}="):
        if not replaced:
            out.append(f"{key}={value}")
            replaced = True
        continue
    out.append(line)
if not replaced:
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
}

contract_exists() {
  local address="$1"
  local response
  response="$(curl -sf "${NODE_URL}" \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"node_getContract\",\"params\":[\"${address}\"]}" \
    || true)"
  [[ "${response}" == *'"result":'* && "${response}" != *'"result":null'* ]]
}

claim_with_retry() {
  local recipient="$1"
  local attempt
  for attempt in {1..30}; do
    # On the local sandbox the first simulation can race the L1 -> L2 message.
    # Retrying is safe here because a successful claim is recorded as CLAIMED;
    # this flag only clears the CLI's conservative unknown-outcome guard.
    if pnpm fpc claim --for "${recipient}" --config-module "${CONFIG_MODULE}" \
      --journal-dir "${JOURNAL_DIR}" --allow-retry-after-unknown --yes </dev/null; then
      return 0
    fi
    echo "[quota-fpc] claim message not ready; retry ${attempt}/30"
    sleep 2
  done
  echo "[quota-fpc] timed out waiting for claim message for ${recipient}" >&2
  return 1
}

cd "${ROOT}/contracts"

existing="${QUOTA_FPC_CONTRACT_ADDRESS:-}"
if [[ -n "${existing}" ]] && contract_exists "${existing}"; then
  echo "[quota-fpc] reusing ${existing}"
  upsert_env "${CONTRACTS_ENV}" QUOTA_FPC_CONTRACT_ADDRESS "${existing}"
  upsert_env "${CLIENT_ENV}" VITE_QUOTA_FPC_ADDRESS "${existing}"
  exit 0
fi

# The local FeeJuice ERC20 is mintable. Seed the Anvil bridge account before
# creating deposits; production networks must never take this branch.
cast send "${LOCAL_FEE_ASSET_ADDRESS:-0x0165878A594ca255338adfa4d48449f69242Eb8F}" \
  'mint(address,uint256)' 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 \
  "${LOCAL_FEE_ASSET_MINT_WEI:-1000000000000000000000}" \
  --rpc-url "${L1_RPC_URL}" --private-key "${L1_PRIVATE_KEY}" >/dev/null

deploy_log="$(mktemp)"
pnpm fpc deploy --config "${LOCAL_CONFIG}" --config-module "${CONFIG_MODULE}" --yes </dev/null | tee "${deploy_log}"
address="$(sed -n 's/.*QUOTA_FPC_CONTRACT_ADDRESS=\(0x[0-9a-fA-F]*\).*/\1/p' "${deploy_log}" | tail -1)"
if [[ -z "${address}" ]]; then
  echo "[quota-fpc] deployment completed without an address in the CLI output" >&2
  exit 1
fi

# The local sequencer only builds a block when a transaction is pending. Keep
# it moving while the freshly bridged L1 message advances to a usable L2
# checkpoint; the normal mprocs ticker starts only after this setup finishes.
pnpm --filter contracts run timestamp-ticker 2 >"${TICKER_LOG}" 2>&1 &
ticker_pid=$!

echo "[quota-fpc] funding paymaster ${address}"
pnpm fpc bridge --to "${address}" --amount "${QUOTA_FPC_FUND_FJ:-500}" \
  --config-module "${CONFIG_MODULE}" --journal-dir "${JOURNAL_DIR}" --yes </dev/null
claim_with_retry "${address}"

upsert_env "${CONTRACTS_ENV}" QUOTA_FPC_CONTRACT_ADDRESS "${address}"
upsert_env "${CLIENT_ENV}" VITE_QUOTA_FPC_ADDRESS "${address}"
echo "[quota-fpc] ready: ${address}"
