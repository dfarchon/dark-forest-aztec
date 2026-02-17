import type { AztecAddr } from "../identifiers";

/**
 * Map from game version -> leaderboard.
 */
export interface AllAddressScoreMaps {
  [version: string]: AddressScoreMap;
}

export interface AddressScoreMap {
  [key: string]: number | undefined;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
}

export interface LeaderboardEntry {
  score: number | undefined;
  aztecAddr: AztecAddr;
  twitter?: string;
}
