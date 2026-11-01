import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_PRECISION } from "@dfpunk/constants";
import type { Planet, Upgrade } from "@dfpunk/types";

import { applyUpgrade } from "../src/Backend/GameLogic/ArrivalUtils.ts";

const DEFENSE_UPGRADE: Upgrade = {
  energyCapMultiplier: 120,
  energyGroMultiplier: 120,
  rangeMultiplier: 100,
  speedMultiplier: 100,
  defMultiplier: 120,
};

const PHOTOID_UPGRADE: Upgrade = {
  energyCapMultiplier: 100,
  energyGroMultiplier: 100,
  rangeMultiplier: 200,
  speedMultiplier: 2500,
  defMultiplier: 100,
};

type Stats = Pick<
  Planet,
  "energyCap" | "energyGrowth" | "range" | "speed" | "defense"
>;

// Contract values after three defense upgrades, pinned by
// level8_rank3_nebula_defense_path_stats and level8_rank3_dead_space_defense_path_stats
// in contracts/tests/high_level_planet/src/lib.nr.
const CASES = [
  {
    name: "level 8 nebula",
    base: {
      cap: 700_000_000,
      growth: 3_750,
      range: 6_306,
      speed: 75,
      defense: 200,
    },
    rank3: {
      cap: 1_209_600_000,
      growth: 6_480,
      range: 6_306,
      speed: 75,
      defense: 345,
    },
  },
  {
    name: "level 8 dead space",
    base: {
      cap: 1_400_000_000,
      growth: 7_500,
      range: 12_612,
      speed: 150,
      defense: 30,
    },
    rank3: {
      cap: 2_419_200_000,
      growth: 12_960,
      range: 12_612,
      speed: 150,
      defense: 51,
    },
  },
];

function uiStats(s: (typeof CASES)[number]["base"]): Stats {
  return {
    energyCap: s.cap / CONTRACT_PRECISION,
    energyGrowth: s.growth / CONTRACT_PRECISION,
    range: s.range,
    speed: s.speed,
    defense: s.defense,
  };
}

// The contract floors after every upgrade; the client multiplies floats. The
// preview may show slightly more than the chain, by less than one contract unit
// per upgrade, and never less.
test("client upgrade preview stays within flooring distance of the contract", () => {
  for (const c of CASES) {
    const planet = uiStats(c.base) as Planet;
    for (let i = 0; i < 3; i++) applyUpgrade(planet, DEFENSE_UPGRADE);

    const pairs: [string, number, number][] = [
      ["energyCap", planet.energyCap * CONTRACT_PRECISION, c.rank3.cap],
      [
        "energyGrowth",
        planet.energyGrowth * CONTRACT_PRECISION,
        c.rank3.growth,
      ],
      ["range", planet.range, c.rank3.range],
      ["speed", planet.speed, c.rank3.speed],
      ["defense", planet.defense, c.rank3.defense],
    ];
    for (const [stat, client, contract] of pairs) {
      const diff = client - contract;
      assert.ok(
        diff > -1e-6 && diff < 3,
        `${c.name} ${stat}: client ${client}, contract ${contract}`
      );
    }
  }
});

test("applying then removing an upgrade restores every stat", () => {
  for (const c of CASES) {
    for (const upgrade of [DEFENSE_UPGRADE, PHOTOID_UPGRADE]) {
      const original = uiStats(c.rank3);
      const planet = { ...original } as Planet;
      applyUpgrade(planet, upgrade);
      applyUpgrade(planet, upgrade, true);
      for (const key of Object.keys(original) as (keyof Stats)[]) {
        assert.ok(
          Math.abs(planet[key] - original[key]) <=
            Math.abs(original[key]) * 1e-12,
          `${c.name} ${key}: ${planet[key]} != ${original[key]}`
        );
      }
    }
  }
});
