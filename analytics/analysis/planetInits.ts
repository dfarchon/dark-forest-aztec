/**
 * First-time planet initializations, bucketed by time and planet level.
 * The result is a JSON file next to the page. The page only reads that file.
 */
import fs from "node:fs";
import path from "node:path";

import type Database from "better-sqlite3";

export interface PlanetInitPoint {
  bucket: number;
  planetLevel: number;
  initialized: number;
  cumulative: number;
}

export interface PlanetInitReport {
  bucketSeconds: number;
  generatedAt: number;
  planetCount: number;
  points: PlanetInitPoint[];
}

interface InitRow {
  planet_level: number;
  ts: number;
}

export function loadFirstInits(db: Database.Database): InitRow[] {
  return db
    .prepare(
      `WITH ranked AS (
         SELECT id, planet_level, created_at, block_number,
                ROW_NUMBER() OVER (
                  PARTITION BY id
                  ORDER BY block_number, tx_index, log_index
                ) AS n
         FROM planet_update
         WHERE is_initialized = 1
       )
       SELECT ranked.planet_level AS planet_level,
              CASE
                WHEN ranked.created_at > 0 THEN ranked.created_at
                ELSE blocks.timestamp
              END AS ts
       FROM ranked
       JOIN blocks ON blocks.number = ranked.block_number
       WHERE ranked.n = 1`,
    )
    .all() as InitRow[];
}

export function aggregatePlanetInits(
  rows: Array<{ planetLevel: number; timestamp: number }>,
  bucketSeconds: number,
  generatedAt = Math.floor(Date.now() / 1000),
): PlanetInitReport {
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) {
    throw new Error(
      "[analytics] planet bucket size must be a positive integer",
    );
  }
  const counts = new Map<string, number>();
  const levels = new Set<number>();
  let minBucket = Number.POSITIVE_INFINITY;
  let maxBucket = 0;
  let planetCount = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.timestamp) || row.timestamp <= 0) continue;
    const bucket = Math.floor(row.timestamp / bucketSeconds) * bucketSeconds;
    const key = `${bucket}:${row.planetLevel}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    levels.add(row.planetLevel);
    if (bucket < minBucket) minBucket = bucket;
    if (bucket > maxBucket) maxBucket = bucket;
    planetCount += 1;
  }
  const sortedLevels = [...levels].sort((a, b) => a - b);
  const points: PlanetInitPoint[] = [];
  if (planetCount === 0) {
    return { bucketSeconds, generatedAt, planetCount, points };
  }
  const running = new Map<number, number>();
  for (let bucket = minBucket; bucket <= maxBucket; bucket += bucketSeconds) {
    for (const level of sortedLevels) {
      const initialized = counts.get(`${bucket}:${level}`) ?? 0;
      const cumulative = (running.get(level) ?? 0) + initialized;
      running.set(level, cumulative);
      points.push({ bucket, planetLevel: level, initialized, cumulative });
    }
  }
  return { bucketSeconds, generatedAt, planetCount, points };
}

export function planetInitDataPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "planet-inits.js");
}

export function planetInitPagePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "planet-inits.html");
}

export function writePlanetInitFiles(
  dbPath: string,
  report: PlanetInitReport,
): { dataPath: string; pagePath: string } {
  const dataPath = planetInitDataPath(dbPath);
  const pagePath = planetInitPagePath(dbPath);
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });
  fs.writeFileSync(
    dataPath,
    `window.PLANET_INIT_REPORT = ${JSON.stringify(report, null, 2)};\n`,
  );
  fs.writeFileSync(pagePath, renderPlanetInitHtml());
  return { dataPath, pagePath };
}

export function buildPlanetInitReport(
  db: Database.Database,
  bucketSeconds: number,
): PlanetInitReport {
  const rows = loadFirstInits(db).map((row) => ({
    planetLevel: row.planet_level,
    timestamp: row.ts,
  }));
  return aggregatePlanetInits(rows, bucketSeconds);
}

const LEVEL_COLORS = [
  "#7f8c9b",
  "#6ea8fe",
  "#3ecfb8",
  "#8fd14f",
  "#e6c34a",
  "#f09a3e",
  "#ef6b4a",
  "#e85d9a",
  "#b07bff",
  "#f7f4ff",
];

function colorFor(level: number): string {
  return LEVEL_COLORS[level] ?? `hsl(${(level * 37) % 360} 70% 62%)`;
}

export function renderPlanetInitHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Planet initialization</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", Palatino, "Songti SC", serif;
      background: #000;
      color: #e8eefc;
    }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-weight: 600; letter-spacing: 0.02em; margin: 0 0 8px; }
    .sub { color: #9aabc8; margin: 0 0 24px; }
    .cards { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
    .card {
      background: rgba(16, 24, 42, 0.85);
      border: 1px solid #24304a;
      border-radius: 14px;
      padding: 14px 16px;
      min-width: 140px;
    }
    .card b { display: block; font-size: 28px; font-variant-numeric: tabular-nums; }
    .card span { color: #9aabc8; font-size: 13px; }
    .panel {
      background: rgba(10, 16, 30, 0.9);
      border: 1px solid #24304a;
      border-radius: 18px;
      padding: 16px 16px 8px;
    }
    .toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .modes { display: flex; gap: 8px; }
    button {
      background: #152036;
      color: #d5e2ff;
      border: 1px solid #31425f;
      border-radius: 999px;
      padding: 6px 12px;
      cursor: pointer;
    }
    button[aria-pressed="true"] { background: #d5e2ff; color: #10182a; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px 14px; margin: 8px 0 4px; font-size: 13px; }
    .swatch { width: 10px; height: 10px; border-radius: 99px; display: inline-block; margin-right: 6px; }
    svg { width: 100%; height: auto; display: block; touch-action: none; }
    .tip {
      position: fixed;
      pointer-events: none;
      background: #10182a;
      border: 1px solid #3c5278;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      display: none;
      z-index: 2;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 14px; }
    th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid #1d2942; }
    th:first-child, td:first-child { text-align: left; }
  </style>
</head>
<body>
  <main>
    <h1>Planet initialization</h1>
    <p class="sub" id="subtitle"></p>
    <div class="cards">
      <div class="card"><b id="total"></b><span>Initialized planets</span></div>
      <div class="card"><b id="peak"></b><span id="peak-label">Busiest bucket</span></div>
      <div class="card"><b id="levels"></b><span>Levels seen</span></div>
    </div>
    <section class="panel">
      <div class="toolbar">
        <div class="modes">
          <button type="button" id="mode-new" aria-pressed="true">New per bucket</button>
          <button type="button" id="mode-sum" aria-pressed="false">Cumulative</button>
        </div>
        <div id="hover-readout" class="sub"></div>
      </div>
      <div class="legend" id="legend"></div>
      <svg id="chart" viewBox="0 0 960 420" role="img" aria-label="Planet initializations by time and level"></svg>
    </section>
    <table>
      <thead><tr id="head"></tr></thead>
      <tbody id="body"></tbody>
    </table>
  </main>
  <div class="tip" id="tip"></div>
  <script src="planet-inits.js"></script>
  <script>
    const report = window.PLANET_INIT_REPORT;
    if (!report) {
      document.getElementById("subtitle").textContent =
        "Could not read planet-inits.js next to this page.";
    } else {
    const colors = ${JSON.stringify(LEVEL_COLORS)};
    const colorFor = (level) => colors[level] || "hsl(" + ((level * 37) % 360) + " 70% 62%)";
    const levels = [...new Set(report.points.map((p) => p.planetLevel))].sort((a, b) => a - b);
    const buckets = [...new Set(report.points.map((p) => p.bucket))].sort((a, b) => a - b);
    const valueOf = (mode, bucket, level) => {
      const row = report.points.find((p) => p.bucket === bucket && p.planetLevel === level);
      if (!row) return 0;
      return mode === "sum" ? row.cumulative : row.initialized;
    };
    const fmt = (ts) => new Date(ts * 1000).toLocaleString();
    document.getElementById("subtitle").textContent =
      "Bucket " + report.bucketSeconds + "s · generated " + fmt(report.generatedAt);
    document.getElementById("total").textContent = String(report.planetCount);
    document.getElementById("levels").textContent = levels.length ? levels.join(" / ") : "—";
    const legend = document.getElementById("legend");
    for (const level of levels) {
      const item = document.createElement("span");
      item.innerHTML = '<i class="swatch" style="background:' + colorFor(level) + '"></i>Level ' + level;
      legend.appendChild(item);
    }
    const head = document.getElementById("head");
    head.innerHTML = "<th>Time</th>" + levels.map((level) => "<th>Level " + level + "</th>").join("") + "<th>Total</th>";
    const body = document.getElementById("body");
    let peak = 0;
    let peakBucket = 0;
    for (const bucket of buckets) {
      let sum = 0;
      const cells = levels.map((level) => {
        const n = valueOf("new", bucket, level);
        sum += n;
        return "<td>" + n + "</td>";
      });
      if (sum > peak) { peak = sum; peakBucket = bucket; }
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + fmt(bucket) + "</td>" + cells.join("") + "<td>" + sum + "</td>";
      body.appendChild(tr);
    }
    document.getElementById("peak").textContent = String(peak);
    document.getElementById("peak-label").textContent = peak ? "Busiest bucket · " + fmt(peakBucket) : "Busiest bucket";

    const svg = document.getElementById("chart");
    const ns = "http://www.w3.org/2000/svg";
    const W = 960, H = 420, pad = { l: 52, r: 16, t: 18, b: 42 };
    let mode = "new";
    function el(name, attrs) {
      const node = document.createElementNS(ns, name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      return node;
    }
    function draw() {
      svg.replaceChildren();
      const innerW = W - pad.l - pad.r;
      const innerH = H - pad.t - pad.b;
      const totals = buckets.map((bucket) => levels.reduce((sum, level) => sum + valueOf(mode, bucket, level), 0));
      const max = Math.max(1, ...totals);
      const x = (i) => pad.l + (buckets.length <= 1 ? innerW / 2 : (i / (buckets.length - 1)) * innerW);
      const y = (v) => pad.t + innerH - (v / max) * innerH;
      for (let tick = 0; tick <= 4; tick += 1) {
        const value = Math.round((max * tick) / 4);
        const yy = y(value);
        svg.appendChild(el("line", { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: "#1d2942" }));
        const label = el("text", { x: pad.l - 8, y: yy + 4, fill: "#8ea0c0", "font-size": 12, "text-anchor": "end" });
        label.textContent = String(value);
        svg.appendChild(label);
      }
      const stack = buckets.map(() => 0);
      for (const level of levels) {
        const top = [];
        const bottom = [];
        buckets.forEach((bucket, i) => {
          const v = valueOf(mode, bucket, level);
          bottom.push([x(i), y(stack[i])]);
          stack[i] += v;
          top.push([x(i), y(stack[i])]);
        });
        const path = top.map((p, i) => (i ? "L" : "M") + p[0] + " " + p[1]).join(" ")
          + " " + bottom.reverse().map((p) => "L" + p[0] + " " + p[1]).join(" ") + " Z";
        svg.appendChild(el("path", { d: path, fill: colorFor(level), opacity: mode === "sum" ? 0.85 : 0.9 }));
      }
      if (buckets.length) {
        const first = el("text", { x: x(0), y: H - 14, fill: "#8ea0c0", "font-size": 12 });
        first.textContent = fmt(buckets[0]);
        const last = el("text", { x: x(buckets.length - 1), y: H - 14, fill: "#8ea0c0", "font-size": 12, "text-anchor": "end" });
        last.textContent = fmt(buckets[buckets.length - 1]);
        svg.appendChild(first);
        svg.appendChild(last);
      }
      const guide = el("line", { y1: pad.t, y2: H - pad.b, stroke: "#d5e2ff", "stroke-dasharray": "3 3", visibility: "hidden" });
      svg.appendChild(guide);
      svg.onmousemove = (event) => {
        if (!buckets.length) return;
        const rect = svg.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width) * W;
        let nearest = 0;
        let best = Infinity;
        buckets.forEach((_, i) => {
          const dist = Math.abs(x(i) - px);
          if (dist < best) { best = dist; nearest = i; }
        });
        guide.setAttribute("x1", x(nearest));
        guide.setAttribute("x2", x(nearest));
        guide.setAttribute("visibility", "visible");
        const bucket = buckets[nearest];
        const lines = [fmt(bucket)].concat(levels.map((level) => "Level " + level + "  " + valueOf(mode, bucket, level)));
        const tip = document.getElementById("tip");
        tip.style.display = "block";
        tip.style.left = (event.clientX + 12) + "px";
        tip.style.top = (event.clientY + 12) + "px";
        tip.innerHTML = lines.join("<br>");
        document.getElementById("hover-readout").textContent = fmt(bucket);
      };
      svg.onmouseleave = () => {
        guide.setAttribute("visibility", "hidden");
        document.getElementById("tip").style.display = "none";
      };
    }
    function setMode(next) {
      mode = next;
      document.getElementById("mode-new").setAttribute("aria-pressed", next === "new" ? "true" : "false");
      document.getElementById("mode-sum").setAttribute("aria-pressed", next === "sum" ? "true" : "false");
      draw();
    }
    document.getElementById("mode-new").onclick = () => setMode("new");
    document.getElementById("mode-sum").onclick = () => setMode("sum");
    draw();
    }
  </script>
</body>
</html>
`;
}
