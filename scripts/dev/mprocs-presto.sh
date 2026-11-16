#!/usr/bin/env bash
# Headless Presto native prover (https://github.com/alejoamiras/presto).
# Listens on http://127.0.0.1:59833, the client default in VITE_TEEREX_PROVER_URL.
# The desktop tray app is a separate install; this pane runs presto-server only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_BIN="${ROOT}/tools/presto/packages/presto/server/target/release/presto-server"
USER_BIN="${HOME}/.local/bin/presto-server"

if command -v presto-server >/dev/null 2>&1; then
  BIN="$(command -v presto-server)"
elif [[ -x "${USER_BIN}" ]]; then
  BIN="${USER_BIN}"
elif [[ -x "${LOCAL_BIN}" ]]; then
  BIN="${LOCAL_BIN}"
else
  echo "[mprocs-presto] presto-server is not installed." >&2
  echo "[mprocs-presto] The headless server is a Rust binary, not a pnpm package." >&2
  echo "[mprocs-presto] This project does not build it with Cargo or run it from Docker." >&2
  echo "[mprocs-presto] Put a released presto-server binary on PATH if you want this pane." >&2
  echo "[mprocs-presto] The client uses it only when VITE_PROVER_ENABLED=true." >&2
  exit 1
fi

export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://127.0.0.1:5173,http://localhost:5173}"
echo "[mprocs-presto] ${BIN} (origins ${ALLOWED_ORIGINS})"
exec "${BIN}"
