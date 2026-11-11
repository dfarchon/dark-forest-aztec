/**
 * IBlockEventSource that fetches public storage events from an Aztec node.
 * Uses @dfpunk/contracts for artifact event metadata and default addresses.
 */

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { DomainSeparator } from "@aztec-labs/constants";
import { BlockNumber } from "@aztec-labs/foundation/branded-types";
import {
  decodeFromAbi,
  type EventMetadataDefinition,
} from "@aztec-labs/stdlib/abi";
import type { BlockHash } from "@aztec-labs/stdlib/block";
import { computeLogTag } from "@aztec-labs/stdlib/hash";
import { MAX_LOGS_PER_TAG } from "@aztec-labs/stdlib/interfaces/api-limit";
import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client";
import { LogCursor, Tag, type PublicLogsQuery } from "@aztec-labs/stdlib/logs";
import {
  ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";
import { ArrivalStorageContract } from "@dfpunk/contracts/artifacts/ArrivalStorage";
import { ArtifactLocationStorageContract } from "@dfpunk/contracts/artifacts/ArtifactLocationStorage";
import { ArtifactStorageContract } from "@dfpunk/contracts/artifacts/ArtifactStorage";
import { PlanetArtifactsStorageContract } from "@dfpunk/contracts/artifacts/PlanetArtifactsStorage";
import { PlanetEventsStorageContract } from "@dfpunk/contracts/artifacts/PlanetEventsStorage";
import { PlanetRevealedCoordsStorageContract } from "@dfpunk/contracts/artifacts/PlanetRevealedCoordsStorage";
import { PlanetStorageContract } from "@dfpunk/contracts/artifacts/PlanetStorage";
import { PlayerStorageContract } from "@dfpunk/contracts/artifacts/PlayerStorage";
import { WorldStorageContract } from "@dfpunk/contracts/artifacts/WorldStorage";

import type {
  BlockTipTag,
  BlockUpdates,
  IBlockEventSource,
  PublicEventName,
  TableName,
} from "../types.ts";
import { callWithBoundedRetry } from "../utils/callWithBoundedRetry.ts";

/** Decoded storage event shape: id, optional block_number, state. */
type DecodedUpdate = {
  id: unknown;
  block_number?: bigint;
  state: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Narrow a `decodeFromAbi` result to a storage update.
 * A short log throws inside the decoder; this catches a result with no `id` or `state`.
 */
export function readDecodedUpdate(
  eventName: string,
  decoded: unknown,
): DecodedUpdate {
  if (!isRecord(decoded) || !isRecord(decoded.state)) {
    throw new Error(`[AztecNodeSource] ${eventName} missing state`);
  }
  if (decoded.id == null) {
    throw new Error(`[AztecNodeSource] ${eventName} missing id`);
  }
  const update: DecodedUpdate = { id: decoded.id, state: decoded.state };
  const blockNumber = decoded.block_number;
  if (typeof blockNumber === "bigint") {
    update.block_number = blockNumber;
  } else if (typeof blockNumber === "number") {
    update.block_number = BigInt(blockNumber);
  }
  return update;
}

/** Contract address map: key = storage contract name, value = hex address. */
export type StorageContractAddresses = Partial<Record<string, string>>;

const DEFAULT_ADDRESSES: StorageContractAddresses = {
  WorldStorage: WORLD_STORAGE_CONTRACT_ADDRESS,
  PlayerStorage: PLAYER_STORAGE_CONTRACT_ADDRESS,
  PlanetStorage: PLANET_STORAGE_CONTRACT_ADDRESS,
  PlanetRevealedCoordsStorage: PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
  PlanetEventsStorage: PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PlanetArtifactsStorage: PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  ArrivalStorage: ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ArtifactStorage: ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  ArtifactLocationStorage: ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
};

const STORAGE_SPECS: Array<{
  contractKey: string;
  table: TableName;
  eventName: PublicEventName;
  eventDef: EventMetadataDefinition;
}> = [
  {
    contractKey: "WorldStorage",
    table: "world",
    eventName: "WorldUpdate",
    eventDef: WorldStorageContract.events.WorldUpdate,
  },
  {
    contractKey: "PlayerStorage",
    table: "player",
    eventName: "PlayerUpdate",
    eventDef: PlayerStorageContract.events.PlayerUpdate,
  },
  {
    contractKey: "PlanetStorage",
    table: "planet",
    eventName: "PlanetUpdate",
    eventDef: PlanetStorageContract.events.PlanetUpdate,
  },
  {
    contractKey: "PlanetRevealedCoordsStorage",
    table: "planet_revealed_coords",
    eventName: "PlanetRevealedCoordsUpdate",
    eventDef:
      PlanetRevealedCoordsStorageContract.events.PlanetRevealedCoordsUpdate,
  },
  {
    contractKey: "PlanetEventsStorage",
    table: "planet_events",
    eventName: "PlanetEventsUpdate",
    eventDef: PlanetEventsStorageContract.events.PlanetEventsUpdate,
  },
  {
    contractKey: "PlanetArtifactsStorage",
    table: "planet_artifacts",
    eventName: "PlanetArtifactsUpdate",
    eventDef: PlanetArtifactsStorageContract.events.PlanetArtifactsUpdate,
  },
  {
    contractKey: "ArrivalStorage",
    table: "arrival",
    eventName: "ArrivalUpdate",
    eventDef: ArrivalStorageContract.events.ArrivalUpdate,
  },
  {
    contractKey: "ArtifactStorage",
    table: "artifact",
    eventName: "ArtifactUpdate",
    eventDef: ArtifactStorageContract.events.ArtifactUpdate,
  },
  {
    contractKey: "ArtifactLocationStorage",
    table: "artifact_location",
    eventName: "ArtifactLocationUpdate",
    eventDef: ArtifactLocationStorageContract.events.ArtifactLocationUpdate,
  },
];

function toIdStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "bigint") return String(v);
  if (typeof v === "object" && "toString" in (v as object))
    return (v as { toString(): string }).toString();
  return String(v);
}

type StorageSpec = (typeof STORAGE_SPECS)[number] & { address: AztecAddress };

/** Every storage contract must resolve to a 32-byte hex address. */
function resolveStorageSpecs(
  addresses: StorageContractAddresses,
): StorageSpec[] {
  const invalid: string[] = [];
  const specs: StorageSpec[] = [];
  for (const spec of STORAGE_SPECS) {
    const addr = addresses[spec.contractKey];
    if (!addr || !AztecAddress.isAddress(addr)) {
      invalid.push(spec.contractKey);
      continue;
    }
    specs.push({ ...spec, address: AztecAddress.fromStringUnsafe(addr) });
  }
  if (invalid.length > 0) {
    throw new Error(
      `[AztecNodeSource] invalid storage contract address for: ${invalid.join(", ")}`,
    );
  }
  return specs;
}

type AnchoredBlock = {
  number: ReturnType<typeof BlockNumber>;
  hash: BlockHash;
};

/**
 * One page of public logs for an event type, pinned to `referenceBlock` when the caller has a hash.
 * The node rejects the query if that block is no longer on its fork.
 */
async function fetchAnchoredPublicEvents(
  node: AztecNode,
  eventName: string,
  eventDef: EventMetadataDefinition,
  query: {
    contractAddress: AztecAddress;
    fromBlock: ReturnType<typeof BlockNumber>;
    toBlock: ReturnType<typeof BlockNumber>;
    referenceBlock?: AnchoredBlock;
    afterLog?: LogCursor;
  },
): Promise<{ events: DecodedUpdate[]; nextCursor?: LogCursor }> {
  const logTagField = await computeLogTag(
    eventDef.eventSelector.toField(),
    DomainSeparator.EVENT_LOG_TAG,
  );
  const logTag = new Tag(logTagField);
  const logsQuery: PublicLogsQuery = {
    contractAddress: query.contractAddress,
    tags: [
      query.afterLog !== undefined
        ? { tag: logTag, afterLog: query.afterLog }
        : logTag,
    ],
    fromBlock: query.fromBlock,
    toBlock: query.toBlock,
    referenceBlock: query.referenceBlock,
  };
  const [logsForTag] = await node.getPublicLogsByTags(logsQuery);
  const events = logsForTag.map((log) =>
    readDecodedUpdate(
      eventName,
      decodeFromAbi(eventDef.abiType, log.logData.slice(1)),
    ),
  );
  const last = logsForTag[logsForTag.length - 1];
  const nextCursor =
    logsForTag.length === MAX_LOGS_PER_TAG && last !== undefined
      ? LogCursor.fromLog(last)
      : undefined;
  return { events, nextCursor };
}

export interface AztecNodeBlockSourceOptions {
  /** L2 tip to follow. Default "proposed", matching getBlockNumber() with no argument. */
  tipTag?: BlockTipTag;
  /**
   * Per-request timeout. A timeout or network error is retried twice (1s, then 2s)
   * before the error is thrown. Unset means wait for the node.
   */
  requestTimeoutMs?: number;
}

/**
 * Returns an IBlockEventSource that reads public storage events from one Aztec node.
 * @param nodeUrl - Aztec node URL (e.g. http://localhost:8080)
 * @param contractAddresses - Optional map of storage contract name to hex address; omitted entries use defaults from @dfpunk/contracts
 * @param options - Tip to follow and optional per-request timeout
 */
export function createAztecNodeBlockSource(
  nodeUrl: string,
  contractAddresses?: StorageContractAddresses,
  options?: AztecNodeBlockSourceOptions,
): IBlockEventSource {
  const node = createAztecNodeClient(nodeUrl) as AztecNode;
  const tipTag = options?.tipTag ?? "proposed";
  const timeoutMs = options?.requestTimeoutMs;
  const call = <T>(fn: () => Promise<T>, label: string): Promise<T> =>
    callWithBoundedRetry(fn, { label, timeoutMs });
  const addresses = { ...DEFAULT_ADDRESSES, ...contractAddresses };
  const specsWithArtifacts = resolveStorageSpecs(addresses);

  const loadBlockData = (n: number) =>
    call(() => node.getBlockData(BlockNumber(n)), `getBlockData(${n})`);

  const blockHash = async (n: number): Promise<string | undefined> => {
    const data = await loadBlockData(n);
    return data?.blockHash.toString();
  };

  return {
    getLatestBlockNumber: async () =>
      Number(await call(() => node.getBlockNumber(tipTag), "getBlockNumber")),

    getBlockHash: blockHash,

    async getBlockUpdates(fromBlock, toBlock): Promise<BlockUpdates> {
      const tip = Number(
        await call(() => node.getBlockNumber(tipTag), "getBlockNumber"),
      );
      const end = Math.min(toBlock, tip);
      if (end < fromBlock) {
        return {
          fromBlock,
          toBlock: fromBlock - 1,
          updates: [],
        };
      }

      const anchorData = await loadBlockData(end);
      const anchorHash = anchorData?.blockHash;
      if (end > 0 && !anchorHash) {
        throw new Error(
          `[AztecNodeSource] block ${end} has no hash; refusing to read unanchored logs`,
        );
      }
      const referenceBlock = anchorHash
        ? { number: BlockNumber(end), hash: anchorHash }
        : undefined;

      const updates: BlockUpdates["updates"] = [];

      for (const {
        table,
        eventName,
        eventDef,
        address,
      } of specsWithArtifacts) {
        let afterLog: LogCursor | undefined;
        do {
          const page = await call(
            () =>
              fetchAnchoredPublicEvents(node, eventName, eventDef, {
                fromBlock: BlockNumber(fromBlock),
                toBlock: BlockNumber(end + 1), // exclusive
                contractAddress: address,
                referenceBlock,
                afterLog,
              }),
            `getPublicLogsByTags(${eventName})`,
          );
          for (const ev of page.events) {
            const id = table === "world" ? "0" : toIdStr(ev.id);
            updates.push({ table, id, state: ev.state });
          }
          afterLog = page.nextCursor;
        } while (afterLog);
      }

      return {
        fromBlock,
        toBlock: end,
        toBlockHash: anchorHash?.toString(),
        updates,
      };
    },
  };
}
