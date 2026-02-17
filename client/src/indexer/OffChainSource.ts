/**
 * Block event source that fetches snapshot (and optionally updates) from an off-chain indexer API.
 *
 * When used as IndexerService's bootstrapSource, only getSnapshot() is called: the off-chain
 * service provides initial state up to block X; blocks after X are maintained by the frontend
 * via the chain source. The off-chain indexer only needs to expose GET /snapshot (and optionally
 * /snapshot?toBlock=N). getBlockUpdates and getLatestBlockNumber are not used in that case.
 */

import type {
  BlockUpdates,
  IBlockEventSource,
  IndexerSnapshot,
  TableName,
  TableUpdate,
} from "./types";
import { TABLE_NAMES } from "./types";

export interface OffChainSourceOptions {
  /** Base URL of the indexer API (no trailing slash). */
  baseUrl: string;
  /** Optional fetch (e.g. with auth or custom headers). */
  fetch?: typeof fetch;
}

/**
 * Expected API shape (implement on your indexer server):
 *
 * For bootstrap only (IndexerService bootstrapSource), only snapshot is required:
 *
 * - GET {baseUrl}/snapshot?toBlock=N
 *   -> { lastProcessedBlock: number, world: Record<id, state>, player: ..., planet: ..., ... }
 *
 * Optional (only if using this source for ongoing sync; not used when passed as bootstrapSource):
 *
 * - GET {baseUrl}/updates?fromBlock=N&toBlock=M
 *   -> { fromBlock, toBlock, updates: Array<{ table, id, state }> }
 * - GET {baseUrl}/blocks/latest -> { blockNumber: number }
 */
export class OffChainBlockSource implements IBlockEventSource {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: OffChainSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.doFetch = options.fetch ?? fetch;
  }

  async getLatestBlockNumber(): Promise<number> {
    const res = await this.doFetch(`${this.baseUrl}/blocks/latest`);
    if (!res.ok) throw new Error(`Indexer latest block: ${res.status}`);
    const data = (await res.json()) as { blockNumber?: number };
    const n = data.blockNumber;
    if (typeof n !== "number")
      throw new Error("Indexer latest block: invalid response");
    return n;
  }

  async getSnapshot(toBlock?: number): Promise<IndexerSnapshot | null> {
    const url =
      toBlock !== undefined
        ? `${this.baseUrl}/snapshot?toBlock=${toBlock}`
        : `${this.baseUrl}/snapshot`;
    const res = await this.doFetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Indexer snapshot: ${res.status}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    return this.parseSnapshot(data);
  }

  async getBlockUpdates(
    fromBlock: number,
    toBlock: number
  ): Promise<BlockUpdates> {
    const res = await this.doFetch(
      `${this.baseUrl}/updates?fromBlock=${fromBlock}&toBlock=${toBlock}`
    );
    if (!res.ok) throw new Error(`Indexer updates: ${res.status}`);
    const data = (await res.json()) as {
      fromBlock?: number;
      toBlock?: number;
      updates?: Array<{
        table: string;
        id: unknown;
        state: Record<string, unknown>;
      }>;
    };
    const updates = Array.isArray(data.updates) ? data.updates : [];
    return {
      fromBlock:
        typeof data.fromBlock === "number" ? data.fromBlock : fromBlock,
      toBlock: typeof data.toBlock === "number" ? data.toBlock : toBlock,
      updates: updates.map((u) => ({
        table: (TABLE_NAMES.includes(u.table as TableName)
          ? u.table
          : "world") as TableName,
        id: String(u.id ?? ""),
        state: (u.state ?? {}) as TableUpdate["state"],
      })),
    };
  }

  private parseSnapshot(data: Record<string, unknown>): IndexerSnapshot {
    const lastProcessedBlock =
      typeof data.lastProcessedBlock === "number" ? data.lastProcessedBlock : 0;
    const snapshot: IndexerSnapshot = {
      lastProcessedBlock,
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

    for (const table of TABLE_NAMES) {
      const raw = data[table];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const map = snapshot[table] as Map<string, unknown>;
      for (const [id, state] of Object.entries(
        raw as Record<string, unknown>
      )) {
        if (state !== null && typeof state === "object") map.set(id, state);
      }
    }
    return snapshot;
  }
}
