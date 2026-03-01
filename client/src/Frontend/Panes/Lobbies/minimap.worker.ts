import { initPoseidon2, perlinSync } from "@dfpunk/hashing";
import { SpaceType, WorldCoords } from "@dfpunk/types";

import { DrawMessage, MinimapConfig } from "./MinimapUtils";

const ctx = self as unknown as Worker;

let poseidonReady = false;
const poseidonInit = initPoseidon2().then(() => {
  poseidonReady = true;
});

function spaceTypePerlin(coords: WorldCoords, config: MinimapConfig): number {
  return perlinSync(coords, { ...config, floor: true });
}

function spaceTypeFromPerlin(perlin: number, config: MinimapConfig): SpaceType {
  if (perlin < config.perlinThreshold1) {
    return SpaceType.NEBULA;
  } else if (perlin < config.perlinThreshold2) {
    return SpaceType.SPACE;
  } else if (perlin < config.perlinThreshold3) {
    return SpaceType.DEEP_SPACE;
  } else {
    return SpaceType.DEAD_SPACE;
  }
}

async function generate(config: MinimapConfig): Promise<DrawMessage> {
  if (!poseidonReady) await poseidonInit;

  const data = [];
  const step = config.worldRadius / 25;

  const radius = config.worldRadius;

  const checkBounds = (
    a: number,
    b: number,
    x: number,
    y: number,
    r: number
  ) => {
    const dist = (a - x) * (a - x) + (b - y) * (b - y);
    r *= r;
    return dist < r;
  };

  for (let i = radius * -1; i < radius; i += step) {
    for (let j = radius * -1; j < radius; j += step) {
      if (checkBounds(0, 0, i, j, radius)) {
        const per = spaceTypePerlin({ x: i, y: j }, config);
        data.push({
          x: i,
          y: j,
          type: spaceTypeFromPerlin(per, config),
        });
      }
    }
  }

  return { radius, data };
}

ctx.addEventListener("message", (e: MessageEvent) => {
  if (e.data) {
    void generate(JSON.parse(e.data)).then((msg) => {
      ctx.postMessage(JSON.stringify(msg));
    });
  }
});
