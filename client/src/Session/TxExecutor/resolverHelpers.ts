/**
 * Shared types and helpers for StateResolver resolve* functions.
 */

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { GameConfig } from "./ConfigCache";
import type { ConfigCache } from "./ConfigCache";
import { artifactLocationToContract, artifactToContract } from "./stateConvert";
import { artifactLocationZero, artifactZero } from "./stateZeros";

const yieldTick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Shared dependencies passed from StateResolver to each resolve function.
 */
export interface ResolverDeps {
  indexer: IndexerConnection;
  configCache: ConfigCache;
  chainClock: ChainClock;
  getPlayerAddress: () => string;
}

/** Convert a hex LocationId string (no 0x prefix) to bigint for Fr encoding. */
export function hexIdToField(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  const s = String(v);
  return BigInt(s.startsWith("0x") ? s : `0x${s}`);
}

/**
 * Compute a safe timestamp: max of chainClock.nowSec() and all entity last_updated times.
 * The contract asserts timestamp >= all entity last_updated fields.
 */
export function computeTimestamp(
  chainClock: ChainClock,
  entityTimes: bigint[]
): bigint {
  let timestamp = BigInt(Math.floor(chainClock.nowSec()));
  let maxEntityTime = 0n;
  for (const t of entityTimes) {
    if (t > maxEntityTime) maxEntityTime = t;
  }
  if (maxEntityTime > timestamp) {
    console.warn(
      `[StateResolver] chainClock ${timestamp} behind entity state (max last_updated=${maxEntityTime}), advancing timestamp`
    );
    timestamp = maxEntityTime;
  }
  return timestamp;
}

/**
 * Load artifacts on a planet (from planet_artifacts.ids), returning padded
 * arrays of artifact state and artifact location state (length 20).
 * Used by prospect, find, deposit, withdraw.
 */
export async function loadArtifactsForPlanet(
  indexer: IndexerConnection,
  planetArtifactsRaw:
    | import("../Indexer/TableTypes/chain").PlanetArtifactsState
    | undefined
): Promise<{
  artifacts: Record<string, unknown>[];
  artifactLocations: Record<string, unknown>[];
}> {
  const count = planetArtifactsRaw?.count ?? 0;
  const ids = planetArtifactsRaw?.ids ?? [];

  const artifacts: Record<string, unknown>[] = [];
  const artifactLocations: Record<string, unknown>[] = [];

  for (let i = 0; i < 20; i++) {
    if (i < count && ids[i] != null && String(ids[i]) !== "0") {
      const artId = String(ids[i]);
      const artRaw = indexer.getArtifact(artId);
      artifacts.push(artRaw ? artifactToContract(artRaw) : artifactZero());
      const locRaw = indexer.getArtifactLocation(artId);
      artifactLocations.push(
        locRaw ? artifactLocationToContract(locRaw) : artifactLocationZero()
      );
    } else {
      artifacts.push(artifactZero());
      artifactLocations.push(artifactLocationZero());
    }
    await yieldTick();
  }

  return { artifacts, artifactLocations };
}

/**
 * Collect last_updated times from common entity states.
 */
export function collectEntityTimes(
  ...raws: ({ last_updated: bigint | number } | undefined | null)[]
): bigint[] {
  const times: bigint[] = [];
  for (const raw of raws) {
    if (raw != null) {
      times.push(
        typeof raw.last_updated === "bigint"
          ? raw.last_updated
          : BigInt(raw.last_updated)
      );
    }
  }
  return times;
}
