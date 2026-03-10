# Railway Deploy Guide

This document records the Railway setup that was actually verified for the `server` service and the failure modes that mattered during deployment.

## Goal

Deploy the indexer server to Railway so it:

- syncs `devnet`
- persists its SQLite snapshot on a mounted volume
- serves `/health`, `/blocks/latest`, `/snapshot`
- allows the Netlify frontend origin through CORS

## What To Create In Railway

Use an `Empty Service`.

There are now two supported deployment sources:

- `GHCR Docker Image`: preferred once you have a working image publish flow
- local source upload plus `server/Dockerfile`: fallback for debugging or first-time setup

Recommended service shape:

- source: `ghcr.io/<github-user>/dfpunk-aztec-server:<tag>` for steady-state deploys
- builder: `DOCKERFILE`
- Dockerfile path: `server/Dockerfile`
- build context: repo root
- volume mount: `/data`

## Required Environment Variables

Recommended Railway variables:

```bash
AZTEC_NODE_URL=https://v4-devnet-2.aztec-labs.com
CORS_ORIGINS=https://df-aztec.netlify.app
SQLITE_PATH=/data/indexer.db
PERSIST_MIN_INTERVAL_SEC=10
ADMIN_TOKEN=<set only if you need /admin/backup>
```

Do not manually set `PORT` on Railway. Railway injects it at runtime. The code keeps `3001` as the local default only.

Reference presets:

- `server/.env.example`
- `server/env.local.example`
- `server/env.railway.example`

## Deploy Flow

### Option A: Publish Image To GHCR

The normal day-to-day publish command is:

```bash
bash server/scripts/publish-devnet-image.sh
```

What this does:

- prepares contract artifacts if they are missing
- builds `linux/amd64` with `docker buildx`
- pushes the tag to GHCR
- defaults to `ghcr.io/0xpabloli/dfpunk-aztec-server:devnet`

Equivalent package script:

```bash
pnpm --filter server run docker:publish:devnet
```

Optional personal shell alias:

```bash
alias publish-server-devnet='bash ~/Documents/dfpunk-aztec/server/scripts/publish-devnet-image.sh'
```

Then your day-to-day publish command becomes:

```bash
publish-server-devnet
```

One-time GHCR login on a machine:

```bash
echo "$(gh auth token)" | docker login ghcr.io -u 0xPabloLI --password-stdin
```

Important:

- `docker:publish` now defaults to `IMAGE_PLATFORMS=linux/amd64`
- you only need to override `IMAGE_PLATFORMS` if Railway starts running on a different target architecture in the future

Recommended Railway source:

```text
ghcr.io/<github-user>/dfpunk-aztec-server:devnet
```

If Railway appears to cache a bad image for a mutable tag, publish a fresh immutable tag and point Railway at that new tag once:

```bash
IMAGE_REPO=ghcr.io/<github-user>/dfpunk-aztec-server \
IMAGE_TAG=devnet-YYYYMMDD-HHMM \
pnpm --filter server run docker:publish
```

Tag convention used here:

- mutable tag: `devnet`
- immutable tag: `devnet-YYYYMMDD-HHMM`

### Option B: Local Source Upload

From the repo root:

```bash
railway login
railway link
railway up
```

If the service already exists, `railway up` uploads the current local source tree and triggers a new deployment.

## Auto Updates

Railway `image auto updates` only tells Railway to redeploy when the configured image tag changes upstream.

It does not build or push the image for you.

Without CI, you still need to run the publish command locally whenever you want a new server release on Railway.
## Post-Deploy Checks

Replace `<railway-url>` with the generated public domain:

```bash
curl -fsS https://<railway-url>/health && echo
curl -fsS https://<railway-url>/blocks/latest && echo
curl -fsSI https://<railway-url>/snapshot
```

Healthy expectations:

- `/health` returns `status: "ok"`
- `lifecycle` becomes `live` after catch-up
- `lastProcessedBlock` is close to `latestKnownBlock`
- `/blocks/latest` reports a non-zero `snapshotBytes`

## Current Known Caveat

The currently verified Railway deployment succeeded from both:

- local source upload
- GHCR image source with a published amd64 image

But the repo is still not fully self-contained for clean-clone image builds.

Reason:

- `packages/indexer-server-core/src/AztecNodeSource.ts` imports `../../contracts/src/artifacts/*.ts` at runtime
- those generated contract artifact files are currently ignored by the repo-wide `.gitignore` rule `**/artifacts/`

Impact:

- local machines that already have generated `packages/contracts/src/artifacts/*` can publish and deploy successfully
- a clean clone that only has committed files may fail to build the image unless contract artifacts are generated first

This is the remaining deploy reproducibility gap. Fixing it requires touching code or ignore rules outside `server/`.

## Known Failure Modes

### Railway rejects Dockerfile with `VOLUME`

Railway does not allow `VOLUME` instructions in the Dockerfile build path used here. The service must rely on a Railway-mounted volume instead.

### `better-sqlite3` fails to build on slim Node images

The runtime image needs native build tooling during `pnpm install`. `server/Dockerfile` already includes the required `python3`, `make`, and `g++` packages for this reason.

### Railway pulls the wrong architecture from a mutable tag

Apple Silicon local builds will default to `arm64` unless the publish flow forces `linux/amd64`.

The verified fix is:

- publish through `docker buildx`
- force `linux/amd64`
- if Railway still serves an old cached image for the same tag, publish a fresh immutable tag and switch `source.image` once
### Service never becomes healthy during initial sync

The server now opens HTTP before the initial catch-up completes, so Railway health checks can pass while indexing continues in the background. If health still fails, inspect Railway logs for startup exceptions rather than assuming sync lag is the cause.

### CORS blocks frontend bootstrap

If the browser shows CORS errors on `/snapshot`, make sure:

- Railway `CORS_ORIGINS` includes the real frontend origin
- the frontend is not still pointing to `http://localhost:3001`

## Why One Root File Still Matters

This service lives in a monorepo and its Docker build context is the repo root, not `server/`.

That means any upload filtering for Docker builds must be controlled by the root `.dockerignore`, not by `server/.dockerignore`. This is a Docker constraint, not a server design preference.
