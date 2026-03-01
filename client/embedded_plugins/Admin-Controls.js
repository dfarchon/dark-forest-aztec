/**
 * Admin Controls — Pause, unpause, game speed, give planet, whitelist, spaceships, artifacts, create planet.
 * Embedded plugin for dfpunk-aztec. Uses only globals df + ui; single CDN for Preact/htm.
 * Features not implemented in this client show "Not available".
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

// Minimal artifact/ship/biome enums for dropdowns (no CDN)
const MIN_ARTIFACT_RARITY = 0;
const MAX_ARTIFACT_RARITY = 5;
const MIN_ARTIFACT_TYPE = 0;
const MIN_SPACESHIP_TYPE = 6;
const MAX_SPACESHIP_TYPE = 9;
const MIN_BIOME = 0;
const MAX_BIOME = 10;

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
// Styles
// ---------------------------------------------------------------------------
const wrapperStyle = { display: "flex", flexDirection: "column", gap: "8px" };
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
const inputStyle = { ...selectStyle, flex: "1", minWidth: "80px" };
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
// API (only implemented ones called; rest stub)
// ---------------------------------------------------------------------------
async function pauseGame() {
  return df.pauseGame?.();
}
async function unpauseGame() {
  return df.unpauseGame?.();
}
async function givePlanet(planet, newOwner) {
  if (!planet?.locationId || !newOwner) return;
  const tx = await df.transferPlanet?.(planet.locationId, newOwner);
  if (tx?.confirmedPromise)
    tx.confirmedPromise.then(() => df.hardRefreshPlanet?.(planet.locationId));
  return tx;
}
async function updateGameSpeed(worldConfig, speedHundredths) {
  if (!worldConfig)
    return df.setWorldConfig?.({
      ...worldConfig,
      time_factor_hundredths: speedHundredths,
    });
}

// Stubs (no contract support in this client)
function notAvailable() {
  return Promise.reject(new Error("Not available in this client."));
}

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------
function PlanetLink({ planetId }) {
  if (!planetId) return html`<span>(none selected)</span>`;
  return html`
    <a style=${linkStyle} onClick=${() => ui.centerLocationId?.(planetId)}
      >${getPlanetLabel(planetId)}</a
    >
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

function rangeOptions(min, max, label) {
  const opts = [];
  for (let i = min; i <= max; i++)
    opts.push(html`<option value=${i}>${label ? `${label} ${i}` : i}</option>`);
  return opts;
}

// Planet Creator: level, type, choose location
function PlanetCreator({ statusCallback, errorCallback }) {
  const [level, setLevel] = useState(0);
  const [planetType, setPlanetType] = useState(PlanetType.PLANET);
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [planetCoords, setPlanetCoords] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!choosingLocation) return;
    const uiEmitter = ui.getUIEmitter?.();
    if (!uiEmitter) return;
    const place = async (coords) => {
      if (!coords || creating) return;
      setChoosingLocation(false);
      if (typeof df.createPlanet !== "function") {
        statusCallback?.("Create planet not available in this client.");
        return;
      }
      setCreating(true);
      try {
        const tx = await df.createPlanet(coords, level, planetType);
        statusCallback?.(
          "Create planet submitted. Confirm in wallet if required."
        );
        if (tx?.confirmedPromise) {
          tx.confirmedPromise
            .then(() => statusCallback?.("Create planet confirmed."))
            .catch(() => {});
        }
      } catch (e) {
        const msg = e?.message ?? String(e);
        if (errorCallback) errorCallback(e);
        else statusCallback?.("Error: " + msg);
      } finally {
        setCreating(false);
      }
    };
    const move = (coords) => setPlanetCoords(coords);
    uiEmitter.on("WorldMouseClick", place);
    uiEmitter.on("WorldMouseMove", move);
    return () => {
      uiEmitter.off("WorldMouseClick", place);
      uiEmitter.off("WorldMouseMove", move);
    };
  }, [
    choosingLocation,
    statusCallback,
    errorCallback,
    level,
    planetType,
    creating,
  ]);

  return html`
    <div style=${{ width: "100%" }}>
      <${Heading} title="Create planet" />
      <div style=${rowStyle}>
        <label>Level</label>
        <input
          type="number"
          min=${0}
          max=${9}
          value=${level}
          onInput=${(e) => setLevel(Number(e.target?.value) || 0)}
          style=${inputStyle}
        />
        <label>Type</label>
        <select
          style=${selectStyle}
          value=${planetType}
          onChange=${(e) => setPlanetType(Number(e.target?.value) || 0)}
        >
          ${Object.entries(PlanetTypeNames).map(
            ([k, v]) => html`<option value=${k}>${v}</option>`
          )}
        </select>
      </div>
      <div style=${rowStyle}>
        ${!choosingLocation
          ? html`<button
              style=${btn}
              onClick=${() => setChoosingLocation(true)}
              disabled=${creating}
            >
              ${creating ? "Creating…" : "Choose planet location"}
            </button>`
          : html`<span
              >Coords: (${Math.round(planetCoords?.x ?? 0)},
              ${Math.round(planetCoords?.y ?? 0)}) — click map to create</span
            >`}
        ${choosingLocation
          ? html`<button
              style=${btn}
              onClick=${() => setChoosingLocation(false)}
            >
              Cancel
            </button>`
          : ""}
      </div>
    </div>
  `;
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

  const [whitelistAddress, setWhitelistAddress] = useState("");
  const [selectedShip, setSelectedShip] = useState(MIN_SPACESHIP_TYPE);
  const [selectedArtifact, setSelectedArtifact] = useState(MIN_ARTIFACT_TYPE);
  const [artifactRarity, setArtifactRarity] = useState(
    String(MIN_ARTIFACT_RARITY)
  );
  const [artifactBiome, setArtifactBiome] = useState(String(MIN_BIOME));

  useEffect(() => {
    const acc = df.getAccount?.();
    setAccount(acc);
    setTargetAccount(acc || "");
    if (acc) setPlayer(df.getPlayer?.(acc));
  }, []);

  useEffect(() => {
    const refresh = () => setAllPlayers(df.getAllPlayers?.() ?? []);
    const sub = df.playersUpdated$?.subscribe?.(refresh);
    refresh();
    return () => sub?.unsubscribe?.();
  }, []);

  useEffect(() => {
    const sub = ui.selectedPlanetId$?.subscribe?.((id) =>
      setSelectedPlanet(ui.getPlanetWithId?.(id) ?? null)
    );
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
    df.getWorldConfig()
      .then((config) => {
        if (cancelled) return;
        setWorldConfigState(config);
        const v = config?.time_factor_hundredths;
        setSpeedHundredths(
          clampSpeed(typeof v === "number" ? v : Number(v) || 100)
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

  const setStatusOnly = useCallback((msg) => {
    setStatus(msg);
    setError(undefined);
  }, []);
  const setErr = useCallback((e) => {
    setError(e?.message ?? String(e));
    setStatus(undefined);
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
      setErr(e);
    } finally {
      setUpdatingPause(false);
    }
  }, [paused, setErr]);

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
        setSpeedHundredths(
          clampSpeed(Number(next.time_factor_hundredths) || 100)
        );
      }
      setStatus("Game speed updated.");
    } catch (e) {
      setErr(e);
    } finally {
      setUpdatingSpeed(false);
    }
  }, [worldConfig, speedHundredths, setErr]);

  const onGivePlanet = useCallback(async () => {
    setError(undefined);
    setStatus(undefined);
    if (!selectedPlanet) {
      setErr(new Error("Select a planet first (click a planet on the map)."));
      return;
    }
    if (!targetAccount) {
      setErr(new Error("Select a recipient from the dropdown."));
      return;
    }
    try {
      await givePlanet(selectedPlanet, targetAccount);
      setStatus("Planet transfer submitted.");
    } catch (e) {
      setErr(e);
    }
  }, [selectedPlanet, targetAccount, setErr]);

  const onWhitelist = useCallback(async () => {
    const addr = (whitelistAddress || "").trim();
    if (!addr) return;
    setError(undefined);
    setStatus(undefined);
    try {
      await notAvailable();
    } catch (e) {
      setStatus("Whitelist not available in this client.");
    }
  }, [whitelistAddress]);

  const onSpawnSpaceship = useCallback(async () => {
    if (!selectedPlanet || !targetAccount) return;
    setError(undefined);
    setStatus(undefined);
    try {
      await notAvailable();
    } catch (e) {
      setStatus("Spawn spaceship not available in this client.");
    }
  }, [selectedPlanet, targetAccount]);

  const onGiveArtifact = useCallback(async () => {
    if (!selectedPlanet || !targetAccount) return;
    setError(undefined);
    setStatus(undefined);
    try {
      await notAvailable();
    } catch (e) {
      setStatus("Give artifact not available in this client.");
    }
  }, [selectedPlanet, targetAccount]);

  const speedChanged = worldConfig
    ? clampSpeed(Number(worldConfig.time_factor_hundredths) || 100) !==
      speedHundredths
    : false;

  return html`
    <div style=${wrapperStyle}>
      <p>Account: ${account ?? "(none)"}</p>
      ${player?.address != null ? html`<p>Player: ${player.address}</p>` : ""}

      <${Heading} title="Game speed" />
      <div style=${rowStyle}>
        <label>Time factor</label>
        <input
          type="number"
          min=${SPEED_MIN}
          max=${SPEED_MAX}
          value=${speedHundredths}
          onInput=${(e) =>
            setSpeedHundredths(clampSpeed(Number(e.target?.value)))}
          style=${{ width: "80px", ...selectStyle }}
        />
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
        <span>State </span>
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

      <${Heading} title="Whitelist players" />
      <div style=${rowStyle}>
        <input
          type="text"
          style=${inputStyle}
          value=${whitelistAddress}
          onInput=${(e) => setWhitelistAddress(e.target?.value ?? "")}
          placeholder="Address to whitelist"
        />
        <button style=${btn} onClick=${onWhitelist}>Whitelist address</button>
      </div>

      <${Heading} title="Give planet" />
      <div style=${rowStyle}>
        <span
          >Planet: <${PlanetLink} planetId=${selectedPlanet?.locationId}
        /></span>
        <span> to </span>
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

      <${Heading} title="Give spaceships" />
      <div style=${rowStyle}>
        <select
          style=${selectStyle}
          value=${selectedShip}
          onChange=${(e) => setSelectedShip(Number(e.target?.value))}
        >
          ${rangeOptions(MIN_SPACESHIP_TYPE, MAX_SPACESHIP_TYPE, "Ship")}
        </select>
        <span> to </span>
        <select
          style=${selectStyle}
          value=${targetAccount ?? ""}
          onChange=${(e) => setTargetAccount(e.target?.value)}
        >
          ${accountOptions(allPlayers)}
        </select>
      </div>
      <div style=${rowStyle}>
        <span
          >On planet: <${PlanetLink} planetId=${selectedPlanet?.locationId}
        /></span>
        <button
          style=${btn}
          onClick=${onSpawnSpaceship}
          disabled=${!selectedPlanet || !targetAccount}
        >
          Spawn spaceship
        </button>
      </div>

      <${Heading} title="Give artifacts" />
      <div style=${rowStyle}>
        <select
          style=${selectStyle}
          value=${artifactRarity}
          onChange=${(e) => setArtifactRarity(e.target?.value)}
        >
          ${rangeOptions(MIN_ARTIFACT_RARITY, MAX_ARTIFACT_RARITY, "Rarity")}
        </select>
        <select
          style=${selectStyle}
          value=${artifactBiome}
          onChange=${(e) => setArtifactBiome(e.target?.value)}
        >
          ${rangeOptions(MIN_BIOME, MAX_BIOME, "Biome")}
        </select>
        <select
          style=${selectStyle}
          value=${selectedArtifact}
          onChange=${(e) => setSelectedArtifact(Number(e.target?.value))}
        >
          ${rangeOptions(MIN_ARTIFACT_TYPE, MIN_SPACESHIP_TYPE - 1, "Type")}
        </select>
        <span> to </span>
        <select
          style=${selectStyle}
          value=${targetAccount ?? ""}
          onChange=${(e) => setTargetAccount(e.target?.value)}
        >
          ${accountOptions(allPlayers)}
        </select>
      </div>
      <div style=${rowStyle}>
        <span
          >On planet: <${PlanetLink} planetId=${selectedPlanet?.locationId}
        /></span>
        <button
          style=${btn}
          onClick=${onGiveArtifact}
          disabled=${!selectedPlanet || !targetAccount}
        >
          Give artifact
        </button>
      </div>

      <${PlanetCreator}
        statusCallback=${setStatusOnly}
        errorCallback=${setErr}
      />

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

export default class Plugin {
  async render(container) {
    container.style.width = "525px";
    container.style.minHeight = "500px";
    render(html`<${App} />`, container);
  }
}
