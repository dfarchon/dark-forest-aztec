import type { AztecAddress } from "@aztec/aztec.js/addresses";
import type {
  Aliased,
  ContractFunctionPattern,
  GrantedAccountsCapability,
  GrantedCapability,
  GrantedSimulationCapability,
  GrantedTransactionCapability,
  SimulationCapability,
  TransactionCapability,
  Wallet,
  WalletCapabilities,
} from "@aztec/aztec.js/wallet";

import { createDfpunkCapabilities } from "../../config/capabilities";

export type ExternalWalletCapabilityResolution = {
  accounts: Aliased<AztecAddress>[];
  supportsUtilitySimulation: boolean;
  supportsTransactionSimulation: boolean;
  supportsTransactionExecution: boolean;
  walletCapabilities: WalletCapabilities;
};

function isGrantedAccountsCapability(
  capability: GrantedCapability
): capability is GrantedAccountsCapability {
  return (
    capability.type === "accounts" &&
    Array.isArray((capability as Partial<GrantedAccountsCapability>).accounts)
  );
}

function isGrantedSimulationCapability(
  capability: GrantedCapability
): capability is GrantedSimulationCapability {
  return capability.type === "simulation";
}

function isGrantedTransactionCapability(
  capability: GrantedCapability
): capability is GrantedTransactionCapability {
  return capability.type === "transaction";
}

function isSimulationCapability(
  capability: ReturnType<
    typeof createDfpunkCapabilities
  >["capabilities"][number]
): capability is SimulationCapability {
  return capability.type === "simulation";
}

function isTransactionCapability(
  capability: ReturnType<
    typeof createDfpunkCapabilities
  >["capabilities"][number]
): capability is TransactionCapability {
  return capability.type === "transaction";
}

function patternCovers(
  grantedPattern: ContractFunctionPattern,
  requestedPattern: ContractFunctionPattern
): boolean {
  const grantedContract = grantedPattern.contract;
  const requestedContract = requestedPattern.contract;
  const grantedFunction = grantedPattern.function;
  const requestedFunction = requestedPattern.function;

  const contractMatches =
    grantedContract === "*" ||
    (requestedContract !== "*" &&
      grantedContract.toString() === requestedContract.toString());

  if (!contractMatches) return false;

  if (requestedFunction === "*") {
    return grantedFunction === "*";
  }

  return grantedFunction === "*" || grantedFunction === requestedFunction;
}

function getRequestedSimulationScope(
  kind: "utilities" | "transactions"
): "*" | ContractFunctionPattern[] | undefined {
  const simulationCapability = createDfpunkCapabilities().capabilities.find(
    isSimulationCapability
  );

  return simulationCapability?.[kind]?.scope;
}

function getRequestedTransactionScope():
  | "*"
  | ContractFunctionPattern[]
  | undefined {
  const transactionCapability = createDfpunkCapabilities().capabilities.find(
    isTransactionCapability
  );

  return transactionCapability?.scope;
}

function hasScopeCoverage(
  requestedScope: "*" | ContractFunctionPattern[] | undefined,
  grantedScopes: ("*" | ContractFunctionPattern[])[]
): boolean {
  if (requestedScope === undefined) return false;

  if (grantedScopes.some((scope) => scope === "*")) {
    return true;
  }

  if (requestedScope === "*") {
    return false;
  }

  const grantedPatterns = grantedScopes.flatMap((scope) =>
    scope === "*" ? [] : scope
  );

  return requestedScope.every((requestedPattern) =>
    grantedPatterns.some((grantedPattern) =>
      patternCovers(grantedPattern, requestedPattern)
    )
  );
}

function hasSimulationCoverage(
  grantedCapabilities: WalletCapabilities,
  kind: "utilities" | "transactions"
): boolean {
  const requestedScope = getRequestedSimulationScope(kind);
  const grantedScopes = grantedCapabilities.granted
    .filter(isGrantedSimulationCapability)
    .map((capability) => capability[kind]?.scope)
    .filter(
      (scope): scope is "*" | ContractFunctionPattern[] => scope !== undefined
    );

  return hasScopeCoverage(requestedScope, grantedScopes);
}

function hasTransactionExecutionCoverage(
  grantedCapabilities: WalletCapabilities
): boolean {
  const requestedScope = getRequestedTransactionScope();
  const grantedScopes = grantedCapabilities.granted
    .filter(isGrantedTransactionCapability)
    .map((capability) => capability.scope);

  return hasScopeCoverage(requestedScope, grantedScopes);
}

export async function resolveExternalWalletCapabilities(
  wallet: Wallet
): Promise<ExternalWalletCapabilityResolution> {
  const walletCapabilities = await wallet.requestCapabilities(
    createDfpunkCapabilities()
  );

  const accounts =
    walletCapabilities.granted.find(isGrantedAccountsCapability)?.accounts ??
    [];

  return {
    accounts,
    supportsUtilitySimulation: hasSimulationCoverage(
      walletCapabilities,
      "utilities"
    ),
    supportsTransactionSimulation: hasSimulationCoverage(
      walletCapabilities,
      "transactions"
    ),
    supportsTransactionExecution:
      hasTransactionExecutionCoverage(walletCapabilities),
    walletCapabilities,
  };
}
