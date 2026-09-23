# Aztec Mainnet Fee Juice Bridge

This CLI bridges existing L1 `$AZTEC` to an Aztec account as public Fee Juice. It uses viem to create or reuse a local Ethereum hot wallet and Aztec's L1 transaction utilities for the deposit. The claim secret is saved before submitting any transaction.

`$AZTEC` is the asset being bridged. Ethereum ETH is required separately to pay L1 approval and deposit gas.

## Generate demo accounts

Generate an Ethereum EOA and an Aztec Schnorr initializerless account without
sending a transaction:

```bash
pnpm generate:accounts -- --network mainnet
pnpm generate:accounts -- --network testnet
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

3. Send the L1 deposit. Mainnet deposits are hard-coded to `mint=false`; the CLI never invokes the test faucet.

   ```bash
   pnpm deposit --amount 10
   ```

4. Check for L1-to-L2 message inclusion:

   ```bash
   pnpm status
   ```

5. Once ready, claim it. The claim is placed in the transaction's non-revertible setup phase, allowing the freshly claimed Fee Juice to pay for the claim transaction itself.

   ```bash
   pnpm claim
   ```

The claim state includes a secret. Back up `bridge/claims/<recipient>.json` securely until the claim has succeeded; anyone with the secret and relevant account authorization material may be able to act on the deposit.

Only one unresolved or unclaimed deposit per recipient is allowed. Complete the
claim before depositing again. Existing claim JSON files remain supported, and
completed claims are archived before a new receipt replaces the active file.

### Recover an interrupted deposit

Before sending an approval or deposit, the CLI flushes the secret, amount,
recipient, L1 chain, wallet and portal to
`bridge/claims/<recipient>.deposit.json`. Back up this file securely too.
An RPC error does not prove that the transaction failed; the CLI retains this
record and refuses another deposit rather than replacing its secret.

If the deposit was mined, recover from its L1 transaction hash:

```bash
pnpm recover --tx-hash 0x... --recipient 0x...
pnpm status --recipient 0x...
pnpm claim --recipient 0x...
```

Recovery sends no transaction. It checks the saved L1 chain and requires a
successful receipt from the saved wallet with exactly one deposit event matching
the saved portal, recipient, amount and secret hash. Recovery also handles a
crash after writing the claim but before removing the prepared record.

The CLI archives the prepared record automatically as
`<recipient>.<id>.discarded.json` when the approval or deposit simulation fails
before the deposit is broadcast, or when the deposit transaction is mined and
reverted. You can then deposit again.

For any other failure, first check the L1 wallet's transaction history,
including pending transactions. If the deposit was never mined, archive the
record and retry:

```bash
pnpm abandon --confirm-not-mined --recipient 0x...
```

Never abandon a record merely because the RPC timed out. Archived records keep
their secrets, so a deposit found later can still be recovered by restoring the
file to `<recipient>.deposit.json` and running `pnpm recover`. A process killed during a local file update
can also leave `<recipient>.lock`; remove that lock only after confirming no
bridge process is still using the recipient. Do not remove the secret files.

## Check an Aztec account balance

Query the account's public Fee Juice balance. The address defaults to
`AZTEC_ACCOUNT_ADDRESS`; use `--address` to query another account.

```bash
pnpm balance
pnpm balance -- --address 0x...
pnpm balance -- --address 0x... --json
```

This command is read-only and only requires `AZTEC_NODE_URL` plus an account
address.

## Safety

- The CLI refuses L1 networks other than Ethereum mainnet (chain ID `1`).
- `quote`, `status`, and `balance` are read-only; `deposit` and `claim` are the only commands that can submit transactions.
- Before `deposit`, the CLI rechecks the L1 ETH and `$AZTEC` balances.
- Do not reuse this generated hot wallet for material amounts beyond the bridge operation.

## Checks

```bash
pnpm typecheck
pnpm test
```
