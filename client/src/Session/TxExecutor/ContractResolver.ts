/**
 * ContractResolver: maps TxIntent.methodName to the correct Aztec contract
 * instance and contract method name.
 */

import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { ContractBase } from "@aztec/aztec.js/contracts";
import type { Wallet } from "@aztec/aztec.js/wallet";
import {
  ADMIN_CONTRACT_ADDRESS,
  CONFIG_CONTRACT_ADDRESS,
  CORE_CONTRACT_ADDRESS,
  MOVE_CONTRACT_ADDRESS,
} from "@dfpunk/contracts";
import { AdminContract } from "@dfpunk/contracts/artifacts/Admin";
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
      case "transferPlanet":
        return { contract: this.admin, method: "set_owner" };
      case "createPlanet":
        return { contract: this.admin, method: "create_planet" };
      default:
        throw new Error(`ContractResolver: unsupported method "${methodName}"`);
    }
  }
}
