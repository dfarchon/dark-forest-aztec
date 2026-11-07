import type { EventTableName, SqlValue } from "./tables.ts";

export interface ChainBlock {
  number: number;
  hash: string;
  timestamp: number;
}

/** One decoded storage log. tx_index + log_index locate it inside the block. */
export interface ChainLog {
  table: EventTableName;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  txHash: string | null;
  txIndex: number;
  logIndex: number;
  id: string;
  state: Record<string, SqlValue>;
}

export interface ChainSource {
  provenTip(): Promise<number>;
  proposedTip(): Promise<number>;
  block(number: number): Promise<ChainBlock | undefined>;
  /** Logs in [from, toInclusive], pinned to the hash of `anchor`. */
  logs(
    from: number,
    toInclusive: number,
    anchor: ChainBlock,
  ): Promise<ChainLog[]>;
}

export interface ActionRow {
  blockNumber: number;
  timestamp: number;
  player: string;
  action: string;
  subject: string;
  quantity: string | null;
  txHash: string | null;
  sourceTable: EventTableName;
  sourceTxIndex: number;
  sourceLogIndex: number;
  ambiguous: number;
}

export function sameHash(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function canonicalAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isZeroHex(value: string): boolean {
  const v = canonicalAddress(value);
  if (v === "" || v === "0" || v === "0x" || v === "0x0") return true;
  const hex = v.startsWith("0x") ? v.slice(2) : v;
  return /^[0-9a-f]+$/.test(hex) && /^0+$/.test(hex);
}

export function asNumber(value: SqlValue | bigint | undefined): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `[analytics] integer does not fit a safe number: ${value}`,
      );
    }
    return Number(value);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[analytics] not a number: ${value}`);
  }
  return parsed;
}

export function asBigInt(value: SqlValue | undefined): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value === "number") return BigInt(value);
  return BigInt(value);
}

export function asText(value: SqlValue | undefined): string {
  if (value === undefined || value === null) return "0";
  return String(value);
}
