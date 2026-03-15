/**
 * StateResolver: resolveActivateArtifact
 *
 * Contract signature:
 * activate_artifact(location_id, artifact_id, wormhole_to, timestamp,
 *   planet, planet_events_state,
 *   arrivals[20], arrival_artifacts[20], arrival_artifact_locations[20],
 *   planet_artifacts_state, artifact, artifact_location,
 *   world, world_config, planet_default_stats)
 */

import { locationIdToDecStr } from "@dfpunk/serde";
import type { UnconfirmedActivateArtifact } from "@dfpunk/types";
import type { LocationId } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import {
  collectEntityTimes,
  computeTimestamp,
  hexIdToField,
} from "./resolverHelpers";
import { loadArrivalsForPlanetEvents } from "./resolverShared";
import {
  artifactLocationToContract,
  artifactToContract,
  planetArtifactsToContract,
  planetEventsToContract,
  planetToContract,
  worldToContract,
} from "./stateConvert";
import {
  artifactLocationZero,
  artifactZero,
  planetArtifactsZero,
  planetEventsZero,
  planetZero,
  worldInitial,
} from "./stateZeros";

export async function resolveActivateArtifact(
  intent: UnconfirmedActivateArtifact,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec, artifactIdDec, wormholeToDec]
  const [rawLocationId, rawArtifactId, rawWormholeTo] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const artifactId = BigInt(String(rawArtifactId));
  const wormholeTo = BigInt(String(rawWormholeTo ?? 0));
  const locationIdDec = String(rawLocationId);

  await deps.chainClock.resync();
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
  const arrivalData = await loadArrivalsForPlanetEvents(
    deps.indexer,
    planetEventsRaw
  );

  // Load the specific artifact and its location
  const artifactIdStr = String(rawArtifactId);
  const artifactRaw = deps.indexer.getArtifact(artifactIdStr);
  const artifact = artifactRaw
    ? artifactToContract(artifactRaw)
    : artifactZero();
  const artifactLocRaw = deps.indexer.getArtifactLocation(artifactIdStr);
  const artifactLocation = artifactLocRaw
    ? artifactLocationToContract(artifactLocRaw)
    : artifactLocationZero();

  // World state
  const worldRaw = deps.indexer.getWorld();
  const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

  // Planet default stats (need planet level for lookup)
  const planetLevel = planetRaw?.planet_level ?? 0;
  const levelIndex = Math.min(9, Math.max(0, planetLevel));
  const planetDefaultStats = config.planetDefaultStats[levelIndex];

  // Timestamp
  const timestamp = computeTimestamp(
    deps.chainClock,
    collectEntityTimes(planetRaw, planetEventsRaw, planetArtifactsRaw)
  );

  return [
    locationId,
    artifactId,
    wormholeTo,
    timestamp,
    planet,
    planetEventsState,
    arrivalData.arrivals,
    arrivalData.artifacts,
    arrivalData.artifactLocations,
    planetArtifactsState,
    artifact,
    artifactLocation,
    world,
    config.worldConfig,
    planetDefaultStats,
  ];
}
