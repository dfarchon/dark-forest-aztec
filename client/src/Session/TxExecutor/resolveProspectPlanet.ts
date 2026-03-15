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
  console.time("[ProspectPlanet] total resolve");
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec]
  const [rawLocationId] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const locationIdDec = String(rawLocationId);

  console.time("[ProspectPlanet] chainClock.resync");
  await deps.chainClock.resync();
  console.timeEnd("[ProspectPlanet] chainClock.resync");

  console.time("[ProspectPlanet] configCache.getConfig");
  const config = await deps.configCache.getConfig();
  console.timeEnd("[ProspectPlanet] configCache.getConfig");

  // Load planet state
  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  // Debug: print planet owner
  console.debug(
    "[ProspectPlanet] planet owner from indexer:",
    planetRaw?.owner
  );
  console.debug(
    "[ProspectPlanet] planet.owner passed to contract:",
    planet.owner
  );

  const planetEventsRaw = deps.indexer.getPlanetEvents(locationIdDec);
  const planetEventsState = planetEventsRaw
    ? planetEventsToContract(planetEventsRaw)
    : planetEventsZero();

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(locationIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  // Load arrivals from planet events
  console.time("[ProspectPlanet] loadArrivals");
  const arrivalData = await loadArrivalsForPlanetEvents(
    deps.indexer,
    planetEventsRaw
  );
  console.timeEnd("[ProspectPlanet] loadArrivals");

  // Load owned artifacts on this planet
  console.time("[ProspectPlanet] loadArtifacts");
  const ownedData = await loadArtifactsForPlanet(
    deps.indexer,
    planetArtifactsRaw
  );
  console.timeEnd("[ProspectPlanet] loadArtifacts");

  // World state
  const worldRaw = deps.indexer.getWorld();
  const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

  // Timestamp
  const timestamp = computeTimestamp(
    deps.chainClock,
    collectEntityTimes(planetRaw, planetEventsRaw, planetArtifactsRaw)
  );

  console.timeEnd("[ProspectPlanet] total resolve");

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
