import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openDatabase } from "../sync/db.ts";
import type { ChainLog } from "../sync/model.ts";
import {
  aggregatePlanetInits,
  buildPlanetInitReport,
  renderPlanetInitHtml,
  writePlanetInitFiles,
} from "./planetInits.ts";
import { writeChunk } from "../sync/store.ts";
import { zeroState } from "../sync/tables.ts";

function planetLog(
  id: string,
  blockNumber: number,
  logIndex: number,
  state: Record<string, string | number | null>,
): ChainLog {
  return {
    table: "planet_update",
    blockNumber,
    blockHash: `h${blockNumber}`,
    blockTimestamp: blockNumber * 1000,
    txHash: "0x1",
    txIndex: 0,
    logIndex,
    id,
    state: { ...zeroState("planet_update"), ...state },
  };
}

test("planet init report counts the first initialization of each planet by level and hour", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-planet-init-"));
  const db = openDatabase(path.join(dir, "events.db"));
  writeChunk(
    db,
    [
      { number: 1, hash: "h1", timestamp: 1000 },
      { number: 2, hash: "h2", timestamp: 2000 },
      { number: 3, hash: "h3", timestamp: 4000 },
    ],
    [
      planetLog("p1", 1, 0, {
        is_initialized: 1,
        planet_level: 1,
        created_at: 1000,
      }),
      planetLog("p1", 2, 0, {
        is_initialized: 1,
        planet_level: 1,
        created_at: 1000,
        silver: "10",
      }),
      planetLog("p2", 2, 1, {
        is_initialized: 1,
        planet_level: 1,
        created_at: 2000,
      }),
      planetLog("p3", 3, 0, {
        is_initialized: 1,
        planet_level: 3,
        created_at: 4000,
      }),
    ],
  );

  const report = buildPlanetInitReport(db, 3600);
  assert.equal(report.planetCount, 3);
  const files = writePlanetInitFiles(db.name, report);
  const stored = fs.readFileSync(files.dataPath, "utf8");
  const json = stored.replace(/^window\.PLANET_INIT_REPORT = /, "").replace(/;\s*$/, "");
  assert.deepEqual(JSON.parse(json).points, [
    { bucket: 0, planetLevel: 1, initialized: 2, cumulative: 2 },
    { bucket: 0, planetLevel: 3, initialized: 0, cumulative: 0 },
    { bucket: 3600, planetLevel: 1, initialized: 0, cumulative: 2 },
    { bucket: 3600, planetLevel: 3, initialized: 1, cumulative: 1 },
  ]);

  const html = fs.readFileSync(files.pagePath, "utf8");
  assert.match(html, /Planet initialization/);
  assert.match(html, /src="planet-inits.js"/);
  assert.equal(html.includes('"planetLevel":1'), false);
  db.close();
});

test("aggregatePlanetInits fills quiet hours with zeros", () => {
  const report = aggregatePlanetInits(
    [
      { planetLevel: 2, timestamp: 10 },
      { planetLevel: 2, timestamp: 10_000 },
    ],
    3600,
    99,
  );
  assert.equal(report.planetCount, 2);
  assert.equal(
    report.points.filter((point) => point.initialized === 0).length,
    1,
  );
});

test("renderPlanetInitHtml embeds the series for the page", () => {
  const html = renderPlanetInitHtml();
  assert.match(html, /src="planet-inits.js"/);
  assert.match(html, /New per bucket/);
});
