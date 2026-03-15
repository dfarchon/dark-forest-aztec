/**
 * StateResolver: resolveDeactivateArtifact
 *
 * Contract signature:
 * deactivate_artifact(location_id, artifact_id, timestamp,
 *   planet, planet_events_state,
 *   arrivals[20], arrival_artifacts[20], arrival_artifact_locations[20],
 *   planet_artifacts_state, artifact, artifact_location, world)
 */

import type { UnconfirmedDeactivateArtifact } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import { collectEntityTimes, computeTimestamp } from "./resolverHelpers";
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

export async function resolveDeactivateArtifact(
  intent: UnconfirmedDeactivateArtifact,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec]
  const [rawLocationId] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const locationIdDec = String(rawLocationId);
  const artifactIdStr = String(BigInt(`0x${intent.artifactId}`));

  await deps.chainClock.resync();

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

  // Timestamp
  const artifactId = BigInt(`0x${intent.artifactId}`);
  const timestamp = computeTimestamp(
    deps.chainClock,
    collectEntityTimes(planetRaw, planetEventsRaw, planetArtifactsRaw)
  );

  return [
    locationId,
    artifactId,
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
  ];
}
