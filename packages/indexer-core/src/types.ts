/**
 * Indexer types: table names, snapshot/updates payloads, and data source contract.
 * Aligned with client/src/types (chain.ts) and contract storage events.
 */

import type {
  ArrivalState,
  ArtifactLocationState,
  ArtifactState,
  PlanetArtifactsState,
  PlanetEventsState,
  PlanetRevealedCoordsState,
  PlanetState,
  PlayerState,
  WorldState,
} from "./TableTypes/chain.ts";

/** Which Aztec L2 tip an indexer follows. */
export type BlockTipTag = "proposed" | "checkpointed" | "proven" | "finalized";

/** Schema of the snapshot JSON and v3 publication identity. */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/** Table names matching contract storage and client types. */
export const TABLE_NAMES = [
  "world",
  "player",
  "planet",
  "planet_revealed_coords",
  "planet_events",
  "planet_artifacts",
  "arrival",
  "artifact",
  "artifact_location",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];

/** Public storage event names emitted by the indexed contracts. */
export const PUBLIC_EVENT_NAMES = [
  "WorldUpdate",
  "PlayerUpdate",
  "PlanetUpdate",
  "PlanetRevealedCoordsUpdate",
  "PlanetEventsUpdate",
  "PlanetArtifactsUpdate",
  "ArrivalUpdate",
  "ArtifactUpdate",
  "ArtifactLocationUpdate",
] as const;

export type PublicEventName = (typeof PUBLIC_EVENT_NAMES)[number];

/** Event counts returned for one fetched block range. */
export type PublicEventBatchCounts = Partial<Record<PublicEventName, number>>;

/** Cumulative public event counts for the blocks processed by the indexer. */
export interface PublicEventStats {
  fromBlock: number;
  toBlock: number;
  counts: Record<PublicEventName, number>;
  total: number;
  /** False when an off-chain snapshot skipped part of the event history. */
  complete: boolean;
}

/** Row type per table — use for typed query and function inputs (contract args). */
export type TableRowType = {
  world: WorldState;
  player: PlayerState;
  planet: PlanetState;
  planet_revealed_coords: PlanetRevealedCoordsState;
  planet_events: PlanetEventsState;
  planet_artifacts: PlanetArtifactsState;
  arrival: ArrivalState;
  artifact: ArtifactState;
  artifact_location: ArtifactLocationState;
};

/** Entity id type: world uses "0", others use field/address string. */
export type TableId = string;

/** Per-table state: id -> state. World is singleton with id "0". */
export type TableStateMap<T> = Map<TableId, T>;

/** Inputs that determine whether two indexers index the same history. */
export interface SnapshotIdentity {
  networkId: string;
  startBlock: number;
  tipTag: BlockTipTag;
  schemaVersion: number;
  storageAddresses: Record<string, string>;
}

export function sameSnapshotIdentity(
  a: SnapshotIdentity,
  b: SnapshotIdentity,
): boolean {
  const addresses = (value: SnapshotIdentity) =>
    Object.entries(value.storageAddresses).sort(([x], [y]) =>
      x.localeCompare(y),
    );
  return (
    a.networkId === b.networkId &&
    a.startBlock === b.startBlock &&
    a.tipTag === b.tipTag &&
    a.schemaVersion === b.schemaVersion &&
    JSON.stringify(addresses(a)) === JSON.stringify(addresses(b))
  );
}

/** Full snapshot: all tables + last processed block. */
export interface IndexerSnapshot {
  lastProcessedBlock: number;
  /** Hash of lastProcessedBlock; undefined for legacy snapshots. */
  lastProcessedBlockHash?: string;
  identity?: SnapshotIdentity;
  world: TableStateMap<WorldState>;
  player: TableStateMap<PlayerState>;
  planet: TableStateMap<PlanetState>;
  planet_revealed_coords: TableStateMap<PlanetRevealedCoordsState>;
  planet_events: TableStateMap<PlanetEventsState>;
  planet_artifacts: TableStateMap<PlanetArtifactsState>;
  arrival: TableStateMap<ArrivalState>;
  artifact: TableStateMap<ArtifactState>;
  artifact_location: TableStateMap<ArtifactLocationState>;
}

/** One table update: id and new state (merge into table). */
export interface TableUpdate<T = unknown> {
  table: TableName;
  id: TableId;
  state: T;
}

/** Block range update: apply these to go from fromBlock to toBlock. */
export interface BlockUpdates {
  fromBlock: number;
  /** Actually processed up to; may be < requested toBlock if the node is behind. */
  toBlock: number;
  toBlockHash?: string;
  updates: TableUpdate[];
  /** Raw decoded events in this range, before rows with the same id overwrite. */
  eventCounts?: PublicEventBatchCounts;
}

/** API for fetching block data: used by IndexerService for init and sync. */
export interface IBlockEventSource {
  /** Current chain block number. */
  getLatestBlockNumber(): Promise<number>;

  /**
   * Optional: full snapshot up to (and including) toBlock.
   * If not implemented or toBlock not provided, service starts from empty and uses getBlockUpdates only.
   */
  getSnapshot?(toBlock?: number): Promise<IndexerSnapshot | null>;

  /**
   * Incremental updates for blocks [fromBlock, toBlock] (inclusive).
   * Each update should be applied in order; same id in same table overwrites.
   */
  getBlockUpdates(fromBlock: number, toBlock: number): Promise<BlockUpdates>;

  /** Canonical hash of a block on the source chain, undefined if unknown. */
  getBlockHash?(blockNumber: number): Promise<string | undefined>;
}

/** Lifecycle states for IndexerService. */
export type IndexerLifecycle =
  | "idle"
  | "bootstrapping"
  | "syncing"
  | "ready"
  | "live"
  | "destroyed";

/** Query result: processed block info for tx inputs and UI. */
export interface IndexerStatus {
  lastProcessedBlock: number;
  latestKnownBlock: number;
  isSyncing: boolean;
  lifecycle: IndexerLifecycle;
  /** Consecutive background or initial sync failures since the last success. */
  consecutiveFailures: number;
  /** Message from the most recent sync failure, if any. */
  lastError?: string;
  /** True while a hash mismatch is being repaired by replaying from startBlock. */
  reorgRecovering: boolean;
}

/**
 * Payload passed to subscribe() when state changes.
 * Lets the upper layer know which tables (and which row ids) were updated for incremental state updates.
 */
export interface IndexerChangePayload {
  /** A hash mismatch was detected; consumers should pause derived-state reads. */
  reorgStarted?: boolean;
  /** A completed reorg replay replaced the entire state, including deleted rows. */
  fullRefresh?: boolean;
  /** Tables that had at least one row updated in this batch. */
  tables: readonly TableName[];
  /** Block range that was just applied (inclusive). */
  fromBlock: number;
  toBlock: number;
  /**
   * Per-table list of row ids that were updated. When present, only these ids changed — merge them into your state instead of re-reading the whole table.
   * When absent (e.g. after applySnapshot/bootstrap), treat as full refresh for each table in `tables`.
   */
  updatedIdsByTable?: Partial<Record<TableName, readonly TableId[]>>;
}
