#!/usr/bin/env bash
# Redis from official source tarball + make (C). No Docker, no Cargo.
set -euo pipefail

BLOCKSCOUT_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REDIS_V="${BLOCKSCOUT_REDIS_VERSION:-7.4.2}"
TC="${BLOCKSCOUT_HOME}/.toolchain/redis"
DATA="${BLOCKSCOUT_HOME}/.data/redis"
PORT="${BLOCKSCOUT_REDIS_PORT:-6380}"

if [[ ! -x "${TC}/src/redis-server" && ! -x "${TC}/bin/redis-server" ]]; then
  if ! command -v make >/dev/null 2>&1 || ! command -v gcc >/dev/null 2>&1; then
    echo "[blockscout] gcc and make are required to build redis-server once (not Cargo)." >&2
    exit 1
  fi
  echo "[blockscout] downloading Redis ${REDIS_V} source"
  tmp="$(mktemp -d)"
  curl -fsSL "https://download.redis.io/releases/redis-${REDIS_V}.tar.gz" -o "${tmp}/redis.tgz"
  rm -rf "${TC}"
  mkdir -p "${TC}"
  tar xzf "${tmp}/redis.tgz" --strip-components 1 -C "${TC}"
  rm -rf "${tmp}"
  echo "[blockscout] compiling redis-server (MALLOC=libc)"
  make -C "${TC}" MALLOC=libc -j"$(nproc)" redis-server
fi

REDIS_BIN="${TC}/src/redis-server"
[[ -x "${REDIS_BIN}" ]] || REDIS_BIN="${TC}/bin/redis-server"

if (echo >/dev/tcp/127.0.0.1/"${PORT}") >/dev/null 2>&1; then
  echo "[blockscout] redis already on :${PORT}; leaving the existing data dir"
else
  echo "[blockscout] clearing ${DATA} so this dev:local matches a fresh Anvil chain"
  rm -rf "${DATA}"
  mkdir -p "${DATA}"
  echo "[blockscout] starting redis on 127.0.0.1:${PORT}"
  "${REDIS_BIN}" --bind 127.0.0.1 --port "${PORT}" --dir "${DATA}" --save "" --appendonly no --daemonize no &
  mkdir -p "${BLOCKSCOUT_HOME}/.data"
  echo $! >"${BLOCKSCOUT_HOME}/.data/redis.pid"
fi
