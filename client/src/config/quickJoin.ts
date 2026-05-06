/**
 * Quick join: optional default local account (address hex) stored in localStorage.
 * When unset, Quick join uses the newest local account by `createdAt`.
 */

import type { AccountRecord } from "../Session/WalletManager/types";

const STORAGE_KEY_QUICK_JOIN_DEFAULT = "dfpunk:quickJoinDefaultAccount";

export function getQuickJoinDefaultAccount(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY_QUICK_JOIN_DEFAULT);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setQuickJoinDefaultAccount(address: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_QUICK_JOIN_DEFAULT, address);
  } catch {
    /* storage full or unavailable */
  }
}

export function clearQuickJoinDefaultAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_QUICK_JOIN_DEFAULT);
  } catch {
    /* noop */
  }
}

/**
 * Pick the account Quick join should use: saved default if still present,
 * otherwise the account with the largest `createdAt`.
 */
export function resolveQuickJoinAccount(
  accounts: AccountRecord[]
): AccountRecord | undefined {
  if (accounts.length === 0) return undefined;

  const preferred = getQuickJoinDefaultAccount();
  if (preferred) {
    const found = accounts.find((a) => a.address === preferred);
    if (found) return found;
  }

  return accounts.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
}
