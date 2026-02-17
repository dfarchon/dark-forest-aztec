import type { AztecAddr, LocationId } from "../identifiers";
import type { WorldCoords, WorldLocation } from "./world";

/**
 * Represents a planet location that has been broadcast on-chain (claimed).
 */
export type ClaimedCoords = WorldCoords & {
  hash: LocationId;
  revealer: AztecAddr;
  score: number;
};

export type ClaimedLocation = WorldLocation & {
  revealer: AztecAddr;
};
