#!/usr/bin/env bash
# Delete the persisted indexer snapshot so the next server start replays
# public storage events from START_BLOCK. Stop the indexer process first.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_DB="${ROOT}/data/indexer.db"

if [[ -n "${SQLITE_PATH:-}" ]]; then
  DB_PATH="${SQLITE_PATH}"
elif [[ -f "${ROOT}/.env" ]]; then
  # Last matching assignment wins, matching contracts/scripts env loading.
  DB_PATH="$(
    awk -F= '
      $1 == "SQLITE_PATH" {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        gsub(/^["'\'']|["'\'']$/, "", value)
        last = value
      }
      END { if (last != "") print last }
    ' "${ROOT}/.env"
  )"
fi

if [[ -z "${DB_PATH:-}" ]]; then
  DB_PATH="${DEFAULT_DB}"
elif [[ "${DB_PATH}" != /* ]]; then
  DB_PATH="${ROOT}/${DB_PATH#./}"
fi

echo "[reindex] Removing snapshot at ${DB_PATH}"
rm -f "${DB_PATH}" "${DB_PATH}-wal" "${DB_PATH}-shm"

echo "[reindex] Snapshot deleted. Start the server after the Aztec node public logs have caught up:"
echo "  pnpm --filter server start"
