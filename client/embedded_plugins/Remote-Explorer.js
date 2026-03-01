/**
 * Remote Explorer — Use a remote server to explore chunks (mining pattern + worker).
 * Embedded plugin for dfpunk-aztec. Uses df + ui. Aligned with current hash/mining API.
 * Add explore server URL, pick pattern, then target on map or start from origin.
 */

import {
  html,
  render,
  useEffect,
  useState,
} from "https://unpkg.com/htm/preact/standalone.module.js";

const NEW_CHUNK = "DiscoveredNewChunk";

function locationIdFromDecStr(s) {
  const bi = BigInt(s);
  let h = bi.toString(16);
  while (h.length < 64) h = "0" + h;
  return h;
}

function getPattern(coords, patternType, chunkSize) {
  const constructors =
    typeof df.getConstructors === "function" ? df.getConstructors() : {};
  const {
    SwissCheesePattern,
    SpiralPattern,
    TowardsCenterPattern,
    TowardsCenterPatternV2,
  } = constructors;
  if (patternType === "swiss" && SwissCheesePattern)
    return new SwissCheesePattern(coords, chunkSize);
  if (patternType === "towardsCenter" && TowardsCenterPattern)
    return new TowardsCenterPattern(coords, chunkSize);
  if (patternType === "towardsCenterV2" && TowardsCenterPatternV2)
    return new TowardsCenterPatternV2(coords, chunkSize);
  if (SpiralPattern) return new SpiralPattern(coords, chunkSize);
  return null;
}

class RemoteWorker {
  constructor(url) {
    this.url = url;
  }

  async postMessage(msg) {
    try {
      const msgJson = JSON.parse(msg);
      const resp = await fetch(this.url, {
        method: "POST",
        body: JSON.stringify({
          chunkFootprint: msgJson.chunkFootprint,
          planetRarity: msgJson.planetRarity,
          planetHashKey: msgJson.planetHashKey,
        }),
        headers: { "Content-Type": "application/json" },
      });
      const exploredChunk = await resp.json();
      const chunkCenter = {
        x:
          exploredChunk.chunkFootprint.bottomLeft.x +
          exploredChunk.chunkFootprint.sideLength / 2,
        y:
          exploredChunk.chunkFootprint.bottomLeft.y +
          exploredChunk.chunkFootprint.sideLength / 2,
      };
      if (typeof df.spaceTypePerlin === "function")
        exploredChunk.perlin = df.spaceTypePerlin(chunkCenter, false);

      const locs = exploredChunk.planetLocations || [];
      for (const planetLoc of locs) {
        if (planetLoc.hash != null)
          planetLoc.hash = locationIdFromDecStr(String(planetLoc.hash));
        if (typeof df.spaceTypePerlin === "function" && planetLoc.coords)
          planetLoc.perlin = df.spaceTypePerlin(planetLoc.coords, true);
        if (typeof df.biomebasePerlin === "function" && planetLoc.coords)
          planetLoc.biomebase = df.biomebasePerlin(planetLoc.coords, true);
      }

      if (this.onmessage)
        this.onmessage({
          data: JSON.stringify([exploredChunk, msgJson.jobId]),
        });
    } catch (err) {
      console.error("RemoteWorker error:", err);
      if (this.onerror) this.onerror(err);
    }
  }

  terminate() {}
}

const inputStyle = {
  flex: 1,
  padding: "6px 8px",
  outline: "none",
  color: "#e4e4e4",
  background: "#3d444c",
  border: "1px solid #5a6268",
  borderRadius: "4px",
};
const btnStyle = {
  marginLeft: "8px",
  padding: "6px 12px",
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  cursor: "pointer",
};
const selectStyle = {
  padding: "6px 8px",
  background: "#3d444c",
  color: "#e4e4e4",
  border: "1px solid #5a6268",
  borderRadius: "4px",
  marginLeft: "8px",
};

function TargetIcon() {
  return html`
    <span
      style="display:inline-block;width:1em;height:1em;vertical-align:text-bottom;"
    >
      <svg width="100%" height="100%" viewBox="0 0 512 512" fill="white">
        <path
          d="M512 224h-50.462c-13.82-89.12-84.418-159.718-173.538-173.538v-50.462h-64v50.462c-89.12 13.82-159.718 84.418-173.538 173.538h-50.462v64h50.462c13.82 89.12 84.418 159.718 173.538 173.538v50.462h64v-50.462c89.12-13.82 159.718-84.418 173.538-173.538h50.462v-64zM396.411 224h-49.881c-9.642-27.275-31.255-48.889-58.53-58.53v-49.881c53.757 12.245 96.166 54.655 108.411 108.411zM256 288c-17.673 0-32-14.327-32-32s14.327-32 32-32c17.673 0 32 14.327 32 32s-14.327 32-32 32zM224 115.589v49.881c-27.275 9.641-48.889 31.255-58.53 58.53h-49.881c12.245-53.756 54.655-96.166 108.411-108.411zM115.589 288h49.881c9.641 27.275 31.255 48.889 58.53 58.53v49.881c-53.756-12.245-96.166-54.654-108.411-108.411zM288 396.411v-49.881c27.275-9.642 48.889-31.255 58.53-58.53h49.881c-12.245 53.757-54.654 96.166-108.411 108.411z"
        />
      </svg>
    </span>
  `;
}

function MinerUI({ miner, onRemove }) {
  const [hashRate, setHashRate] = useState(0);

  useEffect(() => {
    if (!miner || typeof miner.on !== "function") return;
    const onChunk = (chunk, miningTimeMillis) => {
      if (typeof df.addNewChunk === "function") df.addNewChunk(chunk);
      const rate =
        chunk?.chunkFootprint?.sideLength != null && miningTimeMillis > 0
          ? Math.floor(
              chunk.chunkFootprint.sideLength ** 2 / (miningTimeMillis / 1000)
            )
          : 0;
      setHashRate(rate);
      const res =
        typeof miner.getCurrentlyExploringChunk === "function"
          ? miner.getCurrentlyExploringChunk()
          : null;
      if (
        res?.bottomLeft != null &&
        res?.sideLength != null &&
        typeof ui?.setExtraMinerLocation === "function"
      ) {
        ui.setExtraMinerLocation(miner.id, {
          x: res.bottomLeft.x + res.sideLength / 2,
          y: res.bottomLeft.y + res.sideLength / 2,
        });
      } else if (typeof ui?.removeExtraMinerLocation === "function") {
        ui.removeExtraMinerLocation(miner.id);
      }
    };
    miner.on(NEW_CHUNK, onChunk);
    return () => miner.off(NEW_CHUNK, onChunk);
  }, [miner]);

  const [targeting, setTargeting] = useState(false);

  useEffect(() => {
    if (!targeting || !miner) return;
    const hover = () => {
      const coords = ui?.getHoveringOverCoords?.();
      if (coords && typeof ui?.setExtraMinerLocation === "function")
        ui.setExtraMinerLocation(miner.id, coords);
    };
    const click = () => {
      window.removeEventListener("mousemove", hover);
      window.removeEventListener("click", click);
      const coords = ui?.getHoveringOverCoords?.();
      if (coords) {
        const pattern = getPattern(coords, miner.patternType, miner.chunkSize);
        if (pattern && typeof miner.setMiningPattern === "function")
          miner.setMiningPattern(pattern);
      }
      if (typeof miner.startExplore === "function") miner.startExplore();
      setTargeting(false);
    };
    if (typeof miner.stopExplore === "function") miner.stopExplore();
    window.addEventListener("mousemove", hover);
    window.addEventListener("click", click);
    return () => {
      window.removeEventListener("mousemove", hover);
      window.removeEventListener("click", click);
    };
  }, [targeting, miner]);

  const remove = () => onRemove(miner);

  return html`
    <div
      style="padding-bottom:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;"
    >
      <span style="min-width:0; flex:1;"
        >${miner.url} – ${hashRate} hashes/sec</span
      >
      <div style="display:flex; gap:6px;">
        <button style=${btnStyle} onClick=${() => setTargeting(true)}>
          <${TargetIcon} />
        </button>
        <button
          style=${{ ...btnStyle, background: "#6b2d2d" }}
          onClick=${remove}
        >
          X
        </button>
      </div>
    </div>
  `;
}

function App({ initialMiners = [], addMiner, removeMiner }) {
  const [miners, setMiners] = useState(initialMiners);
  const [nextUrl, setNextUrl] = useState("");
  const [patternType, setPatternType] = useState("spiral");

  const add = () => {
    const url = (nextUrl || "").trim();
    if (url) {
      const next = addMiner(url, patternType);
      setMiners(next);
      setNextUrl("");
    }
  };

  const remove = (miner) => {
    setMiners(removeMiner(miner));
  };

  return html`
    <div>
      ${miners.map(
        (miner) =>
          html`<${MinerUI}
            key=${miner.url}
            miner=${miner}
            onRemove=${remove}
          />`
      )}
      <div
        style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:12px;"
      >
        <input
          type="text"
          style=${inputStyle}
          value=${nextUrl}
          onInput=${(e) => setNextUrl(e.target?.value ?? "")}
          placeholder="URL for explore server"
        />
        <select
          style=${selectStyle}
          value=${patternType}
          onChange=${(e) => setPatternType(e.target?.value)}
        >
          <option value="spiral">Spiral</option>
          <option value="swiss">Swiss</option>
          <option value="towardsCenter">TowardsCenter</option>
          <option value="towardsCenterV2">TowardsCenterV2</option>
        </select>
        <button style=${btnStyle} onClick=${add}>Explore!</button>
      </div>
    </div>
  `;
}

export default class Plugin {
  constructor() {
    this.miners = [];
    this.id = 0;
  }

  addMiner = (url, patternType = "spiral", chunkSize = 256) => {
    const constructors =
      typeof df.getConstructors === "function" ? df.getConstructors() : {};
    const Miner = constructors.MinerManager;
    if (!Miner || typeof Miner.create !== "function") {
      console.warn(
        "Remote Explorer: getConstructors().MinerManager not available"
      );
      return this.miners;
    }
    const chunkStore =
      typeof df.getChunkStore === "function" ? df.getChunkStore() : null;
    const worldRadius =
      typeof df.getWorldRadius === "function" ? df.getWorldRadius() : 0;
    const planetRarity = df?.planetRarity ?? 16;
    const hashConfig =
      typeof df.getHashConfig === "function" ? df.getHashConfig() : null;
    if (!chunkStore || !hashConfig) {
      console.warn(
        "Remote Explorer: getChunkStore or getHashConfig not available"
      );
      return this.miners;
    }
    const pattern = getPattern({ x: 0, y: 0 }, patternType, chunkSize);
    if (!pattern) {
      console.warn("Remote Explorer: pattern not available");
      return this.miners;
    }
    const miner = Miner.create(
      chunkStore,
      pattern,
      worldRadius,
      planetRarity,
      hashConfig,
      false,
      () => new RemoteWorker(url)
    );
    miner.url = url;
    miner.id = this.id++;
    miner.chunkSize = chunkSize;
    miner.patternType = patternType;
    if (typeof miner.startExplore === "function") miner.startExplore();
    this.miners.push(miner);
    return this.miners;
  };

  removeMiner = (miner) => {
    this.miners = this.miners.filter((m) => {
      if (m !== miner) return true;
      if (typeof ui?.removeExtraMinerLocation === "function")
        ui.removeExtraMinerLocation(m.id);
      if (typeof m.stopExplore === "function") m.stopExplore();
      if (typeof m.destroy === "function") m.destroy();
      return false;
    });
    return this.miners;
  };

  async render(container) {
    container.style.minWidth = "450px";
    container.style.width = "auto";
    render(
      html`<${App}
        initialMiners=${this.miners}
        addMiner=${this.addMiner}
        removeMiner=${this.removeMiner}
      />`,
      container
    );
  }

  destroy() {
    for (const miner of this.miners) {
      if (typeof ui?.removeExtraMinerLocation === "function")
        ui.removeExtraMinerLocation(miner.id);
      if (typeof miner.stopExplore === "function") miner.stopExplore();
      if (typeof miner.destroy === "function") miner.destroy();
    }
    this.miners = [];
  }
}
