import { AztecAddress } from "@aztec/aztec.js/addresses";
import {
  ADMIN_CONTRACT_ADDRESS,
  ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  MOVE_CONTRACT_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  START_BLOCK,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";

export interface ContractsAddresses {
  admin: string;
  arrival: string;
  artifact: string;
  artifactLocation: string;
  config: string;
  core: string;
  move: string;
  planet: string;
  planetArtifacts: string;
  planetEvents: string;
  planetRevealedCoords: string;
  player: string;
  world: string;
}

export interface ContractsRuntimeConfig {
  startBlock: number;
  addresses: ContractsAddresses;
}

export const CONTRACTS_CONFIG: ContractsRuntimeConfig = {
  startBlock: START_BLOCK,
  addresses: {
    admin: ADMIN_CONTRACT_ADDRESS,
    arrival: ARRIVAL_STORAGE_CONTRACT_ADDRESS,
    artifact: ARTIFACT_STORAGE_CONTRACT_ADDRESS,
    artifactLocation: ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
    config: CONFIG_CONTRACT_ADDRESS,
    core: CORE_CONTRACT_ADDRESS,
    move: MOVE_CONTRACT_ADDRESS,
    planet: PLANET_STORAGE_CONTRACT_ADDRESS,
    planetArtifacts: PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
    planetEvents: PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
    planetRevealedCoords: PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
    player: PLAYER_STORAGE_CONTRACT_ADDRESS,
    world: WORLD_STORAGE_CONTRACT_ADDRESS,
  },
};

export function validateContractsConfig(
  raw: ContractsRuntimeConfig = CONTRACTS_CONFIG,
): ContractsRuntimeConfig {
  if (!Number.isInteger(raw.startBlock) || raw.startBlock < 0) {
    throw new Error(
      "[ContractsConfig] START_BLOCK must be a non-negative integer",
    );
  }

  const seen = new Map<string, keyof ContractsAddresses>();
  const normalized = {} as ContractsAddresses;

  for (const [name, value] of Object.entries(raw.addresses) as Array<
    [keyof ContractsAddresses, string]
  >) {
    let address: AztecAddress;
    try {
      address = AztecAddress.fromString(value);
    } catch {
      throw new Error(`[ContractsConfig] Invalid ${name} contract address`);
    }

    const canonical = address.toString();
    const duplicateOf = seen.get(canonical);
    if (duplicateOf) {
      throw new Error(
        `[ContractsConfig] Duplicate contract address for ${name} and ${duplicateOf}`,
      );
    }

    seen.set(canonical, name);
    normalized[name] = canonical;
  }

  return {
    startBlock: raw.startBlock,
    addresses: normalized,
  };
}
