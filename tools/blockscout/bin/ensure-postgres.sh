#!/usr/bin/env bash
# Host Postgres 18 binaries (theseus-rs). No Docker, no Cargo.
set -euo pipefail

BLOCKSCOUT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_VER="${BLOCKSCOUT_POSTGRES_VERSION:-18.6.0}"
TC="${BLOCKSCOUT_HOME}/.toolchain/postgres"
DATA="${BLOCKSCOUT_HOME}/.data/pg"
PORT="${BLOCKSCOUT_PG_PORT:-5433}"

arch_raw="$(uname -m)"
case "${arch_raw}" in
  x86_64|amd64) triple=x86_64-unknown-linux-gnu ;;
  aarch64|arm64) triple=aarch64-unknown-linux-gnu ;;
  *)
    echo "[blockscout] unsupported CPU ${arch_raw} for postgres binaries" >&2
    exit 1
    ;;
esac

if [[ ! -x "${TC}/bin/postgres" ]]; then
  echo "[blockscout] downloading PostgreSQL ${PG_VER}"
  tmp="$(mktemp -d)"
  url="https://github.com/theseus-rs/postgresql-binaries/releases/download/${PG_VER}/postgresql-${PG_VER}-${triple}.tar.gz"
  curl -fsSL -L "${url}" -o "${tmp}/pg.tgz"
  rm -rf "${TC}"
  mkdir -p "${TC}"
  tar xzf "${tmp}/pg.tgz" -C "${tmp}"
  inner="$(find "${tmp}" -type f -name postgres | head -1)"
  if [[ -z "${inner}" ]]; then
    echo "[blockscout] postgres binary missing from tarball" >&2
    exit 1
  fi
  cp -a "$(dirname "$(dirname "${inner}")")/." "${TC}/"
  rm -rf "${tmp}"
fi

export PATH="${TC}/bin:${PATH}"

if (echo >/dev/tcp/127.0.0.1/"${PORT}") >/dev/null 2>&1; then
  echo "[blockscout] postgres already on :${PORT}; leaving the existing data dir"
else
  echo "[blockscout] clearing ${DATA} so this dev:local matches a fresh Anvil chain"
  rm -rf "${DATA}"
  mkdir -p "${DATA}"
  echo "[blockscout] initdb ${DATA}"
  initdb -D "${DATA}" --username=blockscout --auth=trust
  echo "[blockscout] starting postgres on 127.0.0.1:${PORT}"
  mkdir -p "${BLOCKSCOUT_HOME}/.data"
  postgres -D "${DATA}" -k "${BLOCKSCOUT_HOME}/.data" -h 127.0.0.1 -p "${PORT}" &
  echo $! >"${BLOCKSCOUT_HOME}/.data/postgres.pid"
fi
