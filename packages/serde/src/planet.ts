import { CONTRACT_PRECISION, EMPTY_ADDRESS } from "@dfpunk/constants";
import { bonusFromHex } from "@dfpunk/hexgen";
import type {
  EthAddress,
  Planet,
  PlanetLevel,
  PlanetType,
  SpaceType,
  UpgradeState,
} from "@dfpunk/types";
import { address } from "./address";
import { locationIdFromHexStr, locationIdFromDecStr } from "./location";
import type { PlanetState } from "./chain_state";

function toLocationId(s: string) {
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

function optAddr(s: string): EthAddress | undefined {
  const normalized = s.toLowerCase().startsWith("0x")
    ? s.toLowerCase()
    : "0x" + s.toLowerCase();
  const empty = EMPTY_ADDRESS.toLowerCase();
  if (normalized === empty || s === "0" || s === "") return undefined;
  return address(s);
}

/**
 * Decodes chain state (key + PlanetState) into a Planet (see @dfpunk/types).
 * key is the location id string.
 */
export function decodePlanet(key: string, state: PlanetState): Planet {
  const locationId = toLocationId(key);
  const precision = CONTRACT_PRECISION;

  const invader = optAddr(state.invader);
  const capturer = optAddr(state.capturer);

  return {
    locationId,
    perlin: state.perlin,
    spaceType: state.space_type as SpaceType,
    owner: address(state.owner),
    hatLevel: Number(state.hat_level),
    planetLevel: state.planet_level as PlanetLevel,
    planetType: state.planet_type as PlanetType,
    isHomePlanet: state.is_home_planet,
    energyCap: Number(state.population_cap) / precision,
    energyGrowth: Number(state.population_growth) / precision,
    silverCap: Number(state.silver_cap) / precision,
    silverGrowth: Number(state.silver_growth) / precision,
    range: Number(state.range),
    defense: Number(state.defense),
    speed: Number(state.speed),
    energy: Number(state.population) / precision,
    silver: Number(state.silver) / precision,
    spaceJunk: Number(state.space_junk),
    lastUpdated: Number(state.last_updated),
    upgradeState: [
      Number(state.upgrade_state_0),
      Number(state.upgrade_state_1),
      Number(state.upgrade_state_2),
    ] as UpgradeState,
    hasTriedFindingArtifact: state.has_tried_finding_artifact,
    heldArtifactIds: [],
    destroyed: state.destroyed,
    prospectedBlockNumber:
      state.prospected_block_number === 0
        ? undefined
        : Number(state.prospected_block_number),
    unconfirmedAddEmoji: false,
    unconfirmedClearEmoji: false,
    loadingServerState: false,
    needsServerRefresh: true,
    silverSpent: 0,
    isInContract: true,
    syncedWithContract: true,
    coordsRevealed: false,
    bonus: bonusFromHex(locationId),
    pausers: Number(state.pausers),
    energyGroDoublers: Number(state.energy_gro_doublers),
    silverGroDoublers: Number(state.silver_gro_doublers),
    invader,
    capturer,
    invadeStartBlock:
      state.invade_start_block === 0 ? undefined : state.invade_start_block,
  };
}
