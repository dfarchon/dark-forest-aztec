/**
 * Regression tests for IndexerService sync correctness:
 * - initial sync errors propagate (no silent "ready" with incomplete state)
 * - chunk application is atomic (a bad row never leaves partial cross-table state)
 * - a failed sync resumes from the last fully committed chunk
 */

import assert from "node:assert/strict";
import test from "node:test";

import { IndexerService } from "../src/IndexerService.ts";
import { normalizeSnapshot, rawToState } from "../src/utils/convert.ts";
import type {
  BlockUpdates,
  ForkDivergence,
  IBlockEventSource,
  IndexerSnapshot,
  TableUpdate,
} from "../src/types.ts";

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
      return { fromBlock, toBlock, updates };
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
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });

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
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });

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
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });

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
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });

  await assert.rejects(() => indexer.start(), /overflow/);
  assert.equal(indexer.getPlanetEvents("0xplanet"), undefined);
  assert.equal(indexer.getArrival("0xarr"), undefined);
  assert.equal(indexer.getProcessedBlockNumber(), 0);
  indexer.destroy();
});

test("applyUpdates rejects bad strings, unsigned values, and event lists", async () => {
  const badRows: TableUpdate<Raw>[] = [
    arrivalUpdate("0xarr", { player: { a: 1 } }),
    arrivalUpdate("0xarr", { pop_arriving: -1n }),
    arrivalUpdate("0xarr", { pop_arriving: "1.5" }),
    arrivalUpdate("0xarr", { arrival_type: 256 }),
    {
      table: "planet_events",
      id: "0xplanet",
      state: {
        events: [{ id: "0xev" }],
        count: 2,
        last_updated: 1n,
      },
    },
    {
      table: "planet_events",
      id: "0xplanet",
      state: {
        events: [{ id: "" }],
        count: 1,
        last_updated: 1n,
      },
    },
    {
      table: "planet_artifacts",
      id: "0xplanet",
      state: {
        ids: Array.from({ length: 21 }, () => "0xart"),
        count: 21,
        last_updated: 1n,
      },
    },
  ];
  for (const bad of badRows) {
    const source = createMockSource({
      latestBlock: 1,
      updatesFor: () => [planetEventsUpdate("0xplanet", "0xkeep"), bad],
    });
    const indexer = new IndexerService({
      bootstrap: { source },
      sync: { maxBlocksPerRequest: 100 },
    });
    await assert.rejects(() => indexer.start());
    assert.equal(indexer.getPlanetEvents("0xplanet"), undefined);
    assert.equal(indexer.getArrival("0xarr"), undefined);
    assert.equal(indexer.getPlanetArtifacts("0xplanet"), undefined);
    indexer.destroy();
  }
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
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });

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

test("a failed sync with startBlock resumes from the last committed chunk", async () => {
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
  const indexer = new IndexerService({
    bootstrap: { source, startBlock: 1 },
    sync: { maxBlocksPerRequest: 100 },
  });

  await assert.rejects(() => indexer.start(), /transient failure/);
  assert.equal(indexer.getProcessedBlockNumber(), 100);
  assert.equal(indexer.getLifecycle(), "syncing");

  failSecondChunk = false;
  source.calls.length = 0;
  const { syncedToBlock } = await indexer.start();

  assert.equal(syncedToBlock, 250);
  assert.equal(indexer.getLifecycle(), "ready");
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
  const indexer = new IndexerService({ bootstrap: { source } });

  await assert.rejects(() => indexer.start(), /node unreachable/);
  assert.notEqual(indexer.getLifecycle(), "ready");
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
  const snap = snapshotWithStringRows(5, "a");
  const source = sourceWithSnapshot(snap, {
    latestBlock: 5,
    blockHash: () => "a",
  });
  const indexer = new IndexerService({
    bootstrap: { source, bootstrapSource: source, startBlock: 1 },
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
      bootstrap: { source, bootstrapSource: source, startBlock: 1 },
    });
    await indexer.start();
    assert.equal(indexer.getPlanet("0xplanet"), undefined);
    assert.equal(source.calls[0]?.fromBlock, 1);
    indexer.destroy();
  }
});

test("applySnapshot throws on a bad numeric value", () => {
  const source = createMockSource({ latestBlock: 1 });
  const indexer = new IndexerService({ bootstrap: { source } });
  const snap = blankSnapshot(3);
  snap.planet.set("0xplanet", { ...stringPlanet, population: "abc" } as never);
  assert.throws(() => indexer.applySnapshot(snap), /not a valid integer/);
  assert.equal(indexer.getPlanet("0xplanet"), undefined);
  indexer.destroy();
});

test("an installed snapshot is not shared with the caller", () => {
  const source = createMockSource({ latestBlock: 1 });
  const indexer = new IndexerService({ bootstrap: { source } });
  const snap = snapshotWithStringRows(3);
  indexer.applySnapshot(snap);

  const planet = snap.planet.get("0xplanet") as { population: bigint };
  planet.population = 999n;
  snap.planet.set("0xother", planet as never);
  const events = snap.planet_events.get("0xplanet") as {
    events: { id: string }[];
  };
  events.events.push({ id: "0xextra" });
  const artifacts = snap.planet_artifacts.get("0xplanet") as { ids: string[] };
  artifacts.ids.push("0xextra");

  assert.equal(indexer.getPlanet("0xplanet")?.population, 123n);
  assert.equal(indexer.getPlanet("0xother"), undefined);
  assert.deepEqual(indexer.getPlanetEvents("0xplanet")?.events, [
    { id: "0xev" },
  ]);
  assert.deepEqual(indexer.getPlanetArtifacts("0xplanet")?.ids, ["0xart"]);
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
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });

  await indexer.start();

  assert.equal(indexer.getProcessedBlockNumber(), 60);
  assert.deepEqual(calls, [
    { fromBlock: 1, toBlock: 100 },
    { fromBlock: 61, toBlock: 100 },
  ]);
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
  const retries: Array<{ attempt: number; waitMs: number; message: string }> =
    [];
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: {
      maxBlocksPerRequest: 100,
      initialSyncMaxRetries: 3,
      onInitialSyncRetry: (attempt, waitMs, error) => {
        retries.push({
          attempt,
          waitMs,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    },
  });

  await indexer.start();

  assert.deepEqual(retries, [
    { attempt: 1, waitMs: 2_000, message: "rpc down" },
    { attempt: 2, waitMs: 4_000, message: "rpc down" },
  ]);
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
    bootstrap: { source },
    sync: { initialSyncMaxRetries: 2 },
  });

  await assert.rejects(() => indexer.start(), /rpc down/);
  assert.equal(attempts, 2);
  assert.equal(indexer.getProcessedBlockNumber(), 0);
  assert.notEqual(indexer.getLifecycle(), "ready");
  indexer.destroy();
});

test("destroy() during initial sync retry rejects start() and stays destroyed", async () => {
  const source = createMockSource({
    latestBlock: 10,
    updatesFor: () => {
      throw new Error("rpc down");
    },
  });
  let indexer!: IndexerService;
  indexer = new IndexerService({
    bootstrap: { source },
    sync: {
      initialSyncMaxRetries: 3,
      onInitialSyncRetry: () => {
        indexer.destroy();
      },
    },
  });

  await assert.rejects(() => indexer.start());
  assert.equal(indexer.getLifecycle(), "destroyed");
  assert.throws(() => indexer.startPolling());
});

test("start() after destroy() rejects and stays destroyed", async () => {
  const indexer = new IndexerService({
    bootstrap: { source: createMockSource({ latestBlock: 1 }) },
  });
  indexer.destroy();

  await assert.rejects(
    () => indexer.start(),
    /start\(\) rejected: indexer is destroyed/,
  );
  assert.equal(indexer.getLifecycle(), "destroyed");
});

test("a second start() while one is running is rejected", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let updates = 0;
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 1,
    getBlockUpdates: async (fromBlock, toBlock) => {
      updates += 1;
      await gate;
      return { fromBlock, toBlock, updates: [] };
    },
  };
  const indexer = new IndexerService({ bootstrap: { source } });

  const first = indexer.start();
  await assert.rejects(() => indexer.start(), /start already in progress/);
  release();
  const { syncedToBlock } = await first;

  assert.equal(syncedToBlock, 1);
  assert.equal(updates, 1);
  assert.equal(indexer.getLifecycle(), "ready");
  indexer.destroy();
});

test("waitForBlock syncs to a block that landed after start", async () => {
  const options: MockSourceOptions = { latestBlock: 10 };
  const source = createMockSource(options);
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100, maxBackoffMs: 60_000 },
  });
  await indexer.start();
  options.latestBlock = 20;

  await indexer.waitForBlock(20, 1_000);

  assert.equal(indexer.getProcessedBlockNumber(), 20);
  assert.equal(indexer.getStatus().consecutiveFailures, 0);
  indexer.destroy();
});

test("waitForBlock rejects a sync error before polling starts", async () => {
  const source = createMockSource({ latestBlock: 10 });
  const indexer = new IndexerService({ bootstrap: { source } });
  await indexer.start();
  source.getLatestBlockNumber = async () => {
    throw new Error("rpc down");
  };

  const started = Date.now();
  await assert.rejects(
    () => indexer.waitForBlock(indexer.getProcessedBlockNumber() + 1, 30_000),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "rpc down");
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000);
  indexer.destroy();
});

test("waitForBlock while live recovers from a failed syncNow on a later poll", async () => {
  let latest = 10;
  let failNext = false;
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => {
      if (failNext) {
        failNext = false;
        throw new Error("rpc down");
      }
      return latest;
    },
    getBlockUpdates: async (fromBlock, toBlock) => ({
      fromBlock,
      toBlock,
      updates: [],
    }),
  };
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { pollIntervalMs: 10, debounceMs: 0 },
  });

  try {
    await indexer.start();
    indexer.startPolling();
    failNext = true;
    latest = 11;

    await indexer.waitForBlock(11, 2_000);

    assert.equal(indexer.getProcessedBlockNumber(), 11);
  } finally {
    indexer.destroy();
  }
});

test("waitForBlock timeout includes the sync failure while live", async () => {
  const source = createMockSource({ latestBlock: 10 });
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { pollIntervalMs: 10, debounceMs: 0 },
  });

  try {
    await indexer.start();
    indexer.startPolling();
    source.getLatestBlockNumber = async () => {
      throw new Error("rpc down");
    };

    await assert.rejects(
      () => indexer.waitForBlock(11, 50),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /timed out after 50ms/);
        assert.match(err.message, /rpc down/);
        const cause = (err as { cause?: unknown }).cause;
        assert.ok(cause instanceof Error);
        assert.equal(cause.message, "rpc down");
        return true;
      },
    );
  } finally {
    indexer.destroy();
  }
});

test("a changed tip hash does not rewind, and the first RPC failure is not retried", async () => {
  let sourceHash = "a";
  const calls: number[] = [];
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 100,
    getBlockHash: async () => sourceHash,
    getBlockUpdates: async (fromBlock, toBlock) => {
      calls.push(fromBlock);
      return { fromBlock, toBlock, toBlockHash: "a", updates: [] };
    },
  };
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100 },
  });
  await indexer.start();
  sourceHash = "b";
  source.getLatestBlockNumber = async () => 150;
  await indexer.start();
  assert.deepEqual(calls, [1]);
  assert.equal(indexer.getProcessedBlockNumber(), 100);
  assert.equal(indexer.getProcessedBlockHash(), "a");
  assert.equal(indexer.getStatus().forkDiverged, true);
  indexer.destroy();

  let attempts = 0;
  const failing = createMockSource({
    latestBlock: 4,
    updatesFor: () => {
      attempts += 1;
      throw new Error("rpc down");
    },
  });
  const once = new IndexerService({ bootstrap: { source: failing } });
  await assert.rejects(() => once.start(), /rpc down/);
  assert.equal(attempts, 1);
  once.destroy();
});

function forkSource(blockCount: number) {
  let tip = blockCount;
  let nodeHash: string | undefined = "a";
  let hashError: Error | undefined;
  const calls: number[] = [];
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => tip,
    getBlockHash: async () => {
      if (hashError) throw hashError;
      return nodeHash;
    },
    getBlockUpdates: async (fromBlock, toBlock) => {
      calls.push(fromBlock);
      const updates = [];
      if (fromBlock <= blockCount && toBlock >= blockCount) {
        updates.push(arrivalUpdate("0xold"));
      }
      if (fromBlock <= blockCount + 1 && toBlock >= blockCount + 1) {
        updates.push(arrivalUpdate("0xnew"));
      }
      return { fromBlock, toBlock, toBlockHash: "a", updates };
    },
  };
  return {
    source,
    calls,
    setTip: (block: number) => {
      tip = block;
    },
    setNodeHash: (hash: string | undefined) => {
      nodeHash = hash;
    },
    setHashError: (error: Error | undefined) => {
      hashError = error;
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for indexer state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a divergent block hash stops new commits and reports once", async () => {
  const world = forkSource(4);
  const reports: ForkDivergence[] = [];
  const indexer = new IndexerService({
    onForkDiverged: (divergence) => {
      reports.push(divergence);
    },
    bootstrap: { source: world.source },
    sync: { pollIntervalMs: 15, debounceMs: 0, maxBlocksPerRequest: 100 },
  });

  try {
    await indexer.start();
    assert.equal(indexer.getProcessedBlockNumber(), 4);
    assert.ok(indexer.getArrival("0xold"));
    const callsAfterSync = world.calls.length;

    world.setNodeHash("b");
    world.setTip(14);
    indexer.startPolling();
    await waitFor(() => reports.length === 1);

    assert.equal(indexer.getStatus().forkDiverged, true);
    assert.equal(reports[0]?.processedBlock, 4);
    assert.equal(reports[0]?.processedBlockHash, "a");
    assert.equal(reports[0]?.nodeHash, "b");
    assert.equal(reports[0]?.tip, 14);
    assert.match(indexer.getStatus().lastError ?? "", /block 4/);
    assert.match(indexer.getStatus().lastError ?? "", /b/);
    assert.equal(indexer.getProcessedBlockNumber(), 4);
    assert.equal(indexer.getArrival("0xnew"), undefined);
    assert.equal(world.calls.length, callsAfterSync);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(reports.length, 1);
    assert.equal(indexer.getArrival("0xnew"), undefined);
    assert.equal(indexer.getProcessedBlockNumber(), 4);
  } finally {
    indexer.destroy();
  }
});

test("a tip behind the processed block is skipped and a later tip still commits", async () => {
  const world = forkSource(4);
  const reports: ForkDivergence[] = [];
  const indexer = new IndexerService({
    onForkDiverged: (divergence) => {
      reports.push(divergence);
    },
    bootstrap: { source: world.source },
    sync: { maxBlocksPerRequest: 100 },
  });

  try {
    await indexer.start();
    assert.equal(indexer.getLatestKnownBlock(), 4);
    world.setTip(3);
    await assert.rejects(() => indexer.waitForBlock(5, 30), /timed out/);

    assert.equal(indexer.getStatus().forkDiverged, false);
    assert.equal(reports.length, 0);
    assert.equal(indexer.getStatus().lastError, undefined);
    assert.equal(indexer.getLatestKnownBlock(), 4);
    assert.equal(indexer.getProcessedBlockNumber(), 4);
    assert.equal(indexer.getProcessedBlockHash(), "a");
    assert.ok(indexer.getArrival("0xold"));
    assert.equal(indexer.getArrival("0xnew"), undefined);

    world.setTip(5);
    await indexer.waitForBlock(5);
    assert.equal(indexer.getStatus().forkDiverged, false);
    assert.equal(reports.length, 0);
    assert.equal(indexer.getProcessedBlockNumber(), 5);
    assert.equal(indexer.getLatestKnownBlock(), 5);
    assert.ok(indexer.getArrival("0xnew"));
  } finally {
    indexer.destroy();
  }
});

test("a reorg between chunks halts before the next chunk overwrites the hash", async () => {
  const hashes = new Map<number, string>([
    [1, "h1"],
    [2, "h2"],
  ]);
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 2,
    getBlockHash: async (block) => hashes.get(block),
    getBlockUpdates: async (fromBlock, toBlock) => {
      if (fromBlock === 2) hashes.set(1, "h1-reorg");
      return {
        fromBlock,
        toBlock,
        toBlockHash: hashes.get(toBlock),
        updates: [arrivalUpdate(fromBlock === 1 ? "0xchunk1" : "0xchunk2")],
      };
    },
  };
  const reports: ForkDivergence[] = [];
  const indexer = new IndexerService({
    onForkDiverged: (divergence) => {
      reports.push(divergence);
    },
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 1 },
  });

  try {
    const started = await indexer.start();
    assert.equal(started.syncedToBlock, 1);
    assert.equal(indexer.getProcessedBlockNumber(), 1);
    assert.equal(indexer.getProcessedBlockHash(), "h1");
    assert.ok(indexer.getArrival("0xchunk1"));
    assert.equal(indexer.getArrival("0xchunk2"), undefined);
    assert.equal(indexer.getStatus().forkDiverged, true);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.processedBlock, 1);
    assert.equal(reports[0]?.processedBlockHash, "h1");
    assert.equal(reports[0]?.nodeHash, "h1-reorg");
    assert.equal(reports[0]?.tip, 2);

    source.getLatestBlockNumber = async () => 3;
    await indexer.start();
    assert.equal(indexer.getProcessedBlockNumber(), 1);
    assert.equal(indexer.getProcessedBlockHash(), "h1");
    assert.equal(indexer.getArrival("0xchunk2"), undefined);
    assert.equal(reports.length, 1);
  } finally {
    indexer.destroy();
  }
});

test("a block hash RPC error does not latch and a later poll can commit", async () => {
  const world = forkSource(4);
  const reports: ForkDivergence[] = [];
  const indexer = new IndexerService({
    onForkDiverged: (divergence) => {
      reports.push(divergence);
    },
    bootstrap: { source: world.source },
    sync: { pollIntervalMs: 10, debounceMs: 0, maxBlocksPerRequest: 100 },
  });

  try {
    await indexer.start();
    world.setHashError(new Error("rpc down"));
    world.setTip(8);

    await assert.rejects(() => indexer.waitForBlock(5, 1_000), /rpc down/);
    assert.equal(indexer.getStatus().forkDiverged, false);
    assert.equal(reports.length, 0);
    assert.equal(indexer.getProcessedBlockNumber(), 4);

    indexer.startPolling();
    await waitFor(() => indexer.getStatus().consecutiveFailures > 0);
    assert.equal(indexer.getStatus().forkDiverged, false);
    assert.equal(reports.length, 0);
    assert.match(indexer.getStatus().lastError ?? "", /rpc down/);

    world.setHashError(undefined);
    world.setNodeHash("a");
    world.setTip(5);
    await waitFor(() => indexer.getProcessedBlockNumber() === 5);
    assert.equal(indexer.getStatus().forkDiverged, false);
    assert.equal(indexer.getStatus().consecutiveFailures, 0);
    assert.ok(indexer.getArrival("0xnew"));
  } finally {
    indexer.destroy();
  }
});

test("a missing block hash latches when the tip still covers the cursor", async () => {
  const world = forkSource(4);
  const reports: ForkDivergence[] = [];
  const indexer = new IndexerService({
    onForkDiverged: (divergence) => {
      reports.push(divergence);
    },
    bootstrap: { source: world.source },
  });

  try {
    await indexer.start();
    world.setNodeHash(undefined);
    world.setTip(14);
    await indexer.start();

    assert.equal(indexer.getStatus().forkDiverged, true);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.processedBlock, 4);
    assert.equal(reports[0]?.nodeHash, undefined);
    assert.equal(reports[0]?.tip, 14);
    assert.equal(indexer.getProcessedBlockNumber(), 4);
    assert.equal(indexer.getArrival("0xnew"), undefined);
    assert.ok(indexer.getArrival("0xold"));
  } finally {
    indexer.destroy();
  }
});

test("start() still becomes ready when the processed hash changes before it returns", async () => {
  let nodeHash = "a";
  let reports = 0;
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => 4,
    getBlockHash: async () => nodeHash,
    getBlockUpdates: async (fromBlock, toBlock) => {
      nodeHash = "b";
      return {
        fromBlock,
        toBlock,
        toBlockHash: "a",
        updates: [arrivalUpdate("0xold")],
      };
    },
  };
  const indexer = new IndexerService({
    onForkDiverged: () => {
      reports += 1;
      throw new Error("listener down");
    },
    bootstrap: { source },
  });

  try {
    const started = await indexer.start();
    assert.equal(started.syncedToBlock, 4);
    assert.equal(indexer.getLifecycle(), "ready");
    assert.equal(indexer.getStatus().forkDiverged, true);
    assert.equal(reports, 1);
    assert.ok(indexer.getArrival("0xold"));
    assert.equal(indexer.getProcessedBlockHash(), "a");
  } finally {
    indexer.destroy();
  }
});

test("a matching snapshot is kept and a mismatch is dropped", async () => {
  const matching = sourceWithSnapshot(snapshotWithStringRows(500, "a"), {
    latestBlock: 501,
    blockHash: () => "a",
  });
  const matched = new IndexerService({
    bootstrap: {
      source: matching,
      bootstrapSource: matching,
      startBlock: 1,
    },
  });
  const kept = await matched.start();
  assert.equal(kept.bootstrapBlock, 500);
  assert.equal(kept.syncedToBlock, 501);
  assert.equal(matching.calls[0]?.fromBlock, 501);
  assert.equal(matched.getPlanet("0xplanet")?.population, 123n);
  matched.destroy();

  const mismatched = sourceWithSnapshot(snapshotWithStringRows(500, "a"), {
    latestBlock: 1,
    blockHash: () => "b",
  });
  const dropped = new IndexerService({
    bootstrap: {
      source: mismatched,
      bootstrapSource: mismatched,
      startBlock: 1,
    },
  });
  const rejected = await dropped.start();
  assert.equal(rejected.bootstrapBlock, undefined);
  assert.equal(mismatched.calls[0]?.fromBlock, 1);
  assert.equal(dropped.getPlanet("0xplanet"), undefined);
  dropped.destroy();
});

test("a snapshot that cannot be checked is dropped", async () => {
  const cases: Array<{
    snap: IndexerSnapshot;
    blockHash?: (n: number) => string | undefined;
    blockHashError?: Error;
  }> = [
    { snap: snapshotWithStringRows(500) },
    { snap: snapshotWithStringRows(500, "a") },
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
      bootstrap: { source, bootstrapSource: source, startBlock: 1 },
    });
    const started = await indexer.start();
    assert.equal(started.bootstrapBlock, undefined);
    assert.equal(source.calls[0]?.fromBlock, 1);
    assert.equal(indexer.getPlanet("0xplanet"), undefined);
    indexer.destroy();
  }
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms`);
    }
    await delay(10);
  }
}

test("a throwing subscriber does not drop the update or fail the sync", async () => {
  const options: MockSourceOptions = {
    latestBlock: 10,
    updatesFor: (fromBlock) =>
      fromBlock === 11 ? [arrivalUpdate("0xnew")] : [],
  };
  const source = createMockSource(options);
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100, pollIntervalMs: 10, debounceMs: 0 },
  });
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    await indexer.start();
    options.latestBlock = 11;

    const received: string[][] = [];
    indexer.subscribe(() => {
      throw new Error("subscriber blew up");
    });
    indexer.subscribe((payload) => {
      received.push([...(payload.updatedIdsByTable?.arrival ?? [])]);
    });
    indexer.startPolling();

    await waitUntil(() => received.length > 0);
    await delay(20);

    assert.deepEqual(received, [["0xnew"]]);
    assert.equal(indexer.getStatus().consecutiveFailures, 0);
    assert.equal(indexer.getStatus().lastError, undefined);
    assert.equal(indexer.getProcessedBlockNumber(), 11);
    assert.ok(indexer.getArrival("0xnew"));
    assert.equal(
      source.calls.filter((call) => call.fromBlock === 11).length,
      1,
    );
    assert.ok(
      logged.some((args) =>
        args.some(
          (arg) => arg instanceof Error && arg.message === "subscriber blew up",
        ),
      ),
    );
  } finally {
    console.error = originalError;
    indexer.destroy();
  }
});

test("a throwing onBlockProcessed still notifies subscribers", async () => {
  const options: MockSourceOptions = {
    latestBlock: 10,
    updatesFor: (fromBlock) =>
      fromBlock === 11 ? [arrivalUpdate("0xhook")] : [],
  };
  const source = createMockSource(options);
  const indexer = new IndexerService({
    bootstrap: { source },
    sync: { maxBlocksPerRequest: 100, pollIntervalMs: 10, debounceMs: 0 },
  });
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    await indexer.start();
    indexer.setOnBlockProcessed(() => {
      throw new Error("progress hook failed");
    });
    options.latestBlock = 11;

    const received: Array<{
      fromBlock: number;
      toBlock: number;
      ids: string[];
    }> = [];
    indexer.subscribe((payload) => {
      received.push({
        fromBlock: payload.fromBlock,
        toBlock: payload.toBlock,
        ids: [...(payload.updatedIdsByTable?.arrival ?? [])],
      });
    });
    indexer.startPolling();

    await waitUntil(() => received.length > 0);
    await delay(20);

    assert.deepEqual(received, [
      { fromBlock: 11, toBlock: 11, ids: ["0xhook"] },
    ]);
    assert.equal(indexer.getProcessedBlockNumber(), 11);
    assert.equal(indexer.getStatus().consecutiveFailures, 0);
    assert.equal(indexer.getStatus().lastError, undefined);
    assert.ok(indexer.getArrival("0xhook"));
    assert.ok(
      logged.some((args) =>
        args.some(
          (arg) =>
            arg instanceof Error && arg.message === "progress hook failed",
        ),
      ),
    );
  } finally {
    console.error = originalError;
    indexer.destroy();
  }
});
