/**
 * ContractResolver: maps TxIntent.methodName to the correct Aztec contract
 * instance and contract method name.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractBase } from "@aztec/aztec.js/contracts";
import type { Wallet } from "@aztec/aztec.js/wallet";
import {
  ADMIN_CONTRACT_ADDRESS,
  ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS,
  ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS,
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  MOVE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";
import { AdminContract } from "@dfpunk/contracts/artifacts/Admin";
import { ArtifactActionContract } from "@dfpunk/contracts/artifacts/ArtifactAction";
import { ArtifactFindContract } from "@dfpunk/contracts/artifacts/ArtifactFind";
import { ArtifactProspectContract } from "@dfpunk/contracts/artifacts/ArtifactProspect";
import { ArtifactValutContract } from "@dfpunk/contracts/artifacts/ArtifactValut";
import { ConfigContract } from "@dfpunk/contracts/artifacts/Config";
import { CoreContract } from "@dfpunk/contracts/artifacts/Core";
import { MoveContract } from "@dfpunk/contracts/artifacts/Move";

export interface ResolvedContract {
  contract: ContractBase;
  method: string;
}

export class ContractResolver {
  private core: ContractBase;
  private move: ContractBase;
  private admin: ContractBase;
  private config: ContractBase;
  private artifactAction: ContractBase;
  private artifactFind: ContractBase;
  private artifactProspect: ContractBase;
  private artifactVault: ContractBase;

  constructor(wallet: Wallet) {
    this.core = CoreContract.at(
      AztecAddress.fromString(CORE_CONTRACT_ADDRESS),
      wallet
    );
    this.move = MoveContract.at(
      AztecAddress.fromString(MOVE_CONTRACT_ADDRESS),
      wallet
    );
    this.admin = AdminContract.at(
      AztecAddress.fromString(ADMIN_CONTRACT_ADDRESS),
      wallet
    );
    this.config = ConfigContract.at(
      AztecAddress.fromString(CONFIG_CONTRACT_ADDRESS),
      wallet
    );
    this.artifactAction = ArtifactActionContract.at(
      AztecAddress.fromString(ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS),
      wallet
    );
    this.artifactFind = ArtifactFindContract.at(
      AztecAddress.fromString(ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS),
      wallet
    );
    this.artifactProspect = ArtifactProspectContract.at(
      AztecAddress.fromString(ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS),
      wallet
    );
    this.artifactVault = ArtifactValutContract.at(
      AztecAddress.fromString(ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS),
      wallet
    );
  }

  resolve(methodName: string): ResolvedContract {
    switch (methodName) {
      case "initializePlayer":
        return { contract: this.core, method: "initialize_player" };
      case "revealLocation":
        return { contract: this.core, method: "reveal_location" };
      case "move":
        return { contract: this.move, method: "move" };
      case "upgradePlanet":
        return { contract: this.core, method: "upgrade_planet" };
      case "withdrawSilver":
        return { contract: this.core, method: "withdraw_silver" };
      case "setWorldConfig":
        return { contract: this.config, method: "set_world_config" };
      case "pauseGame":
        return { contract: this.admin, method: "pause" };
      case "unpauseGame":
        return { contract: this.admin, method: "unpause" };
      case "adminSetWorldRadius":
        return { contract: this.admin, method: "admin_set_world_radius" };
      case "createPlanet":
        return { contract: this.admin, method: "create_planet" };
      case "safeSetOwner":
        return { contract: this.admin, method: "safe_set_owner" };
      case "prospectPlanet":
        return { contract: this.artifactProspect, method: "prospect_planet" };
      case "findArtifact":
        return { contract: this.artifactFind, method: "find_artifact" };
      case "activateArtifact":
        return { contract: this.artifactAction, method: "activate_artifact" };
      case "deactivateArtifact":
        return {
          contract: this.artifactAction,
          method: "deactivate_artifact",
        };
      case "depositArtifact":
        return { contract: this.artifactVault, method: "deposit_artifact" };
      case "withdrawArtifact":
        return { contract: this.artifactVault, method: "withdraw_artifact" };
      case "giveSpaceShips":
        return { contract: this.artifactVault, method: "give_spaceships" };
      case "adminGiveArtifact":
        return { contract: this.artifactVault, method: "admin_give_artifact" };
      case "adminGiveSpaceship":
        return {
          contract: this.artifactVault,
          method: "admin_give_spaceship",
        };
      default:
        throw new Error(`ContractResolver: unsupported method "${methodName}"`);
    }
  }
}
