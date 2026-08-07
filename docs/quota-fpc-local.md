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

All commands are thin CLIs over the package's operator library. State-changing
commands print a digest-confirmed plan and require `--yes`; without it every
run is a dry run.

```bash
# deploy from config (refuses worst-case > accepted loss; verifies class ids)
pnpm --filter contracts run deploy-fpc -- --config fpc/config/dark-forest.json --yes

# live + pending policy, balance vs the sequencer reserve
pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --show

# retune (12h delay, CAS-protected; one pending slot)
pnpm --filter contracts run update-fpc-policy -- --fpc 0x… --max-uses 10 --yes

# fund: bridge on L1, then claim on L2 (the claim secret is journaled to
# ~/.quota-paymaster BEFORE L1 is touched and never passes through argv)
pnpm --filter contracts run bridge-fee-juice -- --to 0x… --amount 50 --yes
pnpm --filter contracts run claim-fee-juice -- --for 0x… --yes

# re-measure real per-action costs after fee moves or gas-profile changes
pnpm --filter contracts run measure-sponsored-fee -- --fpc 0x… --target 0x… --artifact Core
```

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
