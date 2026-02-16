import type {
  Artifact,
  ArtifactId,
  ArtifactPointValues,
  ArtifactRarity,
  ArtifactType,
  Biome,
  EthAddress,
  LocationId,
} from "@dfpunk/types";
import { ArtifactRarity as ArtifactRarityEnum } from "@dfpunk/types";
import type { ArtifactUpdate } from "@dfpunk/contracts/artifacts/ArtifactStorage";
import { address } from "./address";
import { locationIdFromBigInt, locationIdFromHexStr } from "./location";

/** Field value from Aztec contract (field element as bigint or hex string). */
type FieldLike = bigint | string;

/**
 * Converts a possibly 0x-prefixed string of hex digits to an `ArtifactId`: a
 * non-0x-prefixed all lowercase hex string of exactly 64 hex characters
 * (0-padded if necessary).
 *
 * @param artifactId Possibly 0x-prefixed, possibly unpadded hex `string`
 * representation of an artifact's ID.
 */
export function artifactIdFromHexStr(artifactId: string): ArtifactId {
  const hex = artifactId.startsWith("0x") ? artifactId : "0x" + artifactId;
  const n = BigInt(hex);
  if (n >= 2n ** 256n) throw new Error("not a valid artifact id");
  let ret = n.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as ArtifactId;
}

/**
 * Converts a string representing a decimal number into an ArtifactID: a
 * non-0x-prefixed all lowercase hex string of exactly 64 hex characters
 * (0-padded if necessary).
 *
 * @param artifactId `string` of decimal digits, the base 10 representation of an
 * artifact ID.
 */
export function artifactIdFromDecStr(artifactId: string): ArtifactId {
  const n = BigInt(artifactId);
  let ret = n.toString(16);
  while (ret.length < 64) ret = "0" + ret;
  return ret as ArtifactId;
}

/**
 * Converts a field value (from Aztec contract) to an ArtifactId.
 */
export function fieldToArtifactId(f: FieldLike): ArtifactId {
  if (typeof f === "bigint") return artifactIdFromDecStr(f.toString());
  const s = String(f);
  return s.startsWith("0x")
    ? artifactIdFromHexStr(s)
    : artifactIdFromHexStr("0x" + s);
}

/**
 * Converts an ArtifactID to a decimal string with equivalent numerical value;
 * can be used if you need to pass an artifact ID into a contract call.
 *
 * @param artifactId non-0x-prefixed lowercase hex `string` of 64 hex characters
 * representing an artifact's ID
 */
export function artifactIdToDecStr(artifactId: ArtifactId): string {
  return BigInt("0x" + artifactId).toString(10);
}

function fieldToLocationId(f: FieldLike): LocationId {
  if (typeof f === "bigint") return locationIdFromBigInt(f);
  const s = String(f);
  return locationIdFromHexStr(s.startsWith("0x") ? s : "0x" + s) as LocationId;
}

function isFieldZero(f: FieldLike): boolean {
  if (typeof f === "bigint") return f === 0n;
  const s = String(f);
  return s === "0" || s === "0x0" || s === "0x";
}

export type RawArtifactPointValues = (bigint | number)[];

/**
 * Converts raw artifact point values (e.g. from Config contract) to an
 * `ArtifactPointValues` object keyed by ArtifactRarity.
 */
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

/**
 * Converts an {@link ArtifactUpdate} from the ArtifactStorage contract into an
 * {@link Artifact} object (see @dfpunk/types).
 *
 * @param artifactUpdate Raw ArtifactUpdate from get_artifact or event
 * @param currentOwner Optional current owner address (e.g. from holder registry)
 */
export function decodeArtifact(
  artifactUpdate: ArtifactUpdate,
  currentOwner?: string,
): Artifact {
  const { id, state } = artifactUpdate;

  const wormholeToRaw = state.wormhole_to;
  const wormholeTo = isFieldZero(wormholeToRaw)
    ? undefined
    : fieldToLocationId(wormholeToRaw);

  return {
    isInititalized: true,
    id: fieldToArtifactId(id),
    planetDiscoveredOn: fieldToLocationId(state.planet_discovered_on),
    rarity: Number(state.rarity) as ArtifactRarity,
    planetBiome: Number(state.planet_biome) as Biome,
    mintedAtTimestamp: Number(state.minted_at_timestamp),
    discoverer: address(String(state.discoverer)),
    artifactType: Number(state.artifact_type) as ArtifactType,
    activations: Number(state.activations),
    lastActivated: Number(state.last_activated),
    lastDeactivated: Number(state.last_deactivated),
    controller: address(String(state.controller)),
    wormholeTo,
    currentOwner: (currentOwner
      ? address(currentOwner)
      : address(String(state.controller))) as EthAddress,
    onPlanetId: undefined,
    onVoyageId: undefined,
  };
}
