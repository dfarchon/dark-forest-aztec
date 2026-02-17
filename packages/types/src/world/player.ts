import type { AztecAddr, LocationId } from "../identifiers";

/**
 * Represents a player; corresponds fairly closely with the analogous contract
 * struct
 */
export type Player = {
  address: AztecAddr;
  initTimestamp: number;
  homePlanetId: LocationId;
  lastRevealTimestamp: number;
  lastClaimTimestamp: number;
  score: number;
  spaceJunk: number;
  spaceJunkLimit: number;
  claimedShips: boolean;
};
