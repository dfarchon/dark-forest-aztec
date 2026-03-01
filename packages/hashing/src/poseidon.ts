import { BarretenbergSync } from "@aztec/bb.js";
import { Fr } from "@aztec/aztec.js/fields";
import { type Fieldable, serializeToFields } from "@aztec/foundation/serialize";

/**
 * Initialize the BarretenbergSync WASM singleton.
 * Must be awaited once (at app/worker startup) before calling poseidon2HashSync.
 */
export async function initPoseidon2(): Promise<void> {
  await BarretenbergSync.initSingleton();
}

/**
 * Synchronous Poseidon2 hash. Requires initPoseidon2() to have completed first.
 * Throws if the singleton has not been initialized.
 */
export function poseidon2HashSync(input: Fieldable[]): Fr {
  const inputFields = serializeToFields(input);
  const api = BarretenbergSync.getSingleton();
  const response = api.poseidon2Hash({
    inputs: inputFields.map((i) => i.toBuffer()),
  });
  return Fr.fromBuffer(Buffer.from(response.hash));
}
