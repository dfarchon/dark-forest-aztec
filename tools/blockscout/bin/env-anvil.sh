#!/usr/bin/env bash
# Anvil L1 env for Mix Blockscout + Next frontend. No Docker, no Cargo, no Rust microservices.
set -euo pipefail

export MIX_ENV="${MIX_ENV:-dev}"
export PORT="${BLOCKSCOUT_API_PORT:-4001}"
export CHAIN_ID="${CHAIN_ID:-31337}"
export COIN=ETH
export COIN_NAME=Ether
export ETHEREUM_JSONRPC_VARIANT=anvil
export ETHEREUM_JSONRPC_HTTP_URL="${ETHEREUM_JSONRPC_HTTP_URL:-http://127.0.0.1:8545/}"
export ETHEREUM_JSONRPC_TRACE_URL="${ETHEREUM_JSONRPC_TRACE_URL:-http://127.0.0.1:8545/}"
export ETHEREUM_JSONRPC_WS_URL="${ETHEREUM_JSONRPC_WS_URL:-ws://127.0.0.1:8545/}"
export ETHEREUM_JSONRPC_FALLBACK_WS_URL="${ETHEREUM_JSONRPC_FALLBACK_WS_URL:-$ETHEREUM_JSONRPC_WS_URL}"
export INDEXER_DISABLE_INTERNAL_TRANSACTIONS_FETCHER=true
export INDEXER_DISABLE_PENDING_TRANSACTIONS_FETCHER=true
# Anvil chains are younger than 30 days, so this fetcher only logs and waits a day.
export INDEXER_DISABLE_HOT_SMART_CONTRACTS_FETCHER=true
export API_V2_ENABLED=true
export DISABLE_WEBAPP=true
export DISABLE_MARKET=true
export MARKET_HISTORY_FETCHER_ENABLED=false
export DISABLE_FILE_LOGGING=true
export ECTO_SSL_MODE=disable
export MICROSERVICE_SC_VERIFIER_ENABLED=false
export MICROSERVICE_VISUALIZE_SOL2UML_ENABLED=false
export MICROSERVICE_SIG_PROVIDER_ENABLED=false
export DATABASE_URL="${DATABASE_URL:-postgresql://blockscout:@127.0.0.1:5433/blockscout}"
export ACCOUNT_REDIS_URL="${ACCOUNT_REDIS_URL:-redis://127.0.0.1:6380}"
# No SOCKS/HTTP proxy: leftover hackney 1.x CVEs are SOCKS timeout + encoded-host SSRF.
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
# Remaining Hex flags with no safe umbrella bump (hackney 4.x breaks httpoison ~> 1.x; cowlib 43969 has no Hex release).
export HEX_IGNORE_ADVISORIES="${HEX_IGNORE_ADVISORIES:-CVE-2026-47069,CVE-2026-47071,CVE-2026-47075,CVE-2026-47076,CVE-2026-43966,CVE-2026-43969}"
