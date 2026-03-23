#!/usr/bin/env node
/**
 * compare-snapshots.mjs
 *
 * Compares a client-side snapshot JSON file against the server's live snapshot.
 *
 * Usage:
 *   node scripts/compare-snapshots.mjs <client-snapshot.json> [--server-url URL] [--ignore-block-mismatch]
 *
 * The client snapshot file can be obtained from the browser console:
 *   dfDebug.downloadSnapshot()
 *
 * Examples:
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json --server-url http://localhost:3001
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json --ignore-block-mismatch
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
  let ignoreBlockMismatch = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "--help") {
      console.log(
        "Usage: node scripts/compare-snapshots.mjs <client-snapshot.json> [--server-url URL] [--ignore-block-mismatch]"
      );
      console.log("");
      console.log("Get the client snapshot from browser console:");
      console.log("  dfDebug.downloadSnapshot()");
      process.exit(0);
    }
    if (args[i] === "--server-url" && args[i + 1]) {
      serverUrl = args[i + 1];
      i++;
    } else if (args[i] === "--ignore-block-mismatch") {
      ignoreBlockMismatch = true;
    } else if (!args[i].startsWith("--")) {
      clientFile = args[i];
    }
  }

  if (!clientFile) {
    console.error(
      "Usage: node scripts/compare-snapshots.mjs <client-snapshot.json> [--server-url URL] [--ignore-block-mismatch]"
    );
    console.error("");
    console.error("Get the client snapshot from browser console:");
    console.error("  dfDebug.downloadSnapshot()");
    process.exit(1);
  }

  return { clientFile, serverUrl, ignoreBlockMismatch };
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

function tableContentOnly(snap) {
  const { lastProcessedBlock: _ignored, ...tables } = snap;
  return tables;
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
// v2 chunk helpers
// ---------------------------------------------------------------------------

/** Fetch v2 manifest + all chunks from the server and reconstruct a snapshot. */
async function fetchV2Snapshot(serverUrl) {
  const manifestRes = await fetch(`${serverUrl}/snapshot/manifest`);
  if (!manifestRes.ok) return null;
  const manifest = await manifestRes.json();
  if (manifest.version !== 2) return null;

  const snap = { lastProcessedBlock: manifest.lastProcessedBlock };
  for (const table of TABLE_NAMES) {
    const info = manifest.tables[table];
    if (!info || info.chunkCount === 0) {
      snap[table] = {};
      continue;
    }
    const merged = {};
    for (let i = 0; i < info.chunkCount; i++) {
      const chunkRes = await fetch(
        `${serverUrl}/snapshot/chunks/${table}/${i}?chunkRows=${manifest.chunkRows}`
      );
      if (!chunkRes.ok) {
        console.warn(`   ⚠️  Failed to fetch chunk ${table}/${i}: ${chunkRes.status}`);
        return null;
      }
      let chunkJson;
      try {
        chunkJson = await chunkRes.json();
      } catch {
        const buf = Buffer.from(await chunkRes.arrayBuffer());
        const enc = chunkRes.headers.get("content-encoding");
        const decompressed =
          enc === "br"
            ? zlib.brotliDecompressSync(buf)
            : enc === "gzip"
              ? zlib.gunzipSync(buf)
              : buf;
        chunkJson = JSON.parse(decompressed.toString("utf8"));
      }
      Object.assign(merged, chunkJson.rows);
    }
    snap[table] = merged;
  }
  return snap;
}

/** Compare two normalized snapshots, print per-table diff, return diff count. */
function diffSnapshots(label, snapA, snapB, nameA, nameB) {
  let totalDiffs = 0;
  for (const table of TABLE_NAMES) {
    const aTable = snapA[table] ?? {};
    const bTable = snapB[table] ?? {};
    const aKeys = new Set(Object.keys(aTable));
    const bKeys = new Set(Object.keys(bTable));
    const allKeys = new Set([...aKeys, ...bKeys]);

    const missing = []; // in B but not A
    const extra = []; // in A but not B
    const different = [];

    for (const key of allKeys) {
      const inA = aKeys.has(key);
      const inB = bKeys.has(key);
      if (!inA && inB) {
        missing.push(key);
      } else if (inA && !inB) {
        extra.push(key);
      } else {
        if (JSON.stringify(aTable[key]) !== JSON.stringify(bTable[key])) {
          different.push(key);
        }
      }
    }

    const diffs = missing.length + extra.length + different.length;
    if (diffs === 0) {
      console.log(`  ✅ ${table}: identical (${aKeys.size} rows)`);
      continue;
    }

    totalDiffs += diffs;
    console.log(
      `  ❌ ${table}: ${diffs} difference(s) (${nameA}=${aKeys.size}, ${nameB}=${bKeys.size})`
    );

    if (missing.length > 0) {
      console.log(
        `     🔴 Missing on ${nameA} (${missing.length}): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` ... +${missing.length - 5} more` : ""}`
      );
    }
    if (extra.length > 0) {
      console.log(
        `     🟡 Extra on ${nameA} (${extra.length}): ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? ` ... +${extra.length - 5} more` : ""}`
      );
    }
    if (different.length > 0) {
      console.log(
        `     🔵 Value mismatch (${different.length}): ${different.slice(0, 5).join(", ")}${different.length > 5 ? ` ... +${different.length - 5} more` : ""}`
      );
      const firstKey = different[0];
      console.log(`        Example (${firstKey}):`);
      console.log(
        `          ${nameA}: ${JSON.stringify(aTable[firstKey]).slice(0, 200)}`
      );
      console.log(
        `          ${nameB}: ${JSON.stringify(bTable[firstKey]).slice(0, 200)}`
      );
    }
  }
  return totalDiffs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { clientFile, serverUrl, ignoreBlockMismatch } = parseArgs();

  // 1. Load client snapshot
  console.log(`📂 Loading client snapshot: ${clientFile}`);
  const clientRaw = JSON.parse(fs.readFileSync(clientFile, "utf8"));
  const clientSnap = normalizeSnapshot(clientRaw);
  const clientBlock = clientSnap.lastProcessedBlock;
  console.log(`   Client block: ${clientBlock}, rows: ${rowCount(clientSnap)}`);

  // 2. Fetch server v1 snapshot
  console.log(`🌐 Fetching server v1 snapshot from ${serverUrl}/snapshot ...`);
  const res = await fetch(`${serverUrl}/snapshot`);
  if (!res.ok) {
    console.error(`   ❌ Server responded with ${res.status}`);
    process.exit(1);
  }

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
  console.log(`   Server v1 block: ${serverBlock}, rows: ${rowCount(serverSnap)}`);

  // 3. Fetch server v2 snapshot (from chunks)
  console.log(`🌐 Fetching server v2 snapshot from ${serverUrl}/snapshot/manifest + chunks ...`);
  const v2Raw = await fetchV2Snapshot(serverUrl);
  const v2Snap = v2Raw ? normalizeSnapshot(v2Raw) : null;
  if (v2Snap) {
    console.log(`   Server v2 block: ${v2Snap.lastProcessedBlock}, rows: ${rowCount(v2Snap)}`);
  } else {
    console.log(`   Server v2: not available (no manifest or fetch failed)`);
  }

  // 4. Block mismatch warnings
  if (clientBlock !== serverBlock) {
    console.log("");
    console.warn(
      `⚠️  Block mismatch: client=${clientBlock}, server-v1=${serverBlock}`
    );
    console.warn(
      `   Differences may be due to block lag.`
    );
  }

  // 5. Client vs Server v1
  const clientHash = sha256(canonicalJson(clientSnap));
  const serverHash = sha256(canonicalJson(serverSnap));
  const clientContentHash = sha256(canonicalJson(tableContentOnly(clientSnap)));
  const serverContentHash = sha256(canonicalJson(tableContentOnly(serverSnap)));

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Client vs Server v1 (/snapshot)");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`🔑 Client hash: ${clientHash}`);
  console.log(`🔑 Server v1 hash: ${serverHash}`);

  const clientV1Same =
    clientHash === serverHash ||
    (ignoreBlockMismatch && clientContentHash === serverContentHash);
  if (clientV1Same) {
    console.log(`✅ Client vs Server v1: IDENTICAL`);
  } else {
    console.log("");
    const diffs = diffSnapshots("client-vs-v1", clientSnap, serverSnap, "client", "server-v1");
    console.log("");
    console.log(`Total differences (client vs v1): ${diffs}`);
  }

  // 6. Server v1 vs Server v2
  if (v2Snap) {
    const v2Hash = sha256(canonicalJson(v2Snap));
    const v2ContentHash = sha256(canonicalJson(tableContentOnly(v2Snap)));

    console.log("");
    console.log("═══════════════════════════════════════════════════════");
    console.log("  Server v1 (/snapshot) vs Server v2 (chunks)");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`🔑 Server v1 hash: ${serverHash}`);
    console.log(`🔑 Server v2 hash: ${v2Hash}`);

    const v1V2Same =
      serverHash === v2Hash ||
      (ignoreBlockMismatch && serverContentHash === v2ContentHash);
    if (v1V2Same) {
      console.log(`✅ Server v1 vs v2: IDENTICAL`);
    } else {
      console.log("");
      if (serverBlock !== v2Snap.lastProcessedBlock) {
        console.warn(
          `⚠️  Block mismatch: v1=${serverBlock}, v2=${v2Snap.lastProcessedBlock} (data may have changed between fetches)`
        );
      }
      const diffs = diffSnapshots("v1-vs-v2", serverSnap, v2Snap, "v1", "v2");
      console.log("");
      console.log(`Total differences (v1 vs v2): ${diffs}`);
    }

    // 7. Client vs Server v2
    const clientV2Hash = v2Hash;
    console.log("");
    console.log("═══════════════════════════════════════════════════════");
    console.log("  Client vs Server v2 (chunks)");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`🔑 Client hash: ${clientHash}`);
    console.log(`🔑 Server v2 hash: ${clientV2Hash}`);

    const clientV2Same =
      clientHash === clientV2Hash ||
      (ignoreBlockMismatch && clientContentHash === v2ContentHash);
    if (clientV2Same) {
      console.log(`✅ Client vs Server v2: IDENTICAL`);
    } else {
      console.log("");
      const diffs = diffSnapshots("client-vs-v2", clientSnap, v2Snap, "client", "server-v2");
      console.log("");
      console.log(`Total differences (client vs v2): ${diffs}`);
    }
  }

  console.log("");
  const allMatch =
    (ignoreBlockMismatch
      ? clientContentHash === serverContentHash
      : clientHash === serverHash) &&
    (!v2Snap ||
      (ignoreBlockMismatch
        ? serverContentHash === sha256(canonicalJson(tableContentOnly(v2Snap)))
        : serverHash === sha256(canonicalJson(v2Snap))));
  if (allMatch) {
    console.log("🎉 All snapshots are consistent!");
    process.exit(0);
  } else {
    console.log("⚠️  Some snapshots differ — see details above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
