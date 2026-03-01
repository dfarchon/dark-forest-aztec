import {
  Fraction,
  getRandomGradientAt,
  poseidon2RandSync,
  type SyncHashFn,
} from "@dfpunk/hashing";
import { Abstract, PerlinConfig, Rectangle, WorldCoords } from "@dfpunk/types";

/* types */
type Vector = { x: number; y: number };
export const valueOf = (v: Vector): [number, number] => [
  v.x.valueOf(),
  v.y.valueOf(),
];

export type GridPoint = WorldCoords & { __value: never };

export type PerlinOctave = Abstract<number, "PerlinOctave">;

export const PerlinOctave = {
  _0: 0 as PerlinOctave,
  _1: 1 as PerlinOctave,
  _2: 2 as PerlinOctave,
};

/* grid point / rect utils */
export function right(topLeft: GridPoint, scale: number): GridPoint {
  return { x: topLeft.x + scale, y: topLeft.y } as GridPoint;
}

export function up(topLeft: GridPoint, scale: number): GridPoint {
  return { x: topLeft.x, y: topLeft.y + scale } as GridPoint;
}

export function isGridPoint(
  coords: WorldCoords,
  scale: number,
): coords is GridPoint {
  const isGrid = coords.x % scale === 0 && coords.y % scale === 0;
  if (!isGrid) throw "tried to get gradient of a non-grid point!";

  return isGrid;
}

export function getGridPoint(
  bottomLeft: WorldCoords,
  scale: number,
): GridPoint {
  const { x, y } = bottomLeft;
  return {
    x: Math.floor(x / scale) * scale,
    y: Math.floor(y / scale) * scale,
  } as GridPoint;
}

export function getPerlinChunks(
  footprint: Rectangle,
  lengthScale: number,
): Iterable<Rectangle> {
  const { bottomLeft, sideLength } = footprint;
  if (sideLength <= lengthScale)
    throw "getPerlinChunks called on a small chunk";

  const perlinChunks: Set<Rectangle> = new Set();

  perlinChunks.add(footprint);

  for (let x = bottomLeft.x; x < bottomLeft.x + sideLength; x += lengthScale) {
    for (
      let y = bottomLeft.y;
      y < bottomLeft.y + sideLength;
      y += lengthScale
    ) {
      perlinChunks.add({ bottomLeft: { x, y }, sideLength: lengthScale });
    }
  }

  return perlinChunks;
}

/* gradient caching */
function gradientKey(
  quadrant: Quadrant,
  coords: GridPoint,
  config: PerlinConfig,
  pow: PerlinOctave,
): string {
  return `${config.key}-${config.scale}-${pow}-${coords.x}-${coords.y}-${quadrant}`;
}

const gradientCache: Map<string, Vector> = new Map();

const syncRandFns: { [k: number]: SyncHashFn } = {};

export type Quadrant = Abstract<string, "Quadrant">;

export const Quadrant = {
  TopRight: "TopRight" as Quadrant,
  TopLeft: "TopLeft" as Quadrant,
  BottomLeft: "BottomLeft" as Quadrant,
  BottomRight: "BottomRight" as Quadrant,
};

export function getQuadrant(bottomLeft: GridPoint): Quadrant {
  const { x, y } = bottomLeft;

  if (x >= 0 && y >= 0) {
    return Quadrant.TopRight;
  } else if (x < 0 && y >= 0) {
    return Quadrant.TopLeft;
  } else if (x < 0 && y < 0) {
    return Quadrant.BottomLeft;
  }
  return Quadrant.BottomRight;
}

function applyMirror(
  res: {
    x: { valueOf(): number; mul(n: number): { valueOf(): number } };
    y: { valueOf(): number; mul(n: number): { valueOf(): number } };
  },
  config: PerlinConfig,
  quadrant: Quadrant,
): Vector {
  let rx = res.x.valueOf();
  let ry = res.y.valueOf();

  if (
    config.mirrorY &&
    (quadrant === Quadrant.TopLeft || quadrant === Quadrant.BottomLeft)
  ) {
    rx = -rx;
  }

  if (
    config.mirrorX &&
    (quadrant === Quadrant.BottomLeft || quadrant === Quadrant.BottomRight)
  ) {
    ry = -ry;
  }

  return { x: rx, y: ry };
}

/**
 * Synchronous gradient lookup. Computes on cache miss using sync Poseidon2.
 * Requires initPoseidon2() to have completed before first call.
 */
export function getCachedGradient(
  quadrant: Quadrant,
  coords: GridPoint,
  config: PerlinConfig,
  pow: PerlinOctave,
): Vector {
  const gradKey = gradientKey(quadrant, coords, config, pow);

  const cached = gradientCache.get(gradKey);
  if (cached) return cached;

  const { scale, key } = config;

  let myRand = syncRandFns[key];
  if (!myRand) {
    myRand = poseidon2RandSync(key);
    syncRandFns[key] = myRand;
  }

  const res = getRandomGradientAt(
    {
      x: new Fraction(config.mirrorY ? Math.abs(coords.x) : coords.x),
      y: new Fraction(config.mirrorX ? Math.abs(coords.y) : coords.y),
    },
    new Fraction(scale * 2 ** pow),
    myRand,
  );

  const ret = applyMirror(res, config, quadrant);
  gradientCache.set(gradKey, ret);
  return ret;
}
