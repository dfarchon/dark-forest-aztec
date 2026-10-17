#!/usr/bin/env bash
# aztec/nargo compile prints nothing until it exits. Poll artifact files so
# mprocs shows that the compiler is still working and which output moved last.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

export RAYON_NUM_THREADS="${RAYON_NUM_THREADS:-10}"

package_count="$(
  awk '/^members/{f=1;next} f && /^\]/{exit} f && /"/{c++} END{print c+0}' Nargo.toml
)"

echo "[aztec-compile] ${package_count} workspace packages, RAYON_NUM_THREADS=${RAYON_NUM_THREADS}"
echo "[aztec-compile] nargo stays silent until a package finishes; heartbeat every 20s"

log_file="$(mktemp "${TMPDIR:-/tmp}/df-aztec-compile.XXXXXX")"
cleanup() {
  rm -f "${log_file}"
}
trap cleanup EXIT

# Keep the noisy compiler output out of mprocs while it runs, but retain it so
# a failure reports the actual Nargo/Aztec diagnostic instead of only exit 1.
aztec compile "$@" >"${log_file}" 2>&1 &
pid=$!
started=$(date +%s)

while kill -0 "${pid}" 2>/dev/null; do
  # A fast compiler failure can interrupt sleep with SIGCHLD. Do not let
  # `set -e` exit before we can wait for the child and print its diagnostics.
  sleep 20 || true
  if ! kill -0 "${pid}" 2>/dev/null; then
    break
  fi
  elapsed=$(( $(date +%s) - started ))
  json_count="$(find target -maxdepth 1 -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  latest=""
  for artifact in target/*.json; do
    [[ -e "${artifact}" ]] || continue
    if [[ -z "${latest}" || "${artifact}" -nt "${latest}" ]]; then
      latest="${artifact}"
    fi
  done
  latest="${latest##*/}"
  echo "[aztec-compile] ${elapsed}s still running, json artifacts=${json_count}, latest=${latest:-none}"
done

if ! wait "${pid}"; then
  echo "[aztec-compile] failed; compiler output follows" >&2
  cat "${log_file}" >&2
  exit 1
fi
echo "[aztec-compile] finished in $(( $(date +%s) - started ))s"
