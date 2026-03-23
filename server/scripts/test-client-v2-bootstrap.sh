#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER_URL="${SERVER_URL:-http://localhost:3001}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-}"
TEST_TIMEOUT="${TEST_TIMEOUT:-10}"

RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

log() {
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '%sPASS%s %s\n' "$GREEN" "$RESET" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '%sFAIL%s %s\n' "$RED" "$RESET" "$1"
}

warn() {
  printf '%sWARN%s %s\n' "$YELLOW" "$RESET" "$1"
}

run_step() {
  local name="$1"
  local cmd="$2"
  log "Running: $name"
  if eval "$cmd"; then
    pass "$name"
  else
    fail "$name"
  fi
}

use_node_24() {
  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # shellcheck source=/dev/null
    source "${HOME}/.nvm/nvm.sh"
    if ! nvm use 24.12.0 >/dev/null 2>&1; then
      nvm install 24.12.0 >/dev/null
      nvm use 24.12.0 >/dev/null
    fi
    log "Using node: $(node -v)"
  else
    warn "nvm not found, using current node: $(node -v 2>/dev/null || echo unknown)"
  fi
}

check_health() {
  local body
  body="$(curl -fsS --max-time "${TEST_TIMEOUT}" "${SERVER_URL}/health")" || return 1
  if command -v jq >/dev/null 2>&1; then
    [[ "$(printf '%s' "$body" | jq -r '.status // empty')" == "ok" ]]
  else
    printf '%s' "$body" | grep -q '"status":"ok"'
  fi
}

check_manifest_v2() {
  local body
  body="$(curl -fsS --max-time "${TEST_TIMEOUT}" "${SERVER_URL}/snapshot/manifest")" || return 1
  if command -v jq >/dev/null 2>&1; then
    [[ "$(printf '%s' "$body" | jq -r '.version // empty')" == "2" ]]
  else
    printf '%s' "$body" | grep -q '"version":2'
  fi
}

check_chunk_status() {
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "${TEST_TIMEOUT}" "${SERVER_URL}/snapshot/chunks/player/0")" || return 1
  [[ "$code" == "200" || "$code" == "404" ]]
}

compare_snapshot_if_needed() {
  if [[ -z "$SNAPSHOT_FILE" ]]; then
    warn "SNAPSHOT_FILE not set, skip compare-snapshots"
    return 0
  fi
  node "${ROOT_DIR}/server/scripts/compare-snapshots.mjs" \
    "$SNAPSHOT_FILE" \
    --server-url "$SERVER_URL" \
    --ignore-block-mismatch
}

main() {
  parse_args "$@"
  log "Root: ${ROOT_DIR}"
  log "Server URL: ${SERVER_URL}"
  use_node_24

  run_step "Server Typecheck (tsc --noEmit)" \
    "cd '${ROOT_DIR}' && corepack pnpm --filter server exec tsc --noEmit"

  run_step "Server Tests (api/persistence/config/index/contractsConfig)" \
    "cd '${ROOT_DIR}' && node --experimental-transform-types --test \
      server/src/api.test.ts \
      server/src/persistence.test.ts \
      server/src/snapshotContract.test.ts \
      server/src/config.test.ts \
      server/src/index.test.ts \
      server/src/contractsConfig.test.ts"

  run_step "API Smoke /health status=ok" check_health
  run_step "API Smoke /snapshot/manifest version=2" check_manifest_v2
  run_step "API Smoke /snapshot/chunks/player/0 status in {200,404}" check_chunk_status
  run_step "Snapshot Compare (optional)" compare_snapshot_if_needed

  printf '\nSummary: %s%d passed%s, %s%d failed%s\n' "$GREEN" "$PASS_COUNT" "$RESET" "$RED" "$FAIL_COUNT" "$RESET"
  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    return 1
  fi
}

usage() {
  cat <<'EOF'
Usage:
  server/scripts/test-client-v2-bootstrap.sh [options]

Options:
  --server-url <url>       Server base URL (default: http://localhost:3001)
  --snapshot-file <path>   Local client snapshot JSON for compare step
  --timeout <seconds>      Curl timeout seconds (default: 10)
  -h, --help               Show this help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --server-url)
        SERVER_URL="${2:-}"
        shift 2
        ;;
      --snapshot-file)
        SNAPSHOT_FILE="${2:-}"
        shift 2
        ;;
      --timeout)
        TEST_TIMEOUT="${2:-}"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "Unknown option: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
}

main "$@"
