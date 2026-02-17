import type { Biome, SpaceType } from "./game_types";
import type {
  Abstract,
  ArtifactId,
  AztecAddr,
  LocationId,
} from "../identifiers";
import type { Upgrade, UpgradeState } from "./upgrade";
import type { WorldLocation } from "./world";

/**
 * Abstract type representing a planet level.
 */
export type PlanetLevel = Abstract<number, "PlanetLevel">;

/**
 * Enumeration of the possible planet levels.
 */
export const PlanetLevel = {
  ZERO: 0 as PlanetLevel,
  ONE: 1 as PlanetLevel,
  TWO: 2 as PlanetLevel,
  THREE: 3 as PlanetLevel,
  FOUR: 4 as PlanetLevel,
  FIVE: 5 as PlanetLevel,
  SIX: 6 as PlanetLevel,
  SEVEN: 7 as PlanetLevel,
  EIGHT: 8 as PlanetLevel,
  NINE: 9 as PlanetLevel,
} as const;

/**
 * Mapping from PlanetLevel to pretty-printed names.
 */
export const PlanetLevelNames = {
  [PlanetLevel.ZERO]: "Level 0",
  [PlanetLevel.ONE]: "Level 1",
  [PlanetLevel.TWO]: "Level 2",
  [PlanetLevel.THREE]: "Level 3",
  [PlanetLevel.FOUR]: "Level 4",
  [PlanetLevel.FIVE]: "Level 5",
  [PlanetLevel.SIX]: "Level 6",
  [PlanetLevel.SEVEN]: "Level 7",
  [PlanetLevel.EIGHT]: "Level 8",
  [PlanetLevel.NINE]: "Level 9",
} as const;

/**
 * Abstract type representing a planet type.
 */
export type PlanetType = Abstract<number, "PlanetType">;

/**
 * Enumeration of the planet types. (PLANET = 0, SILVER_BANK = 4)
 */
export const PlanetType = {
  PLANET: 0 as PlanetType,
  SILVER_MINE: 1 as PlanetType,
  RUINS: 2 as PlanetType,
  TRADING_POST: 3 as PlanetType,
  SILVER_BANK: 4 as PlanetType,
} as const;

/**
 * Mapping from PlanetType to pretty-printed names.
 */
export const PlanetTypeNames = {
  [PlanetType.PLANET]: "Planet",
  [PlanetType.SILVER_MINE]: "Asteroid Field",
  [PlanetType.RUINS]: "Foundry",
  [PlanetType.TRADING_POST]: "Spacetime Rip",
  [PlanetType.SILVER_BANK]: "Quasar",
} as const;

/**
 * A list of five flags, indicating whether the planet has an attached comet
 * doubling each of five stats: (in order) [energyCap, energyGrowth, range,
 * speed, defense]
 */
export type PlanetBonus = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
];

/**
 * Reference type for client-side animation. Actual class lives in client/planet.
 */
export type AnimationRef = unknown;

/**
 * Reference type for client-side stateful animation. Actual class lives in client/planet.
 */
export type StatefulAnimationRef<T> = unknown;

/**
 * Represents a Dark Forest planet object (planets, asteroid fields, quasars,
 * spacetime rips, and foundries).
 */
export type Planet = {
  locationId: LocationId;
  perlin: number;
  spaceType: SpaceType;
  owner: AztecAddr;
  hatLevel: number;
  planetLevel: PlanetLevel;
  planetType: PlanetType;
  isHomePlanet: boolean;
  energyCap: number;
  energyGrowth: number;
  silverCap: number;
  silverGrowth: number;
  range: number;
  defense: number;
  speed: number;
  energy: number;
  silver: number;
  spaceJunk: number;
  lastUpdated: number;
  upgradeState: UpgradeState;
  hasTriedFindingArtifact: boolean;
  heldArtifactIds: ArtifactId[];
  destroyed: boolean;
  prospectedBlockNumber?: number;
  localPhotoidUpgrade?: Upgrade;
  unconfirmedAddEmoji: boolean;
  unconfirmedClearEmoji: boolean;
  loadingServerState: boolean;
  needsServerRefresh: boolean;
  lastLoadedServerState?: number;
  emojiBobAnimation?: AnimationRef;
  emojiZoopAnimation?: AnimationRef;
  emojiZoopOutAnimation?: StatefulAnimationRef<string>;
  silverSpent: number;
  isInContract: boolean;
  syncedWithContract: boolean;
  coordsRevealed: boolean;
  revealer?: AztecAddr;
  claimer?: AztecAddr;
  bonus: PlanetBonus;
  pausers: number;
  energyGroDoublers: number;
  silverGroDoublers: number;
  invader?: AztecAddr;
  capturer?: AztecAddr;
  invadeStartBlock?: number;
};
