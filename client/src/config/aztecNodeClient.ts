/**
 * Aztec node JSON-RPC client with batching disabled.
 *
 * dRPC's free plan rejects JSON-RPC batches larger than 3 requests.
 * Aztec's createAztecNodeClient defaults to maxBatchSize 100 and does not
 * expose that option, so we construct the client directly with maxBatchSize 1.
 */

import type { AztecNode } from "@aztec/aztec.js/node";
import {
  createSafeJsonRpcClient,
  makeFetch,
} from "@aztec/foundation/json-rpc/client";
import { AztecNodeApiSchema } from "@aztec/stdlib/interfaces/client";
import { getVersioningResponseHandler } from "@aztec/stdlib/versioning";

/** One JSON-RPC call per HTTP request — stays within dRPC free-plan limits. */
const MAX_BATCH_SIZE = 1;

export function createUnbatchedAztecNodeClient(url: string): AztecNode {
  return createSafeJsonRpcClient<AztecNode>(url, AztecNodeApiSchema, {
    namespaceMethods: "aztec",
    fetch: makeFetch([1, 2, 3], false),
    batchWindowMS: 0,
    maxBatchSize: MAX_BATCH_SIZE,
    onResponse: getVersioningResponseHandler({}),
  });
}
