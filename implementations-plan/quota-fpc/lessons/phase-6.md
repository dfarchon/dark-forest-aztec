# Phase 6 lessons — client integration (2026-07-29)

## Validation gate — PASSED

| Command | Result |
|---|---|
| `pnpm --filter client run lint` | exit 0 |
| `pnpm --filter client run build` | exit 0 — `dist/assets/QuotaFpc-*.js` present, so the artifact resolves and bundles |

## What shipped

- `client/src/config/env.ts` — `getQuotaFpcAddressFromEnv()` (`VITE_QUOTA_FPC_ADDRESS`), `isQuotaModeEnabled()`, `getQuotaSyncTimeoutMs()`. Setting the address is the single switch that activates quota mode, inside the existing sponsor-mode path rather than beside it.
- `WalletManagerConfig.quotaFpcAddress` + `registerQuotaFpcWithWallet()`, wired into **both** wallet paths (embedded and external), with `getQuotaFpcAddress()` alongside the existing `getSponsoredFpcAddress()`.
- `GameLandingPage` passes the configured address into the wallet config.
- `packages/contracts` exports `./artifacts/QuotaFpc`.
- `TxExecutor` reads the paymaster address and logs its availability.

## Deliberate scope decision: registration now, assembly with the UI

The sandwich shape means a sponsored transaction is **not** a `fee.paymentMethod` variation — the paymaster is the transaction *origin*, so assembly bypasses `contract.methods.X().send()` entirely (proven in spike 1B, packaged in `@dfpunk/quota-fpc`). Bolting that into `TxExecutor` without the UI that surfaces allowance state, the sync-pending pause, and the fallback chain would put a half-wired second transaction path into the live send loop with nothing to show for it.

So this phase lands the plumbing — configuration, registration on both wallet paths, artifact export — and Phase 7 lands the assembly together with the interface that makes it usable. **A build with no `VITE_QUOTA_FPC_ADDRESS` set behaves exactly as today**, which is the property that made it safe to land in pieces.

## A missing-paymaster is never fatal

`registerQuotaFpcWithWallet` warns and returns `undefined` when the address is absent from the node (wrong network, not yet deployed, typo) rather than throwing. The game must stay playable — players simply pay their own fees — because a paymaster misconfiguration should degrade sponsorship, not block the door. Both call sites also wrap it in try/catch for the same reason.

## Notes

- `packages/contracts/src/artifacts/` is generated and gitignored (`sync-env-and-artifacts` populates it from `contracts/scripts/artifacts`). A fresh checkout must run the contracts build before the client will resolve `@dfpunk/contracts/artifacts/QuotaFpc`.
- The client's eslint enforces sorted named imports inside existing import blocks; adding a standalone import line for the same module fails lint.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-6.md


## Update — client verified against the local deployment (2026-07-29)

With the game deployed locally and the paymaster funded, the client was pointed
at it (`client/.env.local`: node `:8590`, `VITE_QUOTA_FPC_ADDRESS` set to the
deployed paymaster) and:

| Check | Result |
|---|---|
| `vite build --mode development` | ✅ built |
| Dev server boots and serves | ✅ HTTP 200 |

That confirms the configuration path end to end — the paymaster address resolves,
the artifact bundles, and nothing in the wiring breaks a real build against real
local addresses. It does **not** confirm sponsorship works in play; that needs a
person creating an unfunded account and making a move, because the arguments to
any real game call can only be assembled by the client's StateResolver.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-6.md
