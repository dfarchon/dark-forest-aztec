import { AztecAddress } from "@aztec/aztec.js/addresses";
import { getPublicEvents } from "@aztec/aztec.js/events";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { BlockNumber } from "@aztec/foundation/branded-types";

import {
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
  START_BLOCK,
  WORLD_STORAGE_CONTRACT_ADDRESS,
} from "../../packages/contracts/src/index.ts";
import { ArtifactStorageContract } from "../../packages/contracts/src/artifacts/ArtifactStorage.ts";
import { WorldStorageContract } from "../../packages/contracts/src/artifacts/WorldStorage.ts";

const nodeUrl = process.env.AZTEC_NODE_URL ?? "https://rpc.testnet.aztec-labs.com";
const node = createAztecNodeClient(nodeUrl);

const latest = Number(await node.getBlockNumber());
const from = START_BLOCK;
const to = latest;

async function count(label, eventDef, address) {
  const raw = await getPublicEvents(node, eventDef, {
    fromBlock: BlockNumber(from),
    toBlock: BlockNumber(to + 1),
    contractAddress: AztecAddress.fromString(address),
  });
  console.log(`${label}: count=${raw.events.length}, range=${from}-${to}`);
  if (raw.events.length > 0) {
    const first = raw.events[0].event;
    const last = raw.events[raw.events.length - 1].event;
    console.log(
      `  first: id=${String(first.id)} block=${String(first.block_number)}`,
    );
    console.log(`  last:  id=${String(last.id)} block=${String(last.block_number)}`);
  }
}

console.log(`node=${nodeUrl}`);
console.log(`WORLD_STORAGE_CONTRACT_ADDRESS=${WORLD_STORAGE_CONTRACT_ADDRESS}`);
console.log(`ARTIFACT_STORAGE_CONTRACT_ADDRESS=${ARTIFACT_STORAGE_CONTRACT_ADDRESS}`);

await count(
  "world",
  WorldStorageContract.events.WorldUpdate,
  WORLD_STORAGE_CONTRACT_ADDRESS,
);
await count(
  "artifact",
  ArtifactStorageContract.events.ArtifactUpdate,
  ARTIFACT_STORAGE_CONTRACT_ADDRESS,
);
