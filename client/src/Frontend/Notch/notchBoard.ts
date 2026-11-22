import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { Fr } from "@aztec-labs/aztec.js/fields";
import type { AztecNode } from "@aztec-labs/aztec.js/node";
import { deriveStorageSlotInMap } from "@aztec-labs/stdlib/hash";

/**
 * Notch mainnet board. `get_post_count`, `get_post`, and `get_post_timestamp`
 * are public views over these storage slots (see the published mainnet
 * `df-read-config.json`, artifact hash dd636b5d…).
 */
export const NOTCH_BOARD_ADDRESS =
  "0x090065f980667a9f5273c8b7e7ff31d234c375bfc172539f43d2c91284717c78";
export const NOTCH_HOME_URL = "https://onenotch.xyz/";
export const NOTCH_BANNER_HEIGHT_PX = 28;
export const NOTCH_RECENT_LIMIT = 8;
export const NOTCH_POLL_MS = 60_000;

const POST_COUNT_SLOT = 2n;
const POST_LENGTHS_SLOT = 3n;
const POST_DATA_SLOT = 4n;
const POST_TIMESTAMPS_SLOT = 6n;
const TEXT_FIELDS = 17;
const FIELD_BYTES = 31;
const MAX_BYTES = 512;
const MAX_TIMESTAMP_SECONDS = 8_640_000_000_000;
const TICKER_MAX_CHARS = 160;
const READ_CONCURRENCY = 2;

/** dRPC accepts at most three JSON-RPC calls in one HTTP batch. */
export function notchNodeOptions(
  url: string
): { maxBatchSize?: number } | undefined {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "drpc.org" || hostname.endsWith(".drpc.org")) {
    return { maxBatchSize: 3 };
  }
  return undefined;
}

const boardAddress = AztecAddress.fromStringUnsafe(NOTCH_BOARD_ADDRESS);

export interface NotchPost {
  id: number;
  text: string;
  /** Unix seconds, when the board stored a usable timestamp. */
  publishedAt?: number;
}

export interface NotchFeed {
  nodeUrl: string;
  total: number;
  posts: NotchPost[];
}

/** Packs UTF-8 the way the board's `post` function writes `get_post`. */
export function packNotchMessage(message: string): {
  fields: bigint[];
  length: number;
} {
  const bytes = new TextEncoder().encode(message);
  if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== message) {
    throw new Error("Invalid Unicode text");
  }
  if (!bytes.length || bytes.length > MAX_BYTES) {
    throw new Error("Message must be 1–512 UTF-8 bytes");
  }
  const fields: bigint[] = [];
  for (let field = 0; field < TEXT_FIELDS; field++) {
    let value = 0n;
    for (let byteIndex = 0; byteIndex < FIELD_BYTES; byteIndex++) {
      const index = field * FIELD_BYTES + byteIndex;
      const byte = index < bytes.length ? BigInt(bytes[index]) : 0n;
      value = value * 256n + byte;
    }
    fields.push(value);
  }
  return { fields, length: bytes.length };
}

/** Decodes the `([Field; 17], length)` value returned by `get_post`. */
export function decodeNotchMessage(
  fields: readonly bigint[],
  length: number
): string {
  if (
    !Number.isInteger(length) ||
    length < 1 ||
    length > MAX_BYTES ||
    fields.length !== TEXT_FIELDS
  ) {
    throw new Error("Invalid message shape");
  }
  const bytes = new Uint8Array(TEXT_FIELDS * FIELD_BYTES);
  fields.forEach((field, fieldIndex) => {
    let value = field;
    if (value < 0n || value >= 1n << 248n) {
      throw new Error("Invalid packed field");
    }
    for (let byteIndex = FIELD_BYTES - 1; byteIndex >= 0; byteIndex--) {
      bytes[fieldIndex * FIELD_BYTES + byteIndex] = Number(value & 255n);
      value >>= 8n;
    }
  });
  if (bytes.slice(length).some((byte) => byte !== 0)) {
    throw new Error("Nonzero padding");
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes.slice(0, length)
  );
}

/** One line for the banner: collapsed whitespace, then a hard cap. */
export function notchTickerText(
  text: string,
  maxChars = TICKER_MAX_CHARS
): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Local clock first, then the date, for example "17:30 Nov 22". */
export function formatNotchTime(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short" });
  return `${hours}:${minutes} ${month} ${date.getDate()}`;
}

export function formatNotchTickerItem(post: NotchPost): string {
  const text = notchTickerText(post.text);
  if (post.publishedAt == null) return `#${post.id}  ${text}`;
  return `#${post.id}  ${text}  ${formatNotchTime(post.publishedAt)}`;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  read: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await read(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function readPost(
  node: AztecNode,
  block: Awaited<ReturnType<AztecNode["getBlockNumber"]>>,
  id: number
): Promise<NotchPost | undefined> {
  const lengthSlot = await deriveStorageSlotInMap(
    new Fr(POST_LENGTHS_SLOT),
    new Fr(BigInt(id))
  );
  const dataSlots = await Promise.all(
    Array.from({ length: TEXT_FIELDS }, (_, index) =>
      deriveStorageSlotInMap(
        new Fr(POST_DATA_SLOT),
        new Fr(BigInt(id * TEXT_FIELDS + index))
      )
    )
  );
  const timeSlot = await deriveStorageSlotInMap(
    new Fr(POST_TIMESTAMPS_SLOT),
    new Fr(BigInt(id))
  );
  const values = await Promise.all(
    [lengthSlot, ...dataSlots, timeSlot].map((slot) =>
      node.getPublicStorageAt(block, boardAddress, slot)
    )
  );
  const length = Number(values[0].toBigInt());
  let text: string;
  try {
    text = decodeNotchMessage(
      values.slice(1, 1 + TEXT_FIELDS).map((field) => field.toBigInt()),
      length
    );
  } catch {
    return undefined;
  }
  if (!notchTickerText(text)) return undefined;
  const post: NotchPost = { id, text };
  const timestamp = Number(values[1 + TEXT_FIELDS].toBigInt());
  if (
    Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp <= MAX_TIMESTAMP_SECONDS
  ) {
    post.publishedAt = timestamp;
  }
  return post;
}

/**
 * Reads `get_post_count()`, then the latest posts via `get_post(id)` and
 * `get_post_timestamp(id)`. When `previous` is the same node and the same
 * count, the stored posts are reused.
 */
export async function readRecentNotchPosts(
  node: AztecNode,
  nodeUrl: string,
  previous?: NotchFeed
): Promise<NotchFeed> {
  const block = await node.getBlockNumber();
  const total = Number(
    (
      await node.getPublicStorageAt(
        block,
        boardAddress,
        new Fr(POST_COUNT_SLOT)
      )
    ).toBigInt()
  );
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("Invalid post count");
  }
  if (previous?.nodeUrl === nodeUrl && previous.total === total) {
    return previous;
  }
  const ids: number[] = [];
  for (
    let id = total - 1;
    id >= Math.max(0, total - NOTCH_RECENT_LIMIT);
    id--
  ) {
    ids.push(id);
  }
  const posts = (
    await mapLimited(ids, READ_CONCURRENCY, (id) => readPost(node, block, id))
  ).filter((post): post is NotchPost => post !== undefined);
  return { nodeUrl, total, posts };
}
