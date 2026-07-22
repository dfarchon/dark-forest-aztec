import type { AztecNode } from '@aztec/aztec.js/node';
import { createAztecNodeClient } from '@aztec/aztec.js/node';

const NULLABLE_METHODS = new Set<PropertyKey>([
    'getContract',
    'getContractClass',
    'getNullifierMembershipWitness',
]);

function isDrpcEmptyResultError(error: unknown): boolean {
    const rpcError = error as {
        code?: unknown;
        cause?: { code?: unknown };
    };

    return (
        error instanceof Error &&
        error.message.includes('Temporary internal error') &&
        (rpcError.code === 19 || rpcError.cause?.code === 19)
    );
}

/**
 * dRPC's Aztec gateway cannot represent empty JSON-RPC results. It returns
 * "Temporary internal error" (code 19) when nullable node methods return
 * undefined, so restore the node's intended response for those methods.
 */
export function createTolerantAztecNodeClient(url: string): AztecNode {
    const node = createAztecNodeClient(url);

    return new Proxy(node, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (
                !NULLABLE_METHODS.has(property) ||
                typeof value !== 'function'
            ) {
                return value;
            }

            return async (...args: unknown[]) => {
                try {
                    return await value.apply(target, args);
                } catch (error) {
                    if (isDrpcEmptyResultError(error)) return undefined;
                    throw error;
                }
            };
        },
    });
}
