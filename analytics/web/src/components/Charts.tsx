import { useState, type MouseEvent, type ReactNode } from "react";

import { compact, formatTime } from "../format.ts";
import {
  ChartSvg,
  Empty,
  Legend,
  RankFill,
  RankLabel,
  RankList,
  RankRow,
  RankTrack,
  RankValue,
  Swatch,
  Tip,
  colors,
} from "../theme.ts";

export const CHART = {
  width: 960,
  height: 320,
  pad: { l: 56, r: 16, t: 16, b: 42 },
};

export interface Hover {
  index: number;
  x: number;
  y: number;
}

export function slotIndex(
  event: MouseEvent<SVGSVGElement>,
  count: number,
): number {
  if (count <= 0) return 0;
  const rect = event.currentTarget.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / rect.width) * CHART.width;
  const inner = CHART.width - CHART.pad.l - CHART.pad.r;
  const local = px - CHART.pad.l;
  const index = Math.floor(local / (inner / count));
  return Math.max(0, Math.min(count - 1, index));
}

export function slotX(index: number, count: number): number {
  const inner = CHART.width - CHART.pad.l - CHART.pad.r;
  const slot = inner / Math.max(count, 1);
  return CHART.pad.l + slot * index + slot / 2;
}

export function yFor(value: number, max: number): number {
  const top = Math.max(max, 1);
  const inner = CHART.height - CHART.pad.t - CHART.pad.b;
  return CHART.pad.t + inner - (value / top) * inner;
}

export function ChartTooltip({
  hover,
  lines,
}: {
  hover: Hover | null;
  lines: string[];
}) {
  if (!hover) return null;
  const left = Math.min(hover.x + 12, window.innerWidth - 240);
  return (
    <Tip style={{ left, top: hover.y + 12 }}>
      {lines.map((line, index) => (
        <div key={index}>{line}</div>
      ))}
    </Tip>
  );
}

function Axis({ max }: { max: number }) {
  const lines: ReactNode[] = [];
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (max * tick) / 4;
    const y = yFor(value, max);
    lines.push(
      <line
        key={`grid-${tick}`}
        x1={CHART.pad.l}
        x2={CHART.width - CHART.pad.r}
        y1={y}
        y2={y}
        stroke={colors.borderDark}
      />,
    );
    lines.push(
      <text
        key={`label-${tick}`}
        x={CHART.pad.l - 8}
        y={y + 4}
        fill={colors.subtext}
        fontSize="12"
        textAnchor="end"
      >
        {compact(value)}
      </text>,
    );
  }
  return <>{lines}</>;
}

function EndpointLabels({ buckets }: { buckets: number[] }) {
  if (buckets.length === 0) return null;
  const first = buckets[0] ?? 0;
  const last = buckets[buckets.length - 1] ?? first;
  return (
    <>
      <text
        x={slotX(0, buckets.length)}
        y={CHART.height - 14}
        fill={colors.subtext}
        fontSize="12"
      >
        {formatTime(first)}
      </text>
      {buckets.length > 1 ? (
        <text
          x={slotX(buckets.length - 1, buckets.length)}
          y={CHART.height - 14}
          fill={colors.subtext}
          fontSize="12"
          textAnchor="end"
        >
          {formatTime(last)}
        </text>
      ) : null}
    </>
  );
}

export interface StackedSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function StackedBars({
  buckets,
  series,
  label,
}: {
  buckets: number[];
  series: StackedSeries[];
  label: string;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  if (buckets.length === 0) return <Empty>No activity in this range.</Empty>;
  const totals = buckets.map((_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
  const max = Math.max(1, ...totals);
  const inner = CHART.width - CHART.pad.l - CHART.pad.r;
  const slot = inner / buckets.length;
  const barWidth = Math.max(1, slot - 2);
  const hoverIndex = hover?.index ?? -1;
  const lines =
    hover == null
      ? []
      : [
          formatTime(buckets[hover.index] ?? 0),
          ...series.map(
            (item) => `${item.label}  ${item.values[hover.index] ?? 0}`,
          ),
        ];

  return (
    <>
      <ChartSvg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={label}
        onMouseMove={(event) =>
          setHover({
            index: slotIndex(event, buckets.length),
            x: event.clientX,
            y: event.clientY,
          })
        }
        onMouseLeave={() => setHover(null)}
      >
        <Axis max={max} />
        {buckets.map((bucket, index) => {
          let cursor = 0;
          return series.map((item) => {
            const value = item.values[index] ?? 0;
            const y = yFor(cursor + value, max);
            const height = yFor(cursor, max) - y;
            cursor += value;
            if (height <= 0) return null;
            return (
              <rect
                key={`${item.key}-${bucket}`}
                x={CHART.pad.l + index * slot + (slot - barWidth) / 2}
                y={y}
                width={barWidth}
                height={height}
                fill={item.color}
                opacity={
                  hoverIndex === -1 || hoverIndex === index ? 0.95 : 0.35
                }
              />
            );
          });
        })}
        <EndpointLabels buckets={buckets} />
      </ChartSvg>
      <Legend>
        {series.map((item) => (
          <span key={item.key}>
            <Swatch $color={item.color} />
            {item.label}
          </span>
        ))}
      </Legend>
      <ChartTooltip hover={hover} lines={lines} />
    </>
  );
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  text: string[];
}

export function Lines({
  buckets,
  series,
  label,
}: {
  buckets: number[];
  series: LineSeries[];
  label: string;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  if (buckets.length === 0) return <Empty>No activity in this range.</Empty>;
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const hoverIndex = hover?.index ?? -1;
  const lines =
    hover == null
      ? []
      : [
          formatTime(buckets[hover.index] ?? 0),
          ...series.map(
            (item) => `${item.label}  ${item.text[hover.index] ?? "0"}`,
          ),
        ];

  return (
    <>
      <ChartSvg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={label}
        onMouseMove={(event) =>
          setHover({
            index: slotIndex(event, buckets.length),
            x: event.clientX,
            y: event.clientY,
          })
        }
        onMouseLeave={() => setHover(null)}
      >
        <Axis max={max} />
        {series.map((item) => {
          const points = item.values
            .map(
              (value, index) =>
                `${slotX(index, buckets.length)},${yFor(value, max)}`,
            )
            .join(" ");
          return (
            <g key={item.key}>
              <polyline
                points={points}
                fill="none"
                stroke={item.color}
                strokeWidth="2"
              />
              {item.values.map((value, index) => (
                <circle
                  key={`${item.key}-${buckets[index] ?? index}`}
                  cx={slotX(index, buckets.length)}
                  cy={yFor(value, max)}
                  r={hoverIndex === index ? 4 : 2.5}
                  fill={item.color}
                />
              ))}
            </g>
          );
        })}
        {hover ? (
          <line
            x1={slotX(hover.index, buckets.length)}
            x2={slotX(hover.index, buckets.length)}
            y1={CHART.pad.t}
            y2={CHART.height - CHART.pad.b}
            stroke={colors.dfwhite}
            strokeDasharray="3 3"
          />
        ) : null}
        <EndpointLabels buckets={buckets} />
      </ChartSvg>
      <Legend>
        {series.map((item) => (
          <span key={item.key}>
            <Swatch $color={item.color} />
            {item.label}
          </span>
        ))}
      </Legend>
      <ChartTooltip hover={hover} lines={lines} />
    </>
  );
}

export function RankBars({
  rows,
}: {
  rows: Array<{
    key: string;
    label: string;
    value: number;
    color: string;
    title?: string;
  }>;
}) {
  if (rows.length === 0) return <Empty>No activity in this range.</Empty>;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <RankList>
      {rows.map((row) => (
        <RankRow key={row.key} title={row.title ?? row.label}>
          <RankLabel>{row.label}</RankLabel>
          <RankTrack>
            <RankFill
              $color={row.color}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </RankTrack>
          <RankValue>{row.value.toLocaleString()}</RankValue>
        </RankRow>
      ))}
    </RankList>
  );
}
