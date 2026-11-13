/**
 * Witness maps are hundreds of thousands of hex strings. Structured-cloning
 * that map blocks the main thread, so circuits cross the worker boundary as
 * one transferable buffer instead.
 *
 * Layout, little-endian: uint32 count, then repeated uint32 index, uint16
 * byte length, and that many latin1 bytes.
 */

const HEADER_BYTES = 4;
const ENTRY_HEADER_BYTES = 6;
const YIELD_EVERY = 2_000;
const DEFAULT_BASE64_CHUNK = 256 * 1024;

export function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function writeWitness(
  witness: Map<number, string>,
  out: Uint8Array,
  view: DataView
): void {
  view.setUint32(0, witness.size, true);
  let offset = HEADER_BYTES;
  for (const [index, value] of witness) {
    if (value.length > 0xffff) {
      throw new Error("witness value is too long");
    }
    view.setUint32(offset, index, true);
    view.setUint16(offset + 4, value.length, true);
    offset += ENTRY_HEADER_BYTES;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code > 255) {
        throw new Error("witness value is not a byte string");
      }
      out[offset++] = code;
    }
  }
}

function witnessByteLength(witness: Map<number, string>): number {
  let bytes = HEADER_BYTES;
  for (const value of witness.values()) {
    if (value.length > 0xffff) {
      throw new Error("witness value is too long");
    }
    bytes += ENTRY_HEADER_BYTES + value.length;
  }
  return bytes;
}

export function packWitnessSync(witness: Map<number, string>): ArrayBuffer {
  const buffer = new ArrayBuffer(witnessByteLength(witness));
  writeWitness(witness, new Uint8Array(buffer), new DataView(buffer));
  return buffer;
}

/** Packs on the main thread, yielding so a large map does not freeze a frame. */
export async function packWitness(
  witness: Map<number, string>
): Promise<ArrayBuffer> {
  let seen = 0;
  for (const value of witness.values()) {
    if (value.length > 0xffff) {
      throw new Error("witness value is too long");
    }
    seen++;
    if (seen % YIELD_EVERY === 0) await yieldToUi();
  }
  const buffer = new ArrayBuffer(witnessByteLength(witness));
  const out = new Uint8Array(buffer);
  const view = new DataView(buffer);
  view.setUint32(0, witness.size, true);
  let offset = HEADER_BYTES;
  seen = 0;
  for (const [index, value] of witness) {
    view.setUint32(offset, index, true);
    view.setUint16(offset + 4, value.length, true);
    offset += ENTRY_HEADER_BYTES;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code > 255) {
        throw new Error("witness value is not a byte string");
      }
      out[offset++] = code;
    }
    seen++;
    if (seen % YIELD_EVERY === 0) await yieldToUi();
  }
  return buffer;
}

function readWitness(buffer: ArrayBuffer): Map<number, string> {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("witness buffer is truncated");
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const size = view.getUint32(0, true);
  const witness = new Map<number, string>();
  let offset = HEADER_BYTES;
  for (let n = 0; n < size; n++) {
    if (offset + ENTRY_HEADER_BYTES > bytes.length) {
      throw new Error("witness buffer is truncated");
    }
    const index = view.getUint32(offset, true);
    const len = view.getUint16(offset + 4, true);
    offset += ENTRY_HEADER_BYTES;
    if (offset + len > bytes.length) {
      throw new Error("witness buffer is truncated");
    }
    let value = "";
    for (let i = 0; i < len; i++) {
      value += String.fromCharCode(bytes[offset + i] ?? 0);
    }
    offset += len;
    witness.set(index, value);
  }
  if (offset !== bytes.length) {
    throw new Error("witness buffer has trailing bytes");
  }
  return witness;
}

export function unpackWitnessSync(buffer: ArrayBuffer): Map<number, string> {
  return readWitness(buffer);
}

/** Rebuilds the map in slices so the solved witness does not freeze the UI. */
export async function unpackWitness(
  buffer: ArrayBuffer
): Promise<Map<number, string>> {
  if (buffer.byteLength < HEADER_BYTES) {
    throw new Error("witness buffer is truncated");
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const size = view.getUint32(0, true);
  const witness = new Map<number, string>();
  let offset = HEADER_BYTES;
  for (let n = 0; n < size; n++) {
    if (offset + ENTRY_HEADER_BYTES > bytes.length) {
      throw new Error("witness buffer is truncated");
    }
    const index = view.getUint32(offset, true);
    const len = view.getUint16(offset + 4, true);
    offset += ENTRY_HEADER_BYTES;
    if (offset + len > bytes.length) {
      throw new Error("witness buffer is truncated");
    }
    let value = "";
    for (let i = 0; i < len; i++) {
      value += String.fromCharCode(bytes[offset + i] ?? 0);
    }
    offset += len;
    witness.set(index, value);
    if ((n + 1) % YIELD_EVERY === 0) await yieldToUi();
  }
  if (offset !== bytes.length) {
    throw new Error("witness buffer has trailing bytes");
  }
  return witness;
}

/**
 * Protocol circuit bytecode arrives as base64. Decoding a multi-megabyte
 * string in one shot drops a frame, so it is split on 4-character boundaries.
 */
export async function decodeBase64(
  value: string,
  chunkChars = DEFAULT_BASE64_CHUNK
): Promise<Uint8Array> {
  if (chunkChars % 4 !== 0) {
    throw new Error("base64 chunk must be a multiple of 4");
  }
  if (value.length === 0) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < value.length; i += chunkChars) {
    const binary = atob(value.slice(i, i + chunkChars));
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) {
      bytes[j] = binary.charCodeAt(j);
    }
    chunks.push(bytes);
    total += binary.length;
    if (i + chunkChars < value.length) await yieldToUi();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** A fresh buffer, so transferring it into the worker cannot detach the original. */
export function copyBytes(source: Uint8Array): Uint8Array {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
