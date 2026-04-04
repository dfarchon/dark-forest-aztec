# Railway Deploy Guide

Deploy the indexer server to Railway: sync from Aztec testnet, persist SQLite on a mounted volume, serve snapshot APIs with CORS for the Netlify frontend.

For architecture, HTTP API, configuration defaults, and local development, see [server README](../README.md).

## Service Setup

Create an **Empty Service** in Railway. Two deployment sources are supported:

| Source | When to use |
| --- | --- |
| GHCR image (`ghcr.io/<user>/dfpunk-aztec-server:<tag>`) | Steady-state deploys |
| Local source upload + `server/Dockerfile` | First-time setup or debugging |

Service shape: builder `DOCKERFILE`, Dockerfile path `server/Dockerfile`, build context repo root, volume mount `/data`.

## Environment Variables

```bash
AZTEC_NODE_URL=https://rpc.testnet.aztec-labs.com
CORS_ORIGINS=https://dfpunk-aztec.netlify.app,https://df-aztec.netlify.app,https://dfpunk-aztec-testnet.netlify.app
SQLITE_PATH=/data/indexer.db
SNAPSHOT_SCHEMA_VERSION=1
PERSIST_MIN_INTERVAL_SEC=10
# ADMIN_TOKEN=<set only if you need /admin/backup>
```

Do **not** set `PORT` — Railway injects it at runtime. See `server/.env.example`, `env.railway.example` for full reference.

## Deploy Flow

### Option A: Publish Image to GHCR

```bash
# Day-to-day publish
pnpm --filter server run docker:publish:testnet
# Equivalent:
bash server/scripts/publish-devnet-image.sh
```

This builds `linux/amd64` via `docker buildx` and pushes to GHCR.

One-time GHCR login:

```bash
echo "$(gh auth token)" | docker login ghcr.io -u <github-user> --password-stdin
```

If Railway caches a stale mutable tag, publish a fresh immutable tag:

```bash
IMAGE_REPO=ghcr.io/<user>/dfpunk-aztec-server \
IMAGE_TAG=devnet-YYYYMMDD-HHMM \
pnpm --filter server run docker:publish
```

### Option B: Local Source Upload

```bash
railway login && railway link && railway up
```

## Post-Deploy Checks

Replace `<url>` with the Railway public domain:

```bash
curl -fsS https://<url>/health && echo
curl -fsS https://<url>/blocks/latest && echo
curl -fsSI https://<url>/snapshot
```

Healthy expectations:

- `/health` → `status: "ok"`, `lifecycle: "live"` after catch-up, `lastProcessedBlock` ≈ `latestKnownBlock`
- `/blocks/latest` → non-zero `snapshotBytes`

## Release Checklist

### Client Compatibility

- [ ] `CORS_ORIGINS` (Railway env + `server/src/config.ts` `DEFAULT_CORS_ORIGINS`) includes production frontend domain
- [ ] Snapshot response includes CORS header for frontend origin
- [ ] Exposed headers present: `X-Snapshot-Uncompressed-Length`, `X-Snapshot-Block`
- [ ] `VITE_INDEXER_BOOTSTRAP_URL` target is reachable and returns `/snapshot`
- [ ] Client not pinned to stale `localStorage` overrides (`dfpunk:connection:*`)

### Contract Updates

- [ ] Contract artifacts regenerated (`contracts/scripts/deploy/sync-env-and-artifacts.ts`)
- [ ] `@dfpunk/contracts` exports consistent (`CORE_CONTRACT_ADDRESS`, `START_BLOCK`, etc.)
- [ ] `INDEXER_START_BLOCK` matches if overriding default
- [ ] If state shape changed: bump `SNAPSHOT_SCHEMA_VERSION` (resets persisted snapshot)
- [ ] No event decode errors in startup/live logs

### Rollback Triggers

Roll back immediately if: browser CORS failure on `/snapshot`, indexer stuck in `syncing` with growing lag, snapshot returns invalid JSON or missing headers, contract event decode errors.

## Known Failure Modes

**`better-sqlite3` build failure on slim images** — Dockerfile already includes `python3`, `make`, `g++`.

**Wrong architecture from mutable tag** — Apple Silicon defaults to `arm64`; publish flow forces `linux/amd64`. If Railway serves a cached old image, publish a fresh immutable tag.

**Service never becomes healthy** — Server opens HTTP before catch-up completes, so health checks pass during sync. If health still fails, check Railway logs for startup exceptions.

**CORS blocks frontend** — Verify `CORS_ORIGINS` includes the real frontend origin and the browser isn't pointing to `localhost:3001`.

**Clean-clone image build fails** — `AztecNodeSource.ts` imports generated contract artifacts (`contracts/src/artifacts/*.ts`) which are `.gitignore`d. Run `pnpm --filter server run prepare:contracts` before building.

## Notes

- Railway `image auto updates` only redeploys when the tag changes upstream — it does not build/push for you.
- Docker build context is the monorepo root; upload filtering is controlled by root `.dockerignore`, not `server/.dockerignore`.
