/**
 * Admin Controls — Pause, unpause, game speed, give planet.
 * Embedded plugin for dfpunk-aztec. Uses only globals df + ui; single CDN for Preact/htm.
 * Aligned with client (GameManager/GameUIManager) and contract (pause, unpause, set_owner, set_world_config).
 */

import {
  html,
  render,
  useEffect,
  useState,
  useCallback,
} from "https://unpkg.com/htm/preact/standalone.module.js";

// ---------------------------------------------------------------------------
// Inline helpers (no @dfares packages)
// ---------------------------------------------------------------------------
const PlanetType = {
  PLANET: 0,
  SILVER_MINE: 1,
  RUINS: 2,
  TRADING_POST: 3,
  SILVER_BANK: 4,
};
const PlanetTypeNames = {
  [PlanetType.PLANET]: "Planet",
  [PlanetType.SILVER_MINE]: "Asteroid Field",
  [PlanetType.RUINS]: "Foundry",
  [PlanetType.TRADING_POST]: "Spacetime Rip",
  [PlanetType.SILVER_BANK]: "Quasar",
};

function getPlanetLabel(planetId) {
  if (!planetId) return "(none)";
  const s = String(planetId);
  return s.length > 12 ? s.slice(0, 12) + "…" : s;
}

const SPEED_MIN = 1;
const SPEED_MAX = 6000;
function clampSpeed(v) {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(Number(v))));
}
function formatSpeedMultiplier(hundredths) {
  return (hundredths / 100).toFixed(2).replace(/\.?0+$/, "") + "x";
}

// ---------------------------------------------------------------------------
// Styles (match dark theme / Repeat-Attack)
// ---------------------------------------------------------------------------
const wrapperStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
};
const rowStyle = { display: "flex", gap: "8px", alignItems: "center" };
const btn = {
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "13px",
};
const selectStyle = {
  outline: "none",
  background: "#151515",
  color: "#838383",
  borderRadius: "4px",
  border: "1px solid #777",
  padding: "2px 6px",
  cursor: "pointer",
  minWidth: "120px",
};
const headingStyle = {
  fontSize: "14pt",
  textDecoration: "underline",
  marginBottom: "6px",
};
const linkStyle = {
  cursor: "pointer",
  textDecoration: "underline",
  color: "#00ADE1",
};
const messageStyle = { marginTop: "8px" };
const greenStyle = { color: "#7ce7a0" };
const redStyle = { color: "#f58f8f" };

// ---------------------------------------------------------------------------
// API (all via df / ui)
// ---------------------------------------------------------------------------
async function pauseGame() {
  return df.pauseGame();
}

async function unpauseGame() {
  return df.unpauseGame();
}

async function givePlanet(planet, newOwner) {
  if (!planet?.locationId || !newOwner) return;
  const tx = await df.transferPlanet(planet.locationId, newOwner);
  tx.confirmedPromise.then(() => df.hardRefreshPlanet(planet.locationId));
  return tx;
}

async function updateGameSpeed(worldConfig, speedHundredths) {
  if (!worldConfig) return;
  const nextConfig = {
    ...worldConfig,
    time_factor_hundredths: speedHundredths,
  };
  return df.setWorldConfig(nextConfig);
}

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------
function PlanetLink({ planetId }) {
  if (!planetId) return html`<span>(none selected)</span>`;
  return html`
    <a style=${linkStyle} onClick=${() => ui.centerLocationId(planetId)}>
      ${getPlanetLabel(planetId)}
    </a>
  `;
}

function Heading({ title }) {
  return html`<h2 style=${headingStyle}>${title}</h2>`;
}

function accountOptions(players) {
  if (!players?.length) return [html`<option value="">(no players)</option>`];
  return players.map(
    (p) => html`<option value=${p.address}>${p.twitter || p.address}</option>`
  );
}

function App() {
  const [account, setAccount] = useState(null);
  const [player, setPlayer] = useState(null);
  const [selectedPlanet, setSelectedPlanet] = useState(null);
  const [targetAccount, setTargetAccount] = useState(null);
  const [allPlayers, setAllPlayers] = useState([]);
  const [paused, setPaused] = useState(false);

  const [worldConfig, setWorldConfigState] = useState(null);
  const [speedHundredths, setSpeedHundredths] = useState(100);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [updatingSpeed, setUpdatingSpeed] = useState(false);
  const [updatingPause, setUpdatingPause] = useState(false);
  const [status, setStatus] = useState(undefined);
  const [error, setError] = useState(undefined);

  useEffect(() => {
    const acc = df.getAccount();
    setAccount(acc);
    setTargetAccount(acc || "");
    if (acc) setPlayer(df.getPlayer(acc));
  }, []);

  useEffect(() => {
    const refresh = () => setAllPlayers(df.getAllPlayers?.() ?? []);
    const sub = df.playersUpdated$?.subscribe(refresh);
    refresh();
    return () => sub?.unsubscribe?.();
  }, []);

  useEffect(() => {
    const sub = ui.selectedPlanetId$?.subscribe((id) => {
      setSelectedPlanet(ui.getPlanetWithId?.(id) ?? null);
    });
    return () => sub?.unsubscribe?.();
  }, []);

  useEffect(() => {
    setPaused(df.getPaused?.() ?? false);
    const sub = df.getPaused$?.subscribe?.(setPaused);
    return () => sub?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!df.getWorldConfig) return;
    let cancelled = false;
    setLoadingConfig(true);
    setError(undefined);
    df.getWorldConfig()
      .then((config) => {
        if (cancelled) return;
        setWorldConfigState(config);
        const v = config?.time_factor_hundredths;
        setSpeedHundredths(
          clampSpeed(typeof v === "number" ? v : v != null ? Number(v) : 100)
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePause = useCallback(async () => {
    setUpdatingPause(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = paused ? await unpauseGame() : await pauseGame();
      await tx?.confirmedPromise;
      setPaused(!!df.getPaused?.());
      setStatus(paused ? "Game unpaused." : "Game paused.");
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setUpdatingPause(false);
    }
  }, [paused]);

  const updateSpeed = useCallback(async () => {
    if (!worldConfig) return;
    setUpdatingSpeed(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = await updateGameSpeed(worldConfig, speedHundredths);
      await tx?.confirmedPromise;
      const next = await df.getWorldConfig?.();
      if (next) {
        setWorldConfigState(next);
        const v = next.time_factor_hundredths;
        setSpeedHundredths(
          clampSpeed(typeof v === "number" ? v : Number(v) || 100)
        );
      }
      setStatus("Game speed updated.");
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setUpdatingSpeed(false);
    }
  }, [worldConfig, speedHundredths]);

  const onGivePlanet = useCallback(async () => {
    if (!selectedPlanet || !targetAccount) return;
    setError(undefined);
    setStatus(undefined);
    try {
      await givePlanet(selectedPlanet, targetAccount);
      setStatus("Planet transfer submitted.");
    } catch (e) {
      setError(e?.message ?? String(e));
    }
  }, [selectedPlanet, targetAccount]);

  const speedChanged = worldConfig
    ? clampSpeed(Number(worldConfig.time_factor_hundredths) || 100) !==
      speedHundredths
    : false;

  return html`
    <div style=${wrapperStyle}>
      <p>Account: ${account ?? "(none)"}</p>
      ${player?.address != null
        ? html`<p>Player address: ${player.address}</p>`
        : ""}

      <${Heading} title="Game speed" />
      <div style=${rowStyle}>
        <label>Time factor (hundredths)</label>
        <input
          type="number"
          min=${SPEED_MIN}
          max=${SPEED_MAX}
          value=${speedHundredths}
          onInput=${(e) =>
            setSpeedHundredths(clampSpeed(Number(e.target?.value)))}
          style=${{ width: "80px", ...selectStyle }}
        />
      </div>
      <div style=${rowStyle}>
        <span>Multiplier</span>
        <span>${formatSpeedMultiplier(speedHundredths)}</span>
      </div>
      <button
        style=${btn}
        disabled=${loadingConfig ||
        updatingSpeed ||
        updatingPause ||
        !speedChanged}
        onClick=${updateSpeed}
      >
        ${updatingSpeed ? "Updating…" : "Update game speed"}
      </button>

      <${Heading} title="Pause / Unpause" />
      <div style=${rowStyle}>
        <span>State</span>
        <span style=${paused ? redStyle : greenStyle}
          >${paused ? "PAUSED" : "RUNNING"}</span
        >
      </div>
      <button
        style=${btn}
        disabled=${loadingConfig || updatingPause || updatingSpeed}
        onClick=${togglePause}
      >
        ${updatingPause
          ? paused
            ? "Unpausing…"
            : "Pausing…"
          : paused
            ? "Unpause game"
            : "Pause game"}
      </button>

      <${Heading} title="Give planet" />
      <div style=${rowStyle}>
        <span>Planet: </span>
        <${PlanetLink} planetId=${selectedPlanet?.locationId} />
      </div>
      <div style=${rowStyle}>
        <span>To </span>
        <select
          style=${selectStyle}
          value=${targetAccount ?? ""}
          onChange=${(e) => setTargetAccount(e.target?.value)}
        >
          ${accountOptions(allPlayers)}
        </select>
        <button
          style=${btn}
          onClick=${onGivePlanet}
          disabled=${!selectedPlanet || !targetAccount}
        >
          Give planet
        </button>
      </div>

      ${loadingConfig
        ? html`<div style=${messageStyle}>Loading config…</div>`
        : ""}
      ${status
        ? html`<div style=${messageStyle}>
            <span style=${greenStyle}>${status}</span>
          </div>`
        : ""}
      ${error
        ? html`<div style=${messageStyle}>
            <span style=${redStyle}>${error}</span>
          </div>`
        : ""}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------
class Plugin {
  async render(container) {
    container.style.width = "500px";
    container.style.minHeight = "400px";
    render(html`<${App} />`, container);
  }
}

export default Plugin;
