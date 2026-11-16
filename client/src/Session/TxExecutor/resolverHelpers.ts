/**
 * Shared types and helpers for StateResolver resolve* functions.
 */

import type { ChainClock } from "../../Backend/Utils/ChainClock";
import type { IndexerConnection } from "../Indexer/IndexerConnection";
import type { GameConfig } from "./ConfigCache";
import type { ConfigCache } from "./ConfigCache";
import type { ArrivalHealFn } from "./resolverShared";
import { artifactLocationToContract, artifactToContract } from "./stateConvert";
import { artifactLocationZero, artifactZero } from "./stateZeros";

/**
 * Shared dependencies passed from StateResolver to each resolve function.
 */
export interface ResolverDeps {
  indexer: IndexerConnection;
  configCache: ConfigCache;
  chainClock: ChainClock;
  getPlayerAddress: () => string;
  /** Optional: fetch a missing arrival from ArrivalStorage packed slots. */
  healArrival?: ArrivalHealFn;
}

/**
 * Convert a location/artifact id to a Field bigint.
 * Accepts bigint, 0x-hex, bare 64-char hex LocationId, or decimal string
 * (as produced by locationIdToDecStr / artifactIdToDecStr).
 *
 * 64-char hex is checked before pure-decimal so padded LocationIds that only
 * use digits 0-9 (e.g. ...00003039) are not misread as decimal.
 */
export function idToField(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  const s = String(v).trim();
  if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
  if (/^[0-9a-fA-F]{64}$/.test(s)) return BigInt(`0x${s}`);
  if (/^\d+$/.test(s)) return BigInt(s);
  return BigInt(`0x${s}`);
}

/** @deprecated Prefer idToField — kept for call sites that pass hex LocationIds. */
export function hexIdToField(v: unknown): bigint {
  return idToField(v);
}

/**
 * Compute a safe timestamp: max of baseTimestamp and all entity last_updated times.
 * `baseTimestamp` must be the latest L2 block timestamp (see TxExecutor sync).
 * Private circuits require timestamp >= entity last_updated; public circuits
 * require timestamp <= block time — so entity times ahead of the tip are fatal.
 */
export function computeTimestamp(
  baseTimestamp: bigint,
  entityTimes: bigint[]
): bigint {
  let maxEntityTime = 0n;
  for (const t of entityTimes) {
    if (t > maxEntityTime) maxEntityTime = t;
  }
  if (maxEntityTime > baseTimestamp) {
    throw new Error(
      `[StateResolver] chain block timestamp ${baseTimestamp} is behind entity last_updated=${maxEntityTime}. Wait for the next block and retry.`
    );
  }
  return baseTimestamp;
}

/**
 * Load artifacts on a planet (from planet_artifacts.ids), returning padded
 * arrays of artifact state and artifact location state (length 20).
 * Used by prospect, find, deposit, withdraw.
 */
export function loadArtifactsForPlanet(
  indexer: IndexerConnection,
  planetArtifactsRaw:
    | import("@dfpunk/indexer-core/TableTypes/chain").PlanetArtifactsState
    | undefined
): {
  artifacts: Record<string, unknown>[];
  artifactLocations: Record<string, unknown>[];
} {
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
