/**
 * Block event source that fetches snapshot (and optionally updates) from an off-chain indexer API.
 *
 * When used as IndexerService's bootstrapSource, only getSnapshot() is called: the off-chain
 * service provides initial state up to block X; blocks after X are maintained by the frontend
 * via the chain source. The off-chain indexer only needs to expose GET /snapshot (and optionally
 * /snapshot?toBlock=N). getBlockUpdates and getLatestBlockNumber are not used in that case.
 */

import {
  parseSnapshotV2ChunkPayload,
  parseSnapshotV2Manifest,
  SnapshotV2Assembler,
  type SnapshotV2ChunkPayload,
} from "./snapshotV2";
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

const V2_CHUNK_ROWS = 1000;
const V2_CONCURRENCY = 6;
const V2_TIMEOUT_MS = 10_000;
const V2_MAX_RETRIES = 2;

/**
 * Expected API shape (implement on your indexer server):
 *
 * For bootstrap only (IndexerService bootstrapSource), one of these is required:
 *
 * v2 preferred:
 * - GET {baseUrl}/snapshot/manifest?chunkRows=N
 * - GET {baseUrl}/snapshot/chunks/:table/:chunkIndex?chunkRows=N
 *
 * v1 fallback:
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
    // Server v2 manifest/chunks currently represent latest snapshot only.
    // If toBlock is explicitly requested, keep using v1 endpoint.
    if (toBlock === undefined) {
      try {
        const v2 = await this.getSnapshotV2();
        if (v2) {
          console.info(
            "[OffChainBlockSource] bootstrap snapshot mode: v2_manifest_chunks"
          );
          return v2;
        }
      } catch (err) {
        console.warn(
          "[OffChainBlockSource] v2 bootstrap failed, fallback to v1 /snapshot:",
          err
        );
      }
    }

    const data = await this.getSnapshotJsonV1(toBlock);
    if (!data) return null;
    console.info("[OffChainBlockSource] bootstrap snapshot mode: v1_snapshot");
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

  private toPercent(loaded: number, total: number | null): number | null {
    if (!total || total <= 0) return null;
    const raw = Math.floor((loaded / total) * 100);
    return Math.max(0, Math.min(100, raw));
  }

  private async readSnapshotJsonWithProgress(
    res: Response
  ): Promise<Record<string, unknown>> {
    const totalHeader =
      res.headers.get("x-snapshot-uncompressed-length") ??
      res.headers.get("content-length");
    const parsedTotal = totalHeader ? Number.parseInt(totalHeader, 10) : NaN;
    const totalBytes =
      Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : null;

    if (!this.onSnapshotProgress) {
      return (await res.json()) as Record<string, unknown>;
    }

    this.emitSnapshotProgress({
      loadedBytes: 0,
      totalBytes,
      percent: this.toPercent(0, totalBytes),
      phase: "downloading",
      done: false,
    });

    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      this.emitSnapshotProgress({
        loadedBytes: buf.byteLength,
        totalBytes,
        percent: this.toPercent(buf.byteLength, totalBytes),
        phase: "downloading",
        done: false,
      });

      this.emitSnapshotProgress({
        loadedBytes: buf.byteLength,
        totalBytes,
        percent: this.toPercent(buf.byteLength, totalBytes),
        phase: "parsing",
        done: false,
      });

      const text = new TextDecoder().decode(buf);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      this.emitSnapshotProgress({
        loadedBytes: buf.byteLength,
        totalBytes,
        percent: this.toPercent(buf.byteLength, totalBytes),
        phase: "complete",
        done: true,
      });
      return parsed;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let loadedBytes = 0;
    let text = "";

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
        phase: "downloading",
        done: false,
      });
    }
    text += decoder.decode();

    this.emitSnapshotProgress({
      loadedBytes,
      totalBytes,
      percent: this.toPercent(loadedBytes, totalBytes),
      phase: "parsing",
      done: false,
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    this.emitSnapshotProgress({
      loadedBytes,
      totalBytes,
      percent: this.toPercent(loadedBytes, totalBytes),
      phase: "complete",
      done: true,
    });
    return parsed;
  }

  private async getSnapshotJsonV1(
    toBlock?: number
  ): Promise<Record<string, unknown> | null> {
    const url =
      toBlock !== undefined
        ? `${this.baseUrl}/snapshot?toBlock=${toBlock}`
        : `${this.baseUrl}/snapshot`;
    const res = await this.fetchWithTimeout(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Indexer snapshot: ${res.status}`);
    }
    return this.readSnapshotJsonWithProgress(res);
  }

  private async getSnapshotV2(): Promise<IndexerSnapshot | null> {
    const manifestRes = await this.fetchWithTimeout(
      `${this.baseUrl}/snapshot/manifest?chunkRows=${V2_CHUNK_ROWS}`
    );
    if (!manifestRes.ok) {
      if (manifestRes.status === 404) return null;
      throw new Error(`Indexer snapshot manifest: ${manifestRes.status}`);
    }
    const manifest = parseSnapshotV2Manifest(await manifestRes.json());
    if (!manifest) {
      throw new Error("Indexer snapshot manifest: invalid shape");
    }

    const assembler = new SnapshotV2Assembler(manifest);
    let loadedBytes = 0;

    this.emitSnapshotProgress({
      loadedBytes: 0,
      totalBytes: null,
      percent: null,
      phase: "downloading",
      done: false,
    });

    const tasks: Array<() => Promise<void>> = [];
    for (const table of TABLE_NAMES) {
      const chunkCount = manifest.tables[table].chunkCount;
      for (let ci = 0; ci < chunkCount; ci += 1) {
        const chunkIndex = ci;
        tasks.push(async () => {
          const { chunk, bytes } = await this.fetchChunk(
            table,
            chunkIndex,
            manifest.chunkRows
          );
          assembler.addChunk(chunk);
          loadedBytes += bytes;
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

    this.emitSnapshotProgress({
      loadedBytes,
      totalBytes: null,
      percent: null,
      phase: "parsing",
      done: false,
    });
    const snapshot = assembler.finalize();
    this.emitSnapshotProgress({
      loadedBytes,
      totalBytes: null,
      percent: null,
      phase: "complete",
      done: true,
    });
    return snapshot;
  }

  private async fetchChunk(
    table: TableName,
    chunkIndex: number,
    chunkRows: number
  ): Promise<{ chunk: SnapshotV2ChunkPayload; bytes: number }> {
    const url = `${this.baseUrl}/snapshot/chunks/${table}/${chunkIndex}?chunkRows=${chunkRows}`;
    let lastError: unknown;
    for (let attempt = 0; attempt <= V2_MAX_RETRIES; attempt += 1) {
      try {
        const res = await this.fetchWithTimeout(url);
        if (!res.ok) {
          throw new Error(
            `snapshot chunk ${table}/${chunkIndex}: ${res.status}`
          );
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        const chunk = parseSnapshotV2ChunkPayload(
          JSON.parse(new TextDecoder().decode(buf))
        );
        if (!chunk) {
          throw new Error(
            `snapshot chunk ${table}/${chunkIndex}: invalid shape`
          );
        }
        if (chunk.table !== table || chunk.chunkIndex !== chunkIndex) {
          throw new Error(
            `snapshot chunk ${table}/${chunkIndex}: identity mismatch`
          );
        }
        return { chunk, bytes: buf.byteLength };
      } catch (err) {
        lastError = err;
        if (attempt < V2_MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt === 0 ? 300 : 1000));
        }
      }
    }
    throw lastError;
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), V2_TIMEOUT_MS);
    try {
      return await this.doFetch(url, { signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`request timeout after ${V2_TIMEOUT_MS}ms`);
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
      { length: Math.min(tasks.length, V2_CONCURRENCY) },
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
