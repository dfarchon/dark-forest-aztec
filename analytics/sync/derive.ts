import type Database from "better-sqlite3";

import { pendingDeriveSpan } from "./db.ts";
import {
  asBigInt,
  asNumber,
  asText,
  canonicalAddress,
  isZeroHex,
  type ActionRow,
} from "./model.ts";
import {
  loadEvents,
  loadKnownIds,
  loadLatestState,
  type StoredEvent,
} from "./store.ts";
import { type EventTableName, type SqlValue } from "./tables.ts";

interface EntityState {
  [key: string]: SqlValue;
}

interface Prior {
  arrivals: Set<string>;
  artifacts: Set<string>;
  revealed: Set<string>;
  players: Map<string, EntityState>;
  planets: Map<string, EntityState>;
  artifactStates: Map<string, EntityState>;
  locations: Map<string, EntityState>;
}

function actionTime(game: number, block: number): number {
  return game > 0 ? game : block;
}

function groupKey(event: StoredEvent): string {
  if (event.txHash) return `${event.blockNumber}:hash:${event.txHash}`;
  if (event.txIndex >= 0) return `${event.blockNumber}:tx:${event.txIndex}`;
  return `${event.blockNumber}:block`;
}

function actor(owner: string, controller: string): string {
  const preferred = isZeroHex(owner) ? controller : owner;
  return canonicalAddress(preferred);
}

/**
 * Turn storage logs into one row per player operation.
 * `prior` is the world as of the first event; it is mutated as events are applied.
 */
export function classifyEvents(
  events: StoredEvent[],
  prior: Prior,
): ActionRow[] {
  const actions: ActionRow[] = [];
  const groups = new Map<string, StoredEvent[]>();
  const order: string[] = [];
  for (const event of events) {
    const key = groupKey(event);
    const group = groups.get(key);
    if (group) group.push(event);
    else {
      groups.set(key, [event]);
      order.push(key);
    }
  }

  for (const key of order) {
    const group = groups.get(key) ?? [];
    const separated = !key.endsWith(":block");
    const blockTimestamp = group[0]?.blockTimestamp ?? 0;

    const newArrivals = group.filter(
      (event) =>
        event.table === "arrival_update" && !prior.arrivals.has(event.id),
    );
    const departures = new Set(
      newArrivals.map((event) => asText(event.state.from_planet)),
    );
    const carried = new Set(
      newArrivals
        .map((event) => asText(event.state.carried_artifact_id))
        .filter((id) => !isZeroHex(id)),
    );
    const arrivalIds = new Set(newArrivals.map((event) => event.id));
    const newArtifactIds = new Set(
      group
        .filter(
          (event) =>
            event.table === "artifact_update" && !prior.artifacts.has(event.id),
        )
        .map((event) => event.id),
    );
    const scoreGain = new Set<string>();
    const revealTimes = new Map<string, number>();
    for (const event of group) {
      if (event.table !== "player_update") continue;
      const previous = prior.players.get(event.id);
      const before = previous ? asBigInt(previous.score) : 0n;
      if (asBigInt(event.state.score) > before) {
        scoreGain.add(canonicalAddress(event.id));
      }
      const nextReveal = asNumber(event.state.last_reveal_timestamp);
      const prevReveal = previous
        ? asNumber(previous.last_reveal_timestamp)
        : 0;
      if (nextReveal > prevReveal) {
        revealTimes.set(canonicalAddress(event.id), nextReveal);
      }
    }
    const lastLog = new Map<string, number>();
    for (const event of group) {
      if (
        event.table === "player_update" ||
        event.table === "planet_update" ||
        event.table === "artifact_update" ||
        event.table === "artifact_location_update"
      ) {
        lastLog.set(`${event.table}:${event.id}`, event.logIndex);
      }
    }
    const snapshot: Prior = {
      arrivals: new Set(prior.arrivals),
      artifacts: new Set(prior.artifacts),
      revealed: new Set(prior.revealed),
      players: prior.players,
      planets: prior.planets,
      artifactStates: prior.artifactStates,
      locations: prior.locations,
    };

    for (const event of group) {
      const last = lastLog.get(`${event.table}:${event.id}`);
      if (last !== undefined && event.logIndex !== last) continue;
      actions.push(
        ...classifyOne(event, snapshot, {
          separated,
          blockTimestamp,
          departures,
          carried,
          arrivalIds,
          newArtifactIds,
          scoreGain,
          revealTimes,
        }),
      );
    }

    for (const event of group) applyEvent(prior, event);
  }

  return actions;
}

interface TxContext {
  separated: boolean;
  blockTimestamp: number;
  departures: Set<string>;
  carried: Set<string>;
  arrivalIds: Set<string>;
  newArtifactIds: Set<string>;
  scoreGain: Set<string>;
  revealTimes: Map<string, number>;
}

function base(
  event: StoredEvent,
  player: string,
  action: string,
  timestamp: number,
  subject: string,
  quantity: string | null,
  ambiguous: number,
): ActionRow {
  return {
    blockNumber: event.blockNumber,
    timestamp,
    player,
    action,
    subject,
    quantity,
    txHash: event.txHash,
    sourceTable: event.table,
    sourceTxIndex: event.txIndex,
    sourceLogIndex: event.logIndex,
    ambiguous,
  };
}

function classifyOne(
  event: StoredEvent,
  prior: Prior,
  tx: TxContext,
): ActionRow[] {
  switch (event.table) {
    case "player_update":
      return classifyPlayer(event, prior);
    case "arrival_update":
      return classifyArrival(event, prior, tx);
    case "planet_revealed_coords_update":
      return classifyReveal(event, prior, tx);
    case "artifact_update":
      return classifyArtifact(event, prior, tx);
    case "planet_update":
      return classifyPlanet(event, prior, tx);
    case "artifact_location_update":
      return classifyLocation(event, prior, tx);
    default:
      return [];
  }
}

function classifyPlayer(event: StoredEvent, prior: Prior): ActionRow[] {
  const previous = prior.players.get(event.id);
  const player = canonicalAddress(event.id);
  if (isZeroHex(player)) return [];
  const rows: ActionRow[] = [];
  const init = asNumber(event.state.init_timestamp);
  const prevInit = previous ? asNumber(previous.init_timestamp) : 0;
  if (init > 0 && prevInit === 0) {
    rows.push(
      base(
        event,
        player,
        "initialize_player",
        actionTime(init, event.blockTimestamp),
        asText(event.state.home_planet_id),
        null,
        0,
      ),
    );
  }
  const claimed = asNumber(event.state.claimed_ships) !== 0;
  const prevClaimed = previous ? asNumber(previous.claimed_ships) !== 0 : false;
  if (claimed && !prevClaimed) {
    rows.push(
      base(
        event,
        player,
        "give_spaceships",
        actionTime(asNumber(event.state.last_updated), event.blockTimestamp),
        player,
        null,
        0,
      ),
    );
  }
  return rows;
}

function classifyArrival(
  event: StoredEvent,
  prior: Prior,
  tx: TxContext,
): ActionRow[] {
  if (prior.arrivals.has(event.id)) return [];
  prior.arrivals.add(event.id);
  const player = canonicalAddress(asText(event.state.player));
  if (isZeroHex(player)) return [];
  return [
    base(
      event,
      player,
      "move",
      actionTime(asNumber(event.state.departure_time), tx.blockTimestamp),
      event.id,
      asText(event.state.silver_moved),
      0,
    ),
  ];
}

function classifyReveal(
  event: StoredEvent,
  prior: Prior,
  tx: TxContext,
): ActionRow[] {
  if (prior.revealed.has(event.id)) return [];
  prior.revealed.add(event.id);
  const player = canonicalAddress(asText(event.state.revealer));
  if (isZeroHex(player)) return [];
  const revealTime = tx.revealTimes.get(player) ?? 0;
  return [
    base(
      event,
      player,
      "reveal_location",
      actionTime(revealTime, tx.blockTimestamp),
      event.id,
      null,
      0,
    ),
  ];
}

function classifyArtifact(
  event: StoredEvent,
  prior: Prior,
  tx: TxContext,
): ActionRow[] {
  const previous = prior.artifactStates.get(event.id);
  const rows: ActionRow[] = [];
  if (!prior.artifacts.has(event.id)) {
    const discoverer = canonicalAddress(asText(event.state.discoverer));
    if (!isZeroHex(discoverer) && tx.scoreGain.has(discoverer)) {
      rows.push(
        base(
          event,
          discoverer,
          "find_artifact",
          actionTime(
            asNumber(event.state.minted_at_timestamp),
            tx.blockTimestamp,
          ),
          event.id,
          null,
          0,
        ),
      );
    }
    return rows;
  }
  if (!previous) return rows;
  const player = actor(
    asText(event.state.owner),
    asText(event.state.controller),
  );
  if (isZeroHex(player)) return rows;
  if (asBigInt(event.state.activations) > asBigInt(previous.activations)) {
    rows.push(
      base(
        event,
        player,
        "activate_artifact",
        actionTime(asNumber(event.state.last_activated), tx.blockTimestamp),
        event.id,
        asText(event.state.activations),
        0,
      ),
    );
  }
  if (
    asNumber(event.state.last_deactivated) > asNumber(previous.last_deactivated)
  ) {
    rows.push(
      base(
        event,
        player,
        "deactivate_artifact",
        actionTime(asNumber(event.state.last_deactivated), tx.blockTimestamp),
        event.id,
        null,
        0,
      ),
    );
  }
  return rows;
}

function classifyPlanet(
  event: StoredEvent,
  prior: Prior,
  tx: TxContext,
): ActionRow[] {
  const previous = prior.planets.get(event.id);
  if (!previous) return [];
  const player = canonicalAddress(asText(event.state.owner));
  if (isZeroHex(player)) return [];
  const when = actionTime(
    asNumber(event.state.last_updated),
    tx.blockTimestamp,
  );
  const rows: ActionRow[] = [];
  const upgraded =
    asNumber(event.state.upgrade_state_0) >
      asNumber(previous.upgrade_state_0) ||
    asNumber(event.state.upgrade_state_1) >
      asNumber(previous.upgrade_state_1) ||
    asNumber(event.state.upgrade_state_2) > asNumber(previous.upgrade_state_2);
  if (upgraded) {
    rows.push(base(event, player, "upgrade_planet", when, event.id, null, 0));
  }
  if (
    asNumber(previous.prospected_block_number) === 0 &&
    asNumber(event.state.prospected_block_number) > 0
  ) {
    rows.push(base(event, player, "prospect_planet", when, event.id, null, 0));
  }
  const beforeSilver = asBigInt(previous.silver);
  const afterSilver = asBigInt(event.state.silver);
  if (afterSilver < beforeSilver) {
    const departed = tx.departures.has(event.id);
    if (tx.separated && departed) return rows;
    rows.push(
      base(
        event,
        player,
        "withdraw_silver",
        when,
        event.id,
        (beforeSilver - afterSilver).toString(),
        !tx.separated && departed ? 1 : 0,
      ),
    );
  }
  return rows;
}

function classifyLocation(
  event: StoredEvent,
  prior: Prior,
  tx: TxContext,
): ActionRow[] {
  if (tx.newArtifactIds.has(event.id)) return [];
  const previous = prior.locations.get(event.id);
  if (!previous) return [];
  const voyage = asText(event.state.voyage_id);
  const movedWithFleet =
    tx.carried.has(event.id) ||
    (!isZeroHex(voyage) && tx.arrivalIds.has(voyage));
  if (tx.separated && movedWithFleet) return [];
  const artifact = prior.artifactStates.get(event.id);
  const player = artifact
    ? actor(asText(artifact.owner), asText(artifact.controller))
    : "";
  if (isZeroHex(player)) return [];
  const prevPlanet = asText(previous.planet_id);
  const nextPlanet = asText(event.state.planet_id);
  const when = actionTime(
    asNumber(event.state.last_updated),
    tx.blockTimestamp,
  );
  const ambiguous = !tx.separated && movedWithFleet ? 1 : 0;
  if (isZeroHex(prevPlanet) && !isZeroHex(nextPlanet)) {
    return [
      base(event, player, "deposit_artifact", when, event.id, null, ambiguous),
    ];
  }
  if (!isZeroHex(prevPlanet) && isZeroHex(nextPlanet)) {
    return [
      base(event, player, "withdraw_artifact", when, event.id, null, ambiguous),
    ];
  }
  return [];
}

function applyEvent(prior: Prior, event: StoredEvent): void {
  const state = event.state;
  switch (event.table) {
    case "player_update":
      prior.players.set(event.id, state);
      prior.players.set(canonicalAddress(event.id), state);
      break;
    case "planet_update":
      prior.planets.set(event.id, state);
      break;
    case "arrival_update":
      prior.arrivals.add(event.id);
      break;
    case "artifact_update":
      prior.artifacts.add(event.id);
      prior.artifactStates.set(event.id, state);
      break;
    case "artifact_location_update":
      prior.locations.set(event.id, state);
      break;
    case "planet_revealed_coords_update":
      prior.revealed.add(event.id);
      break;
    default:
      break;
  }
}

function priorFromDb(db: Database.Database, beforeBlock: number): Prior {
  return {
    arrivals: loadKnownIds(db, "arrival_update", beforeBlock),
    artifacts: loadKnownIds(db, "artifact_update", beforeBlock),
    revealed: loadKnownIds(db, "planet_revealed_coords_update", beforeBlock),
    players: new Map(),
    planets: new Map(),
    artifactStates: new Map(),
    locations: new Map(),
  };
}

function hydrate(
  db: Database.Database,
  prior: Prior,
  events: StoredEvent[],
  beforeBlock: number,
): void {
  const want = new Map<EventTableName, Set<string>>();
  for (const event of events) {
    if (
      event.table !== "player_update" &&
      event.table !== "planet_update" &&
      event.table !== "artifact_update" &&
      event.table !== "artifact_location_update"
    ) {
      continue;
    }
    const ids = want.get(event.table) ?? new Set<string>();
    ids.add(event.id);
    want.set(event.table, ids);
  }
  for (const [table, ids] of want) {
    for (const id of ids) {
      const state = loadLatestState(db, table, id, beforeBlock);
      if (!state) continue;
      if (table === "player_update") {
        prior.players.set(id, state);
        prior.players.set(canonicalAddress(id), state);
      } else if (table === "planet_update") prior.planets.set(id, state);
      else if (table === "artifact_update") prior.artifactStates.set(id, state);
      else prior.locations.set(id, state);
    }
  }
}

const INSERT_ACTION = `INSERT INTO actions (
  block_number, timestamp, player, action, subject, quantity, tx_hash,
  source_table, source_tx_index, source_log_index, ambiguous
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function deriveRange(
  db: Database.Database,
  from: number,
  to: number,
): number {
  const present = db
    .prepare(
      `SELECT COUNT(*) AS count FROM blocks WHERE number BETWEEN ? AND ?`,
    )
    .get(from, to) as { count: number };
  if (present.count !== to - from + 1) {
    throw new Error(
      `[analytics] cannot derive ${from}..${to}: block rows are missing`,
    );
  }
  const events = loadEvents(db, from, to);
  const prior = priorFromDb(db, from);
  hydrate(db, prior, events, from);
  const actions = classifyEvents(events, prior);
  const insert = db.prepare(INSERT_ACTION);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM actions WHERE block_number BETWEEN ? AND ?`).run(
      from,
      to,
    );
    for (const action of actions) {
      insert.run(
        action.blockNumber,
        action.timestamp,
        action.player,
        action.action,
        action.subject,
        action.quantity,
        action.txHash,
        action.sourceTable,
        action.sourceTxIndex,
        action.sourceLogIndex,
        action.ambiguous,
      );
    }
    db.prepare(
      `UPDATE blocks SET derived = 1 WHERE number BETWEEN ? AND ?`,
    ).run(from, to);
  });
  tx();
  return actions.length;
}

export function derivePending(db: Database.Database, chunkSize = 100): number {
  const span = pendingDeriveSpan(db);
  if (!span) return 0;
  let total = 0;
  for (let from = span.from; from <= span.to; from += chunkSize) {
    const to = Math.min(from + chunkSize - 1, span.to);
    total += deriveRange(db, from, to);
  }
  return total;
}

export function rebuildActions(db: Database.Database, chunkSize = 100): number {
  const span = db
    .prepare(`SELECT MIN(number) AS lo, MAX(number) AS hi FROM blocks`)
    .get() as { lo: number | null; hi: number | null };
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM actions`).run();
    db.prepare(`UPDATE blocks SET derived = 0`).run();
  });
  tx();
  if (span.lo == null || span.hi == null) return 0;
  return derivePending(db, chunkSize);
}
