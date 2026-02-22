import type {
  Abstract,
  ArtifactId,
  EthAddress,
  LocationId,
  VoyageId,
} from "../identifiers";

/**
 * Represents a voyage.
 */
export interface QueuedArrival {
  eventId: VoyageId;
  player: EthAddress;
  fromPlanet: LocationId;
  toPlanet: LocationId;
  energyArriving: number;
  silverMoved: number;
  artifactId?: ArtifactId;
  departureTime: number;
  distance: number;
  arrivalTime: number;
  arrivalType: ArrivalType;
}

/**
 * Abstract type representing an arrival type.
 */
export type ArrivalType = Abstract<number, "ArrivalType">;

/**
 * Enumeration of arrival types.
 */
export const ArrivalType = {
  Unknown: 0 as ArrivalType,
  Normal: 1 as ArrivalType,
  Photoid: 2 as ArrivalType,
  Wormhole: 3 as ArrivalType,
} as const;
