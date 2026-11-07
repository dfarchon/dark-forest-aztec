/**
 * One SQLite table per storage event. Column order is the insert order.
 * u64 and smaller integers are INTEGER; u128 values are decimal TEXT.
 */

export const EVENT_TABLES = [
  "world_update",
  "player_update",
  "planet_update",
  "planet_revealed_coords_update",
  "planet_events_update",
  "planet_artifacts_update",
  "arrival_update",
  "artifact_update",
  "artifact_location_update",
] as const;

export type EventTableName = (typeof EVENT_TABLES)[number];

export type SqlValue = string | number | null;

export interface ColumnSpec {
  name: string;
  sql: "INTEGER" | "TEXT";
  zero: SqlValue;
}

const META: ColumnSpec[] = [
  { name: "block_number", sql: "INTEGER", zero: 0 },
  { name: "tx_index", sql: "INTEGER", zero: 0 },
  { name: "log_index", sql: "INTEGER", zero: 0 },
  { name: "tx_hash", sql: "TEXT", zero: null },
  { name: "id", sql: "TEXT", zero: "0" },
];

function col(
  name: string,
  sql: "INTEGER" | "TEXT",
  zero: SqlValue,
): ColumnSpec {
  return { name, sql, zero };
}

function ints(names: string[]): ColumnSpec[] {
  return names.map((name) => col(name, "INTEGER", 0));
}

function texts(names: string[]): ColumnSpec[] {
  return names.map((name) => col(name, "TEXT", "0"));
}

const STATE: Record<EventTableName, ColumnSpec[]> = {
  world_update: [
    col("paused", "INTEGER", 0),
    ...texts(["radius", "misc_nonce"]),
    col("next_change_block", "INTEGER", 0),
  ],
  player_update: [
    col("init_timestamp", "INTEGER", 0),
    col("home_planet_id", "TEXT", "0"),
    col("last_reveal_timestamp", "INTEGER", 0),
    ...texts(["score", "space_junk", "space_junk_limit"]),
    col("claimed_ships", "INTEGER", 0),
    col("last_updated", "INTEGER", 0),
  ],
  planet_update: [
    col("perlin", "INTEGER", 0),
    col("created_at", "INTEGER", 0),
    col("owner", "TEXT", "0"),
    ...ints([
      "planet_level",
      "planet_type",
      "space_type",
      "is_home_planet",
      "is_initialized",
      "destroyed",
    ]),
    ...texts(["invader", "capturer"]),
    col("invade_start_block", "INTEGER", 0),
    ...texts([
      "population_cap",
      "population_growth",
      "range",
      "speed",
      "defense",
      "silver_cap",
      "silver_growth",
      "population",
      "silver",
    ]),
    ...ints(["upgrade_state_0", "upgrade_state_1", "upgrade_state_2"]),
    col("last_updated", "INTEGER", 0),
    ...texts([
      "pausers",
      "energy_gro_doublers",
      "silver_gro_doublers",
      "hat_level",
      "space_junk",
    ]),
    col("has_tried_finding_artifact", "INTEGER", 0),
    col("prospected_block_number", "INTEGER", 0),
  ],
  planet_revealed_coords_update: texts(["location_id", "x", "y", "revealer"]),
  planet_events_update: [
    col("events", "TEXT", "[]"),
    col("count", "INTEGER", 0),
    col("last_updated", "INTEGER", 0),
  ],
  planet_artifacts_update: [
    col("ids", "TEXT", "[]"),
    col("count", "INTEGER", 0),
    col("last_updated", "INTEGER", 0),
  ],
  arrival_update: [
    col("player", "TEXT", "0"),
    ...texts(["from_planet", "to_planet", "pop_arriving", "silver_moved"]),
    ...ints(["departure_time", "arrival_time", "arrival_type"]),
    ...texts(["carried_artifact_id", "distance"]),
  ],
  artifact_update: [
    col("planet_discovered_on", "TEXT", "0"),
    ...ints(["rarity", "planet_biome"]),
    col("minted_at_timestamp", "INTEGER", 0),
    col("discoverer", "TEXT", "0"),
    col("artifact_type", "INTEGER", 0),
    col("activations", "TEXT", "0"),
    ...ints(["last_activated", "last_deactivated"]),
    col("wormhole_to", "TEXT", "0"),
    ...texts(["owner", "controller"]),
    col("last_updated", "INTEGER", 0),
  ],
  artifact_location_update: [
    ...texts(["planet_id", "voyage_id"]),
    col("last_updated", "INTEGER", 0),
  ],
};

const META_NAMES = new Set(META.map((column) => column.name));

export function isEventTable(name: string): name is EventTableName {
  return (EVENT_TABLES as readonly string[]).includes(name);
}

export function columnsFor(table: EventTableName): ColumnSpec[] {
  return [...META, ...STATE[table]];
}

export function stateColumns(table: EventTableName): ColumnSpec[] {
  return STATE[table];
}

export function zeroState(table: EventTableName): Record<string, SqlValue> {
  const state: Record<string, SqlValue> = {};
  for (const column of STATE[table]) state[column.name] = column.zero;
  return state;
}

export function createEventTableSql(table: EventTableName): string {
  const body = columnsFor(table)
    .map((column) => `${column.name} ${column.sql}`)
    .join(",\n  ");
  return `CREATE TABLE IF NOT EXISTS ${table} (
  ${body},
  PRIMARY KEY (block_number, tx_index, log_index)
)`;
}

export function createEventIndexSql(table: EventTableName): string {
  return `CREATE INDEX IF NOT EXISTS idx_${table}_id_block
  ON ${table} (id, block_number, tx_index, log_index)`;
}

export const CREATE_BLOCKS_SQL = `CREATE TABLE IF NOT EXISTS blocks (
  number INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  derived INTEGER NOT NULL DEFAULT 0
)`;

/**
 * One player operation. source_tx_index is part of the pointer because
 * log_index repeats across transactions in the same block.
 */
export const CREATE_ACTIONS_SQL = `CREATE TABLE IF NOT EXISTS actions (
  block_number INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  player TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  quantity TEXT,
  tx_hash TEXT,
  source_table TEXT NOT NULL,
  source_tx_index INTEGER NOT NULL,
  source_log_index INTEGER NOT NULL,
  ambiguous INTEGER NOT NULL,
  PRIMARY KEY (
    block_number,
    source_table,
    source_tx_index,
    source_log_index,
    action
  )
)`;

export const ACTION_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_actions_action_block ON actions (action, block_number)`,
  `CREATE INDEX IF NOT EXISTS idx_actions_player_time ON actions (player, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_actions_time_player ON actions (timestamp, player)`,
];

export function isMetaColumn(name: string): boolean {
  return META_NAMES.has(name);
}
