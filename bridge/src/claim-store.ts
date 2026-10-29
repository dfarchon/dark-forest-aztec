import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { claimsDir } from "./config.js";

export type ClaimRecord = {
  claimAmount: string;
  claimSecret: string;
  messageLeafIndex: string;
  messageHash: string;
  depositedAt: string;
  l1TransactionHash?: string;
  claimedAt?: string;
  l2TransactionHash?: string;
};

export type ClaimFile = {
  recipient: string;
  claims: ClaimRecord[];
};

export type PendingClaim = ClaimRecord & {
  recipient: string;
};

const claimFields = [
  "claimAmount",
  "claimSecret",
  "messageLeafIndex",
  "messageHash",
  "depositedAt",
] as const;

function claimPath(recipient: string): string {
  return path.join(claimsDir, `${recipient.toLowerCase()}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  value: Record<string, unknown>,
  key: "l1TransactionHash" | "claimedAt" | "l2TransactionHash",
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function toClaimRecord(value: Record<string, unknown>): ClaimRecord | undefined {
  for (const field of claimFields) {
    if (typeof value[field] !== "string" || value[field] === "") return undefined;
  }
  const claim: ClaimRecord = {
    claimAmount: value.claimAmount as string,
    claimSecret: value.claimSecret as string,
    messageLeafIndex: value.messageLeafIndex as string,
    messageHash: value.messageHash as string,
    depositedAt: value.depositedAt as string,
  };
  const l1TransactionHash = optionalString(value, "l1TransactionHash");
  const claimedAt = optionalString(value, "claimedAt");
  const l2TransactionHash = optionalString(value, "l2TransactionHash");
  if (l1TransactionHash) claim.l1TransactionHash = l1TransactionHash;
  if (claimedAt) claim.claimedAt = claimedAt;
  if (l2TransactionHash) claim.l2TransactionHash = l2TransactionHash;
  return claim;
}

export function normalizeClaimFile(parsed: unknown): ClaimFile {
  if (!isRecord(parsed)) throw new Error("Claim file is not an object.");

  if (Array.isArray(parsed.claims)) {
    if (typeof parsed.recipient !== "string" || parsed.recipient.length === 0) {
      throw new Error("Claim file is missing recipient.");
    }
    const claims = parsed.claims.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`Claim file entry ${index} is not an object.`);
      }
      const claim = toClaimRecord(entry);
      if (!claim) {
        throw new Error(`Claim file entry ${index} is missing required fields.`);
      }
      return claim;
    });
    return { recipient: parsed.recipient, claims };
  }

  const claim = toClaimRecord(parsed);
  if (claim && typeof parsed.recipient === "string" && parsed.recipient.length > 0) {
    return { recipient: parsed.recipient, claims: [claim] };
  }

  throw new Error("Unrecognized claim file format.");
}

export function appendClaim(file: ClaimFile, claim: ClaimRecord): ClaimFile {
  if (file.claims.some((existing) => existing.messageHash === claim.messageHash)) {
    throw new Error(
      `A claim with message hash ${claim.messageHash} is already stored for ${file.recipient}.`,
    );
  }
  return { recipient: file.recipient, claims: [...file.claims, claim] };
}

export function pendingClaims(file: ClaimFile): ClaimRecord[] {
  return file.claims.filter((entry) => !entry.claimedAt);
}

export function selectClaim(
  file: ClaimFile,
  selector?: string | { messageHash?: string; index?: number },
): ClaimRecord {
  const messageHash =
    typeof selector === "string" ? selector : selector?.messageHash;
  const index = typeof selector === "string" ? undefined : selector?.index;
  if (messageHash && index !== undefined) {
    throw new Error("Pass either a claim number or a message hash, not both.");
  }

  const pending = pendingClaims(file);
  if (index !== undefined) {
    const claim = pending[index - 1];
    if (!Number.isInteger(index) || !claim) {
      throw new Error(
        `No pending claim numbered ${index} for ${file.recipient}. Run \`pnpm status\` and pass that number to \`pnpm claim\`.`,
      );
    }
    return claim;
  }

  if (messageHash) {
    const claim = file.claims.find((entry) => entry.messageHash === messageHash);
    if (!claim) {
      throw new Error(
        `No claim with message hash ${messageHash} for ${file.recipient}. Run \`pnpm status\` to list pending claims.`,
      );
    }
    if (claim.claimedAt) {
      throw new Error(
        `Claim ${messageHash} for ${file.recipient} is already marked as completed.`,
      );
    }
    return claim;
  }

  if (pending.length === 0) {
    throw new Error(
      `No pending claim found for ${file.recipient}. Run \`pnpm deposit\` first.`,
    );
  }
  if (pending.length > 1) {
    throw new Error(
      `Multiple pending claims are stored for ${file.recipient}. Run \`pnpm status\` and pass that number to \`pnpm claim\`.`,
    );
  }
  return pending[0];
}

export function markClaimRecord(
  file: ClaimFile,
  messageHash: string,
  claimedAt: string,
  l2TransactionHash: string,
): ClaimFile {
  const index = file.claims.findIndex((entry) => entry.messageHash === messageHash);
  if (index === -1) {
    throw new Error(
      `No claim with message hash ${messageHash} for ${file.recipient}.`,
    );
  }
  const claims = file.claims.slice();
  claims[index] = { ...claims[index], claimedAt, l2TransactionHash };
  return { recipient: file.recipient, claims };
}

function writeClaimFile(file: ClaimFile): void {
  mkdirSync(claimsDir, { recursive: true, mode: 0o700 });
  const destination = claimPath(file.recipient);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, destination);
  try {
    chmodSync(destination, 0o600);
  } catch {
    // Windows does not implement POSIX permissions.
  }
}

export function loadClaims(recipient: string): ClaimFile {
  const destination = claimPath(recipient);
  if (!existsSync(destination)) {
    throw new Error(
      `No pending claim found for ${recipient}. Run \`pnpm deposit\` first.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(destination, "utf8")) as unknown;
  } catch {
    throw new Error(`Claim file for ${recipient} is not valid JSON.`);
  }
  const file = normalizeClaimFile(parsed);
  if (file.recipient.toLowerCase() !== recipient.toLowerCase()) {
    throw new Error(
      `Claim file recipient ${file.recipient} does not match ${recipient}.`,
    );
  }
  return file;
}

function claimRecord(claim: PendingClaim): ClaimRecord {
  const record: ClaimRecord = {
    claimAmount: claim.claimAmount,
    claimSecret: claim.claimSecret,
    messageLeafIndex: claim.messageLeafIndex,
    messageHash: claim.messageHash,
    depositedAt: claim.depositedAt,
  };
  if (claim.l1TransactionHash) record.l1TransactionHash = claim.l1TransactionHash;
  if (claim.claimedAt) record.claimedAt = claim.claimedAt;
  if (claim.l2TransactionHash) record.l2TransactionHash = claim.l2TransactionHash;
  return record;
}

export function saveClaim(claim: PendingClaim): void {
  const destination = claimPath(claim.recipient);
  const file = existsSync(destination)
    ? loadClaims(claim.recipient)
    : { recipient: claim.recipient, claims: [] };
  writeClaimFile(appendClaim(file, claimRecord(claim)));
}

export function markClaimed(
  recipient: string,
  messageHash: string,
  l2TransactionHash: string,
): void {
  const file = loadClaims(recipient);
  writeClaimFile(
    markClaimRecord(file, messageHash, new Date().toISOString(), l2TransactionHash),
  );
}
