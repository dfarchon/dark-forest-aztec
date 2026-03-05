# DFPunk Indexer Server

This service indexes DFPunk Aztec public storage updates block-by-block, keeps an in-memory typed snapshot, persists it to SQLite, and exposes read APIs for clients.

## Goals

- Keep a consistent, queryable game state mirror from Aztec public events.
- Recover quickly after restart from local SQLite snapshot.
- Serve large snapshot payloads efficiently (`gzip` cached).
- Run locally and in container environments (e.g. Railway + volume).

## High-Level Architecture

```text
Aztec Node (public events)
  -> AztecNodeSource (decode events)
  -> IndexerService (typed Maps + sync lifecycle)
  -> SnapshotCache (JSON mirror + cached gzip)
  -> HTTP API (/snapshot, /blocks/latest, /health)
                     \
                      -> SnapshotStore (SQLite WAL persistence)
```

## Directory Layout

```text
server/
  src/
    index.ts                    # bootstrap + wiring
    api.ts                      # Hono routes
    persistence.ts              # SQLite store + restore helpers
    snapshotCache.ts            # incremental JSON + gzip cache
    indexer/                    # shared with client; may move to shared pkg
      IndexerService.ts         # sync + lifecycle + subscriptions
      AztecNodeSource.ts        # Aztec node adapter (events -> updates)
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
2. Create `IndexerService` with `AztecNodeSource`.
3. Try restore snapshot from SQLite (`jsonToSnapshot` + `applySnapshot`).
4. Sync from restored block (or `START_BLOCK`) to latest chain block.
5. Build full `SnapshotCache`.
6. Subscribe to indexer updates:
   - apply incremental cache update
   - persist JSON snapshot with interval throttling
7. Start polling for new blocks.
8. Start HTTP server (TLS is expected to terminate at the edge/reverse proxy in production).
9. On shutdown (`SIGINT` / `SIGTERM`), force-save snapshot and close DB.

## Indexing and Sync Design

This server uses **IndexerService** (shared with client; see shared indexer package for sync engine and query API). Server-only usage:

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

## HTTP API

### `GET /snapshot`

- Returns full snapshot as pre-gzipped JSON.
- Headers:
  - `Content-Type: application/json`
  - `Content-Encoding: gzip`
  - `X-Snapshot-Block: <number>`
  - `X-Snapshot-Uncompressed-Length: <number>`
  - `Cache-Control: no-cache`

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

### `GET /admin/backup?token=...`

- Token protected.
- Disabled when `ADMIN_TOKEN` is empty.
- Returns SQLite DB file as attachment.

## Configuration

Environment variables (`.env.example`):

- `AZTEC_NODE_URL` (default: `http://localhost:8080`)
- `PORT` (default: `3001`)
- `SQLITE_PATH` (default: `./data/indexer.db`)
- `PERSIST_MIN_INTERVAL_SEC` (default: `10`)
- `ADMIN_TOKEN` (default: empty, backup endpoint disabled)

IndexerService options (hardcoded in `src/index.ts`; move to env if needed):

- `maxBlocksPerRequest`: 100 — max blocks per `getBlockUpdates` call when catching up.
- `pollIntervalMs`: 2000 — interval for polling latest block number.
- `debounceMs`: 1000 — debounce before processing new blocks after a poll.

## Local Run

```bash
corepack pnpm install
corepack pnpm --filter server dev
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
  -e AZTEC_NODE_URL=http://host.docker.internal:8080 \
  -e ADMIN_TOKEN=change-me \
  dfpunk-indexer-server
```

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
