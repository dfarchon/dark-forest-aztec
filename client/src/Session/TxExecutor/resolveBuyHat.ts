/**
 * StateResolver: resolveBuyHat
 *
 * Contract signature (Core.buy_hat private):
 * buy_hat(planet_id, timestamp, planet_state, world)
 */

import type { UnconfirmedBuyHat } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import { computeTimestamp } from "./resolverHelpers";
import { planetToContract, worldToContract } from "./stateConvert";
import { planetZero, worldInitial } from "./stateZeros";

export async function resolveBuyHat(
  intent: UnconfirmedBuyHat,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  const [rawLocationId] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const locationIdDec = String(rawLocationId);

  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  const worldRaw = deps.indexer.getWorld();
  const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

  const timestamp = computeTimestamp(
    BigInt(Math.floor(intent.uiTimestamp ?? deps.chainClock.nowSec())),
    [BigInt(String(planet.last_updated ?? 0))]
  );

  return [locationId, timestamp, planet, world];
}
