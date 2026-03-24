#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export IMAGE_REPO="${IMAGE_REPO:-ghcr.io/0xpabloli/dfpunk-aztec-server}"
export IMAGE_TAG="${IMAGE_TAG:-testnet}"
export IMAGE_PUSH="${IMAGE_PUSH:-1}"

bash "$ROOT/server/scripts/build-server-image.sh"
