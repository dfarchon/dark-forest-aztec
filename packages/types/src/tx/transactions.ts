/**
 * Transaction intents and client-side status for Aztec. Used by {@link Transaction} in transaction.ts:
 * - ClientTxStatus: type of Transaction.state
 * - TxIntent / Unconfirmed*: type of Transaction.intent
 */
import type { EthAddress, ArtifactId, LocationId } from "../identifiers";
import type { WorldLocation } from "../world/world";

export type ContractMethodName =
  | "revealLocation"
  | "initializePlayer"
  | "move"
  | "upgradePlanet"
  | "buyHat"
  | "transferPlanet"
  | "findArtifact"
  | "prospectPlanet"
  | "depositArtifact"
  | "withdrawArtifact"
  | "activateArtifact"
  | "deactivateArtifact"
  | "withdrawSilver"
  | "useKey"
  | "adminUseKey"
  | "addKeys"
  | "giveSpaceShips"
  | "createLobby"
  | "invadePlanet"
  | "capturePlanet"
  | "claimReward";

/**
 * Client-side transaction status (UI/executor lifecycle). Aztec counterpart of EthTxStatus.
 * Use these for Transaction.state; when a receipt is available, map Aztec TxStatus as:
 * SUCCESS -> 'Confirm', APP_LOGIC_REVERTED / TEARDOWN_REVERTED / BOTH_REVERTED -> 'Fail',
 * PENDING -> 'Submit', DROPPED -> 'Fail' or 'Cancel'.
 */
export type ClientTxStatus =
  | "Init"
  | "Processing"
  | "Prioritized"
  | "Submit"
  | "Confirm"
  | "Fail"
  | "Cancel";

/**
 * Game-side intent for a transaction (no ethers Contract). Maps to Aztec
 * ContractFunctionInteraction in application code.
 */
export type TxIntent = {
  // contractAddress?: string;
  methodName: ContractMethodName | string;
  args: Promise<unknown[]> | unknown[];
};

export type UnconfirmedInit = TxIntent & {
  methodName: "initializePlayer";
  locationId: LocationId;
  location: WorldLocation;
};

export type UnconfirmedMove = TxIntent & {
  methodName: "move";
  from: LocationId;
  to: LocationId;
  forces: number;
  silver: number;
  abandoning: boolean;
  artifact?: ArtifactId;
};

export type UnconfirmedFindArtifact = TxIntent & {
  methodName: "findArtifact";
  planetId: LocationId;
};

export type UnconfirmedProspectPlanet = TxIntent & {
  methodName: "prospectPlanet";
  planetId: LocationId;
};

export type UnconfirmedPlanetTransfer = TxIntent & {
  methodName: "transferPlanet";
  planetId: LocationId;
  newOwner: EthAddress;
};

export type UnconfirmedClaimReward = TxIntent & {
  methodName: "claimReward";
  sortedPlayerAddresses: EthAddress[];
  sortedScores: number[];
};

export type UnconfirmedUpgrade = TxIntent & {
  methodName: "upgradePlanet";
  locationId: LocationId;
  upgradeBranch: number;
};

export type UnconfirmedBuyHat = TxIntent & {
  methodName: "buyHat";
  locationId: LocationId;
};

export type UnconfirmedDepositArtifact = TxIntent & {
  methodName: "depositArtifact";
  locationId: LocationId;
  artifactId: ArtifactId;
};

export type UnconfirmedWithdrawArtifact = TxIntent & {
  methodName: "withdrawArtifact";
  locationId: LocationId;
  artifactId: ArtifactId;
};

export type UnconfirmedActivateArtifact = TxIntent & {
  methodName: "activateArtifact";
  locationId: LocationId;
  artifactId: ArtifactId;
  wormholeTo?: LocationId;
};

export type UnconfirmedDeactivateArtifact = TxIntent & {
  methodName: "deactivateArtifact";
  locationId: LocationId;
  artifactId: ArtifactId;
};

export type UnconfirmedWithdrawSilver = TxIntent & {
  methodName: "withdrawSilver";
  locationId: LocationId;
  amount: number;
};

export type UnconfirmedReveal = TxIntent & {
  methodName: "revealLocation";
  locationId: LocationId;
  location: WorldLocation;
};

export type UnconfirmedAddKeys = TxIntent & {
  methodName: "addKeys";
};

export type UnconfirmedUseKey = TxIntent & {
  methodName: "useKey";
};

export type UnconfirmedAdminUseKey = TxIntent & {
  methodName: "adminUseKey";
};

export type UnconfirmedGetShips = TxIntent & {
  methodName: "giveSpaceShips";
  locationId: LocationId;
};

export type UnconfirmedCreateLobby = TxIntent & {
  methodName: "createLobby";
};

export type UnconfirmedInvadePlanet = TxIntent & {
  methodName: "invadePlanet";
  locationId: LocationId;
};

export type UnconfirmedCapturePlanet = TxIntent & {
  methodName: "capturePlanet";
  locationId: LocationId;
};
