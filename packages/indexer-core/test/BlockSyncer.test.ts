import assert from "node:assert/strict";
import test from "node:test";

import { BlockSyncer } from "../src/service/BlockSyncer.ts";
import { IndexerStore } from "../src/service/IndexerStore.ts";
import type { BlockUpdates, IBlockEventSource } from "../src/types.ts";

test("syncNow fetches updates while a retry backoff is still active", async () => {
  let now = 1_000_000;
  let latest = 10;
  let failTip = false;
  const calls: number[] = [];
  let tipReads = 0;
  const source: IBlockEventSource = {
    getLatestBlockNumber: async () => {
      tipReads += 1;
      if (failTip) throw new Error("rpc down");
      return latest;
    },
    getBlockUpdates: async (fromBlock, toBlock): Promise<BlockUpdates> => {
      calls.push(fromBlock);
      return { fromBlock, toBlock, updates: [] };
    },
  };
  const store = new IndexerStore(0);
  const syncer = new BlockSyncer({
    source,
    store,
    debounceMs: 1_000,
    pollIntervalMs: 60_000,
    maxBlocksPerRequest: 100,
    maxBackoffMs: 60_000,
    now: () => now,
    onChunk: () => {},
  });

  await syncer.catchUp();
  assert.equal(store.processedBlock, 10);

  failTip = true;
  await syncer.pollOnce();
  failTip = false;
  const backingOff = syncer.status();
  assert.equal(backingOff.consecutiveFailures, 1);
  assert.equal(backingOff.lastError, "rpc down");
  assert.equal(backingOff.nextRetryAt, now + 2_000);

  const tipReadsAtBackoff = tipReads;
  await syncer.pollOnce();
  assert.equal(tipReads, tipReadsAtBackoff);

  latest = 20;
  await syncer.syncNow();
  assert.equal(store.processedBlock, 20);
  assert.ok(calls.includes(11));
  assert.equal(syncer.status().consecutiveFailures, 0);
  assert.equal(syncer.status().lastError, undefined);
  assert.ok(syncer.status().nextRetryAt <= now);
  syncer.stop();
});
