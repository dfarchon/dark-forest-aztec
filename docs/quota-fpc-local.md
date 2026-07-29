# Running the sponsored-transaction experience locally

Everything below runs against a local Aztec network with fake money. Nothing
here touches mainnet or spends anything real.

The goal is to play Dark Forest from a wallet holding **zero** fee juice and
watch the paymaster cover the transactions — which is both the demo and the
last untested claim in this feature.

## What you end up with

| Piece | Where |
|---|---|
| L1 (anvil) | `127.0.0.1:8545` |
| Aztec node | `127.0.0.1:8080` |
| Indexer / server | started by the same script |
| Game contracts | deployed locally, addresses written to `packages/contracts` |
| Paymaster | deployed and funded with bridged fake fee juice |
| Client | `pnpm --filter client dev` |

## 0. Raise the network's per-transaction data-gas allowance

A default local network advertises only ~55,882 DA gas per transaction, and
publishing Dark Forest's largest contract needs 72,544 — so deployment fails
before it starts. This is **not** a protocol ceiling (that is 271,200) and not a
sequencer gas setting; it derives from how many blocks fit in a checkpoint:

```
daGas = min(271200, daBudget, ceil(daBudget / blocksPerCheckpoint × 1.5))
```

Longer blocks mean fewer per checkpoint, so each transaction may claim more. For
reference, mainnet advertises 117,668. Start the network with:

```bash
SEQ_BLOCK_DURATION_MS=12000 aztec start --local-network …
```

which yields the full 271,200 locally. Verify with `node_getNodeInfo` and check
`txsLimits.gas.daGas` before deploying anything.

## 1. Start the stack

```bash
pnpm --filter server run e2e:runtime   # anvil + aztec local-network + server
pnpm --filter server run e2e:status    # confirm all three are listening
```

Takes several minutes on first run: the local network deploys its own L1
contracts before it will answer.

> **Port note.** This script hardcodes 8545 and 8080, and its `stop` action
> kills whatever holds those ports. If another agent or session is using them,
> stopping this stack will take that process down too. Check first.

## 2. Deploy and configure the game

```bash
cd contracts
pnpm run deploy-contracts        # all 17 contracts; fees paid by the canonical SponsoredFPC
pnpm run configure               # game configuration
pnpm run sync-env-and-artifacts  # addresses -> packages/contracts, artifacts -> client
```

`deploy-contracts` defaults to `FEE_PAYMENT_MODE=sponsored`, which uses Aztec's
built-in SponsoredFPC — present on every local network, so the deployer needs no
funding of its own.

## 3. Deploy the paymaster

The game contracts must exist first, because the paymaster's allowlist is
immutable and refers to them.

```bash
cd contracts
pnpm run deploy-fpc -- --config fpc/config/local.json --dry-run   # check the plan
pnpm run deploy-fpc -- --config fpc/config/local.json             # deploy
```

`local.json` reads every address from the environment `sync-env-and-artifacts`
wrote, so it survives a redeploy without editing. It sets a deliberately small
allowance — **5 transactions per player per day** — because running out is one of
the states worth actually looking at, and 30 would make that tedious to reach by
hand.

Note the printed `QUOTA_FPC_CONTRACT_ADDRESS`.

## 4. Fund the paymaster with fake fee juice

The paymaster starts empty and sponsors nothing until funded. On a local network
the L1 faucet mints freely, so this costs nothing:

```bash
QUOTA_FPC_ADDRESS=<address from step 3> \
  pnpm --filter @dfpunk/quota-fpc run fund:local
```

Local networks only produce blocks when transactions arrive, so the funding
helper pokes the chain while it waits for the L1→L2 message to mature. Expect
roughly 15 seconds and a few pokes.

## 5. Point the client at all of it

`client/.env.local`:

```
VITE_AZTEC_NODE_URL=http://localhost:8080
VITE_INDEXER_BOOTSTRAP_URL=http://localhost:3000
VITE_PROVER_ENABLED=false
VITE_QUOTA_FPC_ADDRESS=<address from step 3>
```

`VITE_QUOTA_FPC_ADDRESS` is the switch. Without it the client behaves exactly as
it does today; with it, sponsored transactions become available.

```bash
pnpm --filter client dev
```

## 5b. Testing from another machine: HTTPS is mandatory

Browsers grant secure-context privileges only over **HTTPS or localhost**. Over
plain `http://<ip>` the browser silently discards the COOP/COEP headers and
withholds `crypto.subtle`, so the wallet cannot initialise at all. The symptoms
look unrelated but share one cause:

```
The Cross-Origin-Opener-Policy header has been ignored, because the URL's
  origin was untrustworthy
Cannot read properties of undefined (reading 'generateKey')
Error: Missing required OPFS APIs.
```

Serve everything under **one** HTTPS origin so there is also no mixed content
and no CORS. With Tailscale:

```bash
sudo tailscale serve --bg --https=8444 --set-path=/         http://127.0.0.1:5273
sudo tailscale serve --bg --https=8444 --set-path=/rpc      http://127.0.0.1:8590
sudo tailscale serve --bg --https=8444 --set-path=/indexer  http://127.0.0.1:3001
```

Then point the client at the proxy rather than at raw ports:

```
VITE_AZTEC_NODE_URL=https://<host>.ts.net:8444/rpc
VITE_INDEXER_BOOTSTRAP_URL=https://<host>.ts.net:8444/indexer
```

Two gotchas: Vite rejects unknown Host headers, so run it with a config that
lists the tailnet hostname in `server.allowedHosts` (`vite.config.local.mts`
does this); and pick a port not already used by another `tailscale serve` entry —
check `tailscale serve status` first, since the config is machine-wide.

Tear down with `sudo tailscale serve --https=8444 off`.

## 5c. Keep the chain's clock moving

Aztec's local network builds a block only when a transaction arrives. Left idle
— which is exactly what happens while a person reads the screen and clicks —
the latest block's timestamp stops advancing. Dark Forest's contracts compare
the client's supplied timestamp against block time and reject anything more than
**300 seconds** stale:

```
Assertion failed: Timestamp too old
  'assert(actual_timestamp - timestamp <= max_time_drift, "Timestamp too old")'
```

This has nothing to do with sponsorship — unmodified Dark Forest fails the same
way after a few minutes of thinking time on an idle local chain.

`SEQ_MIN_TX_PER_BLOCK=0` does **not** fix it; the local-network preset overrides
it. Run the heartbeat instead, which sends one cheap transaction a minute:

```bash
AZTEC_NODE_URL=http://localhost:8590   pnpm --filter @dfpunk/quota-fpc run heartbeat
```

Leave it running for the whole session. Note the chain's clock may sit well ahead
of wall-clock time; that is harmless, because the client and the contracts both
derive from chain time and therefore agree with each other.

> This is a **test-harness workaround, not a product fix**. Any network that does
> not produce blocks continuously will break gameplay after ~5 minutes of idling,
> and that is worth raising with the game's authors independently.

## 5d. Artifacts must match what is deployed

`sync-env-and-artifacts` prompts `Overwrite? (y/N)` before replacing
`packages/contracts/src/artifacts`. If that prompt goes unanswered the client
keeps an **older** build than the one on chain, and every call fails with:

```
No artifact registered for contract class 0x… (contract 0x…):
  register it by calling wallet.registerContract(...)
```

The class id is derived from bytecode, so any recompile invalidates a previously
copied artifact. After redeploying, confirm they match:

```bash
cp -f contracts/target/QuotaFpc.ts contracts/target/quota_fpc-QuotaFpc.json   packages/contracts/src/artifacts/
```

## 6. What to actually look at

Create a **fresh account and do not fund it**. That is the whole point: today
such a player cannot move at all.

Worth watching, in rough order of interest:

1. **Onboarding.** Today an unfunded player is stopped at the fee-juice gate.
   Does the sponsored player get past it, and does the reason they got past it
   make sense to them?
2. **The counter.** The top bar shows how many transactions the game is paying
   for, and hovering says when the allowance returns.
3. **Consecutive moves.** There is a brief pause after each sponsored
   transaction while the wallet notices its updated allowance. Measured at
   ~265ms against ~4s of proving, so it should be invisible — this is where to
   confirm that.
4. **Running out.** After 5 transactions the allowance is spent. The player
   should be told when it returns and offered the existing funding route, not
   dropped into a dead end.
5. **The allowlist.** Sponsorship only covers the six player-facing contracts.
   Admin actions are deliberately excluded and should fall back to self-payment.

## Known gaps

- **The user experience has not been designed**, only made to work. The counter,
  the exhausted state and the funding hand-off are first-draft copy.
- Steps 2 and 3 have not yet been run end to end together; each has been
  exercised separately. Expect friction on the first attempt and treat this
  document as a starting point rather than a proven script.
