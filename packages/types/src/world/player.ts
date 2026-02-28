import type { EthAddress, LocationId } from "../identifiers";

/**
 * Represents a player; corresponds fairly closely with the analogous contract
 * struct
 */
export type Player = {
  address: EthAddress;
  initTimestamp: number;
  homePlanetId: LocationId;
  lastRevealTimestamp: number;
  lastClaimTimestamp: number;
  score: number;
  spaceJunk: number;
  spaceJunkLimit: number;
  claimedShips: boolean;
  twitter?: string;
};
