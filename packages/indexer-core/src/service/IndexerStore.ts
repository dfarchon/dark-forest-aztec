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
} from "../TableTypes/chain.ts";
import type {
  BlockUpdates,
  IndexerSnapshot,
  TableId,
  TableName,
  TableRowType,
  TableUpdate,
} from "../types.ts";
import { TABLE_NAMES } from "../types.ts";
import {
  convertRow,
  normalizeSnapshot,
  rawIdToTableId,
} from "../utils/convert.ts";
import { ArtifactIndex } from "./ArtifactIndex.ts";

type Raw = Record<string, unknown>;

export interface CommittedChunk {
  toBlock: number;
  tables: TableName[];
  updatedIdsByTable: Partial<Record<TableName, TableId[]>>;
}

function emptySnapshot(): IndexerSnapshot {
  return {
    lastProcessedBlock: 0,
    world: new Map(),
    player: new Map(),
    planet: new Map(),
    planet_revealed_coords: new Map(),
    planet_events: new Map(),
    planet_artifacts: new Map(),
    arrival: new Map(),
    artifact: new Map(),
    artifact_location: new Map(),
  };
}

/**
 * In-memory chain tables. Knows how to apply a block range atomically and
 * answer queries. Does not talk to a node, poll, or notify subscribers.
 */
export class IndexerStore {
  private snapshot: IndexerSnapshot = emptySnapshot();
  private readonly artifactIndex = new ArtifactIndex();
  private readonly startBlock: number;

  constructor(startBlock: number) {
    this.startBlock = startBlock;
  }

  get processedBlock(): number {
    return this.snapshot.lastProcessedBlock;
  }

  get processedBlockHash(): string | undefined {
    return this.snapshot.lastProcessedBlockHash;
  }

  /**
   * Convert every row first, then write them and update artifact indexes.
   * A bad row throws before any of this snapshot changes.
   */
  commit(updates: BlockUpdates): CommittedChunk {
    const pending: Array<{ table: TableName; id: TableId; state: unknown }> =
      [];
    for (const u of updates.updates) {
      const id = rawIdToTableId(u.table, (u as { id?: unknown }).id);
      const rawState = (u as TableUpdate<Raw>).state;
      pending.push({
        table: u.table,
        id,
        state: convertRow(u.table, id, rawState),
      });
    }

    for (const p of pending) {
      const tableMap = this.snapshot[p.table] as Map<TableId, unknown>;
      if (p.table === "artifact") {
        const oldState = tableMap.get(p.id) as ArtifactState | undefined;
        this.artifactIndex.onUpsert(p.id, oldState, p.state as ArtifactState);
      }
      tableMap.set(p.id, p.state);
    }

    const committedTo = updates.toBlock;
    this.snapshot.lastProcessedBlock = committedTo;
    this.snapshot.lastProcessedBlockHash = updates.toBlockHash;

    return {
      toBlock: committedTo,
      tables: [...new Set(updates.updates.map((u) => u.table))],
      updatedIdsByTable: updatedIdsByTable(updates),
    };
  }

  /** Replace all tables from a snapshot. */
  replaceSnapshot(snapshot: IndexerSnapshot): number {
    return this.installSnapshot(normalizeSnapshot(snapshot));
  }

  /** Same as replaceSnapshot, for a snapshot that normalizeSnapshot already converted. */
  protected installSnapshot(snapshot: IndexerSnapshot): number {
    this.snapshot = snapshot;
    this.artifactIndex.rebuild(
      this.snapshot.artifact as Map<string, ArtifactState>,
    );
    return snapshot.lastProcessedBlock;
  }

  /** Drop tables back to empty. */
  clear(): void {
    this.snapshot = emptySnapshot();
    this.artifactIndex.rebuild(
      this.snapshot.artifact as Map<string, ArtifactState>,
    );
  }

  /**
   * No usable snapshot. The cursor starts just before startBlock so the next
   * sync includes that block.
   */
  applyStartBlock(): void {
    if (this.startBlock > 0) {
      this.snapshot.lastProcessedBlock = this.startBlock - 1;
    }
  }

  /** The single world row. */
  getWorld(): WorldState | undefined {
    return this.snapshot.world.get("0") as WorldState | undefined;
  }

  /** One player. */
  getPlayer(id: TableId): PlayerState | undefined {
    return this.snapshot.player.get(id) as PlayerState | undefined;
  }

  /** One planet. */
  getPlanet(id: TableId): PlanetState | undefined {
    return this.snapshot.planet.get(id) as PlanetState | undefined;
  }

  /** Revealed coordinates for a planet. */
  getPlanetRevealedCoords(id: TableId): PlanetRevealedCoordsState | undefined {
    return this.snapshot.planet_revealed_coords.get(id) as
      | PlanetRevealedCoordsState
      | undefined;
  }

  /** Event list on a planet. */
  getPlanetEvents(id: TableId): PlanetEventsState | undefined {
    return this.snapshot.planet_events.get(id) as PlanetEventsState | undefined;
  }

  /** Artifacts stored on a planet. */
  getPlanetArtifacts(id: TableId): PlanetArtifactsState | undefined {
    return this.snapshot.planet_artifacts.get(id) as
      | PlanetArtifactsState
      | undefined;
  }

  /** One arrival. */
  getArrival(id: TableId): ArrivalState | undefined {
    return this.snapshot.arrival.get(id) as ArrivalState | undefined;
  }

  /** One artifact. */
  getArtifact(id: TableId): ArtifactState | undefined {
    return this.snapshot.artifact.get(id) as ArtifactState | undefined;
  }

  /** Where an artifact is. */
  getArtifactLocation(id: TableId): ArtifactLocationState | undefined {
    return this.snapshot.artifact_location.get(id) as
      | ArtifactLocationState
      | undefined;
  }

  /** One row, or the whole table when id is omitted. */
  getTable<K extends TableName>(
    table: K,
    id?: TableId,
  ): TableRowType[K] | Record<string, TableRowType[K]> | undefined {
    const map = this.snapshot[table] as Map<TableId, unknown>;
    if (id !== undefined) return map.get(id) as TableRowType[K] | undefined;
    return Object.fromEntries(map) as Record<string, TableRowType[K]>;
  }

  toJsonString(): string {
    const obj: Record<string, unknown> = {
      lastProcessedBlock: this.snapshot.lastProcessedBlock,
    };
    if (this.snapshot.lastProcessedBlockHash !== undefined) {
      obj.lastProcessedBlockHash = this.snapshot.lastProcessedBlockHash;
    }
    for (const table of TABLE_NAMES) {
      const map = this.snapshot[table] as Map<TableId, unknown>;
      obj[table] = Object.fromEntries(map);
    }
    return JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  }

  /** All planet ids currently in state. */
  getPlanetIds(): string[] {
    return Array.from(this.snapshot.planet.keys());
  }

  /** All player ids (addresses). */
  getPlayerIds(): string[] {
    return Array.from(this.snapshot.player.keys());
  }

  /** All arrival ids. */
  getArrivalIds(): string[] {
    return Array.from(this.snapshot.arrival.keys());
  }

  /** All artifact ids. */
  getArtifactIds(): string[] {
    return Array.from(this.snapshot.artifact.keys());
  }

  /** Total number of artifacts in state. */
  getArtifactCount(): number {
    return this.snapshot.artifact.size;
  }

  /** Artifact ids whose owner is this address. */
  getArtifactIdsByOwner(ownerId: string): string[] {
    return this.artifactIndex.byOwner(ownerId);
  }

  /** Artifact ids controlled by this address. */
  getArtifactIdsByController(controllerId: string): string[] {
    return this.artifactIndex.byController(controllerId);
  }

  /** id → PlayerState. */
  getPlayerMap(): Map<string, PlayerState> {
    return new Map(this.snapshot.player as Map<string, PlayerState>);
  }

  /** id → PlanetState. */
  getPlanetMap(): Map<string, PlanetState> {
    return new Map(this.snapshot.planet as Map<string, PlanetState>);
  }

  /** id → ArrivalState. */
  getArrivalMap(): Map<string, ArrivalState> {
    return new Map(this.snapshot.arrival as Map<string, ArrivalState>);
  }

  /** id → PlanetRevealedCoordsState. */
  getRevealedCoordsMap(): Map<string, PlanetRevealedCoordsState> {
    return new Map(
      this.snapshot.planet_revealed_coords as Map<
        string,
        PlanetRevealedCoordsState
      >,
    );
  }
}

function updatedIdsByTable(
  updates: BlockUpdates,
): Partial<Record<TableName, TableId[]>> {
  const byTable = new Map<TableName, Set<TableId>>();
  for (const u of updates.updates) {
    const id = rawIdToTableId(u.table, (u as { id?: unknown }).id);
    let set = byTable.get(u.table);
    if (!set) {
      set = new Set();
      byTable.set(u.table, set);
    }
    set.add(id);
  }
  const out: Partial<Record<TableName, TableId[]>> = {};
  byTable.forEach((ids, table) => {
    out[table] = [...ids];
  });
  return out;
}
