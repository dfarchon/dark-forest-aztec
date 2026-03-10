function isTransientConfirmationError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const text = message.toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("ismined") ||
    text.includes("tx dropped by p2p node") ||
    text.includes("pruning data after block") ||
    text.includes("due to reorg")
  );
}

export interface WaitForReceiptWithRetryOptions<T> {
  methodName: string;
  waitForReceipt: () => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
  timeoutSeconds: number;
  maxAttempts?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_500;

export async function waitForReceiptWithRetry<T>({
  methodName,
  waitForReceipt,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutSeconds,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: WaitForReceiptWithRetryOptions<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await waitForReceipt();
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < maxAttempts && isTransientConfirmationError(error);

      if (!shouldRetry) {
        throw error;
      }

      console.warn(
        `[TxExecutor] waitForTx transient failure for ${methodName} (attempt ${attempt}/${maxAttempts}, timeout ${timeoutSeconds}s):`,
        error instanceof Error ? error.message : error
      );
      await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
