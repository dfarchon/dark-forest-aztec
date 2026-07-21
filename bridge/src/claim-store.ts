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

export type PendingClaim = {
  recipient: string;
  claimAmount: string;
  claimSecret: string;
  messageLeafIndex: string;
  messageHash: string;
  depositedAt: string;
  l1TransactionHash?: string;
  claimedAt?: string;
};

function claimPath(recipient: string): string {
  return path.join(claimsDir, `${recipient.toLowerCase()}.json`);
}

export function saveClaim(claim: PendingClaim): void {
  mkdirSync(claimsDir, { recursive: true, mode: 0o700 });
  const destination = claimPath(claim.recipient);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(claim, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, destination);
  try {
    chmodSync(destination, 0o600);
  } catch {
    // Windows does not implement POSIX permissions.
  }
}

export function loadClaim(recipient: string): PendingClaim {
  const destination = claimPath(recipient);
  if (!existsSync(destination)) {
    throw new Error(
      `No pending claim found for ${recipient}. Run \`pnpm deposit\` first.`,
    );
  }
  return JSON.parse(readFileSync(destination, "utf8")) as PendingClaim;
}

export function markClaimed(claim: PendingClaim): void {
  saveClaim({ ...claim, claimedAt: new Date().toISOString() });
}
