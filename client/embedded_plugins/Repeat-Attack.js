/**
 * Repeat Attack — Auto-attack when source planet has enough energy!
 * Original author: TBC. Enhancements: https://twitter.com/davidryan59
 * Adapted for dfpunk-aztec client: no CDN imports, uses globals df + ui only.
 */

import {
  html,
  render,
  useEffect,
  useLayoutEffect,
  useState,
} from "https://unpkg.com/htm/preact/standalone.module.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
let DEFAULT_PERCENTAGE_TRIGGER = 75;
let DEFAULT_PERCENTAGE_REMAIN = 25;
let STAGGER_S = 15;
let MAX_CHARS = 15;
let WIDTH_PX = 440;
let MIN_V = 10;
let MAX_V = 90;
let STEP_V = 5;

const KEY_SET_SOURCE = "v";
const KEY_SET_TARGET = "b";
const KEY_START_FIRING = "n";
const KEY_TOGGLE_SILVER = "m";
const KEY_TOGGLE_OUTGOING_FIRING = ",";
const KEY_TOGGLE_OUTGOING_FIRING_DISPLAY = "<";
const KEY_TOGGLE_INCOMING_FIRING = ".";
const KEY_TOGGLE_INCOMING_FIRING_DISPLAY = ">";

let SILVER_SEND_PERCENT = 99;
let MATERIAL_SEND_PERCENT = 99;

const FIRING_NONE = 0;
const FIRING_ACTIVE = 1;
const FIRING_PAUSED = 2;
const sendSilverStatuses = ["Do not send", "Upgrade first", "Send all"];
const sendSilverStatusesIcon = ["-", "U", "$"];
const UPGRADE_FIRST = 1;
const SEND_ALL_SILVER = 2;
const INITIAL_SILVER_STATUS = UPGRADE_FIRST;
const toggleSilverStatus = (val) => (val + 1) % 3;

// ---------------------------------------------------------------------------
// Inline enums (match @dfpunk/types; no CDN)
// ---------------------------------------------------------------------------
const PlanetType = {
  PLANET: 0,
  SILVER_MINE: 1,
  RUINS: 2,
  TRADING_POST: 3,
  SILVER_BANK: 4,
};
const SpaceType = { NEBULA: 0, SPACE: 1, DEEP_SPACE: 2, DEAD_SPACE: 3 };

const viewport = ui.getViewport();
const PI_2 = 6.2831853;
const [DESYNC_X, DESYNC_Y] = [101, 103];
const PLANET_UNKNOWN = "?????";

// Planet label without procedural package: level + type letter + short id
function getPlanetString(locationId) {
  const planet = df.getPlanetWithId(locationId);
  if (!planet) return PLANET_UNKNOWN;
  const pt = planet.planetType;
  let type = "P";
  if (pt === PlanetType.SILVER_MINE) type = "A";
  else if (pt === PlanetType.RUINS) type = "F";
  else if (pt === PlanetType.TRADING_POST) type = "STR";
  else if (pt === PlanetType.SILVER_BANK) type = "Q";
  const shortId = (locationId && String(locationId).slice(0, 8)) || "?????";
  return `L${planet.planetLevel}-${type} ${shortId}`;
}

function getPlanetMaxRank(planet) {
  if (!planet) return 0;
  if (planet.planetType !== PlanetType.PLANET) return 0;
  if (planet.spaceType === SpaceType.NEBULA) return 3;
  if (planet.spaceType === SpaceType.SPACE) return 4;
  return 5;
}

function isFullRank(planet) {
  if (!planet) return true;
  const maxRank = getPlanetMaxRank(planet);
  const rank = planet.upgradeState.reduce((a, b) => a + b, 0);
  return rank >= maxRank;
}

// Unconfirmed departures from this planet (client API: getUnconfirmedMoves, intent.from / intent.forces)
function unconfirmedDepartures(planet) {
  if (!planet?.locationId) return 0;
  return df
    .getUnconfirmedMoves()
    .filter((m) => m.intent.from === planet.locationId)
    .reduce((acc, tx) => acc + (tx.intent.forces ?? 0), 0);
}

function planetCurrentPercentEnergy(planet) {
  const departures = unconfirmedDepartures(planet);
  const estimatedEnergy = Math.floor(planet.energy - departures);
  return Math.floor((estimatedEnergy / planet.energyCap) * 100);
}

// ---------------------------------------------------------------------------
// Repeater (core loop + state)
// ---------------------------------------------------------------------------
class Repeater {
  constructor() {
    if (typeof window.__CORELOOP__ === "undefined") {
      window.__CORELOOP__ = [];
    } else {
      console.log("KILLING PREVIOUS INTERVALS");
      window.__CORELOOP__.forEach((id) => clearInterval(id));
    }
    this.currentPlanets = {
      selected: ui.getSelectedPlanet(),
      source: null,
      target: null,
    };
    this.currentAttack = {
      sourceId: null,
      targetId: null,
      active: true,
      pcTrigger: DEFAULT_PERCENTAGE_TRIGGER,
      pcRemain: DEFAULT_PERCENTAGE_REMAIN,
      sendSilverStatus: INITIAL_SILVER_STATUS,
      sendMaterials: false,
    };
    this.attacks = [];
    this.account = df.getAccount();
    this.configKey = `${df.getContractAddress()}-${this.account || "anon"}`;
    this.loadAttacks();
    this.intervalId = setInterval(this.coreLoop.bind(this), 1000);
    window.__CORELOOP__.push(this.intervalId);
  }

  saveAttacks() {
    try {
      localStorage.setItem(
        `repeatAttacks-${this.configKey}`,
        JSON.stringify(this.attacks)
      );
    } catch (e) {
      console.warn("RepeatAttack: saveAttacks", e);
    }
  }

  loadAttacks() {
    try {
      const raw = localStorage.getItem(`repeatAttacks-${this.configKey}`);
      if (raw) this.attacks = JSON.parse(raw);
    } catch (e) {
      console.warn("RepeatAttack: loadAttacks", e);
    }
  }

  addAttack() {
    const attack = { ...this.currentAttack };
    if (!attack.sourceId || !attack.targetId) return;
    attack.pcRemain =
      attack.pcTrigger <= attack.pcRemain
        ? Math.floor(attack.pcTrigger / 2)
        : attack.pcRemain;
    let newAttacks = this.attacks.filter((a) => a.sourceId !== attack.sourceId);
    newAttacks = [attack, ...newAttacks];
    this.attacks = newAttacks;
    this.saveAttacks();
  }

  toggleActive(position) {
    this.attacks[position].active = !this.attacks[position].active;
    this.saveAttacks();
  }

  toggleSilver(position) {
    this.attacks[position].sendSilverStatus = toggleSilverStatus(
      this.attacks[position].sendSilverStatus
    );
    this.saveAttacks();
  }

  toggleMaterials(position) {
    this.attacks[position].sendMaterials =
      !this.attacks[position].sendMaterials;
    this.saveAttacks();
  }

  removeAttack(position) {
    this.attacks.splice(position, 1);
    this.saveAttacks();
  }

  removeAllAttacks() {
    this.attacks = [];
    this.saveAttacks();
  }

  getFiringStatus(item) {
    const planetId = this.currentPlanets.selected?.locationId;
    if (!planetId) return FIRING_NONE;
    const attacks = this.attacks.filter((a) => a[item] === planetId);
    if (!attacks.length) return FIRING_NONE;
    const pausedAttacks = attacks.filter((a) => !a.active);
    return pausedAttacks.length < attacks.length
      ? FIRING_ACTIVE
      : FIRING_PAUSED;
  }

  outgoingStatus() {
    return this.getFiringStatus("sourceId");
  }

  incomingStatus() {
    return this.getFiringStatus("targetId");
  }

  toggleOutgoingFiring() {
    const planetId = this.currentPlanets.selected?.locationId;
    if (!planetId) return;
    const newActive = this.outgoingStatus() !== FIRING_ACTIVE;
    this.attacks = this.attacks.map((a) => {
      if (a.sourceId === planetId) a.active = newActive;
      return a;
    });
    this.saveAttacks();
  }

  toggleIncomingFiring() {
    const planetId = this.currentPlanets.selected?.locationId;
    if (!planetId) return;
    const newActive = this.incomingStatus() !== FIRING_ACTIVE;
    this.attacks = this.attacks.map((a) => {
      if (a.targetId === planetId) a.active = newActive;
      return a;
    });
    this.saveAttacks();
  }

  coreLoop() {
    if (!this?.attacks) return;
    this.attacks.forEach((attack, idx) => {
      if (idx % STAGGER_S === Math.floor(Date.now() / 1000) % STAGGER_S) {
        ExecuteAttack(attack);
      }
    });
  }
}

// Execute a single attack (client: df.move(from, to, forces, silver, artifact?, abandoning?)
function ExecuteAttack({
  sourceId,
  targetId,
  active,
  pcTrigger,
  pcRemain,
  sendSilverStatus,
  sendMaterials,
}) {
  const srcPlanet = df.getPlanetWithId(sourceId);
  if (!srcPlanet || !active) return;

  const departingForces = unconfirmedDepartures(srcPlanet);
  const TRIGGER_AMOUNT = Math.floor((srcPlanet.energyCap * pcTrigger) / 100);
  const FUZZY_ENERGY = Math.floor(srcPlanet.energy - departingForces);

  if (FUZZY_ENERGY <= TRIGGER_AMOUNT) return;

  const overflow_send = planetCurrentPercentEnergy(srcPlanet) - pcRemain;
  const FORCES = Math.floor((srcPlanet.energyCap * overflow_send) / 100);
  let silver = 0;
  if (
    sendSilverStatus === SEND_ALL_SILVER ||
    (sendSilverStatus === UPGRADE_FIRST && isFullRank(srcPlanet))
  ) {
    silver = Math.round(srcPlanet.silver * (SILVER_SEND_PERCENT / 100));
  }

  // Client move API: (from, to, forces, silver, artifactMoved?, abandoning?, bypassChecks?)
  // Materials not supported in dfpunk-aztec move(); omit if present in attack config
  df.move(sourceId, targetId, FORCES, silver, undefined, false);
}

// ---------------------------------------------------------------------------
// Styles (gray buttons to match dark theme)
// ---------------------------------------------------------------------------
const Keyboard_Shortcut = { fontSize: "85%", color: "rgba(220, 180, 128, 1)" };
const Margin_3L_3R = { marginLeft: "3px", marginRight: "3px" };
const Margin_12L_12R = { marginLeft: "12px", marginRight: "12px" };
const Margin_12B = { marginBottom: "12px" };
const Margin_6B = { marginBottom: "6px" };
const Clickable = { cursor: "pointer", textDecoration: "underline" };
const ActionEntry = {
  marginBottom: "5px",
  display: "flex",
  justifyContent: "space-between",
  color: "",
};

const btn = {
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "13px",
};
const btnSmall = {
  ...btn,
  padding: "4px 8px",
  fontSize: "12px",
  minWidth: "28px",
};

function centerPlanet(id) {
  ui.centerLocationId(id);
}

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------
function Attack({
  attack,
  onToggleActive,
  onToggleSilver,
  onToggleMaterials,
  onDelete,
}) {
  const srcString = getPlanetString(attack.sourceId) || PLANET_UNKNOWN;
  const targetString = getPlanetString(attack.targetId) || PLANET_UNKNOWN;
  const finalSrc =
    srcString.length > MAX_CHARS
      ? srcString.slice(0, MAX_CHARS - 3) + "..."
      : srcString;
  const finalTarget =
    targetString.length > MAX_CHARS
      ? targetString.slice(0, MAX_CHARS - 3) + "..."
      : targetString;
  return html`
    <div style=${ActionEntry}>
      <button style=${btnSmall} onClick=${onToggleActive}>
        ${attack.active ? "▶️" : "⏸️"}
      </button>
      <span>
        <span style=${Margin_3L_3R}>
          <span
            style=${Clickable}
            onClick=${() => centerPlanet(attack.sourceId)}
            >${finalSrc}</span
          >
          <span style=${Margin_3L_3R}>-></span>
          <span
            style=${Clickable}
            onClick=${() => centerPlanet(attack.targetId)}
            >${finalTarget}</span
          >
        </span>
        <span style=${Margin_3L_3R}
          >${attack.pcTrigger}% -> ${attack.pcRemain}%</span
        >
      </span>
      <span style=${Margin_3L_3R}>
        <button style=${btnSmall} onClick=${onToggleSilver}>
          ${sendSilverStatusesIcon[attack.sendSilverStatus]}
        </button>
        <button style=${btnSmall} onClick=${onToggleMaterials}>
          ${attack.sendMaterials ? "📦" : "⛔️"}
        </button>
      </span>
      <button style=${btnSmall} onClick=${onDelete}>X</button>
    </div>
  `;
}

function AddAttack({
  repeater,
  startFiring,
  toggleOutgoingFiring,
  toggleIncomingFiring,
}) {
  const [currentPlanets, setCurrentPlanetsUS] = useState(
    repeater.currentPlanets
  );
  const getCurrentPlanet = (option) => (
    currentPlanets,
    repeater.currentPlanets[option]
  );
  const setCurrentPlanet = (option, value) => {
    repeater.currentPlanets[option] = value;
    setCurrentPlanetsUS({ ...repeater.currentPlanets });
  };
  const [currentAttack, setCurrentAttackUS] = useState(repeater.currentAttack);
  const getCurrentAttack = (option) => (
    currentAttack,
    repeater.currentAttack[option]
  );
  const setCurrentAttack = (option, value) => {
    repeater.currentAttack[option] = value;
    setCurrentAttackUS({ ...repeater.currentAttack });
  };
  const setSource = () => {
    const planet = getCurrentPlanet("selected");
    setCurrentPlanet("source", planet);
    setCurrentAttack("sourceId", planet?.locationId);
  };
  const setTarget = () => {
    const planet = getCurrentPlanet("selected");
    setCurrentPlanet("target", planet);
    setCurrentAttack("targetId", planet?.locationId);
  };
  const toggleSendSilver = () =>
    setCurrentAttack(
      "sendSilverStatus",
      toggleSilverStatus(getCurrentAttack("sendSilverStatus"))
    );
  const toggleSendMaterials = () =>
    setCurrentAttack("sendMaterials", !getCurrentAttack("sendMaterials"));

  useLayoutEffect(() => {
    const onClick = () => setCurrentPlanet("selected", ui.getSelectedPlanet());
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);
  useLayoutEffect(() => {
    const onKeyUp = (e) => {
      switch (e.key) {
        case KEY_SET_SOURCE:
          setSource();
          break;
        case KEY_SET_TARGET:
          setTarget();
          break;
        case KEY_TOGGLE_SILVER:
          toggleSendSilver();
          break;
        case KEY_START_FIRING:
          startFiring();
          break;
        case KEY_TOGGLE_OUTGOING_FIRING:
        case KEY_TOGGLE_OUTGOING_FIRING_DISPLAY:
          toggleOutgoingFiring();
          break;
        case KEY_TOGGLE_INCOMING_FIRING:
        case KEY_TOGGLE_INCOMING_FIRING_DISPLAY:
          toggleIncomingFiring();
          break;
      }
    };
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, []);

  return html`
    <div style=${{ display: "flex", flexDirection: "column" }}>
      <div style=${{ display: "flex" }}>
        <button style=${{ ...btn, ...Margin_12B }} onClick=${setSource}>
          Set Source <span style=${Keyboard_Shortcut}>[${KEY_SET_SOURCE}]</span>
        </button>
        <span
          style=${getCurrentPlanet("source")
            ? { ...Margin_12L_12R, ...Clickable, marginRight: "auto" }
            : { ...Margin_12L_12R, marginRight: "auto" }}
          onClick=${getCurrentPlanet("source")
            ? () => centerPlanet(getCurrentAttack("sourceId"))
            : () => {}}
          >${getPlanetString(getCurrentAttack("sourceId"))}</span
        >
      </div>
      <div style=${{ display: "flex" }}>
        <button style=${{ ...btn, ...Margin_12B }} onClick=${setTarget}>
          Set Target <span style=${Keyboard_Shortcut}>[${KEY_SET_TARGET}]</span>
        </button>
        <span
          style=${getCurrentPlanet("target")
            ? { ...Margin_12L_12R, ...Clickable, marginRight: "auto" }
            : { ...Margin_12L_12R, marginRight: "auto" }}
          onClick=${getCurrentPlanet("target")
            ? () => centerPlanet(getCurrentAttack("targetId"))
            : () => {}}
          >${getPlanetString(getCurrentAttack("targetId"))}</span
        >
      </div>
      <div style=${{ marginBottom: 3 }}>
        Trigger firing at:
        <input
          type="range"
          min=${MIN_V}
          max=${MAX_V}
          step=${STEP_V}
          value=${getCurrentAttack("pcTrigger")}
          onInput=${(e) =>
            setCurrentAttack("pcTrigger", parseInt(e.target.value, 10))}
        />
        ${getCurrentAttack("pcTrigger")}%
      </div>
      <div style=${{ marginBottom: 3 }}>
        Remaining after firing:
        <input
          type="range"
          min=${MIN_V}
          max=${MAX_V}
          step=${STEP_V}
          value=${getCurrentAttack("pcRemain")}
          onInput=${(e) =>
            setCurrentAttack("pcRemain", parseInt(e.target.value, 10))}
        />
        ${getCurrentAttack("pcRemain")}%
      </div>
      <div style=${{ marginBottom: 10 }}>
        Silver:
        <button
          style=${{ ...btn, width: 150, height: 28 }}
          onClick=${toggleSendSilver}
        >
          ${sendSilverStatuses[getCurrentAttack("sendSilverStatus")]}
          <span style=${Keyboard_Shortcut}>[${KEY_TOGGLE_SILVER}]</span>
        </button>
      </div>
      <div style=${{ marginBottom: 10 }}>
        Materials:
        <button
          style=${{ ...btn, width: 150, height: 28 }}
          onClick=${toggleSendMaterials}
        >
          ${getCurrentAttack("sendMaterials") ? "📦 Yes" : "⛔️ No"}
        </button>
      </div>
      <div>
        <button
          style=${{ ...btn, ...Margin_12B, width: 150 }}
          onClick=${startFiring}
        >
          Start Firing!
          <span style=${Keyboard_Shortcut}>[${KEY_START_FIRING}]</span>
        </button>
      </div>
      <hr style=${{ borderColor: "grey", marginBottom: "10px" }} />
      <div style=${{ fontSize: "99%" }}>
        <div style=${{ marginBottom: "10px" }}>
          Selected:
          <span
            style=${getCurrentPlanet("selected")
              ? { ...Margin_12L_12R, ...Clickable }
              : Margin_12L_12R}
            onClick=${getCurrentPlanet("selected")
              ? () => centerPlanet(getCurrentPlanet("selected").locationId)
              : () => {}}
            >${getPlanetString(getCurrentPlanet("selected")?.locationId)}</span
          >
        </div>
        <div>
          ${repeater.outgoingStatus() === FIRING_NONE
            ? ""
            : html`<button
                style=${{ ...btn, ...Margin_12B, width: 150, marginRight: 10 }}
                onClick=${toggleOutgoingFiring}
              >
                ${repeater.outgoingStatus() === FIRING_PAUSED
                  ? "Resume"
                  : "Pause"}
                Firing
                <span style=${Keyboard_Shortcut}
                  >[${KEY_TOGGLE_OUTGOING_FIRING_DISPLAY}]</span
                >
              </button>`}
          ${repeater.incomingStatus() === FIRING_NONE
            ? ""
            : html`<button
                style=${{ ...btn, ...Margin_12B, width: 210 }}
                onClick=${toggleIncomingFiring}
              >
                ${repeater.incomingStatus() === FIRING_PAUSED
                  ? "Resume"
                  : "Pause"}
                Being Fired At
                <span style=${Keyboard_Shortcut}
                  >[${KEY_TOGGLE_INCOMING_FIRING_DISPLAY}]</span
                >
              </button>`}
        </div>
      </div>
      <hr style=${{ borderColor: "grey", marginBottom: "10px" }} />
    </div>
  `;
}

function AttackList({ repeater }) {
  const [attacks, setAttacks] = useState([...repeater.attacks]);
  useEffect(() => {
    const id = setInterval(() => setAttacks([...repeater.attacks]), 1000);
    setAttacks([...repeater.attacks]);
    return () => clearInterval(id);
  }, [attacks.length]);

  const actionList = {
    backgroundColor: "#252525",
    maxHeight: "240px",
    overflowX: "hidden",
    overflowY: "scroll",
    padding: "5px",
    borderRadius: "5px",
  };
  const actionsChildren = attacks.map(
    (action, index) => html`
      <${Attack}
        attack=${action}
        onToggleActive=${() => repeater.toggleActive(index)}
        onToggleSilver=${() => repeater.toggleSilver(index)}
        onToggleMaterials=${() => repeater.toggleMaterials(index)}
        onDelete=${() => repeater.removeAttack(index)}
      />
    `
  );

  return html`
    <i style=${{ ...Margin_12B, display: "block" }}
      >Auto-attack when source planet has enough energy!</i
    >
    <${AddAttack}
      repeater=${repeater}
      startFiring=${() => repeater.addAttack()}
      toggleOutgoingFiring=${() => repeater.toggleOutgoingFiring()}
      toggleIncomingFiring=${() => repeater.toggleIncomingFiring()}
    />
    <h1 style=${{ ...Margin_6B, fontWeight: "bold" }}>
      Active (${attacks.filter((a) => a.active).length} / ${attacks.length})
      <button
        style=${{ ...btn, float: "right", marginLeft: 10 }}
        onClick=${() => {
          repeater.removeAllAttacks();
          setAttacks([]);
        }}
      >
        Clear All
      </button>
      <button
        style=${{ ...btn, float: "right" }}
        onClick=${() => setAttacks([...repeater.attacks])}
      >
        Refresh
      </button>
    </h1>
    <div style=${actionList}>
      ${actionsChildren.length ? actionsChildren : "No Actions."}
    </div>
  `;
}

function App({ repeater }) {
  return html`<${AttackList} repeater=${repeater} />`;
}

// ---------------------------------------------------------------------------
// Canvas highlights
// ---------------------------------------------------------------------------
function drawHighlights(plugin) {
  const ctx = plugin.ctx;
  const timeMs = plugin.dateNow;
  const planet = plugin.repeater.currentPlanets.selected;
  if (!planet?.location) return;
  const selectedPlanetId = planet.locationId;
  const attacks = plugin.repeater.attacks;
  const attacksSelectedIsSource = attacks.filter(
    (a) => a.sourceId === selectedPlanetId
  );
  const attacksSelectedIsTarget = attacks.filter(
    (a) => a.targetId === selectedPlanetId
  );
  if (!attacksSelectedIsSource.length && !attacksSelectedIsTarget.length)
    return;

  const getSawWave01 = (periodMs, p) =>
    ((timeMs +
      DESYNC_X * p.location.coords.x +
      DESYNC_Y * p.location.coords.y) %
      periodMs) /
    periodMs;

  const drawHighlight = (planetId, rgba, periodMs, lineWidth, arcFraction) => {
    const thePlanet = ui.getPlanetWithId(planetId);
    if (!thePlanet?.location) return;
    const theCoords = thePlanet.location.coords;
    ctx.strokeStyle = rgba;
    ctx.setLineDash([12, 8]);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    const cX = viewport.worldToCanvasX(theCoords.x);
    const cY = viewport.worldToCanvasY(theCoords.y);
    const cR =
      10 +
      viewport.worldToCanvasDist(
        1.4 * (ui.getRadiusOfPlanetLevel?.(thePlanet.planetLevel) ?? 10)
      );
    const START_RADIANS = PI_2 * getSawWave01(periodMs, thePlanet);
    ctx.arc(cX, cY, cR, START_RADIANS, START_RADIANS + PI_2 * arcFraction);
    ctx.stroke();
    ctx.closePath();
  };

  attacksSelectedIsSource.forEach((a) =>
    drawHighlight(
      a.targetId,
      a.active ? "rgba(255, 80, 80, 0.6)" : "rgba(180, 140, 40, 0.6)",
      23000,
      a.active ? 8 : 6,
      a.active ? 0.55 : 0.3
    )
  );
  drawHighlight(selectedPlanetId, "rgba(80, 80, 255, 0.7)", -12000, 6, 0.7);
  attacksSelectedIsTarget.forEach((a) =>
    drawHighlight(
      a.sourceId,
      a.active ? "rgba(80, 255, 80, 0.5)" : "rgba(140, 180, 40, 0.5)",
      7000,
      a.active ? 4 : 3,
      a.active ? 0.8 : 0.4
    )
  );
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------
class Plugin {
  constructor() {
    this.repeater = new Repeater();
    this.ctx = null;
    this.dateNow = Date.now();
    this.root = undefined;
    this.container = null;
  }

  async render(container) {
    this.container = container;
    container.style.width = `${WIDTH_PX}px`;
    this.root = render(html`<${App} repeater=${this.repeater} />`, container);
  }

  draw(ctx) {
    ctx.save();
    this.ctx = ctx;
    this.dateNow = Date.now();
    drawHighlights(this);
    ctx.restore();
  }

  destroy() {
    if (window.__CORELOOP__)
      window.__CORELOOP__.forEach((id) => clearInterval(id));
    if (this.container && typeof render !== "undefined")
      render(html`<div></div>`, this.container);
  }
}

export default Plugin;
