import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";

import { loadConfig, parseAnalyticsConfig } from "../config/config.ts";
import { copyDeployments, type StorageAddresses } from "../config/deployment.ts";
import { blockTip, inspectIntegrity, openDatabase } from "../sync/db.ts";
import { classifyEvents, deriveRange } from "../sync/derive.ts";
import type { ChainBlock, ChainLog, ChainSource } from "../sync/model.ts";
import { overviewReport, playerReport } from "../analysis/reports.ts";
import { collectStatus } from "../sync/status.ts";
import { writeChunk, type StoredEvent } from "../sync/store.ts";
import { sync } from "../sync/sync.ts";
import { zeroState, type EventTableName, type SqlValue } from "../sync/tables.ts";

const DEPLOYMENT_ID = "20261107T090000Z-ab12";

function storageAddresses(): StorageAddresses {
  const address = AztecAddress.ZERO.toString();
  return {
    world: address,
    player: address,
    planet: address,
    planetRevealedCoords: address,
    planetEvents: address,
    planetArtifacts: address,
    arrival: address,
    artifact: address,
    artifactLocation: address,
  };
}

const STORAGE_NAMES = [
  ["world", "WorldStorage"],
  ["player", "PlayerStorage"],
  ["planet", "PlanetStorage"],
  ["planetRevealedCoords", "PlanetRevealedCoordsStorage"],
  ["planetEvents", "PlanetEventsStorage"],
  ["planetArtifacts", "PlanetArtifactsStorage"],
  ["arrival", "ArrivalStorage"],
  ["artifact", "ArtifactStorage"],
  ["artifactLocation", "ArtifactLocationStorage"],
] as const;

function writeManifest(
  root: string,
  deployment: ReturnType<typeof sampleDeployment>,
): void {
  const dir = path.join(root, "deployments", deployment.network, deployment.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      id: deployment.id,
      network: deployment.network,
      startBlock: deployment.startBlock,
      status: "complete",
      contracts: STORAGE_NAMES.map(([key, name]) => ({
        name,
        status: "deployed",
        address: deployment.addresses[key],
      })),
    }),
  );
  fs.writeFileSync(
    path.join(root, "deployments", deployment.network, "latest"),
    `${deployment.id}\n`,
  );
}

function sampleDeployment(network: string) {
  return {
    id: DEPLOYMENT_ID,
    network,
    startBlock: 40,
    addresses: storageAddresses(),
  };
}

function tempDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-analytics-"));
  return path.join(dir, "events.db");
}

function state(
  table: EventTableName,
  overrides: Record<string, SqlValue>,
): Record<string, SqlValue> {
  return { ...zeroState(table), ...overrides };
}

function chainLog(
  table: EventTableName,
  overrides: Partial<Omit<ChainLog, "state" | "table">> & {
    state?: Record<string, SqlValue>;
  } = {},
): ChainLog {
  const { state: stateOverrides, ...rest } = overrides;
  return {
    table,
    blockNumber: 1,
    blockHash: "hash-1",
    blockTimestamp: 1_700_000_000,
    txHash: "0xaaa",
    txIndex: 0,
    logIndex: 0,
    id: "id",
    ...rest,
    state: state(table, stateOverrides ?? {}),
  };
}

class MemorySource implements ChainSource {
  proven = 1;
  proposed = 2;
  headers = new Map<number, ChainBlock>();
  entries: ChainLog[] = [];

  provenTip(): Promise<number> {
    return Promise.resolve(this.proven);
  }
  proposedTip(): Promise<number> {
    return Promise.resolve(this.proposed);
  }
  block(number: number): Promise<ChainBlock | undefined> {
    return Promise.resolve(this.headers.get(number));
  }
  logs(
    from: number,
    toInclusive: number,
    anchor: ChainBlock,
  ): Promise<ChainLog[]> {
    const header = this.headers.get(anchor.number);
    if (!header || header.hash !== anchor.hash) {
      return Promise.reject(new Error("anchor hash mismatch"));
    }
    return Promise.resolve(
      this.entries.filter(
        (entry) =>
          entry.blockNumber >= from && entry.blockNumber <= toInclusive,
      ),
    );
  }
}

test("sync stores every proven block and resumes at the local tip", async () => {
  const db = openDatabase(tempDb());
  const source = new MemorySource();
  source.proven = 2;
  source.proposed = 4;
  source.headers.set(1, { number: 1, hash: "hash-1", timestamp: 1_000 });
  source.headers.set(2, { number: 2, hash: "hash-2", timestamp: 2_000 });
  source.entries.push(
    chainLog("player_update", {
      blockNumber: 2,
      blockHash: "hash-2",
      blockTimestamp: 2_000,
      id: "0xABC",
      state: state("player_update", {
        init_timestamp: 2_000,
        home_planet_id: "home",
        last_updated: 2_000,
      }),
    }),
  );

  await sync({ db, source, startBlock: 1, log: () => {} });
  assert.equal(blockTip(db)?.number, 2);
  assert.equal(blockTip(db)?.hash, "hash-2");
  const blocks = db.prepare(`SELECT COUNT(*) AS count FROM blocks`).get() as {
    count: number;
  };
  assert.equal(blocks.count, 2);
  const player = db
    .prepare(`SELECT id, init_timestamp FROM player_update`)
    .get() as { id: string; init_timestamp: number };
  assert.equal(player.id, "0xABC");
  const action = db
    .prepare(`SELECT player, action, subject, timestamp FROM actions`)
    .get() as {
    player: string;
    action: string;
    subject: string;
    timestamp: number;
  };
  assert.deepEqual(action, {
    player: "0xabc",
    action: "initialize_player",
    subject: "home",
    timestamp: 2_000,
  });

  await sync({ db, source, startBlock: 1, log: () => {} });
  assert.equal(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM blocks`).get() as {
        count: number;
      }
    ).count,
    2,
  );
  db.close();
});

test("sync refuses a batch when a block has no hash and writes nothing", async () => {
  const db = openDatabase(tempDb());
  const source = new MemorySource();
  source.proven = 2;
  source.headers.set(1, { number: 1, hash: "hash-1", timestamp: 1_000 });
  await assert.rejects(
    sync({ db, source, startBlock: 1, log: () => {} }),
    /has no hash/,
  );
  assert.equal(blockTip(db), undefined);
  db.close();
});

test("sync rewinds to the last matching hash and replaces the forked blocks", async () => {
  const db = openDatabase(tempDb());
  const source = new MemorySource();
  source.proven = 2;
  source.headers.set(1, { number: 1, hash: "hash-1", timestamp: 1_000 });
  source.headers.set(2, { number: 2, hash: "hash-2", timestamp: 2_000 });
  source.entries.push(
    chainLog("player_update", {
      blockNumber: 2,
      blockHash: "hash-2",
      id: "0xabc",
      state: state("player_update", {
        init_timestamp: 2_000,
        last_updated: 2_000,
      }),
    }),
  );
  await sync({ db, source, startBlock: 1, log: () => {} });

  source.headers.set(2, { number: 2, hash: "hash-2b", timestamp: 2_100 });
  source.entries = [
    chainLog("player_update", {
      blockNumber: 2,
      blockHash: "hash-2b",
      blockTimestamp: 2_100,
      id: "0xdef",
      state: state("player_update", {
        init_timestamp: 2_100,
        last_updated: 2_100,
      }),
    }),
  ];
  await sync({ db, source, startBlock: 1, log: () => {} });

  assert.equal(blockTip(db)?.hash, "hash-2b");
  const ids = db
    .prepare(`SELECT id FROM player_update ORDER BY id`)
    .all() as Array<{ id: string }>;
  assert.deepEqual(
    ids.map((row) => row.id),
    ["0xdef"],
  );
  const players = db.prepare(`SELECT player FROM actions`).all() as Array<{
    player: string;
  }>;
  assert.deepEqual(
    players.map((row) => row.player),
    ["0xdef"],
  );
  db.close();
});

test("sync pauses when the local tip hash is unavailable", async () => {
  const db = openDatabase(tempDb());
  db.prepare(
    `INSERT INTO blocks (number, hash, timestamp, derived) VALUES (1, 'hash-1', 1, 1)`,
  ).run();
  const source = new MemorySource();
  source.proven = 1;
  await assert.rejects(
    sync({ db, source, startBlock: 1, log: () => {} }),
    /hash unavailable/,
  );
  assert.equal(blockTip(db)?.hash, "hash-1");
  db.close();
});

test("sync refuses to append across a hole in local blocks", async () => {
  const db = openDatabase(tempDb());
  db.prepare(
    `INSERT INTO blocks (number, hash, timestamp, derived) VALUES (1, 'a', 1, 1), (3, 'c', 3, 1)`,
  ).run();
  const source = new MemorySource();
  source.proven = 4;
  source.headers.set(3, { number: 3, hash: "c", timestamp: 3 });
  source.headers.set(4, { number: 4, hash: "d", timestamp: 4 });
  await assert.rejects(
    sync({ db, source, startBlock: 1, log: () => {} }),
    /gaps/,
  );
  assert.equal(inspectIntegrity(db, 1).contiguous, false);
  db.close();
});

test("status reports proven lag and a reorg without writing", async () => {
  const db = openDatabase(tempDb());
  db.prepare(
    `INSERT INTO blocks (number, hash, timestamp, derived) VALUES (5, 'old', 50, 1)`,
  ).run();
  const source = new MemorySource();
  source.proven = 8;
  source.proposed = 9;
  source.headers.set(5, { number: 5, hash: "new", timestamp: 50 });
  source.headers.set(8, { number: 8, hash: "tip", timestamp: 80 });
  const report = await collectStatus(db, source, 1);
  assert.equal(report.localBlock, 5);
  assert.equal(report.provenTip, 8);
  assert.equal(report.proposedTip, 9);
  assert.equal(report.behind, 3);
  assert.equal(report.continuity, "reorg");
  assert.equal(blockTip(db)?.hash, "old");
  db.close();
});

test("derive turns moves, finds, and silver drops into actions", () => {
  const db = openDatabase(tempDb());
  const player = "0xabc";
  writeChunk(
    db,
    [
      { number: 1, hash: "b1", timestamp: 10_000 },
      { number: 2, hash: "b2", timestamp: 20_000 },
      { number: 3, hash: "b3", timestamp: 3_600_100 },
      { number: 4, hash: "b4", timestamp: 7_200_100 },
    ],
    [
      chainLog("planet_update", {
        blockNumber: 1,
        blockHash: "b1",
        blockTimestamp: 10_000,
        id: "planet",
        state: state("planet_update", { owner: player, silver: "100" }),
      }),
      chainLog("player_update", {
        blockNumber: 2,
        blockHash: "b2",
        blockTimestamp: 20_000,
        txHash: "0xfind",
        id: player,
        state: state("player_update", {
          init_timestamp: 20_000,
          score: "5",
          last_updated: 20_000,
        }),
      }),
      chainLog("artifact_update", {
        blockNumber: 2,
        blockHash: "b2",
        blockTimestamp: 20_000,
        txHash: "0xfind",
        txIndex: 0,
        logIndex: 1,
        id: "art-1",
        state: state("artifact_update", {
          discoverer: player,
          minted_at_timestamp: 20_000,
          controller: player,
        }),
      }),
      chainLog("artifact_update", {
        blockNumber: 2,
        blockHash: "b2",
        blockTimestamp: 20_000,
        txHash: "0xadmin",
        txIndex: 1,
        logIndex: 0,
        id: "art-admin",
        state: state("artifact_update", {
          discoverer: player,
          minted_at_timestamp: 20_000,
        }),
      }),
      chainLog("arrival_update", {
        blockNumber: 3,
        blockHash: "b3",
        blockTimestamp: 3_600_100,
        txHash: "0xmove",
        id: "voyage-1",
        state: state("arrival_update", {
          player,
          from_planet: "planet",
          to_planet: "other",
          silver_moved: "10",
          departure_time: 3_600_100,
        }),
      }),
      chainLog("planet_update", {
        blockNumber: 3,
        blockHash: "b3",
        blockTimestamp: 3_600_100,
        txHash: "0xmove",
        logIndex: 1,
        id: "planet",
        state: state("planet_update", {
          owner: player,
          silver: "90",
          last_updated: 3_600_100,
        }),
      }),
      chainLog("planet_update", {
        blockNumber: 4,
        blockHash: "b4",
        blockTimestamp: 7_200_100,
        txHash: "0xwithdraw",
        id: "planet",
        state: state("planet_update", {
          owner: player,
          silver: "40",
          last_updated: 7_200_100,
        }),
      }),
    ],
  );

  const count = deriveRange(db, 1, 4);
  assert.equal(count, 4);
  const actions = db
    .prepare(
      `SELECT block_number, action, quantity, ambiguous FROM actions ORDER BY block_number, action`,
    )
    .all() as Array<{
    block_number: number;
    action: string;
    quantity: string | null;
    ambiguous: number;
  }>;
  assert.deepEqual(actions, [
    { block_number: 2, action: "find_artifact", quantity: null, ambiguous: 0 },
    {
      block_number: 2,
      action: "initialize_player",
      quantity: null,
      ambiguous: 0,
    },
    { block_number: 3, action: "move", quantity: "10", ambiguous: 0 },
    {
      block_number: 4,
      action: "withdraw_silver",
      quantity: "50",
      ambiguous: 0,
    },
  ]);

  const hourly = playerReport(db, "0xABC");
  assert.equal(hourly.joinedAt, 20_000);
  assert.deepEqual(
    hourly.hourly.map((row) => row.count),
    [2, 1, 1],
  );
  const overview = overviewReport(db, 3, 4);
  assert.equal(overview.players, 1);
  assert.deepEqual(overview.rangeCounts, [
    { action: "move", count: 1 },
    { action: "withdraw_silver", count: 1 },
  ]);
  assert.equal(overview.withdrawSilver, "50");
  assert.equal(overview.perPlayer[0]?.operations, 4);
  db.close();
});

test("a move and a withdraw in one unseparated block marks the withdraw ambiguous", () => {
  const planet = {
    ...zeroState("planet_update"),
    owner: "0xabc",
    silver: "100",
  };
  const events: StoredEvent[] = [
    {
      table: "planet_update",
      blockNumber: 5,
      blockTimestamp: 9_000,
      txHash: null,
      txIndex: -1,
      logIndex: 0,
      id: "planet",
      state: planet,
    },
    {
      table: "arrival_update",
      blockNumber: 6,
      blockTimestamp: 9_100,
      txHash: null,
      txIndex: -1,
      logIndex: 1,
      id: "voyage",
      state: state("arrival_update", {
        player: "0xabc",
        from_planet: "planet",
        silver_moved: "5",
        departure_time: 9_100,
      }),
    },
    {
      table: "planet_update",
      blockNumber: 6,
      blockTimestamp: 9_100,
      txHash: null,
      txIndex: -1,
      logIndex: 2,
      id: "planet",
      state: { ...planet, silver: "70", last_updated: 9_100 },
    },
  ];
  const actions = classifyEvents(events, {
    arrivals: new Set(),
    artifacts: new Set(),
    revealed: new Set(),
    players: new Map(),
    planets: new Map(),
    artifactStates: new Map(),
    locations: new Map(),
  });
  const withdraw = actions.find((row) => row.action === "withdraw_silver");
  const move = actions.find((row) => row.action === "move");
  assert.ok(move);
  assert.equal(withdraw?.ambiguous, 1);
  assert.equal(withdraw?.quantity, "30");
});

test("parseAnalyticsConfig requires a node URL and keeps each deployment in its own database", () => {
  const deployment = sampleDeployment("testnet");
  assert.throws(
    () =>
      parseAnalyticsConfig({
        network: "testnet",
        values: { AZTEC_NODE_URL: "" },
        deployment,
      }),
    /AZTEC_NODE_URL/,
  );
  assert.throws(
    () =>
      parseAnalyticsConfig({
        network: "testnet",
        values: { AZTEC_NODE_URL: "not a url" },
        deployment,
      }),
    /AZTEC_NODE_URL/,
  );
  const config = parseAnalyticsConfig({
    network: "testnet",
    values: { AZTEC_NODE_URL: "http://localhost:8080/" },
    deployment,
    packageRoot: "/tmp/analytics",
  });
  assert.equal(config.network, "testnet");
  assert.equal(config.deploymentId, DEPLOYMENT_ID);
  assert.equal(config.startBlock, 40);
  assert.equal(config.nodeUrl, "http://localhost:8080");
  assert.equal(
    config.dbPath,
    path.join("/tmp/analytics", "data", "testnet", DEPLOYMENT_ID, "events.db"),
  );
});

test("loadConfig reads the imported deployment for the selected network", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-analytics-env-"));
  fs.mkdirSync(path.join(root, "networks"));
  fs.writeFileSync(path.join(root, ".env"), "AZTEC_NETWORK=local\n");
  fs.writeFileSync(
    path.join(root, "networks", "local.env"),
    "AZTEC_NODE_URL=http://127.0.0.1:8080\n",
  );
  fs.writeFileSync(
    path.join(root, "networks", "testnet.env"),
    "AZTEC_NODE_URL=https://rpc.example\n",
  );
  const localDeployment = sampleDeployment("local");
  const testnetDeployment = {
    ...sampleDeployment("testnet"),
    id: "20261107T100000Z-cd34",
    startBlock: 80,
  };
  for (const deployment of [localDeployment, testnetDeployment]) {
    writeManifest(root, deployment);
  }

  const local = loadConfig({}, root);
  assert.equal(local.network, "local");
  assert.equal(local.deploymentId, DEPLOYMENT_ID);
  assert.equal(local.nodeUrl, "http://127.0.0.1:8080");
  assert.equal(local.startBlock, 40);

  const testnet = loadConfig({ AZTEC_NETWORK: "testnet" }, root);
  assert.equal(testnet.network, "testnet");
  assert.equal(testnet.deploymentId, "20261107T100000Z-cd34");
  assert.equal(testnet.nodeUrl, "https://rpc.example");
  assert.equal(testnet.startBlock, 80);
  assert.equal(
    testnet.dbPath,
    path.join(root, "data", "testnet", testnet.deploymentId, "events.db"),
  );
});

test("import copies contracts/deployments and sync reads that manifest", () => {
  const analyticsRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-analytics-import-"),
  );
  const contractsRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dfpunk-contracts-import-"),
  );
  fs.mkdirSync(path.join(analyticsRoot, "networks"));
  fs.writeFileSync(path.join(analyticsRoot, ".env"), "AZTEC_NETWORK=testnet\n");
  fs.writeFileSync(
    path.join(analyticsRoot, "networks", "testnet.env"),
    "AZTEC_NODE_URL=https://rpc.example\n",
  );
  const first = sampleDeployment("testnet");
  const second = {
    ...sampleDeployment("testnet"),
    id: "20261107T100000Z-cd34",
    startBlock: 22,
  };
  writeManifest(contractsRoot, first);
  writeManifest(contractsRoot, second);
  fs.writeFileSync(
    path.join(contractsRoot, "deployments", "testnet", "note.txt"),
    "kept\n",
  );

  const networks = copyDeployments(contractsRoot, analyticsRoot);
  assert.equal(networks, 1);
  assert.equal(
    fs
      .readFileSync(
        path.join(analyticsRoot, "deployments", "testnet", "latest"),
        "utf8",
      )
      .trim(),
    second.id,
  );
  assert.equal(
    fs.readFileSync(
      path.join(analyticsRoot, "deployments", "testnet", "note.txt"),
      "utf8",
    ),
    "kept\n",
  );

  const config = loadConfig({}, analyticsRoot);
  assert.equal(config.deploymentId, second.id);
  assert.equal(config.startBlock, 22);
  assert.equal(config.nodeUrl, "https://rpc.example");
  assert.equal(config.addresses.player, second.addresses.player);
});

test("analytics network files reject contract account keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-analytics-keys-"));
  fs.mkdirSync(path.join(root, "networks"));
  fs.writeFileSync(path.join(root, ".env"), "AZTEC_NETWORK=mainnet\n");
  fs.writeFileSync(
    path.join(root, "networks", "mainnet.env"),
    "AZTEC_NODE_URL=https://rpc.example\nACCOUNT_SECRET_KEY=0xabc\n",
  );
  assert.throws(() => loadConfig({}, root), /ACCOUNT_SECRET_KEY/);
});
