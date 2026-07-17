/**
 * IBlockEventSource that fetches public storage events from an Aztec node.
 * Uses @dfpunk/contracts for artifact event metadata and default addresses.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import { type EventCursor, getPublicEvents } from "@aztec/aztec.js/events";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { BlockNumber } from "@aztec/foundation/branded-types";
import type { EventMetadataDefinition } from "@aztec/stdlib/abi";
import type { AztecNode } from "@aztec/stdlib/interfaces/client";
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

import type { BlockUpdates, TableName } from "./types";

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
  eventDef: EventMetadataDefinition;
}> = [
  {
    contractKey: "WorldStorage",
    table: "world",
    eventDef: WorldStorageContract.events.WorldUpdate,
  },
  {
    contractKey: "PlayerStorage",
    table: "player",
    eventDef: PlayerStorageContract.events.PlayerUpdate,
  },
  {
    contractKey: "PlanetStorage",
    table: "planet",
    eventDef: PlanetStorageContract.events.PlanetUpdate,
  },
  {
    contractKey: "PlanetRevealedCoordsStorage",
    table: "planet_revealed_coords",
    eventDef:
      PlanetRevealedCoordsStorageContract.events.PlanetRevealedCoordsUpdate,
  },
  {
    contractKey: "PlanetEventsStorage",
    table: "planet_events",
    eventDef: PlanetEventsStorageContract.events.PlanetEventsUpdate,
  },
  {
    contractKey: "PlanetArtifactsStorage",
    table: "planet_artifacts",
    eventDef: PlanetArtifactsStorageContract.events.PlanetArtifactsUpdate,
  },
  {
    contractKey: "ArrivalStorage",
    table: "arrival",
    eventDef: ArrivalStorageContract.events.ArrivalUpdate,
  },
  {
    contractKey: "ArtifactStorage",
    table: "artifact",
    eventDef: ArtifactStorageContract.events.ArtifactUpdate,
  },
  {
    contractKey: "ArtifactLocationStorage",
    table: "artifact_location",
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

/**
 * Returns an IBlockEventSource that reads public storage events from the Aztec node.
 * @param nodeUrl - Aztec node URL (e.g. http://localhost:8080)
 * @param contractAddresses - Optional map of storage contract name to hex address; omitted entries use defaults from @dfpunk/contracts
 */
export function createAztecNodeBlockSource(
  nodeUrl: string,
  contractAddresses?: StorageContractAddresses,
): {
  getLatestBlockNumber: () => Promise<number>;
  getBlockUpdates: (
    fromBlock: number,
    toBlock: number,
  ) => Promise<BlockUpdates>;
} {
  const node = createAztecNodeClient(nodeUrl) as AztecNode;
  const addresses = { ...DEFAULT_ADDRESSES, ...contractAddresses };

  const specsWithArtifacts = STORAGE_SPECS.filter((spec) => {
    const addr = addresses[spec.contractKey];
    return addr && addr.length >= 10;
  }).map((spec) => ({
    ...spec,
    address: AztecAddress.fromStringUnsafe(addresses[spec.contractKey]!),
  }));

  return {
    async getLatestBlockNumber(): Promise<number> {
      return Number(await node.getBlockNumber());
    },

    async getBlockUpdates(
      fromBlock: number,
      toBlock: number,
    ): Promise<BlockUpdates> {
      const limit = Math.max(0, toBlock - fromBlock + 1);
      if (limit === 0) {
        return { fromBlock, toBlock, updates: [] };
      }

      const updates: BlockUpdates["updates"] = [];

      for (const { table, eventDef, address } of specsWithArtifacts) {
        let afterEvent: EventCursor | undefined;
        do {
          const page = await getPublicEvents(node, eventDef, {
            fromBlock: BlockNumber(fromBlock),
            toBlock: BlockNumber(fromBlock + limit),
            contractAddress: address,
            afterEvent,
          });
          const events = page.events.map((e) => e.event) as DecodedUpdate[];
          for (const ev of events) {
            if (ev?.state == null) continue;
            const id = table === "world" ? "0" : toIdStr(ev.id);
            updates.push({ table, id, state: ev.state });
          }
          afterEvent = page.nextCursor;
        } while (afterEvent);
      }

      return { fromBlock, toBlock, updates };
    },
  };
}
