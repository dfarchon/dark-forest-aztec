import { fakeHash, seededRandom } from "./fakeHash";
import { Fraction } from "./fractions/bigFraction";
import {
  getRandomGradientAt,
  getRandomGradientAtAsync,
  MAX_PERLIN_VALUE,
  perlin,
  perlinWithRand,
  poseidon2RandForPerlin,
} from "./perlin";
import type { IntegerVector } from "./perlin";

export {
  perlin,
  perlinWithRand,
  poseidon2RandForPerlin,
  getRandomGradientAt,
  getRandomGradientAtAsync,
  fakeHash,
  seededRandom,
  Fraction,
  MAX_PERLIN_VALUE,
};
export type { IntegerVector, AsyncHashFn } from "./perlin";
