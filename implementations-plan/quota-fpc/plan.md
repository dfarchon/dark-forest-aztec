# Plan: quota-fpc — Sponsored transactions with per-player daily quotas

**Tier**: `/blueprint mid` · **eli5_mode**: Artifact · **Status**: **APPROVED by user 2026-07-29** (scope incl. the Phase 1B sandwich spike amendment; all Asks A1-A10 resolved — see Ask resolutions). Audit trail: codex r1 reject → revised; fable r1 conditional approve → adopted; codex final fresh pass conditional approve → conditions folded in. Implementation started 2026-07-29 at Phase 1. Seeds below are canonical.

## Goal

Dark Forest players currently must bridge $AZTEC → fee juice before they can play. This plan replaces that onboarding wall with an app-owned **quota paymaster**: a fee-paying contract (FPC) the app deploys and funds, which sponsors each player's transactions up to a per-player daily allowance. The client shows "N sponsored transactions remaining · resets at 00:00 UTC" and, when the allowance is exhausted (or sponsorship is unavailable), falls back — first to the player's own balance if they have one, else into the existing bridge-funding flow.

Decisions from clarifying round: **quota paymaster only** (no interim no-quota demo), **mainnet showcase from our own client build**, **PoC quality bar with `/harden security` scheduled before serious funding**, **automatic daily resets** (delivered protocol-natively — see Decision 6 — rather than via the originally-envisioned cron).

### Success criteria

1. A real sponsored gameplay tx (e.g. `move`) lands on mainnet paid by our FPC, sent from an unfunded player account.
2. The client displays remaining sponsored txs + reset time, decrementing as txs land — without misclassifying sync lag as exhaustion.
3. An exhausted/unavailable-quota player falls back to own-balance payment when possible, else is routed into the existing bridge-funding flow with clear copy.
4. Daily resets happen with zero operator action (no cron, no admin key).
5. Sandbox integration tests prove quota enforcement (per-player cap, seat cap, fee cap, revert behavior, sync lifecycle) **including a real DF game-contract call** — the gate for any mainnet funding.

## Why not verbatim aztec-kit? (context for auditors)

aztec-kit's `SubscriptionFPC` works by **being the tx entrypoint**: it dispatches the sponsored call itself, so the target sees `msg_sender == FPC`. Dark Forest's game contracts authenticate players via `msg_sender` (`contracts/system/move/src/main.nr:555-556`) — verbatim use breaks every ownership check. We transplant its quota mechanics into the **standard fee-abstraction shape** (canonical `SponsoredFPC` pattern): the FPC function is *called by the player's account entrypoint* during tx setup, so `msg_sender` inside it IS the player. This identity chain was **verified from source in audit round 1** (fable: `contract_function_interaction.js:62-65`, `account_entrypoint.js`, `authwit/account.nr` `EXTERNAL` path, `base_wallet.js:184`). See Competing Outline for the rejected alternative.

---

## Architecture & Implementation

> **Reading note (added 2026-07-31).** Everything in this section and in Phases 1-8 describes the design **as built through Phase 8**, when the policy and allowlist were constructor immutables and no privileged key existed. **Phase 9 deliberately reverses that.** Where the two disagree, **Phase 9 and its Transition semantics are canonical**; statements below in the present tense about "no admin", "immutable policy", "retuning means redeploying", or app-agnostic sponsorship are historical and superseded. They are kept rather than rewritten because two prior audit rounds reasoned against them.

### Components

```
contracts/fpc/quota_fpc/            NEW  Noir contract: QuotaFpc (the paymaster; no admin)
contracts/fpc/fpc_test_target/      NEW  Tiny Noir contract for spike/unit-level integration tests
packages/quota-fpc/                 NEW  TS pkg @dfpunk/quota-fpc (browser-safe core + node-only
                                         operator subpath): QuotaFeePaymentMethod, quota engine
                                         (fee-source resolution, sync-await, error taxonomy),
                                         seat picker, day-index, gas calibration constants
contracts/scripts/deploy/deploy-fpc.ts        NEW  deploy via existing utils pipeline
contracts/scripts/operator/calibrate-gas.ts   NEW  two-pass simulate (includeMetadata) calibration
client/src/config/env.ts            MOD  VITE_QUOTA_FPC_ADDRESS + quota defaults
client/src/Session/WalletManager/*  MOD  register QuotaFpc instance+artifact (both wallet paths)
client/src/Session/TxExecutor/*     MOD  thin adapter delegating fee decisions to the quota engine
client/src/Frontend/Views/TopBar.tsx        MOD  quota badge
client/src/Frontend/Panes/SettingsPane.tsx  MOD  quota detail rows
client/src/Frontend/Pages/GameLandingPage.tsx MOD  quota preflight gate → fallback chain
```

Dropped from the pre-audit draft: rotation cron + `rotate-sponsorship.ts` + admin key + `sign_up` (Decision 6); `sync-env-and-artifacts.ts` MOD (phantom — its `isAllowedKey` already suffix-matches `*_CONTRACT_ADDRESS/_DEPLOYER_ADDRESS/_DEPLOYMENT_SALT`; verified by both auditors).

### The contract (`QuotaFpc`) — no admin, fixed policy, protocol-native daily reset

aztec-nr `v5.0.1`. Quota mechanics adapted from aztec-kit `SubscriptionFPC`; calling convention from canonical `SponsoredFPC`.

Storage:
```noir
policy: PublicImmutable<Policy>,        // set once in constructor; NO admin, NO setters
quotas: Owned<PrivateSet<QuotaNote>>,   // per-player notes
// Policy    = { max_fee: u128, max_uses: u32, max_users: u32 }
// QuotaNote = { remaining: u32, generation: u32 }
```

There is **no admin, no `sign_up`, no per-generation config registration, and no rotation job**. The policy is a constructor immutable (constructor asserts `max_uses > 0 && max_users > 0 && max_fee > 0` — final-pass condition, mirroring the reference's `sign_up` guards); a generation (UTC day index) is valid purely by arithmetic against the anchor-block timestamp. Daily reset is a property of protocol time, not of any operator action. Changing policy = deploying a new FPC (fund in small tranches so abandoned remainders stay small — no withdraw exists because fee juice is protocol-non-transferable). **There is also no pause**: once a defect is being exploited, the only containment is not topping up the balance (explicit Ask A10).

**Rollover semantics (specified per final codex pass)**: `SLACK = 3600s` (covers proving+inclusion latency for a day-`D+1` subscription proven just before midnight). The `+1` grace window means an attacker can pre-claim tomorrow's seats from 23:50 UTC, and a determined actor can burn ~2× the daily bound in a short rolling window around midnight (day D's remainder + day D+1's full bound) — both explicitly accepted via Ask A9, both bounded by balance. Conversely, a client whose anchor lags >10min behind after midnight cannot use the new generation until it re-anchors: the engine forces a fresh sync at day boundaries, and `ChainClock` (node latest-block time) vs the PXE anchor can disagree — the engine derives the generation from the anchor it will actually prove against, falling back to a clear `QuotaRollover` state, never a failed proof. Phase 4 has a dedicated rollover test (subscribe 23:5x for D+1 → sponsor after midnight; lagging-anchor case → clear error → forced re-sync).

Entrypoints (both private, `#[allow_phase_change]`, called by the player's account entrypoint via the fee payload — `msg_sender == player`; assert it is not none):

- `subscribe(generation: u32, seat: u32)` — first sponsored tx of a player's day:
  1. Freshness: `generation == day(anchor_ts)`, OR `generation == day(anchor_ts)+1` when `anchor_ts` is within the final 600s of its day (shrinks the tomorrow-pre-squat window from 24h to 10min — codex High, fable M1). `anchor_ts` from `self.context.get_anchor_block_header().timestamp()` (verified API). Also `set_expiration_timestamp((generation + 1) * 86400 + SLACK)` to cut the stale-anchor tail (fable M1).
  2. **Player nullifier**: push `hash([generation, player], PLAYER_SEP)` — one subscription per player per generation, closing codex's Critical 1 (seat nullifiers alone made the quota a global, not per-player, budget).
  3. **Seat nullifier**: assert `seat < max_users`; push `hash([generation, seat], SEAT_SEP)` — race-free daily capacity cap (verbatim mechanism from reference).
  4. **Quota note**: if `max_uses >= 2`, insert `QuotaNote{remaining: max_uses - 1, generation}` owned by player — **before `end_setup()`** (non-revertible, fixing fable H2: in the reference the insert is after `end_setup` and an app-call revert burned the seat while destroying the note). Zero-`remaining` notes are never created (closes codex's `max_uses+1` off-by-one, verified against reference `main.nr:158-174`).
  5. `assert_fee_within_max(gas_settings, max_fee)` (verbatim from reference — private-setup assert means over-budget txs can't be proven); `set_as_fee_payer()`; `end_setup()`.
- `sponsor(generation: u32)` — subsequent txs: freshness + expiration as above; pop the player's note for `generation` (**revert if absent** — never subscribed, or exhausted; the assert-found is the entire cap since zero-remaining notes don't exist); re-insert `QuotaNote{remaining - 1}` only if `remaining - 1 >= 1`, before `end_setup`; fee assert; fee payer; end_setup.
- Utility (unconstrained): `get_policy()`, `get_quota_info(player, generation) -> (bool has_note, u32 remaining)`, `compute_seat_nullifier(generation, seat)`, `compute_player_nullifier(generation, player)`.

Accounting semantics: `subscribe` is use #1; a note holds *remaining* uses and disappears at exhaustion; `sponsor` of a `remaining==1` note consumes it without reinsertion. Effective per-player daily cap = exactly `max_uses`. Reverted app calls still consume the use and the FPC still pays (all quota side effects are setup-phase, non-revertible, consistently) — deliberate: reverts can't be free rides, and state is never half-burned.

### The client quota engine (`@dfpunk/quota-fpc`, browser-safe core)

All decision logic lives in the package (unit-testable — fable M6), TxExecutor becomes a thin adapter:

- **Fee-source resolution chain** (per tx): quota available → `QuotaFeePaymentMethod`; else own fee-juice balance sufficient → account-pays (this runtime fallback does NOT exist today — audit-corrected Fact 4); else block + bridge CTA.
- **Subscribe-vs-sponsor selection**: player-nullifier lookup (`node.findLeavesIndexes` on the siloed nullifier) distinguishes "never subscribed today" from "subscribed"; note presence/`get_quota_info` gives remaining. localStorage hint as cache only.
- **Sync-await (fable H1, tightened per final pass): evidence-based, never timeout-inferred.** After a quota tx, the engine awaits the *exact expected state transition* (post-subscribe: note appears with `remaining = max_uses-1`; post-sponsor: note reappears with `remaining-1`, or *disappears* on the final use — disappearance is an expected transition, not an error). A timed absence is `QuotaSyncPending`/`Unknown` — it NEVER auto-classifies as `QuotaExhausted` and NEVER auto-falls-back to self-payment (final-pass condition: cold start / reloaded PXE looks identical to exhaustion under a timeout heuristic; the public Wallet interface exposes no synced-height API, so Phase 1(b) must land a concrete evidence mechanism — the embedded wallet is ours, so its internals are available if needed). `QuotaExhausted` requires positive evidence: player nullifier exists AND the note's consumed terminal state is observed. Retry semantics are quota-aware — the blind `MAX_RETRIES=1` re-fire is bypassed for quota txs (a reverted-but-included tx already consumed its use); EXCEPT a seat-collision loss that is provably *not included* (duplicate-nullifier drop), which retries once with a fresh random seat (final-pass Low: blanket no-retry needlessly harms availability).
- **Gas settings**: per-method `gasLimits` from the calibration script (two-pass `simulate` with `includeMetadata: true` — codex corrected the API; `estimateGas` was wrong), worst-case fixtures, separate subscribe/sponsor overheads (subscribe is heavier: two nullifiers + note). **Fee clamping is exact dot-product arithmetic identical to the contract's** (final-pass Medium: clamping each dimension independently to `max_fee/limit` can admit ~2× the intended total): choose `maxFeesPerGas` such that `total_da_gas·fee_da + total_l2_gas·fee_l2 ≤ max_fee` with the same formula as `assert_fee_within_max`, TS↔Noir parity-tested; graceful `QuotaFeeSpike` when the network's predicted fee can't fit (fable H3). Regression test pins the declared settings.
- **Generation**: computed from chain time (the injected `ChainClock`, already in TxExecutor), not wall clock (fable M4). "Resets at 00:00 UTC" rendered from the same source.

### Trade-offs & alternatives not taken

1. **App-agnostic subsidy accepted (codex Critical 2, made explicit)**: in the setup-phase shape the FPC cannot see or bind the app payload — anyone can spend their daily quota on arbitrary non-DF txs. There is no structural fix in this calling convention; per-selector "curation" would be client-claimed theater. The quota (per-player nullifier + seat cap + fee cap) and the FPC balance are the bounds. This is an explicit Ask (A4), not fine print.
2. **No-admin fixed policy vs admin + rotation (pre-audit draft)**: kills the hot-key compromise path (codex High), the rotation availability dependency, the admin fee-juice runbook item, and a whole ops phase — at the cost of policy immutability per deployment (tuning = redeploy; congestion outrunning `max_fee` headroom requires redeploy if the clamp can't hold — mitigated by a generous headroom multiplier, Ask A8).
3. **One global policy vs per-function configs (reference design)**: the fee payload is structurally unbound to the app call, so per-function quotas are unenforceable here; a single daily allowance also matches the desired UX.
4. **Two entrypoints (subscribe/sponsor) vs one adaptive fn**: avoids a circuit that conditionally does seat-claim-or-note-read; the client must know which to call anyway (seat picking).
5. **Package boundary**: quota engine + payment method + seat picker in `@dfpunk/quota-fpc` (browser-safe exports separated from node-only operator code — codex); consumed by client, scripts, and tests.

---

## Phases

Every phase logs lessons to `implementations-plan/quota-fpc/lessons/phase-N.md`. Fast layers (`pnpm --filter contracts run lint`, `pnpm --filter client run lint`, affected-package tsc) run after each meaningful step.

### Phase 1 — Spikes: remaining unknowns + the Option 1 shape decision ✓ (amended at user request, 2026-07-29)

**1A — standard-shape unknowns** (as approved by the audits): (a) app-call revert: quota side effects persist (seat + player nullifier + note all non-revertible), FPC pays, state consistent; (b) back-to-back sponsored txs: land a concrete *evidence mechanism* for note-state transitions (public Wallet API has no synced-height — embedded-wallet internals are fair game), measure sandbox latency, prove a premature second tx fails the way we expect; (c) duplicate subscribe by one player reverts (player nullifier); (d) `max_uses==1` and exhaustion edges (no off-by-one; disappearance-on-final-use observed as an expected transition); (e) ~~external wallet boundary~~ — de-scoped per Ask A6; (f) 24h anchor bound + `set_expiration_timestamp` + rollover/SLACK behavior at a simulated day boundary; (g) depth-≥2 fee-ops probe (evidence for the Option 2 handoff recommendation). Uses a minimal spike contract + `fpc_test_target` on a local sandbox (run-isolation compliant: port from `~/.agents/ports.md`, real-disk datadir, pgid teardown).

**1B — Option 1 "sandwich" viability spike** (user-elected; prior art: `research/nethermind-fpc.md` + `research/call-binding.md`): minimal Noir origin-entrypoint FPC (payload struct, target-allowlist assert, `set_as_fee_payer`+`end_setup`, then invoke the player's account entrypoint with the player-signed payload) + TS assembly via the EXISTING `DefaultEntrypoint` from `@aztec/entrypoints/default` (verified present at 5.0.1; live-network-proven by Nethermind's cold-start flow — the build-from-scratch piece shrinks to the payload argument-encoding) + a target contract asserting on its observed `msg_sender`. The novel, no-prior-art-anywhere parts are the mid-stack account-entrypoint invocation and the payload encoding — the spike's focus. Evidence required: (i) a sandbox node accepts the FPC-as-origin tx; (ii) the Schnorr initializerless account entrypoint verifies its payload signature when called mid-stack; (iii) **the target sees the player's account as `msg_sender`**; (iv) an out-of-scope payload (non-allowlisted target) is unprovable; (v) a written estimate of the client-integration delta (what the sandwich breaks in EmbeddedWallet/TxExecutor assumptions vs the standard payment-method path).

**Shape decision gate (after 1A+1B, before Phase 2)**: with spike evidence in hand, the user picks the integration shape — **sandwich** (call-binding, kills the A4 grief surface, larger client surgery) or **standard sibling-call** (audited baseline, app-agnostic). Quota mechanics (policy, player/seat nullifiers, note accounting, freshness, fee cap) are IDENTICAL in both shapes and carry forward regardless.

**Validation gate** — Commands: spike vitest files against local sandbox. Pass: 1A questions (a)-(g) answered with evidence in `lessons/phase-1.md` (sync-latency numbers included); 1B evidence (i)-(v) recorded with a go/no-go recommendation; shape decision made by the user. Layers: integration (sandbox).

### Phase 2 — `QuotaFpc` Noir contract ✓

Full contract per Architecture; `contracts/fpc/` Nargo members wired into `contracts/Nargo.toml` and the existing `build-contracts` flow. *Shape-dependent surface per the Phase 1 decision*: standard shape exposes `subscribe`/`sponsor` as sibling-call entrypoints; sandwich shape exposes an origin `entrypoint(payload, user)` with the binding assert and account-entrypoint dispatch. The quota core (policy, nullifiers, note accounting, freshness, fee assert) is shared library code either way.

**Validation gate** — Commands: `pnpm --filter contracts run build-contracts` && `pnpm --filter contracts run aztec:fmt:check` && `pnpm --filter contracts run lint`. Pass: exit 0, artifacts generated. Layers: compile + lint.

### Phase 3 — `@dfpunk/quota-fpc` TS package ✓

Quota engine, `QuotaFeePaymentMethod`, seat picker (adapted; keep the `assertValidMaxUsers` guard), day-index, error taxonomy. Unit tests: TS↔Noir parity for BOTH nullifiers, day-index UTC edges, fee-source resolution chain, sync-await state machine, clamping logic, payload shape.

**Validation gate** — Commands: `pnpm --filter @dfpunk/quota-fpc run test` (unit) && `pnpm --filter @dfpunk/quota-fpc run lint` && package tsc. Pass: exit 0. Layers: unit + typecheck + lint.

### Phase 4 — Sandbox integration suite (the mainnet gate) ✓ sponsored gameplay confirmed against the real Dark Forest contracts by manual play (2026-07-29) (state-hash args cannot be hand-built)

Env-gated (`describe.skipIf(!process.env.QUOTA_FPC_SANDBOX_URL)`) vitest: full lifecycle — deploy, subscribe+app-call, sponsor chain with evidence-based sync, exhaustion revert + classification, seat cap, per-player cap (Sybil second account), fee cap incl. dot-product clamp parity, stale/future generation reverts, **rollover across a day boundary (incl. lagging-anchor recovery)**, app-revert quota persistence, duplicate-subscribe revert, **seat-collision fresh-seat retry (not-included case only)**. **Plus the real-game leg (codex condition): deploy the actual DF contracts to the sandbox via the existing `contracts/scripts/deploy` pipeline and sponsor a real `initialize_player` + `move` through the quota FPC.** Mainnet (Phase 8) is blocked until this passes.

**Validation gate** — Commands: `QUOTA_FPC_SANDBOX_URL=... pnpm --filter @dfpunk/quota-fpc run test`. Pass: full suite green incl. the real-game leg. Layers: integration (sandbox, live local network).

### Phase 5 — Deploy + calibration scripts ✓

`deploy-fpc.ts` (existing utils pipeline; policy as constructor args from a reviewed constants file), `calibrate-gas.ts` (two-pass simulate `includeMetadata`, worst-case fixtures, subscribe/sponsor split, emits the constants consumed by the engine + a regression test), funding runbook (`bridge/` CLI; tranche guidance).

**Validation gate** — Commands: scripted E2E on sandbox (deploy → calibrate → constants file emitted → integration suite still green with declared settings) && `pnpm --filter contracts run lint`. Pass: exit 0. Layers: integration (sandbox) + lint.

### Phase 6 — Client integration (thin) ✓ (plumbing; sandwich assembly lands with Phase 7 UI)

`env.ts` (`VITE_QUOTA_FPC_ADDRESS` activates quota mode inside the existing `VITE_SPONSOR_MODE` path — one switch), WalletManager registration (embedded-only per Ask A6), TxExecutor thin adapter delegating to the engine (fee-source chain, no blind retry for quota txs). *Shape-dependent*: the standard shape slots into the existing payment-method plumbing; the sandwich shape additionally lands the custom `EntrypointInterface` + wallet-level tx assembly path scoped in spike 1B(v) — the shape gate's client-delta estimate becomes this phase's spec.

**Validation gate** — Commands: `pnpm --filter client run lint` && `pnpm --filter client run build`. Pass: exit 0; plus the full-stack sandbox smoke (client dev build against the Phase 4 sandbox game deployment) — **mandatory before Phase 8 funds beyond canary dust** (final-pass condition); if genuinely impractical, Phase 8 is limited to the canary until an equivalent live validation passes. Layers: lint + build + manual integration.

### Phase 7 — UX ✓ (badge live, assembly wired, copy revised after manual review)

TopBar badge ("⛽ N free txs · resets 00:00 UTC", tooltip), SettingsPane quota rows (remaining, seats left today, FPC balance — extending the existing sponsor section), GameLandingPage preflight: quota → own-balance → bridge fallback (reusing `runAccountFeeJuicePreflightGate` verbatim), distinct copy for `QuotaSyncPending` vs `QuotaExhausted` vs `QuotaFeeSpike`. Copy is plain language ("You have 12 free moves left today").

**Validation gate** — Commands: `pnpm --filter client run lint` && `pnpm --filter client run build`. Pass: exit 0 + screenshots of the four states reviewed. Layers: lint + build + manual UI review.

### Phase 8 — Mainnet showcase ⏸ awaiting explicit user go-ahead. The Phase 4 gate is now MET (sponsored gameplay confirmed locally). Recommended before funding: measure gas with the Phase 5 calibration script, and confirm on testnet, which shares mainnet's 117,668 per-tx DA limit vs 271,200 locally.

Deployer keys generated offline (`accountResolution` pattern; local `.env` only — the key is only a deployer, holds pocket change, and has NO ongoing power over the FPC). Deploy `QuotaFpc` with the reviewed policy; calibrate against mainnet; fund the first tranche via `bridge/` CLI (Ask A1); canary account first; then the demo: sponsored gameplay from an unfunded account, counter decrementing, exhaustion → fallback demo (tiny-policy second FPC instance for the exhaustion demo if needed); handoff note for the DF team (costs, tranche strategy, redeploy-to-retune, `/harden security` before scaling funds).

**Validation gate** — Commands: manual, evidenced. Pass: mainnet tx hash of a sponsored `move` from an unfunded account; UI counter behavior verified; fallback demonstrated; runbook + handoff complete. Layers: e2e (live mainnet). **Requires explicit user confirmation before deploy/funding.**

---

### Phase 9 — Admin-updatable policy ✓ (added and completed 2026-07-31, user-directed)

**Why**: retuning currently means redeploying and stranding the old instance's balance. The DF team should be able to agree numbers with us, send one transaction, fund, and be done. This deliberately reverses the "no admin, nothing privileged" property of Phases 1–8 — see the amended Security section for what that costs.

**User decisions (fixed, not for the audits to re-litigate):** full admin control over `max_fee`/`max_uses`/`max_users` with no immutable bounds; the **target allowlist is also mutable**; delay is **12h**, fixed in the contract with no admin entrypoint to change it; the admin address is an **immutable constructor argument** with no transfer function (whoever deploys owns it — if DF deploys, DF owns it); `allowed_account_classes` and `require_unpublished_account` stay **immutable** (that is the C1 fix, hardened over two codex audits).

#### Architecture (amends "The contract — no admin, fixed policy" above)

One merged `DelayedPublicMutable`, not two:

```
global UPDATE_DELAY_SECONDS: u64 = 43_200;   // 12h, fixed. No entrypoint changes it.
global BOOTSTRAP_DELAY: u64 = 0;             // see "the bootstrap trap" below

#[derive(Deserialize, Eq, Packable, Serialize)]
pub struct PolicyBundle {
    max_fee: u128,
    max_uses: u32,
    max_users: u32,
    allowed_targets: [AztecAddress; MAX_ALLOWED_TARGETS],
}

#[storage]
struct Storage<Context> {
    admin: PublicImmutable<AztecAddress, Context>,                          // NEW, immutable
    settings: DelayedPublicMutable<PolicyBundle, BOOTSTRAP_DELAY, Context>, // was policy + allowed_targets
    schedule_revision: PublicMutable<u64, Context>,                         // NEW, monotonic CAS counter
    allowed_account_classes: PublicImmutable<[Field; MAX_ALLOWED_ACCOUNT_CLASSES], Context>, // unchanged
    require_unpublished_account: PublicImmutable<bool, Context>,            // unchanged
    quotas: Owned<PrivateSet<QuotaNote, Context>, Context>,                 // unchanged
}
```

**`QuotaNote` changes shape.** It currently stores `{ remaining, generation }`. Clamping correctly requires knowing how much has been *spent*, not how much was left under a previous policy, and clamping seats requires knowing which seat a note belongs to:

```
struct QuotaNote { spent: u32, seat: u32, generation: u32 }   // was { remaining, generation }
```

`sponsor_and_execute` then asserts `note.spent < live.max_uses` and `note.seat < live.max_users`, and re-inserts with `spent + 1`. Deriving from `remaining` cannot work: `remaining` already excludes the use consumed by subscribing, so `min(remaining, new_max_uses)` **over-grants by one** — with a new cap of 1 an existing subscriber would get one *more* transaction (audit round 3). Storing `spent` makes the check exact and policy-independent.

**The bootstrap trap and its fix (recon F1).** `DelayedPublicMutable` has no `initialize()`; every write goes through the timer, including the first. Declaring the delay as 12h would leave the settings reading as all-zeroes for 12h after deploy — an unset read returns zeroes rather than erroring — so `assert(seat < max_users)` fails for everyone and every payload is "non-allowlisted". **The paymaster would sponsor nothing for its first 12 hours.** Fix: declare the generic delay as `0`, and in the constructor, **in this order**:

1. `settings.schedule_value_change(bundle)` — lands immediately because the current delay is 0.
2. `settings.schedule_delay_change(UPDATE_DELAY_SECONDS)` — a delay *increase* applies immediately.

Reversing those two lines reintroduces the dead window. A test asserts sponsorship works in the same block as deploy.

**Why one bundle instead of two variables (trade-off, documented at user request).** Both private entrypoints read policy and targets together. Each separate `DelayedPublicMutable` costs its own ~4k-gate historical read *and* its own `set_expiration_timestamp` tightening, per sponsored transaction — aztec-nr's docs explicitly recommend grouping values that are read together. **The cost of bundling: only ONE change can be pending at a time across all four dials.** There is no queue — scheduling a `max_fee` change while a `max_users` change is still pending **silently discards the first and resets the clock** (recon F4). Keeping them separate would allow two independent pending changes, at 2× the per-transaction proving cost forever. Updates are rare; sponsored transactions are constant — bundling wins, but the operator tooling must make the single-slot behaviour impossible to trip over (see 9.3).

**Reads.** Private: one `settings.get_current_value()` per entrypoint, replacing two `.read()`s. Utility `get_policy()` / `get_allowed_targets()` keep their signatures and derive from the bundle, so the client needs no change (recon F6: the client caches nothing and re-reads per transaction). The pending change is exposed through a **public view** simulated off-chain (see Writes below), not a hand-rolled utility getter.

**Writes.** `#[external("public")] fn schedule_settings(bundle: PolicyBundle, expected_revision: u64)`:

1. `assert_eq(self.storage.admin.read(), self.msg_sender(), "caller is not admin")` (the `auth_contract` pattern).
2. **Re-assert the constructor's invariants** — `max_fee > 0`, `max_uses > 0`, `max_users > 0`, at least one non-zero target. The constructor has these (`main.nr:141-159`) and ledger row 15 exists precisely because the reference contract lost them when its setter was deleted. A setter without them loses them again, and a zero bundle bricks sponsorship for 12h with no shortcut.
3. **Compare-and-swap against the monotonic `schedule_revision`**, NOT a timestamp: assert `expected_revision == schedule_revision.read()`. A failed call reverts, leaving the revision untouched. Timestamp-based CAS is unsound (audit round 2): `get_scheduled_value()` retains its timestamp *after* activation and the bootstrap write makes it non-zero, so "0 means nothing pending" can never hold; and two replacements included in the same block share an activation timestamp, so both would pass. A revision counter has neither problem. Re-scheduling always silently replaces (recon F4), and an off-chain `--replace-pending` flag cannot make that safe — two operators can both pass a CLI check and the later transaction wins with no trace.
4. `schedule_value_change(bundle)`, then `schedule_revision.write(current + 1)` — public writes are immediate and transactions execute serially, so schedule-then-increment is atomic with no external call and no re-entrancy surface. The public view returns the revision alongside the pending bundle so the script can round-trip it.

**Reading the pending change** uses the library's supported `get_scheduled_value()` on `PublicContext` via an `#[external("public")]` view that the script simulates off-chain (no gas, no transaction). A utility-context getter is *possible* by hand-rolling `WithHash::utility_public_storage_read` + `svc.get_scheduled()` — both audits confirmed the pieces are public API — but reaching into library internals to save one function, for a caller that already simulates, is the wrong trade.

#### Transition semantics (user decision, revised 2026-07-31 after audit round 2)

**Nothing takes effect in under 12 hours. There is no fast lever and no pause.** An earlier draft of this plan said `max_fee` "applies immediately" — that was wrong and is corrected here. Every dial waits the full delay; what differs is only what happens *at* activation:

- **`max_fee` and the target allowlist** are read live in both private entrypoints, so at activation they apply to the very next sponsored transaction.
- **`max_uses`** — **CLAMP** (user decision, revised after audit round 2). The note stores `spent`; every sponsored transaction asserts `note.spent < live.max_uses`. A reduction therefore bites for everyone at activation, including players already holding allowances. Grandfathering was chosen first and reversed: repeated updates (A -> B -> C every 12h) leave A-era allowances spending at C-era fees, which no single `max(old,new)` bound covers.
- **`max_users`** — **ALSO CLAMP** (user decision, audit round 3). The note stores its `seat`; every sponsored transaction asserts `note.seat < live.max_users`. Clamping only allowances was not enough: seats claimed under a larger cap survived, so admitting 100 players, cutting to 1, then raising the fee would let all 100 spend at the new fee — making the stated bound false. Raising `max_users` remains purely additive; lowering it now stops high-seat holders at activation.
- Consequence: **a player being sponsored can lose sponsorship mid-day**, not merely see a smaller counter. The client copy must present this as a policy change, not a fault.

**Consequences to state in the ops output and the handoff:**
- A reduction is fully effective at activation — no ~36h tail, because nothing is grandfathered.
- A player mid-session can see their remaining count drop when a reduction activates. This is the accepted cost of clamping, and the client copy must not read as a bug.
- **Incident response is 12 hours, minimum.** If a defect or abuse is discovered, the earliest any mitigation lands is the delay. Sizing funding tranches, not reacting quickly, remains the real control (Ask A10, reaffirmed under Phase 9).

**Loss bound.** With BOTH dimensions clamped, every sponsored transaction is checked against the *live* bundle, so no earlier era's allowance or seat can be spent under a later era's fee. The homogeneous helper is therefore exactly correct, with no cross-product envelope:
`worstCasePerGeneration = maxFeeWei * maxUsesPerDay * maxUsersPerDay`, `* 3n` for the generations chargeable around a rollover. The update script prints this for the *scheduled* bundle alongside the paymaster's live balance, so a raise is never approved against a stale mental model.

#### The cutover window (both audits, High)

A pending change sets every sponsored transaction's expiration to `timestamp_of_change - 1` (`scheduled_value_change.nr:117`), not to `anchor + delay`. In the final minutes before an activation the inclusion window therefore collapses toward zero, and a proof begun before the boundary can expire before it lands — surfacing as "Invalid expiration timestamp", the exact failure `main.nr:430-447` and commit `6b33e64` were written to eliminate. This is inherent to the mechanism (it is what makes private reads sound), so it is handled, not avoided:

- **Client (root fix, in scope after audit round 2)**: three changes, because a script-side guard alone is point-in-time, overridable, and duplicates constants it does not own.
  1. Move the gas profile (`QUOTA_DA_GAS_LIMIT`, `QUOTA_L2_GAS_LIMIT`, headroom) out of `WalletManager.ts:363-368` into `@dfpunk/quota-fpc` so the client and the ops script consume ONE definition instead of two copies that can drift.
  2. **Read the effective `max_fee` before proving** and skip the sponsored path when the transaction cannot fit — rather than proving, failing, and discovering it in a catch block.
  3. `TxExecutor.execute()` must **surface a cause-neutral, user-visible notice before falling back to self-pay** (`TxExecutor.ts:345-350` currently only `console.debug`s). Players must never be charged silently. Full `reasonFromRevert` taxonomy wiring stays out of scope; the notice does not need to explain *why*.
- **Ops**: the update script prints the activation time in UTC and warns that sponsorship gets flaky in the minutes around it.
- **Test**: a proof spanning the cutover.

#### 9.1 ✓ — Contract

`PolicyBundle`, merged storage, immutable `admin` constructor arg, ordered bootstrap, `schedule_settings`, `get_scheduled_settings`, rewire both private entrypoints to a single bundle read. Noir tests where cheap.

**Validation gate** — Commands: `pnpm --filter contracts run build-contracts` && `pnpm --filter contracts run lint`. Pass: exit 0, `QuotaFpc.ts` regenerated with the new constructor arity and `schedule_settings`/`get_scheduled_settings` present. Layers: typecheck/lint + contract compile.

#### 9.2 ✓ — Config + deploy

`adminAddress` in the schema — **required and explicit, no deployer fallback** (user decision; a dry-run cannot display a signer-derived default, so a silent default means approving a deploy without seeing who permanently holds the key). Validated 32-byte and non-zero in the schema AND asserted non-zero on-chain, because a malformed immutable admin permanently bricks updates. extract the `perGeneration * 3n` worst-case helper so it is not copied a third time (recon: it exists in `schema.ts` and again in `deploy-fpc.ts`); `deploy-fpc.ts` passes admin + bundle; deploy output states plainly that `maxLossWei` is now a **deploy-time sanity check, not a bound**, because the admin can exceed it afterwards.

**Validation gate** — Commands: `pnpm --filter @dfpunk/quota-fpc run test` && `pnpm --filter contracts run lint` && `pnpm --filter contracts run deploy-fpc -- --config fpc/config/dark-forest.json --dry-run`. Pass: exit 0; dry-run prints the admin address and the revised loss-cap wording. Layers: unit + lint + script smoke.

#### 9.3 ✓ — The update script (`contracts/scripts/operator/update-fpc-policy.ts`)

For a non-expert operator. Lives in `contracts/scripts/operator/` (that is where the shared wallet/fee/env helpers are reachable); named to avoid the unrelated existing `update-config`. Behaviour:

- `--fpc <address>` (matching `calibrate-gas.ts`), `--show` prints current effective settings, **any pending change and when it activates**, and the paymaster balance.
- Setting flags (`--max-uses`, `--max-users`, `--max-fee-wei`, `--add-target`, `--remove-target`) read the *current on-chain* bundle, apply only the named changes, and write the whole bundle back.
- **Refuses to write while a change is pending** unless `--replace-pending` is passed, printing exactly what would be discarded. The flag is UX only — the real guard is the contract's compare-and-swap (9.1), because a CLI check cannot win a race against another operator.
- **Edits are applied on top of the PENDING bundle when one exists** (user decision), so a second edit does not silently discard the first; falls back to the live bundle when nothing is pending. The script states which base it used.
- Prints the scheduled bundle's worst-case spend per generation, the paymaster's live balance, and a plain-language "takes effect at <UTC time>" line. Reductions need no extra latency caveat under clamping — they are fully effective at activation.
- **Refuses a `max_fee` below what the client can actually spend**, computed from the SHARED gas profile in `@dfpunk/quota-fpc` (not a second copy of the constants). Override: `--force-below-client-floor`. This is defence in depth — the root fix is client-side (see The cutover window); the script guard is point-in-time and overridable and must not be described as closing the incident.
- Before confirming, displays **network, FPC address, signer, and the on-chain admin** so an operator cannot act against the wrong instance or discover mid-run that they are not the admin.
- `--dry-run` everywhere. Distinct exit codes per the repo convention.
- Does **not** calibrate gas — `calibrate-gas.ts` owns deriving the right `max_fee`; this only applies and sanity-floors a number.
- Documents that `dark-forest.json` is *initial values only* once an update has happened, and prints the config-drift warning (recon: nothing keeps the file and the chain in sync).

**Validation gate** — Commands, exactly:
```
pnpm --filter contracts run lint
pnpm --filter contracts exec tsx scripts/operator/update-fpc-policy.ts --fpc $FPC --show
pnpm --filter contracts exec tsx scripts/operator/update-fpc-policy.ts --fpc $FPC --max-uses 20 --dry-run
pnpm --filter contracts exec tsx scripts/operator/update-fpc-policy.ts --fpc $FPC --max-uses 20
pnpm --filter contracts exec tsx scripts/operator/update-fpc-policy.ts --fpc $FPC --max-users 60          # must REFUSE: pending
pnpm --filter contracts exec tsx scripts/operator/update-fpc-policy.ts --fpc $FPC --max-users 60 --replace-pending
pnpm --filter contracts exec tsx scripts/operator/update-fpc-policy.ts --fpc $FPC --max-fee-wei 1 --replace-pending   # must REFUSE: below client floor, NOT "pending"
```
Pass: lint exit 0; `--show` reports current settings, the pending change and its UTC activation time; the un-flagged second write is refused with a non-zero exit code; `--replace-pending` succeeds and reports it based the edit on the PENDING bundle; the below-floor write is refused. Layers: lint + live local-network script e2e.

#### 9.4 ✓ — Tests

Integration (`packages/quota-fpc/test/integration/quota-fpc.test.ts`, the existing sandbox harness):

1. **Bootstrap regression**: sponsorship succeeds at the **first possible post-deployment anchor**, with no 12h wait. (Phrased this way deliberately: "the same block as deploy" is not meaningful, since a private tx cannot anchor to constructor state until that block exists.)
2. **Activation**: a scheduled change is NOT in effect before its activation time, and IS after — using the local debug API `warpL2TimeAtLeastBy(43_200)` (verified present: `@aztec/stdlib` `aztec-node-debug.d.ts:48`). Without warping this test would take 12 hours; adding the warp helper to `harness.ts` is explicit Phase 9 work. Note the harness captures `generation` once in `beforeAll`, so a warped test must re-derive it.
3. **Cutover**: a proof begun before an activation boundary and included after it fails as expected, and the client's single fresh-anchor retry recovers.
4. **Authorisation**: non-admin `schedule_settings` reverts.
5. **Compare-and-swap**: a second schedule with a stale `expected_revision` reverts; with the correct one it replaces; **two replacements in the SAME block** cannot both succeed (the case a timestamp-based check would have let through); a failed call leaves the revision unchanged.
6. **Setter invariants**: a zero-`max_uses` / zero-target bundle reverts.
7. **`max_fee` ceiling fires** — no coverage exists today (recon), and Phase 9 makes it mutable.
8. **Mutable allowlist**: adding a target makes it sponsorable after activation; removing one stops it.
9. **Getter parity**: `get_policy()` / `get_allowed_targets()` return the same values the private path enforces.

Schema unit tests for `adminAddress` (required, non-zero, malformed). Rewrite the `config-schema.test.ts` header, which currently states "A paymaster's policy is immutable".

**Validation gate** — Commands: `pnpm --filter @dfpunk/quota-fpc run test` && `QUOTA_FPC_SANDBOX_URL=http://localhost:8590 pnpm --filter @dfpunk/quota-fpc run test:integration`. Pass: exit 0; **all nine integration cases above present and green**, with none of them skipped — `QUOTA_FPC_SANDBOX_URL` must be set so `describe.skipIf(!HAS_SANDBOX)` is satisfied. (`real-game.test.ts` legitimately stays skipped without the game deployment; the gate is about the nine cases, not a repo-wide zero-skip count.) clamping proven by a test that reduces `max_uses` while a player holds a larger allowance and asserts the spend is clamped at activation. Layers: unit + integration (live local network). **This is the phase gate for "done" per the user's Phase 0 answer.**

Note the package suite cannot exercise `TxExecutor`'s fallback notice (no client tests exist at all — recon). The client changes above are therefore covered by a **manual full-stack check** recorded in the phase's lessons file: lower `max_fee` below the client floor on a local instance, warp past activation, attempt a move, and confirm the player sees a notice rather than a silent charge.

#### 9.5 ✓ — Docs + handoff

Amend `docs/quota-fpc-local.md` with the update flow. Rewrite `handoff.html`: the claims *"there's no admin key to compromise"* and *"deliberately no admin key"* become **false** and must be replaced with an honest description — the operator holds a key that can retune the policy and the sponsored-contract list after 12 hours, the balance is the cap, and whoever deploys holds that key. Republish to the same Artifact URL.

**Validation gate** — Commands: `pnpm --filter client run lint` && `pnpm --filter client run build` && `grep -rni "no admin\|policy is immutable\|nobody can widen\|retuning means\|redeploy to retune" docs client contracts packages implementations-plan/quota-fpc/handoff.html`. Pass: exit 0 for lint/build; the grep returns **no live claims** (it deliberately does NOT search "admin key", since the required positive disclosure contains that phrase) (matches inside `plan.md`'s superseded rows and dated ledger entries are excluded by scoping the grep to the paths above, which deliberately omit `plan.md`); artifact republished and re-read to confirm the admin disclosure is present. Layers: lint + build + explicit doc assertion.

---

## Security & Adversarial Considerations

**Threat model**: the FPC custodies fee juice with no withdraw (protocol-non-transferable) and no pause. All drain paths are **griefing, not profit** — fees go to sequencers/burn, the attacker gains nothing (fable) — which lowers attacker motivation but not our duty to bound loss. The FPC balance is the absolute backstop: fund in small tranches, top up as the demo proves out.

- **Per-player enforcement**: player nullifier (one subscription/player/day) + seat nullifier (≤ `max_users` players/day) + note accounting (= `max_uses` txs/player/day) + `max_fee` (per-tx ceiling, unprovable if exceeded). Worst-case spend per day ≈ `max_users × max_uses × max_fee` — the policy constants must make this arithmetic comfortably below one funding tranche, and that arithmetic goes in the handoff note (fable L5: funding, not policy, is the real limit).
- **Sybil**: addresses are free; the per-player cap forces an attacker to `max_users` identities to capture a full day (was: one account, pre-fix). Burning the full fee bound also costs the attacker `max_users × max_uses` real ClientIVC proofs; burning just the *seats* is cheap (`max_users` FPC-paid subscribes) — denial is ~free, drain is expensive (fable). Seats refresh at midnight.
- **App-agnostic subsidy (accepted, Ask A4)**: quota spend is not bound to DF gameplay; a claimant can sponsor arbitrary txs within `max_fee`. Bounds above apply regardless of what the tx does.
- **Freshness / time attacks**: generation validity = `day(anchor_ts)` (+1 only in the last 10min of a day); protocol enforces inclusion ≤ anchor+24h (`private_context.nr:189,442` — the load-bearing guarantee, cited per fable M2; an SDK bump changing `MAX_TX_LIFETIME` changes this analysis and is flagged in the handoff). Active exposure ≈ 2 generations (stale-anchor tail additionally cut by `set_expiration_timestamp`). No operator clock involved anywhere.
- **Reverts**: all quota side effects are setup-phase/non-revertible and consistent; a deliberately-reverting tx burns the attacker's own quota while the FPC pays — bounded by the same daily arithmetic. Client never blind-retries a quota tx.
- ~~**No admin = no key to steal**: nothing privileged exists post-deploy.~~ **SUPERSEDED BY PHASE 9 — see "Admin key (Phase 9)" below.** True for Phases 1–8 only.
- ~~**Config integrity**: policy is a constructor immutable — nobody can widen it, ever.~~ **SUPERSEDED BY PHASE 9.**

### Admin key (Phase 9) — what reversing "no admin" costs

The user chose full admin control with no immutable bounds, and a mutable target allowlist, accepting the following. These are consequences, not open questions:

- **Correction to the Phases 1-8 threat model above (codex Med-4).** That section's "all drain paths are griefing, not profit" no longer holds: with a mutable allowlist an admin can point sponsorship at a contract they control and, if they can also sequence, capture the fees — extraction, not griefing. Its "app-agnostic subsidy / arbitrary txs" wording also predates the target binding and the C1 account-class binding, both of which now constrain what a *player* can do. And "no pause" is now only half true: scheduling a zero-ish bundle is a **delayed** pause (12h), which is the closest thing to an emergency brake this design has — worth naming in the incident runbook, though it is far too slow to stop an in-progress drain.
- **The threat is not theft, it is redirection.** Fee juice remains non-transferable, so nobody can withdraw the pool. But an admin — or whoever takes that key — can point the allowlist at a contract they control and spam it. If they can also sequence, they capture those fees: this converts the pre-Phase-9 "burn the pool" griefing path into an **extraction** path. Still bounded by the balance.
- **`maxLossWei` stops being a bound.** It validates the *initial* policy at deploy and nothing after. The deploy script must say so rather than implying a cap it no longer enforces.
- **A single transaction can drain the pool** — with the caveat that this requires the balance to fit inside the protocol's per-transaction gas limits; beyond that it takes several. With `max_fee` freely settable, once 12h elapses a small number of sponsored transactions can consume the whole balance.
- **A scheduled RAISE is a publicly announced start-gun (fable A3).** The pending value and its activation timestamp are public 12h ahead, so anyone can be first in line the second a higher `max_fee` goes live, and the collapsing expiration window around activation favours whoever has the fastest prover. Raises should be paired with funding and monitoring, not merely announced.
- **The 12h delay is also OUR minimum incident-response time.** Nothing — not `max_fee`, not the allowlist — takes effect sooner, and there is no pause. Under clamping a reduction is fully effective at activation, but activation itself is still 12h out. The delay protects players from us; it does nothing to protect the pool from a fast attacker. Tranche sizing, not reaction speed, is the control.
- **Migration: not applicable.** Phase 9 requires a fresh deployment, but nothing is deployed to mainnet — Phase 8 remains parked awaiting explicit go-ahead — so there is no production instance to cut over from, no stranded balance, and no split player base. (codex Med-7, discounted on these grounds; revisit if Phase 8 ships first.) "Fund in tranches" therefore changes meaning: the tranche is the immediate per-transaction exposure, not a day's worth of policy. Size tranches accordingly.
- **12h is the only remaining guardrail**, and it is fixed in the contract with no entrypoint to change it — deliberately, so the key cannot shorten its own warning window.
- **Key custody decision (user, 2026-07-31): the existing homelab deployer account holds the admin key**, same as every other script here — accepted for a capped showcase on the grounds that the key cannot withdraw anything, only retune, and that funding is tranche-limited. This **must be stated plainly in the DF handoff**, not implied. Ask A10 ("no pause") was originally accepted *because* no privileged key existed; that premise is now reversed, and the acceptance is re-affirmed on the new grounds above rather than inherited.
- **Key custody is the whole security model now.** Whoever runs `deploy-fpc` becomes the permanent admin; there is no transfer function, so handing control to DF later means redeploying. The key lives on the same homelab box the earlier codex audit flagged — that finding was resolved then by *having no key at all*, and that resolution no longer applies.
- **Unchanged by Phase 9**: the C1 account-class binding and `require_unpublished_account` stay immutable, so the "only unpublished accounts of blessed classes" guarantee is not under the key's control.
- **New failure mode for players (recon F7)**: `reasonFromRevert`/`QuotaUnavailableError` have zero callers in `client/src` — `TxExecutor` catches, `console.debug`s, and silently self-pays. An admin lowering `max_fee` therefore charges players their own gas with no explanation, and the copy that *would* fire says "Network fees have spiked" — wrong for an admin-caused change. Phase 9 makes the copy cause-neutral; **wiring the mapping into the client is an explicit non-goal** (pre-existing gap, logged in the ledger).
- **Client trust boundary**: UI counter is advisory; contract is sole enforcement; all quota inputs (`generation`, `seat`) asserted on-chain. Fee-spike handling degrades to own-balance/bridge, never to unbounded fees.
- **Privacy (Asks A5)**: (1) `feePayer = FPC` is public — every sponsored tx is publicly attributable to DF (vs today's self-pay prod; the pre-audit "no regression" claim was wrong — fable M3). (2) Player nullifiers are deterministic over `(generation, player)`: since DF player addresses are public game state, an observer can compute who used sponsorship each day. Both are explicit accept/reject decisions for the user, not defaults.
- **Cryptography**: no new primitives — Poseidon2 via aztec-nr `v5.0.1`; two domain separators (SEAT, PLAYER) following the reference's pattern.
- **Supply chain**: no new external npm deps beyond `vitest` (dev). No CI exists (out of scope; `/harden` will revisit).
- **Constraint noted (fable L6)**: the account entrypoint's AppPayload has 5 call slots; the fee call consumes one. DF txs are single-call — headroom is fine, recorded for the future.
- **Post-implementation hardening**: `/harden security` explicitly scheduled BEFORE the DF team scales funding.

## Assumptions

**Facts** (verified; audit round 1 upgraded two former inferences):
1. DF game contracts authenticate players via `msg_sender` — `contracts/system/move/src/main.nr:548,555-556` et al.
2. `FeePaymentMethod` interface + `SponsoredFeePaymentMethod` payload shape — `@aztec/aztec.js@5.0.1` dist.
3. Canonical `SponsoredFPC.sponsor_unconditionally` = `set_as_fee_payer()+end_setup()`, private, `#[allow_phase_change]` — aztec-packages `v5.0.1` source.
4. Client sponsor-mode plumbing exists end-to-end behind `VITE_SPONSOR_MODE` (env.ts:90-123, WalletManager.ts:290-323 etc.) — **but with an FPC address set it ALWAYS selects the FPC; no runtime own-balance fallback exists today** (codex correction). The fallback chain is new work (engine).
5. TxExecutor passes no gas settings; the wallet default is `gasLimits = maxTxGasLimits` (network admission max — fable verified `base_wallet.js`), so explicit limits are mandatory for any sane `max_fee`.
6. Both repos pin Aztec `5.0.1` exactly.
7. `PublicImmutable` is write-once via its initialization nullifier (aztec-nr mechanism; reference `main.nr:107-111`).
8. PR #126 merged; local aztec-kit `main` contains the current seat-nullifier design.
9. DF has no CI and no coherent vitest suite; script-based test utilities exist under `contracts/scripts/` (e.g. `test:moveProof`) — "zero tests" was overstated (codex correction). Real commands: the lint/build/compile scripts in recon §2.
10. `bridge/` is a working mainnet FeeJuice CLI.
11. Private context exposes `get_anchor_block_header().timestamp()`, `gas_settings()`, `set_as_fee_payer()`, `end_setup()`, `set_expiration_timestamp()`; protocol caps tx lifetime at anchor+24h — aztec-nr `v5.0.1` `private_context.nr:189,281-282,442-447,648`.
12. **The fee-payload call executes from the account contract (`msg_sender == player`), in setup phase, side effects allowed** — verified from source by the fable audit (entrypoint `EXTERNAL` path); Phase 1 re-confirms empirically on both wallet paths.
13. Reference `sponsor` has no `uses > 0` assert → effective cap `max_uses+1` (verified `main.nr:158-174`); our accounting closes it.
14. Reference `subscribe` inserts the note AFTER `end_setup` (revertible; `main.nr:295-302`) — our fork moves it before.

**Inferences** (unverified — attack these):
1. Gas calibration via `simulate({ includeMetadata: true })` two-pass yields stable per-method limits (codex-corrected API; state-dependent branches covered by worst-case fixtures) — safe only with the exact dot-product clamp (final pass). Phase 5 validates with a regression test.
2. Quota-note discovery latency on a mainnet browser PXE is low enough (seconds, not minutes) for acceptable game UX with the evidence-based sync design. Phase 1(b) measures the *mechanism* on sandbox; **mainnet latency can only be established by the Phase 8 canary** (final-pass correction — the sandbox number does not transfer), which runs before any demo. The localStorage hint is display-only.
3. A custom dapp-side `FeePaymentMethod` crosses the external wallet-sdk boundary intact (favorable evidence: payload resolves dapp-side; `EXTERNAL` derived from `feePayer != from` generically). Phase 1(e) verifies AND the capabilities manifest is extended, or Ask A6 de-scopes.
4. The DF client can run full-stack against a local sandbox (Phase 4 deploys the game contracts there via existing scripts). Per the final pass, the Phase 6 client smoke is **mandatory before meaningful funding** — Phase 8's tranche beyond canary dust is contingent on it.

**Ask resolutions (user, 2026-07-29)**: A1 = **$20 USD total loss cap** (~1,370 FJ at AZTEC ≈ $0.0146; tranche sized post-calibration under this cap). A2 = policy finalized at calibration with a USD sheet; proposal raised to 100 players/day (the balance, not the policy, is the binding limit at this scale). A3 = local build + screen-share. A4 = accepted for the PoC under the $20 cap, WITH a new Phase 1 spike question (g) probing the game-attested call-binding path (below) as the DF team's scale-up answer. A5 = accepted. A6 = **embedded-wallet-only for quota mode** (note: the client does have external-wallet support, but embedded is the primary path; de-scoped cleanly). A7 = accepted conditional on the Phase 1(b) UX budget: sync-await must hide inside existing in-browser proving latency (seconds); if p50 sync-await exceeds proving time, redesign before Phase 8. A8/A9 = clarified (fallback chain = quota → own balance → bridge; midnight edge inherent to proof-anchoring, see Rollover semantics). A9 exposure + A10 no-pause = accepted.

**Future path — call-bound sponsorship (A4 follow-up, out of PoC scope; researched 2026-07-29, full findings in `research/call-binding.md`)**: three aztec-packages research agents established that binding IS achievable, two ways: **Option 1 "sandwich"** (NO DF redeploy — QuotaFpc as tx origin asserts the player-signed payload only targets DF contracts, then invokes the player's account entrypoint so the game still sees the player as `msg_sender`; kernel-legal — fee ops have no depth restriction and account entrypoints tolerate mid-stack calls — but needs a custom TS EntrypointInterface and rests on the upstream-untested `AppSubscription` pattern); **Option 2 "game-attested, FPC-first"** (DF team adds `fpc.sponsor_game_action(player)` + `#[allow_phase_change]` at the START of each sponsored fn at their next redeploy — FPC-last is fatal: game logic in the setup phase hits the 3-entry setup public-call allowlist and whole-tx-drop revert semantics). A pending-nullifier attestation variant was ruled out for DF (same setup-phase trap). Phase 1 spike (g) provides the depth-2 evidence for Option 2; Option 1 needs its own spike before commitment. Incidental PoC hardening from this research: subscribe/sponsor must enqueue no public calls (pure private — now an explicit invariant + test). Both options go in the Phase 8 handoff note as the scale-up recommendation.

**Asks** (original set, kept for audit trail; A1/A3 revised and A9/A10 added per final codex pass):
1. **Maximum acceptable total loss** for the showcase (the real budget decision). The concrete first tranche is derived AFTER Phase 5/8 calibration, capped by this number — not guessed up front (final-pass condition). Proposal: cap total showcase exposure at ~10 FJ.
2. **Policy constants** (immutable per deployment). Proposal: `max_uses=30/day/player`, `max_users=50 seats/day`, `max_fee ≈ 3× calibrated cost of the costliest sponsored method` — with the explicit arithmetic `50×30×max_fee` vs the loss cap shown at deploy time.
3. *(Logistics, not architecture — demoted per final pass)* Demo delivery: local build + screen-share/video (recommended) vs shared preview URL. The funded FPC is on-chain-discoverable either way.
4. **Accept the app-agnostic subsidy**: quota spend cannot be bound to DF gameplay in this design; bounds are per-player quota + fee cap + balance. (The alternative — call-binding — requires the entrypoint-FPC shape with per-player configs; rejected, see Competing Outline.)
5. **Accept the privacy surface**: sponsored txs publicly attributable to the FPC (which is publicly associable with DF); daily sponsorship usage computable for known player addresses.
6. **External wallets in quota mode**: verify in Phase 1(e) AND extend the client's external-wallet capabilities manifest (`client/src/config/capabilities.ts` — quota contract registration, utility queries, subscribe/sponsor scopes; final-pass Medium), or de-scope to embedded-wallet-only for the showcase (recommended if the spike is inconclusive).
7. **Throughput acceptance**: effectively one sponsored tx per player per block, plus evidence-based sync-await between consecutive txs — acceptable for the showcase? (Optimistic-UI polish is out of PoC scope; the localStorage hint is display-only and cannot make an undiscovered note spendable.)
8. **Fee headroom multiplier** (inside `max_fee`): congestion beyond it pauses sponsorship (fallback chain takes over) until fees drop or a redeploy. Proposal: 3×.
9. **Accept the midnight-window exposure**: tomorrow's seats pre-claimable from 23:50 UTC, and a ~2× daily-bound burst achievable in a rolling window around midnight; `SLACK=3600s`. All balance-bounded.
10. **Accept no-pause/no-recovery**: if a defect is discovered mid-exploit, the funded balance drains until empty; the only lever is not topping up. (Consequence of the no-admin design that eliminated the hot-key risk — the trade was deliberate.)

---

## Competing outline (alternative approach, for the audits)

**"Verbatim contract, wrapped entrypoint"**: use aztec-kit's `SubscriptionFPC` unmodified; the FPC's wrapped `FunctionCall` is the **player's account entrypoint** (`FPC → account.entrypoint(payload) → game`), preserving game-side `msg_sender`.

- Round-1 audit corrections to our original rejection: two stated reasons were factually wrong at 5.0.1 — `AccountActions::entrypoint` has NO top-of-stack assert, and the `EXTERNAL` path never double-calls `end_setup` (fable L2). The rejection stands on the corrected, decisive grounds:
  1. **`config_id` derives from the wrapped call's target+selector** (`main.nr:146-150`) — wrapping `account.entrypoint` means one admin config **per player account**, destroying the shared-quota model entirely (codex — the decisive structural reason).
  2. Origin-FPC tx assembly abandons `contract.methods.X().send()`, the entire existing sponsor plumbing, and (verified) the wallet-sdk external path, which assumes account-origin txs.
  3. Per-function configs ⇒ per-function seats/subscriptions — UX-incoherent for a many-function game.
- Its one real advantage — sponsorship bound to specific app calls — is exactly what Ask A4 gives up. If the DF team later demands call-binding, this outline (with a modified config_id scheme) is the direction; recorded for the future.

**Also rejected**: own no-quota `SponsoredFPC` clone (env-only, near-zero work) — no quotas, no counter, open-ended drain; user deselected it explicitly.

### Phase 9 competing outline — "versioned instances, no mutability"

Instead of making the live policy mutable, keep the contract immutable and make **redeploying cheap and safe**: a `deploy-fpc --from <old-address>` mode that reads the old instance's settings, applies the requested changes, deploys a fresh instance, and prints the one env var to swap. Retuning becomes "deploy + repoint + fund", with the old instance left to drain.

- **Advantages**: keeps "no admin, nothing privileged, nobody can widen the policy" — the property two audits were built around and the one that made the handoff claim simple. No `DelayedPublicMutable`, so no bootstrap trap, no expiration tightening on every sponsored transaction, no single-pending-change footgun, no key custody question. Strictly less code and strictly less attack surface.
- **Why rejected**: it does not deliver what the user asked for. Every retune strands the old instance's remaining fee juice (unrecoverable), forces a client rebuild to change `VITE_QUOTA_FPC_ADDRESS`, and splits players across two instances mid-day (the old one keeps sponsoring until repointed). "Agree the numbers, send one transaction, fund, done" is the actual requirement, and this cannot meet it.
- **Worth keeping in view**: if Phase 9's audits surface a defect in the delayed-mutable approach that we cannot cleanly close, this is the fallback — it is what Phases 1–8 already are, plus a convenience flag.

## Decision ledger

| # | Decision | Chosen | Rejected | Source | Status |
|---|----------|--------|----------|--------|--------|
| 1 | Calling convention | Setup-phase fork keyed on msg_sender | Verbatim + wrapped entrypoint (decisive: per-player config_id explosion; wallet boundary); no-quota clone | main + user; rejection re-grounded per codex/fable L2 | settled |
| 2 | Quota granularity | One global daily allowance | Per-function selectors (unenforceable in this shape) | main, upheld by both audits | settled |
| 3 | Per-player enforcement | Player nullifier (gen, player) + seat nullifier (gen, seat) | Seat-only (reference) — codex Critical 1: one account claims all seats | codex | settled |
| 4 | Generation semantics | UTC day from anchor ts; +1 only in last 10min; set_expiration_timestamp | Full-day +1 window (~3-gen exposure, day-long pre-squat) | codex + fable M1/M2 | settled |
| 5 | Uses accounting | remaining-based, no zero-remaining notes, insert before end_setup | Reference semantics (max_uses+1 off-by-one; revertible insert) | codex + fable H2 | settled |
| 6 | Admin & rotation | **No admin: constructor-fixed policy, arithmetic generations, zero ops** | Admin sign_up + daily cron (hot key, availability dependency, admin funding) — original user-selected mechanism; same reset UX delivered protocol-natively | codex (hot-key High) + main synthesis | settled — surfaced to user at gate |
| 7 | Client quota logic location | `@dfpunk/quota-fpc` engine (unit-covered), TxExecutor thin | Inline in TxExecutor (untestable under lint+build gate) | fable M6 + codex | settled |
| 8 | Error taxonomy | SyncPending / Exhausted / FeeSpike with sync-await; no blind retry | Simulation-miss ⇒ Exhausted (misroutes active players) | fable H1 + codex | settled |
| 9 | Gas calibration | simulate includeMetadata two-pass + worst-case fixtures + clamp | estimateGas (wrong API at 5.0.1); single-sample calibration | codex | settled |
| 10 | Mainnet gate | Real DF contracts sponsored on sandbox required first | fpc_test_target-only integration | codex | settled |
| 11 | Test shape | TS vitest integration vs sandbox | Noir #[test]s | recon | settled |
| 12 | Rollover spec | SLACK=3600s; engine derives generation from the proving anchor; forced re-sync at day boundary; dedicated Phase 4 rollover test | Unspecified SLACK; ChainClock-only generation (can disagree with proving anchor) | codex final pass | settled |
| 13 | Sync classification | Evidence-based expected-state transitions; timed absence = Unknown/SyncPending, never Exhausted/self-pay | Timeout heuristic (cold-start PXE indistinguishable from exhaustion) | codex final pass | settled |
| 14 | Fee clamp math | Exact dot-product identical to contract, parity-tested | Per-dimension division (admits ~2× total) | codex final pass | settled |
| 15 | Constructor invariants | assert max_uses/max_users/max_fee > 0 | None (reference guards lived in sign_up, which we deleted) | codex final pass | settled |
| 16 | Seat-collision retry | One fresh-seat retry iff provably not included; no retry for included txs | Blanket no-retry (hurts availability) / blind re-fire (double-burns) | codex final pass + fable H1 | settled |
| 17 | Integration shape | **SANDWICH** — user decided 2026-07-29 on spike 1B evidence (call-binding proven, no DF redeploy, app sees player as msg_sender) | Standard sibling-call shape (app-agnostic subsidy) | user + spike 1B | settled |
| 18 | C1 (malicious player account) | **Account-class allowlist + require_unpublished_account** (both needed; class alone is bypassable via ContractInstanceRegistry::update) | Class-only binding (codex audit 1: DO NOT SHIP); accepting C1 indefinitely | codex audits 1+2, 2026-07-31 | settled — closed |
| 19 | Phase 9: mutability mechanism | **DelayedPublicMutable, 12h** | Versioned instances / cheap redeploy (strands balance, needs client rebuild, splits players mid-day) | user requirement + recon | settled |
| 20 | Phase 9: admin authority | **Full control, no immutable bounds; target allowlist also mutable** | Bounded-within-deploy-time-limits (recommended by main, keeps "nobody can exceed the limits"); lower-only ratchet | **user, overriding main's recommendation** | settled — consequences documented in Security |
| 21 | Phase 9: storage shape | **One merged PolicyBundle** | Two separate DelayedPublicMutables (2x ~4k-gate read + 2x expiration tightening per sponsored tx) | recon F3 + aztec-nr docs | settled — cost is ONE pending change across all dials (documented at user request) |
| 22 | Phase 9: delay | **12h, fixed in contract, no entrypoint to change it** | 24h (aztec-nr's stated optimum = MAX_TX_LIFETIME, imposes no extra constraint); admin-changeable delay | **user, after being shown the library guidance** | settled — halves the tx inclusion window; accepted |
| 23 | Phase 9: bootstrap | **Generic delay 0, constructor writes then raises to 12h (in that order)** | Declaring the generic as 12h (would leave the paymaster sponsoring NOTHING for 12h after every deploy — silently) | recon F1 | settled — regression test required |
| 24 | Phase 9: admin custody | **Immutable constructor arg, no transfer; whoever deploys owns it** | Transferable admin (recommended by main for the "DF tunes without us" goal) | **user** | settled — handing over later means a redeploy |
| 25 | Phase 9: client revert wiring | **Narrowed, not dropped**: one fresh-anchor retry + the silent-fallback path must surface a reason; full `reasonFromRevert` wiring still out of scope. Root cause closed script-side instead (max_fee floor guard) | Leaving it entirely out of scope (both audits: High) | codex + fable, 2026-07-31 | settled |
| 26 | Phase 9: transition semantics | **CLAMP** to `min(remaining, live max_uses)` — user revised 2026-07-31 after audit round 2 showed repeated updates stack overlapping eras that no single `max(old,new)` bound covers | Grandfathering (chosen first, then reversed); a cooldown between changes; a high-water envelope across live eras | user, after codex round 2 Critical | settled — cost: a player's counter can drop mid-session |
| 33 | Phase 9: CAS mechanism | **Monotonic `schedule_revision` counter** | `timestamp_of_change` comparison (unsound: retained after activation, non-zero from bootstrap, and same-block replacements share a timestamp) | codex round 2 | settled |
| 34 | Phase 9: silent self-pay | **Root fix in scope**: single shared gas profile, read effective `max_fee` before proving, user-visible notice before any self-pay | Script-side guard alone (point-in-time, overridable, duplicates client constants) | codex round 2 | settled — full `reasonFromRevert` taxonomy still out |
| 35 | Phase 9: admin key custody | **Existing homelab deployer account** | Dedicated offline key; deferring to Phase 8 | **user** | settled — must be disclosed in the DF handoff; re-affirms Ask A10 on new grounds |
| 27 | Phase 9: pending-change safety | **On-chain compare-and-swap** against a monotonic `schedule_revision` (a timestamp comparison is unsound: retained post-activation, non-zero from bootstrap, and same-block replacements collide) | Off-chain `--replace-pending` flag alone (codex High-3: two operators both pass the CLI check, later tx silently wins) | codex | settled |
| 28 | Phase 9: replacement base | **Apply edits on top of the PENDING bundle** when one exists | Basing on the live bundle (silently discards the pending edit) | user + codex | settled |
| 29 | Phase 9: setter invariants | **Re-assert `> 0` and `>= 1` target inside `schedule_settings`** | Admin-check only (ledger row 15 exists because the reference lost exactly these guards with its setter) | fable A2 | settled |
| 30 | Phase 9: scheduled-value getter | **Supported `get_scheduled_value()` public view, simulated** | Hand-rolled utility getter over `WithHash` + `svc` internals (viable, but reaches into internals for no gain) | fable, overriding main's earlier call | settled |
| 31 | Phase 9: activation testing | **`warpL2TimeAtLeastBy(43_200)` in the harness** — verified present in `@aztec/stdlib` | Untested activation (both audits: the 12h gate is unprovable locally without it, contradicting "local only, no testnet") | codex + fable | settled |
| 32 | Phase 9: `max_fee` floor | **Update script refuses a `max_fee` below the client's `gasLimits x liveFees x headroom`** | No guard (one admin tx makes every sponsored tx unprovable and silently charges every player) | fable, sharpened by codex | settled |
| 18 | Reusability | Contract is app-agnostic; all app-specific values (allowlist, policy, loss cap) live in `contracts/fpc/config/*.json` validated by `schema.ts` — forking = one config file | DF-specific contract constants | user (2026-07-29) | settled |
| Open | Asks A1-A10 | resolved 2026-07-29 (see Ask resolutions) | — | — | done |

## Audit verdicts

### Phase 9, round 1 (2026-07-31)

- **fable (Opus 4.8)** — `conditional approve` with 5 conditions: re-assert constructor invariants in the setter; name+test the expiration-horizon regression this repo already reverted once; make the 9.4 activation gate executable or admit it is untested; the script must refuse a `max_fee` below the client's gas floor; fix the utility-vs-anchor seat skew. **All 5 adopted.**
- **codex (gpt-5.6-sol, session `019fb982-e714-7d93-959e-21b8cdb99228`)** — `reject`, blocking on: quota changes not atomic with existing quota state (mixed-era loss bound); pending replacement guarded only off-chain; policy failures silently charging players. **All 3 adopted** (see round 2/3 below for how the first was ultimately closed): replacement became an on-chain compare-and-swap; the silent-self-pay path got a client-side root fix.
- Also adopted: explicit-only admin with an on-chain non-zero assert (codex Med-6 — the plan had contradicted itself by making it both required and deployer-defaulted); corrected stale threat-model claims (codex Med-4); `formatFeeJuiceWei` dedup (codex Low-8); rewritten 9.4/9.5 gates.
- **Rejected**: codex Med-7 (migration phase) — nothing is deployed to mainnet, so there is no instance to migrate from. Recorded in Security.
- **Overridden by the user**: transition semantics (ledger 26) — both audits and main recommended clamping; the user chose grandfathering. Consequences documented rather than argued.

### Phase 9, rounds 2 and 3 (2026-07-31)

- **Round 2** (fresh codex session `019fb98e-78a1-7a80-a2f6-b2492477cfdf`) — `reject`. Blocking: the `max(old,new)` transition bound is not conservative across REPEATED updates (A->B->C leaves A-era allowances spending at C-era fees); timestamp-based CAS is unsound; silent paid fallback still not closed. Also caught a **materially false claim** that `max_fee` "applies immediately" — it waits the full delay like everything else. All adopted; the user reversed grandfathering to clamping in response.
- **Round 3** (resumed, verifying the fixes) — `reject`. Two real defects survived: (a) `min(note.remaining, live max_uses)` **over-grants by one**, because `remaining` already excludes the use consumed at subscription — fixed by storing `spent` and asserting `spent < live.max_uses`; (b) clamping allowances did not clamp **seats**, so a `max_users` cut left earlier cohorts spending at later fees and the stated bound was false — fixed by storing `seat` in the note and asserting `seat < live.max_users` (user decision). The remainder were my own propagation failures: the revision counter was described in prose but missing from the storage block and the signature, stale sentences still credited the script with closing the silent-charge incident, and one gate command tested the wrong refusal. All corrected.
- **Round 4 deliberately not run** (user decision): the surviving items were specification inconsistencies rather than design flaws, and audits resume against the implementation diff, where they have historically found the most.

### Prior rounds

- **Codex round 1** (gpt-5.6-sol xhigh, fresh): **reject** — Critical: seat-without-player nullifier; app-agnostic drain. High: freshness pre-drain/3-gen; uses off-by-one + revert double-charge; hot admin key; gas/fallback gaps. All findings adopted (Decisions 3-9) or converted to explicit Asks (A4). Transcript: `audit-codex.md`.
- **Fable round 1** (Plan agent, fable): **conditional approve**, 7 conditions — all adopted (Decisions 4,5,7,8,9 + spike re-scope + Asks A5-A8 + record fixes). Transcript: `audit-fable.md`.
- **Codex final fresh-context pass** (gpt-5.6-sol xhigh, NEW session, saw revised plan + ledger + both round-1 transcripts): **conditional approve** — conditions: (1) specify+test rollover/SLACK semantics with explicit user acceptance of pre-squat + 2× rolling exposure; (2) evidence-based sync classification, never timeout-inferred exhaustion/self-pay; (3) constructor invariants + exact 2-D fee-cap tests; (4) external-wallet capabilities manifest or de-scope; (5) tranche derived post-calibration under an explicit max-loss cap. ALL folded in (Decisions 12-16, Asks A1/A6/A9/A10 revised/added, Inferences 1-4 tightened). Resolution check confirmed round-1 Criticals/Highs genuinely resolved (player nullifier, off-by-one, revert ordering, hot admin) with the app-agnostic subsidy correctly surfaced as an Ask. Transcript: `audit-codex.md`.

## ELI5 companion

**Phase 9**: `eli5_mode = artifact`. Source `implementations-plan/quota-fpc/eli5-phase9.html`, published at
https://claude.ai/code/artifact/3655f090-9b18-41ab-9bf8-dc3b9fac58a9 — republish that same source path to update in place.

### Phases 1-8 (historical)

- Artifact URL: https://claude.ai/code/artifact/39d78974-e960-4c38-ad0d-738fa4721168
- Source file: `implementations-plan/quota-fpc/eli5.html` (redeploying this same path updates the same URL)

## Seeds (DRAFT — finalized post-approval)

### /goal (recommended)

```
/goal All 8 phases marked ✓ in implementations-plan/quota-fpc/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate (as defined in plan.md) reported passing in the transcript; for each phase the agent has printed LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-N.md in the transcript; /code-review max --fix complete with findings applied and committed; codex post-impl audit complete with high/critical findings addressed; `pnpm --filter client run lint`, `pnpm --filter client run build`, `pnpm --filter contracts run build-contracts`, and `pnpm --filter @dfpunk/quota-fpc run test` all report exit 0 in the transcript. TWO user-input pause points are mandatory: the Phase 1 shape decision (surface spike 1A+1B evidence and WAIT for the user's sandwich-vs-standard call before starting Phase 2) and Phase 8 (mainnet deploy + funding — do not deploy or fund without explicit confirmation).
```

### /loop 15m (fallback)

```
/loop 15m Drive implementations-plan/quota-fpc forward. Never idle waiting for my input. Each firing: (1) read plan.md + lessons/ (authoritative), git status + log -5; (2) no task in hand → next pending step from plan.md; after each meaningful edit run the fast layers (pnpm --filter contracts run lint / --filter client run lint / affected tsc) then commit; (3) stuck or facing a decision → /codex xhigh, decide, log the consult in lessons/phase-N.md — but hard limits stay hard: NEVER start Phase 2 before the user's shape decision (sandwich vs standard, from spike 1A+1B evidence), NEVER execute Phase 8 mainnet deploy/funding without explicit user confirmation, never push to main, never expand scope; (4) same step failed 5 times → stop retrying, reassess with codex; (5) phase gate green (commands + pass criteria as written) → paste result, mark ✓ in plan.md, print LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-N.md, advance; (6) all phases ✓ → /code-review max --fix → commit separately → codex post-impl audit → address high/critical → wrap-up report. Keep the ASCII checklist visible each firing.
```
