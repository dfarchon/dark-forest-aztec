# Indexer

Block-by-block sync of chain table state with debounce. Optional init from an off-chain indexer (bootstrap to block X); blocks after X are always maintained by the frontend from the chain. Query API for tx inputs.

## Data flow

- **With off-chain service**: At start, load a snapshot from `bootstrapSource` (e.g. off-chain API) so state is synced up to block X. From block X+1 onward, only `source` (chain) is used: the frontend fetches `getLatestBlockNumber()` and `getBlockUpdates()` from the chain and maintains state itself.
- **Without off-chain service**: Omit `bootstrapSource`. Use `source` (chain) and `startBlock` (e.g. contract deployment block); the frontend processes all blocks from startBlock to latest from the chain.

## Types and overflow

- **u128** (chain): kept as **string** in client types (e.g. `population_cap`, `score`, `pop_arriving`). Never use `number` for u128 to avoid overflow. Use `toBigInt(str)` when you need bigint for contract calls.
- **u8/u32/u64**: converted with **toSafeNum**; throws if value exceeds `Number.MAX_SAFE_INTEGER` so sync fails fast instead of silently corrupting.
- Table row types are exported as **TableRowType** (e.g. `TableRowType['planet']` = `PlanetState`) so query results match the table structure for function inputs.

## Usage

### With off-chain indexer (bootstrap only)

1. Run an indexer server that exposes at least:
   - `GET /snapshot?toBlock=N` – full state up to block N (lastProcessedBlock, and per-table state maps).

2. In the client, pass the off-chain API as `bootstrapSource` and the chain as `source`. Only `bootstrapSource.getSnapshot()` is called; blocks after X are fetched from `source` (chain), not from the off-chain API.

```ts
const indexer = new IndexerService({
  bootstrapSource: new OffChainBlockSource({
    baseUrl: "https://indexer.example.com",
  }),
  source: myChainSource, // e.g. AztecNode-based; used for getLatestBlockNumber + getBlockUpdates
  debounceMs: 1000,
  pollIntervalMs: 2000,
});
await indexer.start();
```

The off-chain indexer does **not** need to provide `/updates` or `/blocks/latest` for this flow; blocks after the snapshot are handled by the frontend via `source`.

### Chain source (Aztec node)

An `IBlockEventSource` that reads storage events from the Aztec node is implemented in the client and uses `@dfpunk/contracts` for artifact metadata and default addresses. Use it as `source` (with or without `bootstrapSource`):

```ts
import { IndexerService, createAztecNodeBlockSource } from "./indexer";

// Optional: pass addresses to override defaults from @dfpunk/contracts
const source = createAztecNodeBlockSource(
  process.env.AZTEC_NODE_URL ?? "http://localhost:8080"
  // optional: contractAddresses to override defaults from @dfpunk/contracts
);

const indexer = new IndexerService({
  source,
  startBlock: 1,
  maxBlocksPerRequest: 100,
});
await indexer.start();
```

If you omit `contractAddresses`, addresses from `@dfpunk/contracts` (e.g. `WORLD_STORAGE_CONTRACT_ADDRESS`) are used. Pass a partial map to override or leave out specific storage contracts.

### Without off-chain indexer (startBlock)

Omit `bootstrapSource`. Use a chain `source` and `startBlock` (e.g. contract deployment block):

```ts
const indexer = new IndexerService({
  source: myChainSource,
  startBlock: 12345,
  debounceMs: 1000,
  pollIntervalMs: 2000,
});
await indexer.start();
```

All blocks from 12345 to latest are processed by the frontend from the chain.

### Chunking when syncing from chain

When using a chain `source` (e.g. Aztec node), the service never requests the full block range in one call. It uses **maxBlocksPerRequest** (default 100): each `getBlockUpdates(from, to)` has at most that many blocks. Set it to match your node/RPC limits (e.g. 50–200):

```ts
const indexer = new IndexerService({
  source: myChainSource,
  startBlock: 12345,
  maxBlocksPerRequest: 100, // optional; default 100
});
```

### Query and table structure (for function inputs)

```ts
import { IndexerService, type TableRowType } from "./indexer";

const world = indexer.getWorld(); // WorldState | undefined
const planet = indexer.getPlanet(locationId); // PlanetState | undefined
const row = indexer.getTable("planet", id); // TableRowType["planet"] | undefined
const lastBlock = indexer.getProcessedBlockNumber();
const status = indexer.getStatus();
// u128 fields are string; use BigInt(planet.population) if contract expects bigint
```

## Query API

- `getStatus()` – `lastProcessedBlock`, `latestKnownBlock`, `isSyncing`
- `getProcessedBlockNumber()` – use for tx inputs (e.g. `next_change_block`)
- `getWorld()`, `getPlanet(id)`, `getPlayer(id)`, `getArrival(id)`, etc.
- `getTable(tableName, id?)` – typed by table name (`TableRowType[K]`)
- `subscribe(listener)` – called when state changes; listener receives `IndexerChangePayload` with `tables`, `fromBlock`, `toBlock`, and optionally `updatedIdsByTable`. Use `updatedIdsByTable` to do **incremental updates**: only re-read and merge the listed row ids per table instead of re-reading the whole table (important when a table has many rows, e.g. planets).
