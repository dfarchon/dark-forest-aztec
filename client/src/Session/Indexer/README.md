# Indexer

Block-by-block sync of chain table state with debounce. Optional init from an off-chain indexer (bootstrap to block X); blocks after X are always maintained by the frontend from the chain. Query API for tx inputs.

## Architecture

The indexer has two layers:

- **IndexerService** (low-level): manages raw table state, block-by-block sync, lifecycle, and subscriber notifications. Deals in chain types (`PlanetState`, `PlayerState`, etc.).
- **IndexerConnection** (high-level adapter): wraps IndexerService to provide an interface that mirrors `EthConnection` from darkforest-v0.6. Provides domain-level event subscription, read API, and `blockNumber$` stream.

```
Game Layer (ContractsAPI / InitialGameStateDownloader)
    │
    ▼
IndexerConnection          ← mirrors EthConnection interface
    │
    ▼
IndexerService             ← table-level state, block sync, lifecycle
    │
    ├── AztecNodeSource    ← reads public logs from Aztec node
    └── OffChainSource     ← bootstrap snapshot from off-chain indexer API
```

### EthConnection parity

| EthConnection                        | IndexerConnection                            |
| ------------------------------------ | -------------------------------------------- |
| `constructor(provider, blockNumber)` | `constructor(indexer)`                       |
| `createEthConnection(rpcUrl)`        | `createIndexerConnection(config)`            |
| `blockNumber` / `blockNumber$`       | `blockNumber` / `blockNumber$`               |
| `getCurrentBlockNumber()`            | `getCurrentBlockNumber()`                    |
| `subscribeToContractEvents(...)`     | `subscribeToContractEvents(handlers)`        |
| `onNewBlock(...)` (private)          | `onNewBlock(payload)` (private)              |
| `processEvents(...)` (private)       | `processEvents(payload, handlers)` (private) |
| `destroy()`                          | `destroy()`                                  |
| _N/A_ (reads via contract calls)     | `getPlayers()`, `getPlanet(id)`, etc.        |

## Atomicity guarantee

When reading directly from the chain (v0.6 pattern), the flow is:

1. Read all state at block B (via contract getters)
2. Initialize game from that snapshot
3. Subscribe to events from block B+1

The indexer provides an equivalent guarantee:

1. `createIndexerConnection(config)` / `connection.initialize()` syncs to block B before returning
2. Returns `{ syncedToBlock: B }` — the snapshot is atomically consistent at B
3. Subscriber notifications (via `subscribeToContractEvents`) only fire for blocks after B

This is enforced by the IndexerService lifecycle:

- **idle** → **bootstrapping** (loading off-chain snapshot) → **syncing** (catching up to latest block) → **live** (real-time)
- `notifyListeners()` is gated: it only dispatches callbacks in the **live** phase
- `start()` awaits full catch-up before transitioning to **live** and starting the poll timer

JavaScript's single-threaded execution ensures the in-memory snapshot is consistent between `processNewBlocks()` calls. For the off-chain bootstrap, the `/snapshot` endpoint must return a consistent snapshot (server responsibility).

## Data flow

- **With off-chain service**: At start, load a snapshot from `bootstrapSource` (e.g. off-chain API) so state is synced up to block X. From block X+1 onward, only `source` (chain) is used: the frontend fetches `getLatestBlockNumber()` and `getBlockUpdates()` from the chain and maintains state itself.
- **Without off-chain service**: Omit `bootstrapSource`. Use `source` (chain) and `startBlock` (e.g. contract deployment block); the frontend processes all blocks from startBlock to latest from the chain.

## Types and overflow

- **u128** (chain): kept as **string** in client types (e.g. `population_cap`, `score`, `pop_arriving`). Never use `number` for u128 to avoid overflow. Use `toBigInt(str)` when you need bigint for contract calls.
- **u8/u32/u64**: converted with **toSafeNum**; throws if value exceeds `Number.MAX_SAFE_INTEGER` so sync fails fast instead of silently corrupting.
- Table row types are exported as **TableRowType** (e.g. `TableRowType['planet']` = `PlanetState`) so query results match the table structure for function inputs.

## Usage

### IndexerConnection (recommended)

The high-level adapter that mirrors `EthConnection`:

```ts
import {
  createIndexerConnection,
  type IndexerConnectionConfig,
} from "./Session/Indexer";

const config: IndexerConnectionConfig = {
  nodeUrl: "http://localhost:8080",
  startBlock: 1,
  debounceMs: 1000,
  pollIntervalMs: 2000,
  maxBlocksPerRequest: 100,
  // bootstrapUrl: "https://indexer.example.com",  // optional
};

const { connection, syncedToBlock } = await createIndexerConnection(config);
// syncedToBlock is the atomicity boundary: snapshot is consistent at this block.
// All events from subscribeToContractEvents will be for blocks > syncedToBlock.
```

#### Event subscription (mirrors EthConnection.subscribeToContractEvents)

```ts
const unsub = connection.subscribeToContractEvents({
  WorldUpdate: (worldState: WorldState) => {
    console.log("World changed:", worldState);
  },
  PlayerUpdate: (playerId: string) => {
    console.log("Player changed:", playerId);
  },
  PlanetUpdate: (planetId: string) => {
    console.log("Planet changed:", planetId);
  },
  PlanetRevealedCoordsUpdate: (locationId: string, revealer: string) => {
    console.log("Location revealed:", locationId, "by", revealer);
  },
  PlanetEventsUpdate: (planetId: string) => {
    console.log("Planet events changed:", planetId);
  },
  PlanetArtifactsUpdate: (planetId: string) => {
    console.log("Planet artifacts changed:", planetId);
  },
  ArrivalUpdate: (arrivalId: string, from: string, to: string) => {
    console.log("Arrival:", arrivalId, from, "→", to);
  },
  ArtifactUpdate: (artifactId: string) => {
    console.log("Artifact changed:", artifactId);
  },
  ArtifactLocationUpdate: (artifactId: string) => {
    console.log("Artifact location changed:", artifactId);
  },
});

// Later:
unsub();
```

Handler names match Aztec storage contract event names 1:1:

| Table                    | Handler (contract event)                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `world`                  | `WorldUpdate(worldState)` — WorldStorage.WorldUpdate                                                        |
| `player`                 | `PlayerUpdate(playerId)` — PlayerStorage.PlayerUpdate                                                       |
| `planet`                 | `PlanetUpdate(planetId)` — PlanetStorage.PlanetUpdate                                                       |
| `planet_revealed_coords` | `PlanetRevealedCoordsUpdate(locationId, revealer)` — PlanetRevealedCoordsStorage.PlanetRevealedCoordsUpdate |
| `planet_events`          | `PlanetEventsUpdate(planetId)` — PlanetEventsStorage.PlanetEventsUpdate                                     |
| `planet_artifacts`       | `PlanetArtifactsUpdate(planetId)` — PlanetArtifactsStorage.PlanetArtifactsUpdate                            |
| `arrival`                | `ArrivalUpdate(id, fromPlanet, toPlanet)` — ArrivalStorage.ArrivalUpdate                                    |
| `artifact`               | `ArtifactUpdate(artifactId)` — ArtifactStorage.ArtifactUpdate                                               |
| `artifact_location`      | `ArtifactLocationUpdate(artifactId)` — ArtifactLocationStorage.ArtifactLocationUpdate                       |

#### Block stream (mirrors EthConnection.blockNumber$)

```ts
const sub = connection.blockNumber$.subscribe((blockNum) => {
  console.log("New block:", blockNum);
});

// Later:
sub.unsubscribe();
```

#### Read API (replaces ContractsAPI getters)

All reads are synchronous from the in-memory snapshot:

```ts
const radius = connection.getWorldRadius();
const paused = connection.getIsPaused();
const players = connection.getPlayers(); // Map<string, PlayerState>
const planet = connection.getPlanet(locationId); // PlanetState | undefined
const arrivals = connection.getArrivalsForPlanet(planetId); // pending arrivals via planet_events
const artifact = connection.getArtifact(artifactId);
const block = connection.getCurrentBlockNumber();
```

#### Cleanup

```ts
connection.destroy();
```

### IndexerService (low-level)

For advanced use cases or when you need direct table access:

#### With off-chain indexer (bootstrap only)

```ts
const indexer = new IndexerService({
  bootstrapSource: new OffChainBlockSource({
    baseUrl: "https://indexer.example.com",
  }),
  source: myChainSource,
  debounceMs: 1000,
  pollIntervalMs: 2000,
});
const { syncedToBlock } = await indexer.start();
```

#### Chain source (Aztec node)

```ts
import { IndexerService, createAztecNodeBlockSource } from "./Indexer";

const source = createAztecNodeBlockSource(
  process.env.AZTEC_NODE_URL ?? "http://localhost:8080"
);

const indexer = new IndexerService({
  source,
  startBlock: 1,
  maxBlocksPerRequest: 100,
});
const { syncedToBlock } = await indexer.start();
```

#### Without off-chain indexer (startBlock)

```ts
const indexer = new IndexerService({
  source: myChainSource,
  startBlock: 12345,
  debounceMs: 1000,
  pollIntervalMs: 2000,
});
const { syncedToBlock } = await indexer.start();
```

### Chunking when syncing from chain

When using a chain `source` (e.g. Aztec node), the service never requests the full block range in one call. It uses **maxBlocksPerRequest** (default 100): each `getBlockUpdates(from, to)` has at most that many blocks. Set it to match your node/RPC limits (e.g. 50–200).

### Query and table structure (for function inputs)

```ts
const world = indexer.getWorld(); // WorldState | undefined
const planet = indexer.getPlanet(locationId); // PlanetState | undefined
const row = indexer.getTable("planet", id); // TableRowType["planet"] | undefined
const lastBlock = indexer.getProcessedBlockNumber();
const status = indexer.getStatus(); // includes lifecycle field
const lifecycle = indexer.getLifecycle(); // "idle" | "bootstrapping" | "syncing" | "live" | "destroyed"
// u128 fields are string; use BigInt(planet.population) if contract expects bigint
```

## Query API

- `getStatus()` – `lastProcessedBlock`, `latestKnownBlock`, `isSyncing`, `lifecycle`
- `getLifecycle()` – current lifecycle phase
- `isLive()` – whether initial sync is complete and processing real-time blocks
- `getProcessedBlockNumber()` – use for tx inputs (e.g. `next_change_block`)
- `getWorld()`, `getPlanet(id)`, `getPlayer(id)`, `getArrival(id)`, etc.
- `getTable(tableName, id?)` – typed by table name (`TableRowType[K]`)
- `subscribe(listener)` – called when state changes (only in "live" phase); listener receives `IndexerChangePayload` with `tables`, `fromBlock`, `toBlock`, and optionally `updatedIdsByTable`. Use `updatedIdsByTable` to do **incremental updates**: only re-read and merge the listed row ids per table instead of re-reading the whole table.
