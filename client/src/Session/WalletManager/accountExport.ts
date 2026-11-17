import type { AccountRecord } from "./types";

/** The player guide also runs for personal accounts; only shared booth accounts are excluded. */
export function canExportAccount(
  account: AccountRecord | null | undefined
): account is AccountRecord {
  return Boolean(account && account.purpose !== "exhibition");
}
