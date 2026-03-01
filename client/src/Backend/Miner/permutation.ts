import { fakeHash, perlin, seededRandom } from "@dfpunk/hashing";
import { locationIdFromBigInt } from "@dfpunk/serde";
import { Rectangle, WorldCoords, WorldLocation } from "@dfpunk/types";

type IdxWithRand = {
  idx: number;
  rand: number;
};

const SIZE = 65536; // we permute 256x256 grids of 256x256 mega-chunks
let globalSeed = 1;

const globalRandom = () => {
  return seededRandom(globalSeed++);
};

const arr: IdxWithRand[] = [];
for (let i = 0; i < SIZE; i += 1) {
  arr.push({
    idx: i,
    rand: globalRandom(),
  });
}
arr.sort((a, b) => a.rand - b.rand);
const lookup = arr.map((a) => a.idx);
const lookupInv = Array(SIZE).fill(0);
for (let i = 0; i < SIZE; i += 1) {
  lookupInv[lookup[i]] = i;
}

// return the number in [0, n) congruent to m (mod n)
const posMod = (m: number, n: number) => {
  const val = Math.floor(m / n) * n;
  return m - val;
};

// permutation by lookup table
const sigma = (x: number, y: number) => {
  const val = 256 * x + y;
  const idx = posMod(val, SIZE);
  const ret: [number, number] = [
    Math.floor(lookup[idx] / 256),
    lookup[idx] % 256,
  ];
  return ret;
};

const sigmaInv = (x: number, y: number) => {
  const val = 256 * x + y;
  const idx = posMod(val, SIZE);
  const ret: [number, number] = [
    Math.floor(lookupInv[idx] / 256),
    lookupInv[idx] % 256,
  ];
  return ret;
};

// cyclic permutation
const cyc = (m: number, n: number) => (r: number, s: number) => {
  const val = posMod(256 * (r + m) + (s + n), SIZE);
  const ret: [number, number] = [Math.floor(val / 256), val % 256];
  return ret;
};

const cycInv = (m: number, n: number) => (r: number, s: number) => {
  return cyc(-m, -n)(r, s);
};

export const getPlanetLocations =
  (
    spaceTypeKey: number,
    biomebaseKey: number,
    perlinLengthScale: number,
    perlinMirrorX: boolean,
    perlinMirrorY: boolean
  ) =>
  async (
    chunkFootprint: Rectangle,
    planetRarity: number
  ): Promise<WorldLocation[]> => {
    const { bottomLeft, sideLength } = chunkFootprint;
    const { x, y } = bottomLeft;
    const m = Math.floor(x / 256);
    const n = Math.floor(y / 256);
    const [mPrime, nPrime] = sigma(m, n);
    const postImages: [number, number][] = [];
    for (let i = 0; i < SIZE / planetRarity; i += 1) {
      postImages.push([Math.floor(i / 256), i % 256]);
    }
    const preImages: [number, number][] = [];
    for (const postImage of postImages) {
      preImages.push(
        sigmaInv(
          ...cycInv(mPrime, nPrime)(...sigmaInv(postImage[0], postImage[1]))
        )
      );
    }
    const allCoords: WorldCoords[] = preImages.map((preImage) => ({
      x: m * 256 + preImage[0],
      y: n * 256 + preImage[1],
    }));

    const filtered = allCoords.filter(
      (c) =>
        c.x - bottomLeft.x < sideLength &&
        c.x >= bottomLeft.x &&
        c.y - bottomLeft.y < sideLength &&
        c.y >= bottomLeft.y
    );

    const locs: WorldLocation[] = [];
    for (const c of filtered) {
      locs.push({
        coords: c,
        hash: locationIdFromBigInt(
          BigInt(fakeHash(planetRarity)(c.x, c.y).toString())
        ),
        perlin: await perlin(c, {
          key: spaceTypeKey,
          scale: perlinLengthScale,
          mirrorX: perlinMirrorX,
          mirrorY: perlinMirrorY,
          floor: true,
        }),
        biomebase: await perlin(c, {
          key: biomebaseKey,
          scale: perlinLengthScale,
          mirrorX: perlinMirrorX,
          mirrorY: perlinMirrorY,
          floor: true,
        }),
      });
    }

    return locs;
  };
