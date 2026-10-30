/**
 * Regression tests for IndexerService sync correctness:
 * - initial sync errors propagate (no silent "ready" with incomplete state)
 * - chunk application is atomic (a bad row never leaves partial cross-table state)
 * - a failed sync resumes from the last fully committed chunk
 */

import assert from "node:assert/strict";
import test from "node:test";

import { IndexerService } from "./IndexerService.ts";
import { normalizeSnapshot, rawToState } from "./convert.ts";
import type {
  BlockUpdates,
  IBlockEventSource,
  IndexerSnapshot,
  PublicEventBatchCounts,
  TableUpdate,
} from "./types.ts";

type Raw = Record<string, unknown>;

function planetEventsUpdate(id: string, eventId: string): TableUpdate<Raw> {
  return {
    table: "planet_events",
    id,
    state: {
      events: [{ id: eventId }],
      count: 1,
      last_updated: 10n,
    },
  };
}

function arrivalUpdate(id: string, overrides: Raw = {}): TableUpdate<Raw> {
  return {
    table: "arrival",
    id,
    state: {
      id,
      player: "0xp1",
      from_planet: "0xa",
      to_planet: "0xb",
      pop_arriving: 100n,
      silver_moved: 0n,
      departure_time: 1n,
      arrival_time: 2n,
      arrival_type: 1,
      carried_artifact_id: "0",
      distance: 50n,
      ...overrides,
    },
  };
}

interface MockSourceOptions {
  latestBlock: number;
  /** Returns updates for a chunk, or throws to simulate failure. */
  updatesFor?: (fromBlock: number, toBlock: number) => TableUpdate<Raw>[];
  eventCountsFor?: (
    fromBlock: number,
    toBlock: number,
  ) => PublicEventBatchCounts;
}

function createMockSource(options: MockSourceOptions): IBlockEventSource & {
  calls: Array<{ fromBlock: number; toBlock: number }>;
} {
  const calls: Array<{ fromBlock: number; toBlock: number }> = [];
  return {
    calls,
    getLatestBlockNumber: async () => options.latestBlock,
    getBlockUpdates: async (
      fromBlock: number,
      toBlock: number,
    ): Promise<BlockUpdates> => {
      calls.push({ fromBlock, toBlock });
      const updates = options.updatesFor?.(fromBlock, toBlock) ?? [];
      const eventCounts = options.eventCountsFor?.(fromBlock, toBlock);
      return { fromBlock, toBlock, updates, eventCounts };
    },
  };
}

test("start() syncs fully and transitions to ready", async () => {
  const source = createMockSource({
    latestBlock: 250,
    updatesFor: (fromBlock) =>
      fromBlock === 1
        ? [planetEventsUpdate("0xplanet", "0xarr"), arrivalUpdate("0xarr")]
        : [],
  });
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  const { syncedToBlock } = await indexer.start();

  assert.equal(syncedToBlock, 250);
  assert.equal(indexer.getLifecycle(), "ready");
  assert.equal(indexer.getProcessedBlockNumber(), 250);
  assert.deepEqual(source.calls, [
    { fromBlock: 1, toBlock: 100 },
    { fromBlock: 101, toBlock: 200 },
    { fromBlock: 201, toBlock: 250 },
  ]);
  assert.ok(indexer.getPlanetEvents("0xplanet"));
  assert.ok(indexer.getArrival("0xarr"));
  indexer.destroy();
});

test("start() rejects when initial getBlockUpdates fails and does not become ready", async () => {
  const source = createMockSource({
    latestBlock: 50,
    updatesFor: () => {
      throw new Error("rpc timeout");
    },
  });
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  await assert.rejects(() => indexer.start(), /rpc timeout/);
  assert.notEqual(indexer.getLifecycle(), "ready");
  assert.equal(indexer.getProcessedBlockNumber(), 0);
  assert.throws(() => indexer.startPolling());
  indexer.destroy();
});

test("mid-sync chunk failure keeps only fully committed chunks", async () => {
  const source = createMockSource({
    latestBlock: 250,
    updatesFor: (fromBlock) => {
      if (fromBlock === 1) return [arrivalUpdate("0xchunk1")];
      throw new Error("network flake");
    },
  });
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  await assert.rejects(() => indexer.start(), /network flake/);
  // First chunk committed; failed chunk left no trace.
  assert.equal(indexer.getProcessedBlockNumber(), 100);
  assert.ok(indexer.getArrival("0xchunk1"));
  assert.notEqual(indexer.getLifecycle(), "ready");
  indexer.destroy();
});

test("applyUpdates is atomic: a bad row prevents all rows of the chunk from being written", async () => {
  const source = createMockSource({
    latestBlock: 10,
    updatesFor: () => [
      // Good row first: with non-atomic apply it would be committed
      // before the bad arrival row throws.
      planetEventsUpdate("0xplanet", "0xarr"),
      // arrival_type overflows Number.MAX_SAFE_INTEGER -> toSafeNum throws.
      arrivalUpdate("0xarr", { arrival_type: 2n ** 64n }),
    ],
  });
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  await assert.rejects(() => indexer.start(), /overflow/);
  assert.equal(indexer.getPlanetEvents("0xplanet"), undefined);
  assert.equal(indexer.getArrival("0xarr"), undefined);
  assert.equal(indexer.getProcessedBlockNumber(), 0);
  indexer.destroy();
});

test("a failed sync resumes from the last committed chunk and recovers", async () => {
  let failSecondChunk = true;
  const source = createMockSource({
    latestBlock: 250,
    updatesFor: (fromBlock) => {
      if (fromBlock === 1) return [arrivalUpdate("0xchunk1")];
      if (fromBlock === 101) {
        if (failSecondChunk) throw new Error("transient failure");
        return [arrivalUpdate("0xchunk2")];
      }
      return [];
    },
  });
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  await assert.rejects(() => indexer.start(), /transient failure/);
  assert.equal(indexer.getProcessedBlockNumber(), 100);

  failSecondChunk = false;
  source.calls.length = 0;
  const { syncedToBlock } = await indexer.start();

  assert.equal(syncedToBlock, 250);
  assert.equal(indexer.getLifecycle(), "ready");
  // Retry resumed from block 101, not from scratch.
  assert.deepEqual(source.calls, [
    { fromBlock: 101, toBlock: 200 },
    { fromBlock: 201, toBlock: 250 },
  ]);
  assert.ok(indexer.getArrival("0xchunk1"));
  assert.ok(indexer.getArrival("0xchunk2"));
  indexer.destroy();
});

test("start() rejects if getLatestBlockNumber fails", async () => {
  const source = createMockSource({ latestBlock: 0 });
  source.getLatestBlockNumber = async () => {
    throw new Error("node unreachable");
  };
  const indexer = new IndexerService({ source });

  await assert.rejects(() => indexer.start(), /node unreachable/);
  assert.notEqual(indexer.getLifecycle(), "ready");
  indexer.destroy();
});

test("public event stats count every event even when the same row id overwrites", async () => {
  const source = createMockSource({
    latestBlock: 2,
    updatesFor: () => [
      arrivalUpdate("0xsame", { pop_arriving: 1n }),
      arrivalUpdate("0xsame", { pop_arriving: 2n }),
    ],
    eventCountsFor: () => ({ ArrivalUpdate: 2, PlanetUpdate: 3 }),
  });
  const indexer = new IndexerService({
    source,
    startBlock: 1,
    maxBlocksPerRequest: 100,
  });

  await indexer.start();

  assert.equal(indexer.getArrivalIds().length, 1);
  assert.deepEqual(indexer.getPublicEventStats(), {
    fromBlock: 1,
    toBlock: 2,
    counts: {
      WorldUpdate: 0,
      PlayerUpdate: 0,
      PlanetUpdate: 3,
      PlanetRevealedCoordsUpdate: 0,
      PlanetEventsUpdate: 0,
      PlanetArtifactsUpdate: 0,
      ArrivalUpdate: 2,
      ArtifactUpdate: 0,
      ArtifactLocationUpdate: 0,
    },
    total: 5,
    complete: true,
  });
  indexer.destroy();
});

test("event counts accumulate by chunk and a failed retry is not double-counted", async () => {
  let failSecondChunk = true;
  const source = createMockSource({
    latestBlock: 250,
    updatesFor: (fromBlock) => {
      if (fromBlock === 101 && failSecondChunk) {
        throw new Error("transient failure");
      }
      return [];
    },
    eventCountsFor: (fromBlock) => ({
      PlanetUpdate: fromBlock === 1 ? 20 : fromBlock === 101 ? 7 : 1,
    }),
  });
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  await assert.rejects(() => indexer.start(), /transient failure/);
  assert.equal(indexer.getPublicEventStats().counts.PlanetUpdate, 20);
  assert.equal(indexer.getPublicEventStats().toBlock, 100);

  failSecondChunk = false;
  await indexer.start();

  const stats = indexer.getPublicEventStats();
  assert.equal(stats.counts.PlanetUpdate, 28);
  assert.equal(stats.total, 28);
  assert.equal(stats.toBlock, 250);
  indexer.destroy();
});

test("event stats are marked partial after loading a bootstrap snapshot", async () => {
  const bootstrapSource: IBlockEventSource = {
    getLatestBlockNumber: async () => 100,
    getBlockUpdates: async (fromBlock, toBlock) => ({
      fromBlock,
      toBlock,
      updates: [],
    }),
    getSnapshot: async () => ({
      lastProcessedBlock: 100,
      world: new Map(),
      player: new Map(),
      planet: new Map(),
      planet_revealed_coords: new Map(),
      planet_events: new Map(),
      planet_artifacts: new Map(),
      arrival: new Map(),
      artifact: new Map(),
      artifact_location: new Map(),
    }),
  };
  const source = createMockSource({
    latestBlock: 102,
    eventCountsFor: () => ({ WorldUpdate: 2 }),
  });
  const indexer = new IndexerService({ source, bootstrapSource });

  await indexer.start();

  const stats = indexer.getPublicEventStats();
  assert.equal(stats.complete, false);
  assert.equal(stats.fromBlock, 101);
  assert.equal(stats.toBlock, 102);
  assert.equal(stats.total, 2);
  indexer.destroy();
});

function blankSnapshot(block: number, hash?: string): IndexerSnapshot {
  return {
    lastProcessedBlock: block,
    ...(hash === undefined ? {} : { lastProcessedBlockHash: hash }),
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
}

const stringPlanet = {
  perlin: "4",
  created_at: "5",
  owner: "0xowner",
  planet_level: "3",
  planet_type: "1",
  space_type: "2",
  is_home_planet: false,
  is_initialized: true,
  destroyed: "0",
  invader: "0x0",
  capturer: "0x0",
  invade_start_block: "0",
  population_cap: "100",
  population_growth: "2",
  range: "3",
  speed: "4",
  defense: "5",
  silver_cap: "6",
  silver_growth: "7",
  population: "123",
  silver: "8",
  upgrade_state_0: "0",
  upgrade_state_1: "1",
  upgrade_state_2: "2",
  last_updated: "9",
  pausers: "0",
  energy_gro_doublers: "1",
  silver_gro_doublers: "0",
  hat_level: "0",
  space_junk: "0",
  has_tried_finding_artifact: "1",
  prospected_block_number: "11",
};

function snapshotWithStringRows(block: number, hash?: string): IndexerSnapshot {
  const snap = blankSnapshot(block, hash);
  snap.world.set("0", {
    paused: false,
    radius: "10",
    misc_nonce: "11",
    next_change_block: "12",
  } as never);
  snap.player.set("0xplayer", {
    init_timestamp: "1",
    home_planet_id: "0xhome",
    last_reveal_timestamp: "2",
    score: "3",
    space_junk: "4",
    space_junk_limit: "5",
    claimed_ships: true,
    last_updated: "6",
  } as never);
  snap.planet.set("0xplanet", { ...stringPlanet } as never);
  snap.planet_revealed_coords.set("0xplanet", {
    location_id: "0xloc",
    x: "1",
    y: "2",
    revealer: "0xplayer",
  } as never);
  snap.planet_events.set("0xplanet", {
    events: [{ id: "0xev" }],
    count: "1",
    last_updated: "9",
  } as never);
  snap.planet_artifacts.set("0xplanet", {
    ids: ["0xart"],
    count: "1",
    last_updated: "9",
  } as never);
  snap.arrival.set("0xarr", {
    id: "0xarr",
    player: "0xplayer",
    from_planet: "0xa",
    to_planet: "0xb",
    pop_arriving: "20",
    silver_moved: "0",
    departure_time: "3",
    arrival_time: "4",
    arrival_type: "1",
    carried_artifact_id: "0",
    distance: "5",
  } as never);
  snap.artifact.set("0xart", {
    planet_discovered_on: "0xplanet",
    rarity: "1",
    planet_biome: "2",
    minted_at_timestamp: "3",
    discoverer: "0xplayer",
    artifact_type: "4",
    activations: "5",
    last_activated: "8",
    last_deactivated: "7",
    wormhole_to: "0",
    owner: "0xplayer",
    controller: "0xplayer",
    last_updated: "9",
  } as never);
  snap.artifact_location.set("0xart", {
    planet_id: "0xplanet",
    voyage_id: "0",
    last_updated: "9",
  } as never);
  return snap;
}

function sourceWithSnapshot(
  snap: IndexerSnapshot,
  options?: {
    latestBlock?: number;
    blockHash?: (n: number) => string | undefined;
    blockHashError?: Error;
  },
): IBlockEventSource & {
  calls: Array<{ fromBlock: number; toBlock: number }>;
} {
  const calls: Array<{ fromBlock: number; toBlock: number }> = [];
  return {
    calls,
    getLatestBlockNumber: async () =>
      options?.latestBlock ?? snap.lastProcessedBlock,
    getBlockHash: options?.blockHashError
      ? async () => {
          throw options.blockHashError;
        }
      : options?.blockHash
        ? async (n) => options.blockHash?.(n)
        : undefined,
    getSnapshot: async () => snap,
    getBlockUpdates: async (fromBlock, toBlock) => {
      calls.push({ fromBlock, toBlock });
      return { fromBlock, toBlock, updates: [] };
    },
  };
}

test("start() converts every string snapshot field to the chain type", async () => {
  const snap = snapshotWithStringRows(5);
  const source = sourceWithSnapshot(snap, { latestBlock: 5 });
  const indexer = new IndexerService({
    source,
    bootstrapSource: source,
    startBlock: 1,
  });

  await indexer.start();

  assert.deepEqual(
    indexer.getWorld(),
    rawToState("world", {
      paused: false,
      radius: "10",
      misc_nonce: "11",
      next_change_block: "12",
    }),
  );
  assert.equal(indexer.getPlanet("0xplanet")?.population, 123n);
  assert.equal(typeof indexer.getPlanet("0xplanet")?.population, "bigint");
  assert.equal(indexer.getPlayer("0xplayer")?.score, 3n);
  assert.equal(indexer.getArrival("0xarr")?.pop_arriving, 20n);
  assert.equal(indexer.getArtifact("0xart")?.last_activated, 8n);
  assert.equal(indexer.getPlanetEvents("0xplanet")?.count, 1);
  assert.equal(indexer.getPlanetArtifacts("0xplanet")?.count, 1);
  assert.equal(indexer.getPlanetRevealedCoords("0xplanet")?.x, "1");
  assert.equal(indexer.getArtifactLocation("0xart")?.planet_id, "0xplanet");
  assert.deepEqual(source.calls, []);
  indexer.destroy();
});

test("normalizeSnapshot leaves an already-typed row unchanged", () => {
  const typed = rawToState("planet", stringPlanet);
  const snap = blankSnapshot(1);
  snap.planet.set("0xplanet", typed as never);
  normalizeSnapshot(snap);
  assert.deepEqual(snap.planet.get("0xplanet"), typed);
  normalizeSnapshot(snap);
  assert.equal(
    (snap.planet.get("0xplanet") as { population: bigint }).population,
    123n,
  );
});

test("a bad or incomplete snapshot is discarded and sync starts from startBlock", async () => {
  const badRows = [
    { ...stringPlanet, population: "abc" },
    (() => {
      const row: Record<string, unknown> = { ...stringPlanet };
      delete row.population;
      return row;
    })(),
  ];
  for (const planet of badRows) {
    const snap = blankSnapshot(20);
    snap.planet.set("0xplanet", planet as never);
    const source = sourceWithSnapshot(snap, { latestBlock: 1 });
    const indexer = new IndexerService({
      source,
      bootstrapSource: source,
      startBlock: 1,
    });
    await indexer.start();
    assert.equal(indexer.getPlanet("0xplanet"), undefined);
    assert.equal(source.calls[0]?.fromBlock, 1);
    indexer.destroy();
  }
});

test("applySnapshot throws on a bad numeric value", () => {
  const source = createMockSource({ latestBlock: 1 });
  const indexer = new IndexerService({ source });
  const snap = blankSnapshot(3);
  snap.planet.set("0xplanet", { ...stringPlanet, population: "abc" } as never);
  assert.throws(() => indexer.applySnapshot(snap), /not a valid integer/);
  assert.equal(indexer.getPlanet("0xplanet"), undefined);
  indexer.destroy();
});

test("a clamped toBlock is committed and the next round resumes after it", async () => {
  const calls: Array<{ fromBlock: number; toBlock: number }> = [];
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 100,
    getBlockUpdates: async (fromBlock, toBlock) => {
      calls.push({ fromBlock, toBlock });
      return { fromBlock, toBlock: 60, updates: [] };
    },
  };
  const indexer = new IndexerService({ source, maxBlocksPerRequest: 100 });

  await indexer.start();

  assert.equal(indexer.getProcessedBlockNumber(), 60);
  assert.deepEqual(calls, [
    { fromBlock: 1, toBlock: 100 },
    { fromBlock: 61, toBlock: 100 },
  ]);
  indexer.destroy();
});

test("verifyBlockHashes stops syncing after the stored hash no longer matches", async () => {
  let sourceHash = "a";
  const calls: number[] = [];
  const reorgs: string[] = [];
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 100,
    getBlockHash: async () => sourceHash,
    getBlockUpdates: async (fromBlock, toBlock) => {
      calls.push(fromBlock);
      return { fromBlock, toBlock, toBlockHash: "a", updates: [] };
    },
  };
  const indexer = new IndexerService({
    source,
    maxBlocksPerRequest: 100,
    verifyBlockHashes: true,
    onReorgDetected: (info) => {
      reorgs.push(`${info.blockNumber}:${info.localHash}->${info.sourceHash}`);
    },
  });

  await indexer.start();
  assert.equal(indexer.getProcessedBlockNumber(), 100);
  assert.equal(indexer.getProcessedBlockHash(), "a");

  sourceHash = "b";
  const callsBefore = calls.length;
  await indexer.start();
  await indexer.start();

  assert.deepEqual(reorgs, ["100:a->b"]);
  assert.equal(calls.length, callsBefore);
  indexer.destroy();
});

test("initial sync retries then succeeds without advancing on the failed attempts", async () => {
  let failuresLeft = 2;
  const source = createMockSource({
    latestBlock: 10,
    updatesFor: () => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("rpc down");
      }
      return [arrivalUpdate("0xok")];
    },
  });
  const indexer = new IndexerService({
    source,
    maxBlocksPerRequest: 100,
    initialSyncMaxRetries: 3,
  });

  await indexer.start();

  assert.equal(indexer.getProcessedBlockNumber(), 10);
  assert.ok(indexer.getArrival("0xok"));
  assert.equal(indexer.getStatus().consecutiveFailures, 0);
  assert.equal(indexer.getStatus().lastError, undefined);
  indexer.destroy();
});

test("initial sync stops when the retry limit is reached", async () => {
  let attempts = 0;
  const source = createMockSource({
    latestBlock: 10,
    updatesFor: () => {
      attempts += 1;
      throw new Error("rpc down");
    },
  });
  const indexer = new IndexerService({
    source,
    initialSyncMaxRetries: 2,
  });

  await assert.rejects(() => indexer.start(), /rpc down/);
  assert.equal(attempts, 2);
  assert.equal(indexer.getProcessedBlockNumber(), 0);
  assert.notEqual(indexer.getLifecycle(), "ready");
  indexer.destroy();
});

test("hash mismatches and the first RPC failure keep the default behavior", async () => {
  let sourceHash = "a";
  const calls: number[] = [];
  let reorgs = 0;
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 100,
    getBlockHash: async () => sourceHash,
    getBlockUpdates: async (fromBlock, toBlock) => {
      calls.push(fromBlock);
      return { fromBlock, toBlock, toBlockHash: "a", updates: [] };
    },
  };
  const indexer = new IndexerService({
    source,
    maxBlocksPerRequest: 100,
    onReorgDetected: () => {
      reorgs += 1;
    },
  });
  await indexer.start();
  sourceHash = "b";
  source.getLatestBlockNumber = async () => 150;
  await indexer.start();
  assert.equal(reorgs, 0);
  assert.equal(calls[calls.length - 1], 101);
  indexer.destroy();

  let attempts = 0;
  const failing = createMockSource({
    latestBlock: 4,
    updatesFor: () => {
      attempts += 1;
      throw new Error("rpc down");
    },
  });
  const once = new IndexerService({ source: failing });
  await assert.rejects(() => once.start(), /rpc down/);
  assert.equal(attempts, 1);
  once.destroy();
});

test("verifyBootstrapSnapshot keeps a matching snapshot and drops a mismatch", async () => {
  const matching = sourceWithSnapshot(snapshotWithStringRows(500, "a"), {
    latestBlock: 501,
    blockHash: () => "a",
  });
  const matched = new IndexerService({
    source: matching,
    bootstrapSource: matching,
    startBlock: 1,
    verifyBootstrapSnapshot: true,
  });
  await matched.start();
  assert.equal(matching.calls[0]?.fromBlock, 501);
  assert.equal(matched.getPlanet("0xplanet")?.population, 123n);
  matched.destroy();

  const mismatched = sourceWithSnapshot(snapshotWithStringRows(500, "a"), {
    latestBlock: 1,
    blockHash: () => "b",
  });
  const dropped = new IndexerService({
    source: mismatched,
    bootstrapSource: mismatched,
    startBlock: 1,
    verifyBootstrapSnapshot: true,
  });
  await dropped.start();
  assert.equal(mismatched.calls[0]?.fromBlock, 1);
  assert.equal(dropped.getPlanet("0xplanet"), undefined);
  dropped.destroy();
});

test("verifyBootstrapSnapshot accepts a snapshot that cannot be checked", async () => {
  const cases: Array<{
    snap: IndexerSnapshot;
    blockHash?: (n: number) => string | undefined;
    blockHashError?: Error;
  }> = [
    { snap: snapshotWithStringRows(500) },
    {
      snap: snapshotWithStringRows(500, "a"),
      blockHash: () => undefined,
    },
    {
      snap: snapshotWithStringRows(500, "a"),
      blockHashError: new Error("node busy"),
    },
  ];

  for (const item of cases) {
    const source = sourceWithSnapshot(item.snap, {
      latestBlock: 501,
      blockHash: item.blockHash,
      blockHashError: item.blockHashError,
    });
    const indexer = new IndexerService({
      source,
      bootstrapSource: source,
      startBlock: 1,
      verifyBootstrapSnapshot: true,
    });
    await indexer.start();
    assert.equal(source.calls[0]?.fromBlock, 501);
    assert.equal(indexer.getPlanet("0xplanet")?.population, 123n);
    indexer.destroy();
  }
});
