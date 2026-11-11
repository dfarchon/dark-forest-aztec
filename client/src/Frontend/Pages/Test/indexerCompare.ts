/**
 * Test-page helper that freezes a chain source at one block.
 * Not used by the game.
 */

import type { IBlockEventSource } from "@dfpunk/indexer-core";

export const TIP_TAGS = [
  "proposed",
  "checkpointed",
  "proven",
  "finalized",
] as const;

export type TipTag = (typeof TIP_TAGS)[number];

/** Chain source whose tip and block ranges never pass maxBlock. */
export function capBlockSource(
  inner: IBlockEventSource,
  maxBlock: number
): IBlockEventSource {
  const capped: IBlockEventSource = {
    getLatestBlockNumber: async () =>
      Math.min(await inner.getLatestBlockNumber(), maxBlock),
    getBlockUpdates: (fromBlock, toBlock) =>
      inner.getBlockUpdates(fromBlock, Math.min(toBlock, maxBlock)),
  };
  if (inner.getBlockHash) {
    const getBlockHash = inner.getBlockHash;
    capped.getBlockHash = (blockNumber) =>
      getBlockHash.call(inner, blockNumber);
  }
  if (inner.getSnapshot) {
    const getSnapshot = inner.getSnapshot;
    capped.getSnapshot = (toBlock) => getSnapshot.call(inner, toBlock);
  }
  return capped;
}
