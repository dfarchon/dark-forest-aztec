/**
 * StateResolver: resolveTransferPlanet
 *
 * Contract signature (Core.transfer_planet private):
 * transfer_planet(planet_id, timestamp, planet_state, new_owner, world)
 */

import { AztecAddress } from "@aztec-labs/aztec.js/addresses";
import type { UnconfirmedPlanetTransfer } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import { computeTimestamp } from "./resolverHelpers";
import { planetToContract, worldToContract } from "./stateConvert";
import { planetZero, worldInitial } from "./stateZeros";

export async function resolveTransferPlanet(
  intent: UnconfirmedPlanetTransfer,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  const [rawLocationId, rawNewOwner] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const locationIdDec = String(rawLocationId);
  const newOwner = AztecAddress.fromStringUnsafe(String(rawNewOwner));

  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  const worldRaw = deps.indexer.getWorld();
  const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

  const timestamp = computeTimestamp(
    BigInt(Math.floor(intent.uiTimestamp ?? deps.chainClock.nowSec())),
    [BigInt(String(planet.last_updated ?? 0))]
  );

  return [locationId, timestamp, planet, newOwner, world];
}
