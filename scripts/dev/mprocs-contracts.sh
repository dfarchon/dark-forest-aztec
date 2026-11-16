#!/usr/bin/env bash
# Compile, deploy, and configure contracts once Aztec local-network is up.
#
# Local sandbox resets wipe chain state, but contracts/.env keeps append-only
# ACCOUNT_* / contract addresses. Those stale values block deploy (address
# mismatch) or point at dead contracts — clear them before each local start.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MARKER_DIR="${ROOT}/.mprocs"
MARKER="${MARKER_DIR}/contracts.ok"
PUBLISHED_MARKER="${MARKER_DIR}/contracts.published"
STATE_FILE="${MARKER_DIR}/contracts-deploy.state"
ENV_FILE="${ROOT}/contracts/.env"
CONTRACTS_DIR="${ROOT}/contracts"
INDEX_TS="${ROOT}/packages/contracts/src/index.ts"

rm -f "${MARKER}" "${PUBLISHED_MARKER}"
mkdir -p "${MARKER_DIR}"

# Non-interactive local stack: never block on artifact overwrite prompts.
export DFPUNK_FORCE_OVERWRITE=1

publish_client_addresses() {
  echo "[mprocs-contracts] publishing addresses to packages/contracts/src/index.ts"
  (
    cd "${ROOT}"
    pnpm --filter contracts run deploy:publish -- --yes
  )
  if [[ ! -f "${INDEX_TS}" ]] || ! grep -q 'CONFIG_CONTRACT_ADDRESS' "${INDEX_TS}"; then
    echo "[mprocs-contracts] publish did not write ${INDEX_TS}" >&2
    exit 1
  fi
  # Fingerprint the published Config address so the client can wait for a fresh write.
  python3 - "${INDEX_TS}" "${PUBLISHED_MARKER}" <<'PY'
import re, sys
from pathlib import Path
index_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
text = index_path.read_text()
m = re.search(r'CONFIG_CONTRACT_ADDRESS\s*=\s*\n?\s*"(0x[0-9a-fA-F]+)"', text)
if not m:
    raise SystemExit("CONFIG_CONTRACT_ADDRESS missing from published index.ts")
out_path.write_text(f"config {m.group(1)}\nindex {index_path}\n")
print(f"[mprocs-contracts] published CONFIG {m.group(1)}")
PY
}

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 8080 480 aztec

source_hash="$(
  find "${CONTRACTS_DIR}" -type f \( -name '*.nr' -o -name 'Nargo.toml' \) \
    ! -path '*/target/*' ! -path '*/scripts/artifacts/*' -print0 \
    | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
)"
l1_genesis="$(cast block 0 --rpc-url http://127.0.0.1:8545 -f hash 2>/dev/null || true)"

saved_source=""
saved_l1=""
if [[ -f "${STATE_FILE}" ]]; then
  saved_source="$(awk '/^source / {print $2}' "${STATE_FILE}")"
  saved_l1="$(awk '/^l1 / {print $2}' "${STATE_FILE}")"
fi

artifacts_ready=0
if compgen -G "${CONTRACTS_DIR}/scripts/artifacts/*.json" >/dev/null; then
  artifacts_ready=1
fi

core_address=""
if [[ -f "${ENV_FILE}" ]]; then
  core_address="$(awk -F= '/^CORE_CONTRACT_ADDRESS=/ {print $2}' "${ENV_FILE}")"
fi

chain_has_contracts=0
if [[ -n "${core_address}" ]]; then
  rpc_result="$(
    curl -sf http://127.0.0.1:8080 \
      -H 'content-type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"node_getContract\",\"params\":[\"${core_address}\"]}" \
      || true
  )"
  if [[ -n "${rpc_result}" && "${rpc_result}" != *'"result":null'* && "${rpc_result}" == *'"result":'* ]]; then
    chain_has_contracts=1
  fi
fi

sources_match=0
if [[ -n "${saved_source}" && "${saved_source}" == "${source_hash}" && "${artifacts_ready}" == 1 ]]; then
  sources_match=1
fi

write_state() {
  printf 'source %s\nl1 %s\n' "${source_hash}" "${l1_genesis}" > "${STATE_FILE}"
}

if [[ "${sources_match}" == 1 && "${chain_has_contracts}" == 1 && "${saved_l1}" == "${l1_genesis}" ]]; then
  echo "[mprocs-contracts] sources unchanged and contracts already on this chain; skipping compile and deploy"
  # Still republish index.ts so the client never boots on stale addresses.
  publish_client_addresses
  write_state
  touch "${MARKER}"
  echo "[mprocs-contracts] done (marker ${MARKER})"
  exit 0
fi

clear_stale_env() {
if [[ -f "${ENV_FILE}" ]]; then
  python3 - "${ENV_FILE}" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
clear_exact = {
    "ACCOUNT_SALT",
    "ACCOUNT_SECRET_KEY",
    "ACCOUNT_SIGNING_KEY",
    "ACCOUNT_ADDRESS",
    "START_BLOCK",
}
clear_suffixes = (
    "_CONTRACT_ADDRESS",
    "_DEPLOYER_ADDRESS",
    "_DEPLOYMENT_SALT",
)

def should_clear(key: str) -> bool:
    return key in clear_exact or any(key.endswith(s) for s in clear_suffixes)

out = []
cleared = 0
for line in text.splitlines():
    s = line.strip()
    if s and not s.startswith("#") and "=" in s:
        key = s.split("=", 1)[0].strip()
        if should_clear(key):
            out.append(f"# cleared for local redeploy: {line}")
            cleared += 1
            continue
    out.append(line)

if cleared:
    path.write_text("\n".join(out) + "\n")
    print(f"[mprocs-contracts] cleared {cleared} stale ACCOUNT_*/deploy keys in {path}")
else:
    print(f"[mprocs-contracts] no stale ACCOUNT_*/deploy keys in {path}")
PY
fi
}

cd "${ROOT}"

if [[ "${sources_match}" == 1 ]]; then
  echo "[mprocs-contracts] sources unchanged; skipping compile, deploying onto this chain"
  clear_stale_env
  printf 'y\n' | pnpm --filter contracts run deploy:run
  printf 'y\n' | pnpm --filter contracts run bootstrap
  publish_client_addresses
else
  echo "[mprocs-contracts] sources changed or artifacts missing; compiling and deploying"
  clear_stale_env
  # deploy:start ends with deploy:publish; env DFPUNK_FORCE_OVERWRITE avoids prompts.
  printf 'y\n' | pnpm --filter contracts run deploy:start
  # Guarantee a fresh index.ts + published marker even if start's publish was skipped.
  publish_client_addresses
fi

write_state
touch "${MARKER}"
echo "[mprocs-contracts] done (marker ${MARKER})"
