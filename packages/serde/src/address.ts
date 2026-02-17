import type { AztecAddr } from "@dfpunk/types";

/**
 * Converts a string to an Aztec address: 0x-prefixed lowercase hex string
 * of 64 hex characters (32 bytes). Throws if the string cannot be parsed.
 *
 * @param str Address-like string (hex or decimal, with or without 0x)
 */
export function address(str: string): AztecAddr {
  let ret = str.toLowerCase();
  if (ret.startsWith("0x")) ret = ret.slice(2);
  for (const c of ret) {
    if ("0123456789abcdef".indexOf(c) === -1)
      throw new Error("not a valid address");
  }
  if (ret.length !== 64) throw new Error("not a valid address");
  return ("0x" + ret) as AztecAddr;
}

const HASH_INT_MASK = 0xffffffffffn;

/**
 * Extracts the low 40 bits of a hex hash string as a number.
 *
 * @param hash Hex string (with or without 0x prefix)
 */
export function hashToInt(hash: string): number {
  const hex = hash.startsWith("0x") ? hash : "0x" + hash;
  const n = BigInt(hex) & HASH_INT_MASK;
  return Number(n);
}
