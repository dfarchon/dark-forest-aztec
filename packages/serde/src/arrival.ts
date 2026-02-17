import { CONTRACT_PRECISION } from "@dfpunk/constants";
import type { QueuedArrival } from "@dfpunk/types";
import { address } from "./address";
import { artifactIdFromHexStr, artifactIdFromDecStr } from "./artifact";
import { locationIdFromHexStr, locationIdFromDecStr } from "./location";
import type { ArrivalState } from "./chain_state";

function toLocationId(s: string) {
  return s.startsWith("0x") ? locationIdFromHexStr(s) : locationIdFromDecStr(s);
}

function isZeroId(s: string): boolean {
  if (s === "0" || s === "0x0") return true;
  try {
    return BigInt(s.startsWith("0x") ? s : "0x" + s) === 0n;
  } catch {
    return false;
  }
}

/**
 * Decodes chain state (key + ArrivalState) into a QueuedArrival (see @dfpunk/types).
 * key is the voyage/event id string.
 */
export function decodeArrival(key: string, state: ArrivalState): QueuedArrival {
  const precision = CONTRACT_PRECISION;
  const artifactId = isZeroId(state.carried_artifact_id)
    ? undefined
    : state.carried_artifact_id.startsWith("0x")
      ? artifactIdFromHexStr(state.carried_artifact_id)
      : artifactIdFromDecStr(state.carried_artifact_id);

  return {
    eventId: key as QueuedArrival["eventId"],
    player: address(state.player),
    fromPlanet: toLocationId(state.from_planet),
    toPlanet: toLocationId(state.to_planet),
    energyArriving: Number(state.pop_arriving) / precision,
    silverMoved: Number(state.silver_moved) / precision,
    departureTime: state.departure_time,
    arrivalTime: state.arrival_time,
    distance: Number(state.distance),
    artifactId,
    arrivalType: state.arrival_type as QueuedArrival["arrivalType"],
  };
}
