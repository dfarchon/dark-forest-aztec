/**
 * Indexer test page: uses IndexerService via class initialization (no useContext).
 * Holds instance in useRef, start/destroy in useEffect, subscribe() → setState for UI updates.
 * Layout and sections mirror aztec-client-v0 IndexerPage.
 */

import { START_BLOCK } from "@dfpunk/contracts";
import * as React from "react";

import {
  createAztecNodeBlockSource,
  type IndexerChangePayload,
  IndexerService,
  type IndexerStatus,
} from "../../../Session/Indexer";

const NODE_URL =
  typeof import.meta.env.VITE_AZTEC_NODE_URL === "string" &&
  import.meta.env.VITE_AZTEC_NODE_URL.length > 0
    ? import.meta.env.VITE_AZTEC_NODE_URL
    : "http://localhost:8080";

function truncate(str: string, head = 8, tail = 6): string {
  if (str.length <= head + tail) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
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
    <section style={{ marginBottom: "1.5rem" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "0.5rem 0",
          fontWeight: "bold",
          background: "none",
          border: "none",
          cursor: "pointer",
        }}
      >
        {open ? "▼ " : "▶ "}
        {title}
      </button>
      {open ? children : null}
    </section>
  );
}

function JsonTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  if (data === null || data === undefined)
    return <span style={{ color: "#999" }}>null</span>;
  if (typeof data === "boolean")
    return <span style={{ color: "#b35e14" }}>{String(data)}</span>;
  if (typeof data === "number")
    return <span style={{ color: "#b35e14" }}>{data}</span>;
  if (typeof data === "string")
    return <span style={{ color: "#2a7e4f" }}>"{data}"</span>;

  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: "#999" }}>[]</span>;
    return (
      <div style={{ paddingLeft: depth > 0 ? "1.2rem" : 0 }}>
        {data.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "0.4rem" }}>
            <span style={{ color: "#999", flexShrink: 0 }}>{i}:</span>
            <JsonTree data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0)
      return <span style={{ color: "#999" }}>{"{}"}</span>;
    return (
      <div style={{ paddingLeft: depth > 0 ? "1.2rem" : 0 }}>
        {entries.map(([key, val]) => (
          <div key={key} style={{ display: "flex", gap: "0.4rem" }}>
            <span style={{ color: "#1a6fb5", flexShrink: 0 }}>{key}:</span>
            <JsonTree data={val} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  return <span>{String(data)}</span>;
}

const thStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.35rem 0.5rem",
  textAlign: "left",
};
const tdStyle: React.CSSProperties = {
  border: "1px solid #ccc",
  padding: "0.35rem 0.5rem",
};

function createIndexer(): IndexerService {
  const source = createAztecNodeBlockSource(NODE_URL);
  return new IndexerService({
    source,
    startBlock: START_BLOCK,
    debounceMs: 1000,
    pollIntervalMs: 2000,
    maxBlocksPerRequest: 100,
  });
}

export function IndexerTestPage() {
  const indexerRef = React.useRef<IndexerService | null>(null);
  const [status, setStatus] = React.useState<IndexerStatus | null>(null);
  const [lastPayload, setLastPayload] =
    React.useState<IndexerChangePayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!indexerRef.current) {
      indexerRef.current = createIndexer();
    }
    const indexer = indexerRef.current;

    const unsubscribe = indexer.subscribe((payload) => {
      setStatus(indexer.getStatus());
      if (payload.tables.length > 0) {
        setLastPayload(payload);
      }
    });

    indexer
      .start()
      .then(() => {
        setError(null);
        setStatus(indexer.getStatus());
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      unsubscribe();
      indexer.destroy();
      indexerRef.current = null;
    };
  }, []);

  const indexer = indexerRef.current;
  const world = indexer ? indexer.getWorld() : undefined;
  const planetIds = indexer ? indexer.getPlanetIds() : [];
  const playerIds = indexer ? indexer.getPlayerIds() : [];
  const arrivalIds = indexer ? indexer.getArrivalIds() : [];

  return (
    <div style={{ textAlign: "left", maxWidth: "960px" }}>
      <h1>Indexer live data</h1>
      <p>
        <a href="/">← Back to home</a>
      </p>

      {error && (
        <div style={{ color: "red", marginBottom: "1rem" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <Section title="Sync status" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem" }}>
          <p>
            <strong>Syncing:</strong> {status?.isSyncing ? "Yes" : "No"}
          </p>
          <p>
            <strong>Last processed block:</strong>{" "}
            {status?.lastProcessedBlock ?? "—"}
          </p>
          <p>
            <strong>Latest known block:</strong>{" "}
            {status?.latestKnownBlock ?? "—"}
          </p>
        </div>
      </Section>

      <Section title="World" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem" }}>
          {world ? (
            <>
              <p>
                <strong>paused:</strong> {world.paused ? "Yes" : "No"}
              </p>
              <p>
                <strong>radius:</strong> {world.radius}
              </p>
              <p>
                <strong>next_change_block:</strong> {world.next_change_block}
              </p>
              <p>
                <strong>planet_ids_count:</strong> {world.planet_ids_count}
              </p>
              <p>
                <strong>player_ids_count:</strong> {world.player_ids_count}
              </p>
            </>
          ) : (
            <p>No data or syncing…</p>
          )}
        </div>
      </Section>

      <Section title="Planets" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem", overflowX: "auto" }}>
          {planetIds.length === 0 ? (
            <p>No data or syncing…</p>
          ) : (
            <>
              <p>Total: {planetIds.length} rows</p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>id</th>
                    <th style={thStyle}>owner</th>
                    <th style={thStyle}>population</th>
                    <th style={thStyle}>silver</th>
                    <th style={thStyle}>planet_level</th>
                    <th style={thStyle}>planet_type</th>
                  </tr>
                </thead>
                <tbody>
                  {planetIds.map((id) => {
                    const p = indexer?.getPlanet(id);
                    if (!p) return null;
                    return (
                      <tr key={id}>
                        <td style={tdStyle}>{truncate(id)}</td>
                        <td style={tdStyle}>{truncate(p.owner)}</td>
                        <td style={tdStyle}>{p.population}</td>
                        <td style={tdStyle}>{p.silver}</td>
                        <td style={tdStyle}>{p.planet_level}</td>
                        <td style={tdStyle}>{p.planet_type}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Section>

      <Section title="Players" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem", overflowX: "auto" }}>
          {playerIds.length === 0 ? (
            <p>No data or syncing…</p>
          ) : (
            <>
              <p>Total: {playerIds.length} rows</p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>id (address)</th>
                    <th style={thStyle}>score</th>
                    <th style={thStyle}>home_planet_id</th>
                  </tr>
                </thead>
                <tbody>
                  {playerIds.map((id) => {
                    const pl = indexer?.getPlayer(id);
                    if (!pl) return null;
                    return (
                      <tr key={id}>
                        <td style={tdStyle}>{truncate(id)}</td>
                        <td style={tdStyle}>{pl.score}</td>
                        <td style={tdStyle}>{truncate(pl.home_planet_id)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Section>

      <Section title="Arrivals" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem", overflowX: "auto" }}>
          {arrivalIds.length === 0 ? (
            <p>No data or syncing…</p>
          ) : (
            <>
              <p>Total: {arrivalIds.length} rows</p>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>id</th>
                    <th style={thStyle}>from_planet</th>
                    <th style={thStyle}>to_planet</th>
                    <th style={thStyle}>pop_arriving</th>
                    <th style={thStyle}>arrival_time</th>
                  </tr>
                </thead>
                <tbody>
                  {arrivalIds.map((id) => {
                    const a = indexer?.getArrival(id);
                    if (!a) return null;
                    return (
                      <tr key={id}>
                        <td style={tdStyle}>{truncate(a.id)}</td>
                        <td style={tdStyle}>{truncate(a.from_planet)}</td>
                        <td style={tdStyle}>{truncate(a.to_planet)}</td>
                        <td style={tdStyle}>{a.pop_arriving}</td>
                        <td style={tdStyle}>{a.arrival_time}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </Section>

      <Section title="Last change payload" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem" }}>
          {lastPayload ? (
            <div
              style={{
                background: "#f5f5f5",
                color: "#333",
                padding: "0.75rem 1rem",
                borderRadius: "6px",
                fontFamily:
                  "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
                fontSize: "0.8rem",
                lineHeight: 1.6,
                overflowX: "auto",
                textAlign: "left",
              }}
            >
              <JsonTree data={lastPayload} />
            </div>
          ) : (
            <p>No updates yet.</p>
          )}
        </div>
      </Section>
    </div>
  );
}
