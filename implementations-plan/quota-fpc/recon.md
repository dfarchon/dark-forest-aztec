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

---

# Recon — Phase 9 (admin-updatable policy)

Four read-only explorers, 2026-07-31, against `worktree-quota-fpc` at `e27e8c8`.
Scope: what an admin-updatable policy touches, and what already exists to reuse.

## 1. Contract surface — `contracts/fpc/quota_fpc/src/main.nr`

Every read/write of the two storage vars becoming mutable:

| Line | Var | Op | Function | Context |
|---|---|---|---|---|
| 161 | `policy` | WRITE `.initialize()` | `constructor` | public |
| 162 | `allowed_targets` | WRITE `.initialize()` | `constructor` | public |
| 238 | `allowed_targets` | READ | `subscribe_and_execute` | **private** |
| 243 | `policy` | READ | `subscribe_and_execute` | **private** |
| 273 | `allowed_targets` | READ | `sponsor_and_execute` | **private** |
| 278 | `policy` | READ | `sponsor_and_execute` | **private** |
| 490 | `policy` | READ | `get_policy` | utility |
| 495 | `allowed_targets` | READ | `get_allowed_targets` | utility |

No `#[contract_library_method]` touches storage — they receive already-read values as
params. Blast radius: 1 public writer, 4 private reads, 2 utility reads. **There is no
`admin` constructor parameter today.** Both entrypoints read BOTH vars.

Reuse-as-is: `assert_generation_fresh`, `assert_payload_allowed`,
`assert_player_account_allowed`, `assert_fee_within_max`, nullifier helpers, and the whole
`allowed_account_classes` / `require_unpublished_account` argument — its soundness rests on
the ACCOUNT's registry delay, not on our storage mutability, so it is untouched by this.

## 2. `DelayedPublicMutable` — upstream API (aztec-nr v5.0.1)

`pub struct DelayedPublicMutable<T, let InitialDelay: u64, Context>`

| Capability | Public | Private | Utility |
|---|---|---|---|
| read current value | `get_current_value()` | `get_current_value()` **(sets tx expiration)** | `get_current_value()` unconstrained |
| read current delay | `get_current_delay()` | — | — |
| inspect **scheduled** value | `get_scheduled_value()` | — | — |
| schedule value change | `schedule_value_change()` / `..._and_get_...` | — | — |
| schedule delay change | `schedule_delay_change()` | — | — |

**Consequence for the ops script:** "what is currently scheduled?" is reachable ONLY from a
public function. A utility getter cannot expose it — we must add a public view function and
simulate it, or the feature is impossible.

Prior art: `auth_contract` (immutable `admin: PublicImmutable<AztecAddress>` +
`assert_eq(self.storage.admin.read(), self.msg_sender(), "caller is not admin")` then
`schedule_value_change`) is the closest template. `token_blacklist_contract` bootstraps its
first value with `schedule_value_change` straight from the constructor.
`contract_instance_registry` uses `DEFAULT_UPDATE_DELAY = MAX_TX_LIFETIME`.

Costs: storage slots `= T::N * 2 + 2`; public write `2N+2` SSTOREs; **private read is a flat
~4k gates regardless of `T`'s size.**

## 3. Findings that change the design

**F1 — BLOCKER: a 12h delay bricks the contract for 12h after deploy.**
`DelayedPublicMutable` has **no `initialize()`**. The only write path is
`schedule_value_change`, which always lands at `now + current_delay`. A constructor that
schedules with a 12h delay leaves `get_current_value()` returning the **zero value**
(`max_fee=0, max_uses=0, max_users=0`, all-zero allowlist) for 12 hours — and an unset read
does NOT error, it silently returns zeroes (unlike `PublicImmutable`, which asserts). Then
`assert(seat < policy.max_users)` fails for everyone and every payload is
"non-allowlisted": **the paymaster sponsors nothing for 12h after every deploy.**
Fix: declare `InitialDelay = 0` so the constructor's schedule lands immediately, then call
`schedule_delay_change(TARGET_DELAY)` in the same constructor — delay *increases* apply
immediately, decreases are themselves delayed. Target delay stays a contract global with no
admin entrypoint.

**F2 — the delay shortens every sponsored transaction's life.** A private read calls
`set_expiration_timestamp`, which only ever tightens (`min`). Quiescent the horizon is
`anchor + current_delay`; with a change pending it is the activation time. The protocol
ceiling is `MAX_TX_LIFETIME = 86400s`. aztec-nr states the **optimal delay is
`MAX_TX_LIFETIME`** and recommends "at least a couple hours". 12h halves the inclusion
window; 24h imposes no additional constraint. Same failure shape as the reverted expiration
tightening (`6b33e64`), through a different door. **Open ask: 12h (chosen) vs 24h.**

**F3 — merge the two vars into one packed struct.** The docs warn that values "often
privately read together" should share one `T`: each separate var costs its own ~4k-gate
historical read AND its own expiration tightening. Both entrypoints read both vars, so two
vars = 2x cost and 2x tightening for nothing. Merging also makes "what's scheduled"
unambiguous (only ONE change can be pending per variable). Merged `T` = 3 + 12 = 15 fields
-> 32 storage slots per public write; private read stays ~4k gates.

**F4 — re-scheduling silently REPLACES the pending change.** There is no queue: a second
`schedule_value_change` before activation discards the first and resets the clock.
Scheduling the *current* value is the documented cancel. The ops script must show what is
pending before writing, or an operator will clobber a colleague's scheduled change.

**F5 — notes freeze `max_uses`; seats are a live bound.** `QuotaNote.remaining` is set once
from `policy.max_uses` at subscribe time and never re-read, so a mid-generation change
splits the day (already-subscribed players keep the old allotment). `assert(seat <
max_users)` is checked fresh, so raising `max_users` is purely additive and lowering it does
not un-claim seats. Both behaviours are impossible today and must be stated as intended.

**F6 — the client caches nothing, which is lucky.** `get_quota_info` is read per transaction
and `get_policy` per seat search, both uncached (`WalletManager.ts:819, 892`). A raised
`max_users` is picked up on the next seat search with no client change. `ConfigCache.ts` is
the repo's memoisation pattern — deliberately NOT used here; keep it that way.

**F7 — the client never reads `max_fee`, and the revert mapping is dead code.** Gas ceilings
are hardcoded (`QUOTA_DA_GAS_LIMIT = 50_000`, `QUOTA_L2_GAS_LIMIT = 6_000_000`,
`QUOTA_FEE_HEADROOM_MULTIPLIER = 2`, WalletManager.ts:363-368); the client never consults
`max_fee`. Worse: `reasonFromRevert` / `QuotaUnavailableError` have **zero callers in
`client/src`** — `TxExecutor.execute()` catches, `console.debug`s, and silently falls back to
self-pay. An admin lowering `max_fee` therefore produces a silent self-pay with no
explanation; and if it were wired, the copy says *"Network fees have spiked"* — factually
wrong for an admin-caused change. `QuotaStatus.readQuotaStatus()` is also dead code.
Pre-existing gaps that this change makes materially more likely to fire.

## 4. Ops / config layer

Script conventions (`contracts/scripts/`): header doc comment explaining *why*; hand-rolled
`argv.indexOf('--flag')` parsing whose error message is the usage string;
`loadContractsEnv({ optional: true })`; `createTolerantAztecNodeClient`; `setupWallet` +
`getOrCreateAccount`; `prepareFeePayment` + `buildFeeSendFields`; padded human output;
`main().catch(err => { console.error(err); process.exit(1) })` with distinct exit codes for
domain errors (deploy-fpc uses 2, calibrate-gas 3).

**Home for the new script: `contracts/scripts/operator/`** — `packages/quota-fpc/scripts/`
deliberately avoids the shared utils and re-plumbs its own wallet/env, so putting it there
means reinventing wallet, fee and env handling. Avoid the existing unrelated `update-config`
(the game's Config contract); follow `deploy-fpc` / `calibrate-fpc-gas` naming.

Reusable as-is: `loadContractsEnv`, `getOptionalEnv`/`getRequiredEnv`,
`createTolerantAztecNodeClient`, `setupWallet`, `getOrCreateAccount`,
`resolveDeployerAccount({mode:'loadOnly'})` for read-only paths, `prepareFeePayment`,
`buildFeeSendFields`/`buildSendOpts`, `getContractInstances`, `unwrapSimulateResult`,
`formatFeeJuiceWei`.

Dedup risks: the `perGeneration * 3n` worst-case formula exists in `schema.ts` AND is
re-derived in `deploy-fpc.ts` — the update script needs it too, so extract it rather than add
a third copy. `formatFeeJuice` is a local copy in `deploy-fpc.ts` despite the shared
`formatFeeJuiceWei`. `calibrate-gas.ts` already owns "what should max_fee be" — the update
script must only APPLY a number.

**Config drift (new problem):** `dark-forest.json` is today the source of truth, consumed
only at deploy. Once policy is mutable it diverges from chain state and nothing keeps them in
sync (no FPC equivalent of `sync-env-and-artifacts`). The update script must own this: treat
the JSON as initial values only and always read live state, and/or rewrite it after a
successful update.

Address plumbing: `deploy-fpc` only PRINTS `QUOTA_FPC_CONTRACT_ADDRESS`; nothing writes it to
`.env`. `calibrate-gas.ts` takes `--fpc <address>` — the convention to match.

## 5. Test shapes to match

All coverage is in `packages/quota-fpc/test/` (vitest). **No client-side tests exist.**
Unit: `inputs(overrides)` builder (`allowance.test.ts`), hand-rolled node mocks
(`seat-picker.test.ts`). `config-schema.test.ts`'s header literally says *"A paymaster's
policy is immutable"* — this phase must rewrite it. Integration:
`test/integration/quota-fpc.test.ts`, `describe.skipIf(!HAS_SANDBOX)`, deploys a real FPC and
drives it through `buildSandwichPayload` / `sendFromPaymaster` — the natural home for "a
policy change takes effect after the delay and not before". Note there is **no** existing
coverage of the `max_fee` ceiling firing.
