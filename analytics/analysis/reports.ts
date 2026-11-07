import type Database from "better-sqlite3";

import { canonicalAddress } from "../sync/model.ts";

export interface ActionCount {
  action: string;
  count: number;
}

export interface HourBucket {
  hour: number;
  count: number;
}

export interface PlayerReport {
  player: string;
  joinedAt: number | null;
  counts: ActionCount[];
  hourly: HourBucket[];
  timeline: Array<{
    timestamp: number;
    action: string;
    blockNumber: number;
    subject: string;
    quantity: string | null;
  }>;
  ambiguous: number;
}

export interface PlayerActivity {
  player: string;
  operations: number;
  kinds: number;
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface OverviewReport {
  players: number;
  newPerDay: Array<{ day: number; count: number }>;
  activePerDay: Array<{ day: number; players: number; operations: number }>;
  byAction: ActionCount[];
  perPlayer: PlayerActivity[];
  blockFrom: number;
  blockTo: number;
  rangeCounts: ActionCount[];
  withdrawSilver: string;
}

const CLEAR = `ambiguous = 0`;

export function playerReport(
  db: Database.Database,
  address: string,
): PlayerReport {
  const player = canonicalAddress(address);
  const joined = db
    .prepare(
      `SELECT MIN(timestamp) AS ts FROM actions
       WHERE player = ? AND action = 'initialize_player' AND ${CLEAR}`,
    )
    .get(player) as { ts: number | null };
  const counts = db
    .prepare(
      `SELECT action, COUNT(*) AS count FROM actions
       WHERE player = ? AND ${CLEAR}
       GROUP BY action
       ORDER BY action`,
    )
    .all(player) as ActionCount[];
  const hourly = db
    .prepare(
      `SELECT (timestamp / 3600) * 3600 AS hour, COUNT(*) AS count
       FROM actions
       WHERE player = ? AND ${CLEAR}
       GROUP BY hour
       ORDER BY hour`,
    )
    .all(player) as HourBucket[];
  const timeline = db
    .prepare(
      `SELECT timestamp, action, block_number AS blockNumber, subject, quantity
       FROM actions
       WHERE player = ? AND ${CLEAR}
       ORDER BY timestamp, block_number, source_tx_index, source_log_index`,
    )
    .all(player) as PlayerReport["timeline"];
  const ambiguous = db
    .prepare(
      `SELECT COUNT(*) AS count FROM actions WHERE player = ? AND ambiguous = 1`,
    )
    .get(player) as { count: number };
  return {
    player,
    joinedAt: joined.ts,
    counts,
    hourly,
    timeline,
    ambiguous: ambiguous.count,
  };
}

export function overviewReport(
  db: Database.Database,
  blockFrom: number,
  blockTo: number,
): OverviewReport {
  const players = db
    .prepare(
      `SELECT COUNT(DISTINCT player) AS count FROM actions WHERE ${CLEAR}`,
    )
    .get() as { count: number };
  const newPerDay = db
    .prepare(
      `SELECT (timestamp / 86400) * 86400 AS day, COUNT(*) AS count
       FROM actions
       WHERE action = 'initialize_player' AND ${CLEAR}
       GROUP BY day
       ORDER BY day`,
    )
    .all() as Array<{ day: number; count: number }>;
  const activePerDay = db
    .prepare(
      `SELECT (timestamp / 86400) * 86400 AS day,
              COUNT(DISTINCT player) AS players,
              COUNT(*) AS operations
       FROM actions
       WHERE ${CLEAR}
       GROUP BY day
       ORDER BY day`,
    )
    .all() as OverviewReport["activePerDay"];
  const byAction = db
    .prepare(
      `SELECT action, COUNT(*) AS count FROM actions
       WHERE ${CLEAR}
       GROUP BY action
       ORDER BY action`,
    )
    .all() as ActionCount[];
  const perPlayer = db
    .prepare(
      `SELECT player,
              COUNT(*) AS operations,
              COUNT(DISTINCT action) AS kinds,
              MIN(timestamp) AS firstTimestamp,
              MAX(timestamp) AS lastTimestamp
       FROM actions
       WHERE ${CLEAR}
       GROUP BY player
       ORDER BY operations DESC, player`,
    )
    .all() as PlayerActivity[];
  const rangeCounts = db
    .prepare(
      `SELECT action, COUNT(*) AS count FROM actions
       WHERE ${CLEAR}
         AND action IN ('move', 'withdraw_silver')
         AND block_number BETWEEN ? AND ?
       GROUP BY action
       ORDER BY action`,
    )
    .all(blockFrom, blockTo) as ActionCount[];
  const quantities = db
    .prepare(
      `SELECT quantity FROM actions
       WHERE ${CLEAR}
         AND action = 'withdraw_silver'
         AND block_number BETWEEN ? AND ?
         AND quantity IS NOT NULL`,
    )
    .all(blockFrom, blockTo) as Array<{ quantity: string }>;
  let withdrawSilver = 0n;
  for (const row of quantities) withdrawSilver += BigInt(row.quantity);
  return {
    players: players.count,
    newPerDay,
    activePerDay,
    byAction,
    perPlayer,
    blockFrom,
    blockTo,
    rangeCounts,
    withdrawSilver: withdrawSilver.toString(),
  };
}

function iso(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

export function formatPlayer(report: PlayerReport): string {
  const lines = [
    `player ${report.player}`,
    `joined: ${report.joinedAt == null ? "unknown" : `${report.joinedAt} ${iso(report.joinedAt)}`}`,
    "counts:",
  ];
  if (report.counts.length === 0) lines.push("  (none)");
  for (const row of report.counts) lines.push(`  ${row.action} ${row.count}`);
  lines.push("hourly:");
  if (report.hourly.length === 0) lines.push("  (none)");
  for (const row of report.hourly) {
    lines.push(`  ${row.hour} ${iso(row.hour)} ${row.count}`);
  }
  lines.push("timeline:");
  if (report.timeline.length === 0) lines.push("  (none)");
  for (const row of report.timeline) {
    const quantity = row.quantity == null ? "" : ` quantity=${row.quantity}`;
    lines.push(
      `  ${row.timestamp} ${iso(row.timestamp)} block=${row.blockNumber} ${row.action} subject=${row.subject}${quantity}`,
    );
  }
  if (report.ambiguous > 0) {
    lines.push(`ambiguous rows excluded: ${report.ambiguous}`);
  }
  return lines.join("\n");
}

export function formatOverview(report: OverviewReport): string {
  const lines = [`players: ${report.players}`, "new per day:"];
  if (report.newPerDay.length === 0) lines.push("  (none)");
  for (const row of report.newPerDay) {
    lines.push(`  ${row.day} ${iso(row.day)} ${row.count}`);
  }
  lines.push("active per day:");
  if (report.activePerDay.length === 0) lines.push("  (none)");
  for (const row of report.activePerDay) {
    lines.push(
      `  ${row.day} ${iso(row.day)} players=${row.players} operations=${row.operations}`,
    );
  }
  lines.push("by action:");
  if (report.byAction.length === 0) lines.push("  (none)");
  for (const row of report.byAction) lines.push(`  ${row.action} ${row.count}`);
  lines.push("per player:");
  if (report.perPlayer.length === 0) lines.push("  (none)");
  for (const row of report.perPlayer) {
    lines.push(
      `  ${row.player} operations=${row.operations} kinds=${row.kinds} first=${row.firstTimestamp} last=${row.lastTimestamp}`,
    );
  }
  lines.push(`blocks ${report.blockFrom}..${report.blockTo}:`);
  if (report.rangeCounts.length === 0)
    lines.push("  (no move or withdraw_silver)");
  for (const row of report.rangeCounts)
    lines.push(`  ${row.action} ${row.count}`);
  lines.push(`withdraw_silver quantity: ${report.withdrawSilver}`);
  return lines.join("\n");
}
