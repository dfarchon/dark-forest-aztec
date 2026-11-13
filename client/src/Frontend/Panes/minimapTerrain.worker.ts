import { initPoseidon2, perlin } from "@dfpunk/hashing";

/**
 * Space-type bands painted by MiniMapPane:
 * 0 inner, 1 nebula, 2 space, 3 deep, 4 dead.
 */
export type TerrainRequest = {
  id: number;
  radius: number;
  samples: number;
  key: number;
  scale: number;
  mirrorX: boolean;
  mirrorY: boolean;
  t1: number;
  t2: number;
  t3: number;
};

export type TerrainResponse = {
  id: number;
  radius: number;
  xs: Float32Array;
  ys: Float32Array;
  bands: Uint8Array;
};

const scope = self as unknown as Worker;

let ready: Promise<void> | null = null;
let latestId = 0;

function bandForPerlin(
  value: number,
  t1: number,
  t2: number,
  t3: number
): number {
  if (value < t1 * 0.55) return 0;
  if (value < t1) return 1;
  if (value < t2) return 2;
  if (value < t3) return 3;
  return 4;
}

function sampleTerrain(req: TerrainRequest) {
  if (req.id !== latestId) return;

  const { radius, samples, t1, t2, t3 } = req;
  const step = (radius * 2) / samples;
  const limit = radius + step * 0.01;
  const options = {
    key: req.key,
    scale: req.scale,
    mirrorX: req.mirrorX,
    mirrorY: req.mirrorY,
    floor: false,
  };

  const xs: number[] = [];
  const ys: number[] = [];
  const bands: number[] = [];

  for (let x = -radius; x <= limit; x += step) {
    for (let y = -radius; y <= limit; y += step) {
      if (x * x + y * y > radius * radius) continue;
      xs.push(x);
      ys.push(y);
      bands.push(bandForPerlin(perlin({ x, y }, options), t1, t2, t3));
    }
  }

  const xBuf = new Float32Array(xs);
  const yBuf = new Float32Array(ys);
  const bandBuf = new Uint8Array(bands);
  const message: TerrainResponse = {
    id: req.id,
    radius,
    xs: xBuf,
    ys: yBuf,
    bands: bandBuf,
  };
  scope.postMessage(message, [xBuf.buffer, yBuf.buffer, bandBuf.buffer]);
}

scope.addEventListener("message", (event: MessageEvent<TerrainRequest>) => {
  const req = event.data;
  latestId = req.id;
  if (!ready) ready = initPoseidon2();
  ready
    .then(() => sampleTerrain(req))
    .catch((err) => {
      ready = null;
      console.error("minimap terrain worker failed", err);
    });
});
