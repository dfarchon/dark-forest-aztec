import type Database from "better-sqlite3";

import { derivePending } from "./derive.ts";
import { blockRow, blockTip, deleteAfter, inspectIntegrity } from "./db.ts";
import { sameHash, type ChainBlock, type ChainSource } from "./model.ts";
import { writeChunk } from "./store.ts";

export const DEFAULT_CHUNK_SIZE = 100;

export interface SyncOptions {
  db: Database.Database;
  source: ChainSource;
  startBlock: number;
  chunkSize?: number;
  log?: (message: string) => void;
}

export async function sync(options: SyncOptions): Promise<void> {
  const { db, source, startBlock } = options;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const log = options.log ?? (() => {});
  const integrity = inspectIntegrity(db, startBlock);
  if (!integrity.contiguous) {
    throw new Error(
      `[analytics] local database has gaps (${formatIntegrity(integrity)}); refusing to append`,
    );
  }
  await rewindIfReorg(db, source, startBlock);
  const derived = derivePending(db, chunkSize);
  if (derived > 0) log(`derived ${derived} actions for blocks already stored`);

  const proven = await source.provenTip();
  let from = (blockTip(db)?.number ?? startBlock - 1) + 1;
  if (from > proven) {
    log(`local block ${from - 1} matches proven tip ${proven}`);
    return;
  }
  while (from <= proven) {
    const to = Math.min(from + chunkSize - 1, proven);
    const written = await syncChunk(db, source, from, to);
    const actions = derivePending(db, chunkSize);
    log(
      `synced ${written.from}-${written.to} (${written.logs} events, ${actions} actions)`,
    );
    if (written.to < to) break;
    from = written.to + 1;
  }
}

function formatIntegrity(integrity: {
  holes: string[];
  eventsOutside: number;
}): string {
  const parts = [...integrity.holes];
  if (integrity.eventsOutside > 0) {
    parts.push(`${integrity.eventsOutside} events outside synced blocks`);
  }
  return parts.join(", ") || "unknown";
}

async function rewindIfReorg(
  db: Database.Database,
  source: ChainSource,
  startBlock: number,
): Promise<void> {
  const tip = blockTip(db);
  if (!tip) return;
  const remote = await source.block(tip.number);
  if (!remote) {
    throw new Error(
      `[analytics] block ${tip.number} hash unavailable on node; pausing sync`,
    );
  }
  if (sameHash(remote.hash, tip.hash)) return;
  const fork = await findLastMatchingBlock(db, source, startBlock, tip.number);
  deleteAfter(db, fork);
}

async function findLastMatchingBlock(
  db: Database.Database,
  source: ChainSource,
  startBlock: number,
  tip: number,
): Promise<number> {
  let lo = startBlock - 1;
  let hi = tip;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const local = blockRow(db, mid);
    const remote = await source.block(mid);
    if (!local || !remote) {
      throw new Error(
        `[analytics] block ${mid} hash unavailable; pausing sync`,
      );
    }
    if (sameHash(local.hash, remote.hash)) lo = mid;
    else hi = mid;
  }
  return lo;
}

async function syncChunk(
  db: Database.Database,
  source: ChainSource,
  from: number,
  to: number,
): Promise<{ from: number; to: number; logs: number }> {
  const anchor = await source.block(to);
  if (!anchor?.hash) {
    throw new Error(`[analytics] block ${to} has no hash; refusing to write`);
  }
  const logs = await source.logs(from, to, anchor);
  const blocks = new Map<number, ChainBlock>();
  for (const entry of logs) {
    if (entry.blockNumber < from || entry.blockNumber > to) continue;
    const known = blocks.get(entry.blockNumber);
    if (known && !sameHash(known.hash, entry.blockHash)) {
      throw new Error(
        `[analytics] block ${entry.blockNumber} has conflicting hashes`,
      );
    }
    if (!known) {
      blocks.set(entry.blockNumber, {
        number: entry.blockNumber,
        hash: entry.blockHash,
        timestamp: entry.blockTimestamp,
      });
    }
  }
  for (let number = from; number <= to; number += 1) {
    if (blocks.has(number)) continue;
    const header = await source.block(number);
    if (!header?.hash) {
      throw new Error(
        `[analytics] block ${number} has no hash; refusing to write`,
      );
    }
    blocks.set(number, header);
  }
  const ordered = [...blocks.values()].sort(
    (left, right) => left.number - right.number,
  );
  const inRange = logs.filter(
    (entry) => entry.blockNumber >= from && entry.blockNumber <= to,
  );
  writeChunk(db, ordered, inRange);
  return { from, to, logs: inRange.length };
}
