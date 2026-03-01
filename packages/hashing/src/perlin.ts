import { Fr } from "@aztec/aztec.js/fields";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import { PerlinConfig } from "@dfpunk/types";
import BigInt, { BigInteger } from "big-integer";
import { Fraction, IFraction } from "./fractions/bigFraction";
import { poseidon2HashSync } from "./poseidon";

const TRACK_LCM = false;

/**
 * A object containing a pair of x,y coordinates.
 */
export interface IntegerVector {
  x: number;
  y: number;
}

interface Vector {
  x: IFraction;
  y: IFraction;
}

interface GradientAtPoint {
  coords: Vector;
  gradient: Vector;
}

export type AsyncHashFn = (
  x: number,
  y: number,
  scale: number,
) => Promise<number>;

export type SyncHashFn = (x: number, y: number, scale: number) => number;

function toFr(n: number | bigint): Fr {
  const big = typeof n === "bigint" ? n : globalThis.BigInt(n);
  return new Fr(big < 0n ? big + Fr.MODULUS : big);
}

/**
 * Poseidon2-based rand for perlin gradient index.
 * Matches circuit: poseidon2_hash([key, corner_x, corner_y, scale]) % 16.
 */
export function poseidon2Rand(key: number): AsyncHashFn {
  return async (x: number, y: number, scale: number) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const scaleInt = Math.floor(scale);
    const result = await poseidon2Hash([
      toFr(key),
      toFr(cx),
      toFr(cy),
      toFr(scaleInt),
    ]);
    const hex = result.toString().replace(/^0x/, "");
    const n = globalThis.BigInt("0x" + hex);
    return Number(n % 16n);
  };
}

/**
 * Sync Poseidon2-based rand. Requires initPoseidon2() to have completed first.
 */
export function poseidon2RandSync(key: number): SyncHashFn {
  return (x: number, y: number, scale: number) => {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const scaleInt = Math.floor(scale);
    const result = poseidon2HashSync([
      toFr(key),
      toFr(cx),
      toFr(cy),
      toFr(scaleInt),
    ]);
    const hex = result.toString().replace(/^0x/, "");
    const n = globalThis.BigInt("0x" + hex);
    return Number(n % 16n);
  };
}

let vecs: Array<Vector>;
try {
  vecs = [
    [1000, 0],
    [923, 382],
    [707, 707],
    [382, 923],
    [0, 1000],
    [-383, 923],
    [-708, 707],
    [-924, 382],
    [-1000, 0],
    [-924, -383],
    [-708, -708],
    [-383, -924],
    [-1, -1000],
    [382, -924],
    [707, -708],
    [923, -383],
  ].map(([x, y]) => ({ x: new Fraction(x, 1000), y: new Fraction(y, 1000) }));
} catch (err) {
  console.error("Browser does not support BigInt.", err);
}

export const getRandomGradientAtAsync = async (
  point: Vector,
  scale: IFraction,
  randFn: AsyncHashFn,
): Promise<Vector> => {
  const index = await randFn(
    point.x.valueOf(),
    point.y.valueOf(),
    scale.valueOf(),
  );
  return vecs[Math.floor(index) % 16];
};

export const getRandomGradientAt = (
  point: Vector,
  scale: IFraction,
  randFn: SyncHashFn,
): Vector => {
  const index = randFn(point.x.valueOf(), point.y.valueOf(), scale.valueOf());
  return vecs[Math.floor(index) % 16];
};

const minus: (a: Vector, b: Vector) => Vector = (a, b) => {
  return {
    x: a.x.sub(b.x),
    y: a.y.sub(b.y),
  };
};

const dot: (a: Vector, b: Vector) => IFraction = (a, b) => {
  return a.x.mul(b.x).add(a.y.mul(b.y));
};

const smoothStep: (x: IFraction) => IFraction = (x) => {
  return x;
};

const scalarMultiply: (s: IFraction, v: Vector) => Vector = (s, v) => ({
  x: v.x.mul(s),
  y: v.y.mul(s),
});

const getWeight: (corner: Vector, p: Vector) => IFraction = (corner, p) => {
  return smoothStep(new Fraction(1).sub(p.x.sub(corner.x).abs())).mul(
    smoothStep(new Fraction(1).sub(p.y.sub(corner.y).abs())),
  );
};

const perlinValue: (
  corners: [GradientAtPoint, GradientAtPoint, GradientAtPoint, GradientAtPoint],
  scale: IFraction,
  p: Vector,
) => IFraction = (corners, scale, p) => {
  let ret = new Fraction(0);
  for (const corner of corners) {
    const distVec = minus(p, corner.coords);
    ret = ret.add(
      getWeight(
        scalarMultiply(scale.inverse(), corner.coords),
        scalarMultiply(scale.inverse(), p),
      ).mul(dot(scalarMultiply(scale.inverse(), distVec), corner.gradient)),
    );
  }
  return ret;
};

let runningLCM = BigInt(1);

const updateLCM = (oldLCM: BigInteger, newValue: BigInteger): BigInteger => {
  if (!TRACK_LCM) {
    return oldLCM;
  }

  const newLCM = BigInt.lcm(oldLCM, newValue);
  if (newLCM !== oldLCM) {
    console.log("LCM updated to ", newLCM);
  }

  return newLCM;
};

const realMod = (dividend: IFraction, divisor: IFraction): IFraction => {
  const temp = dividend.mod(divisor);
  if (temp.s.toString() === "-1") {
    return temp.add(divisor);
  }
  return temp;
};

const valueAtAsync = async (
  p: Vector,
  scale: IFraction,
  randFn: AsyncHashFn,
): Promise<IFraction> => {
  const bottomLeftCoords = {
    x: p.x.sub(realMod(p.x, scale)),
    y: p.y.sub(realMod(p.y, scale)),
  };
  const bottomRightCoords = {
    x: bottomLeftCoords.x.add(scale),
    y: bottomLeftCoords.y,
  };
  const topLeftCoords = {
    x: bottomLeftCoords.x,
    y: bottomLeftCoords.y.add(scale),
  };
  const topRightCoords = {
    x: bottomLeftCoords.x.add(scale),
    y: bottomLeftCoords.y.add(scale),
  };

  const [bottomLeftGrad, bottomRightGrad, topLeftGrad, topRightGrad] =
    await Promise.all([
      getRandomGradientAtAsync(bottomLeftCoords, scale, randFn),
      getRandomGradientAtAsync(bottomRightCoords, scale, randFn),
      getRandomGradientAtAsync(topLeftCoords, scale, randFn),
      getRandomGradientAtAsync(topRightCoords, scale, randFn),
    ]);

  const corners: [
    GradientAtPoint,
    GradientAtPoint,
    GradientAtPoint,
    GradientAtPoint,
  ] = [
    { coords: bottomLeftCoords, gradient: bottomLeftGrad },
    { coords: bottomRightCoords, gradient: bottomRightGrad },
    { coords: topLeftCoords, gradient: topLeftGrad },
    { coords: topRightCoords, gradient: topRightGrad },
  ];

  return perlinValue(corners, scale, p);
};

const valueAt = (
  p: Vector,
  scale: IFraction,
  randFn: SyncHashFn,
): IFraction => {
  const bottomLeftCoords = {
    x: p.x.sub(realMod(p.x, scale)),
    y: p.y.sub(realMod(p.y, scale)),
  };
  const bottomRightCoords = {
    x: bottomLeftCoords.x.add(scale),
    y: bottomLeftCoords.y,
  };
  const topLeftCoords = {
    x: bottomLeftCoords.x,
    y: bottomLeftCoords.y.add(scale),
  };
  const topRightCoords = {
    x: bottomLeftCoords.x.add(scale),
    y: bottomLeftCoords.y.add(scale),
  };

  const bottomLeftGrad = getRandomGradientAt(bottomLeftCoords, scale, randFn);
  const bottomRightGrad = getRandomGradientAt(bottomRightCoords, scale, randFn);
  const topLeftGrad = getRandomGradientAt(topLeftCoords, scale, randFn);
  const topRightGrad = getRandomGradientAt(topRightCoords, scale, randFn);

  const corners: [
    GradientAtPoint,
    GradientAtPoint,
    GradientAtPoint,
    GradientAtPoint,
  ] = [
    { coords: bottomLeftCoords, gradient: bottomLeftGrad },
    { coords: bottomRightCoords, gradient: bottomRightGrad },
    { coords: topLeftCoords, gradient: topLeftGrad },
    { coords: topRightCoords, gradient: topRightGrad },
  ];

  return perlinValue(corners, scale, p);
};

export const MAX_PERLIN_VALUE = 32;

/**
 * Calculates the perlin for a location using Poseidon2 for gradient index.
 * This is async because poseidon2Hash is WASM-based.
 * Matches the Noir circuit's multi_scale_perlin.
 */
export async function perlin(
  coords: IntegerVector,
  options: PerlinConfig,
): Promise<number> {
  return perlinWithRand(coords, options, poseidon2Rand(options.key));
}

/**
 * Async perlin using a custom rand function for gradient index.
 */
export async function perlinWithRand(
  coords: IntegerVector,
  options: PerlinConfig,
  randFn: AsyncHashFn,
): Promise<number> {
  let { x, y } = coords;
  if (options.mirrorY) x = Math.abs(x);
  if (options.mirrorX) y = Math.abs(y);
  const fractionalP = { x: new Fraction(x), y: new Fraction(y) };
  let ret = new Fraction(0);
  for (let i = 0; i < 3; i += 1) {
    const scale = new Fraction(options.scale * 2 ** i);
    const v = await valueAtAsync(fractionalP, scale, randFn);
    ret = ret.add(i === 0 ? v.add(v) : v);
  }
  ret = ret.div(4);
  runningLCM = updateLCM(runningLCM, BigInt(ret.d));
  ret = ret.mul(MAX_PERLIN_VALUE / 2);
  if (options.floor) ret = ret.floor();
  ret = ret.add(MAX_PERLIN_VALUE / 2);
  const out = ret.valueOf();
  return Math.floor(out * 100) / 100;
}

/**
 * Sync perlin using Poseidon2 for gradient index.
 * Requires initPoseidon2() to have completed first.
 */
export function perlinSync(
  coords: IntegerVector,
  options: PerlinConfig,
): number {
  return perlinWithRandSync(coords, options, poseidon2RandSync(options.key));
}

/**
 * Sync perlin using a custom sync rand function for gradient index.
 */
export function perlinWithRandSync(
  coords: IntegerVector,
  options: PerlinConfig,
  randFn: SyncHashFn,
): number {
  let { x, y } = coords;
  if (options.mirrorY) x = Math.abs(x);
  if (options.mirrorX) y = Math.abs(y);
  const fractionalP = { x: new Fraction(x), y: new Fraction(y) };
  let ret = new Fraction(0);
  for (let i = 0; i < 3; i += 1) {
    const scale = new Fraction(options.scale * 2 ** i);
    const v = valueAt(fractionalP, scale, randFn);
    ret = ret.add(i === 0 ? v.add(v) : v);
  }
  ret = ret.div(4);
  runningLCM = updateLCM(runningLCM, BigInt(ret.d));
  ret = ret.mul(MAX_PERLIN_VALUE / 2);
  if (options.floor) ret = ret.floor();
  ret = ret.add(MAX_PERLIN_VALUE / 2);
  const out = ret.valueOf();
  return Math.floor(out * 100) / 100;
}
