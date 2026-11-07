import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { DomainSeparator } from "@aztec-labs/constants";
import { BlockNumber } from "@aztec-labs/foundation/branded-types";
import {
  decodeFromAbi,
  type EventMetadataDefinition,
} from "@aztec-labs/stdlib/abi";
import { BlockHash } from "@aztec-labs/stdlib/block";
import { computeLogTag } from "@aztec-labs/stdlib/hash";
import { MAX_LOGS_PER_TAG } from "@aztec-labs/stdlib/interfaces/api-limit";
import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client";
import { LogCursor, Tag, type PublicLogsQuery } from "@aztec-labs/stdlib/logs";
import { ArrivalStorageContract } from "@dfpunk/contracts/artifacts/ArrivalStorage";
import { ArtifactLocationStorageContract } from "@dfpunk/contracts/artifacts/ArtifactLocationStorage";
import { ArtifactStorageContract } from "@dfpunk/contracts/artifacts/ArtifactStorage";
import { PlanetArtifactsStorageContract } from "@dfpunk/contracts/artifacts/PlanetArtifactsStorage";
import { PlanetEventsStorageContract } from "@dfpunk/contracts/artifacts/PlanetEventsStorage";
import { PlanetRevealedCoordsStorageContract } from "@dfpunk/contracts/artifacts/PlanetRevealedCoordsStorage";
import { PlanetStorageContract } from "@dfpunk/contracts/artifacts/PlanetStorage";
import { PlayerStorageContract } from "@dfpunk/contracts/artifacts/PlayerStorage";
import { WorldStorageContract } from "@dfpunk/contracts/artifacts/WorldStorage";
import {
  rawIdToTableId,
  rawToState,
  type TableName,
} from "@dfpunk/indexer-core";

import type { StorageAddresses } from "../config/deployment.ts";

import {
  asNumber,
  type ChainBlock,
  type ChainLog,
  type ChainSource,
} from "./model.ts";
import { flattenState } from "./rows.ts";
import type { EventTableName } from "./tables.ts";

interface DecodedUpdate {
  id: unknown;
  state: Record<string, unknown>;
}

interface EventSpec {
  table: EventTableName;
  indexerTable: TableName;
  eventName: string;
  address: string;
  eventDef: EventMetadataDefinition;
}

function eventSpecs(addresses: StorageAddresses): EventSpec[] {
  return [
    {
      table: "world_update",
      indexerTable: "world",
      eventName: "WorldUpdate",
      address: addresses.world,
      eventDef: WorldStorageContract.events.WorldUpdate,
    },
    {
      table: "player_update",
      indexerTable: "player",
      eventName: "PlayerUpdate",
      address: addresses.player,
      eventDef: PlayerStorageContract.events.PlayerUpdate,
    },
    {
      table: "planet_update",
      indexerTable: "planet",
      eventName: "PlanetUpdate",
      address: addresses.planet,
      eventDef: PlanetStorageContract.events.PlanetUpdate,
    },
    {
      table: "planet_revealed_coords_update",
      indexerTable: "planet_revealed_coords",
      eventName: "PlanetRevealedCoordsUpdate",
      address: addresses.planetRevealedCoords,
      eventDef:
        PlanetRevealedCoordsStorageContract.events.PlanetRevealedCoordsUpdate,
    },
    {
      table: "planet_events_update",
      indexerTable: "planet_events",
      eventName: "PlanetEventsUpdate",
      address: addresses.planetEvents,
      eventDef: PlanetEventsStorageContract.events.PlanetEventsUpdate,
    },
    {
      table: "planet_artifacts_update",
      indexerTable: "planet_artifacts",
      eventName: "PlanetArtifactsUpdate",
      address: addresses.planetArtifacts,
      eventDef: PlanetArtifactsStorageContract.events.PlanetArtifactsUpdate,
    },
    {
      table: "arrival_update",
      indexerTable: "arrival",
      eventName: "ArrivalUpdate",
      address: addresses.arrival,
      eventDef: ArrivalStorageContract.events.ArrivalUpdate,
    },
    {
      table: "artifact_update",
      indexerTable: "artifact",
      eventName: "ArtifactUpdate",
      address: addresses.artifact,
      eventDef: ArtifactStorageContract.events.ArtifactUpdate,
    },
    {
      table: "artifact_location_update",
      indexerTable: "artifact_location",
      eventName: "ArtifactLocationUpdate",
      address: addresses.artifactLocation,
      eventDef: ArtifactLocationStorageContract.events.ArtifactLocationUpdate,
    },
  ];
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[analytics] ${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  promise.catch(() => {});
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createAztecChainSource(
  nodeUrl: string,
  addresses: StorageAddresses,
  requestTimeoutMs = 30_000,
): ChainSource {
  const node = createAztecNodeClient(nodeUrl) as AztecNode;
  const specs = eventSpecs(addresses);
  const call = <T>(promise: Promise<T>, label: string): Promise<T> =>
    withTimeout(promise, requestTimeoutMs, label);

  const readBlock = async (number: number): Promise<ChainBlock | undefined> => {
    const data = await call(
      node.getBlockData(BlockNumber(number)),
      `getBlockData(${number})`,
    );
    if (!data?.blockHash) return undefined;
    return {
      number,
      hash: data.blockHash.toString().toLowerCase(),
      timestamp: asNumber(data.header.globalVariables.timestamp),
    };
  };

  return {
    provenTip: async () =>
      Number(
        await call(node.getBlockNumber("proven"), "getBlockNumber(proven)"),
      ),
    proposedTip: async () =>
      Number(
        await call(node.getBlockNumber("proposed"), "getBlockNumber(proposed)"),
      ),
    block: readBlock,
    async logs(from, toInclusive, anchor) {
      const referenceBlock = {
        number: BlockNumber(anchor.number),
        hash: BlockHash.fromString(anchor.hash),
      };
      const fromBlock = BlockNumber(from);
      const toBlock = BlockNumber(toInclusive + 1);
      const logs: ChainLog[] = [];
      for (const spec of specs) {
        const address = AztecAddress.fromStringUnsafe(spec.address);
        let afterLog: LogCursor | undefined;
        do {
          const logTag = new Tag(
            await computeLogTag(
              spec.eventDef.eventSelector.toField(),
              DomainSeparator.EVENT_LOG_TAG,
            ),
          );
          const query: PublicLogsQuery = {
            contractAddress: address,
            tags: [afterLog !== undefined ? { tag: logTag, afterLog } : logTag],
            fromBlock,
            toBlock,
            referenceBlock,
          };
          const [page] = await call(
            node.getPublicLogsByTags(query),
            `getPublicLogsByTags(${spec.eventName})`,
          );
          for (const log of page) {
            const blockNumber = Number(log.blockNumber);
            if (blockNumber < from || blockNumber > toInclusive) continue;
            const decoded = decodeFromAbi(
              spec.eventDef.abiType,
              log.logData.slice(1),
            ) as unknown as DecodedUpdate;
            if (decoded?.state == null) {
              throw new Error(
                `[analytics] ${spec.eventName} missing state in block ${blockNumber}`,
              );
            }
            const typed = rawToState(spec.indexerTable, decoded.state);
            logs.push({
              table: spec.table,
              blockNumber,
              blockHash: log.blockHash.toString().toLowerCase(),
              blockTimestamp: asNumber(log.blockTimestamp),
              txHash: log.txHash.toString().toLowerCase(),
              txIndex: log.txIndexWithinBlock,
              logIndex: log.logIndexWithinTx,
              id: rawIdToTableId(spec.indexerTable, decoded.id),
              state: flattenState(spec.table, typed),
            });
          }
          const last = page[page.length - 1];
          afterLog =
            page.length === MAX_LOGS_PER_TAG && last !== undefined
              ? LogCursor.fromLog(last)
              : undefined;
        } while (afterLog);
      }
      return logs;
    },
  };
}
