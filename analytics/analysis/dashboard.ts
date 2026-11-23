/**
 * Read a synced database and write the activity JSON. The page never opens
 * the database; it only fetches the file this module writes.
 */
import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

import { buildPlanetInitReport } from "./planetInits.ts";
import {
  aggregateDashboard,
  type ActionInput,
  type ArrivalInput,
  type ArtifactInput,
  type DashboardReport,
} from "./report.ts";

export function dashboardJsonPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "dashboard.json");
}

function loadActions(db: Database.Database): ActionInput[] {
  return db
    .prepare(
      `SELECT timestamp, player, action, quantity
       FROM actions
       WHERE ambiguous = 0
       ORDER BY timestamp, block_number, source_tx_index, source_log_index`,
    )
    .all() as ActionInput[];
}

function loadArrivals(db: Database.Database): ArrivalInput[] {
  const rows = db
    .prepare(
      `WITH ranked AS (
         SELECT arrival_type, silver_moved, departure_time, block_number,
                ROW_NUMBER() OVER (
                  PARTITION BY id
                  ORDER BY block_number, tx_index, log_index
                ) AS n
         FROM arrival_update
       )
       SELECT ranked.arrival_type AS arrivalType,
              ranked.silver_moved AS silver,
              CASE
                WHEN ranked.departure_time > 0 THEN ranked.departure_time
                ELSE blocks.timestamp
              END AS timestamp
       FROM ranked
       JOIN blocks ON blocks.number = ranked.block_number
       WHERE ranked.n = 1`,
    )
    .all() as Array<{
    arrivalType: number;
    silver: string | null;
    timestamp: number;
  }>;
  return rows.map((row) => ({
    timestamp: row.timestamp,
    arrivalType: row.arrivalType,
    silver: row.silver ?? "0",
  }));
}

function loadArtifacts(db: Database.Database): ArtifactInput[] {
  return db
    .prepare(
      `WITH ranked AS (
         SELECT artifact_type, rarity,
                ROW_NUMBER() OVER (
                  PARTITION BY id
                  ORDER BY block_number, tx_index, log_index
                ) AS n
         FROM artifact_update
       )
       SELECT artifact_type AS artifactType, rarity
       FROM ranked
       WHERE n = 1`,
    )
    .all() as ArtifactInput[];
}

export function buildDashboardReport(
  db: Database.Database,
  bucketSeconds: number,
  generatedAt = Math.floor(Date.now() / 1000),
): DashboardReport {
  const planets = buildPlanetInitReport(db, bucketSeconds);
  return aggregateDashboard({
    actions: loadActions(db),
    arrivals: loadArrivals(db),
    artifacts: loadArtifacts(db),
    planetCount: planets.planetCount,
    planetInits: planets.points,
    bucketSeconds,
    generatedAt,
  });
}

export function writeDashboardReport(
  outPath: string,
  report: DashboardReport,
): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}
