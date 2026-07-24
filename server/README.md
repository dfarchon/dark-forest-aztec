# Dark Forest Aztec Indexer Server

Indexes DFPunk Aztec public storage updates block-by-block, keeps an in-memory typed snapshot, persists to SQLite, and exposes read APIs for clients.

## Architecture

```text
Aztec Node (public events)
  → AztecNodeSource (getBlockUpdates → getPublicEvents)
  → IndexerService (typed Maps + sync lifecycle)
  → SnapshotCache (JSON mirror + cached Brotli/gzip)
  → HTTP API (/snapshot, /snapshot/hash, /snapshot/manifest, /snapshot/chunks/*, /blocks/latest, /health)
                     \
                      → SnapshotStore (SQLite WAL: v1 snapshot row + v2 chunk/manifest tables)
```

### Directory Layout

```text
server/
  src/
    index.ts                    # bootstrap + wiring
    api.ts                      # Hono routes
    config.ts                   # env parsing and startup validation
    contractsConfig.ts          # contract addresses + START_BLOCK validation
    persistence.ts              # SQLite store + restore + v2 chunk persistence
    snapshotCache.ts            # incremental JSON + Brotli/gzip cache
packages/
  indexer-core/
    src/                        # IndexerService, AztecNodeSource, table types
      IndexerService.ts
      AztecNodeSource.ts
      convert.ts, debounce.ts, types.ts, TableTypes/
```

The server depends on `@dfpunk/contracts` and `@dfpunk/indexer-core` (`workspace:*`). Docker builds copy `server/`, `contracts/`, `packages/contracts/`, and `packages/indexer-core/` into the image.

## Data Model

Indexed tables: `world`, `player`, `planet`, `planet_revealed_coords`, `planet_events`, `planet_artifacts`, `arrival`, `artifact`, `artifact_location`.

In-memory storage is `Map<TableId, TableState>` per table, plus `lastProcessedBlock`.

## Startup Sequence

`main()` in `src/index.ts`:

1. Validate contracts config and parse runtime config.
2. Initialize `SnapshotStore` (SQLite, WAL mode).
3. Create `IndexerService` with `createAztecNodeBlockSource(aztecNodeUrl, undefined, aztecNodeUrlBackup)`. When `AZTEC_NODE_URL_BACKUP` is set, a transparent failover proxy wraps the primary and backup RPC clients: on primary failure, calls are automatically retried on backup, with periodic primary recovery probes (60 s cooldown).
4. Create `SnapshotCache` bound to the indexer.
5. Run `runServerRuntime()`:
   - Restore snapshot from SQLite; verify v1 JSON against v2 chunk reconstruction.
   - Start HTTP listener (so `/health` responds while sync runs).
   - `await indexer.start()` — catch up to latest chain block.
   - `cache.buildFull()` from current indexer state.
   - `indexer.subscribe(...)`: incremental cache updates + throttled persistence.
   - `indexer.startPolling()` for new blocks.
6. On shutdown (`SIGINT`/`SIGTERM`), force-save snapshot and close DB.

TLS terminates at the edge or reverse proxy in production.

## Indexing

Uses **IndexerService** from `@dfpunk/indexer-core`:

- **Lifecycle**: `applySnapshot` → `start()` → `subscribe(cb)` → `startPolling()` → `destroy()`.
- **API**: `getProcessedBlockNumber()`, `getStatus()`, `getTable()`.
- **Polling**: checks `getLatestBlockNumber()` every `pollIntervalMs` (2 s); skips `getBlockUpdates` when caught up.

**Source adapter**: `AztecNodeSource` calls Aztec `getPublicEvents` with contract metadata from `@dfpunk/contracts/artifacts/*`.

## Snapshot & Persistence

**SnapshotCache** — JSON-serializable mirror of all tables. Incremental updates via changed IDs. Caches both Brotli and gzip buffers for `/snapshot` and chunk routes.

**SnapshotStore** — `better-sqlite3` with WAL mode:

- **v1**: single-row `snapshots(id=1)` — `block_number`, `data` (JSON), `updated_at`.
- **v2**: `snapshot_chunks` + `snapshot_manifests` for persisted encoded chunks.
- Throttled saves (`PERSIST_MIN_INTERVAL_SEC`); force-save on shutdown.
- Admin backup via SQLite backup API.

## HTTP API

Compression: `Accept-Encoding: br` → Brotli; otherwise gzip. Applies to `/snapshot` and `/snapshot/chunks/*`.

| Endpoint                                             | Response                                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /snapshot`                                      | Full snapshot as pre-compressed JSON. Headers: `Content-Encoding`, `X-Snapshot-Block`, `X-Snapshot-Uncompressed-Length`, `Cache-Control: no-cache`. |
| `GET /snapshot/hash`                                 | `{ hash, lastProcessedBlock }` — SHA-256 hex of canonical snapshot JSON.                                                                            |
| `GET /snapshot/manifest?chunkRows=`                  | v2 chunk metadata: `{ version: 2, lastProcessedBlock, chunkRows, tables }`. Default `chunkRows=1000`, max `20000`.                                  |
| `GET /snapshot/chunks/:table/:chunkIndex?chunkRows=` | One compressed chunk. Headers: `X-Snapshot-Chunk-Count`, `X-Snapshot-Chunk-Index`, `X-Snapshot-Chunk-Rows`, `X-Snapshot-Block`.                     |
| `GET /blocks/latest`                                 | `{ blockNumber, snapshotBlock, snapshotBytes, snapshotEncoding }`                                                                                   |
| `GET /health`                                        | `{ status, lifecycle, lastProcessedBlock, latestKnownBlock, isSyncing, metrics: { blockLag, snapshotBlock, snapshotBytes } }`                       |
| `GET /admin/backup`                                  | SQLite DB file download. Requires `Authorization: Bearer <ADMIN_TOKEN>`. Disabled when token is empty.                                              |

## Configuration

Env file references: `.env.example` (generic), `env.local.example` (local testnet), `env.railway.example` (Railway).

| Variable                   | Default                              | Notes                                                                                                  |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `AZTEC_NODE_URL`           | `https://canonical.testnet.rpc.aztec-labs.com` | Use `http://localhost:8080` for local sandbox                                                          |
| `AZTEC_NODE_URL_BACKUP`    | (empty)                              | Optional backup RPC URL for automatic failover. When set, RPC call failures on primary trigger an immediate switch to backup with retry. Empty = no failover (zero overhead). |
| `CORS_ORIGINS`             | local Vite + Netlify origins         | Comma-separated; `*` = any; empty = disabled                                                           |
| `INDEXER_START_BLOCK`      | `START_BLOCK` from contracts         | Optional override                                                                                      |
| `PORT`                     | `3001`                               | Local default. On Railway (and similar hosts), **omit `PORT`** and use the value the platform injects. |
| `SQLITE_PATH`              | `./data/indexer.db`                  |                                                                                                        |
| `SNAPSHOT_SCHEMA_VERSION`  | `1`                                  | Mismatch resets persisted snapshot                                                                     |
| `PERSIST_MIN_INTERVAL_SEC` | `10`                                 | Throttles SQLite writes during live sync (see below).                                                  |
| `ADMIN_TOKEN`              | (empty)                              | Empty = backup endpoint disabled                                                                       |

IndexerService options (hardcoded in `src/index.ts`): `maxBlocksPerRequest: 100`, `pollIntervalMs: 2000`, `debounceMs: 1000`.

**Timing:** Chosen for **public testnet** (seconds-scale blocks): poll only queries latest block height every 2s; `getBlockUpdates` runs when there is backlog. Debounce (1s) and `PERSIST_MIN_INTERVAL_SEC` cut redundant work. Hardcoded in `src/index.ts` (no env override).

## Package Scripts

Run via `pnpm --filter server <script>`:

| Script                                                                          | Purpose                                                           |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `dev` / `start`                                                                 | Run server (`tsx src/index.ts`); Docker uses `node --experimental-transform-types` |
| `compare:snapshot`                                                              | Compare snapshot JSON to server `/snapshot` and v2 reconstruction |
| `docker:build`                                                                  | Build server image (`scripts/build-server-image.sh`)              |
| `docker:publish`                                                                | Build and push image (`IMAGE_PUSH=1`)                             |
| `docker:publish:testnet`                                                        | Publish devnet/testnet image (`scripts/publish-devnet-image.sh`)  |
| `e2e:up` / `e2e:down` / `e2e:runtime` / `e2e:status` / `e2e:logs` / `e2e:reset` | Local stack + E2E helpers via `scripts/test-env.sh`               |
| `prepare:contracts` / `prepare:contracts:build`                                 | Sync contract artifacts for indexing                              |
| `mock:snapshot`                                                                 | Mock big-snapshot stream server for testing                       |
| `format` / `format:check`                                                       | Prettier formatting                                               |
| `test:build:image` / `test:prepare:contracts`                                   | Node native test runner tests                                     |

Unit tests:

```bash
cd server && node --test --experimental-transform-types src/*.test.ts
```

## Quick Start

```bash
corepack pnpm install

# Testnet (default)
corepack pnpm --filter server dev

# Local sandbox
AZTEC_NODE_URL=http://localhost:8080 corepack pnpm --filter server dev
```

### Local API Checks

```bash
curl -fsS http://localhost:3001/health && echo
curl -fsS http://localhost:3001/blocks/latest && echo
curl -fsS http://localhost:3001/snapshot/hash && echo
curl -fsSI http://localhost:3001/snapshot

# Admin backup (requires ADMIN_TOKEN)
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/admin/backup -o /tmp/indexer-backup.db
```

### Client

Connection config priority: localStorage override → `VITE_*` env → built-in defaults.

| Variable                     | Default                 | Notes                                         |
| ---------------------------- | ----------------------- | --------------------------------------------- |
| `VITE_AZTEC_NODE_URL`        | `http://localhost:8080` |                                               |
| `VITE_INDEXER_BOOTSTRAP_URL` | (empty)                 | See `client/src/config/env.ts` for resolution |
| `VITE_APP_MODE`              | (auto)                  | `production` / `development`                  |

```bash
corepack pnpm --filter client dev --host 127.0.0.1 --port 5173
```

Override via localStorage:

```js
localStorage.setItem(
  "dfpunk:connection:nodeUrl",
  "https://canonical.testnet.rpc.aztec-labs.com",
);
localStorage.setItem(
  "dfpunk:connection:indexerBootstrapUrl",
  "http://localhost:3001",
);
// Clear:
localStorage.removeItem("dfpunk:connection:nodeUrl");
localStorage.removeItem("dfpunk:connection:indexerBootstrapUrl");
```

### Dev Console (DEV builds only)

```js
window.dfDebug.snapshot();
window.dfDebug.snapshotJson();
window.dfDebug.downloadSnapshot();

window.dfDebug.connection.getStatus();
window.dfDebug.connection.getCurrentBlockNumber();
window.dfDebug.connection.getProcessedBlockNumber();
window.dfDebug.connection.getSnapshotAsJsonString();
```

## E2E Test Stack

```bash
pnpm --filter server run e2e:reset    # clear local test cache
pnpm --filter server run e2e:runtime  # start anvil + aztec sandbox + server
pnpm --filter server run e2e:up       # full stack + continuous e2e runner
pnpm --filter server run e2e:status   # inspect status
pnpm --filter server run e2e:logs     # tail logs
pnpm --filter server run e2e:down     # stop everything
```

`e2e:reset` deletes: `contracts/.store`, `contracts/wallet_data_*`, `contracts/scripts/.test-accounts.json`, `server/data/indexer.db`.

## Docker

```bash
docker build -t dfpunk-indexer-server -f server/Dockerfile .
docker run --rm -p 3001:3001 -v $(pwd)/server/data:/data \
  -e AZTEC_NODE_URL=https://canonical.testnet.rpc.aztec-labs.com \
  -e CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://dark-forest-aztec-testnet-v5.netlify.app,https://dfpunk-aztec.netlify.app \
  -e ADMIN_TOKEN=change-me \
  dfpunk-indexer-server
```

For local sandbox: replace `AZTEC_NODE_URL` with `http://host.docker.internal:8080`.

## Railway

Recommended settings:

- **Deploy source**: empty Railway service with builder `DOCKERFILE`, path `server/Dockerfile`, build context repo root; or a prebuilt **GHCR** image (see [docs/railway-deploy.md](./docs/railway-deploy.md)).
- Mount persistent volume at `/data`; set `SQLITE_PATH=/data/indexer.db`
- Set `AZTEC_NODE_URL=https://canonical.testnet.rpc.aztec-labs.com`
- Set `CORS_ORIGINS=https://dark-forest-aztec-testnet-v5.netlify.app,https://dfpunk-aztec.netlify.app,https://dfpunk-aztec-testnet.netlify.app`
- Do **not** set `PORT` yourself—Railway injects it (see Configuration table).

See [docs/railway-deploy.md](./docs/railway-deploy.md) for environment variable reference, publish commands, post-deploy checks, and known deploy traps.

The Docker build context is the monorepo root; deploy ignore rules live in [`.dockerignore`](../.dockerignore).

## Failure & Recovery

- **Automatic RPC failover**: when `AZTEC_NODE_URL_BACKUP` is set, a transparent proxy intercepts all RPC calls. If the primary fails (network error, timeout), the call is retried on the backup and subsequent calls go to the backup until a 60 s cooldown elapses, after which the next call probes the primary again. Failover events are logged with `[FailoverNode]` prefix. When `AZTEC_NODE_URL_BACKUP` is unset, behavior is unchanged.
- **Fast-fail on RPC unreachable**: `main().catch(() => process.exit(1))` — if `indexer.start()` cannot reach `AZTEC_NODE_URL` (and no backup is configured, or both are unreachable), the process exits immediately. Railway's `ON_FAILURE` restart policy (max 10 retries) brings it back automatically; for prolonged outages, run `railway redeploy --yes` once the RPC recovers.
- **Local RPC diagnostics**: if `curl https://canonical.testnet.rpc.aztec-labs.com` fails with `SSL_ERROR_SYSCALL` and resolves to a `198.18.0.0/15` address, a local PAC/WPAD proxy (Clash/Surge fake-ip) is intercepting the domain — not an RPC outage. Pin the real IP via `dig @8.8.8.8` or disable the proxy to verify.
- Event decode failures cause startup/polling to fail fast with logged error.
- On restart, last persisted snapshot is restored and sync catches up from there.
- Corrupted persisted JSON is skipped; fresh sync from `INDEXER_START_BLOCK`.
- **Healthcheck**: Railway default 30s is too short for first-time sync (SQLite restore + catch-up). Raise to 300s via the Railway API.
- **Memory**: 500 MB RAM (Railway free tier) may OOM on large block ranges; monitor and upgrade if sync crashes repeatedly.

## Limitations

- No auth or application-level rate limiting on public read endpoints today. For the expected app + indexer traffic this is usually enough; if snapshot scraping or abuse shows up, add limits at the edge (CDN/proxy) or in the Hono app.
- Backup endpoint is Bearer-protected; keep `ADMIN_TOKEN` secret.
- No pruning/versioning for historical snapshots (latest state only).
- No explicit metrics endpoint.
