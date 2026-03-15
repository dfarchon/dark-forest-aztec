/**
 * StateResolver: resolveFindArtifact
 *
 * Contract signature:
 * find_artifact(location_id, x, y, biomebase, timestamp,
 *   provided_snark_config, game_config_core, world_config, artifacts_config,
 *   spaceships_config, player, planet, planet_events_state,
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

  const locationId_my = locationIdToDecStr(String(rawLocationId) as LocationId);

  const locationIdDec = String(rawLocationId);

  console.log("----- test -----");
  console.log("locationId_my", locationId_my);
  console.log("locationIdDec", locationIdDec);
  console.log("----- test -----");

  const playerAddr = deps.getPlayerAddress();

  // Load planet state
  const planetRaw = deps.indexer.getPlanet(locationIdDec);
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  console.debug("-------------------------------------------------------");
  console.debug("[FindArtifact] planet owner from indexer:", planetRaw?.owner);
  console.debug("[FindArtifact] player address (sender):", playerAddr);
  console.debug(
    "[FindArtifact] planet.owner passed to contract:",
    planet.owner
  );
  console.debug(
    "[FindArtifact] owner === sender?",
    planetRaw?.owner === playerAddr
  );
  console.debug(
    "[FindArtifact] planet prospected_block_number:",
    planetRaw?.prospected_block_number
  );
  console.debug(
    "[FindArtifact] planet has_tried_finding_artifact:",
    planetRaw?.has_tried_finding_artifact
  );
  console.debug("-------------------------------------------------------");

  // NOTE: The private circuit no longer calls get_block_header_at (see TODO in
  // artifact_find contract). The block-advance wait below is kept for the public
  // function's assertion: prospected_block_number < block_number.
  const prospectBlock = Number(planetRaw?.prospected_block_number ?? 0);
  const currentBlock = await deps.chainClock.getBlockNumber();
  console.debug(
    `[FindArtifact] prospectBlock=${prospectBlock}, currentBlock=${currentBlock}`
  );
  if (prospectBlock > 0 && currentBlock <= prospectBlock) {
    const MAX_WAIT_MS = 120_000;
    const POLL_MS = 2_000;
    const start = Date.now();
    let block = currentBlock;
    while (block <= prospectBlock) {
      if (Date.now() - start > MAX_WAIT_MS) {
        throw new Error(
          `[FindArtifact] timed out waiting for chain to advance past prospect block ${prospectBlock} (current: ${block})`
        );
      }
      console.debug(
        `[FindArtifact] waiting for chain to advance past prospect block ${prospectBlock} (current: ${block})...`
      );
      await new Promise((r) => setTimeout(r, POLL_MS));
      block = await deps.chainClock.getBlockNumber();
    }
    console.debug(
      `[FindArtifact] chain at block ${block}, prospect block ${prospectBlock} OK`
    );
  }

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
    config.spaceshipsConfig,
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
