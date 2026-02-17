import { useState } from "react";
import { useIndexer } from "../contexts/IndexerContext";

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
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <button
        type="button"
        onClick={() => setOpen((o: boolean) => !o)}
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

export default function IndexerPage() {
  const {
    status,
    world,
    getPlanet,
    getPlanetIds,
    getPlayer,
    getPlayerIds,
    getArrival,
    getArrivalIds,
  } = useIndexer();

  const planetIds = getPlanetIds();
  const playerIds = getPlayerIds();
  const arrivalIds = getArrivalIds();

  return (
    <div style={{ textAlign: "left", maxWidth: "960px" }}>
      <h1>Indexer live data</h1>

      <Section title="Sync status" defaultOpen={true}>
        <div className="card" style={{ padding: "1rem" }}>
          <p>
            <strong>Syncing:</strong> {status.isSyncing ? "Yes" : "No"}
          </p>
          <p>
            <strong>Last processed block:</strong> {status.lastProcessedBlock}
          </p>
          <p>
            <strong>Latest known block:</strong> {status.latestKnownBlock}
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
                    const p = getPlanet(id);
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

      <Section title="Players" defaultOpen={false}>
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
                    const pl = getPlayer(id);
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

      <Section title="Arrivals" defaultOpen={false}>
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
                    const a = getArrival(id);
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
    </div>
  );
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
