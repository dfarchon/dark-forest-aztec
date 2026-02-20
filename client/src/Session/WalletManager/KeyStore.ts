/**
 * KeyStore: synchronous localStorage persistence for AccountRecords.
 *
 * Data layout in localStorage:
 *   {prefix}:accounts  → JSON array of AccountRecord
 *   {prefix}:active    → address hex string of the active account
 */

import type { AccountRecord } from "./types";

const DEFAULT_PREFIX = "dfpunk";

function isValidRecord(r: unknown): r is AccountRecord {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.address === "string" &&
    o.address.length > 0 &&
    typeof o.secretKey === "string" &&
    o.secretKey.length > 0 &&
    typeof o.salt === "string" &&
    o.salt.length > 0 &&
    typeof o.signingKey === "string" &&
    o.signingKey.length > 0 &&
    typeof o.createdAt === "number"
  );
}

export class KeyStore {
  private readonly accountsKey: string;
  private readonly activeKey: string;

  constructor(prefix?: string) {
    const p = prefix ?? DEFAULT_PREFIX;
    this.accountsKey = `${p}:accounts`;
    this.activeKey = `${p}:active`;
  }

  // ---------------------------------------------------------------------------
  // Account CRUD
  // ---------------------------------------------------------------------------

  /** Save or update an account record (deduped by address). */
  saveAccount(record: AccountRecord): void {
    if (!isValidRecord(record)) {
      throw new Error(
        "KeyStore: invalid AccountRecord — missing required fields"
      );
    }
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.address === record.address);
    if (idx >= 0) {
      accounts[idx] = record;
    } else {
      accounts.push(record);
    }
    this.writeAccounts(accounts);
  }

  removeAccount(address: string): void {
    const accounts = this.readAccounts().filter((a) => a.address !== address);
    this.writeAccounts(accounts);
    if (this.getActiveAddress() === address) {
      this.clearActiveAddress();
    }
  }

  getAccount(address: string): AccountRecord | null {
    return this.readAccounts().find((a) => a.address === address) ?? null;
  }

  /** List all accounts, sorted by createdAt ascending. */
  listAccounts(): AccountRecord[] {
    return this.readAccounts().sort((a, b) => a.createdAt - b.createdAt);
  }

  // ---------------------------------------------------------------------------
  // Active account pointer
  // ---------------------------------------------------------------------------

  getActiveAddress(): string | null {
    try {
      return localStorage.getItem(this.activeKey);
    } catch {
      return null;
    }
  }

  setActiveAddress(address: string): void {
    try {
      localStorage.setItem(this.activeKey, address);
    } catch {
      /* storage full or unavailable */
    }
  }

  clearActiveAddress(): void {
    try {
      localStorage.removeItem(this.activeKey);
    } catch {
      /* noop */
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk
  // ---------------------------------------------------------------------------

  clear(): void {
    try {
      localStorage.removeItem(this.accountsKey);
      localStorage.removeItem(this.activeKey);
    } catch {
      /* noop */
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private readAccounts(): AccountRecord[] {
    try {
      const raw = localStorage.getItem(this.accountsKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidRecord);
    } catch {
      return [];
    }
  }

  private writeAccounts(accounts: AccountRecord[]): void {
    try {
      localStorage.setItem(this.accountsKey, JSON.stringify(accounts));
    } catch {
      /* storage full or unavailable */
    }
  }
}
