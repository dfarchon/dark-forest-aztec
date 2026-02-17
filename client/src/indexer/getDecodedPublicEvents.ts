/**
 * Custom event decoder that fixes the Aztec.js payload length mismatch bug.
 *
 * The standard getDecodedPublicEvents uses fieldNames.length + 1 for expected length,
 * but fieldNames only counts top-level fields. Nested types (e.g. array<2>) flatten
 * to multiple fields, so NewGame/JoinedGame with initial_state: [Field; 2] actually
 * emit 5 fields (4 data + 1 selector), not 4.
 *
 * This implementation: (1) checks EventSelector first to skip irrelevant logs,
 * (2) skips the buggy length check, (3) tries decode - matching logs decode correctly.
 */
import {
  decodeFromAbi,
  type EventMetadataDefinition,
  EventSelector,
} from "@aztec/stdlib/abi";
import type { AztecNode } from "@aztec/stdlib/interfaces/client";

export type LogFilter = {
  fromBlock?: number;
  toBlock?: number;
  contractAddress?: import("@aztec/aztec.js/addresses").AztecAddress;
};

/**
 * Returns decoded public events. Fixes the "Expected 4. Got 5" payload length
 * mismatch by checking EventSelector first and skipping the buggy length check.
 */
export async function getDecodedPublicEvents<T>(
  node: AztecNode,
  eventMetadataDef: EventMetadataDefinition,
  from: number,
  limit: number,
  filter?: LogFilter
): Promise<T[]> {
  const { logs } = await node.getPublicLogs({
    fromBlock: from,
    toBlock: from + limit,
    contractAddress: filter?.contractAddress,
  });

  const decodedEvents = logs
    .map((log) => {
      if (
        filter?.contractAddress &&
        !log.log.contractAddress.equals(filter.contractAddress)
      ) {
        return undefined;
      }

      const logFields = log.log.getEmittedFields();
      const selector = EventSelector.fromField(logFields[logFields.length - 1]);
      if (!selector.equals(eventMetadataDef.eventSelector)) {
        return undefined;
      }

      try {
        return decodeFromAbi([eventMetadataDef.abiType], log.log.fields) as T;
      } catch {
        return undefined;
      }
    })
    .filter((log): log is T => log !== undefined);

  return decodedEvents;
}
