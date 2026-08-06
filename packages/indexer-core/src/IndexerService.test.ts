/**
 * Regression tests for IndexerService sync correctness:
 * - initial sync errors propagate (no silent "ready" with incomplete state)
 * - chunk application is atomic (a bad row never leaves partial cross-table state)
 * - a failed sync resumes from the last fully committed chunk
 */

import assert from "node:assert/strict";
import test from "node:test";

import { IndexerService } from "./IndexerService.ts";
import type { BlockUpdates, IBlockEventSource, TableUpdate } from "./types.ts";

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
