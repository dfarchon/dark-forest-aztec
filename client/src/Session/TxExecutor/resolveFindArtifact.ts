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

import type { UnconfirmedFindArtifact } from "@dfpunk/types";
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
  console.time("[FindArtifact] total resolve");
  const intentArgs = await intent.args;
  // intentArgs = [locationIdDec, x, y, biomebase]
  const [rawLocationId, rawX, rawY, rawBiomebase] = intentArgs;
  let locationId = hexIdToField(rawLocationId);
  const x = signedCoordToField(rawX as number | bigint);
  const y = signedCoordToField(rawY as number | bigint);
  const biomebase = Number(rawBiomebase);

  console.time("[FindArtifact] chainClock.resync");
  await deps.chainClock.resync();
  console.timeEnd("[FindArtifact] chainClock.resync");

  console.time("[FindArtifact] configCache.getConfig");
  const config = await deps.configCache.getConfig();
  console.timeEnd("[FindArtifact] configCache.getConfig");

  // When ZK checks enabled, recompute location hash with Poseidon2
  const snark = config.snarkConfig as Record<string, unknown> | undefined;
  if (snark && !snark.disable_zk_checks) {
    console.time("[FindArtifact] computeLocationProof");
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
    console.timeEnd("[FindArtifact] computeLocationProof");
    console.debug("[FindArtifact proof] computed (Poseidon2):", {
      x: inputs.x,
      y: inputs.y,
      locationHash: outputs.locationHash.toString(),
    });
  }

  // rawLocationId is already a decimal string (from GameManager.findArtifact),
  // so use it directly — do NOT pass through locationIdToDecStr which expects hex.
  const locationIdDec = String(rawLocationId);
  const playerAddr = deps.getPlayerAddress();

  // Load planet state — retry if indexer hasn't synced prospect's effects yet
  let planetRaw = deps.indexer.getPlanet(locationIdDec);
  if (
    !planetRaw ||
    planetRaw.owner === undefined ||
    planetRaw.prospected_block_number === undefined ||
    planetRaw.prospected_block_number === 0
  ) {
    console.warn(
      "[FindArtifact] planet state missing or stale after waitForBlock, retrying...",
      {
        owner: planetRaw?.owner,
        prospected_block_number: planetRaw?.prospected_block_number,
      }
    );
    // Wait for the next indexer update and retry up to 5 times
    for (let retry = 0; retry < 5; retry++) {
      await new Promise<void>((r) => setTimeout(r, 2000));
      planetRaw = deps.indexer.getPlanet(locationIdDec);
      if (planetRaw?.owner && planetRaw.prospected_block_number) {
        console.debug(
          `[FindArtifact] planet state synced after retry ${retry + 1}`
        );
        break;
      }
      console.warn(`[FindArtifact] retry ${retry + 1}/5: still missing`, {
        owner: planetRaw?.owner,
        prospected_block_number: planetRaw?.prospected_block_number,
      });
    }
  }
  const planet = planetRaw ? planetToContract(planetRaw) : planetZero();

  // Debug: print planet owner vs player address
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

  const planetEventsRaw = deps.indexer.getPlanetEvents(locationIdDec);
  const planetEventsState = planetEventsRaw
    ? planetEventsToContract(planetEventsRaw)
    : planetEventsZero();

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(locationIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  // Load arrivals from planet events
  console.time("[FindArtifact] loadArrivals");
  const arrivalData = await loadArrivalsForPlanetEvents(
    deps.indexer,
    planetEventsRaw
  );
  console.timeEnd("[FindArtifact] loadArrivals");

  // Load owned artifacts on this planet
  console.time("[FindArtifact] loadArtifacts");
  const ownedData = await loadArtifactsForPlanet(
    deps.indexer,
    planetArtifactsRaw
  );
  console.timeEnd("[FindArtifact] loadArtifacts");

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

  console.timeEnd("[FindArtifact] total resolve");

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
