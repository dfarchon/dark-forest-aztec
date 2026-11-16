#!/usr/bin/env bash
# Native Blockscout (Mix API + Next UI) against Anvil L1.
# No Docker, no Cargo, no Rust microservices.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${ROOT}/tools/blockscout"
BACKEND="${DIR}/backend"
FRONTEND="${DIR}/frontend"
API_PORT="${BLOCKSCOUT_API_PORT:-4001}"
UI_PORT="${BLOCKSCOUT_UI_PORT:-4000}"

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 8545 60 anvil

# shellcheck source=/dev/null
source "${DIR}/bin/ensure-otp-elixir.sh"
# shellcheck source=/dev/null
source "${DIR}/bin/ensure-postgres.sh"
# shellcheck source=/dev/null
source "${DIR}/bin/ensure-redis.sh"
# shellcheck source=/dev/null
source "${DIR}/bin/env-anvil.sh"

mkdir -p "${DIR}/.data"
SECRET_FILE="${DIR}/.data/secret_key_base"
if [[ ! -f "${SECRET_FILE}" ]]; then
  openssl rand -base64 48 | tr -d '\n' >"${SECRET_FILE}"
fi
export SECRET_KEY_BASE="$(cat "${SECRET_FILE}")"

if command -v cast >/dev/null 2>&1; then
  tip="$(cast bn --rpc-url http://127.0.0.1:8545 2>/dev/null || true)"
  if [[ "${tip}" =~ ^[0-9]+$ ]]; then
    export FIRST_BLOCK=0
    export LAST_BLOCK="${tip}"
    echo "[mprocs-blockscout] indexer window FIRST_BLOCK=0 LAST_BLOCK=${tip}"
  fi
fi

bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 "${BLOCKSCOUT_PG_PORT:-5433}" 60 postgres
bash "${ROOT}/scripts/dev/wait-tcp.sh" 127.0.0.1 "${BLOCKSCOUT_REDIS_PORT:-6380}" 60 redis

if command -v createdb >/dev/null 2>&1; then
  createdb -h 127.0.0.1 -p "${BLOCKSCOUT_PG_PORT:-5433}" -U blockscout blockscout 2>/dev/null || true
fi

bash "${ROOT}/scripts/dev/ensure-vendor-clones.sh"
# pnpm run dev passes `git describe --tags` into dotenv -v. Shallow clones have no tags.
if ! git -C "${FRONTEND}" describe --tags --abbrev=0 >/dev/null 2>&1; then
  git -C "${FRONTEND}" tag -f local-dev
fi

cd "${BACKEND}"
bash "${DIR}/bin/apply-hex-security.sh" "${BACKEND}"
mix local.hex --force
mix local.rebar --force
echo "[mprocs-blockscout] mix deps.unlock/get for patched phoenix 1.6.17, mint 1.10.1, decimal 3.1"
mix deps.unlock phoenix mint decimal
mix deps.get
# Elixir 1.19 warns when Phoenix calls Endpoint.__sockets__ without parentheses.
python3 - <<'PY'
import pathlib
path = pathlib.Path("deps/phoenix/lib/phoenix/endpoint/supervisor.ex")
text = path.read_text()
old = "    endpoint.__sockets__\n"
new = "    endpoint.__sockets__()\n"
if old not in text and new not in text:
    raise SystemExit("phoenix socket_children call site not found")
path.write_text(text.replace(old, new, 1))
PY
mix compile
CERT_DIR="${BACKEND}/apps/block_scout_web/priv/cert"
BUILD_CERT="${BACKEND}/_build/dev/lib/block_scout_web/priv/cert"
if [[ ! -f "${CERT_DIR}/selfsigned_key.pem" ]]; then
  echo "[mprocs-blockscout] writing local HTTPS certs for Cowboy"
  mkdir -p "${CERT_DIR}"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "${CERT_DIR}/selfsigned_key.pem" \
    -out "${CERT_DIR}/selfsigned.pem" \
    -subj "/CN=localhost"
fi
mkdir -p "${BUILD_CERT}"
if [[ ! -f "${BUILD_CERT}/selfsigned_key.pem" ]]; then
  cp -a "${CERT_DIR}/selfsigned.pem" "${CERT_DIR}/selfsigned_key.pem" "${BUILD_CERT}/"
fi
mix ecto.create --quiet 2>/dev/null || true
mix ecto.migrate

cd "${FRONTEND}"
if [[ ! -d node_modules ]]; then
  echo "[mprocs-blockscout] pnpm install --frozen-lockfile in frontend (upstream lockfile)"
  export PNPM_IGNORE_ENGINE=true
  export COREPACK_ENABLE_STRICT=0
  pnpm install --frozen-lockfile
fi

cleanup() {
  if [[ -f "${DIR}/.data/postgres.pid" ]]; then
    kill "$(cat "${DIR}/.data/postgres.pid")" 2>/dev/null || true
  fi
  if [[ -f "${DIR}/.data/redis.pid" ]]; then
    kill "$(cat "${DIR}/.data/redis.pid")" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[mprocs-blockscout] API http://127.0.0.1:${API_PORT}  UI http://127.0.0.1:${UI_PORT}"
cd "${BACKEND}"
mix phx.server &
BACKEND_PID=$!

export NEXT_PUBLIC_API_HOST=127.0.0.1
export NEXT_PUBLIC_API_PORT="${API_PORT}"
export NEXT_PUBLIC_API_PROTOCOL=http
export NEXT_PUBLIC_API_WEBSOCKET_PROTOCOL=ws
export NEXT_PUBLIC_APP_HOST=127.0.0.1
export NEXT_PUBLIC_APP_PORT="${UI_PORT}"
export NEXT_PUBLIC_APP_PROTOCOL=http
export NEXT_PUBLIC_APP_ENV=development
export NEXT_PUBLIC_NETWORK_ID=31337
export NEXT_PUBLIC_NETWORK_NAME="Anvil L1"
export NEXT_PUBLIC_NETWORK_SHORT_NAME=Anvil
export NEXT_PUBLIC_NETWORK_RPC_URL=http://127.0.0.1:8545
export NEXT_PUBLIC_NETWORK_CURRENCY_NAME=Ether
export NEXT_PUBLIC_NETWORK_CURRENCY_SYMBOL=ETH
export NEXT_PUBLIC_IS_TESTNET=true

cd "${FRONTEND}"
cat >.env.local <<EOF
NEXT_PUBLIC_API_HOST=127.0.0.1
NEXT_PUBLIC_API_PORT=${API_PORT}
NEXT_PUBLIC_API_PROTOCOL=http
NEXT_PUBLIC_API_WEBSOCKET_PROTOCOL=ws
NEXT_PUBLIC_APP_HOST=127.0.0.1
NEXT_PUBLIC_APP_PORT=${UI_PORT}
NEXT_PUBLIC_APP_PROTOCOL=http
NEXT_PUBLIC_APP_ENV=development
NEXT_PUBLIC_NETWORK_ID=31337
NEXT_PUBLIC_NETWORK_NAME=Anvil L1
NEXT_PUBLIC_NETWORK_SHORT_NAME=Anvil
NEXT_PUBLIC_NETWORK_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_NETWORK_CURRENCY_NAME=Ether
NEXT_PUBLIC_NETWORK_CURRENCY_SYMBOL=ETH
NEXT_PUBLIC_IS_TESTNET=true
EOF
export PNPM_IGNORE_ENGINE=true
export COREPACK_ENABLE_STRICT=0
pnpm run dev &
FRONTEND_PID=$!

wait -n "${BACKEND_PID}" "${FRONTEND_PID}"
