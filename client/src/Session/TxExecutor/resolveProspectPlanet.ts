/**
 * StateResolver: resolveProspectPlanet
 *
 * Contract signature:
 * prospect_planet(location_id, timestamp, planet, planet_events_state,
 *   arrivals[20], arrival_artifacts[20], arrival_artifact_locations[20],
 *   planet_artifacts_state, owned_artifacts[20], owned_artifact_locations[20],
 *   world, spaceships_config)
 */

import type { UnconfirmedProspectPlanet } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import {
  collectEntityTimes,
  computeTimestamp,
  loadArtifactsForPlanet,
} from "./resolverHelpers";
import { loadArrivalsForPlanetEvents } from "./resolverShared";
import {
  planetArtifactsToContract,
  planetEventsToContract,
  planetToContract,
} from "./stateConvert";
import { worldToContract } from "./stateConvert";
import {
  planetArtifactsZero,
  planetEventsZero,
  planetZero,
  worldInitial,
} from "./stateZeros";

export async function resolveProspectPlanet(
  intent: UnconfirmedProspectPlanet,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec]
  const [rawLocationId] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const locationIdDec = String(rawLocationId);

  const config = await deps.configCache.getConfig();

  // Load planet state
  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  const planetEventsRaw = deps.indexer.getPlanetEvents(locationIdDec);
  const planetEventsState = planetEventsRaw
    ? planetEventsToContract(planetEventsRaw)
    : planetEventsZero();

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(locationIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  // Load arrivals from planet events
  const arrivalData = loadArrivalsForPlanetEvents(
    deps.indexer,
    planetEventsRaw
  );

  // Load owned artifacts on this planet
  const ownedData = loadArtifactsForPlanet(deps.indexer, planetArtifactsRaw);

  // World state
  const worldRaw = deps.indexer.getWorld();
  const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

  const timestamp = computeTimestamp(
    BigInt(Math.floor(intent.uiTimestamp ?? deps.chainClock.nowSec())),
    collectEntityTimes(planetRaw, planetEventsRaw, planetArtifactsRaw)
  );

  return [
    locationId,
    timestamp,
    planet,
    planetEventsState,
    arrivalData.arrivals,
    arrivalData.artifacts,
    arrivalData.artifactLocations,
    planetArtifactsState,
    ownedData.artifacts,
    ownedData.artifactLocations,
    world,
    config.spaceshipsConfig,
  ];
}
