/**
 * Exclusive cross-tab lock for the embedded browser wallet.
 *
 * Aztec's sqlite-opfs SAH Pool holds FileSystemSyncAccessHandle locks that
 * cannot be shared across tabs. We claim a Web Lock before opening OPFS so a
 * second tab fails fast with a clear error instead of NoModificationAllowedError.
 */

const LOCK_NAME = "dfpunk-embedded-wallet";

export const WALLET_SESSION_CONFLICT_MESSAGE =
  "Another tab is already using this wallet.";

export const WALLET_SESSION_CONFLICT_HINT =
  "Close the other tab, then refresh this page.";

export class WalletSessionLockedError extends Error {
  constructor(message = WALLET_SESSION_CONFLICT_MESSAGE) {
    super(message);
    this.name = "WalletSessionLockedError";
  }
}

let held = false;
let releaseHold: (() => void) | undefined;

/**
 * Acquire an exclusive session lock for this tab's lifetime.
 * No-ops if already held in this tab, or if Web Locks API is unavailable.
 */
export async function acquireWalletSessionLock(): Promise<void> {
  if (held) {
    return;
  }

  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return;
  }

  const acquired = await new Promise<boolean>((resolve, reject) => {
    navigator.locks
      .request(
        LOCK_NAME,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }

          held = true;
          await new Promise<void>((holdResolve) => {
            releaseHold = holdResolve;
            resolve(true);
          });
          held = false;
          releaseHold = undefined;
        }
      )
      .catch(reject);
  });

  if (!acquired) {
    throw new WalletSessionLockedError();
  }

  // Release promptly on navigation/close so another tab can acquire sooner.
  window.addEventListener(
    "pagehide",
    () => {
      releaseHold?.();
    },
    { once: true }
  );
}

/** True when the error is (or wraps) a multi-tab wallet / OPFS lock conflict. */
export function isWalletSessionConflictError(err: unknown): boolean {
  if (err instanceof WalletSessionLockedError) {
    return true;
  }

  if (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "NoModificationAllowedError"
  ) {
    return true;
  }

  if (err instanceof Error && err.name === "NoModificationAllowedError") {
    return true;
  }

  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("createSyncAccessHandle") ||
    msg.includes("Access Handles cannot be created")
  );
}
