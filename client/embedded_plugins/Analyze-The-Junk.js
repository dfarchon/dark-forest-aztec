/**
 * Analyze The Junk — Filter and highlight planets by owner vs junkOwner.
 * Embedded plugin for dfpunk-aztec. Uses df + ui. Preact from unpkg.
 * Note: planet.junkOwner may not exist in all clients; filters use optional chaining.
 */

import {
  html,
  render,
  useState,
} from "https://unpkg.com/htm/preact/standalone.module.js";

let show_planets = [];

function drawRound(ctx, p, color, width, alpha) {
  if (!p?.location?.coords) return;
  const viewport = ui.getViewport?.();
  if (!viewport?.worldToCanvasCoords || !viewport?.worldToCanvasDist) return;
  const { x, y } = viewport.worldToCanvasCoords(p.location.coords);
  const rangeWorld = (p.range ?? 0) * 0.01 * 25;
  const trueRange = viewport.worldToCanvasDist(rangeWorld);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, trueRange, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

const btnStyle = {
  marginLeft: "8px",
  width: "200px",
  height: "100px",
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "12px",
};
const clearBtnStyle = { ...btnStyle, height: "50px" };
const flexRow = {
  display: "flex",
  flexDirection: "row",
  marginTop: "16px",
  marginLeft: "10px",
  marginBottom: "10px",
};

function App() {
  const [planets, setPlanets] = useState([]);
  const account =
    typeof df.getAccount === "function" ? df.getAccount() : undefined;

  const setBoth = (list) => {
    show_planets = list || [];
    setPlanets(show_planets);
  };

  const getTypeOne = () => {
    const myPlanets =
      (typeof df.getMyPlanets === "function" ? df.getMyPlanets() : []) || [];
    const list = myPlanets.filter((p) => p?.junkOwner === account);
    setBoth(list);
  };

  const getTypeTwo = () => {
    const all =
      (typeof df.getAllOwnedPlanets === "function"
        ? df.getAllOwnedPlanets()
        : []) || [];
    const list = all.filter(
      (p) => p?.junkOwner === account && p?.owner !== account
    );
    setBoth(list);
  };

  const getTypeThree = () => {
    const all =
      (typeof df.getAllOwnedPlanets === "function"
        ? df.getAllOwnedPlanets()
        : []) || [];
    const list = all.filter(
      (p) => p?.owner === account && p?.junkOwner !== account
    );
    setBoth(list);
  };

  const clearPlanets = () => setBoth([]);

  return html`
    <div>
      <div style=${flexRow}>
        <button style=${btnStyle} onClick=${getTypeOne}>
          show Planets that<br />planet.owner === me<br />planet.junkOwner ===
          me
        </button>
        <button style=${btnStyle} onClick=${getTypeTwo}>
          show Planets that<br />planet.owner !== me<br />planet.junkOwner ===
          me
        </button>
      </div>
      <div style=${flexRow}>
        <button style=${btnStyle} onClick=${getTypeThree}>
          show Planets that<br />planet.owner === me<br />planet.junkOwner !==
          me
        </button>
        <button style=${clearBtnStyle} onClick=${clearPlanets}>
          Clear Planets
        </button>
      </div>
      <div style=${{ marginTop: "8px", marginLeft: "10px", color: "#e4e4e4" }}>
        Showing ${planets.length} planet${planets.length !== 1 ? "s" : ""}
      </div>
    </div>
  `;
}

export default class Plugin {
  constructor() {
    this.container = null;
  }

  draw(ctx) {
    show_planets.forEach((p) => drawRound(ctx, p, "pink", 5, 1));
  }

  async render(container) {
    this.container = container;
    container.style.width = "450px";
    container.style.minHeight = "280px";
    render(html`<${App} />`, container);
  }

  destroy() {
    show_planets = [];
    if (this.container) {
      try {
        render(null, this.container);
      } catch (_) {}
      this.container = null;
    }
  }
}
