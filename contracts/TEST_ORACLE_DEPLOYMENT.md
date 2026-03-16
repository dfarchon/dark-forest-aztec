## Test Oracle Deployment & Verification Guide

### Overview

- **Contract**: `TestOracle` (Aztec Noir system contract under `system/test_oracle`)
- **Purpose**: Validate the Aztec Oracle API (especially `get_block_header_at`) inside a private function, and cross-check the result via both events and storage.
- **Deploy script**: `scripts/deploy-test-oracle.ts`
- **Test script**: `scripts/test-oracle.ts`

---

### Prerequisites

Before using these scripts, **make sure you have a local Aztec network running** by following the official guide:  
[`Getting Started on Local Network`](https://docs.aztec.network/developers/devnet/getting_started_on_local_network)

Concretely, you should have already:

- Installed the Aztec toolchain for the correct devnet version (e.g. `4.0.0-devnet.2-patch.1`).
- Started the local network, and see logs such as:

  ```text
  [INFO] Aztec Server listening on port 8080
  ```

- Optionally imported local-network test accounts via `aztec-wallet import-test-accounts` and/or created your own account.

In addition, within this monorepo:

- Run dependencies install at the root:
  - `pnpm install`
- Then enter the `contracts/` directory:

```bash
cd contracts
```

---

### 1. Build & Codegen

From the `contracts/` directory, run:

```bash
pnpm build
```

This will:

- Compile Noir contracts (`aztec compile`)
- Generate TypeScript client code (`aztec codegen`)
- Copy `target/test_oracle-*.{json,ts}` into `scripts/artifacts/`

`deploy-test-oracle.ts` dynamically imports the contract wrapper from `scripts/artifacts/TestOracle.ts`.

---

### 2. Deploy TestOracle

Still from the `contracts/` directory (a script alias is defined in `package.json`):

```bash
pnpm deploy-test-oracle
```

Which is equivalent to:

```bash
node --experimental-transform-types scripts/deploy-test-oracle.ts
```

The deploy script `scripts/deploy-test-oracle.ts` will:

1. Connect to the Aztec node using `AZTEC_NODE_URL` (default: `http://localhost:8080`).
2. Initialize the embedded wallet via `setupWallet` (`PROVER_ENABLED` is read from env, default `false` for faster local deploys).
3. Get the SponsoredFPC contract via `getSponsoredPFCContract` and register it with the wallet, to sponsor deployment gas.
4. Get or create a deployer account with `getOrCreateAccount(wallet, aztecNode)`.
5. Dynamically load `scripts/artifacts/TestOracle.ts` and obtain `TestOracleContract.artifact`.
6. Build a `ContractDeployConfig`:

```ts
const config: ContractDeployConfig = {
  name: 'TestOracle',
  envPrefix: 'TEST_ORACLE',
  artifact: TestOracleContract.artifact,
  getConstructorArgs: (ctx) => [ctx.deployer.toField()],
};
```

7. Call `deployOneContract` to fully deploy the contract with fees sponsored by SponsoredFPC:

```ts
const result = await deployOneContract(
  wallet,
  deployer,
  config,
  { deployer, addresses: {} },
  {
    envFilePath: ENV_PATH,     // contracts/.env
    writeEnv: true,
    sponsoredFpc: sponsoredFPC,
  }
);
```

8. Append something like the following to `contracts/.env`:

```env
TEST_ORACLE_CONTRACT_ADDRESS=0x...
TEST_ORACLE_DEPLOYER_ADDRESS=0x...
TEST_ORACLE_DEPLOYMENT_SALT=0x...
```

> **Tip**: If deployment fails with `Invalid tx: Insufficient fee payer balance`, that usually means fees are not being sponsored by SponsoredFPC. This script has been wired to always go through the `deployOneContract` + `sponsoredFpc` path, so under normal circumstances you should no longer see this error.

---

### 3. Run the Test Script

After a successful deployment, ensure `contracts/.env` contains `TEST_ORACLE_CONTRACT_ADDRESS`. Then, from the `contracts/` directory, run:

```bash
pnpm test-oracle
```

Which is equivalent to:

```bash
node --experimental-transform-types scripts/test-oracle.ts
```

The script `scripts/test-oracle.ts` will:

1. Read `TEST_ORACLE_CONTRACT_ADDRESS` from `.env`.
2. Connect to the Aztec node and initialize the wallet, registering SponsoredFPC.
3. Obtain the contract instance via `TestOracleContract.at(oracleAddr, wallet)`.
4. Force a fresh L2 block by calling a no-op public function (`get_chain_id().send(...)`).
5. Pick a finalized target block: `targetBlock = max(1, currentBlock - 1)`.
6. Call the private function `test_get_block_header_private(targetBlock)`, which:
   - Internally calls `get_block_header_at(targetBlock, *self.context)`.
   - Computes `header.hash()`.
   - Enqueues a public call that records `(block_number, hash, chain_id)` into events + storage.
7. Wait for the transaction to be included in an L2 block.
8. Read and decode `BlockHashResult` events, printing `target_block`, `block_hash`, and `chain_id`.
9. Read from storage via view functions:
   - `get_last_queried_block()`
   - `get_last_block_hash()`
10. Compare the block/hash from events vs storage and print PASS/FAIL.

---

### 4. Troubleshooting

- **Q: `.env` is missing `TEST_ORACLE_CONTRACT_ADDRESS`**  
  - A: Run `pnpm deploy-test-oracle` from the `contracts/` directory and confirm the script logs that it wrote to `.env`.

- **Q: Deployment says `Artifact not found`**  
  - A: Run `pnpm build-contracts` first to generate `target/TestOracle.ts`, and make sure `scripts/artifacts/TestOracle.ts` exists.

- **Q: No `BlockHashResult` events are found**  
  - A: The archive tree may need a few more blocks; rerun the script, or trigger a few more transactions on the sandbox to advance the chain.

---

### 5. References

- `system/test_oracle/README.md`: Noir-level documentation for `get_block_header_at` and related APIs.
- `AZTEC_ORACLE_API_VERIFICATION_RESULTS.md` at the repo root: full oracle API verification log.
- `scripts/deploy.ts` / `scripts/utils/deploy.ts`: main deployment script and generic deployment helpers.

