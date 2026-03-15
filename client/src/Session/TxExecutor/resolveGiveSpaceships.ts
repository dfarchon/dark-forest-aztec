/**
 * StateResolver: resolveGiveSpaceships
 *
 * Contract signature:
 * give_spaceships(location_id, timestamp,
 *   planet, planet_artifacts_state, planet_events_state,
 *   arrivals[20], artifacts[20], artifact_locations[20],
 *   player, spaceships_config)
 */

import type { UnconfirmedGetShips } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import { collectEntityTimes, computeTimestamp } from "./resolverHelpers";
import { loadArrivalsForPlanetEvents } from "./resolverShared";
import {
  planetArtifactsToContract,
  planetEventsToContract,
  planetToContract,
  playerToContract,
} from "./stateConvert";
import {
  planetArtifactsZero,
  planetEventsZero,
  planetZero,
  playerZero,
} from "./stateZeros";

export async function resolveGiveSpaceships(
  intent: UnconfirmedGetShips,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec]
  const [rawLocationId] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const locationIdDec = String(rawLocationId);
  const playerAddr = deps.getPlayerAddress();

  await deps.chainClock.resync();
  const config = await deps.configCache.getConfig();

  // Load planet state
  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(locationIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  const planetEventsRaw = deps.indexer.getPlanetEvents(locationIdDec);
  const planetEventsState = planetEventsRaw
    ? planetEventsToContract(planetEventsRaw)
    : planetEventsZero();

  // Load arrivals from planet events
  const arrivalData = await loadArrivalsForPlanetEvents(
    deps.indexer,
    planetEventsRaw
  );

  // Player state
  const playerRaw = deps.indexer.getPlayer(playerAddr);
  const player = playerRaw ? playerToContract(playerRaw) : playerZero();

  // Timestamp
  const timestamp = computeTimestamp(
    deps.chainClock,
    collectEntityTimes(
      planetRaw,
      planetEventsRaw,
      planetArtifactsRaw,
      playerRaw
    )
  );

  return [
    locationId,
    timestamp,
    planet,
    planetArtifactsState,
    planetEventsState,
    arrivalData.arrivals,
    arrivalData.artifacts,
    arrivalData.artifactLocations,
    player,
    config.spaceshipsConfig,
  ];
}
