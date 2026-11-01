import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  HIGH_LEVEL_PLANET,
  HIGH_LEVEL_PLANET_LABEL,
} from "../../contracts/scripts/check/high-level-planet-sample.ts";
import { planetToContract } from "../src/Session/TxExecutor/stateConvert.ts";
import { computePlanetHash } from "../src/Session/TxExecutor/stateHash.ts";

// Hash the Noir test contracts/tests/state_hash checks for the same planet.
function noirHash(): string {
  const source = fs.readFileSync(
    path.resolve(
      import.meta.dirname,
      "../../contracts/tests/state_hash/src/vectors.nr"
    ),
    "utf-8"
  );
  const start = source.indexOf(`// ${HIGH_LEVEL_PLANET_LABEL}`);
  assert.ok(start >= 0, "high level planet sample missing from vectors.nr");
  const hash = source.slice(start).match(/\},\s*(0x[0-9a-f]+)/)?.[1];
  assert.ok(hash, "hash for the high level planet sample not found");
  return hash;
}

// The move and upgrade resolvers send planetToContract(indexer state) to the
// contract, which hashes it and compares against storage. Any drift here makes
// every action on the planet revert with "Planet state hash mismatch".
test("level 8 rank 3 planet hashes like the contract after planetToContract", async () => {
  const hash = await computePlanetHash(planetToContract(HIGH_LEVEL_PLANET));
  assert.equal(BigInt(hash.toString()), BigInt(noirHash()));
});
