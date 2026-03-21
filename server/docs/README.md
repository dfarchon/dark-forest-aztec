# Server Docs Entry

This is the single entry point for server documentation.

If you (or an automation) are working on `server/`, start here first.

## Canonical Docs (Read In Order)

1. `server/README.md` - architecture, runtime config, local run, API surface.
2. `server/docs/railway-deploy.md` - Railway deploy flow and production failure modes.
3. `server/docs/README.md` (this file) - release checklist and doc ownership rules.

## Manual Release Checklist (Client + Contract Changes)

Use this checklist before and after deploying server changes that affect the web client or on-chain contracts.

### Client Update Checks

- Confirm frontend origin list in server config includes the production domain.
  - `server/src/config.ts` (`DEFAULT_CORS_ORIGINS`)
  - Runtime env `CORS_ORIGINS` in Railway
- Confirm `VITE_INDEXER_BOOTSTRAP_URL` target is reachable from browser and returns `/snapshot`.
- Confirm snapshot response includes CORS header for the exact frontend origin:
  - `curl -sSI -H 'Origin: https://dfpunk-aztec.netlify.app' https://server-production-b4e5.up.railway.app/snapshot`
  - Must include `access-control-allow-origin: https://dfpunk-aztec.netlify.app`
- Confirm required exposed headers for progress UI:
  - `X-Snapshot-Uncompressed-Length`
  - `X-Snapshot-Block`
- Confirm client is not pinned to stale local overrides:
  - `localStorage["dfpunk:connection:nodeUrl"]`
  - `localStorage["dfpunk:connection:indexerBootstrapUrl"]`

### Contract Update Checks

- Confirm contract artifacts and env are regenerated/synced:
  - `contracts/scripts/deploy/sync-env-and-artifacts.ts`
- Confirm `@dfpunk/contracts` exports are consistent:
  - `CORE_CONTRACT_ADDRESS`, `CONFIG_CONTRACT_ADDRESS`, `START_BLOCK`
- Confirm server runtime env matches deployment:
  - `AZTEC_NODE_URL`
  - `INDEXER_START_BLOCK` (if overriding default)
- Confirm snapshot schema compatibility:
  - If state shape changed incompatibly, bump `SNAPSHOT_SCHEMA_VERSION`.
  - Verify persisted snapshots are intentionally reset on schema bump.
- Confirm indexer decodes new events without conversion errors in startup/live logs.

### Post-Deploy Smoke Checks (Required)

- `curl -fsS https://server-production-b4e5.up.railway.app/health`
- `curl -fsSI https://server-production-b4e5.up.railway.app/snapshot`
- `curl -fsS https://server-production-b4e5.up.railway.app/blocks/latest`
- Verify block lag is acceptable from `/health`.
- Verify production client has no CORS errors and snapshot bootstrap completes.

### Rollback Rules

- Roll back immediately if:
  - Browser CORS failure on `/snapshot`
  - Indexer stuck in `syncing` with growing lag
  - Snapshot endpoint returns invalid JSON or missing required headers
  - Contract event decode errors after deployment

## Doc Cleanup Rules

- Keep only the three canonical docs above as required reading.
- Treat `server/docs/local/*.local.md` as optional local runbooks (not release-gating).
- When a procedure changes, update canonical docs first, then local runbooks if still needed.
