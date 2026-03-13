/**
 * TxExecutor test page.
 *
 * Demonstrates the full lifecycle:
 *  1. Initializes WalletManager + IndexerConnection + AztecNode + ConfigContract
 *     and creates a shared ConfigCache
 *  2. Creates TxExecutor with lifecycle hooks
 *  3. Submit transactions (initializePlayer, move, raw JSON)
 *  4. Track transaction state transitions in real-time
 *  5. Diagnostics (queue size, total transactions)
 */

import "./TestPageStyles.css";

import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { AztecNode } from "@aztec/aztec.js/node";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { CONFIG_CONTRACT_ADDRESS, START_BLOCK } from "@dfpunk/contracts";
import { ConfigContract } from "@dfpunk/contracts/artifacts/Config";
import type { ClientTxStatus, Transaction, TxIntent } from "@dfpunk/types";
import * as React from "react";

import { ChainClock } from "../../../Backend/Utils/ChainClock";
import {
  getEffectiveIndexerBootstrapUrl,
  getEffectiveNodeUrl,
} from "../../../config/connection";
import { getProverEnabled } from "../../../config/env";
import type { IndexerConnection } from "../../../Session/Indexer/IndexerConnection";
import {
  createIndexerConnection,
  type IndexerConnectionConfig,
} from "../../../Session/Indexer/IndexerConnection";
import {
  type AfterTransaction,
  type BeforeQueued,
  ConfigCache,
  type Diagnostics,
  TxExecutor,
} from "../../../Session/TxExecutor";
import {
  createWalletManager,
  type WalletManager,
} from "../../../Session/WalletManager";
import { TextPreview } from "../../Components/TextPreview";

const MAX_TX_LOG = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TxLogEntry {
  id: number;
  methodName: string;
  state: ClientTxStatus;
  hash?: string;
  error?: string;
  queuedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TX_STATE_BADGE_MAP: Record<ClientTxStatus, string> = {
  Init: "test-page__badge--idle",
  Processing: "test-page__badge--syncing",
  Prioritized: "test-page__badge--syncing",
  Submit: "test-page__badge--ready",
  Confirm: "test-page__badge--success",
  Fail: "test-page__badge--destroyed",
  Cancel: "test-page__badge--idle",
};

function txStateBadgeClass(state: ClientTxStatus): string {
  const badgeClass = TX_STATE_BADGE_MAP[state] ?? "";
  return `test-page__badge ${badgeClass}`;
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, children, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="test-page__section">
      <button
        type="button"
        className="test-page__section-header"
        onClick={() => setOpen((o) => !o)}
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

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export function TxExecutorTestPage() {
  // Refs for long-lived instances
  const walletMgrRef = React.useRef<WalletManager | null>(null);
  const indexerRef = React.useRef<IndexerConnection | null>(null);
  const nodeRef = React.useRef<AztecNode | null>(null);
  const executorRef = React.useRef<TxExecutor | null>(null);
  // Keep live Transaction refs for cancel/prioritize
  const liveTxsRef = React.useRef<Map<number, Transaction>>(new Map());

  // UI state
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<string | null>(null);
  const [initStep, setInitStep] = React.useState<string | null>(null);
  const [activeAddress, setActiveAddress] = React.useState<
    string | undefined
  >();

  // Diagnostics
  const [diagnostics, setDiagnostics] = React.useState<Diagnostics>({
    transactionsInQueue: 0,
    totalTransactions: 0,
  });

  // Transaction log
  const [txLog, setTxLog] = React.useState<TxLogEntry[]>([]);

  // Form: initializePlayer
  const [initX, setInitX] = React.useState("");
  const [initY, setInitY] = React.useState("");
  const [initRadius, setInitRadius] = React.useState("");
  const [initLocId, setInitLocId] = React.useState("");
  const [initPerlin, setInitPerlin] = React.useState("");
  const [initLevel, setInitLevel] = React.useState("");

  // Form: move
  const [moveSrcLoc, setMoveSrcLoc] = React.useState("");
  const [moveTgtLoc, setMoveTgtLoc] = React.useState("");
  const [moveTgtPerlin, setMoveTgtPerlin] = React.useState("");
  const [moveTgtLevel, setMoveTgtLevel] = React.useState("");
  const [moveMaxDist, setMoveMaxDist] = React.useState("");
  const [moveX1, setMoveX1] = React.useState("");
  const [moveY1, setMoveY1] = React.useState("");
  const [moveX2, setMoveX2] = React.useState("");
  const [moveY2, setMoveY2] = React.useState("");
  const [moveForces, setMoveForces] = React.useState("");
  const [moveSilver, setMoveSilver] = React.useState("");
  const [moveAbandoning, setMoveAbandoning] = React.useState(false);

  // Form: raw JSON
  const [rawJson, setRawJson] = React.useState("");

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  React.useEffect(() => {
    let destroyed = false;

    async function init() {
      // 1. WalletManager
      setInitStep("Creating WalletManager…");
      const walletMgr = await createWalletManager({
        nodeUrl: getEffectiveNodeUrl(),
        storagePrefix: "dfpunk",
        balancePollIntervalMs: 15_000,
        pxeConfig: {
          proverEnabled: getProverEnabled(),
        },
      });
      if (destroyed) {
        walletMgr.destroy();
        return;
      }
      walletMgrRef.current = walletMgr;

      if (!walletMgr.hasActiveAccount()) {
        setError(
          "No active account. Create one on the WalletManager test page first."
        );
        setInitStep(null);
        return;
      }
      setActiveAddress(walletMgr.getActiveAddress()?.toString());

      // 2. IndexerConnection
      setInitStep("Creating IndexerConnection…");
      const indexerConfig: IndexerConnectionConfig = {
        nodeUrl: getEffectiveNodeUrl(),
        startBlock: START_BLOCK,
        debounceMs: 1000,
        pollIntervalMs: 2000,
        maxBlocksPerRequest: 100,
      };
      const bootstrapUrl = getEffectiveIndexerBootstrapUrl();
      if (bootstrapUrl) indexerConfig.bootstrapUrl = bootstrapUrl;
      const { connection } = await createIndexerConnection(indexerConfig);
      if (destroyed) {
        connection.destroy();
        walletMgr.destroy();
        return;
      }
      indexerRef.current = connection;

      // 3. AztecNode client (separate from WalletManager's private node)
      setInitStep("Connecting to Aztec node…");
      const node = createAztecNodeClient(getEffectiveNodeUrl());
      nodeRef.current = node;

      // 4. ConfigContract
      const wallet = walletMgr.getWallet();
      const configContract = ConfigContract.at(
        AztecAddress.fromString(CONFIG_CONTRACT_ADDRESS),
        wallet
      );

      // 5. TxExecutor
      setInitStep("Creating TxExecutor…");
      const beforeQueued: BeforeQueued = async (id, intent) => {
        setTxLog((prev) =>
          [
            {
              id,
              methodName: intent.methodName,
              state: "Init" as const,
              queuedAt: Date.now(),
            },
            ...prev,
          ].slice(0, MAX_TX_LOG)
        );
      };
      const afterTransaction: AfterTransaction = async (tx, metrics) => {
        const m = metrics as Record<string, unknown>;
        const txId = tx.id;
        setTxLog((prev) =>
          prev.map((e) =>
            e.id === txId
              ? {
                  ...e,
                  state: tx.state,
                  hash: tx.hash?.toString(),
                  error: m?.error as string | undefined,
                }
              : e
          )
        );
      };

      const chainClock = new ChainClock(node);
      await chainClock.syncFromNode();

      const configCache = new ConfigCache(
        configContract,
        walletMgr.getActiveAddress()!
      );
      const executor = new TxExecutor(
        walletMgr,
        connection,
        node,
        configCache,
        chainClock,
        beforeQueued,
        undefined,
        afterTransaction
      );
      executor.setDiagnosticUpdater({
        updateDiagnostics: (fn) => {
          setDiagnostics((prev) => {
            const d = { ...prev };
            fn(d);
            return d;
          });
        },
      });
      executorRef.current = executor;

      setReady(true);
      setInitStep(null);
    }

    init().catch((err) => {
      if (!destroyed) {
        setError(err instanceof Error ? err.message : String(err));
        setInitStep(null);
      }
    });

    return () => {
      destroyed = true;
      executorRef.current?.destroy();
      indexerRef.current?.destroy();
      walletMgrRef.current?.destroy();
      executorRef.current = null;
      indexerRef.current = null;
      walletMgrRef.current = null;
      nodeRef.current = null;
      setReady(false);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const submitIntent = async (intent: TxIntent) => {
    const executor = executorRef.current;
    if (!executor) return;
    setLoading("Submitting…");
    setError(null);
    try {
      const tx = await executor.queueTransaction(intent);
      liveTxsRef.current.set(tx.id, tx);

      const txId = tx.id;
      tx.submittedPromise
        .then((hash) => {
          setTxLog((prev) =>
            prev.map((e) =>
              e.id === txId
                ? { ...e, state: "Submit", hash: hash.toString() }
                : e
            )
          );
        })
        .catch(() => {});

      tx.confirmedPromise
        .then(() => {
          setTxLog((prev) =>
            prev.map((e) => (e.id === txId ? { ...e, state: "Confirm" } : e))
          );
        })
        .catch((err: unknown) => {
          setTxLog((prev) =>
            prev.map((e) =>
              e.id === txId
                ? {
                    ...e,
                    state: "Fail",
                    error: err instanceof Error ? err.message : String(err),
                  }
                : e
            )
          );
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  };

  const handleSubmitInit = () => {
    submitIntent({
      methodName: "initializePlayer",
      locationId: initLocId,
      location: { x: Number(initX), y: Number(initY) },
      args: [
        BigInt(initX || "0"),
        BigInt(initY || "0"),
        BigInt(initRadius || "0"),
        BigInt(initLocId || "0"),
        BigInt(initPerlin || "0"),
        BigInt(initLevel || "0"),
      ],
    } as TxIntent);
  };

  const handleFillInitDummy = () => {
    setInitX("0");
    setInitY("0");
    setInitRadius("0");
    // locationId must have bytes 4-6 (BE) in level-0 range [4_194_292, 16_777_216). Same formula as test-core-initialize-player.
    const level0LocId = (10_000_000n << 216n) | (255n << 64n);
    setInitLocId(level0LocId.toString());
    setInitPerlin("13");
    setInitLevel("0");
  };

  const handleSubmitMove = () => {
    submitIntent({
      methodName: "move",
      from: moveSrcLoc,
      to: moveTgtLoc,
      forces: Number(moveForces || "0"),
      silver: Number(moveSilver || "0"),
      abandoning: moveAbandoning,
      args: [
        BigInt(moveSrcLoc || "0"),
        BigInt(moveTgtLoc || "0"),
        BigInt(moveTgtPerlin || "0"),
        BigInt(moveTgtLevel || "0"),
        BigInt(moveMaxDist || "0"),
        BigInt(moveX1 || "0"),
        BigInt(moveY1 || "0"),
        BigInt(moveX2 || "0"),
        BigInt(moveY2 || "0"),
      ],
    } as TxIntent);
  };

  const handleFillMoveDummy = () => {
    setMoveSrcLoc("100");
    setMoveTgtLoc("200");
    setMoveTgtPerlin("10");
    setMoveTgtLevel("0");
    setMoveMaxDist("100000");
    setMoveX1("100");
    setMoveY1("200");
    setMoveX2("300");
    setMoveY2("400");
    setMoveForces("50");
    setMoveSilver("0");
    setMoveAbandoning(false);
  };

  const handleSubmitRaw = () => {
    try {
      const parsed = JSON.parse(rawJson) as TxIntent;
      if (!parsed.methodName) {
        setError("Missing methodName");
        return;
      }
      submitIntent(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCancel = (id: number) => {
    const tx = liveTxsRef.current.get(id);
    if (tx && executorRef.current) {
      executorRef.current.dequeueTransaction(tx);
      setTxLog((prev) =>
        prev.map((e) => (e.id === id ? { ...e, state: "Cancel" } : e))
      );
    }
  };

  const handlePrioritize = (id: number) => {
    const tx = liveTxsRef.current.get(id);
    if (tx && executorRef.current) {
      executorRef.current.prioritizeTransaction(tx);
      setTxLog((prev) =>
        prev.map((e) => (e.id === id ? { ...e, state: "Prioritized" } : e))
      );
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="test-page">
      <header className="test-page__header">
        <h1 className="test-page__title">TxExecutor Demo</h1>
        <nav className="test-page__nav">
          <a href="/">← Home</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/indexer">Indexer</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/wallet">Wallet</a>
        </nav>
      </header>

      {error && (
        <div className="test-page__error">
          <strong>Error:</strong> {error}
        </div>
      )}
      {(loading || initStep) && (
        <div className="test-page__loading">{loading || initStep}</div>
      )}

      {/* 1. Connection Status */}
      <Section title="Connection Status">
        <div className="test-page__stats">
          <div className="test-page__stat">
            <div className="test-page__stat-label">Node URL</div>
            <div className="test-page__stat-value">
              <code style={{ fontSize: "0.85rem" }}>
                {getEffectiveNodeUrl()}
              </code>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">TxExecutor</div>
            <div className="test-page__stat-value">
              <span
                className={`test-page__badge ${ready ? "test-page__badge--success" : "test-page__badge--idle"}`}
              >
                {ready ? "Ready" : "Not ready"}
              </span>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Active address</div>
            <div className="test-page__stat-value">
              {activeAddress ? (
                <TextPreview
                  text={activeAddress}
                  unFocusedWidth="120px"
                  focusedWidth="200px"
                />
              ) : (
                "—"
              )}
            </div>
          </div>
        </div>
      </Section>

      {/* 2. Diagnostics */}
      <Section title="Diagnostics">
        <div className="test-page__stats">
          <div className="test-page__stat">
            <div className="test-page__stat-label">In queue</div>
            <div className="test-page__stat-value">
              {diagnostics.transactionsInQueue}
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Total processed</div>
            <div className="test-page__stat-value">
              {diagnostics.totalTransactions}
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Queue size (live)</div>
            <div className="test-page__stat-value">
              {executorRef.current?.getQueueSize() ?? 0}
            </div>
          </div>
        </div>
      </Section>

      {/* 3. Submit: initializePlayer */}
      <Section title="Submit: initializePlayer">
        <div className="test-page__form-group">
          <label className="test-page__form-label">x</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={initX}
            onChange={(e) => setInitX(e.target.value)}
            placeholder="100"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">y</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={initY}
            onChange={(e) => setInitY(e.target.value)}
            placeholder="200"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">radius</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={initRadius}
            onChange={(e) => setInitRadius(e.target.value)}
            placeholder="50000"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">locationId</label>
          <input
            type="text"
            className="test-page__form-input"
            value={initLocId}
            onChange={(e) => setInitLocId(e.target.value)}
            placeholder="999"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">perlin</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={initPerlin}
            onChange={(e) => setInitPerlin(e.target.value)}
            placeholder="15"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">level</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={initLevel}
            onChange={(e) => setInitLevel(e.target.value)}
            placeholder="0"
          />
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="test-page__btn test-page__btn--secondary"
            onClick={handleFillInitDummy}
          >
            Fill dummy
          </button>
          <button
            type="button"
            className="test-page__btn test-page__btn--primary"
            onClick={handleSubmitInit}
            disabled={!ready || !!loading}
          >
            Submit initializePlayer
          </button>
        </div>
      </Section>

      {/* 4. Submit: move */}
      <Section title="Submit: move" defaultOpen={false}>
        <div className="test-page__form-group">
          <label className="test-page__form-label">sourceLoc</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveSrcLoc}
            onChange={(e) => setMoveSrcLoc(e.target.value)}
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">targetLoc</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveTgtLoc}
            onChange={(e) => setMoveTgtLoc(e.target.value)}
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">targetPerlin</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveTgtPerlin}
            onChange={(e) => setMoveTgtPerlin(e.target.value)}
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">targetLevel</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveTgtLevel}
            onChange={(e) => setMoveTgtLevel(e.target.value)}
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">maxDist</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveMaxDist}
            onChange={(e) => setMoveMaxDist(e.target.value)}
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">x1, y1</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              className="test-page__form-input test-page__form-input--short"
              value={moveX1}
              onChange={(e) => setMoveX1(e.target.value)}
              placeholder="x1"
            />
            <input
              type="text"
              className="test-page__form-input test-page__form-input--short"
              value={moveY1}
              onChange={(e) => setMoveY1(e.target.value)}
              placeholder="y1"
            />
          </div>
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">x2, y2</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              className="test-page__form-input test-page__form-input--short"
              value={moveX2}
              onChange={(e) => setMoveX2(e.target.value)}
              placeholder="x2"
            />
            <input
              type="text"
              className="test-page__form-input test-page__form-input--short"
              value={moveY2}
              onChange={(e) => setMoveY2(e.target.value)}
              placeholder="y2"
            />
          </div>
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">forces</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveForces}
            onChange={(e) => setMoveForces(e.target.value)}
            placeholder="50"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">silver</label>
          <input
            type="text"
            className="test-page__form-input test-page__form-input--short"
            value={moveSilver}
            onChange={(e) => setMoveSilver(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="test-page__form-group">
          <label className="test-page__form-label">
            <input
              type="checkbox"
              checked={moveAbandoning}
              onChange={(e) => setMoveAbandoning(e.target.checked)}
            />{" "}
            abandoning
          </label>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="test-page__btn test-page__btn--secondary"
            onClick={handleFillMoveDummy}
          >
            Fill dummy
          </button>
          <button
            type="button"
            className="test-page__btn test-page__btn--primary"
            onClick={handleSubmitMove}
            disabled={!ready || !!loading}
          >
            Submit move
          </button>
        </div>
      </Section>

      {/* 5. Submit: Raw JSON */}
      <Section title="Submit: Raw JSON" defaultOpen={false}>
        <div className="test-page__form-group">
          <label className="test-page__form-label">TxIntent JSON</label>
          <textarea
            className="test-page__form-input"
            rows={5}
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            placeholder={
              '{"methodName":"initializePlayer","args":[0,0,0,0,0,0]}'
            }
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </div>
        <button
          type="button"
          className="test-page__btn test-page__btn--primary"
          onClick={handleSubmitRaw}
          disabled={!ready || !!loading || !rawJson.trim()}
        >
          Submit raw intent
        </button>
      </Section>

      {/* 6. Transaction Log */}
      <Section title="Transaction Log">
        {txLog.length === 0 ? (
          <div className="test-page__empty">No transactions yet.</div>
        ) : (
          <div className="test-page__table-wrap">
            <table className="test-page__table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Method</th>
                  <th>State</th>
                  <th>Hash</th>
                  <th>Time</th>
                  <th>Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {txLog.map((entry) => (
                  <tr key={`${entry.id}-${entry.queuedAt}`}>
                    <td>{entry.id}</td>
                    <td>
                      <code>{entry.methodName}</code>
                    </td>
                    <td>
                      <span className={txStateBadgeClass(entry.state)}>
                        {entry.state}
                      </span>
                    </td>
                    <td>
                      {entry.hash ? (
                        <TextPreview
                          text={entry.hash}
                          unFocusedWidth="120px"
                          focusedWidth="200px"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{new Date(entry.queuedAt).toLocaleTimeString()}</td>
                    <td
                      style={{
                        color: "var(--color-error, #e74c3c)",
                        maxWidth: "200px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {entry.error ?? ""}
                    </td>
                    <td>
                      {(entry.state === "Init" ||
                        entry.state === "Prioritized") && (
                        <>
                          <button
                            type="button"
                            className="test-page__btn test-page__btn--secondary"
                            onClick={() => handlePrioritize(entry.id)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="test-page__btn test-page__btn--danger"
                            onClick={() => handleCancel(entry.id)}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
