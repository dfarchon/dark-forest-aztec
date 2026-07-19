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
CORS_ORIGINS=https://dark-forest-aztec-testnet-v5.netlify.app,https://dfpunk-aztec.netlify.app,https://dfpunk-aztec-testnet.netlify.app
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

**CORS blocks frontend** — Verify `CORS_ORIGINS` includes the real frontend origin and the browser isn't pointing to `localhost:3001`. The current production frontend is `dark-forest-aztec-testnet-v5.netlify.app`; stale entries like `df-aztec.netlify.app` should be removed.

**Clean-clone image build fails** — `AztecNodeSource.ts` imports generated contract artifacts (`contracts/src/artifacts/*.ts`) which are `.gitignore`d. Run `pnpm --filter server run prepare:contracts` before building.

**`ERR_MODULE_NOT_FOUND` in Docker (extensionless imports)** — The Docker entrypoint uses `node --experimental-transform-types`, which requires explicit `.ts` extensions on relative imports. `tsx`/Vite tolerate extensionless imports but Node does not. All relative imports in `packages/indexer-core/src/**` must end with `.ts`.

**Aztec SDK upgrade breaks contract artifacts** — When `@aztec/*` is upgraded (e.g. 4.x → 5.0.1), old generated artifacts fail at runtime with schema validation errors (missing `function_locations`, `file_map`). Artifacts are `.gitignore`d; regenerate locally via `pnpm --filter contracts run build-contracts` then `pnpm --filter server run prepare:contracts` before building the image.

**RPC unreachable / TLS handshake failures** — `rpc.testnet.aztec-labs.com` is the canonical Aztec testnet RPC (confirmed via Aztec v5.0.1 release). If curl fails with `SSL_ERROR_SYSCALL` and resolves to a `198.18.0.0/15` IP, a local PAC/WPAD proxy (Clash/Surge fake-ip mode) is hijacking the domain. Pin the real IP (`dig @8.8.8.8 rpc.testnet.aztec-labs.com`) or disable the proxy to verify. Railway containers do not go through your local proxy; check Railway logs separately.

**Crash-on-RPC-failure loop** — `src/index.ts` calls `main().catch(() => process.exit(1))`. If `indexer.start()` cannot reach the RPC, the process exits and Railway's `ON_FAILURE` policy restarts it (up to 10 retries). If the RPC outage lasts longer than the retry budget, the service stays down and needs a manual `railway redeploy --yes` once the RPC recovers.

**Healthcheck timeout too short** — Railway's default 30s is insufficient for first-time sync (SQLite restore + block catch-up). Raise `healthcheckTimeout` to 300s via the Railway API.

**Memory exhaustion during sync** — Railway free tier (500 MB RAM / 0.5 vCPU) may OOM on large block ranges. Watch Railway metrics; upgrade the service if `cache.buildFull()` or `getBlockUpdates` spikes past the limit.

## Operational Notes

- **No auto-redeploy on image push**: Railway image-based services do not redeploy when a new image is pushed to GHCR. Run `railway redeploy --yes` after publishing.
- **Service manifest watch patterns**: ensure the manifest's `watchPatterns` references `packages/indexer-core/**` (not the stale `packages/indexer-server-core/**` path from before the rename).
- **Healthcheck endpoint**: `/health` returns `lifecycle: "syncing"` during catch-up and `lifecycle: "live"` once live. Raise the platform healthcheck timeout to 300s for first deploy.
- **Restart policy**: `ON_FAILURE` with max 10 retries. For prolonged RPC outages, manually redeploy after recovery.
- **CORS env vs. code default**: `CORS_ORIGINS` env var wins over `DEFAULT_CORS_ORIGINS` in `server/src/config.ts`. Keep both in sync with the real frontend domain.

## Notes

- Railway `image auto updates` only redeploys when the tag changes upstream — it does not build/push for you.
- Docker build context is the monorepo root; upload filtering is controlled by root `.dockerignore`, not `server/.dockerignore`.
