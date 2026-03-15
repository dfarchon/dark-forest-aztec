/**
 * StateResolver: resolveDepositArtifact
 *
 * Contract signature:
 * deposit_artifact(location_id, artifact_id, timestamp,
 *   planet, planet_artifacts_state, planet_events_state,
 *   arrivals[20], artifacts[20], artifact_locations[20],
 *   artifact, artifact_location, world)
 */

import type { UnconfirmedDepositArtifact } from "@dfpunk/types";

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

export async function resolveDepositArtifact(
  intent: UnconfirmedDepositArtifact,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec, artifactIdDec]
  const [rawLocationId, rawArtifactId] = intentArgs;
  const locationId = BigInt(String(rawLocationId));
  const artifactId = BigInt(String(rawArtifactId));
  const locationIdDec = String(rawLocationId);
  const artifactIdStr = String(rawArtifactId);

  await deps.chainClock.resync();

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

  // Load the specific artifact being deposited
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
  const timestamp = computeTimestamp(
    deps.chainClock,
    collectEntityTimes(planetRaw, planetEventsRaw, planetArtifactsRaw)
  );

  return [
    locationId,
    artifactId,
    timestamp,
    planet,
    planetArtifactsState,
    planetEventsState,
    arrivalData.arrivals,
    arrivalData.artifacts,
    arrivalData.artifactLocations,
    artifact,
    artifactLocation,
    world,
  ];
}
