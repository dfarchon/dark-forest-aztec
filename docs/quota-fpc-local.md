# Sponsored transactions (quota paymaster)

New players can play without bridging $AZTEC first: an app-funded paymaster
pays their fees, up to a per-player daily allowance, and only for this game's
own contracts. No game contract changes.

The implementation lives in the published package
[`@alejoamiras/quota-paymaster@5.0.1`](https://www.npmjs.com/package/@alejoamiras/quota-paymaster)
(exact-pinned, lockstep with Aztec 5.0.1). This repo keeps only the client
integration, thin operator CLIs, and the config. Architecture, security model,
and testing guides are in the package README.

## Enable it

One build-time variable — unset, the client behaves exactly as today:

```bash
# client/.env
VITE_QUOTA_FPC_ADDRESS=0x…      # a deployed QuotaFpc
VITE_QUOTA_DEBUG=true           # optional: [quota] console diagnostics
```

## Operate one

The package ships the CLI (`bin/quota-paymaster`); this repo keeps only a
config module (`contracts/quota-paymaster.config.ts`) that builds the signer
from the layered env files — the CLI never touches key material. Every
state-changing command prints a digest-confirmed plan and does nothing without
`--yes`; run everything without `--yes` first, it is a real dry run.

```bash
cd contracts
CFG=./quota-paymaster.config.ts

# live + pending policy, balance vs the sequencer reserve
pnpm run fpc -- policy --fpc 0x… --config-module $CFG --show

# retune (12h delay, CAS-protected; edits need an explicit loss bound)
pnpm run fpc -- policy --fpc 0x… --config-module $CFG --max-uses 10 --max-loss-wei N --yes

# deploy a new instance from config
pnpm run fpc -- deploy --config fpc/config/dark-forest.json --config-module $CFG --yes

# fund: bridge on L1, then claim on L2 (claim secret journaled, never in argv)
pnpm run fpc -- bridge --to 0x… --amount 50 --config-module $CFG --yes
pnpm run fpc -- claim  --for 0x… --config-module $CFG --yes

# re-measure real per-action costs (spends juice + daily allowance)
pnpm run fpc -- measure --fpc 0x… --target 0x… --artifact ./target/core-Core.json --method myFn --config-module $CFG --yes
```

Exit codes: `0` success · `2` refused (nothing happened) · `1` operational
failure (something may have — read the output before retrying).

## Three things operators must know

- **Fund above the reserve.** The sequencer admits a sponsored transaction only
  if the paymaster holds the worst case it could cost (~20 FJ at current
  rates), not the ~1–7 FJ it settles for. Below that it sponsors nothing while
  looking funded. `--show` prints the floor.
- **Funding is irreversible.** Fee juice is protocol-non-transferable — no
  withdraw, for anyone. Fund in tranches.
- **The admin key is fixed at deploy and cannot be transferred.** Deploy your
  own instance to hold it. It can retune quotas (12h notice, no faster lever)
  but can never touch funds or the account-class rules.

## Local testing

Run against a local network (`aztec start --local-network`), deploy a
paymaster with `deploy-fpc` against a config whose targets are your local game
deployment, and fund it with the bridge/claim pair (the local L1 faucet mints
freely). Full local-network guidance — clock caveats, funding loops, e2e
patterns — lives in the package repository.
