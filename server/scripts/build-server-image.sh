#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_REPO="${IMAGE_REPO:-dfpunk-indexer-server}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
IMAGE_REF="${IMAGE_REPO}:${IMAGE_TAG}"

node "$ROOT/server/scripts/prepare-contract-artifacts.mjs" --build-if-missing
docker build -t "$IMAGE_REF" -f "$ROOT/server/Dockerfile" "$ROOT"

printf 'Built image: %s\n' "$IMAGE_REF"
