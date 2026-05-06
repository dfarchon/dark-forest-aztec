/**
 * Admin Controls — Pause, unpause, game speed, world radius, give planet, whitelist, spaceships, artifacts, create planet.
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

const ArtifactType = {
  Unknown: 0,
  Monolith: 1,
  Colossus: 2,
  Spaceship: 3,
  Pyramid: 4,
  Wormhole: 5,
  PlanetaryShield: 6,
  PhotoidCannon: 7,
  BloomFilter: 8,
  BlackDomain: 9,
  ShipMothership: 10,
  ShipCrescent: 11,
  ShipWhale: 12,
  ShipGear: 13,
  ShipTitan: 14,
};
const ArtifactTypeNames = {
  [ArtifactType.Unknown]: "Unknown",
  [ArtifactType.Monolith]: "Monolith",
  [ArtifactType.Colossus]: "Colossus",
  [ArtifactType.Spaceship]: "Spaceship",
  [ArtifactType.Pyramid]: "Pyramid",
  [ArtifactType.Wormhole]: "Wormhole",
  [ArtifactType.PlanetaryShield]: "Planetary Shield",
  [ArtifactType.PhotoidCannon]: "Photoid Cannon",
  [ArtifactType.BloomFilter]: "Bloom Filter",
  [ArtifactType.BlackDomain]: "Black Domain",
  [ArtifactType.ShipMothership]: "Mothership",
  [ArtifactType.ShipCrescent]: "Crescent",
  [ArtifactType.ShipWhale]: "Whale",
  [ArtifactType.ShipGear]: "Gear",
  [ArtifactType.ShipTitan]: "Titan",
};

const ArtifactRarity = {
  Unknown: 0,
  Common: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
  Mythic: 5,
};
const ArtifactRarityNames = {
  [ArtifactRarity.Unknown]: "Unknown",
  [ArtifactRarity.Common]: "Common",
  [ArtifactRarity.Rare]: "Rare",
  [ArtifactRarity.Epic]: "Epic",
  [ArtifactRarity.Legendary]: "Legendary",
  [ArtifactRarity.Mythic]: "Mythic",
};

const Biome = {
  UNKNOWN: 0,
  OCEAN: 1,
  FOREST: 2,
  GRASSLAND: 3,
  TUNDRA: 4,
  SWAMP: 5,
  DESERT: 6,
  ICE: 7,
  WASTELAND: 8,
  LAVA: 9,
  CORRUPTED: 10,
};
const BiomeNames = {
  [Biome.UNKNOWN]: "Unknown",
  [Biome.OCEAN]: "Ocean",
  [Biome.FOREST]: "Forest",
  [Biome.GRASSLAND]: "Grassland",
  [Biome.TUNDRA]: "Tundra",
  [Biome.SWAMP]: "Swamp",
  [Biome.DESERT]: "Desert",
  [Biome.ICE]: "Ice",
  [Biome.WASTELAND]: "Wasteland",
  [Biome.LAVA]: "Lava",
  [Biome.CORRUPTED]: "Corrupted",
};

const MIN_ARTIFACT_TYPE = ArtifactType.Monolith;
const MIN_SPACESHIP_TYPE = ArtifactType.ShipMothership;
const MAX_SPACESHIP_TYPE = ArtifactType.ShipTitan;
const MIN_ARTIFACT_RARITY = ArtifactRarity.Common;
const MAX_ARTIFACT_RARITY = ArtifactRarity.Mythic;
const MIN_BIOME = Biome.OCEAN;
const MAX_BIOME = Biome.CORRUPTED;

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
const wrapperStyle = { display: "flex", flexDirection: "column", gap: "8px" };
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
const rowStyle = { display: "flex", gap: "8px", alignItems: "center" };
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
const flexInput = { flex: "1", minWidth: "80px" };
const narrowInput = { width: "80px" };
const selectFlex = { flex: "1", minWidth: "0" };
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

function rangeOptions(min, max, names) {
  const opts = [];
  for (let i = min; i <= max; i++)
    opts.push(html`<option value=${i}>${names?.[i] ?? i}</option>`);
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
  const [chainRadius, setChainRadius] = useState(null);
  const [radiusInput, setRadiusInput] = useState(null);
  const [updatingRadius, setUpdatingRadius] = useState(false);
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

  // Chain world radius: poll so UI updates after admin_set_world_radius confirms
  useEffect(() => {
    const syncRadius = () => {
      const r = df.getWorldRadius?.();
      if (typeof r === "number" && !Number.isNaN(r)) {
        setChainRadius(r);
      }
    };
    syncRadius();
    const interval = setInterval(syncRadius, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (chainRadius != null && radiusInput === null) {
      setRadiusInput(String(chainRadius));
    }
  }, [chainRadius, radiusInput]);

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

  const updateRadius = useCallback(async () => {
    const parsed = Number(radiusInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setErr(new Error("Radius must be positive."));
      return;
    }
    if (typeof df.adminSetWorldRadius !== "function") {
      setErr(new Error("adminSetWorldRadius is not available in this client."));
      return;
    }
    setUpdatingRadius(true);
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = await df.adminSetWorldRadius(parsed);
      await tx?.confirmedPromise;
      const next = df.getWorldRadius?.();
      if (typeof next === "number" && !Number.isNaN(next)) {
        setChainRadius(next);
        setRadiusInput(String(next));
      }
      setStatus("World radius updated.");
    } catch (e) {
      setErr(e);
    } finally {
      setUpdatingRadius(false);
    }
  }, [radiusInput, setErr]);

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
      const tx = await df.adminGiveSpaceship?.(
        selectedPlanet.locationId,
        selectedShip,
        targetAccount
      );
      if (tx?.confirmedPromise) {
        tx.confirmedPromise.then(() => {
          df.hardRefreshPlanet?.(selectedPlanet.locationId);
          setStatus("Spaceship spawned.");
        });
      }
      setStatus("Spawn spaceship submitted.");
    } catch (e) {
      setErr(e);
    }
  }, [selectedPlanet, targetAccount, selectedShip, setErr]);

  const onGiveArtifact = useCallback(async () => {
    if (!selectedPlanet || !targetAccount) return;
    setError(undefined);
    setStatus(undefined);
    try {
      const tx = await df.adminGiveArtifact?.(
        selectedPlanet.locationId,
        Number(artifactRarity),
        Number(artifactBiome),
        selectedArtifact,
        targetAccount
      );
      if (tx?.confirmedPromise) {
        tx.confirmedPromise.then(() => {
          df.hardRefreshPlanet?.(selectedPlanet.locationId);
          setStatus("Artifact given.");
        });
      }
      setStatus("Give artifact submitted.");
    } catch (e) {
      setErr(e);
    }
  }, [
    selectedPlanet,
    targetAccount,
    artifactRarity,
    artifactBiome,
    selectedArtifact,
    setErr,
  ]);

  const speedChanged = worldConfig
    ? clampSpeed(Number(worldConfig.time_factor_hundredths) || 100) !==
      speedHundredths
    : false;

  const parsedRadius = Number(radiusInput);
  const radiusChanged =
    chainRadius != null &&
    radiusInput != null &&
    Number.isFinite(parsedRadius) &&
    parsedRadius > 0 &&
    parsedRadius !== chainRadius;

  const radiusLocked = !!worldConfig?.world_radius_locked;
  const radiusMinHint =
    worldConfig?.world_radius_min != null
      ? String(worldConfig.world_radius_min)
      : null;

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
        disabled=${loadingConfig ||
        updatingSpeed ||
        updatingPause ||
        updatingRadius ||
        !speedChanged}
        onClick=${updateSpeed}
      >
        ${updatingSpeed ? "Updating…" : "Update game speed"}
      </button>

      <${Heading} title="World radius" />
      <div style=${rowStyle}>
        <span style=${{ color: "#888" }}>Current (chain)</span>
        <span style=${{ color: "#ddd" }}
          >${chainRadius != null ? chainRadius : "…"}</span
        >
      </div>
      ${radiusMinHint != null
        ? html`<div
            style=${{ fontSize: "10pt", color: "#888", marginTop: "4px" }}
          >
            Config min radius (hint): ${radiusMinHint}
          </div>`
        : ""}
      ${radiusLocked
        ? html`<div
            style=${{
              ...bannerBase,
              borderLeft: "3px solid #FFB020",
              background: "rgba(255,176,32,0.08)",
              color: "#FFB020",
              marginTop: "6px",
            }}
          >
            world_radius_locked is true in config (informational only; this
            client still submits admin_set_world_radius).
          </div>`
        : ""}
      <div style=${{ ...rowStyle, marginTop: "6px" }}>
        <label>New radius</label>
        <input
          type="number"
          min=${1}
          value=${radiusInput ?? ""}
          onInput=${(e) => setRadiusInput(e.target?.value ?? "")}
          style=${narrowInput}
        />
      </div>
      <button
        disabled=${loadingConfig ||
        updatingRadius ||
        updatingPause ||
        updatingSpeed ||
        chainRadius == null ||
        radiusInput == null ||
        !radiusChanged}
        onClick=${updateRadius}
      >
        ${updatingRadius ? "Updating…" : "Update radius"}
      </button>

      <${Heading} title="Pause / Unpause" />
      <div style=${rowStyle}>
        <span>State</span>
        <span style=${paused ? redStyle : greenStyle}
          >${paused ? "PAUSED" : "RUNNING"}</span
        >
      </div>
      <button
        disabled=${loadingConfig ||
        updatingPause ||
        updatingSpeed ||
        updatingRadius}
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
        <button
          onClick=${onGivePlanet}
          disabled=${!selectedPlanet || !targetAccount}
        >
          Give planet
        </button>
      </div>

      <${Heading} title="Give spaceships" />
      <div style=${rowStyle}>
        <select
          style=${selectFlex}
          value=${selectedShip}
          onChange=${(e) => setSelectedShip(Number(e.target?.value))}
        >
          ${rangeOptions(
            MIN_SPACESHIP_TYPE,
            MAX_SPACESHIP_TYPE,
            ArtifactTypeNames
          )}
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
      <div style=${{ ...rowStyle, justifyContent: "space-between" }}>
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
          style=${selectFlex}
          value=${artifactRarity}
          onChange=${(e) => setArtifactRarity(e.target?.value)}
        >
          ${rangeOptions(
            MIN_ARTIFACT_RARITY,
            MAX_ARTIFACT_RARITY,
            ArtifactRarityNames
          )}
        </select>
        <select
          style=${selectFlex}
          value=${artifactBiome}
          onChange=${(e) => setArtifactBiome(e.target?.value)}
        >
          ${rangeOptions(MIN_BIOME, MAX_BIOME, BiomeNames)}
        </select>
        <select
          style=${selectFlex}
          value=${selectedArtifact}
          onChange=${(e) => setSelectedArtifact(Number(e.target?.value))}
        >
          ${rangeOptions(
            MIN_ARTIFACT_TYPE,
            MIN_SPACESHIP_TYPE - 1,
            ArtifactTypeNames
          )}
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
      <div style=${{ ...rowStyle, justifyContent: "space-between" }}>
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
    container.style.width = "525px";
    render(html`<${App} />`, container);
  }
}
