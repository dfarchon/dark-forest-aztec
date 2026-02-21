/**
 * TimestampProvider: gets L2 block timestamp for transaction inputs.
 *
 * Contract requires:
 *   timestamp <= actual_timestamp (= L2 block time)
 *   actual_timestamp - timestamp <= 300 (5 minute window)
 *   timestamp >= state.last_updated
 */

import type { AztecNode } from "@aztec/aztec.js/node";

export class TimestampProvider {
  private readonly node: AztecNode;

  constructor(node: AztecNode) {
    this.node = node;
  }

  /**
   * Get L2 block timestamp from the latest block.
   * Falls back to system clock if block data is unavailable.
   */
  async getTimestamp(): Promise<bigint> {
    try {
      const block = await (
        this.node as unknown as {
          getBlock: (n: number | "latest") => Promise<
            | {
                header?: {
                  globalVariables?: { timestamp?: unknown };
                };
                timestamp?: number;
              }
            | undefined
          >;
        }
      ).getBlock("latest");

      if (block?.header?.globalVariables?.timestamp != null) {
        const raw = block.header.globalVariables.timestamp;
        return typeof raw === "bigint"
          ? raw
          : BigInt(String(raw).replace(/n$/, ""));
      }

      if (block?.timestamp != null) {
        return BigInt(Number(block.timestamp));
      }
    } catch {
      /* fallback below */
    }

    return BigInt(Math.floor(Date.now() / 1000));
  }
}
