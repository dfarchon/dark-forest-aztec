import { AztecAddress } from "@aztec/aztec.js/addresses";
import type {
  AppCapabilities,
  ContractFunctionPattern,
} from "@aztec/aztec.js/wallet";
import {
  ADMIN_CONTRACT_ADDRESS,
  ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS,
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  MOVE_CONTRACT_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";

const contractAddresses = [
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  MOVE_CONTRACT_ADDRESS,
  ADMIN_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS,
].map((address) => AztecAddress.fromStringUnsafe(address));

const allFunctionPatterns: ContractFunctionPattern[] = contractAddresses.map(
  (contract) => ({ contract, function: "*" })
);

export function createDfpunkCapabilities(): AppCapabilities {
  return {
    version: "1.0",
    metadata: {
      name: "DF Punk Aztec",
      version: "0.0.0",
      description: "Dark Forest Aztec",
      url: window.location.origin,
    },
    capabilities: [
      {
        type: "accounts",
        canGet: true,
        canCreateAuthWit: false,
      },
      {
        type: "contracts",
        contracts: contractAddresses,
        canRegister: true,
        canGetMetadata: true,
      },
      {
        type: "simulation",
        utilities: {
          scope: allFunctionPatterns,
        },
        transactions: {
          scope: allFunctionPatterns,
        },
      },
      {
        type: "transaction",
        scope: allFunctionPatterns,
      },
    ],
  };
}
