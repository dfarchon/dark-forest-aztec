import { useState } from "react";
import styled from "styled-components";

import type { PlanetInitPoint } from "../../../analysis/report.ts";
import { ModeButton, Toolbar, seriesColor } from "../theme.ts";
import { StackedBars } from "./Charts.tsx";

const Modes = styled.div`
  display: flex;
  gap: 8px;
`;

export function PlanetChart({ points }: { points: PlanetInitPoint[] }) {
  const [mode, setMode] = useState<"new" | "sum">("new");
  const levels = [...new Set(points.map((point) => point.planetLevel))].sort(
    (a, b) => a - b,
  );
  const buckets = [...new Set(points.map((point) => point.bucket))].sort(
    (a, b) => a - b,
  );
  const lookup = new Map(
    points.map((point) => [`${point.bucket}:${point.planetLevel}`, point]),
  );
  const series = levels.map((level, index) => ({
    key: String(level),
    label: `Level ${level}`,
    color: seriesColor(index),
    values: buckets.map((bucket) => {
      const point = lookup.get(`${bucket}:${level}`);
      if (!point) return 0;
      return mode === "sum" ? point.cumulative : point.initialized;
    }),
  }));

  return (
    <>
      <Toolbar>
        <Modes>
          <ModeButton
            type="button"
            $on={mode === "new"}
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            New per bucket
          </ModeButton>
          <ModeButton
            type="button"
            $on={mode === "sum"}
            aria-pressed={mode === "sum"}
            onClick={() => setMode("sum")}
          >
            Cumulative
          </ModeButton>
        </Modes>
      </Toolbar>
      <StackedBars
        buckets={buckets}
        series={series}
        label="Planet initializations by time and level"
      />
    </>
  );
}
