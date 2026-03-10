#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_REPO="${IMAGE_REPO:-dfpunk-indexer-server}"
IMAGE_TAG="${IMAGE_TAG:-dev}"
IMAGE_PLATFORMS="${IMAGE_PLATFORMS:-linux/amd64}"
IMAGE_PUSH="${IMAGE_PUSH:-0}"
IMAGE_REF="${IMAGE_REPO}:${IMAGE_TAG}"

node "$ROOT/server/scripts/prepare-contract-artifacts.mjs" --build-if-missing

if [[ "$IMAGE_PUSH" != "1" && "$IMAGE_PLATFORMS" == *,* ]]; then
  printf 'Refusing multi-platform local load for %s; set IMAGE_PUSH=1.\n' "$IMAGE_PLATFORMS" >&2
  exit 1
fi

docker_args=(
  buildx
  build
  --platform
  "$IMAGE_PLATFORMS"
  -t
  "$IMAGE_REF"
  -f
  "$ROOT/server/Dockerfile"
)

if [[ "$IMAGE_PUSH" == "1" ]]; then
  docker_args+=(--push)
else
  docker_args+=(--load)
fi

docker_args+=("$ROOT")

docker "${docker_args[@]}"

if [[ "$IMAGE_PUSH" == "1" ]]; then
  printf 'Published image: %s\n' "$IMAGE_REF"
else
  printf 'Built image: %s\n' "$IMAGE_REF"
fi
