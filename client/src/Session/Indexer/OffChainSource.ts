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

export interface SnapshotDownloadProgress {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  done: boolean;
}

export interface OffChainSourceOptions {
  /** Base URL of the indexer API (no trailing slash). */
  baseUrl: string;
  /** Optional fetch (e.g. with auth or custom headers). */
  fetch?: typeof fetch;
  /** Optional callback for snapshot download progress. */
  onSnapshotProgress?: (progress: SnapshotDownloadProgress) => void;
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
  private readonly onSnapshotProgress:
    | ((progress: SnapshotDownloadProgress) => void)
    | undefined;
  private readonly progressEmitMinIntervalMs = 120;
  private lastProgressEmitAt = 0;

  constructor(options: OffChainSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    const fetchImpl = options.fetch;
    // Avoid illegal invocation with browser-native fetch while preserving custom fetch implementations.
    this.doFetch = (input: RequestInfo | URL, init?: RequestInit) =>
      fetchImpl ? fetchImpl(input, init) : fetch(input, init);
    this.onSnapshotProgress = options.onSnapshotProgress;
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
    const data = await this.readSnapshotJsonWithProgress(res);
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

  private emitSnapshotProgress(progress: SnapshotDownloadProgress): void {
    if (!this.onSnapshotProgress) return;
    const now = Date.now();
    const forceEmit = progress.done || progress.loadedBytes === 0;
    if (
      !forceEmit &&
      now - this.lastProgressEmitAt < this.progressEmitMinIntervalMs
    ) {
      return;
    }
    this.lastProgressEmitAt = now;
    try {
      this.onSnapshotProgress(progress);
    } catch (err) {
      console.warn("[OffChainBlockSource] progress callback error:", err);
    }
  }

  private toPercent(loaded: number, total: number | null): number | null {
    if (!total || total <= 0) return null;
    const raw = Math.floor((loaded / total) * 100);
    return Math.max(0, Math.min(100, raw));
  }

  private async readSnapshotJsonWithProgress(
    res: Response
  ): Promise<Record<string, unknown>> {
    const totalHeader = res.headers.get("content-length");
    const parsedTotal = totalHeader ? Number.parseInt(totalHeader, 10) : NaN;
    const totalBytes =
      Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;

    if (!this.onSnapshotProgress) {
      return (await res.json()) as Record<string, unknown>;
    }

    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      this.emitSnapshotProgress({
        loadedBytes: buf.byteLength,
        totalBytes,
        percent: this.toPercent(buf.byteLength, totalBytes),
        done: true,
      });
      const text = new TextDecoder().decode(buf);
      return JSON.parse(text) as Record<string, unknown>;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let loadedBytes = 0;
    let text = "";
    this.emitSnapshotProgress({
      loadedBytes: 0,
      totalBytes,
      percent: this.toPercent(0, totalBytes),
      done: false,
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      loadedBytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      this.emitSnapshotProgress({
        loadedBytes,
        totalBytes,
        percent: this.toPercent(loadedBytes, totalBytes),
        done: false,
      });
    }
    text += decoder.decode();

    this.emitSnapshotProgress({
      loadedBytes,
      totalBytes,
      percent: this.toPercent(loadedBytes, totalBytes),
      done: true,
    });
    return JSON.parse(text) as Record<string, unknown>;
  }
}
