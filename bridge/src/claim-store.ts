import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

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

// Written before any L1 transaction, and retained on all ambiguous failures.
export type PreparedDeposit = {
  recipient: string;
  claimAmount: string;
  claimSecret: string;
  claimSecretHash: string;
  l1ChainId: number;
  portalAddress: string;
  l1Address: string;
  preparedAt: string;
};

export class ClaimStore {
  constructor(private readonly directory: string) {}

  private file(recipient: string, suffix = ".json"): string {
    if (!/^0x[0-9a-f]+$/i.test(recipient))
      throw new Error("Invalid claim recipient.");
    return path.join(this.directory, `${recipient.toLowerCase()}${suffix}`);
  }

  private read<T>(file: string): T | undefined {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error; // Never treat a corrupt record as an empty slot.
    }
  }

  private syncDirectory(directory = this.directory): void {
    if (process.platform === "win32") return;
    const fd = openSync(directory, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  private write(file: string, value: unknown): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
        flush: true,
      });
      renameSync(temporary, file);
      this.syncDirectory();
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }

  // Serialize mutations across CLI processes. A crash leaves a lock for manual
  // inspection instead of allowing another process to risk overwriting secrets.
  private locked<T>(recipient: string, action: () => T): T {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Persist the claims directory entry as well as the files it will contain.
    this.syncDirectory(path.dirname(this.directory));
    const lock = this.file(recipient, ".lock");
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `Claim store is locked for ${recipient}; inspect the existing process before retrying.`,
        );
      }
      throw error;
    }
    try {
      return action();
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }

  loadDeposit(recipient: string): PreparedDeposit | undefined {
    return this.read<PreparedDeposit>(this.file(recipient, ".deposit.json"));
  }

  loadClaim(recipient: string): PendingClaim {
    const claim = this.read<PendingClaim>(this.file(recipient));
    if (!claim) throw new Error(`No pending claim found for ${recipient}.`);
    return claim;
  }

  prepareDeposit(deposit: PreparedDeposit): void {
    this.locked(deposit.recipient, () => {
      if (this.loadDeposit(deposit.recipient)) {
        throw new Error(
          "An unresolved deposit exists. Recover its receipt before depositing again.",
        );
      }
      const previous = this.read<PendingClaim>(this.file(deposit.recipient));
      if (previous && !previous.claimedAt) {
        throw new Error(
          "An unclaimed deposit exists. Claim it before depositing again.",
        );
      }
      this.write(this.file(deposit.recipient, ".deposit.json"), deposit);
    });
  }

  completeDeposit(claim: PendingClaim): void {
    this.locked(claim.recipient, () => {
      const deposit = this.loadDeposit(claim.recipient);
      if (
        !deposit ||
        deposit.claimSecret !== claim.claimSecret ||
        deposit.claimAmount !== claim.claimAmount ||
        deposit.recipient.toLowerCase() !== claim.recipient.toLowerCase()
      ) {
        throw new Error("Claim does not match the prepared deposit.");
      }
      const previous = this.read<PendingClaim>(this.file(claim.recipient));
      if (previous && previous.messageHash === claim.messageHash) {
        if (previous.claimSecret !== claim.claimSecret)
          throw new Error("Stored claim secret mismatch.");
        // Idempotent recovery after a crash between writing and journal removal.
        // Never revert an already completed claim to pending.
      } else {
        if (previous && !previous.claimedAt)
          throw new Error("Refusing to overwrite an unclaimed deposit.");
        if (previous) {
          const id = createHash("sha256")
            .update(previous.messageHash)
            .digest("hex");
          this.write(
            this.file(claim.recipient, `.${id}.claimed.json`),
            previous,
          );
        }
        this.write(this.file(claim.recipient), claim);
      }
      unlinkSync(this.file(claim.recipient, ".deposit.json"));
      this.syncDirectory();
    });
  }

  markClaimed(claim: PendingClaim): void {
    this.locked(claim.recipient, () => {
      const current = this.loadClaim(claim.recipient);
      if (
        current.messageHash !== claim.messageHash ||
        current.claimSecret !== claim.claimSecret
      ) {
        throw new Error("Claim changed while the transaction was in progress.");
      }
      this.write(this.file(claim.recipient), {
        ...current,
        claimedAt: current.claimedAt ?? new Date().toISOString(),
      });
    });
  }
}
