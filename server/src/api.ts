import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import type { IndexerService } from "../../packages/indexer-server-core/src/index.ts";
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

  // GET /blocks/latest
  app.get("/blocks/latest", () => {
    const snapshotBlock = cache.getProcessedBlockNumber();
    return new Response(
      JSON.stringify({
        blockNumber: indexer.getProcessedBlockNumber(),
        snapshotBlock,
        snapshotBytes: cache.getJsonByteLength(),
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
    const snapshotBlock = cache.getProcessedBlockNumber();
    const snapshotBytes = cache.getJsonByteLength();
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
