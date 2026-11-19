import assert from "node:assert/strict";
import test from "node:test";
import { effectivePlanetStat } from "../../packages/serde/src/artifactStats.ts";
import { formatNumber } from "../../packages/gamelogic/src/number.ts";
import { HIGH_LEVEL_PLANET } from "../../contracts/scripts/check/high-level-planet-sample.ts";
import { getRefreshedPopulationAndSilver } from "../src/Session/TxExecutor/MoveSimulation.ts";

test("the client projects each stat from its base and preserves a rounded zero", () => {
  const packed =
    105n | (110n << 10n) | (20n << 20n) | (25n << 30n) | (10n << 40n);
  assert.equal(effectivePlanetStat(7n, packed, "defense"), 0n);
  assert.equal(effectivePlanetStat(7n, 0n, "defense"), 7n);
  assert.equal(effectivePlanetStat(23n, packed, "range"), 4n);
  assert.equal(effectivePlanetStat(23n, packed, "speed"), 5n);
  assert.equal(effectivePlanetStat(23n, packed, "population_cap"), 24n);
  const planet = {
    ...HIGH_LEVEL_PLANET,
    population: 1n,
    population_growth: 19n,
    artifact_multipliers: packed,
  };
  const { population } = getRefreshedPopulationAndSilver(
    Number(planet.last_updated) + 1,
    planet,
    { count: 0, events: [], last_updated: 0n },
    []
  );
  assert.equal(population, 21n);
});

test("attack labels handle non-finite values", () => {
  assert.equal(formatNumber(Infinity), "—");
  assert.equal(formatNumber(NaN), "—");
});
