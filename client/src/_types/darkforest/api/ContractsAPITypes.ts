import {
  ArtifactPointValues,
  EthAddress,
  UpgradeBranches,
} from "@dfpunk/types";

export const enum ZKArgIdx {
  PROOF_A,
  PROOF_B,
  PROOF_C,
  DATA,
}

export const enum InitArgIdxs {
  LOCATION_ID,
  PERLIN,
  RADIUS,
  PLANETHASH_KEY,
  SPACETYPE_KEY,
  PERLIN_LENGTH_SCALE,
  PERLIN_MIRROR_X,
  PERLIN_MIRROR_Y,
}

export const enum MoveArgIdxs {
  FROM_ID,
  TO_ID,
  TO_PERLIN,
  TO_RADIUS,
  DIST_MAX,
  PLANETHASH_KEY,
  SPACETYPE_KEY,
  PERLIN_LENGTH_SCALE,
  PERLIN_MIRROR_X,
  PERLIN_MIRROR_Y,
}

export const enum UpgradeArgIdxs {
  LOCATION_ID,
  UPGRADE_BRANCH,
}

export const enum ContractEvent {
  PlayerInitialized = "PlayerInitialized",
  ArrivalQueued = "ArrivalQueued",
  PlanetUpgraded = "PlanetUpgraded",
  PlanetHatBought = "PlanetHatBought",
  PlanetTransferred = "PlanetTransferred",
  PlanetInvaded = "PlanetInvaded",
  PlanetCaptured = "PlanetCaptured",
  LocationRevealed = "LocationRevealed",
  ArtifactFound = "ArtifactFound",
  ArtifactDeposited = "ArtifactDeposited",
  ArtifactWithdrawn = "ArtifactWithdrawn",
  ArtifactActivated = "ArtifactActivated",
  ArtifactDeactivated = "ArtifactDeactivated",
  PlanetSilverWithdrawn = "PlanetSilverWithdrawn",
  AdminOwnershipChanged = "AdminOwnershipChanged",
  AdminGiveSpaceship = "AdminGiveSpaceship",
  PauseStateChanged = "PauseStateChanged",
  LobbyCreated = "LobbyCreated",
}

// planet locationID(BigInt), branch number
export type UpgradeArgs = [string, string];

export type MoveArgs = [
  [string, string], // proofA
  [
    // proofB
    [string, string],
    [string, string],
  ],
  [string, string], // proofC
  [
    string, // from locationID (BigInt)
    string, // to locationID (BigInt)
    string, // perlin at to
    string, // radius at to
    string, // distMax
    string, // planetHashKey
    string, // spaceTypeKey
    string, // perlin lengthscale
    string, // perlin xmirror (1 true, 0 false)
    string, // perlin ymirror (1 true, 0 false)
  ],
  string, // ships sent
  string, // silver sent
  string, // artifactId sent
  string, // is planet being released (1 true, 0 false)
];

// Same as reveal args with Explicit coords attached
export type ClaimArgs = [
  [string, string],
  [[string, string], [string, string]],
  [string, string],
  [string, string, string, string, string, string, string, string, string],
];

export type DepositArtifactArgs = [string, string]; // locationId, artifactId
export type WithdrawArtifactArgs = [string, string]; // locationId, artifactId
export type WhitelistArgs = [string, string]; // hashed whitelist key, recipient address

export type PlanetTypeWeights = [number, number, number, number, number]; // relative frequencies of the 5 planet types
export type PlanetTypeWeightsByLevel = [
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
  PlanetTypeWeights,
];
export type PlanetTypeWeightsBySpaceType = [
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsByLevel,
  PlanetTypeWeightsByLevel,
];

export type ClientMockchainData =
  | null
  | undefined
  | number
  | string
  | boolean
  // | EthersBN
  | ClientMockchainData[]
  | {
      [key in string | number]: ClientMockchainData;
    };

export const enum PlanetEventType {
  ARRIVAL,
}
