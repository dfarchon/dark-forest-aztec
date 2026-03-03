import { getContractInstanceFromInstantiationParams } from "@aztec/aztec.js/contracts";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";

import {
  ACCOUNT_ADDRESS,
  ADMIN_CONTRACT_ADDRESS,
  ADMIN_DEPLOYER_ADDRESS,
  ADMIN_DEPLOYMENT_SALT,
  ARRIVAL_STORAGE_CONTRACT_ADDRESS,
  ARRIVAL_STORAGE_DEPLOYER_ADDRESS,
  ARRIVAL_STORAGE_DEPLOYMENT_SALT,
  ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_DEPLOYER_ADDRESS,
  ARTIFACT_LOCATION_STORAGE_DEPLOYMENT_SALT,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  ARTIFACT_STORAGE_DEPLOYER_ADDRESS,
  ARTIFACT_STORAGE_DEPLOYMENT_SALT,
  CORE_CONTRACT_ADDRESS,
  CORE_DEPLOYER_ADDRESS,
  CORE_DEPLOYMENT_SALT,
  MOVE_CONTRACT_ADDRESS,
  MOVE_DEPLOYER_ADDRESS,
  MOVE_DEPLOYMENT_SALT,
  PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_DEPLOYER_ADDRESS,
  PLANET_ARTIFACTS_STORAGE_DEPLOYMENT_SALT,
  PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
  PLANET_EVENTS_STORAGE_DEPLOYER_ADDRESS,
  PLANET_EVENTS_STORAGE_DEPLOYMENT_SALT,
  PLANET_STORAGE_CONTRACT_ADDRESS,
  PLANET_STORAGE_DEPLOYER_ADDRESS,
  PLANET_STORAGE_DEPLOYMENT_SALT,
  PLAYER_STORAGE_CONTRACT_ADDRESS,
  PLAYER_STORAGE_DEPLOYER_ADDRESS,
  PLAYER_STORAGE_DEPLOYMENT_SALT,
  WORLD_STORAGE_CONTRACT_ADDRESS,
  WORLD_STORAGE_DEPLOYER_ADDRESS,
  WORLD_STORAGE_DEPLOYMENT_SALT,
} from "../../packages/contracts/src/index.ts";

import { AdminContractArtifact } from "../../packages/contracts/src/artifacts/Admin.ts";
import { ArrivalStorageContractArtifact } from "../../packages/contracts/src/artifacts/ArrivalStorage.ts";
import { ArtifactLocationStorageContractArtifact } from "../../packages/contracts/src/artifacts/ArtifactLocationStorage.ts";
import { ArtifactStorageContractArtifact } from "../../packages/contracts/src/artifacts/ArtifactStorage.ts";
import { CoreContractArtifact } from "../../packages/contracts/src/artifacts/Core.ts";
import { MoveContractArtifact } from "../../packages/contracts/src/artifacts/Move.ts";
import { PlanetArtifactsStorageContractArtifact } from "../../packages/contracts/src/artifacts/PlanetArtifactsStorage.ts";
import { PlanetEventsStorageContractArtifact } from "../../packages/contracts/src/artifacts/PlanetEventsStorage.ts";
import { PlanetStorageContractArtifact } from "../../packages/contracts/src/artifacts/PlanetStorage.ts";
import { PlayerStorageContractArtifact } from "../../packages/contracts/src/artifacts/PlayerStorage.ts";
import { WorldStorageContractArtifact } from "../../packages/contracts/src/artifacts/WorldStorage.ts";

const admin = AztecAddress.fromString(ACCOUNT_ADDRESS);

const specs = [
  {
    name: "Core",
    expected: CORE_CONTRACT_ADDRESS,
    deployer: CORE_DEPLOYER_ADDRESS,
    salt: CORE_DEPLOYMENT_SALT,
    artifact: CoreContractArtifact,
  },
  {
    name: "Move",
    expected: MOVE_CONTRACT_ADDRESS,
    deployer: MOVE_DEPLOYER_ADDRESS,
    salt: MOVE_DEPLOYMENT_SALT,
    artifact: MoveContractArtifact,
  },
  {
    name: "Admin",
    expected: ADMIN_CONTRACT_ADDRESS,
    deployer: ADMIN_DEPLOYER_ADDRESS,
    salt: ADMIN_DEPLOYMENT_SALT,
    artifact: AdminContractArtifact,
  },
  {
    name: "PlanetStorage",
    expected: PLANET_STORAGE_CONTRACT_ADDRESS,
    deployer: PLANET_STORAGE_DEPLOYER_ADDRESS,
    salt: PLANET_STORAGE_DEPLOYMENT_SALT,
    artifact: PlanetStorageContractArtifact,
  },
  {
    name: "PlayerStorage",
    expected: PLAYER_STORAGE_CONTRACT_ADDRESS,
    deployer: PLAYER_STORAGE_DEPLOYER_ADDRESS,
    salt: PLAYER_STORAGE_DEPLOYMENT_SALT,
    artifact: PlayerStorageContractArtifact,
  },
  {
    name: "PlanetEventsStorage",
    expected: PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS,
    deployer: PLANET_EVENTS_STORAGE_DEPLOYER_ADDRESS,
    salt: PLANET_EVENTS_STORAGE_DEPLOYMENT_SALT,
    artifact: PlanetEventsStorageContractArtifact,
  },
  {
    name: "PlanetArtifactsStorage",
    expected: PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS,
    deployer: PLANET_ARTIFACTS_STORAGE_DEPLOYER_ADDRESS,
    salt: PLANET_ARTIFACTS_STORAGE_DEPLOYMENT_SALT,
    artifact: PlanetArtifactsStorageContractArtifact,
  },
  {
    name: "ArrivalStorage",
    expected: ARRIVAL_STORAGE_CONTRACT_ADDRESS,
    deployer: ARRIVAL_STORAGE_DEPLOYER_ADDRESS,
    salt: ARRIVAL_STORAGE_DEPLOYMENT_SALT,
    artifact: ArrivalStorageContractArtifact,
  },
  {
    name: "ArtifactStorage",
    expected: ARTIFACT_STORAGE_CONTRACT_ADDRESS,
    deployer: ARTIFACT_STORAGE_DEPLOYER_ADDRESS,
    salt: ARTIFACT_STORAGE_DEPLOYMENT_SALT,
    artifact: ArtifactStorageContractArtifact,
  },
  {
    name: "ArtifactLocationStorage",
    expected: ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS,
    deployer: ARTIFACT_LOCATION_STORAGE_DEPLOYER_ADDRESS,
    salt: ARTIFACT_LOCATION_STORAGE_DEPLOYMENT_SALT,
    artifact: ArtifactLocationStorageContractArtifact,
  },
  {
    name: "WorldStorage",
    expected: WORLD_STORAGE_CONTRACT_ADDRESS,
    deployer: WORLD_STORAGE_DEPLOYER_ADDRESS,
    salt: WORLD_STORAGE_DEPLOYMENT_SALT,
    artifact: WorldStorageContractArtifact,
  },
];

async function deriveAddress(spec) {
  const instance = await getContractInstanceFromInstantiationParams(spec.artifact, {
    deployer: AztecAddress.fromString(spec.deployer),
    salt: Fr.fromString(spec.salt),
    constructorArgs: [admin],
  });
  return instance.address.toString();
}

async function main() {
  let mismatchCount = 0;
  console.log("[contract-registration-check] using constructorArgs=[admin]");

  for (const spec of specs) {
    const derived = await deriveAddress(spec);
    const expected = spec.expected.toLowerCase();
    const ok = derived.toLowerCase() === expected;
    const mark = ok ? "OK  " : "FAIL";
    console.log(
      `${mark} ${spec.name}\n  expected: ${spec.expected}\n  derived:  ${derived}`
    );
    if (!ok) mismatchCount += 1;
  }

  if (mismatchCount > 0) {
    console.error(
      `\n[contract-registration-check] ${mismatchCount} mismatch(es). ` +
        "This can cause frontend PXE Unknown contract simulation failures."
    );
    process.exit(1);
  }

  console.log("\n[contract-registration-check] all contract addresses match.");
}

main().catch((err) => {
  console.error("[contract-registration-check] fatal:", err);
  process.exit(1);
});
