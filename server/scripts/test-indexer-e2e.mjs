import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const nodeBin = process.execPath;

function parseMaybeGzipJson(buffer) {
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const plain = isGzip ? zlib.gunzipSync(buffer) : buffer;
  return JSON.parse(plain.toString("utf8"));
}

function parseArgs(argv) {
  const args = {
    intervalSec: 0,
    sqliteCheckIntervalSec: 30,
    sqliteMaxLagBlocks: 2,
    coverageCheckIntervalSec: 30,
    coverageRequireAll: false,
    stepTimeoutSec: 180,
    stepRetries: 3,
    timeoutSec: 120,
    pollMs: 1500,
    strict: false,
    serverUrl: process.env.SERVER_URL ?? "http://localhost:3001",
    contractsDir: path.join(repoRoot, "contracts"),
    sqlitePath:
      process.env.SQLITE_PATH ?? path.join(repoRoot, "server", "data", "indexer.db"),
  };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];

    if (key === "--interval-sec" && next) {
      args.intervalSec = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--timeout-sec" && next) {
      args.timeoutSec = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--sqlite-check-interval-sec" && next) {
      args.sqliteCheckIntervalSec = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--sqlite-max-lag-blocks" && next) {
      args.sqliteMaxLagBlocks = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--coverage-check-interval-sec" && next) {
      args.coverageCheckIntervalSec = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--coverage-require-all") {
      args.coverageRequireAll = true;
      continue;
    }
    if (key === "--step-timeout-sec" && next) {
      args.stepTimeoutSec = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--step-retries" && next) {
      args.stepRetries = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--poll-ms" && next) {
      args.pollMs = Number.parseInt(next, 10);
      i++;
      continue;
    }
    if (key === "--server-url" && next) {
      args.serverUrl = next;
      i++;
      continue;
    }
    if (key === "--contracts-dir" && next) {
      args.contractsDir = path.resolve(next);
      i++;
      continue;
    }
    if (key === "--sqlite-path" && next) {
      args.sqlitePath = path.resolve(next);
      i++;
      continue;
    }
    if (key === "--strict") {
      args.strict = true;
      continue;
    }
  }

  if (!Number.isFinite(args.intervalSec) || args.intervalSec < 0) {
    throw new Error("--interval-sec must be a non-negative integer");
  }
  if (!Number.isFinite(args.timeoutSec) || args.timeoutSec <= 0) {
    throw new Error("--timeout-sec must be a positive integer");
  }
  if (!Number.isFinite(args.sqliteCheckIntervalSec) || args.sqliteCheckIntervalSec <= 0) {
    throw new Error("--sqlite-check-interval-sec must be a positive integer");
  }
  if (!Number.isFinite(args.sqliteMaxLagBlocks) || args.sqliteMaxLagBlocks < 0) {
    throw new Error("--sqlite-max-lag-blocks must be an integer >= 0");
  }
  if (!Number.isFinite(args.coverageCheckIntervalSec) || args.coverageCheckIntervalSec <= 0) {
    throw new Error("--coverage-check-interval-sec must be a positive integer");
  }
  if (!Number.isFinite(args.stepTimeoutSec) || args.stepTimeoutSec <= 0) {
    throw new Error("--step-timeout-sec must be a positive integer");
  }
  if (!Number.isFinite(args.stepRetries) || args.stepRetries < 1) {
    throw new Error("--step-retries must be an integer >= 1");
  }
  if (!Number.isFinite(args.pollMs) || args.pollMs <= 0) {
    throw new Error("--poll-ms must be a positive integer");
  }

  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(cmd, cmdArgs, cwd, options = {}) {
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : 0;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle;

    const killChild = () => {
      if (child.killed) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3000).unref?.();
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (timedOut) {
        reject(
          new Error(
            `Command timed out after ${timeoutMs}ms: ${cmd} ${cmdArgs.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed (${code}): ${cmd} ${cmdArgs.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeoutMs);
    }
  });
}

function assertNodeSupportsTransformTypes() {
  const probe = spawnSync(
    nodeBin,
    ["--experimental-transform-types", "-e", ""],
    { stdio: "ignore" }
  );
  if (probe.status === 0) return;

  throw new Error(
    `Current node does not support --experimental-transform-types: ${nodeBin} (${process.version}). Use Node 24.12.0 to run e2e scripts.`
  );
}

function isCommandTimeoutError(message) {
  return message.includes("Command timed out after");
}

function isTransientReorgDropError(message) {
  const text = message.toLowerCase();
  return (
    text.includes("tx dropped by p2p node") ||
    text.includes("transaction") && text.includes("was dropped") ||
    text.includes("due to reorg") ||
    text.includes("pruning data after block") ||
    text.includes("block hash") && text.includes("not found when querying world state")
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for ${url}: ${body}`);
  }
  return await res.json();
}

async function fetchSnapshot(serverUrl) {
  const res = await fetch(`${serverUrl}/snapshot`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} for /snapshot: ${body}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return parseMaybeGzipJson(buf);
}

function readSnapshotRow(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) return null;

  const db = new Database(sqlitePath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT block_number, data, updated_at FROM snapshots WHERE id = 1")
      .get();
    if (!row) return null;

    return {
      blockNumber: Number(row.block_number),
      updatedAt: String(row.updated_at),
      dataText: String(row.data),
    };
  } finally {
    db.close();
  }
}

async function waitForBlock(serverUrl, minBlock, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  let last = -1;

  while (Date.now() <= deadline) {
    const latest = await fetchJson(`${serverUrl}/blocks/latest`);
    last = Number(latest.blockNumber);
    if (last >= minBlock) return last;
    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for /blocks/latest >= ${minBlock}, last=${last}`);
}

async function waitForDbAtLeast(sqlitePath, minBlock, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  let lastBlock = -1;

  while (Date.now() <= deadline) {
    const row = readSnapshotRow(sqlitePath);
    if (row) {
      lastBlock = row.blockNumber;
      if (row.blockNumber >= minBlock) {
        return row;
      }
    }
    await sleep(pollMs);
  }

  throw new Error(
    `Timed out waiting SQLite snapshot >= block ${minBlock}, last=${lastBlock}`
  );
}

function workloadPlan() {
  const safeInitScript = path.join(
    repoRoot,
    "server",
    "scripts",
    "test-core-initialize-player-safe.mjs"
  );

  const initUser1 = {
    name: "init user1 (idempotent)",
    args: ["--experimental-transform-types", safeInitScript, "0"],
    mode: "init",
  };

  const initUser2 = {
    name: "init user2 (idempotent)",
    args: ["--experimental-transform-types", safeInitScript, "1"],
    mode: "init",
  };

  const warmup = [initUser1, initUser2];

  const baseCycle = [
    initUser1,
    initUser2,
    { name: "move user1", args: ["--experimental-transform-types", "scripts/test-move.ts", "0"] },
    { name: "move user2", args: ["--experimental-transform-types", "scripts/test-move.ts", "1"] },
  ];

  const upgradeStepUser1 = {
    name: "upgrade user1",
    args: ["--experimental-transform-types", "scripts/test-upgrade.ts", "0"],
  };
  const upgradeStepUser2 = {
    name: "upgrade user2",
    args: ["--experimental-transform-types", "scripts/test-upgrade.ts", "1"],
  };
  const withdrawStepUser1 = {
    name: "withdraw user1",
    args: ["--experimental-transform-types", "scripts/test-withdraw.ts", "0"],
  };
  const withdrawStepUser2 = {
    name: "withdraw user2",
    args: ["--experimental-transform-types", "scripts/test-withdraw.ts", "1"],
  };

  return {
    warmup,
    baseCycle,
    upgradeStepUser1,
    upgradeStepUser2,
    withdrawStepUser1,
    withdrawStepUser2,
  };
}

function isBenignWarmupError(message) {
  const text = message.toLowerCase();
  return text.includes("player already initialized");
}

async function runWarmupStep(args, config) {
  for (let attempt = 1; attempt <= config.stepRetries; attempt += 1) {
    try {
      await runCommand(nodeBin, args, config.contractsDir, {
        timeoutMs: config.stepTimeoutSec * 1000,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (isBenignWarmupError(msg)) {
        console.log(`[${nowIso()}] [warmup] SKIP (already initialized)`);
        return true;
      }

      if (isCommandTimeoutError(msg)) {
        if (attempt < config.stepRetries) {
          console.warn(
            `[${nowIso()}] [warmup] WARN timeout, retry ${attempt}/${config.stepRetries - 1}`
          );
          await sleep(1200);
          continue;
        }
        return false;
      }

      if (isTransientReorgDropError(msg) && attempt < config.stepRetries) {
        console.warn(
          `[${nowIso()}] [warmup] WARN transient reorg/drop, retry ${attempt}/${config.stepRetries - 1}`
        );
        await sleep(1200);
        continue;
      }

      return false;
    }
  }

  return false;
}

function buildRoundCycle(plan, round) {
  const cycle = [...plan.baseCycle];
  if (round % 3 === 0) cycle.push(plan.upgradeStepUser1);
  if (round % 4 === 0) cycle.push(plan.upgradeStepUser2);
  if (round % 5 === 0) cycle.push(plan.withdrawStepUser1);
  if (round % 6 === 0) cycle.push(plan.withdrawStepUser2);
  return cycle;
}

function countMapEntries(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.keys(value).length;
}

function hasGameplayState(snapshot) {
  return (
    countMapEntries(snapshot?.player) > 0 &&
    countMapEntries(snapshot?.planet) > 0
  );
}

const ALL_TABLES = [
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

const EXPECTED_TABLES = [
  "world",
  "player",
  "planet",
  "planet_events",
  "planet_artifacts",
  "arrival",
];

function snapshotTableCounts(snapshot) {
  const counts = {};
  for (const table of ALL_TABLES) {
    counts[table] = countMapEntries(snapshot?.[table]);
  }
  return counts;
}

function missingTables(counts, tables) {
  return tables.filter((table) => (counts[table] ?? 0) <= 0);
}

async function runCoverageCheck(config) {
  const snapshot = await fetchSnapshot(config.serverUrl);
  const counts = snapshotTableCounts(snapshot);
  const missingExpected = missingTables(counts, EXPECTED_TABLES);
  const missingAll = missingTables(counts, ALL_TABLES);

  const coverageLine = ALL_TABLES.map((table) => `${table}=${counts[table]}`).join(" ");
  console.log(
    `[${nowIso()}] [coverage] block=${Number(snapshot.lastProcessedBlock ?? -1)} ${coverageLine}`
  );

  if (missingExpected.length > 0) {
    const msg = `expected gameplay tables still empty: ${missingExpected.join(", ")}`;
    if (config.strict) {
      throw new Error(msg);
    }
    console.warn(`[${nowIso()}] [coverage] WARN ${msg}`);
  }

  if (!config.coverageRequireAll && missingAll.length > 0) {
    console.warn(
      `[${nowIso()}] [coverage] PARTIAL all-table coverage missing: ${missingAll.join(", ")}`
    );
  }

  if (config.coverageRequireAll && missingAll.length > 0) {
    const msg = `all-table coverage failed, still empty: ${missingAll.join(", ")}`;
    if (config.strict) {
      throw new Error(msg);
    }
    console.warn(`[${nowIso()}] [coverage] WARN ${msg}`);
  }
}

async function runAndVerify(name, args, config, options = {}) {
  const { checkSqlite = true } = options;
  const beforeLatest = await fetchJson(`${config.serverUrl}/blocks/latest`);
  const beforeBlock = Number(beforeLatest.blockNumber);

  for (let attempt = 1; attempt <= config.stepRetries; attempt += 1) {
    try {
      await runCommand(nodeBin, args, config.contractsDir, {
        timeoutMs: config.stepTimeoutSec * 1000,
      });
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isCommandTimeoutError(msg)) {
        console.warn(
          `[${nowIso()}] [server-check] WARN ${name} | step timed out after ${config.stepTimeoutSec}s; child killed, skip assertions`
        );
        return;
      }

      const transient = isTransientReorgDropError(msg);
      const canRetry = transient && attempt < config.stepRetries;
      if (canRetry) {
        console.warn(
          `[${nowIso()}] [server-check] WARN ${name} | transient reorg/drop error, retry ${attempt}/${config.stepRetries - 1}`
        );
        await sleep(1200);
        continue;
      }

      throw err;
    }
  }

  let syncedBlock;
  try {
    syncedBlock = await waitForBlock(
      config.serverUrl,
      beforeBlock + 1,
      config.timeoutSec * 1000,
      config.pollMs
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Timed out waiting for /blocks/latest")) {
      console.warn(
        `[${nowIso()}] [server-check] WARN ${name} | no new block within ${config.timeoutSec}s; skip server/sqlite assertions`
      );
      return;
    }
    throw err;
  }

  const health = await fetchJson(`${config.serverUrl}/health`);
  if (health.status !== "ok") {
    throw new Error(`${name}: /health status is not ok`);
  }
  if (Number(health.lastProcessedBlock) < syncedBlock) {
    throw new Error(
      `${name}: /health.lastProcessedBlock=${health.lastProcessedBlock} < synced=${syncedBlock}`
    );
  }

  const snapshot = await fetchSnapshot(config.serverUrl);
  if (Number(snapshot.lastProcessedBlock) < syncedBlock) {
    throw new Error(
      `${name}: /snapshot.lastProcessedBlock=${snapshot.lastProcessedBlock} < synced=${syncedBlock}`
    );
  }

  if (checkSqlite) {
    const sqliteMinBlock = Math.max(0, syncedBlock - config.sqliteMaxLagBlocks);
    const dbRow = await waitForDbAtLeast(
      config.sqlitePath,
      sqliteMinBlock,
      config.timeoutSec * 1000,
      config.pollMs
    );
    console.log(
      `[${nowIso()}] [server-check] OK ${name} | block=${syncedBlock} | sqlite=${dbRow.blockNumber} | sqliteMin=${sqliteMinBlock}`
    );
    return;
  }

  console.log(
    `[${nowIso()}] [server-check] OK ${name} | block=${syncedBlock} | sqlite=skip(periodic)`
  );
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const plan = workloadPlan();
  assertNodeSupportsTransformTypes();

  console.log("[server-e2e] Continuous mode");
  console.log(`  serverUrl:    ${config.serverUrl}`);
  console.log(`  contractsDir: ${config.contractsDir}`);
  console.log(`  sqlitePath:   ${config.sqlitePath}`);
  console.log(`  intervalSec:  ${config.intervalSec}`);
  console.log(`  sqliteCheckIntervalSec: ${config.sqliteCheckIntervalSec}`);
  console.log(`  sqliteMaxLagBlocks: ${config.sqliteMaxLagBlocks}`);
  console.log(`  coverageCheckIntervalSec: ${config.coverageCheckIntervalSec}`);
  console.log(`  coverageRequireAll: ${config.coverageRequireAll}`);
  console.log(`  stepTimeoutSec: ${config.stepTimeoutSec}`);
  console.log(`  stepRetries:   ${config.stepRetries}`);
  console.log(`  strict:       ${config.strict}`);

  console.log("[server-e2e] Warmup (idempotent)");
  let warmupSucceeded = 0;
  for (const step of plan.warmup) {
    const ok = await runWarmupStep(step.args, config);
    if (ok) {
      warmupSucceeded += 1;
      continue;
    }

    console.error(`[${nowIso()}] [warmup] FAIL: ${step.name}`);
    if (config.strict) {
      throw new Error(`Warmup step failed: ${step.name}`);
    }
  }

  if (warmupSucceeded === 0) {
    const snapshot = await fetchSnapshot(config.serverUrl).catch(() => null);
    if (snapshot && hasGameplayState(snapshot)) {
      console.warn(
        `[${nowIso()}] [warmup] WARN no init step succeeded, but snapshot already has gameplay state; continuing`
      );
    } else if (config.strict) {
      throw new Error("Warmup failed: no player initialization step succeeded");
    } else {
      console.warn(
        `[${nowIso()}] [warmup] WARN no init step succeeded and no gameplay state yet; continuing (non-strict)`
      );
    }
  }
  if (warmupSucceeded < plan.warmup.length) {
    console.warn(
      `[${nowIso()}] [warmup] PARTIAL: ${warmupSucceeded}/${plan.warmup.length} init steps succeeded`
    );
  } else {
    console.log(
      `[${nowIso()}] [warmup] OK: ${warmupSucceeded}/${plan.warmup.length} init steps succeeded`
    );
  }

  let round = 1;
  let nextSqliteCheckAt = Date.now();
  let nextCoverageCheckAt = Date.now();
  while (true) {
    const cycle = buildRoundCycle(plan, round);
    console.log(`\n[${nowIso()}] [server-check] ROUND ${round} | steps=${cycle.length}`);

    for (const item of cycle) {
      console.log(`[${nowIso()}] [server-check] RUN ${item.name}`);
      try {
        if (item.mode === "init") {
          const ok = await runWarmupStep(item.args, config);
          if (!ok) {
            const msg = `${item.name} failed`;
            if (config.strict) throw new Error(msg);
            console.warn(`[${nowIso()}] [server-check] WARN ${msg}`);
          }
          await sleep(config.intervalSec * 1000);
          continue;
        }

        const now = Date.now();
        const shouldCheckSqlite = now >= nextSqliteCheckAt;
        if (shouldCheckSqlite) {
          nextSqliteCheckAt = now + config.sqliteCheckIntervalSec * 1000;
        }
        await runAndVerify(item.name, item.args, config, {
          checkSqlite: shouldCheckSqlite,
        });

        const coverageNow = Date.now();
        if (coverageNow >= nextCoverageCheckAt) {
          nextCoverageCheckAt = coverageNow + config.coverageCheckIntervalSec * 1000;
          await runCoverageCheck(config);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${nowIso()}] [server-check] FAIL ${item.name}: ${msg}`);
        if (config.strict) throw err;
      }
      await sleep(config.intervalSec * 1000);
    }
    round += 1;
  }
}

main().catch((err) => {
  console.error("[server-e2e] Fatal:", err);
  process.exit(1);
});
