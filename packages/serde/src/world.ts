/**
 * World decode: packages/types has no World type; decode input shape is WorldState.
 * Callers can use chain_state.WorldState for typing; no decodeWorld export.
 */

export type { WorldState } from "./chain_state";
