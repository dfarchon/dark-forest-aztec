# DFPunk Indexer Server

This service indexes DFPunk Aztec public storage updates block-by-block, keeps an in-memory typed snapshot, persists it to SQLite, and exposes read APIs for clients.

## Goals

- Keep a consistent, queryable game state mirror from Aztec public events.
- Recover quickly after restart from local SQLite snapshot.
- Serve large snapshot payloads efficiently (`gzip`/`brotli` cached).
- Support v2 chunked snapshot APIs for staged client upgrades.
- Run locally and in container environments (e.g. Railway + volume).

## High-Level Architecture

```text
Aztec Node (public events)
  -> AztecNodeSource (decode events)
  -> IndexerService (typed Maps + sync lifecycle)
  -> SnapshotCache (JSON mirror + cached gzip)
  -> HTTP API (/snapshot, /snapshot/manifest, /snapshot/chunks/*, /blocks/latest, /health)
                     \
                      -> SnapshotStore (SQLite WAL persistence)
```

## Directory Layout

```text
server/
  src/
    index.ts                    # bootstrap + wiring
    api.ts                      # Hono routes
    config.ts                   # env parsing and startup validation
    persistence.ts              # SQLite store + restore helpers
    snapshotCache.ts            # incremental JSON + gzip cache
packages/
  indexer-server-core/
    src/                        # server-consumed indexer core extracted from server/src/indexer
      IndexerService.ts
      AztecNodeSource.ts
      convert.ts, debounce.ts, types.ts, TableTypes/
```

## Data Model

The indexer tracks these logical tables:

- `world`
- `player`
- `planet`
- `planet_revealed_coords`
- `planet_events`
- `planet_artifacts`
- `arrival`
- `artifact`
- `artifact_location`

In-memory storage is `Map<TableId, TableState>` per table, plus `lastProcessedBlock`.

## Startup Sequence

`src/index.ts` performs this flow:

1. Initialize `SnapshotStore` (SQLite, WAL mode).
2. Parse runtime config (`AZTEC_NODE_URL`, `INDEXER_START_BLOCK`, etc.).
3. Create `IndexerService` with `AztecNodeSource`.
4. Try restore snapshot from SQLite (`jsonToSnapshot` + `applySnapshot`).
5. Sync from restored block (or `INDEXER_START_BLOCK` / `START_BLOCK`) to latest chain block.
6. Build full `SnapshotCache`.
7. Subscribe to indexer updates:
   - apply incremental cache update
   - persist JSON snapshot with interval throttling
8. Start polling for new blocks.
9. Start HTTP server (TLS is expected to terminate at the edge/reverse proxy in production).
10. On shutdown (`SIGINT` / `SIGTERM`), force-save snapshot and close DB.

## Indexing and Sync Design

This server uses **IndexerService** from `packages/indexer-server-core/src`. Server-only usage:

- **Lifecycle**: `applySnapshot`, `start()`, `subscribe(cb)`, `startPolling()`, `destroy()`.
- **API surface**: `getProcessedBlockNumber()`, `getStatus()` for HTTP routes; `getTable()` (and `getProcessedBlockNumber()`) for `SnapshotCache`.
- **New-block detection**: periodic polling of `getLatestBlockNumber()` every `pollIntervalMs`; no WebSocket. When already caught up (`lastProcessedBlock === latest`), no `getBlockUpdates` calls.

### Source adapter

`AztecNodeSource` (server-side) calls the Aztec node `getPublicEvents` with contract metadata from `@dfpunk/contracts/artifacts/*`, returning `{ fromBlock, toBlock, updates[] }` per requested block range.

## Snapshot and Persistence

### SnapshotCache

- Maintains a JSON-serializable mirror of all tables.
- Supports incremental updates using changed IDs only.
- Caches serialized JSON string.
- Caches `gzip` buffer for `/snapshot` response.

### SnapshotStore

- Uses `better-sqlite3` with `journal_mode = WAL`.
- Single-row table `snapshots(id=1)`:
  - `block_number`
  - `data` (JSON string)
  - `updated_at`
- Throttled save interval (`PERSIST_MIN_INTERVAL_SEC`).
- Force-save on shutdown.
- Admin backup uses SQLite backup API instead of reading the live `.db` file directly.

## HTTP API

### `GET /snapshot`

- Returns full snapshot as pre-gzipped JSON.
- Headers:
  - `Content-Type: application/json`
  - `Content-Encoding: gzip`
  - `X-Snapshot-Block: <number>`
  - `X-Snapshot-Uncompressed-Length: <number>`
  - `Cache-Control: no-cache`

### `GET /snapshot/manifest`

- Returns chunk metadata for v2 clients.
- Query:
  - `chunkRows` (optional, default `1000`, max `20000`)
- Response:
  - `version: 2`
  - `lastProcessedBlock`
  - `chunkRows`
  - `tables[tableName] = { rowCount, chunkCount }`

### `GET /snapshot/chunks/:table/:chunkIndex`

- Returns one compressed chunk for the selected table.
- Query:
  - `chunkRows` (optional, same rules as manifest)
- Headers:
  - `X-Snapshot-Chunk-Count`
  - `X-Snapshot-Chunk-Index`
  - `X-Snapshot-Chunk-Rows`
  - `X-Snapshot-Block`
  - `X-Snapshot-Uncompressed-Length`
- Notes:
  - v1 `/snapshot` remains unchanged for backward compatibility.

### `GET /blocks/latest`

- Returns:
  - `blockNumber`
  - `snapshotBlock`
  - `snapshotBytes`
  - `snapshotEncoding`

### `GET /health`

- Returns:
  - `status`
  - `lifecycle`
  - `lastProcessedBlock`
  - `latestKnownBlock`
  - `isSyncing`

### `GET /admin/backup`

- Bearer token protected (`Authorization: Bearer <ADMIN_TOKEN>`).
- Disabled when `ADMIN_TOKEN` is empty.
- Returns SQLite DB file as attachment.

## Configuration

Environment variable references:

- `.env.example` — generic reference with all supported keys
- `env.local.example` — recommended local devnet preset
- `env.railway.example` — recommended Railway preset

Key variables:

- `AZTEC_NODE_URL` (runtime default: `https://v4-devnet-2.aztec-labs.com`; set `http://localhost:8080` for local sandbox)
- `CORS_ORIGINS` (comma-separated; runtime default: `http://localhost:5173,http://127.0.0.1:5173,https://df-aztec.netlify.app`)
- `INDEXER_START_BLOCK` (optional; defaults to `START_BLOCK` from `@dfpunk/contracts`)
- `PORT` (default: `3001`)
- `SQLITE_PATH` (default: `./data/indexer.db`)
- `SNAPSHOT_SCHEMA_VERSION` (default: `1`; mismatch resets persisted snapshot)
- `PERSIST_MIN_INTERVAL_SEC` (default: `10`)
- `ADMIN_TOKEN` (default: empty, backup endpoint disabled)

IndexerService options (hardcoded in `src/index.ts`; move to env if needed):

- `maxBlocksPerRequest`: 100 — max blocks per `getBlockUpdates` call when catching up.
- `pollIntervalMs`: 2000 — interval for polling latest block number.
- `debounceMs`: 1000 — debounce before processing new blocks after a poll.

## Local Run

```bash
corepack pnpm install

# Devnet + local API (:3001)
corepack pnpm --filter server dev

# Local sandbox override
AZTEC_NODE_URL=http://localhost:8080 \
corepack pnpm --filter server dev
```

## Local URLs (Default)

- Frontend: `http://127.0.0.1:5173`
- Indexer server: `http://localhost:3001`
- Aztec node: `https://v4-devnet-2.aztec-labs.com`

Common local API checks:

- `http://localhost:3001/health`
- `http://localhost:3001/blocks/latest`
- `http://localhost:3001/snapshot`

If you are running the frontend from `https://df-aztec.netlify.app` against a local server, the default CORS list already allows that origin. If the browser still tries stale URLs, clear local overrides in DevTools Console first.

### Local API checks

```bash
curl -fsS http://localhost:3001/health && echo
curl -fsS http://localhost:3001/blocks/latest && echo
curl -fsSI http://localhost:3001/snapshot
```

Admin backup check (only when `ADMIN_TOKEN` is set):

```bash
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/admin/backup \
  -o /tmp/indexer-backup.db
```

## Client Run (Latest)

Client connection config now resolves in this priority:

1. User override in `localStorage` (set from the in-app connection settings UI)
2. Environment variables (`VITE_*`)
3. Built-in defaults

Environment variables used by client:

- `VITE_AZTEC_NODE_URL` (default fallback: `http://localhost:8080`)
- `VITE_INDEXER_BOOTSTRAP_URL` (optional; when unset, client syncs from chain `START_BLOCK`)
- `VITE_APP_MODE` (`production` | `development`, optional)

Start client (local dev):

```bash
corepack pnpm --filter client dev --host 127.0.0.1 --port 5173
```

Start client with explicit node/indexer URLs:

```bash
VITE_AZTEC_NODE_URL=http://localhost:8080 \
VITE_INDEXER_BOOTSTRAP_URL=http://localhost:3001 \
corepack pnpm --filter client dev --host 127.0.0.1 --port 5173
```

If env changes do not appear, clear local overrides first (because localStorage has higher priority):

```js
localStorage.removeItem("dfpunk:connection:nodeUrl");
localStorage.removeItem("dfpunk:connection:indexerBootstrapUrl");
```

## Local E2E Test Stack (One-Command)

Use the server-side helper script to avoid manual coordination each time:

```bash
# Stop services and clear local test cache (PXE store, test accounts, sqlite)
pnpm --filter server run e2e:reset

# Start anvil + aztec sandbox + server
pnpm --filter server run e2e:runtime

# Start full stack + continuous server e2e runner
pnpm --filter server run e2e:up

# Inspect status and health
pnpm --filter server run e2e:status

# Tail logs
pnpm --filter server run e2e:logs

# Stop everything managed by this helper
pnpm --filter server run e2e:down
```

Notes:

- Run only one continuous e2e runner at a time in the same repo/chain.
- `e2e:reset` deletes:
  - `contracts/.store`
  - `contracts/wallet_data_*`
  - `contracts/scripts/.test-accounts.json`
  - `server/data/indexer.db`

## Docker Run

```bash
docker build -t dfpunk-indexer-server -f server/Dockerfile .
docker run --rm -p 3001:3001 -v $(pwd)/server/data:/data \
  -e AZTEC_NODE_URL=https://v4-devnet-2.aztec-labs.com \
  -e CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://df-aztec.netlify.app \
  -e ADMIN_TOKEN=change-me \
  dfpunk-indexer-server
```

For local sandbox instead of devnet, override:

```bash
docker run --rm -p 3001:3001 -v $(pwd)/server/data:/data \
  -e AZTEC_NODE_URL=http://host.docker.internal:8080 \
  -e CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://df-aztec.netlify.app \
  dfpunk-indexer-server
```

## Railway

**Devnet deployment:** https://server-production-b4e5.up.railway.app

Recommended Railway settings for the current server:

- Build from the repo root with `server/Dockerfile` as the Dockerfile path
- Mount a persistent volume at `/data`
- Set `SQLITE_PATH=/data/indexer.db`
- Set `AZTEC_NODE_URL=https://v4-devnet-2.aztec-labs.com`
- Set `CORS_ORIGINS=https://df-aztec.netlify.app`
- Prefer leaving `PORT` unset on Railway and let the platform inject it; keep `3001` only as the local/container default

Detailed setup, verification steps, and known deploy traps are documented in [`server/docs/railway-deploy.md`](/Users/pabloli/Documents/dfpunk-aztec/server/docs/railway-deploy.md).

The Docker image must include `server`, `packages/contracts`, and `packages/indexer-server-core`; the current Dockerfile now copies all three runtime paths.
Because the Docker build context is the monorepo root, the ignore file for deployment uploads lives at repo root: [`.dockerignore`](/Users/pabloli/Documents/dfpunk-aztec/.dockerignore).

## Monorepo Notes

- `server` is a workspace package and participates in recursive commands (`pnpm -r`).
- The service depends on `@dfpunk/contracts` via `workspace:*`.
- `better-sqlite3` is native; build tooling must be available for the target runtime.

## Failure and Recovery

- If event decode fails for a block range, startup or polling cycle fails fast and logs the error.
- On restart, the server restores the last persisted snapshot and catches up from there.
- If persisted JSON is corrupted, restore is skipped and a fresh sync is performed.

## Current Limitations

- No auth/rate-limit on public read endpoints.
- Backup endpoint uses query token and should be treated as admin-only.
- No pruning/versioning for historical snapshots (only latest state).
- No explicit metrics endpoint yet.
