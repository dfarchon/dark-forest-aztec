# @dfpunk/utils

Shared utilities for dfpunk-aztec.

## Move proof validation

Functions to compute and validate move circuit outputs (source hash, target hash, perlin) using the same logic as the client and the Noir move circuit.

```ts
import {
  buildMoveProofInputs,
  computeMoveProofOutputs,
  computePlanetHash,
  computeSpaceTypePerlin,
  validateMoveProofOutputs,
} from "@dfpunk/utils";
```

- **computePlanetHash(planetHashKey, x, y)** – Poseidon2 location ID (order: `[planetHashKey, x, y]`)
- **computeSpaceTypePerlin(x, y, spaceTypeKey, scale, mirrorX, mirrorY)** – Perlin at coords
- **computeMoveProofOutputs(inputs)** – Full move proof outputs
- **buildMoveProofInputs(snarkConfig, r, distMax, x1, y1, x2, y2)** – Build inputs from config
- **validateMoveProofOutputs(sourceLoc, targetLoc, targetPerlin, outputs)** – Check consistency

Used by contracts test script `test-moveProof` and can be used by the client for pre-submit validation.
