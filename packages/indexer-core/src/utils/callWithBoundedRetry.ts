/**
 * Bounded retry for one node read. A timed-out promise cannot be reused, so
 * each attempt starts a new request and, when configured, a new timeout.
 */

/** One original attempt plus two retries. Outer IndexerService backoff still handles a dead node. */
const NODE_CALL_MAX_ATTEMPTS = 3;
/** Wait before attempt 2, then attempt 3. */
const NODE_CALL_RETRY_DELAYS_MS = [1_000, 2_000];

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rejects if `p` does not settle within `ms`. A late rejection of `p` is swallowed
 * so it cannot surface as an unhandled rejection after the timeout already won.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`[AztecNodeSource] ${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  p.catch(() => {});
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function hasRetryableNetworkCode(err: unknown, depth = 0): boolean {
  if (depth > 5 || err == null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code)) {
    return true;
  }
  return hasRetryableNetworkCode((err as { cause?: unknown }).cause, depth + 1);
}

/**
 * Timeouts and transport failures are worth another attempt. A decode error,
 * a missing block hash, or a rejected reference block is not: the same request
 * will fail again, and the caller should re-read the tip.
 */
function isRetryableNodeError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || /timed out/i.test(err.message)) {
    return true;
  }
  if (hasRetryableNetworkCode(err)) return true;
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
    return true;
  }
  return /\b(econnreset|econnrefused|etimedout|socket hang up|fetch failed|network error)\b/i.test(
    err.message,
  );
}

export interface NodeCallRetryOptions {
  label: string;
  /** Per-attempt timeout. Unset means wait for the node. */
  timeoutMs?: number;
  /** Test hook. Production waits NODE_CALL_RETRY_DELAYS_MS. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Gives up after NODE_CALL_MAX_ATTEMPTS and throws the last error.
 */
export async function callWithBoundedRetry<T>(
  fn: () => Promise<T>,
  options: NodeCallRetryOptions,
): Promise<T> {
  const sleep = options.sleep ?? delay;
  let lastError: unknown;
  for (let attempt = 1; attempt <= NODE_CALL_MAX_ATTEMPTS; attempt++) {
    try {
      const pending = fn();
      if (options.timeoutMs !== undefined) {
        return await withTimeout(pending, options.timeoutMs, options.label);
      }
      return await pending;
    } catch (err) {
      lastError = err;
      const waitMs = NODE_CALL_RETRY_DELAYS_MS[attempt - 1];
      if (
        attempt >= NODE_CALL_MAX_ATTEMPTS ||
        waitMs === undefined ||
        !isRetryableNodeError(err)
      ) {
        throw err;
      }
      console.warn(
        `[AztecNodeSource] ${options.label} failed (attempt ${attempt}), retry in ${waitMs}ms:`,
        err,
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}
