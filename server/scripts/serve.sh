#!/usr/bin/env bash
#
# serve.sh — One-command local frontend setup for dfpunk-aztec
#
# Usage:
#   pnpm --filter server run serve              # generate artifacts + start client dev server
#   pnpm --filter server run serve -- --codegen # only regenerate artifacts (no dev server)
#   pnpm --filter server run serve -- --dev-only # only start dev server (skip codegen)
#
# What it does:
#   1. Run `aztec codegen` to generate TS wrappers from compiled contract JSON
#   2. Copy all artifacts (JSON + TS) to contracts/scripts/artifacts/
#   3. Sync artifacts to packages/contracts/src/artifacts/
#      (preserves packages/contracts/src/index.ts — never overwritten)
#   4. Start the Vite client dev server (pnpm dev)
#
# Prerequisites:
#   - `aztec` CLI installed (~/.aztec/current/…)
#   - `pnpm` installed
#   - Contract JSONs already compiled in contracts/target/
#   - packages/contracts/src/index.ts contains correct devnet addresses
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
TARGET_DIR="$CONTRACTS_DIR/target"
SCRIPTS_ARTIFACTS="$CONTRACTS_DIR/scripts/artifacts"
PKG_ARTIFACTS="$REPO_ROOT/packages/contracts/src/artifacts"
CLIENT_DIR="$REPO_ROOT/client"

# ---------- helpers ----------
info()  { printf "\033[1;34m[serve]\033[0m %s\n" "$*"; }
ok()    { printf "\033[1;32m[serve]\033[0m %s\n" "$*"; }
err()   { printf "\033[1;31m[serve]\033[0m %s\n" "$*" >&2; }

# ---------- parse flags ----------
DO_CODEGEN=true
DO_DEV=true

for arg in "$@"; do
  case "$arg" in
    --codegen)   DO_DEV=false ;;
    --dev-only)  DO_CODEGEN=false ;;
    -h|--help)
      echo "Usage: $0 [--codegen | --dev-only | -h]"
      exit 0
      ;;
  esac
done

# ---------- step 0: prerequisites ----------
info "Checking prerequisites..."

if ! command -v node &>/dev/null; then
  err "Node.js not found. Install v24.12.0 (see .nvmrc): nvm install"
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  err "pnpm not found. Install: corepack enable && corepack prepare pnpm@10.28.0 --activate"
  exit 1
fi

# Ensure dependencies are installed
if [ ! -d "$REPO_ROOT/node_modules" ] || [ ! -d "$CLIENT_DIR/node_modules" ]; then
  info "node_modules missing — running pnpm install..."
  (cd "$REPO_ROOT" && pnpm install)
  ok "Dependencies installed"
else
  info "node_modules found, skipping install"
fi

# ---------- step 1: codegen ----------
if $DO_CODEGEN; then
  # Check prerequisites
  if ! command -v aztec &>/dev/null; then
    err "aztec CLI not found. Install via: bash -i <(curl -s install.aztec.network)"
    exit 1
  fi

  if [ ! -d "$TARGET_DIR" ] || [ -z "$(ls "$TARGET_DIR"/*.json 2>/dev/null)" ]; then
    err "No compiled contract JSON found in $TARGET_DIR"
    err "Run 'cd contracts && aztec compile' first."
    exit 1
  fi

  info "Step 1/3: Running aztec codegen..."
  aztec codegen "$TARGET_DIR" -o "$TARGET_DIR"
  ok "Codegen complete — TS wrappers generated in $TARGET_DIR"

  info "Step 2/3: Copying artifacts to contracts/scripts/artifacts/..."
  mkdir -p "$SCRIPTS_ARTIFACTS"
  cp "$TARGET_DIR"/*.json "$TARGET_DIR"/*.ts "$SCRIPTS_ARTIFACTS"/
  ok "Copied to $SCRIPTS_ARTIFACTS"

  info "Step 3/3: Syncing artifacts to packages/contracts/src/artifacts/..."
  # Remove old artifacts dir and replace with fresh copy
  # NOTE: index.ts lives one level up and is NOT touched
  rm -rf "$PKG_ARTIFACTS"
  cp -r "$SCRIPTS_ARTIFACTS" "$PKG_ARTIFACTS"

  ARTIFACT_COUNT=$(ls "$PKG_ARTIFACTS" | wc -l | tr -d ' ')
  ok "Synced $ARTIFACT_COUNT artifacts to $PKG_ARTIFACTS"
  ok "packages/contracts/src/index.ts was NOT modified (devnet addresses preserved)"
fi

# ---------- step 2: dev server ----------
if $DO_DEV; then
  info "Starting Vite dev server..."
  cd "$CLIENT_DIR"
  exec pnpm dev
fi

ok "Done."
