import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import type { Wallet } from "@aztec-labs/aztec.js/wallet";
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
  PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";

/**
 * Aztec protocol/canonical contracts that the account entrypoint may read while proving.
 *
 * devkitV52 shipped five hard-coded Aztec 5.2 canonical addresses here. They are NOT
 * valid on Aztec 6.0 (the 6.0 protocol contracts live at the low addresses 0x1..0x3),
 * so they are intentionally left out. Verify against the target network before adding
 * any value to this list.
 */
const AZTEC_STANDARD_SCOPES: string[] = [];

const GAME_SCOPES = [
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
  PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_CONTRACT_ADDRESS,
];

/** Scopes for every client simulate/send, including utility preflight reads. */
export function staticTxScopes(): AztecAddress[] {
  return [...AZTEC_STANDARD_SCOPES, ...GAME_SCOPES]
    .filter((addr) => addr && addr.length >= 10)
    .map((addr) => AztecAddress.fromStringUnsafe(addr));
}

/** Static scopes plus the fee sponsor and every account the wallet already knows. */
export async function collectTxScopes(
  wallet: Wallet,
  sponsoredFpcAddress?: AztecAddress
): Promise<AztecAddress[]> {
  const scopes = staticTxScopes();
  if (sponsoredFpcAddress) scopes.push(sponsoredFpcAddress);
  const aliased = [
    ...(await wallet.getAccounts().catch(() => [])),
    ...(await wallet.getAddressBook().catch(() => [])),
  ];
  for (const row of aliased) {
    if (row?.item) scopes.push(row.item);
  }
  return scopes;
}
