import { createHash } from "node:crypto";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import {
  TABLE_NAMES,
  type IndexerService,
  type TableName,
} from "@dfpunk/indexer-core";
import type { SnapshotStore } from "./persistence.ts";
import type { SnapshotCache } from "./snapshotCache.ts";

export interface ApiDeps {
  indexer: IndexerService;
  cache: SnapshotCache;
  store: SnapshotStore;
  adminToken: string;
  corsOrigins: string[];
}

export function createApp(deps: ApiDeps): Hono {
  const { indexer, cache, store, adminToken, corsOrigins } = deps;
  const app = new Hono();
  const snapshotExposeHeaders = [
    "Content-Length",
    "X-Snapshot-Chunk-Count",
    "X-Snapshot-Chunk-Index",
    "X-Snapshot-Chunk-Rows",
    "X-Snapshot-Block",
    "X-Snapshot-Uncompressed-Length",
  ];

  // Browser calls from local frontend (or configured domains) need CORS.
  if (corsOrigins.includes("*")) {
    app.use(
      "*",
      cors({
        origin: "*",
        exposeHeaders: snapshotExposeHeaders,
      }),
    );
  } else if (corsOrigins.length > 0) {
    app.use(
      "*",
      cors({
        origin: corsOrigins,
        exposeHeaders: snapshotExposeHeaders,
      }),
    );
  }

  // gzip for non-snapshot routes (snapshot returns pre-gzipped Buffer)
  app.use("/blocks/*", compress());
  app.use("/health", compress());

  // GET /snapshot — returns pre-compressed snapshot Buffer (Brotli preferred, gzip fallback)
  app.get("/snapshot", (c) => {
    const storedSnapshot = store.getActiveSnapshotPayload();
    if (storedSnapshot) {
      const accept = c.req.header("accept-encoding") ?? "";
      const useBrotli = accept.includes("br");
      const source = Buffer.from(storedSnapshot.jsonString);
      const buf = useBrotli
        ? brotliCompressSync(source, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
          })
        : gzipSync(source);
      const encoding = useBrotli ? "br" : "gzip";
      return new Response(Uint8Array.from(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": encoding,
          "Content-Length": String(buf.byteLength),
          "X-Snapshot-Block": String(storedSnapshot.blockNumber),
          "X-Snapshot-Uncompressed-Length": String(
            storedSnapshot.jsonByteLength,
          ),
          "Cache-Control": "no-cache",
        },
      });
    }

    const accept = c.req.header("accept-encoding") ?? "";
    const useBrotli = accept.includes("br");
    const buf = useBrotli ? cache.getBrotliBuffer() : cache.getGzipBuffer();
    const encoding = useBrotli ? "br" : "gzip";
    const jsonBytes = cache.getJsonByteLength();
    const snapshotBlock = cache.getProcessedBlockNumber();
    return new Response(Uint8Array.from(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": encoding,
        "Content-Length": String(buf.byteLength),
        "X-Snapshot-Block": String(snapshotBlock),
        // Uncompressed JSON bytes help clients compute a meaningful progress
        // when the transport body is transparently decompressed by fetch.
        "X-Snapshot-Uncompressed-Length": String(jsonBytes),
        "Cache-Control": "no-cache",
      },
    });
  });

  // GET /snapshot/manifest — v2 chunk metadata (clients can opt-in without breaking /snapshot)
  app.get("/snapshot/manifest", (c) => {
    const chunkRows = parseChunkRows(c.req.query("chunkRows"));
    const storedManifest = store.getActiveChunkManifest(chunkRows);
    if (storedManifest) {
      return c.json(storedManifest);
    }
    return c.json(cache.getChunkManifest(chunkRows));
  });

  // GET /snapshot/chunks/:table/:chunkIndex — v2 chunk payload (Brotli preferred, gzip fallback)
  app.get("/snapshot/chunks/:table/:chunkIndex", (c) => {
    const table = c.req.param("table");
    if (!isTableName(table)) {
      return c.json({ error: "Unknown table" }, 404);
    }

    const chunkIndex = Number(c.req.param("chunkIndex"));
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return c.json({ error: "Invalid chunkIndex" }, 400);
    }

    const chunkRows = parseChunkRows(c.req.query("chunkRows"));
    const storedChunk = store.getActiveEncodedChunk(
      table,
      chunkIndex,
      chunkRows,
    );
    if (storedChunk) {
      return new Response(Uint8Array.from(storedChunk.payload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": storedChunk.encoding,
          "Content-Length": String(storedChunk.payload.byteLength),
          "X-Snapshot-Block": String(storedChunk.snapshotBlock),
          "X-Snapshot-Chunk-Count": String(storedChunk.chunkCount),
          "X-Snapshot-Chunk-Index": String(chunkIndex),
          "X-Snapshot-Chunk-Rows": String(storedChunk.chunkRows),
          "X-Snapshot-Uncompressed-Length": String(storedChunk.jsonByteLength),
          "Cache-Control": "no-cache",
        },
      });
    }

    const chunk = cache.getEncodedChunk(table, chunkIndex, chunkRows);
    if (!chunk) {
      return c.json({ error: "Chunk not found" }, 404);
    }
    const accept = c.req.header("accept-encoding") ?? "";
    const useBrotli = accept.includes("br");
    const payload = useBrotli ? chunk.brotli : chunk.gzip;
    const encoding = useBrotli ? "br" : "gzip";
    return new Response(Uint8Array.from(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": encoding,
        "Content-Length": String(payload.byteLength),
        "X-Snapshot-Block": String(cache.getProcessedBlockNumber()),
        "X-Snapshot-Chunk-Count": String(chunk.chunkCount),
        "X-Snapshot-Chunk-Index": String(chunkIndex),
        "X-Snapshot-Chunk-Rows": String(chunkRows),
        "X-Snapshot-Uncompressed-Length": String(chunk.jsonByteLength),
        "Cache-Control": "no-cache",
      },
    });
  });

  // GET /snapshot/hash — SHA-256 hash of snapshot JSON for client-side consistency verification
  app.get("/snapshot/hash", (c) => {
    const storedSnapshot = store.getActiveSnapshotPayload();
    if (storedSnapshot) {
      const hash = createHash("sha256")
        .update(storedSnapshot.jsonString)
        .digest("hex");
      return c.json({
        hash,
        lastProcessedBlock: storedSnapshot.blockNumber,
      });
    }

    const jsonStr = cache.getJsonString();
    const hash = createHash("sha256").update(jsonStr).digest("hex");
    return c.json({
      hash,
      lastProcessedBlock: cache.getProcessedBlockNumber(),
    });
  });

  // GET /blocks/latest
  app.get("/blocks/latest", () => {
    const storedSummary = store.getActiveSnapshotSummary();
    const snapshotBlock =
      storedSummary?.blockNumber ?? cache.getProcessedBlockNumber();
    const snapshotBytes =
      storedSummary?.jsonByteLength ?? cache.getJsonByteLength();
    return new Response(
      JSON.stringify({
        blockNumber: indexer.getProcessedBlockNumber(),
        snapshotBlock,
        snapshotBytes,
        snapshotEncoding: "br, gzip",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  });

  // GET /health
  app.get("/health", (c) => {
    const status = indexer.getStatus();
    const storedSummary = store.getActiveSnapshotSummary();
    const snapshotBlock =
      storedSummary?.blockNumber ?? cache.getProcessedBlockNumber();
    const snapshotBytes =
      storedSummary?.jsonByteLength ?? cache.getJsonByteLength();
    const blockLag = Math.max(
      0,
      status.latestKnownBlock - status.lastProcessedBlock,
    );
    return c.json({
      status: "ok",
      lifecycle: status.lifecycle,
      lastProcessedBlock: status.lastProcessedBlock,
      latestKnownBlock: status.latestKnownBlock,
      isSyncing: status.isSyncing,
      metrics: {
        blockLag,
        snapshotBlock,
        snapshotBytes,
      },
    });
  });

  // GET /admin/backup — download SQLite database file (Authorization header protected)
  app.get("/admin/backup", async (c) => {
    if (!adminToken) {
      return c.json({ error: "Backup endpoint disabled" }, 403);
    }
    const auth = c.req.header("authorization") ?? "";
    const expected = `Bearer ${adminToken}`;
    if (auth !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    try {
      const fileBuffer = await store.createBackupBuffer();
      return new Response(Uint8Array.from(fileBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="indexer-backup.db"`,
        },
      });
    } catch (err) {
      console.error("[API] Failed to create backup:", err);
      return c.json({ error: "Backup failed" }, 500);
    }
  });

  return app;
}

function parseChunkRows(raw: string | undefined): number {
  if (!raw || raw.trim() === "") return 1000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return 1000;
  return Math.min(parsed, 20_000);
}

function isTableName(value: string): value is TableName {
  return TABLE_NAMES.includes(value as TableName);
}
