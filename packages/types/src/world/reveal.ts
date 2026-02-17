import type { AztecAddr, LocationId } from "../identifiers";
import type { WorldCoords, WorldLocation } from "./world";

/**
 * Represents a planet location that has been broadcast on-chain
 */
export type RevealedCoords = WorldCoords & {
  hash: LocationId;
  revealer: AztecAddr;
};

export type RevealedLocation = WorldLocation & {
  revealer: AztecAddr;
};
