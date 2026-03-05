#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
shift || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SERVER_DIR}/.." && pwd)"

ANVIL_PID_FILE="${DFPUNK_ANVIL_PID:-/tmp/dfpunk-anvil.pid}"
AZTEC_PID_FILE="${DFPUNK_AZTEC_PID:-/tmp/dfpunk-aztec.pid}"
SERVER_PID_FILE="${DFPUNK_SERVER_PID:-/tmp/dfpunk-server.pid}"
E2E_PID_FILE="${SERVER_E2E_PID:-/tmp/server-e2e.pid}"

ANVIL_LOG_FILE="${DFPUNK_ANVIL_LOG:-/tmp/dfpunk-anvil.log}"
AZTEC_LOG_FILE="${DFPUNK_AZTEC_LOG:-/tmp/dfpunk-aztec.log}"
SERVER_LOG_FILE="${DFPUNK_SERVER_LOG:-/tmp/dfpunk-server.log}"
E2E_LOG_FILE="${SERVER_E2E_LOG:-/tmp/server-e2e.log}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing command: $1"
    exit 1
  fi
}

cleanup_contract_test_processes() {
  local pids
  pids="$(pgrep -f "node --experimental-transform-types scripts/test-.*\\.ts" || true)"
  if [[ -n "${pids}" ]]; then
    echo "${pids}" | xargs -r kill >/dev/null 2>&1 || true
    echo "killed orphaned contract test processes: ${pids//$'\n'/ }"
  fi
}

list_e2e_pids() {
  pgrep -f "test-indexer-e2e\\.mjs" || true
}

kill_e2e_processes() {
  local pids
  pids="$(list_e2e_pids)"
  if [[ -n "${pids}" ]]; then
    echo "${pids}" | xargs -r kill >/dev/null 2>&1 || true
    echo "killed orphaned indexer-e2e processes: ${pids//$'\n'/ }"
    sleep 1
    local remaining
    remaining="$(list_e2e_pids)"
    if [[ -n "${remaining}" ]]; then
      echo "${remaining}" | xargs -r kill -9 >/dev/null 2>&1 || true
      echo "force-killed stubborn indexer-e2e processes: ${remaining//$'\n'/ }"
    fi
  fi
}

is_running_pidfile() {
  local pid_file="$1"
  [[ -f "${pid_file}" ]] || return 1
  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  [[ -n "${pid}" ]] || return 1
  kill -0 "${pid}" >/dev/null 2>&1
}

stop_by_pidfile() {
  local name="$1"
  local pid_file="$2"
  if is_running_pidfile "${pid_file}"; then
    local pid
    pid="$(cat "${pid_file}")"
    kill "${pid}" >/dev/null 2>&1 || true
    rm -f "${pid_file}"
    echo "stopped ${name}: pid=${pid}"
  else
    rm -f "${pid_file}"
  fi
}

start_bg() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if is_running_pidfile "${pid_file}"; then
    echo "${name} already running: pid=$(cat "${pid_file}")"
    return 0
  fi

  nohup "$@" >"${log_file}" 2>&1 &
  local pid=$!
  echo "${pid}" >"${pid_file}"
  echo "started ${name}: pid=${pid} log=${log_file}"
}

wait_for_port_stable() {
  local port="$1"
  local timeout_sec="$2"
  local stable_sec="$3"
  local name="$4"
  local deadline=$((SECONDS + timeout_sec))
  local stable_count=0

  while ((SECONDS < deadline)); do
    if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      stable_count=$((stable_count + 1))
      if ((stable_count >= stable_sec)); then
        return 0
      fi
    else
      stable_count=0
    fi
    sleep 1
  done

  echo "timeout waiting ${name} to stay listening on :${port} for ${stable_sec}s"
  return 1
}

wait_for_http_ok() {
  local url="$1"
  local timeout_sec="$2"
  local name="$3"
  local deadline=$((SECONDS + timeout_sec))

  while ((SECONDS < deadline)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "timeout waiting ${name} at ${url}"
  return 1
}

resolve_aztec_cmd() {
  local aztec_entry
  aztec_entry="$(ls -1d "${HOME}"/.aztec/versions/*/node_modules/@aztec/aztec/dest/bin/index.js 2>/dev/null | tail -n 1 || true)"
  if [[ -n "${aztec_entry}" ]]; then
    echo "node --no-warnings ${aztec_entry}"
    return 0
  fi

  if command -v aztec >/dev/null 2>&1; then
    echo "aztec"
    return 0
  fi

  return 1
}

start_anvil() {
  require_cmd anvil
  if lsof -nP -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "anvil already listening on :8545"
  else
    start_bg "anvil" "${ANVIL_PID_FILE}" "${ANVIL_LOG_FILE}" \
      anvil --silent --host 127.0.0.1 --port 8545
  fi
  wait_for_port_stable 8545 20 2 "anvil"
}

start_aztec() {
  if lsof -nP -iTCP:8080 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "aztec already listening on :8080"
    if wait_for_port_stable 8080 10 3 "existing aztec"; then
      return 0
    fi
    echo "existing aztec listener is unstable, starting managed aztec"
  fi

  local aztec_cmd
  aztec_cmd="$(resolve_aztec_cmd || true)"
  if [[ -z "${aztec_cmd}" ]]; then
    echo "cannot find aztec cli or local aztec entrypoint under ~/.aztec/versions"
    exit 1
  fi

  # shellcheck disable=SC2086
  start_bg "aztec" "${AZTEC_PID_FILE}" "${AZTEC_LOG_FILE}" \
    bash -lc "source ~/.nvm/nvm.sh >/dev/null 2>&1 || true; nvm use 24.12.0 >/dev/null 2>&1 || true; ${aztec_cmd} start --local-network --l1-rpc-urls http://127.0.0.1:8545"
  wait_for_port_stable 8080 180 5 "aztec"
}

start_server() {
  require_cmd pnpm
  if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "server already listening on :3001"
  else
    start_bg "server" "${SERVER_PID_FILE}" "${SERVER_LOG_FILE}" \
      bash -lc "cd '${REPO_ROOT}' && source ~/.nvm/nvm.sh >/dev/null 2>&1 || true; nvm use 24.12.0 >/dev/null 2>&1 || true; pnpm --filter server run dev"
  fi
  wait_for_http_ok "http://localhost:3001/health" 90 "server"
}

start_e2e() {
  local args=("$@")
  if [[ ${#args[@]} -eq 0 ]]; then
    args=(--interval-sec 0 --sqlite-max-lag-blocks 2)
  fi

  rm -f "${E2E_PID_FILE}"
  kill_e2e_processes
  cleanup_contract_test_processes

  if is_running_pidfile "${E2E_PID_FILE}"; then
    echo "indexer-e2e already running: pid=$(cat "${E2E_PID_FILE}") log=${E2E_LOG_FILE}"
    return 1
  fi

  wait_for_http_ok "http://localhost:3001/health" 60 "server before e2e"

  nohup bash -lc "cd '${SERVER_DIR}' && source ~/.nvm/nvm.sh >/dev/null 2>&1 || true; nvm use 24.12.0 >/dev/null 2>&1 || true; node --experimental-transform-types -e '' >/dev/null 2>&1 || { echo 'node does not support --experimental-transform-types'; exit 64; }; exec node scripts/test-indexer-e2e.mjs --server-url http://localhost:3001 ${args[*]}" >"${E2E_LOG_FILE}" 2>&1 &
  local pid=$!
  echo "${pid}" >"${E2E_PID_FILE}"
  echo "indexer-e2e started: pid=${pid} log=${E2E_LOG_FILE}"
}

start_e2e_fast() {
  local args=(
    --interval-sec 0
    --high-throughput
    --skip-warmup
    --max-no-progress-steps 6
    --sqlite-max-lag-blocks 3
    --sqlite-check-interval-sec 90
    --coverage-check-interval-sec 120
  )
  start_e2e "${args[@]}" "$@"
}

run_contracts_start() {
  require_cmd pnpm
  require_cmd aztec

  echo "[contracts] clean-store"
  bash -lc "cd '${REPO_ROOT}' && source ~/.nvm/nvm.sh >/dev/null 2>&1 || true; nvm use 24.12.0 >/dev/null 2>&1 || true; PATH='/opt/homebrew/bin':\$PATH; pnpm --filter contracts run clean-store"
  echo "[contracts] start"
  bash -lc "cd '${REPO_ROOT}' && source ~/.nvm/nvm.sh >/dev/null 2>&1 || true; nvm use 24.12.0 >/dev/null 2>&1 || true; PATH='/opt/homebrew/bin':\$PATH; printf 'y\n' | pnpm --filter contracts run start"
}

stop_e2e() {
  if is_running_pidfile "${E2E_PID_FILE}"; then
    local pid
    pid="$(cat "${E2E_PID_FILE}")"
    kill "${pid}" >/dev/null 2>&1 || true
    echo "indexer-e2e stopped: pid=${pid}"
  else
    rm -f "${E2E_PID_FILE}"
    echo "e2e is not running"
  fi

  # Fallback: kill any orphaned e2e process not tracked by pid file.
  kill_e2e_processes
  cleanup_contract_test_processes
  rm -f "${E2E_PID_FILE}"
}

ensure_single_e2e() {
  stop_e2e || true
}

status_e2e() {
  if is_running_pidfile "${E2E_PID_FILE}"; then
    echo "running: pid=$(cat "${E2E_PID_FILE}") log=${E2E_LOG_FILE}"
  else
    echo "stopped"
  fi
}

logs_e2e() {
  touch "${E2E_LOG_FILE}"
  tail -f "${E2E_LOG_FILE}"
}

reset_cache() {
  stop_e2e || true
  stop_by_pidfile "server" "${SERVER_PID_FILE}"
  stop_by_pidfile "aztec" "${AZTEC_PID_FILE}"
  stop_by_pidfile "anvil" "${ANVIL_PID_FILE}"

  # Fallback: release occupied ports if they are still taken by stale processes.
  lsof -tiTCP:3001 -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
  lsof -tiTCP:8080 -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
  lsof -tiTCP:8545 -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true

  rm -f "${REPO_ROOT}/contracts/scripts/.test-accounts.json"
  rm -rf "${REPO_ROOT}/contracts/.store"
  rm -rf "${REPO_ROOT}"/contracts/wallet_data_*
  rm -f "${SERVER_DIR}/data/indexer.db"

  mkdir -p "${SERVER_DIR}/data"
  echo "cache reset complete"
}

show_status() {
  echo "=== ports ==="
  lsof -nP -iTCP:8545 -sTCP:LISTEN || true
  lsof -nP -iTCP:8080 -sTCP:LISTEN || true
  lsof -nP -iTCP:3001 -sTCP:LISTEN || true
  lsof -nP -iTCP:5173 -sTCP:LISTEN || true

  echo
  echo "=== managed pids ==="
  for f in "${ANVIL_PID_FILE}" "${AZTEC_PID_FILE}" "${SERVER_PID_FILE}" "${E2E_PID_FILE}"; do
    if [[ -f "${f}" ]]; then
      if is_running_pidfile "${f}"; then
        echo "$(basename "${f}") => $(cat "${f}") (running)"
      else
        echo "$(basename "${f}") => $(cat "${f}") (stale)"
      fi
    else
      echo "$(basename "${f}") => (none)"
    fi
  done

  echo
  echo "=== health ==="
  curl -sS http://localhost:3001/health || true
  echo
  curl -sS http://localhost:3001/blocks/latest || true
  echo
}

show_logs() {
  local target="${1:-all}"
  case "${target}" in
    anvil) tail -f "${ANVIL_LOG_FILE}" ;;
    aztec) tail -f "${AZTEC_LOG_FILE}" ;;
    server) tail -f "${SERVER_LOG_FILE}" ;;
    e2e) tail -f "${E2E_LOG_FILE}" ;;
    all)
      echo "anvil:  ${ANVIL_LOG_FILE}"
      echo "aztec:  ${AZTEC_LOG_FILE}"
      echo "server: ${SERVER_LOG_FILE}"
      echo "e2e:    ${E2E_LOG_FILE}"
      ;;
    *)
      echo "usage: $0 logs {anvil|aztec|server|e2e|all}"
      exit 2
      ;;
  esac
}

start_stack() {
  start_anvil
  start_aztec
  start_server
  echo "stack start requested"
  show_status
}

start_all() {
  ensure_single_e2e
  start_stack
  start_e2e "$@"
}

up_all() {
  reset_cache
  start_anvil
  start_aztec
  run_contracts_start
  start_server
  start_e2e_fast "$@"
  echo "full test environment started"
  show_status
}

stop_stack() {
  stop_e2e || true
  stop_by_pidfile "server" "${SERVER_PID_FILE}"
  stop_by_pidfile "aztec" "${AZTEC_PID_FILE}"
  stop_by_pidfile "anvil" "${ANVIL_PID_FILE}"

  # Fallback for non-managed processes on the same ports.
  lsof -tiTCP:3001 -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
  lsof -tiTCP:8080 -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
  lsof -tiTCP:8545 -sTCP:LISTEN | xargs -r kill >/dev/null 2>&1 || true
}

case "${ACTION}" in
  reset-cache) reset_cache ;;
  start) start_stack ;;
  start-all) start_all "$@" ;;
  up) up_all "$@" ;;
  e2e-start) start_e2e "$@" ;;
  e2e-start-fast) start_e2e_fast "$@" ;;
  e2e-stop) stop_e2e ;;
  e2e-status) status_e2e ;;
  e2e-logs) logs_e2e ;;
  stop) stop_stack ;;
  status) show_status ;;
  logs) show_logs "${1:-all}" ;;
  *)
    cat <<'USAGE'
usage: test-env.sh {reset-cache|start|start-all|up|stop|status|logs [anvil|aztec|server|e2e|all]}
  reset-cache  stop managed services and clear local test cache
  start        start anvil + aztec + server
  start-all    start anvil + aztec + server + server e2e runner
  up           one command: reset-cache + anvil + aztec + contracts start + server + fast e2e
  e2e-start    start indexer e2e process (defaults to --interval-sec 0)
  e2e-start-fast  start high-throughput indexer e2e (faster event production, no full reset)
  e2e-stop     stop indexer e2e process
  e2e-status   show indexer e2e process status
  e2e-logs     tail indexer e2e log
  stop         stop e2e + server + aztec + anvil
  status       show port listeners and /health
  logs         tail a specific log file
USAGE
    exit 2
    ;;
esac
