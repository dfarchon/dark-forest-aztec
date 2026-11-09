/**
 * Block event source that fetches snapshot (and optionally updates) from an off-chain indexer API.
 *
 * When used as IndexerService's bootstrapSource, only getSnapshot() is called: the off-chain
 * service provides initial state up to block X; blocks after X are maintained by the frontend
 * via the chain source. Only the identity-verified v3 snapshot is accepted for bootstrap.
 */

import type {
  BlockUpdates,
  IBlockEventSource,
  IndexerSnapshot,
  SnapshotIdentity,
  TableName,
  TableUpdate,
} from "@dfpunk/indexer-core";
import { TABLE_NAMES } from "@dfpunk/indexer-core";

export interface SnapshotDownloadProgress {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  phase: "downloading" | "parsing" | "complete";
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

const SNAPSHOT_CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Expected API shape (implement on the indexer):
 *
 * For bootstrap, the server must provide a v3 manifest and version-addressed chunks.
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
    if (toBlock !== undefined)
      throw new Error("Historical snapshots are not identity-verified");
    try {
      return await this.getSnapshotV3();
    } catch (err) {
      // A retained publication may expire during a long download. Restart from
      // a fresh manifest once; never mix chunks from the two publications.
      if (
        err instanceof Error &&
        /Indexer v3 chunk .*: 404/.test(err.message)
      ) {
        return this.getSnapshotV3();
      }
      throw err;
    }
  }

  private async getSnapshotV3(): Promise<IndexerSnapshot | null> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/snapshot/v3/manifest`
    );
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Indexer v3 manifest: ${response.status}`);
    const manifest = (await response.json()) as {
      version?: unknown;
      snapshotId?: unknown;
      lastProcessedBlock?: unknown;
      lastProcessedBlockHash?: unknown;
      identity?: SnapshotIdentity;
      chunkRows?: unknown;
      tables?: Record<string, { rowCount?: number; hashes?: string[] }>;
    };
    if (
      manifest.version !== 3 ||
      typeof manifest.snapshotId !== "string" ||
      !/^[0-9a-f-]{36}$/.test(manifest.snapshotId) ||
      !Number.isSafeInteger(manifest.lastProcessedBlock) ||
      typeof manifest.lastProcessedBlockHash !== "string" ||
      !manifest.identity ||
      !Number.isSafeInteger(manifest.chunkRows) ||
      (manifest.chunkRows as number) <= 0 ||
      !manifest.tables ||
      typeof manifest.tables !== "object"
    ) {
      throw new Error("Indexer v3 manifest: invalid shape");
    }
    const data: Record<string, unknown> = {
      lastProcessedBlock: manifest.lastProcessedBlock,
      lastProcessedBlockHash: manifest.lastProcessedBlockHash,
    };
    let loadedBytes = 0;
    const tasks: Array<() => Promise<void>> = [];
    for (const table of TABLE_NAMES) {
      const spec = manifest.tables[table];
      if (
        !spec ||
        !Number.isSafeInteger(spec.rowCount) ||
        spec.rowCount! < 0 ||
        !Array.isArray(spec.hashes) ||
        spec.hashes.length !==
          Math.ceil(spec.rowCount! / (manifest.chunkRows as number)) ||
        !spec.hashes.every(
          (hash) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)
        )
      ) {
        throw new Error(`Indexer v3 manifest: invalid ${table}`);
      }
      data[table] = {};
      for (let index = 0; index < spec.hashes!.length; index++) {
        const chunkIndex = index;
        tasks.push(async () => {
          const url = `${this.baseUrl}/snapshot/v3/chunks/${manifest.snapshotId}/${table}/${chunkIndex}`;
          const chunkResponse = await this.fetchWithTimeout(url);
          if (!chunkResponse.ok)
            throw new Error(
              `Indexer v3 chunk ${table}/${chunkIndex}: ${chunkResponse.status}`
            );
          const bytes = new Uint8Array(await chunkResponse.arrayBuffer());
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const hash = Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, "0")
          ).join("");
          if (hash !== spec.hashes![chunkIndex])
            throw new Error(
              `Indexer v3 chunk ${table}/${chunkIndex}: hash mismatch`
            );
          const chunk = JSON.parse(new TextDecoder().decode(bytes)) as Record<
            string,
            unknown
          >;
          if (
            chunk.version !== 3 ||
            chunk.snapshotId !== manifest.snapshotId ||
            chunk.table !== table ||
            chunk.chunkIndex !== chunkIndex ||
            !chunk.rows ||
            typeof chunk.rows !== "object" ||
            Array.isArray(chunk.rows)
          ) {
            throw new Error(
              `Indexer v3 chunk ${table}/${chunkIndex}: identity mismatch`
            );
          }
          const target = data[table] as Record<string, unknown>;
          for (const [id, row] of Object.entries(chunk.rows)) {
            if (Object.hasOwn(target, id))
              throw new Error(`Indexer v3 duplicate ${table}:${id}`);
            target[id] = row;
          }
          loadedBytes += bytes.byteLength;
          this.emitSnapshotProgress({
            loadedBytes,
            totalBytes: null,
            percent: null,
            phase: "downloading",
            done: false,
          });
        });
      }
    }
    await this.runConcurrent(tasks);
    for (const table of TABLE_NAMES) {
      if (
        Object.keys(data[table] as object).length !==
        manifest.tables[table].rowCount
      ) {
        throw new Error(`Indexer v3 ${table}: row count mismatch`);
      }
    }
    const snapshot = this.parseSnapshot(data);
    snapshot.identity = manifest.identity;
    this.emitSnapshotProgress({
      loadedBytes,
      totalBytes: null,
      percent: null,
      phase: "complete",
      done: true,
    });
    return snapshot;
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
    for (const update of updates) {
      if (!TABLE_NAMES.includes(update.table as TableName)) {
        throw new Error(`Indexer updates: unknown table ${update.table}`);
      }
    }
    return {
      fromBlock:
        typeof data.fromBlock === "number" ? data.fromBlock : fromBlock,
      toBlock: typeof data.toBlock === "number" ? data.toBlock : toBlock,
      updates: updates.map((u) => ({
        table: u.table as TableName,
        id: String(u.id ?? ""),
        state: (u.state ?? {}) as TableUpdate["state"],
      })),
    };
  }

  private parseSnapshot(data: Record<string, unknown>): IndexerSnapshot {
    const lastProcessedBlock =
      typeof data.lastProcessedBlock === "number" ? data.lastProcessedBlock : 0;
    const lastProcessedBlockHash =
      typeof data.lastProcessedBlockHash === "string"
        ? data.lastProcessedBlockHash
        : undefined;
    const snapshot: IndexerSnapshot = {
      lastProcessedBlock,
      lastProcessedBlockHash,
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
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Indexer snapshot: missing ${table} table`);
      }
      const map = snapshot[table] as Map<string, unknown>;
      for (const [id, state] of Object.entries(
        raw as Record<string, unknown>
      )) {
        if (
          state === null ||
          typeof state !== "object" ||
          Array.isArray(state)
        ) {
          throw new Error(`Indexer snapshot: invalid ${table}:${id}`);
        }
        map.set(id, state);
      }
    }
    return snapshot;
  }

  private emitSnapshotProgress(progress: SnapshotDownloadProgress): void {
    if (!this.onSnapshotProgress) return;
    const now = Date.now();
    const forceEmit =
      progress.done ||
      progress.loadedBytes === 0 ||
      progress.phase !== "downloading";
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

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await this.doFetch(url, { signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`request timeout after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runConcurrent(
    tasks: Array<() => Promise<void>>
  ): Promise<void> {
    if (tasks.length === 0) return;
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(tasks.length, SNAPSHOT_CONCURRENCY) },
      async () => {
        while (nextIndex < tasks.length) {
          const i = nextIndex++;
          await tasks[i]();
        }
      }
    );
    await Promise.all(workers);
  }
}
