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
} from "../TableTypes/chain";

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

/** Full snapshot: all tables + last processed block. */
export interface IndexerSnapshot {
  lastProcessedBlock: number;
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
  toBlock: number;
  updates: TableUpdate[];
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
}

/** Query result: processed block info for tx inputs and UI. */
export interface IndexerStatus {
  lastProcessedBlock: number;
  latestKnownBlock: number;
  isSyncing: boolean;
}

/**
 * Payload passed to subscribe() when state changes.
 * Lets the upper layer know which tables (and which row ids) were updated for incremental state updates.
 */
export interface IndexerChangePayload {
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
