import type {
  ArrivalState,
  ArtifactLocationState,
  ArtifactState,
  PlanetArtifactsState,
  PlanetEventsState,
  PlanetRevealedCoordsState,
  PlanetState,
  PlayerState,
  WorldState,
} from "@dfpunk/indexer-core";

import { asNumber } from "./model.ts";
import { stateColumns, type EventTableName, type SqlValue } from "./tables.ts";

function u64(value: bigint): number {
  return asNumber(value);
}

function u128(value: bigint): string {
  return value.toString();
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

export function flattenState(
  table: EventTableName,
  state:
    | WorldState
    | PlayerState
    | PlanetState
    | PlanetRevealedCoordsState
    | PlanetEventsState
    | PlanetArtifactsState
    | ArrivalState
    | ArtifactState
    | ArtifactLocationState,
): Record<string, SqlValue> {
  switch (table) {
    case "world_update": {
      const row = state as WorldState;
      return {
        paused: bool(row.paused),
        radius: u128(row.radius),
        misc_nonce: u128(row.misc_nonce),
        next_change_block: row.next_change_block,
      };
    }
    case "player_update": {
      const row = state as PlayerState;
      return {
        init_timestamp: u64(row.init_timestamp),
        home_planet_id: row.home_planet_id,
        last_reveal_timestamp: u64(row.last_reveal_timestamp),
        score: u128(row.score),
        space_junk: u128(row.space_junk),
        space_junk_limit: u128(row.space_junk_limit),
        claimed_ships: bool(row.claimed_ships),
        last_updated: u64(row.last_updated),
      };
    }
    case "planet_update": {
      const row = state as PlanetState;
      return {
        perlin: row.perlin,
        created_at: u64(row.created_at),
        owner: row.owner,
        planet_level: row.planet_level,
        planet_type: row.planet_type,
        space_type: row.space_type,
        is_home_planet: bool(row.is_home_planet),
        is_initialized: bool(row.is_initialized),
        destroyed: bool(row.destroyed),
        invader: row.invader,
        capturer: row.capturer,
        invade_start_block: row.invade_start_block,
        population_cap: u128(row.population_cap),
        population_growth: u128(row.population_growth),
        range: u128(row.range),
        speed: u128(row.speed),
        defense: u128(row.defense),
        silver_cap: u128(row.silver_cap),
        silver_growth: u128(row.silver_growth),
        population: u128(row.population),
        silver: u128(row.silver),
        upgrade_state_0: row.upgrade_state_0,
        upgrade_state_1: row.upgrade_state_1,
        upgrade_state_2: row.upgrade_state_2,
        last_updated: u64(row.last_updated),
        pausers: u128(row.pausers),
        energy_gro_doublers: u128(row.energy_gro_doublers),
        silver_gro_doublers: u128(row.silver_gro_doublers),
        hat_level: u128(row.hat_level),
        space_junk: u128(row.space_junk),
        has_tried_finding_artifact: bool(row.has_tried_finding_artifact),
        prospected_block_number: row.prospected_block_number,
      };
    }
    case "planet_revealed_coords_update": {
      const row = state as PlanetRevealedCoordsState;
      return {
        location_id: row.location_id,
        x: row.x,
        y: row.y,
        revealer: row.revealer,
      };
    }
    case "planet_events_update": {
      const row = state as PlanetEventsState;
      return {
        events: JSON.stringify(row.events),
        count: row.count,
        last_updated: u64(row.last_updated),
      };
    }
    case "planet_artifacts_update": {
      const row = state as PlanetArtifactsState;
      return {
        ids: JSON.stringify(row.ids),
        count: row.count,
        last_updated: u64(row.last_updated),
      };
    }
    case "arrival_update": {
      const row = state as ArrivalState;
      return {
        player: row.player,
        from_planet: row.from_planet,
        to_planet: row.to_planet,
        pop_arriving: u128(row.pop_arriving),
        silver_moved: u128(row.silver_moved),
        departure_time: u64(row.departure_time),
        arrival_time: u64(row.arrival_time),
        arrival_type: row.arrival_type,
        carried_artifact_id: row.carried_artifact_id,
        distance: u128(row.distance),
      };
    }
    case "artifact_update": {
      const row = state as ArtifactState;
      return {
        planet_discovered_on: row.planet_discovered_on,
        rarity: row.rarity,
        planet_biome: row.planet_biome,
        minted_at_timestamp: u64(row.minted_at_timestamp),
        discoverer: row.discoverer,
        artifact_type: row.artifact_type,
        activations: u128(row.activations),
        last_activated: u64(row.last_activated),
        last_deactivated: u64(row.last_deactivated),
        wormhole_to: row.wormhole_to,
        owner: row.owner,
        controller: row.controller,
        last_updated: u64(row.last_updated),
      };
    }
    case "artifact_location_update": {
      const row = state as ArtifactLocationState;
      return {
        planet_id: row.planet_id,
        voyage_id: row.voyage_id,
        last_updated: u64(row.last_updated),
      };
    }
  }
}

export function stateValues(
  table: EventTableName,
  state: Record<string, SqlValue>,
): SqlValue[] {
  return stateColumns(table).map((column) => {
    if (!(column.name in state)) {
      throw new Error(`[analytics] ${table} missing column ${column.name}`);
    }
    return state[column.name] ?? column.zero;
  });
}
