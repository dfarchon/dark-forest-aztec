import type { PlayerUpdate } from "@dfpunk/contracts/artifacts/PlayerStorage";
import type { Player } from "@dfpunk/types";
import { address } from "./address";
import { locationIdFromHexStr } from "./location";

/**
 * Converts a {@link PlayerUpdate} from the contract into a {@link Player}
 * object that can be used by the client.
 */
export function decodePlayer(playerUpdate: PlayerUpdate): Player {
  const { id, state } = playerUpdate;
  return {
    address: address(String(id)),
    initTimestamp: Number(state.init_timestamp),
    homePlanetId: locationIdFromHexStr(String(state.home_planet_id)),
    lastRevealTimestamp: Number(state.last_reveal_timestamp),
    lastClaimTimestamp: Number(state.last_reveal_timestamp),
    score: Number(state.score),
    spaceJunk: Number(state.space_junk),
    spaceJunkLimit: Number(state.space_junk_limit),
    claimedShips: state.claimed_ships,
  };
}
