/**
 * StateResolver: resolveFindArtifact
 *
 * Contract signature:
 * find_artifact(location_id, x, y, biomebase, timestamp,
 *   provided_snark_config, game_config_core, world_config, artifacts_config,
 *   player, planet, planet_events_state,
 *   arrivals[20], arrival_artifacts[20], arrival_artifact_locations[20],
 *   planet_artifacts_state, owned_artifacts[20], owned_artifact_locations[20],
 *   world)
 */

import { locationIdToDecStr } from "@dfpunk/serde";
import type { UnconfirmedFindArtifact } from "@dfpunk/types";
import type { LocationId } from "@dfpunk/types";
import {
  buildLocationProofInputs,
  computeLocationProofOutputs,
} from "@dfpunk/utils";

import type { ResolverDeps } from "./resolverHelpers";
import {
  collectEntityTimes,
  computeTimestamp,
  hexIdToField,
  loadArtifactsForPlanet,
} from "./resolverHelpers";
import { loadArrivalsForPlanetEvents } from "./resolverShared";
import {
  planetArtifactsToContract,
  planetEventsToContract,
  planetToContract,
  playerToContract,
  worldToContract,
} from "./stateConvert";
import {
  planetArtifactsZero,
  planetEventsZero,
  planetZero,
  playerZero,
  worldInitial,
} from "./stateZeros";

// BN254 scalar field modulus
const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function signedCoordToField(v: number | bigint): bigint {
  const n = typeof v === "bigint" ? v : BigInt(v);
  return n < 0n ? BN254_FR_MODULUS + n : n;
}

export async function resolveFindArtifact(
  intent: UnconfirmedFindArtifact,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec, x, y, biomebase]
  const [rawLocationId, rawX, rawY, rawBiomebase] = intentArgs;
  let locationId = hexIdToField(rawLocationId);
  const x = signedCoordToField(rawX as number | bigint);
  const y = signedCoordToField(rawY as number | bigint);
  const biomebase = Number(rawBiomebase);

  await deps.chainClock.resync();
  const config = await deps.configCache.getConfig();

  // When ZK checks enabled, recompute location hash with Poseidon2
  const snark = config.snarkConfig as Record<string, unknown> | undefined;
  if (snark && !snark.disable_zk_checks) {
    const coord = (v: unknown) =>
      typeof v === "number" ? v : Number(BigInt(String(v ?? 0)));
    const inputs = buildLocationProofInputs(
      {
        planethash_key: BigInt(String(snark.planethash_key ?? 0)),
        spacetype_key: BigInt(String(snark.spacetype_key ?? 0)),
        perlin_length_scale: BigInt(String(snark.perlin_length_scale ?? 0)),
        perlin_mirror_x: Boolean(snark.perlin_mirror_x),
        perlin_mirror_y: Boolean(snark.perlin_mirror_y),
      },
      coord(rawX),
      coord(rawY)
    );
    const outputs = await computeLocationProofOutputs(inputs);
    locationId = outputs.locationHash;
    console.debug("[FindArtifact proof] computed (Poseidon2):", {
      x: inputs.x,
      y: inputs.y,
      locationHash: outputs.locationHash.toString(),
    });
  }

  const locationIdDec = locationIdToDecStr(String(rawLocationId) as LocationId);
  const playerAddr = deps.getPlayerAddress();

  // Load planet state
  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  const planetEventsRaw = deps.indexer.getPlanetEvents(locationIdDec);
  const planetEventsState = planetEventsRaw
    ? planetEventsToContract(planetEventsRaw)
    : planetEventsZero();

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(locationIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  // Load arrivals from planet events
  const arrivalData = loadArrivalsForPlanetEvents(
    deps.indexer,
    planetEventsRaw
  );

  // Load owned artifacts on this planet
  const ownedData = loadArtifactsForPlanet(deps.indexer, planetArtifactsRaw);

  // Player state
  const playerRaw = deps.indexer.getPlayer(playerAddr);
  const player = playerRaw ? playerToContract(playerRaw) : playerZero();

  // World state
  const worldRaw = deps.indexer.getWorld();
  const world = worldRaw ? worldToContract(worldRaw) : worldInitial();

  // Timestamp
  const timestamp = computeTimestamp(
    deps.chainClock,
    collectEntityTimes(
      planetRaw,
      planetEventsRaw,
      planetArtifactsRaw,
      playerRaw
    )
  );

  return [
    locationId,
    x,
    y,
    biomebase,
    timestamp,
    config.snarkConfig,
    config.gameConfigCore,
    config.worldConfig,
    config.artifactsConfig,
    player,
    planet,
    planetEventsState,
    arrivalData.arrivals,
    arrivalData.artifacts,
    arrivalData.artifactLocations,
    planetArtifactsState,
    ownedData.artifacts,
    ownedData.artifactLocations,
    world,
  ];
}
