import assert from "node:assert/strict";
import test from "node:test";

import { decodePlanet } from "@dfpunk/serde";

import { HIGH_LEVEL_PLANET } from "../../contracts/scripts/check/high-level-planet-sample.ts";
import { uiAmountToContract } from "../src/Session/TxExecutor/stateConvert.ts";

const LOCATION =
  "0x0000000000000000000000000000000000000000000000000000000000001234";

// Contract populations around and above the level 8 rank 3 sizes, including
// values that are not multiples of CONTRACT_PRECISION.
const POPULATIONS: bigint[] = [
  1_209_600_000n,
  1_209_599_999n,
  2_147_483_647n,
  2_147_483_649n,
  2_419_200_000n,
  2_419_199_001n,
  4_294_967_297n,
  7_962_624_000n,
  16_000_000_000n,
  16_000_000_007n,
];

function chainPlanet(population: bigint) {
  return {
    ...HIGH_LEVEL_PLANET,
    population_cap:
      population > HIGH_LEVEL_PLANET.population_cap
        ? population
        : HIGH_LEVEL_PLANET.population_cap,
    population,
  };
}

// Path used by a move: chain state -> decodePlanet (UI energy) -> percent of it ->
// uiAmountToContract (popMoved). The contract rejects popMoved > population with
// "Tried to move more population that what exists".
test("sending 100% of the displayed energy never exceeds chain population", () => {
  for (const population of POPULATIONS) {
    const planet = decodePlanet(LOCATION, chainPlanet(population));
    const popMoved = uiAmountToContract(planet.energy);
    assert.ok(
      popMoved <= population,
      `population ${population}: popMoved ${popMoved}`
    );
    assert.ok(
      population - popMoved <= 1n,
      `population ${population}: lost ${population - popMoved}`
    );
  }
});

test("partial sends of the displayed energy never exceed chain population", () => {
  for (const population of POPULATIONS) {
    const planet = decodePlanet(LOCATION, chainPlanet(population));
    for (const percent of [99.9, 99, 75, 50, 25, 1, 0.1]) {
      const popMoved = uiAmountToContract((planet.energy * percent) / 100);
      assert.ok(
        popMoved <= population,
        `population ${population}, ${percent}%`
      );
      assert.ok(
        popMoved > 0n,
        `population ${population}, ${percent}% rounds to 0`
      );
    }
  }
});

test("level 8 rank 3 energy cap survives the UI round trip exactly", () => {
  for (const cap of [1_209_600_000n, 2_419_200_000n, 7_962_624_000n]) {
    const planet = decodePlanet(LOCATION, {
      ...HIGH_LEVEL_PLANET,
      population_cap: cap,
    });
    assert.equal(uiAmountToContract(planet.energyCap), cap);
  }
});
