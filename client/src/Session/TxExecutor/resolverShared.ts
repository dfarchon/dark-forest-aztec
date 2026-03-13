/**
 * Shared functions extracted from StateResolver that need indexer access.
 * These are standalone versions of the private methods originally in StateResolver.
 */

import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { PlanetEventsState } from "../Indexer/TableTypes/chain";
import {
  arrivalToContract,
  artifactLocationToContract,
  artifactToContract,
} from "./stateConvert";
import { arrivalZero, artifactLocationZero, artifactZero } from "./stateZeros";

/**
 * Load arrivals, artifacts, and artifact locations for a planet's events.
 * Returns arrays of length 20, padded with zeros for unused slots.
 * Standalone version of StateResolver.loadArrivalsForPlanetEvents().
 */
export function loadArrivalsForPlanetEvents(
  indexer: IndexerConnection,
  planetEvents: PlanetEventsState | undefined
): {
  arrivals: Record<string, unknown>[];
  artifacts: Record<string, unknown>[];
  artifactLocations: Record<string, unknown>[];
} {
  const count = planetEvents?.count ?? 0;
  const events = planetEvents?.events ?? [];

  const arrivals: Record<string, unknown>[] = [];
  const artifacts: Record<string, unknown>[] = [];
  const artifactLocations: Record<string, unknown>[] = [];

  for (let i = 0; i < 20; i++) {
    if (i < count && events[i]?.id != null && String(events[i].id) !== "0") {
      const arrivalId = String(events[i].id);
      const arrival = indexer.getArrival(arrivalId);
      if (arrival) {
        arrivals.push(arrivalToContract(arrival));
        // If arrival carries an artifact, load it
        if (
          arrival.carried_artifact_id &&
          String(arrival.carried_artifact_id) !== "0"
        ) {
          const artId = String(arrival.carried_artifact_id);
          const artRaw = indexer.getArtifact(artId);
          artifacts.push(artRaw ? artifactToContract(artRaw) : artifactZero());
          const locRaw = indexer.getArtifactLocation(artId);
          artifactLocations.push(
            locRaw ? artifactLocationToContract(locRaw) : artifactLocationZero()
          );
        } else {
          artifacts.push(artifactZero());
          artifactLocations.push(artifactLocationZero());
        }
      } else {
        arrivals.push(arrivalZero());
        artifacts.push(artifactZero());
        artifactLocations.push(artifactLocationZero());
      }
    } else {
      arrivals.push(arrivalZero());
      artifacts.push(artifactZero());
      artifactLocations.push(artifactLocationZero());
    }
  }

  return { arrivals, artifacts, artifactLocations };
}
