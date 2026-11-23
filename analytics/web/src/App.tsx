import { useEffect, useState } from "react";

import {
  isDashboardReport,
  type DashboardReport,
} from "../../analysis/report.ts";
import { Lines, RankBars, StackedBars } from "./components/Charts.tsx";
import { PlanetChart } from "./components/PlanetChart.tsx";
import {
  bucketLabel,
  formatSilver,
  formatTime,
  shortAddress,
  silverNumber,
} from "./format.ts";
import { actionLabel, artifactLabel, RARITY_COLORS } from "./labels.ts";
import {
  Card,
  CardLabel,
  CardValue,
  Cards,
  Empty,
  Hint,
  Page,
  EnterLink,
  PageTitle,
  SeasonTitle,
  Panel,
  PanelTitle,
  Stack,
  Subtitle,
  colors,
  seriesColor,
} from "./theme.ts";

type Load =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "ready"; report: DashboardReport };

const REPORT_COMMAND =
  "pnpm --filter analytics dashboard --out analytics/web/public/report.json";
const GAME_URL = "https://dfaztec-s2.dfarchon.xyz";

export default function App() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/report.json")
      .then(async (response) => {
        if (!response.ok) throw new Error("missing");
        return (await response.json()) as unknown;
      })
      .then((body) => {
        if (cancelled) return;
        if (!isDashboardReport(body)) {
          setLoad({ status: "invalid" });
          return;
        }
        setLoad({ status: "ready", report: body });
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Page>
      <PageTitle>Dark Forest Aztec</PageTitle>
      <SeasonTitle>Season 2</SeasonTitle>
      <EnterLink href={GAME_URL}>Enter Universe</EnterLink>
      {load.status === "loading" ? <Subtitle>Reading report…</Subtitle> : null}
      {load.status === "missing" ? (
        <>
          <Subtitle>Could not read /report.json.</Subtitle>
          <Hint>{REPORT_COMMAND}</Hint>
        </>
      ) : null}
      {load.status === "invalid" ? (
        <Subtitle>report.json is not an activity report.</Subtitle>
      ) : null}
      {load.status === "ready" ? <Dashboard report={load.report} /> : null}
    </Page>
  );
}

function Dashboard({ report }: { report: DashboardReport }) {
  const range =
    report.summary.from == null || report.summary.to == null
      ? "No activity in this report"
      : `${formatTime(report.summary.from)} – ${formatTime(report.summary.to)}`;
  const buckets = report.hourly.map((row) => row.bucket);
  const actionSeries = report.actions.map((action, index) => ({
    key: action,
    label: actionLabel(action),
    color: seriesColor(index),
    values: report.hourly.map((row) => row.actions[action] ?? 0),
  }));
  const otherVoyages =
    report.summary.voyages -
    report.voyages.normal -
    report.voyages.photoid -
    report.voyages.wormhole;

  return (
    <>
      <Subtitle>
        {bucketLabel(report.bucketSeconds)} · generated{" "}
        {formatTime(report.generatedAt)}
        <br />
        {range}
      </Subtitle>
      <Cards>
        <Stat label="Players" value={String(report.summary.players)} />
        <Stat
          label="Operations"
          value={report.summary.operations.toLocaleString()}
        />
        <Stat label="Planets" value={report.summary.planets.toLocaleString()} />
        <Stat label="Voyages" value={report.summary.voyages.toLocaleString()} />
        <Stat
          label="Silver moved"
          value={formatSilver(report.summary.silverMoved)}
        />
        <Stat
          label="Silver withdrawn"
          value={formatSilver(report.summary.silverWithdrawn)}
        />
      </Cards>
      <Stack>
        <Panel>
          <PanelTitle>Operations</PanelTitle>
          <StackedBars
            buckets={buckets}
            series={actionSeries}
            label="Operations by type over time"
          />
        </Panel>
        <Panel>
          <PanelTitle>Active players</PanelTitle>
          <Lines
            buckets={buckets}
            label="Active players over time"
            series={[
              {
                key: "players",
                label: "Players",
                color: colors.dfgreen,
                values: report.hourly.map((row) => row.activePlayers),
                text: report.hourly.map((row) => String(row.activePlayers)),
              },
            ]}
          />
        </Panel>
        <Panel>
          <PanelTitle>Silver</PanelTitle>
          <Lines
            buckets={buckets}
            label="Silver moved and withdrawn"
            series={[
              {
                key: "moved",
                label: "Moved",
                color: colors.dfblue,
                values: report.hourly.map((row) =>
                  silverNumber(row.silverMoved),
                ),
                text: report.hourly.map((row) => formatSilver(row.silverMoved)),
              },
              {
                key: "withdrawn",
                label: "Withdrawn",
                color: colors.dfyellow,
                values: report.hourly.map((row) =>
                  silverNumber(row.silverWithdrawn),
                ),
                text: report.hourly.map((row) =>
                  formatSilver(row.silverWithdrawn),
                ),
              },
            ]}
          />
        </Panel>
        <Panel>
          <PanelTitle>Players</PanelTitle>
          <RankBars
            rows={report.players.map((player) => ({
              key: player.player,
              label: shortAddress(player.player),
              title: `${player.player} · ${player.kinds} kinds`,
              value: player.operations,
              color: colors.dfgreen,
            }))}
          />
        </Panel>
        <Panel>
          <PanelTitle>Voyages</PanelTitle>
          <RankBars
            rows={[
              {
                key: "normal",
                label: "Normal",
                value: report.voyages.normal,
                color: colors.dfgreen,
              },
              {
                key: "photoid",
                label: "Photoid",
                value: report.voyages.photoid,
                color: colors.dfblue,
              },
              {
                key: "wormhole",
                label: "Wormhole",
                value: report.voyages.wormhole,
                color: colors.dfpurple,
              },
              ...(otherVoyages > 0
                ? [
                    {
                      key: "other",
                      label: "Other",
                      value: otherVoyages,
                      color: colors.subtext,
                    },
                  ]
                : []),
            ]}
          />
        </Panel>
        <Panel>
          <PanelTitle>Artifacts</PanelTitle>
          {report.artifacts.length === 0 ? (
            <Empty>No artifacts in this report.</Empty>
          ) : (
            <RankBars
              rows={report.artifacts.map((artifact) => ({
                key: `${artifact.artifactType}:${artifact.rarity}`,
                label: artifactLabel(artifact.artifactType, artifact.rarity),
                value: artifact.count,
                color: RARITY_COLORS[artifact.rarity] ?? colors.subtext,
              }))}
            />
          )}
        </Panel>
        <Panel>
          <PanelTitle>Planet initialization</PanelTitle>
          <PlanetChart points={report.planetInits} />
        </Panel>
      </Stack>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardValue>{value}</CardValue>
      <CardLabel>{label}</CardLabel>
    </Card>
  );
}
