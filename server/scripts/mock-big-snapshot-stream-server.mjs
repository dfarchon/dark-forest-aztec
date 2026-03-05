import http from "node:http";

const HOST = process.env.MOCK_SNAPSHOT_HOST || "0.0.0.0";
const PORT = Number(process.env.MOCK_SNAPSHOT_PORT || 3901);
const TARGET_MB = Number(process.env.MOCK_SNAPSHOT_TARGET_MB || 300);
const TARGET_BYTES = TARGET_MB * 1024 * 1024;

const prefixObj = {
  lastProcessedBlock: 999999,
  world: {
    "0": {
      world_radius: 53000,
      block_number: 999999,
      mode: "mock-stream",
      blob: "",
    },
  },
  player: {},
  planet: {},
  planet_revealed_coords: {},
  planet_events: {},
  planet_artifacts: {},
  arrival: {},
  artifact: {},
  artifact_location: {},
};

const full = JSON.stringify(prefixObj);
const marker = '"blob":""';
const markerIdx = full.indexOf(marker);
if (markerIdx < 0) throw new Error("blob marker not found");

const prefix = full.slice(0, markerIdx + '"blob":"'.length);
const suffix = full.slice(markerIdx + '"blob":"'.length);
const fixedBytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
const blobBytes = TARGET_BYTES - fixedBytes;
if (blobBytes <= 0) throw new Error("TARGET_MB too small");

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function nextChunk(size, state) {
  let out = "";
  for (let i = 0; i < size; i += 1) {
    state.seed = (1664525 * state.seed + 1013904223) >>> 0;
    out += alphabet[state.seed % alphabet.length];
  }
  return out;
}

async function writeBigSnapshot(res) {
  const state = { seed: 0xdeadbeef };
  const chunkSize = 64 * 1024;
  let remaining = blobBytes;

  if (!res.write(prefix)) {
    await new Promise((resolve) => res.once("drain", resolve));
  }

  while (remaining > 0) {
    const n = Math.min(chunkSize, remaining);
    const chunk = nextChunk(n, state);
    remaining -= n;
    if (!res.write(chunk)) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  }

  res.end(suffix);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  if (url.startsWith("/health")) {
    const body = JSON.stringify({
      status: "ok",
      mode: "mock-big-snapshot-stream",
      blockNumber: 999999,
      snapshotBytes: TARGET_BYTES,
      gzipEnabled: false,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  if (url.startsWith("/blocks/latest")) {
    const body = JSON.stringify({
      blockNumber: 999999,
      snapshotBlock: 999999,
      snapshotBytes: TARGET_BYTES,
      snapshotEncoding: "identity",
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
    return;
  }

  if (url.startsWith("/snapshot")) {
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": String(TARGET_BYTES),
      "Cache-Control": "no-cache",
      "X-Snapshot-Block": "999999",
      "X-Snapshot-Uncompressed-Length": String(TARGET_BYTES),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers":
        "Content-Length,X-Snapshot-Block,X-Snapshot-Uncompressed-Length",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    await writeBigSnapshot(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-snapshot-stream] listening at http://${HOST}:${PORT}`);
  if (HOST === "0.0.0.0") {
    console.log(`[mock-snapshot-stream] also reachable via http://localhost:${PORT}`);
    console.log(
      `[mock-snapshot-stream] also reachable via http://127.0.0.1:${PORT}`
    );
  }
  console.log(`[mock-snapshot-stream] targetMB=${TARGET_MB} bytes=${TARGET_BYTES}`);
});
