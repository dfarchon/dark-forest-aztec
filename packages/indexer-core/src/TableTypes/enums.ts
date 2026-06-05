/**
 * Enum constants aligned with contracts/types/src/storage (Noir mods).
 * Values match on-chain u8 used for planet_type, space_type, arrival_type, etc.
 */

export const PlanetType = {
  Planet: 0,
  SilverMine: 1,
  Ruins: 2,
  TradingPost: 3,
  SilverBank: 4,
} as const;

export type PlanetTypeValue = (typeof PlanetType)[keyof typeof PlanetType];

export const PlanetTypeName: Record<PlanetTypeValue, string> = {
  0: "Planet",
  1: "SilverMine",
  2: "Ruins",
  3: "TradingPost",
  4: "SilverBank",
};

// ---------------------------------------------------------------------------

export const SpaceType = {
  Nebula: 0,
  Space: 1,
  DeepSpace: 2,
  DeadSpace: 3,
} as const;

export type SpaceTypeValue = (typeof SpaceType)[keyof typeof SpaceType];

export const SpaceTypeName: Record<SpaceTypeValue, string> = {
  0: "Nebula",
  1: "Space",
  2: "DeepSpace",
  3: "DeadSpace",
};

// ---------------------------------------------------------------------------

export const UpgradeBranch = {
  Defense: 0,
  Range: 1,
  Speed: 2,
} as const;

export type UpgradeBranchValue =
  (typeof UpgradeBranch)[keyof typeof UpgradeBranch];

export const UpgradeBranchName: Record<UpgradeBranchValue, string> = {
  0: "Defense",
  1: "Range",
  2: "Speed",
};

// ---------------------------------------------------------------------------

export const Biome = {
  Unknown: 0,
  Ocean: 1,
  Forest: 2,
  Grassland: 3,
  Tundra: 4,
  Swamp: 5,
  Desert: 6,
  Ice: 7,
  Wasteland: 8,
  Lava: 9,
  Corrupted: 10,
} as const;

export type BiomeValue = (typeof Biome)[keyof typeof Biome];

export const BiomeName: Record<BiomeValue, string> = {
  0: "Unknown",
  1: "Ocean",
  2: "Forest",
  3: "Grassland",
  4: "Tundra",
  5: "Swamp",
  6: "Desert",
  7: "Ice",
  8: "Wasteland",
  9: "Lava",
  10: "Corrupted",
};

// ---------------------------------------------------------------------------

export const PlanetEventType = {
  Arrival: 0,
} as const;

export type PlanetEventTypeValue =
  (typeof PlanetEventType)[keyof typeof PlanetEventType];

export const PlanetEventTypeName: Record<PlanetEventTypeValue, string> = {
  0: "Arrival",
};

// ---------------------------------------------------------------------------

export const ArrivalType = {
  Unknown: 0,
  Normal: 1,
  Photoid: 2,
  Wormhole: 3,
} as const;

export type ArrivalTypeValue = (typeof ArrivalType)[keyof typeof ArrivalType];

export const ArrivalTypeName: Record<ArrivalTypeValue, string> = {
  0: "Unknown",
  1: "Normal",
  2: "Photoid",
  3: "Wormhole",
};

// ---------------------------------------------------------------------------

export const ArtifactType = {
  Unknown: 0,
  Monolith: 1,
  Colossus: 2,
  Spaceship: 3,
  Pyramid: 4,
  Wormhole: 5,
  PlanetaryShield: 6,
  PhotoidCannon: 7,
  BloomFilter: 8,
  BlackDomain: 9,
  ShipMothership: 10,
  ShipCrescent: 11,
  ShipWhale: 12,
  ShipGear: 13,
  ShipTitan: 14,
} as const;

export type ArtifactTypeValue =
  (typeof ArtifactType)[keyof typeof ArtifactType];

export const ArtifactTypeName: Record<ArtifactTypeValue, string> = {
  0: "Unknown",
  1: "Monolith",
  2: "Colossus",
  3: "Spaceship",
  4: "Pyramid",
  5: "Wormhole",
  6: "PlanetaryShield",
  7: "PhotoidCannon",
  8: "BloomFilter",
  9: "BlackDomain",
  10: "ShipMothership",
  11: "ShipCrescent",
  12: "ShipWhale",
  13: "ShipGear",
  14: "ShipTitan",
};

// ---------------------------------------------------------------------------

export const ArtifactRarity = {
  Unknown: 0,
  Common: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
  Mythic: 5,
} as const;

export type ArtifactRarityValue =
  (typeof ArtifactRarity)[keyof typeof ArtifactRarity];

export const ArtifactRarityName: Record<ArtifactRarityValue, string> = {
  0: "Unknown",
  1: "Common",
  2: "Rare",
  3: "Epic",
  4: "Legendary",
  5: "Mythic",
};
