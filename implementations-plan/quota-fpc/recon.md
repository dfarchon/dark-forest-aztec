# Recon — quota-fpc

Consolidated findings from three read-only recon agents (2026-07-29): aztec-kit `SubscriptionFPC` deep-dive, aztec-kit PR #126 analysis, dark-forest fee-flow map — plus main-agent verifications (game-contract auth, aztec.js fee interfaces, canonical SponsoredFPC source, TxExecutor gas handling).

## 1. The reference contract: aztec-kit `SubscriptionFPC`

Source: `~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr` (338 lines, aztec-nr `v5.0.1`). PR #126 (merged 2026-07-22, seat-nullifier redesign) is fully present in local `main` (HEAD `9138fce`).

**Mechanics:**
- Storage: `admin: PublicImmutable<AztecAddress>`, `subscriptions: Owned<PrivateSet<SubscriptionNote>>` (per-user notes: `{uses: u32, max_fee: u128, config_id: Field}`), `configs: Map<Field, PublicImmutable<Config>>` with `Config = {max_fee: u128, max_uses: u32, max_users: u32}`.
- `config_id = poseidon2_hash([app, selector, current_index])` — per (target contract, function selector, generation index). **No time-based resets exist**; quota "windows" = admin re-running `sign_up` at a bumped `current_index` (write-once `PublicImmutable` per config_id; re-init reverts).
- `sign_up(app, selector, current_index, max_uses, max_fee, max_users)` — public, admin-only. The ONLY admin op. No withdraw, no pause, no admin transfer. Funds bridged to the FPC are unrecoverable by design.
- `subscribe(call, current_index, user, seat)` — private, **top-of-stack** (`msg_sender must be none`): claims a seat nullifier `poseidon2_hash_with_separator([config_id, seat], SEAT_NULLIFIER_SEPARATOR=1397047636)` (protocol duplicate-nullifier rejection = the `max_users` cap; no shared mutable state → no signup race), asserts fee-within-max, `set_as_fee_payer()`, `end_setup()`, inserts `SubscriptionNote{uses: max_uses-1}` owned by `user` (delivered `onchain_unconstrained().with_sender(user)`), then dispatches the wrapped call via `_call_sponsored_fn`.
- `sponsor(call, current_index, user)` — private, top-of-stack: pops the user's note for config_id (reverts if absent), re-inserts with `uses-1` only if `uses > 0` (note vanishes at exhaustion), fee assert, fee-payer, dispatch.
- `assert_fee_within_max(gas_settings, max_fee)`: `(gas_limits + teardown_gas_limits) · max_fees_per_gas <= max_fee`, asserted in **private setup** so an over-budget tx can't even be proven.
- `calibrate(call, user)` — simulation-only gas-measurement entrypoint, admin-gated via inner-hash authwit.
- Utility fns: `get_config(config_id)`, `get_subscription_info(user, config_id) -> (bool, u32 remaining)`, `compute_seat_nullifier`.

**Critical property:** `_call_sponsored_fn` dispatches the wrapped call **from the FPC**, so the target sees `msg_sender == FPC address`. The swap-kit apps were designed for this (functions take the user address as an explicit arg). 

**Known residual risks (from PR #126 body + code):** Sybil seat-grabbing (addresses are free; drain bound per config = `max_users × max_uses × max_fee`); no auto-retry on seat collision (caller responsibility); `seat-picker.ts` infinite-loops silently if `maxUsers` is undefined/invalid (guarded by `assertValidMaxUsers` — keep that guard in any adaptation); fresh deploy required on storage-layout change.

**TS side (`@aztec-kit/contracts-aztec` v0.0.18):**
- `lib/subscription-fpc.ts` — bespoke wrapper (`subscribeAndCall`, `sendSponsoredCall`, `calibrateSponsoredApp`); NOT a standard `FeePaymentMethod` (can't be: it wraps the app call).
- `lib/seat-picker.ts` — `findFreeSeat` / `countAvailableSeats` / `computeSeatNullifier` via `node.findLeavesIndexes(MerkleTreeId.NULLIFIER_TREE)` (100-leaf chunks, random-sample strategy). **Reuse-with-adaptation candidate** (TS↔Noir hash parity test included).
- `lib/fpc-gas-constants.ts` — empirically calibrated per-phase gas overhead constants. Pattern to copy.
- `apps/fpc-operator/` — optional dashboard (deploy wizard, sign_up UI, bridge-funding iframe, backup/restore). Confirmed unnecessary for single-app use: the entire admin surface is `deploy → fund → sign_up`.
- `apps/swap/scripts/register-fpc-signups.ts` — generation-bump pattern (tracks max existing configIndex, increments per rerun); `SIGNUP_POLICY = {maxUses: 100, maxUsers: 100}`, maxFee from P75 gas stats × 2.
- Tests: **vitest TS integration against an in-process local network** (`packages/contracts/aztec/tests/*.test.ts` — failure-cases, seat-race, overhead, getters). No Noir `#[test]`s for the FPC. Mirror this shape.

## 2. Dark Forest: current fee flow & the integration seam

- **Aztec pin**: `5.0.1` everywhere (matches aztec-kit exactly). pnpm monorepo.
- **Single tx choke point**: `client/src/Session/TxExecutor/TxExecutor.ts` `execute()` (lines ~278-509). Fee decision at 315-360: if `walletManager.getSponsoredFpcAddress()` is set → preflight sponsor FJ balance → `fee: { paymentMethod: new SponsoredFeePaymentMethod(addr) }`; else → preflight own balance → no `fee` field. **No gasSettings are ever passed** — txs go with aztec.js defaults. (Load-bearing: a quota FPC's `max_fee` assert compares declared gas limits; defaults would blow past any sane ceiling → explicit gas estimation/limits become required client work.)
- **Sponsor mode already fully wired, disabled in prod** (`VITE_SPONSOR_MODE=false`):
  - `client/src/config/env.ts:90-123` — `getSponsorMode()`, `getSponsoredFpcAddressFromEnv()` (`VITE_SPONSORED_FPC_ADDRESS` override), `getSponsoredFpcMinBalanceFjWei()`.
  - `WalletManager.ts:290-323` `registerSponsoredFpcWithWallet()` — registers canonical (salt-derived) or overridden FPC instance with the wallet/PXE; called on both embedded (552-559) and external (428-442) wallet paths. Also `getSponsoredFpcAddress()` (691), `getSponsoredFpcFeeJuiceBalance()` (744), `getSponsorFeeJuicePreflight()` (762).
  - `GameLandingPage.tsx` — terminal onboarding state machine; `CHECK_FEE_JUICE` step branches (2722/2750/2790/2818) between `runSponsorInfrastructurePreflightGate()` (300-427, checks sponsor balance) and `runAccountFeeJuicePreflightGate()` (464-780, the **complete bridge-funding fallback UX**: download-account-info button, "↗ Open bridge" link → `https://df-aztec-bridge-api.vercel.app`, ~8s polling loop until funded). The bridge fallback is fully reusable as the "sponsorship exhausted" escape hatch.
  - `SettingsPane.tsx:235-334` — "Sponsor gas (SponsoredFPC)" section, 3s balance polling, low-balance warning. Natural home for quota detail rows.
  - `ConnectionSettingsModal.tsx:197-224` — FPC address override field (localStorage).
- **Player authentication is `msg_sender`** (verified): every system contract's gameplay entrypoints do `let sender = self.msg_sender()` and assert ownership against it — e.g. `contracts/system/move/src/main.nr:555-556` (`new_source_planet.owner == sender, "Only owner account can perform that operation on planet."`), `:548` (ship controller), `:435` (rate limits keyed on sender). **Verbatim SubscriptionFPC dispatch (msg_sender == FPC) breaks every ownership assert.**
- **Accounts**: embedded wallet (`@aztec/wallets/embedded`, in-browser PXE, OPFS) with **Schnorr initializerless accounts** (`createSchnorrInitializerlessAccount`, WalletManager.ts:592-654) — every player HAS an account contract as tx entrypoint. External wallets via `@aztec/wallet-sdk` wrap into the same WalletManager; TxExecutor fee logic identical for both.
- **UI spots for the quota counter**: `TopBar.tsx:213-230` (always-visible; renders address + balance, tooltip pattern available), `SettingsPane.tsx` sponsor section, onboarding gate. No "remaining/resets" concept exists anywhere yet.
- **Contract deploy tooling**: `contracts/scripts/deploy/deploy.ts` (`DEPLOY_DEFINITIONS` array → shared `deployContracts` helper), `contracts/scripts/utils/feePayment.ts` (`FEE_PAYMENT_MODE=sponsored|account`, default sponsored via canonical SponsoredFPC), `accountResolution.ts` (offline Schnorr key gen), `sync-env-and-artifacts.ts` (writes `*_CONTRACT_ADDRESS/_DEPLOYER_ADDRESS/_DEPLOYMENT_SALT` into `packages/contracts/src/index.ts` consumed by the client as `@dfpunk/contracts`). **New FPC deploys should be one more entry in this pipeline.**
- **Validation tooling reality**: zero test suites, no CI. Real commands: `pnpm --filter client lint` (eslint), `pnpm --filter client build` (tsc -b + vite), `pnpm --filter contracts build-contracts` (fmt+compile+codegen), `pnpm --filter contracts lint`. Gates must be built from these + new test infra where the plan adds it.
- **Live deployment**: mainnet ("Alpha V5", aztec.dfpunk.xyz), client env in repo `client/.env` points at canonical mainnet RPC; our demo build can run locally against live contracts + Railway indexer (verified pattern from 2026-07-28 recon).

## 3. Aztec fee-abstraction interfaces (verified from node_modules @ 5.0.1 + aztec-packages v5.0.1)

- `FeePaymentMethod` interface (`@aztec/aztec.js/dest/fee/fee_payment_method.d.ts`): `getAsset()`, `getExecutionPayload(): Promise<ExecutionPayload>`, `getFeePayer(): Promise<AztecAddress>`, `getGasSettings(): GasSettings | undefined`.
- `SponsoredFeePaymentMethod` emits ONE private `FunctionCall` to `sponsor_unconditionally()` on the FPC + `feePayer = FPC`. `PrivateFeePaymentMethod` shows the richer pattern (args + authwit in the payload).
- Canonical `SponsoredFPC` Noir source (aztec-packages v5.0.1, `noir-projects/noir-contracts/contracts/fees/sponsored_fpc_contract/src/main.nr`) is 19 lines:
  ```noir
  #[external("private")]
  #[allow_phase_change]
  fn sponsor_unconditionally() {
      self.context.set_as_fee_payer();
      self.context.end_setup();
  }
  ```
  It is **called by the user's account entrypoint** during tx setup (the ExecutionPayload calls), so inside it `msg_sender == the player's account address`. **This is the identity hook the quota fork keys on** — quota per `msg_sender`, game calls untouched, standard tx shape preserved.

## 4. Reuse / adapt / build map

| Piece | Verdict | Source |
|---|---|---|
| Quota mechanics (Config struct, seat nullifiers, SubscriptionNote pop/decrement/reinsert, fee-within-max assert, write-once configs, generation bumps) | **Adapt** (transplant into setup-phase calling convention, key on `msg_sender`, drop per-selector granularity + `FunctionCall` dispatch + `calibrate`) | aztec-kit `main.nr` |
| Setup-phase FPC shape (`set_as_fee_payer` + `end_setup`, `#[allow_phase_change]`) | **Copy** | canonical SponsoredFPC |
| `seat-picker.ts` (findFreeSeat / countAvailableSeats / hash parity) | **Adapt** (config_id derivation changes; keep `assertValidMaxUsers` guard) | aztec-kit |
| Gas-constants calibration pattern | **Adapt** (DF needs per-game-method gas limits anyway) | aztec-kit `fpc-gas-constants.ts` |
| `SponsoredFeePaymentMethod` class shape | **Copy + extend** (new class emitting `sponsor_with_quota(...)` args) | aztec.js |
| Client sponsor-mode plumbing (env flags, WalletManager registration, TxExecutor branch, preflight gates, SettingsPane section, bridge fallback UX) | **Reuse + extend** | dark-forest client |
| Deploy pipeline (`DEPLOY_DEFINITIONS`, `sync-env-and-artifacts`, feePayment utils) | **Reuse** (add FPC entry) | dark-forest contracts/scripts |
| Generation-bump/registration script | **Adapt** | aztec-kit `register-fpc-signups.ts` |
| fpc-operator dashboard | **Skip** (confirmed optional) | aztec-kit |
| Vitest-integration test shape for FPC | **Adapt** (DF has no harness — new infra phase) | aztec-kit `tests/` |

## 5. Collision / dedup risks

- Don't build a second sponsor-mode pipeline: extend the existing `VITE_SPONSOR_MODE` path (env.ts / WalletManager / TxExecutor / SettingsPane) rather than adding a parallel one. The canonical-SponsoredFPC registration path and the quota-FPC path should be one switch, not two flags fighting.
- Don't duplicate the bridge-funding fallback: `runAccountFeeJuicePreflightGate` already implements the full "go fund yourself" UX — route quota-exhausted users into it.
- `sync-env-and-artifacts.ts` has an `isAllowedKey` allowlist (lines 39-47) — the new FPC address keys must be added there or they silently won't propagate to `@dfpunk/contracts`.
- The legacy typo flag `VITE_SPONSER_MODE` (env.ts:90-97) still parses — don't introduce a third spelling.
- aztec-kit is yarn/turbo; dark-forest is pnpm. The FPC contract gets vendored INTO dark-forest (own Nargo package), not imported from aztec-kit.
