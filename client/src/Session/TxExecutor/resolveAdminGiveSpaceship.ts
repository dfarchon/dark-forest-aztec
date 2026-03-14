/**
 * StateResolver: resolveAdminGiveSpaceship
 *
 * Contract signature:
 * admin_give_spaceship(args: DFTCreateArtifactArgs, planet, planet_artifacts_state)
 *
 * DFTCreateArtifactArgs: { id, discoverer, planet_id, rarity, biome, artifact_type, controller }
 *
 * Intent args (flat): [locationIdDec, artifactType, ownerAddress]
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import type { TxIntent } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import { planetArtifactsToContract, planetToContract } from "./stateConvert";
import { planetArtifactsZero, planetZero } from "./stateZeros";

export async function resolveAdminGiveSpaceship(
  intent: TxIntent,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  const [rawLocationId, artifactType, ownerAddress] = intentArgs;
  const planetIdDec = String(rawLocationId);
  const planetId = BigInt(planetIdDec);

  const argsStruct = {
    id: Fr.random().toBigInt(),
    discoverer: AztecAddress.fromString(String(ownerAddress)),
    planet_id: planetId,
    rarity: 0,
    biome: 0,
    artifact_type: Number(artifactType),
    controller: AztecAddress.fromString(String(ownerAddress)),
  };

  const planetRaw = deps.indexer.getPlanet(planetIdDec);
  const planetState = planetRaw ? planetToContract(planetRaw) : planetZero();

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(planetIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  return [argsStruct, planetState, planetArtifactsState];
}
