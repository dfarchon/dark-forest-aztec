#!/usr/bin/env node
/**
 * compare-snapshots.mjs
 *
 * Compares a client-side snapshot JSON file against the server's live snapshot.
 *
 * Usage:
 *   node scripts/compare-snapshots.mjs <client-snapshot.json> [--server-url URL]
 *
 * The client snapshot file can be obtained from the browser console:
 *   dfDebug.downloadSnapshot()
 *
 * Examples:
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json --server-url http://localhost:3001
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";

const TABLE_NAMES = [
  "world",
  "player",
  "planet",
  "planet_revealed_coords",
  "planet_events",
  "planet_artifacts",
  "arrival",
  "artifact",
  "artifact_location",
];

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  let clientFile = null;
  let serverUrl = process.env.SERVER_URL ?? "http://localhost:3001";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server-url" && args[i + 1]) {
      serverUrl = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      clientFile = args[i];
    }
  }

  if (!clientFile) {
    console.error(
      "Usage: node scripts/compare-snapshots.mjs <client-snapshot.json> [--server-url URL]"
    );
    console.error("");
    console.error("Get the client snapshot from browser console:");
    console.error("  dfDebug.downloadSnapshot()");
    process.exit(1);
  }

  return { clientFile, serverUrl };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(str) {
  return createHash("sha256").update(str).digest("hex");
}

/** Normalize a snapshot object: sort keys in each table for deterministic comparison. */
function normalizeSnapshot(snap) {
  const out = { lastProcessedBlock: snap.lastProcessedBlock };
  for (const table of TABLE_NAMES) {
    const raw = snap[table];
    if (!raw || typeof raw !== "object") {
      out[table] = {};
      continue;
    }
    const sorted = {};
    for (const key of Object.keys(raw).sort()) {
      sorted[key] = raw[key];
    }
    out[table] = sorted;
  }
  return out;
}

function canonicalJson(obj) {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

function rowCount(snap) {
  let total = 0;
  for (const table of TABLE_NAMES) {
    const t = snap[table];
    if (t && typeof t === "object") total += Object.keys(t).length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { clientFile, serverUrl } = parseArgs();

  // 1. Load client snapshot
  console.log(`📂 Loading client snapshot: ${clientFile}`);
  const clientRaw = JSON.parse(fs.readFileSync(clientFile, "utf8"));
  const clientSnap = normalizeSnapshot(clientRaw);
  const clientBlock = clientSnap.lastProcessedBlock;
  console.log(`   Client block: ${clientBlock}, rows: ${rowCount(clientSnap)}`);

  // 2. Fetch server snapshot
  console.log(`🌐 Fetching server snapshot from ${serverUrl}/snapshot ...`);
  const res = await fetch(`${serverUrl}/snapshot`);
  if (!res.ok) {
    console.error(`   ❌ Server responded with ${res.status}`);
    process.exit(1);
  }

  // fetch() auto-decompresses br/gzip; just parse as JSON.
  // If the response has raw compressed bytes (e.g. Content-Encoding still set),
  // try to decompress manually as fallback.
  let serverJson;
  try {
    serverJson = await res.json();
  } catch {
    const buf = Buffer.from(await res.arrayBuffer());
    const contentEncoding = res.headers.get("content-encoding");
    const decompressed =
      contentEncoding === "br"
        ? zlib.brotliDecompressSync(buf)
        : contentEncoding === "gzip"
          ? zlib.gunzipSync(buf)
          : buf;
    serverJson = JSON.parse(decompressed.toString("utf8"));
  }
  const serverSnap = normalizeSnapshot(serverJson);
  const serverBlock = serverSnap.lastProcessedBlock;
  console.log(`   Server block: ${serverBlock}, rows: ${rowCount(serverSnap)}`);

  // 3. Block mismatch warning
  if (clientBlock !== serverBlock) {
    console.log("");
    console.warn(
      `⚠️  Block mismatch: client=${clientBlock}, server=${serverBlock}`
    );
    console.warn(
      `   Comparison is still performed but differences may be due to block lag.`
    );
    console.warn(
      `   For exact comparison, download the client snapshot when both are at the same block.`
    );
  }

  // 4. Hash comparison
  const clientHash = sha256(canonicalJson(clientSnap));
  const serverHash = sha256(canonicalJson(serverSnap));

  console.log("");
  console.log(`🔑 Client hash: ${clientHash}`);
  console.log(`🔑 Server hash: ${serverHash}`);

  if (clientHash === serverHash) {
    console.log("");
    console.log(`✅ Snapshots are IDENTICAL`);
    process.exit(0);
  }

  // 5. Per-table diff
  console.log("");
  console.log(`❌ Snapshots DIFFER — per-table breakdown:`);
  console.log("");

  let totalDiffs = 0;

  for (const table of TABLE_NAMES) {
    const clientTable = clientSnap[table] ?? {};
    const serverTable = serverSnap[table] ?? {};
    const clientKeys = new Set(Object.keys(clientTable));
    const serverKeys = new Set(Object.keys(serverTable));
    const allKeys = new Set([...clientKeys, ...serverKeys]);

    const missing = []; // in server but not client
    const extra = []; // in client but not server
    const different = []; // in both but values differ

    for (const key of allKeys) {
      const inClient = clientKeys.has(key);
      const inServer = serverKeys.has(key);

      if (!inClient && inServer) {
        missing.push(key);
      } else if (inClient && !inServer) {
        extra.push(key);
      } else {
        const cJson = JSON.stringify(clientTable[key]);
        const sJson = JSON.stringify(serverTable[key]);
        if (cJson !== sJson) {
          different.push(key);
        }
      }
    }

    const diffs = missing.length + extra.length + different.length;
    if (diffs === 0) {
      console.log(`  ✅ ${table}: identical (${clientKeys.size} rows)`);
      continue;
    }

    totalDiffs += diffs;
    console.log(
      `  ❌ ${table}: ${diffs} difference(s) (client=${clientKeys.size}, server=${serverKeys.size})`
    );

    if (missing.length > 0) {
      console.log(
        `     🔴 Missing on client (${missing.length}): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` ... +${missing.length - 5} more` : ""}`
      );
    }
    if (extra.length > 0) {
      console.log(
        `     🟡 Extra on client (${extra.length}): ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? ` ... +${extra.length - 5} more` : ""}`
      );
    }
    if (different.length > 0) {
      console.log(
        `     🔵 Value mismatch (${different.length}): ${different.slice(0, 5).join(", ")}${different.length > 5 ? ` ... +${different.length - 5} more` : ""}`
      );
      // Show first diff detail
      const firstKey = different[0];
      console.log(`        Example (${firstKey}):`);
      console.log(
        `          client: ${JSON.stringify(clientTable[firstKey]).slice(0, 200)}`
      );
      console.log(
        `          server: ${JSON.stringify(serverTable[firstKey]).slice(0, 200)}`
      );
    }
  }

  console.log("");
  console.log(`Total differences: ${totalDiffs}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
