import {
    EventSelector,
    decodeFromAbi,
    type EventMetadataDefinition,
} from '@aztec/stdlib/abi';
import type { AztecNode } from '@aztec/aztec.js/node';

function decodeLogs<T>(
    logs: { log: { getEmittedFields: () => unknown[]; fields: unknown[] } }[],
    eventMetadataDef: EventMetadataDefinition
): T[] {
    const decoded: T[] = [];
    for (const log of logs) {
        const logFields = log.log.getEmittedFields();
        const lastField = logFields[logFields.length - 1];
        if (!EventSelector.fromField(lastField).equals(eventMetadataDef.eventSelector)) {
            continue;
        }
        const result = decodeFromAbi([eventMetadataDef.abiType], log.log.fields);
        decoded.push((Array.isArray(result) ? result[0] : result) as T);
    }
    return decoded;
}

/**
 * Returns decoded public events by tx hash (recommended when you know the tx).
 * Supports events with nested/large structs.
 */
export async function getDecodedPublicEventsByTxHash<T>(
    node: AztecNode,
    eventMetadataDef: EventMetadataDefinition,
    txHash: { toString: () => string }
): Promise<T[]> {
    const { logs } = await node.getPublicLogs({ txHash });
    return decodeLogs<T>(logs, eventMetadataDef);
}

/**
 * Returns decoded public events given block range.
 * Supports events with nested/large structs (unlike @aztec/aztec.js getDecodedPublicEvents
 * which fails when field count !== fieldNames.length + 1).
 *
 * @param node - The node to request events from
 * @param eventMetadataDef - Metadata of the event. e.g. Contract.events.EventName
 * @param from - The block number to search from
 * @param limit - The amount of blocks to search
 * @returns The deserialized events
 */
export async function getDecodedPublicEvents<T>(
    node: AztecNode,
    eventMetadataDef: EventMetadataDefinition,
    from: number,
    limit: number
): Promise<T[]> {
    const { logs } = await node.getPublicLogs({
        fromBlock: from,
        toBlock: from + limit,
    });
    return decodeLogs<T>(logs, eventMetadataDef);
}

