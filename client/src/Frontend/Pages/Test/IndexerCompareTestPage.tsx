/**
 * Compare frontend indexer state with and without the off-chain bootstrap,
 * both frozen at one block at or above the proven tip.
 */

import "./TestPageStyles.css";

import { createAztecNodeClient } from "@aztec-labs/aztec.js/node";
import { START_BLOCK } from "@dfpunk/contracts";
import type { IndexerLifecycle } from "@dfpunk/indexer-core";
import {
  createAztecNodeBlockSource,
  IndexerService,
} from "@dfpunk/indexer-core";
import * as React from "react";

import {
  getEffectiveIndexerBootstrapUrl,
  getEffectiveNodeUrl,
} from "../../../config/connection";
import {
  OffChainBlockSource,
  type SnapshotDownloadProgress,
} from "../../../Session/Indexer/OffChainSource";
import { capBlockSource, TIP_TAGS, type TipTag } from "./indexerCompare";

interface IndexerLatest {
  blockNumber: number;
  snapshotBlock: number;
}

interface SideState {
  phase: "idle" | "running" | "done" | "error" | "skipped";
  lifecycle: string;
  processedBlock: number;
  bootstrapBlock?: number;
  detail: string;
  error?: string;
  json?: string;
  hash?: string;
  syncedToBlock?: number;
}

interface FinishedSync {
  syncedToBlock: number;
  bootstrapBlock?: number;
  json: string;
  hash?: string;
  lifecycle: IndexerLifecycle;
}

function idleSide(detail: string): SideState {
  return {
    phase: "idle",
    lifecycle: "idle",
    processedBlock: 0,
    bootstrapBlock: undefined,
    detail,
  };
}

function parseTarget(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

function snapshotDetail(progress: SnapshotDownloadProgress): string {
  const bytes = progress.loadedBytes.toLocaleString("en-US");
  if (progress.phase === "parsing")
    return `Parsing snapshot, ${bytes} bytes downloaded`;
  if (progress.phase === "complete")
    return `Snapshot download complete, ${bytes} bytes`;
  return `Downloading snapshot, ${bytes} bytes received`;
}

function downloadSnapshot(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="test-page__section">
      <button
        type="button"
        className="test-page__section-header"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`test-page__section-chevron ${open ? "open" : ""}`}>
          ▶
        </span>
        {title}
      </button>
      {open ? <div className="test-page__section-body">{children}</div> : null}
    </section>
  );
}

export function IndexerCompareTestPage() {
  const nodeUrl = getEffectiveNodeUrl();
  const bootstrapUrl = getEffectiveIndexerBootstrapUrl();
  const servicesRef = React.useRef<IndexerService[]>([]);
  const runSeq = React.useRef(0);

  const [tips, setTips] = React.useState<Record<TipTag, number> | null>(null);
  const [tipError, setTipError] = React.useState<string | null>(null);
  const [indexerLatest, setIndexerLatest] =
    React.useState<IndexerLatest | null>(null);
  const [indexerError, setIndexerError] = React.useState<string | null>(
    bootstrapUrl ? null : "No off-chain indexer URL configured"
  );
  const [updatedAt, setUpdatedAt] = React.useState<number | null>(null);
  const [targetText, setTargetText] = React.useState("");
  const [targetTouched, setTargetTouched] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [bootstrapSide, setBootstrapSide] = React.useState<SideState>(
    idleSide("Not started")
  );
  const [chainSide, setChainSide] = React.useState<SideState>(
    idleSide("Not started")
  );

  React.useEffect(() => {
    return () => {
      runSeq.current += 1;
      for (const service of servicesRef.current) service.destroy();
      servicesRef.current = [];
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const node = createAztecNodeClient(nodeUrl);
        const entries = await Promise.all(
          TIP_TAGS.map(async (tag) => {
            const height = Number(await node.getBlockNumber(tag));
            return [tag, height] as const;
          })
        );
        if (cancelled) return;
        setTips(Object.fromEntries(entries) as Record<TipTag, number>);
        setTipError(null);
      } catch (err) {
        if (cancelled) return;
        setTipError(err instanceof Error ? err.message : String(err));
      }

      if (!bootstrapUrl) {
        if (!cancelled) {
          setIndexerLatest(null);
          setIndexerError("No off-chain indexer URL configured");
        }
        setUpdatedAt(Date.now());
        return;
      }

      try {
        const latest = await fetchIndexerLatest(bootstrapUrl);
        if (cancelled) return;
        setIndexerLatest(latest);
        setIndexerError(null);
      } catch (err) {
        if (cancelled) return;
        setIndexerError(err instanceof Error ? err.message : String(err));
      }
      setUpdatedAt(Date.now());
    }

    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bootstrapUrl, nodeUrl]);

  React.useEffect(() => {
    if (!targetTouched && tips) setTargetText(String(tips.proven));
  }, [targetTouched, tips]);

  const target = parseTarget(targetText);
  const proven = tips?.proven;
  const proposed = tips?.proposed;
  const rangeError = describeTarget(
    target,
    proven,
    proposed,
    indexerLatest?.snapshotBlock
  );
  const canRun =
    !running &&
    rangeError == null &&
    Boolean(bootstrapUrl) &&
    indexerError == null &&
    indexerLatest != null;

  async function syncSide(
    runId: number,
    useBootstrap: boolean,
    targetBlock: number,
    onUpdate: (patch: Partial<SideState>) => void
  ): Promise<FinishedSync | null> {
    const alive = () => runId === runSeq.current;
    const source = capBlockSource(
      createAztecNodeBlockSource(nodeUrl, undefined, {
        tipTag: "proposed",
        requestTimeoutMs: 30_000,
      }),
      targetBlock
    );
    const bootstrapSource =
      useBootstrap && bootstrapUrl
        ? new OffChainBlockSource({
            baseUrl: bootstrapUrl,
            onSnapshotProgress: (progress) => {
              if (!alive()) return;
              onUpdate({ detail: snapshotDetail(progress) });
            },
          })
        : undefined;
    const indexer = new IndexerService({
      bootstrap: {
        source,
        bootstrapSource,
        startBlock: START_BLOCK,
      },
      sync: {
        pollIntervalMs: 2000,
        maxBlocksPerRequest: 100,
        initialSyncMaxRetries: Infinity,
        onInitialSyncRetry: (_attempt, waitMs, error) => {
          if (!alive()) return;
          const message =
            error instanceof Error ? error.message : String(error);
          onUpdate({
            detail: `Node request failed, retrying in ${Math.ceil(waitMs / 1000)}s: ${message}`,
          });
        },
      },
    });
    servicesRef.current.push(indexer);
    indexer.setOnBlockProcessed((_from, to) => {
      if (!alive()) return;
      onUpdate({
        processedBlock: to,
        lifecycle: indexer.getLifecycle(),
        detail: `Applying blocks, reached ${to}`,
      });
    });

    let settled = false;
    const timer = setInterval(() => {
      if (settled || !alive()) return;
      onUpdate({
        processedBlock: indexer.getProcessedBlockNumber(),
        lifecycle: indexer.getLifecycle(),
      });
    }, 500);

    try {
      const started = await indexer.start();
      if (!alive()) return null;
      const status = indexer.getStatus();
      if (status.forkDiverged) {
        throw new Error(status.lastError ?? "The followed tip diverged");
      }
      return {
        syncedToBlock: started.syncedToBlock,
        bootstrapBlock: started.bootstrapBlock,
        json: indexer.getSnapshotAsJsonString(),
        hash: indexer.getProcessedBlockHash(),
        lifecycle: indexer.getLifecycle(),
      };
    } finally {
      settled = true;
      clearInterval(timer);
      indexer.destroy();
      servicesRef.current = servicesRef.current.filter(
        (service) => service !== indexer
      );
    }
  }

  async function runCompare() {
    if (!canRun || target == null) return;
    const runId = ++runSeq.current;
    for (const service of servicesRef.current) service.destroy();
    servicesRef.current = [];
    const alive = () => runId === runSeq.current;

    setRunning(true);
    setRunError(null);
    setBootstrapSide({
      ...idleSide("Reading the off-chain snapshot"),
      phase: "running",
      lifecycle: "bootstrapping",
    });
    setChainSide(idleSide("Waiting for the bootstrap sync to finish"));

    try {
      const latest = await fetchIndexerLatest(bootstrapUrl!);
      if (!alive()) return;
      if (latest.snapshotBlock > target) {
        setRunError(
          `Off-chain snapshot block ${latest.snapshotBlock} is above target ${target}. A snapshot cannot be rewound.`
        );
        setBootstrapSide(idleSide("Not started"));
        return;
      }
      setIndexerLatest(latest);

      const boot = await syncSide(runId, true, target, (patch) => {
        setBootstrapSide((prev) => ({ ...prev, ...patch }));
      });
      if (!alive() || !boot) return;

      const bootBase: SideState = {
        phase: "done",
        lifecycle: boot.lifecycle,
        processedBlock: boot.syncedToBlock,
        bootstrapBlock: boot.bootstrapBlock,
        detail: `Stopped at block ${boot.syncedToBlock}`,
        json: boot.json,
        hash: boot.hash,
        syncedToBlock: boot.syncedToBlock,
      };

      if (boot.bootstrapBlock === undefined) {
        setBootstrapSide({
          ...bootBase,
          phase: "error",
          error: "Off-chain snapshot was not installed",
        });
        setChainSide({
          ...idleSide("Not started"),
          phase: "skipped",
        });
        setRunError(
          "The off-chain snapshot was missing or failed the block-hash check, so this side fell back to a full chain sync. The chain-only sync was not started."
        );
        return;
      }
      if (boot.syncedToBlock !== target) {
        setBootstrapSide({
          ...bootBase,
          phase: "error",
          error: `Stopped at block ${boot.syncedToBlock}, short of target ${target}`,
        });
        setChainSide({ ...idleSide("Not started"), phase: "skipped" });
        setRunError(
          `Bootstrap sync stopped at block ${boot.syncedToBlock}, short of target ${target}`
        );
        return;
      }
      setBootstrapSide(bootBase);

      setChainSide({
        ...idleSide(
          "Replaying from the start block. A long chain will take a while."
        ),
        phase: "running",
        lifecycle: "syncing",
      });
      const chain = await syncSide(runId, false, target, (patch) => {
        setChainSide((prev) => ({ ...prev, ...patch }));
      });
      if (!alive() || !chain) return;

      const chainBase: SideState = {
        phase: "done",
        lifecycle: chain.lifecycle,
        processedBlock: chain.syncedToBlock,
        bootstrapBlock: undefined,
        detail: `Stopped at block ${chain.syncedToBlock}`,
        json: chain.json,
        hash: chain.hash,
        syncedToBlock: chain.syncedToBlock,
      };
      if (chain.syncedToBlock !== target) {
        setChainSide({
          ...chainBase,
          phase: "error",
          error: `Stopped at block ${chain.syncedToBlock}, short of target ${target}`,
        });
        setRunError(
          `Chain-only sync stopped at block ${chain.syncedToBlock}, short of target ${target}`
        );
        return;
      }
      setChainSide(chainBase);
    } catch (err) {
      if (!alive()) return;
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("indexer was destroyed")) return;
      setRunError(message);
      setBootstrapSide((prev) =>
        prev.phase === "running"
          ? { ...prev, phase: "error", error: message }
          : prev
      );
      setChainSide((prev) =>
        prev.phase === "running"
          ? { ...prev, phase: "error", error: message }
          : prev
      );
    } finally {
      if (alive()) setRunning(false);
    }
  }

  return (
    <div className="test-page" style={{ maxWidth: "1100px" }}>
      <header className="test-page__header">
        <h1 className="test-page__title">Bootstrap and chain-only snapshots</h1>
        <p style={{ margin: "0 0 12px", opacity: 0.85 }}>
          Sync the frontend indexer to one target block twice: once from the
          off-chain snapshot, then once from the chain only. Download the two
          JSON files and compare them yourself. This page does not diff them.
        </p>
        <nav className="test-page__nav">
          <a href="/">← Home</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test">Test</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/indexer">Indexer</a>
        </nav>
      </header>

      {tipError ? (
        <div className="test-page__error">
          <strong>Node:</strong> {tipError}
        </div>
      ) : null}
      {indexerError ? (
        <div className="test-page__error">
          <strong>Off-chain indexer:</strong> {indexerError}
        </div>
      ) : null}
      {runError ? (
        <div className="test-page__error">
          <strong>Run:</strong> {runError}
        </div>
      ) : null}

      <Section title="Chain tips and off-chain indexer">
        <div className="test-page__stats">
          {TIP_TAGS.map((tag) => (
            <div className="test-page__stat" key={tag}>
              <div className="test-page__stat-label">{tag}</div>
              <div className="test-page__stat-value">
                {tips ? tips[tag] : "…"}
              </div>
            </div>
          ))}
          <div className="test-page__stat">
            <div className="test-page__stat-label">indexer processed</div>
            <div className="test-page__stat-value">
              {indexerLatest ? indexerLatest.blockNumber : "…"}
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">snapshot block</div>
            <div className="test-page__stat-value">
              {indexerLatest ? indexerLatest.snapshotBlock : "…"}
            </div>
          </div>
        </div>
        <p style={{ margin: "0.75rem 0 0", opacity: 0.8, fontSize: "0.9rem" }}>
          Node {nodeUrl}
          <br />
          Off-chain indexer {bootstrapUrl ?? "not configured"}
          {updatedAt
            ? ` · updated ${new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}`
            : ""}
        </p>
      </Section>

      <Section title="Target block">
        <div className="test-page__form-group">
          <label className="test-page__form-label" htmlFor="compare-target">
            At least proven, and no higher than proposed
          </label>
          <input
            id="compare-target"
            className="test-page__form-input test-page__form-input--short"
            inputMode="numeric"
            value={targetText}
            onChange={(event) => {
              setTargetTouched(true);
              setTargetText(event.target.value);
            }}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {TIP_TAGS.filter((tag) => tag !== "finalized").map((tag) => {
            const height = tips?.[tag];
            const enabled =
              height != null && proven != null && height >= proven && !running;
            return (
              <button
                key={tag}
                type="button"
                className="test-page__btn test-page__btn--secondary"
                disabled={!enabled}
                onClick={() => {
                  if (height == null) return;
                  setTargetTouched(true);
                  setTargetText(String(height));
                }}
              >
                Use {tag}
                {height != null ? ` (${height})` : ""}
              </button>
            );
          })}
          <button
            type="button"
            className="test-page__btn test-page__btn--primary"
            disabled={!canRun}
            onClick={() => void runCompare()}
          >
            {running ? "Syncing…" : "Start sync"}
          </button>
        </div>
        {rangeError ? (
          <p style={{ margin: "0.75rem 0 0", color: "#fde68a" }}>
            {rangeError}
          </p>
        ) : (
          <p style={{ margin: "0.75rem 0 0", opacity: 0.8 }}>
            Allowed range {proven ?? "…"} – {proposed ?? "…"}. The chain-only
            replay starts at block {START_BLOCK} and can take a long time.
          </p>
        )}
      </Section>

      <Section title="Sync progress">
        <div className="test-page__split">
          <SideCard
            title="With bootstrap"
            side={bootstrapSide}
            filename={`bootstrap-snapshot-block-${bootstrapSide.syncedToBlock ?? "unknown"}.json`}
          />
          <SideCard
            title="Without bootstrap"
            side={chainSide}
            filename={`chain-snapshot-block-${chainSide.syncedToBlock ?? "unknown"}.json`}
          />
        </div>
      </Section>
    </div>
  );
}

function SideCard({
  title,
  side,
  filename,
}: {
  title: string;
  side: SideState;
  filename: string;
}) {
  return (
    <div className="test-page__stat" style={{ display: "block" }}>
      <div className="test-page__stat-label">{title}</div>
      <div style={{ marginTop: "0.5rem" }}>
        <span
          className={`test-page__badge test-page__badge--${badgePhase(side.phase)}`}
        >
          {side.phase}
        </span>{" "}
        <span
          className={`test-page__badge test-page__badge--${side.lifecycle}`}
        >
          {side.lifecycle}
        </span>
      </div>
      <p style={{ margin: "0.75rem 0 0" }}>
        Processed {side.processedBlock}
        {side.syncedToBlock != null ? ` · synced ${side.syncedToBlock}` : ""}
      </p>
      <p style={{ margin: "0.35rem 0 0" }}>
        Installed snapshot block{" "}
        {side.bootstrapBlock === undefined ? "none" : side.bootstrapBlock}
        {side.hash ? ` · hash ${side.hash.slice(0, 18)}…` : ""}
      </p>
      <p style={{ margin: "0.35rem 0 0", opacity: 0.85 }}>{side.detail}</p>
      {side.error ? (
        <p style={{ margin: "0.35rem 0 0", color: "#fecaca" }}>{side.error}</p>
      ) : null}
      <div style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="test-page__btn test-page__btn--secondary"
          disabled={!side.json}
          onClick={() => {
            if (side.json) downloadSnapshot(filename, side.json);
          }}
        >
          Download snapshot
        </button>
      </div>
    </div>
  );
}

function badgePhase(phase: SideState["phase"]): string {
  if (phase === "done") return "ready";
  if (phase === "running") return "syncing";
  if (phase === "error") return "destroyed";
  return "idle";
}

function describeTarget(
  target: number | null,
  proven: number | undefined,
  proposed: number | undefined,
  snapshotBlock: number | undefined
): string | null {
  if (target == null) return "Target block must be a non-negative integer";
  if (proven == null || proposed == null) {
    return "Still waiting for the proven and proposed tips";
  }
  if (target < proven) return `Target ${target} is below proven ${proven}`;
  if (target > proposed)
    return `Target ${target} is above proposed ${proposed}`;
  if (snapshotBlock != null && snapshotBlock > target) {
    return `Off-chain snapshot block ${snapshotBlock} is above target ${target}. A snapshot cannot be rewound.`;
  }
  return null;
}

async function fetchIndexerLatest(baseUrl: string): Promise<IndexerLatest> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/blocks/latest`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    blockNumber?: unknown;
    snapshotBlock?: unknown;
  };
  if (
    typeof data.blockNumber !== "number" ||
    typeof data.snapshotBlock !== "number"
  ) {
    throw new Error("Response is missing blockNumber or snapshotBlock");
  }
  return { blockNumber: data.blockNumber, snapshotBlock: data.snapshotBlock };
}
