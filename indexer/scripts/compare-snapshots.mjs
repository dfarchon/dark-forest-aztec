#!/usr/bin/env node
/**
 * compare-snapshots.mjs
 *
 * Compares a client-side snapshot JSON file against the indexer's live snapshot.
 *
 * Usage:
 *   node scripts/compare-snapshots.mjs <client-snapshot.json> [--indexer-url URL]
 *
 * The client snapshot file can be obtained from the browser console:
 *   dfDebug.downloadSnapshot()
 *
 * Examples:
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json
 *   node scripts/compare-snapshots.mjs client-snapshot-block-42.json --indexer-url http://localhost:3001
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
  let serverUrl =
    process.env.INDEXER_URL ??
    process.env.SERVER_URL ??
    "http://localhost:3001";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-h" || args[i] === "--help") {
      console.log(
        "Usage: node scripts/compare-snapshots.mjs <client-snapshot.json> [--indexer-url URL]",
      );
      console.log("");
      console.log("Get the client snapshot from browser console:");
      console.log("  dfDebug.downloadSnapshot()");
      process.exit(0);
    }
    if (
      (args[i] === "--indexer-url" || args[i] === "--server-url") &&
      args[i + 1]
    ) {
      serverUrl = args[i + 1];
      i++;
    } else if (args[i] === "--ignore-block-mismatch") {
      throw new Error(
        "--ignore-block-mismatch is unsafe: snapshots must have the same block and hash",
      );
    } else if (!args[i].startsWith("--")) {
      clientFile = args[i];
    }
  }

  if (!clientFile) {
    console.error(
      "Usage: node scripts/compare-snapshots.mjs <client-snapshot.json> [--indexer-url URL]",
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
    typeof value === "bigint" ? value.toString() : value,
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
// v3 immutable chunk helpers
// ---------------------------------------------------------------------------

/** Fetch one immutable publication and verify every chunk before comparing. */
async function fetchV3Snapshot(serverUrl) {
  const manifestRes = await fetch(`${serverUrl}/snapshot/v3/manifest`);
  if (!manifestRes.ok) return null;
  const manifest = await manifestRes.json();
  if (
    manifest.version !== 3 ||
    !manifest.snapshotId ||
    !Number.isSafeInteger(manifest.chunkRows) ||
    manifest.chunkRows <= 0
  ) {
    throw new Error("Invalid v3 manifest");
  }

  const snap = {
    lastProcessedBlock: manifest.lastProcessedBlock,
    lastProcessedBlockHash: manifest.lastProcessedBlockHash,
  };
  for (const table of TABLE_NAMES) {
    const info = manifest.tables[table];
    if (
      !info ||
      !Number.isSafeInteger(info.rowCount) ||
      info.rowCount < 0 ||
      !Array.isArray(info.hashes) ||
      info.hashes.length !== Math.ceil(info.rowCount / manifest.chunkRows)
    ) {
      throw new Error(`Invalid v3 manifest table ${table}`);
    }
    if (info.hashes.length === 0) {
      snap[table] = {};
      continue;
    }
    const merged = {};
    for (let i = 0; i < info.hashes.length; i++) {
      const chunkRes = await fetch(
        `${serverUrl}/snapshot/v3/chunks/${manifest.snapshotId}/${table}/${i}`,
      );
      if (!chunkRes.ok) {
        throw new Error(
          `Failed to fetch chunk ${table}/${i}: ${chunkRes.status}`,
        );
      }
      const bytes = Buffer.from(await chunkRes.arrayBuffer());
      if (sha256(bytes) !== info.hashes[i])
        throw new Error(`Chunk hash mismatch: ${table}/${i}`);
      const chunkJson = JSON.parse(bytes.toString("utf8"));
      if (
        chunkJson.snapshotId !== manifest.snapshotId ||
        chunkJson.table !== table ||
        chunkJson.chunkIndex !== i
      )
        throw new Error(`Chunk identity mismatch: ${table}/${i}`);
      for (const [id, row] of Object.entries(chunkJson.rows)) {
        if (Object.hasOwn(merged, id))
          throw new Error(`Duplicate row: ${table}:${id}`);
        merged[id] = row;
      }
    }
    if (Object.keys(merged).length !== info.rowCount)
      throw new Error(`Row count mismatch: ${table}`);
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
      `  ❌ ${table}: ${diffs} difference(s) (${nameA}=${aKeys.size}, ${nameB}=${bKeys.size})`,
    );

    if (missing.length > 0) {
      console.log(
        `     🔴 Missing on ${nameA} (${missing.length}): ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` ... +${missing.length - 5} more` : ""}`,
      );
    }
    if (extra.length > 0) {
      console.log(
        `     🟡 Extra on ${nameA} (${extra.length}): ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? ` ... +${extra.length - 5} more` : ""}`,
      );
    }
    if (different.length > 0) {
      console.log(
        `     🔵 Value mismatch (${different.length}): ${different.slice(0, 5).join(", ")}${different.length > 5 ? ` ... +${different.length - 5} more` : ""}`,
      );
      const firstKey = different[0];
      console.log(`        Example (${firstKey}):`);
      console.log(
        `          ${nameA}: ${JSON.stringify(aTable[firstKey]).slice(0, 200)}`,
      );
      console.log(
        `          ${nameB}: ${JSON.stringify(bTable[firstKey]).slice(0, 200)}`,
      );
    }
  }
  return totalDiffs;
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

  // 2. Fetch indexer v1 snapshot
  console.log(`🌐 Fetching indexer v1 snapshot from ${serverUrl}/snapshot ...`);
  const res = await fetch(`${serverUrl}/snapshot`);
  if (!res.ok) {
    console.error(`   ❌ Indexer responded with ${res.status}`);
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
  console.log(
    `   Indexer v1 block: ${serverBlock}, rows: ${rowCount(serverSnap)}`,
  );
  if (
    clientBlock !== serverBlock ||
    !clientRaw.lastProcessedBlockHash ||
    clientRaw.lastProcessedBlockHash !== serverJson.lastProcessedBlockHash
  ) {
    console.error(
      "Inconclusive: client and indexer snapshots must have the same block and block hash.",
    );
    process.exit(2);
  }

  // 3. Fetch one immutable v3 publication.
  console.log(
    `🌐 Fetching indexer v3 snapshot from ${serverUrl}/snapshot/v3/manifest + chunks ...`,
  );
  const v3Raw = await fetchV3Snapshot(serverUrl);
  const v3Snap =
    v3Raw &&
    v3Raw.lastProcessedBlock === serverBlock &&
    v3Raw.lastProcessedBlockHash === serverJson.lastProcessedBlockHash
      ? normalizeSnapshot(v3Raw)
      : null;
  if (v3Snap) {
    console.log(
      `   Indexer v3 block: ${v3Snap.lastProcessedBlock}, rows: ${rowCount(v3Snap)}`,
    );
  } else {
    console.log(`   Indexer v3: not available (no manifest or fetch failed)`);
  }

  // 4. Block mismatch warnings
  if (v3Raw && !v3Snap)
    console.warn(
      "Indexer v3 was fetched at a different block/hash; comparison skipped.",
    );

  // 5. Client vs Indexer v1
  const clientHash = sha256(canonicalJson(clientSnap));
  const serverHash = sha256(canonicalJson(serverSnap));

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Client vs Indexer v1 (/snapshot)");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`🔑 Client hash: ${clientHash}`);
  console.log(`🔑 Indexer v1 hash: ${serverHash}`);

  const clientV1Same = clientHash === serverHash;
  if (clientV1Same) {
    console.log(`✅ Client vs Indexer v1: IDENTICAL`);
  } else {
    console.log("");
    const diffs = diffSnapshots(
      "client-vs-v1",
      clientSnap,
      serverSnap,
      "client",
      "indexer-v1",
    );
    console.log("");
    console.log(`Total differences (client vs v1): ${diffs}`);
  }

  // 6. Indexer v1 vs Indexer v3
  if (v3Snap) {
    const v3Hash = sha256(canonicalJson(v3Snap));

    console.log("");
    console.log("═══════════════════════════════════════════════════════");
    console.log("  Indexer v1 (/snapshot) vs Indexer v3 (chunks)");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`🔑 Indexer v1 hash: ${serverHash}`);
    console.log(`🔑 Indexer v3 hash: ${v3Hash}`);

    const v1V3Same = serverHash === v3Hash;
    if (v1V3Same) {
      console.log(`✅ Indexer v1 vs v3: IDENTICAL`);
    } else {
      console.log("");
      const diffs = diffSnapshots("v1-vs-v3", serverSnap, v3Snap, "v1", "v3");
      console.log("");
      console.log(`Total differences (v1 vs v3): ${diffs}`);
    }

    // 7. Client vs Indexer v3
    console.log("");
    console.log("═══════════════════════════════════════════════════════");
    console.log("  Client vs Indexer v3 (chunks)");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`🔑 Client hash: ${clientHash}`);
    console.log(`🔑 Indexer v3 hash: ${v3Hash}`);

    const clientV3Same = clientHash === v3Hash;
    if (clientV3Same) {
      console.log(`✅ Client vs Indexer v3: IDENTICAL`);
    } else {
      console.log("");
      const diffs = diffSnapshots(
        "client-vs-v3",
        clientSnap,
        v3Snap,
        "client",
        "indexer-v3",
      );
      console.log("");
      console.log(`Total differences (client vs v3): ${diffs}`);
    }
  }

  console.log("");
  const allMatch =
    clientHash === serverHash &&
    (!v3Snap || serverHash === sha256(canonicalJson(v3Snap)));
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
