import fs from "node:fs";

import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";

import type { IndexerService } from "./indexer/IndexerService.ts";
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
    "X-Snapshot-Format",
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

  // GET /snapshot — returns pre-gzipped snapshot Buffer
  app.get("/snapshot", () => {
    const buf = cache.getGzipBuffer();
    const snapshotBlock = cache.getProcessedBlockNumber();
    return new Response(Uint8Array.from(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Content-Length": String(buf.byteLength),
        "X-Snapshot-Block": String(snapshotBlock),
        "X-Snapshot-Format": "dfpunk-snapshot-v1",
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
        snapshotEncoding: "gzip",
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
  app.get("/admin/backup", (c) => {
    if (!adminToken) {
      return c.json({ error: "Backup endpoint disabled" }, 403);
    }
    const auth = c.req.header("authorization") ?? "";
    const expected = `Bearer ${adminToken}`;
    if (auth !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const dbPath = store.getDatabasePath();
    if (!fs.existsSync(dbPath)) {
      return c.json({ error: "No database file found" }, 404);
    }

    const fileBuffer = fs.readFileSync(dbPath);
    return new Response(Uint8Array.from(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="indexer-backup.db"`,
      },
    });
  });

  return app;
}
