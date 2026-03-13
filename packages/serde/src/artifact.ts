import type {
  Artifact,
  ArtifactId,
  ArtifactPointValues,
  ArtifactRarity,
  ArtifactType,
  Biome,
  LocationId,
  Upgrade,
} from "@dfpunk/types";
import {
  ArtifactRarity as ArtifactRarityEnum,
  ArtifactType as ArtifactTypeEnum,
  Biome as BiomeEnum,
} from "@dfpunk/types";
import { address } from "./address";
import { decodeArtifactLocation } from "./artifact_location";
import type { ArtifactLocationState, ArtifactState } from "./chain_state";
import { locationIdFromHexStr, locationIdFromDecStr } from "./location";

type FieldLike = bigint | string;

function isFieldZero(s: string): boolean {
  if (s === "0" || s === "0x0" || s === "0x") return true;
  try {
    return BigInt(s.startsWith("0x") ? s : "0x" + s) === 0n;
  } catch {
    return false;
  }
}

export function artifactIdFromHexStr(artifactId: string): ArtifactId {
  const hex = artifactId.startsWith("0x") ? artifactId : "0x" + artifactId;
  const n = BigInt(hex);
  if (n >= 2n ** 256n) throw new Error("not a valid artifact id");
  let ret = n.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as ArtifactId;
}

export function artifactIdFromDecStr(artifactId: string): ArtifactId {
  const n = BigInt(artifactId);
  let ret = n.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as ArtifactId;
}

/**
 * Converts a chain/field value (bigint or string) to an ArtifactId.
 */
export function artifactIdFromField(f: FieldLike): ArtifactId {
  if (typeof f === "bigint") return artifactIdFromDecStr(f.toString());
  const s = String(f);
  return s.startsWith("0x")
    ? artifactIdFromHexStr(s)
    : artifactIdFromHexStr("0x" + s);
}

export function artifactIdToDecStr(artifactId: ArtifactId): string {
  return BigInt("0x" + artifactId).toString(10);
}

export type RawArtifactPointValues = (bigint | number)[];

export function decodeArtifactPointValues(
  rawPointValues: RawArtifactPointValues,
): ArtifactPointValues {
  return {
    [ArtifactRarityEnum.Unknown]: Number(
      rawPointValues[ArtifactRarityEnum.Unknown] ?? 0,
    ),
    [ArtifactRarityEnum.Common]: Number(
      rawPointValues[ArtifactRarityEnum.Common] ?? 0,
    ),
    [ArtifactRarityEnum.Rare]: Number(
      rawPointValues[ArtifactRarityEnum.Rare] ?? 0,
    ),
    [ArtifactRarityEnum.Epic]: Number(
      rawPointValues[ArtifactRarityEnum.Epic] ?? 0,
    ),
    [ArtifactRarityEnum.Legendary]: Number(
      rawPointValues[ArtifactRarityEnum.Legendary] ?? 0,
    ),
    [ArtifactRarityEnum.Mythic]: Number(
      rawPointValues[ArtifactRarityEnum.Mythic] ?? 0,
    ),
  };
}

const DEFENSE_MULTIPLIERS_PLANETARY_SHIELD = [100, 150, 200, 300, 450, 650];
const DEF_MULTIPLIERS_PHOTOID_CANNON = [100, 50, 40, 30, 20, 10];
const TIME_DELAY_RANGE_PHOTOID = [100, 200, 200, 200, 200, 200];
const TIME_DELAY_SPEED_PHOTOID = [100, 500, 1000, 1500, 2000, 2500];

function upgrade(
  energyCap: number,
  energyGro: number,
  range: number,
  speed: number,
  def: number,
): Upgrade {
  return {
    energyCapMultiplier: energyCap,
    energyGroMultiplier: energyGro,
    rangeMultiplier: range,
    speedMultiplier: speed,
    defMultiplier: def,
  };
}

/**
 * Returns the default Upgrade (all multipliers 100). Mirrors contract defaultUpgrade().
 */
export function defaultUpgrade(): Upgrade {
  return upgrade(100, 100, 100, 100, 100);
}

/**
 * Returns the time-delayed upgrade for an artifact. Mirrors contract timeDelayUpgrade().
 */
export function timeDelayUpgrade(artifact: Artifact): Upgrade {
  if ((artifact.artifactType as number) === ArtifactTypeEnum.PhotoidCannon) {
    const r = Math.min(5, Math.max(0, artifact.rarity as number));
    return upgrade(
      100,
      100,
      TIME_DELAY_RANGE_PHOTOID[r] ?? 100,
      TIME_DELAY_SPEED_PHOTOID[r] ?? 100,
      100,
    );
  }
  return defaultUpgrade();
}

/**
 * Computes the Upgrade applied when this artifact is on a planet (mirrors
 * contract _getUpgradeForArtifact).
 */
export function getUpgradeForArtifact(artifact: Artifact): Upgrade {
  const t = artifact.artifactType as number;
  const r = Math.min(5, Math.max(0, artifact.rarity as number));
  const b = artifact.planetBiome as number;

  if (t === ArtifactTypeEnum.PlanetaryShield) {
    return upgrade(
      100,
      100,
      20,
      20,
      DEFENSE_MULTIPLIERS_PLANETARY_SHIELD[r] ?? 100,
    );
  }

  if (t === ArtifactTypeEnum.PhotoidCannon) {
    return upgrade(
      100,
      100,
      100,
      100,
      DEF_MULTIPLIERS_PHOTOID_CANNON[r] ?? 100,
    );
  }

  if (t >= 5) {
    return upgrade(100, 100, 100, 100, 100);
  }

  let popCap = 100;
  let popGro = 100;
  let range = 100;
  let speed = 100;
  let def = 100;

  if (t === ArtifactTypeEnum.Monolith) {
    popCap += 5;
    popGro += 5;
  } else if (t === ArtifactTypeEnum.Colossus) {
    speed += 5;
  } else if (t === ArtifactTypeEnum.Spaceship) {
    range += 5;
  } else if (t === ArtifactTypeEnum.Pyramid) {
    def += 5;
  }

  if (b === BiomeEnum.OCEAN) {
    speed += 5;
    def += 5;
  } else if (b === BiomeEnum.FOREST) {
    def += 5;
    popCap += 5;
    popGro += 5;
  } else if (b === BiomeEnum.GRASSLAND) {
    popCap += 5;
    popGro += 5;
    range += 5;
  } else if (b === BiomeEnum.TUNDRA) {
    def += 5;
    range += 5;
  } else if (b === BiomeEnum.SWAMP) {
    speed += 5;
    range += 5;
  } else if (b === BiomeEnum.DESERT) {
    speed += 10;
  } else if (b === BiomeEnum.ICE) {
    range += 10;
  } else if (b === BiomeEnum.WASTELAND) {
    def += 10;
  } else if (b === BiomeEnum.LAVA) {
    popCap += 10;
    popGro += 10;
  } else if (b === BiomeEnum.CORRUPTED) {
    range += 5;
    speed += 5;
    popCap += 5;
    popGro += 5;
  }

  const scale = 1 + Math.floor(r / 2);

  popCap = scale * popCap - (scale - 1) * 100;
  popGro = scale * popGro - (scale - 1) * 100;
  speed = scale * speed - (scale - 1) * 100;
  range = scale * range - (scale - 1) * 100;
  def = scale * def - (scale - 1) * 100;

  return upgrade(popCap, popGro, range, speed, def);
}

function toLocationId(s: string): LocationId {
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

/**
 * Decodes chain state (key + ArtifactState) into an Artifact (see @dfpunk/types).
 * key is the artifact id string; currentOwner defaults to state.controller.
 * When artifactLocation is provided, onPlanetId and onVoyageId are set from it.
 */
export function decodeArtifact(
  key: string,
  state: ArtifactState,
  currentOwner?: string,
  artifactLocation?: ArtifactLocationState,
): Artifact {
  const id = key.startsWith("0x")
    ? artifactIdFromHexStr(key)
    : artifactIdFromDecStr(key);
  const wormholeTo = isFieldZero(state.wormhole_to)
    ? undefined
    : (toLocationId(state.wormhole_to) as LocationId);

  const art: Artifact = {
    isInititalized: true,
    id,
    planetDiscoveredOn: toLocationId(state.planet_discovered_on),
    rarity: Number(state.rarity) as ArtifactRarity,
    planetBiome: Number(state.planet_biome) as Biome,
    mintedAtTimestamp: Number(state.minted_at_timestamp),
    discoverer: address(state.discoverer),
    artifactType: Number(state.artifact_type) as ArtifactType,
    activations: Number(state.activations),
    lastActivated: Number(state.last_activated),
    lastDeactivated: Number(state.last_deactivated),
    controller: address(state.controller),
    wormholeTo,
    currentOwner: currentOwner ? address(currentOwner) : address(state.owner),
    onPlanetId: undefined,
    onVoyageId: undefined,
    upgrade: defaultUpgrade(),
    timeDelayedUpgrade: defaultUpgrade(),
  };
  if (artifactLocation) {
    const loc = decodeArtifactLocation(key, artifactLocation);
    art.onPlanetId = loc.planetId;
    art.onVoyageId = loc.voyageId;
  }
  art.upgrade = getUpgradeForArtifact(art);
  art.timeDelayedUpgrade = timeDelayUpgrade(art);
  return art;
}
