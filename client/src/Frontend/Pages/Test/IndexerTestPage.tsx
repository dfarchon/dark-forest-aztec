/**
 * IndexerConnection test page.
 *
 * Demonstrates the full lifecycle:
 *  1. createIndexerConnection() factory — mirrors createEthConnection()
 *  2. initialize() with syncedToBlock atomicity boundary
 *  3. subscribeToContractEvents(handlers) — domain event stream
 *  4. blockNumber$ reactive stream — real-time block updates
 *  5. Read API — getPlayers, getPlanet, getArrivals, etc.
 *  6. Raw IndexerChangePayload debug view
 */

import "./TestPageStyles.css";

import { START_BLOCK } from "@dfpunk/contracts";
import * as React from "react";

import type { IndexerLifecycle } from "../../../Session/Indexer";
import {
  createIndexerConnection,
  IndexerConnection,
  type IndexerConnectionConfig,
} from "../../../Session/Indexer/IndexerConnection";
import type { WorldState } from "../../../Session/Indexer/TableTypes/chain";
import { TextPreview } from "../../Components/TextPreview";

const NODE_URL =
  typeof import.meta.env.VITE_AZTEC_NODE_URL === "string" &&
  import.meta.env.VITE_AZTEC_NODE_URL.length > 0
    ? import.meta.env.VITE_AZTEC_NODE_URL
    : "http://localhost:8080";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EventLogEntry {
  type: string;
  id?: string;
  from?: string;
  to?: string;
  revealer?: string;
  paused?: boolean;
  block: number;
  timestamp: number;
}

interface BlockHistoryEntry {
  block: number;
  time: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert planet/location ID (decimal or hex string) to 0x-prefixed hex for display. */
function planetIdToHex(s: string): string {
  if (s == null || s === "") return s;
  try {
    const hex = BigInt(s).toString(16);
    return "0x" + hex.toLowerCase();
  } catch {
    return s;
  }
}

const MAX_EVENT_LOG = 50;
const MAX_BLOCK_HISTORY = 20;

function lifecycleBadgeClass(lc: IndexerLifecycle): string {
  const map: Record<IndexerLifecycle, string> = {
    idle: "test-page__badge--idle",
    bootstrapping: "test-page__badge--bootstrapping",
    syncing: "test-page__badge--syncing",
    ready: "test-page__badge--ready",
    live: "test-page__badge--live",
    destroyed: "test-page__badge--destroyed",
  };
  return `test-page__badge ${map[lc] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

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

export function IndexerTestPage() {
  const connRef = React.useRef<IndexerConnection | null>(null);
  const blockSubRef = React.useRef<{ unsubscribe: () => void } | null>(null);
  const unsubEventsRef = React.useRef<(() => void) | null>(null);

  const [lifecycle, setLifecycle] = React.useState<IndexerLifecycle>("idle");
  const [syncedToBlock, setSyncedToBlock] = React.useState<number | null>(null);
  const [currentBlock, setCurrentBlock] = React.useState<number>(0);
  const [blockHistory, setBlockHistory] = React.useState<BlockHistoryEntry[]>(
    []
  );
  const [eventLog, setEventLog] = React.useState<EventLogEntry[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);

  const appendEvent = React.useCallback((entry: EventLogEntry) => {
    setEventLog((prev) => [entry, ...prev].slice(0, MAX_EVENT_LOG));
  }, []);

  React.useEffect(() => {
    let destroyed = false;

    const config: IndexerConnectionConfig = {
      nodeUrl: NODE_URL,
      startBlock: START_BLOCK,
      debounceMs: 1000,
      pollIntervalMs: 2000,
      maxBlocksPerRequest: 100,
    };

    createIndexerConnection(config)
      .then(({ connection, syncedToBlock: synced }) => {
        if (destroyed) {
          connection.destroy();
          return;
        }
        connRef.current = connection;
        setSyncedToBlock(synced);
        setLifecycle(connection.getLifecycle());
        setCurrentBlock(connection.getCurrentBlockNumber());
        setError(null);

        // --- blockNumber$ stream (mirrors EthConnection.blockNumber$) ---
        const blockSub = connection.blockNumber$.subscribe((blockNum) => {
          setCurrentBlock(blockNum);
          setBlockHistory((prev) =>
            [...prev, { block: blockNum, time: Date.now() }].slice(
              -MAX_BLOCK_HISTORY
            )
          );
          setLifecycle(connection.getLifecycle());
          forceRender();
        });

        // --- subscribeToContractEvents (handlers match Aztec storage contract event names 1:1) ---
        const unsubEvents = connection.subscribeToContractEvents({
          WorldUpdate: (worldState: WorldState) => {
            appendEvent({
              type: "WorldUpdate",
              paused: worldState.paused,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          PlayerUpdate: (playerId: string) => {
            appendEvent({
              type: "PlayerUpdate",
              id: playerId,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          PlanetUpdate: (planetId: string) => {
            appendEvent({
              type: "PlanetUpdate",
              id: planetId,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          PlanetRevealedCoordsUpdate: (
            locationId: string,
            revealer: string
          ) => {
            appendEvent({
              type: "PlanetRevealedCoordsUpdate",
              id: locationId,
              revealer,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          PlanetEventsUpdate: (planetId: string) => {
            appendEvent({
              type: "PlanetEventsUpdate",
              id: planetId,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          PlanetArtifactsUpdate: (planetId: string) => {
            appendEvent({
              type: "PlanetArtifactsUpdate",
              id: planetId,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          ArrivalUpdate: (arrivalId: string, from: string, to: string) => {
            appendEvent({
              type: "ArrivalUpdate",
              id: arrivalId,
              from,
              to,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          ArtifactUpdate: (artifactId: string) => {
            appendEvent({
              type: "ArtifactUpdate",
              id: artifactId,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
          ArtifactLocationUpdate: (artifactId: string) => {
            appendEvent({
              type: "ArtifactLocationUpdate",
              id: artifactId,
              block: connection.getCurrentBlockNumber(),
              timestamp: Date.now(),
            });
          },
        });

        // Store teardown references on the ref so cleanup can reach them
        blockSubRef.current = blockSub;
        unsubEventsRef.current = unsubEvents;
      })
      .catch((err) => {
        if (!destroyed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      destroyed = true;
      blockSubRef.current?.unsubscribe();
      unsubEventsRef.current?.();
      blockSubRef.current = null;
      unsubEventsRef.current = null;
      const conn = connRef.current;
      if (conn) {
        conn.destroy();
        connRef.current = null;
      }
    };
  }, [appendEvent]);

  // Derive display data from connection's read API
  const conn = connRef.current;
  const world = conn?.getWorld();
  const worldRadius = conn?.getWorldRadius() ?? 0n;
  const isPaused = conn?.getIsPaused() ?? false;
  const planetIds = conn?.getPlanetIds() ?? [];
  const playerIds = conn?.getPlayerIds() ?? [];
  const arrivalIds = conn?.getArrivalIds() ?? [];

  return (
    <div className="test-page">
      <header className="test-page__header">
        <h1 className="test-page__title">IndexerConnection Demo</h1>
        <nav className="test-page__nav">
          <a href="/">← Home</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/wallet">WalletManager</a>
          <span className="test-page__nav-sep">·</span>
          <a href="/test/tx-executor">TxExecutor</a>
        </nav>
      </header>

      {error && (
        <div className="test-page__error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* 1. Connection Status */}
      <Section title="Connection Status" defaultOpen={true}>
        <div className="test-page__stats">
          <div className="test-page__stat">
            <div className="test-page__stat-label">Lifecycle</div>
            <div className="test-page__stat-value">
              <span className={lifecycleBadgeClass(lifecycle)}>
                {lifecycle}
              </span>
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">syncedToBlock</div>
            <div className="test-page__stat-value">{syncedToBlock ?? "—"}</div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Current block</div>
            <div className="test-page__stat-value">{currentBlock || "—"}</div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">World radius</div>
            <div className="test-page__stat-value">
              {conn && world ? String(worldRadius) : "—"}
            </div>
          </div>
          <div className="test-page__stat">
            <div className="test-page__stat-label">Paused</div>
            <div className="test-page__stat-value">
              {isPaused ? "Yes" : "No"}
            </div>
          </div>
        </div>
      </Section>

      {/* 2. Block Stream (blockNumber$) */}
      <Section title="Block Stream (blockNumber$)" defaultOpen={true}>
        {blockHistory.length === 0 ? (
          <div className="test-page__empty">Waiting for live blocks…</div>
        ) : (
          <div className="test-page__block-pills">
            {blockHistory.map((entry, i) => (
              <span key={i} className="test-page__block-pill">
                #{entry.block}
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* 3. World State */}
      <Section title="World State" defaultOpen={true}>
        {world ? (
          <div className="test-page__stats">
            <div className="test-page__stat">
              <div className="test-page__stat-label">paused</div>
              <div className="test-page__stat-value">
                {world.paused ? "Yes" : "No"}
              </div>
            </div>
            <div className="test-page__stat">
              <div className="test-page__stat-label">radius</div>
              <div className="test-page__stat-value">
                {String(world.radius)}
              </div>
            </div>
            <div className="test-page__stat">
              <div className="test-page__stat-label">next_change_block</div>
              <div className="test-page__stat-value">
                {world.next_change_block}
              </div>
            </div>
            <div className="test-page__stat">
              <div className="test-page__stat-label">planet_ids_count</div>
              <div className="test-page__stat-value">
                {String(world.planet_ids_count)}
              </div>
            </div>
            <div className="test-page__stat">
              <div className="test-page__stat-label">player_ids_count</div>
              <div className="test-page__stat-value">
                {String(world.player_ids_count)}
              </div>
            </div>
            <div className="test-page__stat">
              <div className="test-page__stat-label">planet_events_count</div>
              <div className="test-page__stat-value">
                {world.planet_events_count}
              </div>
            </div>
            <div className="test-page__stat">
              <div className="test-page__stat-label">
                revealed_planet_ids_count
              </div>
              <div className="test-page__stat-value">
                {String(world.revealed_planet_ids_count)}
              </div>
            </div>
          </div>
        ) : (
          <div className="test-page__empty">No data yet…</div>
        )}
      </Section>

      {/* 4. Players */}
      <Section title="Players" defaultOpen={true}>
        {playerIds.length === 0 ? (
          <div className="test-page__empty">No data yet…</div>
        ) : (
          <>
            <div className="test-page__table-count">
              Total: {playerIds.length} rows
            </div>
            <div className="test-page__table-wrap">
              <table className="test-page__table">
                <thead>
                  <tr>
                    <th>id (address)</th>
                    <th>score</th>
                    <th>home_planet_id</th>
                    <th>space_junk</th>
                  </tr>
                </thead>
                <tbody>
                  {playerIds.map((id) => {
                    const pl = conn?.getPlayer(id);
                    if (!pl) return null;
                    return (
                      <tr key={id}>
                        <td>
                          <TextPreview
                            text={id}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>{String(pl.score)}</td>
                        <td>
                          <TextPreview
                            text={planetIdToHex(pl.home_planet_id)}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>{String(pl.space_junk)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* 5. Planets */}
      <Section title="Planets" defaultOpen={true}>
        {planetIds.length === 0 ? (
          <div className="test-page__empty">No data yet…</div>
        ) : (
          <>
            <div className="test-page__table-count">
              Total: {planetIds.length} rows
            </div>
            <div className="test-page__table-wrap">
              <table className="test-page__table">
                <thead>
                  <tr>
                    <th>id</th>
                    <th>owner</th>
                    <th>population</th>
                    <th>silver</th>
                    <th>planet_level</th>
                    <th>planet_type</th>
                  </tr>
                </thead>
                <tbody>
                  {planetIds.map((id) => {
                    const p = conn?.getPlanet(id);
                    if (!p) return null;
                    return (
                      <tr key={id}>
                        <td>
                          <TextPreview
                            text={planetIdToHex(id)}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>
                          <TextPreview
                            text={p.owner}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>{String(p.population)}</td>
                        <td>{String(p.silver)}</td>
                        <td>{p.planet_level}</td>
                        <td>{p.planet_type}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* 6. Arrivals */}
      <Section title="Arrivals" defaultOpen={true}>
        {arrivalIds.length === 0 ? (
          <div className="test-page__empty">No data yet…</div>
        ) : (
          <>
            <div className="test-page__table-count">
              Total: {arrivalIds.length} rows
            </div>
            <div className="test-page__table-wrap">
              <table className="test-page__table">
                <thead>
                  <tr>
                    <th>id</th>
                    <th>from_planet</th>
                    <th>to_planet</th>
                    <th>pop_arriving</th>
                    <th>arrival_time</th>
                  </tr>
                </thead>
                <tbody>
                  {arrivalIds.map((id) => {
                    const a = conn?.getArrival(id);
                    if (!a) return null;
                    return (
                      <tr key={id}>
                        <td>
                          <TextPreview
                            text={a.id}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>
                          <TextPreview
                            text={planetIdToHex(a.from_planet)}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>
                          <TextPreview
                            text={planetIdToHex(a.to_planet)}
                            unFocusedWidth="120px"
                            focusedWidth="200px"
                          />
                        </td>
                        <td>{String(a.pop_arriving)}</td>
                        <td>{String(a.arrival_time)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {/* 7. Event Log (subscribeToContractEvents) */}
      <Section title="Event Log (subscribeToContractEvents)" defaultOpen={true}>
        {eventLog.length === 0 ? (
          <div className="test-page__empty">
            No domain events yet. Waiting for live updates…
          </div>
        ) : (
          <div
            className="test-page__table-wrap"
            style={{ maxHeight: "320px", overflowY: "auto" }}
          >
            <table className="test-page__table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>ID</th>
                  <th>Details</th>
                  <th>Block</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {eventLog.map((e, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{e.type}</td>
                    <td>
                      {e.id ? (
                        <TextPreview
                          text={planetIdToHex(e.id)}
                          unFocusedWidth="120px"
                          focusedWidth="200px"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ fontSize: "0.85rem" }}>
                      {e.from && e.to ? (
                        <>
                          <TextPreview
                            text={planetIdToHex(e.from)}
                            unFocusedWidth="80px"
                            focusedWidth="160px"
                          />{" "}
                          →{" "}
                          <TextPreview
                            text={planetIdToHex(e.to)}
                            unFocusedWidth="80px"
                            focusedWidth="160px"
                          />
                        </>
                      ) : e.revealer ? (
                        <>
                          by{" "}
                          <TextPreview
                            text={e.revealer}
                            unFocusedWidth="80px"
                            focusedWidth="160px"
                          />
                        </>
                      ) : e.paused !== undefined ? (
                        `paused=${String(e.paused)}`
                      ) : (
                        ""
                      )}
                    </td>
                    <td>#{e.block}</td>
                    <td style={{ fontSize: "0.8rem" }}>
                      {new Date(e.timestamp).toLocaleTimeString()}
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
