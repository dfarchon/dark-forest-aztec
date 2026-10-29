# Aztec Mainnet Fee Juice Bridge

This CLI bridges existing L1 `$AZTEC` to an Aztec account as public Fee Juice. It uses viem to create or reuse a local Ethereum hot wallet and Aztec's `L1FeeJuicePortalManager` for the deposit.

`$AZTEC` is the asset being bridged. Ethereum ETH is required separately to pay L1 approval and deposit gas.

## Generate demo accounts

Generate an Ethereum EOA and an Aztec Schnorr initializerless account without
sending a transaction:

```bash
pnpm generate:accounts --network mainnet
pnpm generate:accounts --network testnet
```

Address derivation is fully offline and does not require an Aztec RPC. Generated
credentials are appended to `bridge/.env` under either `MAINNET_` or
`TESTNET_` prefixed variables, so both networks can be stored safely in one
file. The generator refuses to overwrite an existing network's private keys.

## Setup

```bash
cd bridge
cp .env.example .env
```

Set `AZTEC_NODE_URL` to an Aztec mainnet node and `ETHEREUM_HOST` to an Ethereum mainnet RPC. Do not add any wallet keys manually for a new account: the first `quote` generates both the Ethereum and Aztec account keys and appends them to `bridge/.env`.

To reuse an existing Aztec account instead, set `AZTEC_ACCOUNT_SALT`, `AZTEC_ACCOUNT_SECRET_KEY`, and `AZTEC_ACCOUNT_SIGNING_KEY`. Its derived address must match `AZTEC_ACCOUNT_ADDRESS` and any explicit `--recipient`. Do not commit `.env` or the generated `claims/` directory.

## Flow

1. Ask for a quote. Without `--recipient`, this creates both `L1_PRIVATE_KEY` and `AZTEC_ACCOUNT_*` in `bridge/.env` if absent. It prints the resulting Ethereum address, Aztec L2 address, required L1 `$AZTEC`, and buffered ETH gas estimate. It sends no transaction.

   ```bash
   pnpm quote --amount 10
   ```

2. Transfer the printed quantities of ETH and `$AZTEC` to the printed Ethereum address.

3. Send the L1 deposit. Mainnet deposits are hard-coded to `mint=false`; the CLI never invokes the test faucet. Each deposit appends a claim for that recipient and prints its message hash. A later deposit for the same address does not replace earlier ones.

   ```bash
   pnpm deposit --amount 10
   ```

4. Check L1-to-L2 message inclusion. `status` lists only pending claims and numbers them. `history` lists every stored claim, including ones that already succeeded. Pending numbers match `status`.

   ```bash
   pnpm status
   pnpm history
   ```

5. Once ready, claim it. The claim is placed in the transaction's non-revertible setup phase, allowing the freshly claimed Fee Juice to pay for the claim transaction itself. When only one claim is pending, `pnpm claim` selects it. When several are pending, pass the number printed by `status`.

   ```bash
   pnpm claim
   pnpm claim 1
   ```

`bridge/claims/<recipient>.json` keeps every deposit and claim for that address. Each record includes a secret. Back the file up until every pending claim has succeeded; anyone with a secret and the relevant account authorization material may be able to act on that deposit. A completed claim stays in the file with its completion time and L2 transaction hash.

## Check balances

Query the L1 bridge wallet's ETH and `$AZTEC`, and the Aztec account's public
Fee Juice. The L1 wallet comes from `L1_PRIVATE_KEY` or `L1_ADDRESS`. The Aztec
address defaults to `AZTEC_ACCOUNT_ADDRESS`; use `--address` to query another
account. This command is read-only and does not create a wallet.

```bash
pnpm balance
pnpm balance --address 0x...
pnpm balance --address 0x... --json
```

## Safety

- The CLI refuses L1 networks other than Ethereum mainnet (chain ID `1`).
- `quote`, `status`, `history`, and `balance` are read-only; `deposit` and `claim` are the only commands that can submit transactions.
- Before `deposit`, the CLI rechecks the L1 ETH and `$AZTEC` balances.
- Do not reuse this generated hot wallet for material amounts beyond the bridge operation.

## Checks

```bash
pnpm typecheck
pnpm test
```
