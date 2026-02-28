import { fakeHash, seededRandom } from "./fakeHash";
import { Fraction } from "./fractions/bigFraction";
import mimcHash, { mimcSponge, modPBigInt, modPBigIntNative } from "./mimc";
import {
  getRandomGradientAt,
  getRandomGradientAtAsync,
  MAX_PERLIN_VALUE,
  perlin,
  perlinWithRand,
  rand,
} from "./perlin";
import type { IntegerVector } from "./perlin";

export {
  mimcHash,
  mimcSponge,
  perlin,
  perlinWithRand,
  rand,
  getRandomGradientAt,
  getRandomGradientAtAsync,
  modPBigInt,
  modPBigIntNative,
  fakeHash,
  seededRandom,
  Fraction,
  MAX_PERLIN_VALUE,
};
export type { IntegerVector, AsyncHashFn } from "./perlin";
