/**
 * IBlockEventSource that fetches public storage events from an Aztec node.
 * Uses @dfpunk/contracts for artifact event metadata and default addresses.
 */

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import { type EventCursor, getPublicEvents } from "@aztec-labs/aztec.js/events";
import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { BlockNumber } from "@aztec-labs/foundation/branded-types";
import type { EventMetadataDefinition } from "@aztec-labs/stdlib/abi";
import type { AztecNode } from "@aztec-labs/stdlib/interfaces/client";
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
  PublicEventBatchCounts,
  PublicEventName,
  TableName,
} from "./types.ts";

/** Decoded storage event shape: id, optional block_number, state. */
type DecodedUpdate = {
  id: unknown;
  block_number?: number | bigint;
  state: Record<string, unknown>;
};

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

export interface AztecNodeBlockSourceOptions {
  /** L2 tip to follow. Default "proposed", matching getBlockNumber() with no argument. */
  tipTag?: BlockTipTag;
  /** Per-request timeout. Unset means wait for the node (previous behavior). */
  requestTimeoutMs?: number;
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
  const call = <T>(p: Promise<T>, label: string): Promise<T> =>
    timeoutMs !== undefined ? withTimeout(p, timeoutMs, label) : p;
  const addresses = { ...DEFAULT_ADDRESSES, ...contractAddresses };

  const specsWithArtifacts = STORAGE_SPECS.filter((spec) => {
    const addr = addresses[spec.contractKey];
    return addr && addr.length >= 10;
  }).map((spec) => ({
    ...spec,
    address: AztecAddress.fromStringUnsafe(addresses[spec.contractKey]!),
  }));

  const blockHash = async (n: number): Promise<string | undefined> => {
    const data = await call(
      node.getBlockData(BlockNumber(n)),
      `getBlockData(${n})`,
    );
    return data?.blockHash.toString();
  };

  return {
    getLatestBlockNumber: async () =>
      Number(await call(node.getBlockNumber(tipTag), "getBlockNumber")),

    getBlockHash: blockHash,

    async getBlockUpdates(fromBlock, toBlock): Promise<BlockUpdates> {
      const tip = Number(
        await call(node.getBlockNumber(tipTag), "getBlockNumber"),
      );
      const end = Math.min(toBlock, tip);
      if (end < fromBlock) {
        return {
          fromBlock,
          toBlock: fromBlock - 1,
          updates: [],
          eventCounts: {},
        };
      }

      const updates: BlockUpdates["updates"] = [];
      const eventCounts: PublicEventBatchCounts = {};

      for (const {
        table,
        eventName,
        eventDef,
        address,
      } of specsWithArtifacts) {
        let afterEvent: EventCursor | undefined;
        do {
          const page = await call(
            getPublicEvents(node, eventDef, {
              fromBlock: BlockNumber(fromBlock),
              toBlock: BlockNumber(end + 1), // exclusive
              contractAddress: address,
              afterEvent,
            }),
            `getPublicEvents(${eventName})`,
          );
          eventCounts[eventName] =
            (eventCounts[eventName] ?? 0) + page.events.length;
          const events = page.events.map((e) => e.event) as DecodedUpdate[];
          for (const ev of events) {
            if (ev?.state == null) continue;
            const id = table === "world" ? "0" : toIdStr(ev.id);
            updates.push({ table, id, state: ev.state });
          }
          afterEvent = page.nextCursor;
        } while (afterEvent);
      }

      const toBlockHash = await blockHash(end);
      return { fromBlock, toBlock: end, toBlockHash, updates, eventCounts };
    },
  };
}
