import assert from "node:assert/strict";
import test from "node:test";

import { ArtifactIndex } from "../src/service/ArtifactIndex.ts";
import type { ArtifactState } from "../src/TableTypes/chain.ts";

function state(owner: string, controller: string): ArtifactState {
  return {
    planet_discovered_on: "0xplanet",
    rarity: 1,
    planet_biome: 2,
    minted_at_timestamp: 3n,
    discoverer: "0xdiscoverer",
    artifact_type: 4,
    activations: 0n,
    last_activated: 0n,
    last_deactivated: 0n,
    wormhole_to: "0",
    owner,
    controller,
    last_updated: 5n,
  };
}

function keys(
  index: ArtifactIndex,
  field: "byOwnerIndex" | "byControllerIndex",
) {
  return [
    ...(
      index as unknown as Record<
        "byOwnerIndex" | "byControllerIndex",
        Map<string, Set<string>>
      >
    )[field].keys(),
  ];
}

test("dropping the last artifact removes the owner and controller keys", () => {
  const index = new ArtifactIndex();
  const before = state("0xalice", "0xalice");
  index.onUpsert("0xart", undefined, before);
  index.onUpsert("0xart", before, state("0xbob", "0xcarol"));

  assert.deepEqual(index.byOwner("0xalice"), []);
  assert.deepEqual(index.byOwner("0xbob"), ["0xart"]);
  assert.deepEqual(index.byController("0xalice"), []);
  assert.deepEqual(index.byController("0xcarol"), ["0xart"]);
  assert.deepEqual(keys(index, "byOwnerIndex"), ["0xbob"]);
  assert.deepEqual(keys(index, "byControllerIndex"), ["0xcarol"]);
});

test("an address keeps its key while another artifact remains", () => {
  const index = new ArtifactIndex();
  const first = state("0xalice", "0xalice");
  const second = state("0xalice", "0xdave");
  index.onUpsert("0xart1", undefined, first);
  index.onUpsert("0xart2", undefined, second);
  index.onUpsert("0xart1", first, state("0xbob", "0xcarol"));

  assert.deepEqual(index.byOwner("0xalice"), ["0xart2"]);
  assert.deepEqual(index.byController("0xalice"), []);
  assert.deepEqual(keys(index, "byOwnerIndex").sort(), ["0xalice", "0xbob"]);
  assert.deepEqual(keys(index, "byControllerIndex").sort(), [
    "0xcarol",
    "0xdave",
  ]);
});
