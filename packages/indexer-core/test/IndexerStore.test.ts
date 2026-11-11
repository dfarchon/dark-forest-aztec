import assert from "node:assert/strict";
import test from "node:test";

import { IndexerStore } from "../src/service/IndexerStore.ts";
import type {
  BlockUpdates,
  IndexerSnapshot,
  TableUpdate,
} from "../src/types.ts";

type Raw = Record<string, unknown>;

function arrival(id: string): TableUpdate<Raw> {
  return {
    table: "arrival",
    id,
    state: {
      id,
      player: "0xp1",
      from_planet: "0xa",
      to_planet: "0xb",
      pop_arriving: 1n,
      silver_moved: 0n,
      departure_time: 1n,
      arrival_time: 2n,
      arrival_type: 1,
      carried_artifact_id: "0",
      distance: 3n,
    },
  };
}

function artifact(
  id: string,
  owner: string,
  controller: string,
): TableUpdate<Raw> {
  return {
    table: "artifact",
    id,
    state: {
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
    },
  };
}

function updates(
  fromBlock: number,
  toBlock: number,
  rows: TableUpdate<Raw>[],
): BlockUpdates {
  return {
    fromBlock,
    toBlock,
    toBlockHash: `h${toBlock}`,
    updates: rows,
  };
}

function emptySnapshot(block: number): IndexerSnapshot {
  const snap: IndexerSnapshot = {
    lastProcessedBlock: block,
    lastProcessedBlockHash: "snap",
    world: new Map(),
    player: new Map(),
    planet: new Map(),
    planet_revealed_coords: new Map(),
    planet_events: new Map(),
    planet_artifacts: new Map(),
    arrival: new Map(),
    artifact: new Map(),
    artifact_location: new Map(),
  };
  snap.arrival.set("0xkept", arrival("0xkept").state as never);
  return snap;
}

test("commit writes every row or none", () => {
  const store = new IndexerStore(1);
  const first = store.commit(updates(1, 4, [arrival("0xok")]));
  assert.equal(first.toBlock, 4);
  assert.deepEqual(first.tables, ["arrival"]);
  assert.deepEqual(first.updatedIdsByTable.arrival, ["0xok"]);
  assert.equal(store.processedBlock, 4);
  assert.equal(store.processedBlockHash, "h4");
  assert.ok(store.getArrival("0xok"));

  const bad = arrival("0xbad");
  bad.state.arrival_type = 2n ** 64n;
  assert.throws(
    () => store.commit(updates(5, 6, [arrival("0xnext"), bad])),
    /overflow/,
  );

  assert.equal(store.getArrival("0xnext"), undefined);
  assert.equal(store.processedBlock, 4);
  assert.equal(store.processedBlockHash, "h4");
});

test("commit moves an artifact between owner and controller indexes", () => {
  const store = new IndexerStore(1);
  store.commit(updates(1, 2, [artifact("0xart", "0xalice", "0xalice")]));
  assert.deepEqual(store.getArtifactIdsByOwner("0xalice"), ["0xart"]);
  assert.deepEqual(store.getArtifactIdsByController("0xalice"), ["0xart"]);

  store.commit(updates(3, 3, [artifact("0xart", "0xbob", "0xcarol")]));
  assert.deepEqual(store.getArtifactIdsByOwner("0xalice"), []);
  assert.deepEqual(store.getArtifactIdsByOwner("0xbob"), ["0xart"]);
  assert.deepEqual(store.getArtifactIdsByController("0xalice"), []);
  assert.deepEqual(store.getArtifactIdsByController("0xcarol"), ["0xart"]);
  assert.equal(store.getArtifactCount(), 1);
});

test("replaceSnapshot installs rows and moves the cursor to the snapshot block", () => {
  const store = new IndexerStore(1);
  store.commit(updates(1, 2, []));

  const block = store.replaceSnapshot(emptySnapshot(50));
  assert.equal(block, 50);
  assert.equal(store.processedBlock, 50);
  assert.equal(store.processedBlockHash, "snap");
  assert.equal(store.getArrival("0xkept")?.player, "0xp1");
});
