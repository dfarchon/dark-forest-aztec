import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../sync/db.ts";
import type { ChainLog } from "../sync/model.ts";
import { writeChunk } from "../sync/store.ts";
import { zeroState } from "../sync/tables.ts";
import { buildDashboardReport, writeDashboardReport } from "./dashboard.ts";
import { isDashboardReport } from "./report.ts";

function arrivalLog(
  id: string,
  blockNumber: number,
  logIndex: number,
  state: Record<string, string | number | null>,
): ChainLog {
  return {
    table: "arrival_update",
    blockNumber,
    blockHash: `h${blockNumber}`,
    blockTimestamp: 5000,
    txHash: "0x1",
    txIndex: 0,
    logIndex,
    id,
    state: { ...zeroState("arrival_update"), ...state },
  };
}

test("buildDashboardReport counts each arrival once and skips ambiguous actions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-dashboard-"));
  const db = openDatabase(path.join(dir, "events.db"));
  writeChunk(
    db,
    [{ number: 1, hash: "h1", timestamp: 5000 }],
    [
      arrivalLog("voyage", 1, 0, {
        arrival_type: 1,
        silver_moved: "10",
        departure_time: 1000,
      }),
      arrivalLog("voyage", 1, 1, {
        arrival_type: 3,
        silver_moved: "99",
        departure_time: 1000,
      }),
    ],
  );
  const insert = db.prepare(
    `INSERT INTO actions (
       block_number, timestamp, player, action, subject, quantity, tx_hash,
       source_table, source_tx_index, source_log_index, ambiguous
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run(
    1,
    1000,
    "0xabc",
    "withdraw_silver",
    "planet",
    "5",
    "0x1",
    "planet_update",
    0,
    0,
    0,
  );
  insert.run(
    1,
    1000,
    "0xabc",
    "withdraw_silver",
    "planet",
    "100",
    "0x1",
    "planet_update",
    0,
    1,
    1,
  );

  const report = buildDashboardReport(db, 3600, 50);
  assert.equal(report.summary.voyages, 1);
  assert.equal(report.voyages.normal, 1);
  assert.equal(report.voyages.wormhole, 0);
  assert.equal(report.summary.silverMoved, "10");
  assert.equal(report.summary.silverWithdrawn, "5");
  assert.equal(report.summary.operations, 1);

  const outPath = path.join(dir, "nested", "dashboard.json");
  writeDashboardReport(outPath, report);
  const stored: unknown = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(isDashboardReport(stored), true);
  db.close();
});
