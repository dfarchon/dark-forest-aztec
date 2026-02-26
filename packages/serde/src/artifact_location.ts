import type { Artifact, LocationId, VoyageId } from "@dfpunk/types";
import { locationIdFromHexStr, locationIdFromDecStr } from "./location";
import type { ArtifactLocationState } from "./chain_state";

function toLocationId(s: string): LocationId {
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

function isZeroId(s: string): boolean {
  if (s === "0" || s === "0x0") return true;
  try {
    return BigInt(s.startsWith("0x") ? s : "0x" + s) === 0n;
  } catch {
    return false;
  }
}

export interface ArtifactLocationDecoded {
  planetId?: LocationId;
  voyageId?: VoyageId;
  lastUpdated: number;
}

/**
 * Decodes chain state (key + ArtifactLocationState) into a shape that can
 * supply Artifact.onPlanetId and Artifact.onVoyageId. key is the artifact id.
 */
export function decodeArtifactLocation(
  _key: string,
  state: ArtifactLocationState,
): ArtifactLocationDecoded {
  return {
    planetId: isZeroId(state.planet_id)
      ? undefined
      : toLocationId(state.planet_id),
    voyageId: isZeroId(state.voyage_id)
      ? undefined
      : (state.voyage_id as VoyageId),
    lastUpdated: Number(state.last_updated),
  };
}

/**
 * Returns a copy of the artifact with onPlanetId and onVoyageId set from
 * the decoded artifact location. Use this to update an artifact after
 * loading its location state.
 */
export function applyArtifactLocation(
  artifact: Artifact,
  location: ArtifactLocationDecoded,
): Artifact {
  return {
    ...artifact,
    onPlanetId: location.planetId,
    onVoyageId: location.voyageId,
  };
}

/**
 * Takes an artifact plus key and ArtifactLocationState, returns the artifact
 * with onPlanetId and onVoyageId set from the location state.
 */
export function artifactWithLocation(
  artifact: Artifact,
  key: string,
  state: ArtifactLocationState,
): Artifact {
  return applyArtifactLocation(artifact, decodeArtifactLocation(key, state));
}
