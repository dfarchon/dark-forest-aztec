import type { Player } from "@dfpunk/types";
import { address } from "./address";
import { locationIdFromHexStr, locationIdFromDecStr } from "./location";
import type { PlayerState } from "./chain_state";

function toLocationId(s: string) {
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

/**
 * Decodes chain state (key + PlayerState) into a Player (see @dfpunk/types).
 * key is the player address string.
 */
export function decodePlayer(key: string, state: PlayerState): Player {
  return {
    address: address(key),
    initTimestamp: state.init_timestamp,
    homePlanetId: toLocationId(state.home_planet_id),
    lastRevealTimestamp: state.last_reveal_timestamp,
    lastClaimTimestamp: state.last_reveal_timestamp,
    score: Number(state.score),
    spaceJunk: Number(state.space_junk),
    spaceJunkLimit: Number(state.space_junk_limit),
    claimedShips: state.claimed_ships,
  };
}
