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
// Styles — lean overrides; base button/input/select styling from PluginElements
// ---------------------------------------------------------------------------
const wrapperStyle = { display: "flex", flexDirection: "column", gap: "4px" };
const sectionStyle = {
  borderTop: "1px solid #333",
  paddingTop: "12px",
  marginTop: "8px",
};
const headingStyle = {
  fontSize: "11pt",
  fontWeight: "600",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#ddd",
  margin: "0 0 8px 0",
};
const rowStyle = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  flexWrap: "wrap",
};
const linkStyle = {
  cursor: "pointer",
  textDecoration: "underline",
  color: "#00ADE1",
};
const addressStyle = {
  display: "inline-block",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "10pt",
  color: "#888",
  verticalAlign: "bottom",
};
const fullWidthBtn = { width: "100%" };
const flexInput = { flex: "1", minWidth: "80px" };
const narrowInput = { width: "80px" };
const selectFlex = { flex: "1", minWidth: "100px" };
const greenStyle = { color: "#00DC82" };
const redStyle = { color: "#FF6492" };
const bannerBase = {
  padding: "6px 10px",
  borderRadius: "3px",
  marginTop: "8px",
  fontSize: "11pt",
  lineHeight: "1.4",
};
const successBanner = {
  ...bannerBase,
  borderLeft: "3px solid #00DC82",
  background: "rgba(0,220,130,0.08)",
  color: "#00DC82",
};
const errorBanner = {
  ...bannerBase,
  borderLeft: "3px solid #FF6492",
  background: "rgba(255,100,146,0.08)",
  color: "#FF6492",
};

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
  const tx = await df.safeSetOwner?.(planet.locationId, newOwner);
  if (tx?.confirmedPromise)
    tx.confirmedPromise.then(() => df.hardRefreshPlanet?.(planet.locationId));
  return tx;
}
async function updateGameSpeed(worldConfig, speedHundredths) {
  if (worldConfig)
    return df.setWorldConfig?.({
      ...worldConfig,
      time_factor_hundredths: speedHundredths,
    });
}

async function adminRevealPlanet(locationId, coords) {
  const location = {
    coords,
    hash: locationId,
    perlin: df.spaceTypePerlin(coords, false),
    biomebase: df.biomebasePerlin(coords, false),
  };
  const txIntent = {
    methodName: "revealLocation",
    locationId,
    location,
    args: Promise.resolve([locationId, coords.x, coords.y]),
  };
  return df.submitTransaction(txIntent);
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

function Heading({ title, first }) {
  const style = first ? headingStyle : { ...headingStyle, ...sectionStyle };
  return html`<h2 style=${style}>${title}</h2>`;
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
            .then(async () => {
              const locId = tx.intent?.locationId;
              statusCallback?.("Create planet confirmed. Revealing location…");
              if (locId && typeof df.hardRefreshPlanet === "function") {
                await df.hardRefreshPlanet(locId);
              }
              if (locId && tx.intent?.coords) {
                const revealTx = await adminRevealPlanet(
                  locId,
                  tx.intent.coords
                );
                await revealTx?.confirmedPromise;
                statusCallback?.("Planet created and location revealed.");
              } else {
                statusCallback?.(
                  "Planet created. Reveal not available (no coords)."
                );
              }
            })
            .catch((e) => {
              statusCallback?.(
                "Planet created but reveal failed: " + (e?.message ?? String(e))
              );
            });
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
    <div>
      <${Heading} title="Create planet" />
      <div style=${rowStyle}>
        <label>Level</label>
        <input
          type="number"
          min=${0}
          max=${9}
          value=${level}
          onInput=${(e) => setLevel(Number(e.target?.value) || 0)}
          style=${narrowInput}
        />
        <label>Type</label>
        <select
          value=${planetType}
          onChange=${(e) => setPlanetType(Number(e.target?.value) || 0)}
        >
          ${Object.entries(PlanetTypeNames).map(
            ([k, v]) => html`<option value=${k}>${v}</option>`
          )}
        </select>
      </div>
      <div style=${{ ...rowStyle, marginTop: "6px" }}>
        ${!choosingLocation
          ? html`<button
              style=${fullWidthBtn}
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
          ? html`<button onClick=${() => setChoosingLocation(false)}>
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

  // Keep pause state in sync: initial read, stream subscription, and polling fallback
  // (stream may not fire in all contexts; polling ensures state updates after pause/unpause)
  useEffect(() => {
    const syncPaused = () => setPaused(!!df.getPaused?.());
    syncPaused();
    const sub = df.getPaused$?.subscribe?.(syncPaused);
    const interval = setInterval(syncPaused, 2000);
    return () => {
      sub?.unsubscribe?.();
      clearInterval(interval);
    };
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
      <div style=${{ marginBottom: "4px" }}>
        <div style=${rowStyle}>
          <span style=${{ color: "#888" }}>Account</span>
          <span style=${addressStyle}>${account ?? "(none)"}</span>
        </div>
        ${player?.address != null
          ? html`<div style=${rowStyle}>
              <span style=${{ color: "#888" }}>Player</span>
              <span style=${addressStyle}>${player.address}</span>
            </div>`
          : ""}
      </div>

      <${Heading} title="Game speed" first />
      <div style=${rowStyle}>
        <label>Time factor</label>
        <input
          type="number"
          min=${SPEED_MIN}
          max=${SPEED_MAX}
          value=${speedHundredths}
          onInput=${(e) =>
            setSpeedHundredths(clampSpeed(Number(e.target?.value)))}
          style=${narrowInput}
        />
        <span style=${{ color: "#ddd" }}
          >${formatSpeedMultiplier(speedHundredths)}</span
        >
      </div>
      <button
        style=${fullWidthBtn}
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
        style=${fullWidthBtn}
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
          style=${flexInput}
          value=${whitelistAddress}
          onInput=${(e) => setWhitelistAddress(e.target?.value ?? "")}
          placeholder="Address to whitelist"
        />
        <button onClick=${onWhitelist}>Whitelist</button>
      </div>

      <${Heading} title="Give planet" />
      <div style=${rowStyle}>
        <span
          >Planet: <${PlanetLink} planetId=${selectedPlanet?.locationId}
        /></span>
        <span>to</span>
        <select
          style=${selectFlex}
          value=${targetAccount ?? ""}
          onChange=${(e) => setTargetAccount(e.target?.value)}
        >
          ${accountOptions(allPlayers)}
        </select>
      </div>
      <button
        style=${fullWidthBtn}
        onClick=${onGivePlanet}
        disabled=${!selectedPlanet || !targetAccount}
      >
        Give planet
      </button>

      <${Heading} title="Give spaceships" />
      <div style=${rowStyle}>
        <select
          value=${selectedShip}
          onChange=${(e) => setSelectedShip(Number(e.target?.value))}
        >
          ${rangeOptions(MIN_SPACESHIP_TYPE, MAX_SPACESHIP_TYPE, "Ship")}
        </select>
        <span>to</span>
        <select
          style=${selectFlex}
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
          onClick=${onSpawnSpaceship}
          disabled=${!selectedPlanet || !targetAccount}
        >
          Spawn spaceship
        </button>
      </div>

      <${Heading} title="Give artifacts" />
      <div style=${rowStyle}>
        <select
          value=${artifactRarity}
          onChange=${(e) => setArtifactRarity(e.target?.value)}
        >
          ${rangeOptions(MIN_ARTIFACT_RARITY, MAX_ARTIFACT_RARITY, "Rarity")}
        </select>
        <select
          value=${artifactBiome}
          onChange=${(e) => setArtifactBiome(e.target?.value)}
        >
          ${rangeOptions(MIN_BIOME, MAX_BIOME, "Biome")}
        </select>
        <select
          value=${selectedArtifact}
          onChange=${(e) => setSelectedArtifact(Number(e.target?.value))}
        >
          ${rangeOptions(MIN_ARTIFACT_TYPE, MIN_SPACESHIP_TYPE - 1, "Type")}
        </select>
      </div>
      <div style=${rowStyle}>
        <span>to</span>
        <select
          style=${selectFlex}
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
        ? html`<div style=${bannerBase}>Loading config…</div>`
        : ""}
      ${status ? html`<div style=${successBanner}>${status}</div>` : ""}
      ${error ? html`<div style=${errorBanner}>${error}</div>` : ""}
    </div>
  `;
}

export default class Plugin {
  async render(container) {
    container.style.width = "450px";
    container.style.minHeight = "500px";
    render(html`<${App} />`, container);
  }
}
