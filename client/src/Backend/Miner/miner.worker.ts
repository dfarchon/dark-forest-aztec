import { Fr } from "@aztec/aztec.js/fields";
import { poseidon2Hash } from "@aztec/foundation/crypto/poseidon";
import { LOCATION_ID_UB } from "@dfpunk/constants";
import { perlin } from "@dfpunk/hashing";
import { locationIdFromBigInt } from "@dfpunk/serde";
import { Chunk, PerlinConfig, Rectangle, WorldLocation } from "@dfpunk/types";

import { MinerWorkerMessage } from "../../_types/global/GlobalTypes";
import { getPlanetLocations } from "./permutation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ctx: Worker = self as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const toFr = (n: number): Fr => {
  const v = BigInt(n);
  return new Fr(v < 0n ? v + Fr.MODULUS : v);
};

const exploreChunk = async (
  chunkFootprint: Rectangle,
  workerIndex: number,
  totalWorkers: number,
  planetRarity: number,
  jobId: number,
  useFakeHash: boolean,
  planetHashKey: number,
  spaceTypeKey: number,
  biomebaseKey: number,
  perlinLengthScale: number,
  perlinMirrorX: boolean,
  perlinMirrorY: boolean
) => {
  const planetHashFn = async (x: number, y: number): Promise<bigint> => {
    const result = await poseidon2Hash([
      new Fr(BigInt(planetHashKey)),
      toFr(x),
      toFr(y),
    ]);
    const hexString = result.toString().replace(/^0x/, "");
    return BigInt("0x" + hexString);
  };

  const spaceTypePerlinOpts: PerlinConfig = {
    key: spaceTypeKey,
    scale: perlinLengthScale,
    mirrorX: perlinMirrorX,
    mirrorY: perlinMirrorY,
    floor: true,
  };
  const biomebasePerlinOpts: PerlinConfig = {
    key: biomebaseKey,
    scale: perlinLengthScale,
    mirrorX: perlinMirrorX,
    mirrorY: perlinMirrorY,
    floor: true,
  };

  let planetLocations: WorldLocation[] = [];
  if (useFakeHash) {
    planetLocations =
      workerIndex > 0
        ? []
        : await getPlanetLocations(
            spaceTypeKey,
            biomebaseKey,
            perlinLengthScale,
            perlinMirrorY,
            perlinMirrorY
          )(chunkFootprint, planetRarity);
  } else {
    const locationIdUpperBound = LOCATION_ID_UB / BigInt(planetRarity);
    let count = 0;
    const { x: bottomLeftX, y: bottomLeftY } = chunkFootprint.bottomLeft;
    const { sideLength } = chunkFootprint;
    for (let x = bottomLeftX; x < bottomLeftX + sideLength; x++) {
      for (let y = bottomLeftY; y < bottomLeftY + sideLength; y++) {
        if (count % totalWorkers === workerIndex) {
          const hash = await planetHashFn(x, y);
          if (hash < locationIdUpperBound) {
            const [perlinVal, biomebaseVal] = await Promise.all([
              perlin({ x, y }, spaceTypePerlinOpts),
              perlin({ x, y }, biomebasePerlinOpts),
            ]);
            planetLocations.push({
              coords: { x, y },
              hash: locationIdFromBigInt(hash),
              perlin: perlinVal,
              biomebase: biomebaseVal,
            });
          }
        }
        count += 1;
      }
    }
  }
  const chunkCenter = {
    x: chunkFootprint.bottomLeft.x + chunkFootprint.sideLength / 2,
    y: chunkFootprint.bottomLeft.y + chunkFootprint.sideLength / 2,
  };
  const chunkData: Chunk = {
    chunkFootprint,
    planetLocations,
    perlin: await perlin(chunkCenter, {
      ...spaceTypePerlinOpts,
      floor: false,
    }),
  };
  ctx.postMessage(JSON.stringify([chunkData, jobId]));
};

ctx.addEventListener("message", (e: MessageEvent) => {
  const exploreMessage: MinerWorkerMessage = JSON.parse(
    e.data
  ) as MinerWorkerMessage;

  void exploreChunk(
    exploreMessage.chunkFootprint,
    exploreMessage.workerIndex,
    exploreMessage.totalWorkers,
    exploreMessage.planetRarity,
    exploreMessage.jobId,
    exploreMessage.useMockHash,
    exploreMessage.planetHashKey,
    exploreMessage.spaceTypeKey,
    exploreMessage.biomebaseKey,
    exploreMessage.perlinLengthScale,
    exploreMessage.perlinMirrorX,
    exploreMessage.perlinMirrorY
  );
});
