/**
 * StateResolver: resolveAdminGiveArtifact
 *
 * Contract signature:
 * admin_give_artifact(args: DFTCreateArtifactArgs, planet_artifacts_state)
 *
 * DFTCreateArtifactArgs: { id, discoverer, planet_id, rarity, biome, artifact_type, controller }
 *
 * Intent args (flat): [locationIdDec, rarity, biome, artifactType, ownerAddress]
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import type { TxIntent } from "@dfpunk/types";

import type { ResolverDeps } from "./resolverHelpers";
import { planetArtifactsToContract } from "./stateConvert";
import { planetArtifactsZero } from "./stateZeros";

export async function resolveAdminGiveArtifact(
  intent: TxIntent,
  deps: ResolverDeps
): Promise<unknown[]> {
  const intentArgs = await intent.args;
  const [rawLocationId, rarity, biome, artifactType, ownerAddress] = intentArgs;
  const planetIdDec = String(rawLocationId);
  const planetId = BigInt(planetIdDec);

  const argsStruct = {
    id: Fr.random().toBigInt(),
    discoverer: AztecAddress.fromString(String(ownerAddress)),
    planet_id: planetId,
    rarity: Number(rarity),
    biome: Number(biome),
    artifact_type: Number(artifactType),
    controller: AztecAddress.ZERO,
  };

  const planetArtifactsRaw = deps.indexer.getPlanetArtifacts(planetIdDec);
  const planetArtifactsState = planetArtifactsRaw
    ? planetArtifactsToContract(planetArtifactsRaw)
    : planetArtifactsZero();

  return [argsStruct, planetArtifactsState];
}
