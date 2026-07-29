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

### Phase 4 — Sandbox integration suite (the mainnet gate) ◐ FPC mechanics proven; real-DF-contracts leg outstanding (blocks Phase 8)

Env-gated (`describe.skipIf(!process.env.QUOTA_FPC_SANDBOX_URL)`) vitest: full lifecycle — deploy, subscribe+app-call, sponsor chain with evidence-based sync, exhaustion revert + classification, seat cap, per-player cap (Sybil second account), fee cap incl. dot-product clamp parity, stale/future generation reverts, **rollover across a day boundary (incl. lagging-anchor recovery)**, app-revert quota persistence, duplicate-subscribe revert, **seat-collision fresh-seat retry (not-included case only)**. **Plus the real-game leg (codex condition): deploy the actual DF contracts to the sandbox via the existing `contracts/scripts/deploy` pipeline and sponsor a real `initialize_player` + `move` through the quota FPC.** Mainnet (Phase 8) is blocked until this passes.

**Validation gate** — Commands: `QUOTA_FPC_SANDBOX_URL=... pnpm --filter @dfpunk/quota-fpc run test`. Pass: full suite green incl. the real-game leg. Layers: integration (sandbox, live local network).

### Phase 5 — Deploy + calibration scripts ✓

`deploy-fpc.ts` (existing utils pipeline; policy as constructor args from a reviewed constants file), `calibrate-gas.ts` (two-pass simulate `includeMetadata`, worst-case fixtures, subscribe/sponsor split, emits the constants consumed by the engine + a regression test), funding runbook (`bridge/` CLI; tranche guidance).

**Validation gate** — Commands: scripted E2E on sandbox (deploy → calibrate → constants file emitted → integration suite still green with declared settings) && `pnpm --filter contracts run lint`. Pass: exit 0. Layers: integration (sandbox) + lint.

### Phase 6 — Client integration (thin) ✓ (plumbing; sandwich assembly lands with Phase 7 UI)

`env.ts` (`VITE_QUOTA_FPC_ADDRESS` activates quota mode inside the existing `VITE_SPONSOR_MODE` path — one switch), WalletManager registration (embedded-only per Ask A6), TxExecutor thin adapter delegating to the engine (fee-source chain, no blind retry for quota txs). *Shape-dependent*: the standard shape slots into the existing payment-method plumbing; the sandwich shape additionally lands the custom `EntrypointInterface` + wallet-level tx assembly path scoped in spike 1B(v) — the shape gate's client-delta estimate becomes this phase's spec.

**Validation gate** — Commands: `pnpm --filter client run lint` && `pnpm --filter client run build`. Pass: exit 0; plus the full-stack sandbox smoke (client dev build against the Phase 4 sandbox game deployment) — **mandatory before Phase 8 funds beyond canary dust** (final-pass condition); if genuinely impractical, Phase 8 is limited to the canary until an equivalent live validation passes. Layers: lint + build + manual integration.

### Phase 7 — UX ◐ (badge + copy shipped; live wiring of assembly outstanding)

TopBar badge ("⛽ N free txs · resets 00:00 UTC", tooltip), SettingsPane quota rows (remaining, seats left today, FPC balance — extending the existing sponsor section), GameLandingPage preflight: quota → own-balance → bridge fallback (reusing `runAccountFeeJuicePreflightGate` verbatim), distinct copy for `QuotaSyncPending` vs `QuotaExhausted` vs `QuotaFeeSpike`. Copy is plain language ("You have 12 free moves left today").

**Validation gate** — Commands: `pnpm --filter client run lint` && `pnpm --filter client run build`. Pass: exit 0 + screenshots of the four states reviewed. Layers: lint + build + manual UI review.

### Phase 8 — Mainnet showcase

Deployer keys generated offline (`accountResolution` pattern; local `.env` only — the key is only a deployer, holds pocket change, and has NO ongoing power over the FPC). Deploy `QuotaFpc` with the reviewed policy; calibrate against mainnet; fund the first tranche via `bridge/` CLI (Ask A1); canary account first; then the demo: sponsored gameplay from an unfunded account, counter decrementing, exhaustion → fallback demo (tiny-policy second FPC instance for the exhaustion demo if needed); handoff note for the DF team (costs, tranche strategy, redeploy-to-retune, `/harden security` before scaling funds).

**Validation gate** — Commands: manual, evidenced. Pass: mainnet tx hash of a sponsored `move` from an unfunded account; UI counter behavior verified; fallback demonstrated; runbook + handoff complete. Layers: e2e (live mainnet). **Requires explicit user confirmation before deploy/funding.**

---

## Security & Adversarial Considerations

**Threat model**: the FPC custodies fee juice with no withdraw (protocol-non-transferable) and no pause. All drain paths are **griefing, not profit** — fees go to sequencers/burn, the attacker gains nothing (fable) — which lowers attacker motivation but not our duty to bound loss. The FPC balance is the absolute backstop: fund in small tranches, top up as the demo proves out.

- **Per-player enforcement**: player nullifier (one subscription/player/day) + seat nullifier (≤ `max_users` players/day) + note accounting (= `max_uses` txs/player/day) + `max_fee` (per-tx ceiling, unprovable if exceeded). Worst-case spend per day ≈ `max_users × max_uses × max_fee` — the policy constants must make this arithmetic comfortably below one funding tranche, and that arithmetic goes in the handoff note (fable L5: funding, not policy, is the real limit).
- **Sybil**: addresses are free; the per-player cap forces an attacker to `max_users` identities to capture a full day (was: one account, pre-fix). Burning the full fee bound also costs the attacker `max_users × max_uses` real ClientIVC proofs; burning just the *seats* is cheap (`max_users` FPC-paid subscribes) — denial is ~free, drain is expensive (fable). Seats refresh at midnight.
- **App-agnostic subsidy (accepted, Ask A4)**: quota spend is not bound to DF gameplay; a claimant can sponsor arbitrary txs within `max_fee`. Bounds above apply regardless of what the tx does.
- **Freshness / time attacks**: generation validity = `day(anchor_ts)` (+1 only in the last 10min of a day); protocol enforces inclusion ≤ anchor+24h (`private_context.nr:189,442` — the load-bearing guarantee, cited per fable M2; an SDK bump changing `MAX_TX_LIFETIME` changes this analysis and is flagged in the handoff). Active exposure ≈ 2 generations (stale-anchor tail additionally cut by `set_expiration_timestamp`). No operator clock involved anywhere.
- **Reverts**: all quota side effects are setup-phase/non-revertible and consistent; a deliberately-reverting tx burns the attacker's own quota while the FPC pays — bounded by the same daily arithmetic. Client never blind-retries a quota tx.
- **No admin = no key to steal**: nothing privileged exists post-deploy. The deployer key is inert afterward. (Was codex High: hot rotation key on the same homelab box.)
- **Config integrity**: policy is a constructor immutable — nobody can widen it, ever. Retuning = new deploy (documented).
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
| 18 | Reusability | Contract is app-agnostic; all app-specific values (allowlist, policy, loss cap) live in `contracts/fpc/config/*.json` validated by `schema.ts` — forking = one config file | DF-specific contract constants | user (2026-07-29) | settled |
| Open | Asks A1-A10 | resolved 2026-07-29 (see Ask resolutions) | — | — | done |

## Audit verdicts

- **Codex round 1** (gpt-5.6-sol xhigh, fresh): **reject** — Critical: seat-without-player nullifier; app-agnostic drain. High: freshness pre-drain/3-gen; uses off-by-one + revert double-charge; hot admin key; gas/fallback gaps. All findings adopted (Decisions 3-9) or converted to explicit Asks (A4). Transcript: `audit-codex.md`.
- **Fable round 1** (Plan agent, fable): **conditional approve**, 7 conditions — all adopted (Decisions 4,5,7,8,9 + spike re-scope + Asks A5-A8 + record fixes). Transcript: `audit-fable.md`.
- **Codex final fresh-context pass** (gpt-5.6-sol xhigh, NEW session, saw revised plan + ledger + both round-1 transcripts): **conditional approve** — conditions: (1) specify+test rollover/SLACK semantics with explicit user acceptance of pre-squat + 2× rolling exposure; (2) evidence-based sync classification, never timeout-inferred exhaustion/self-pay; (3) constructor invariants + exact 2-D fee-cap tests; (4) external-wallet capabilities manifest or de-scope; (5) tranche derived post-calibration under an explicit max-loss cap. ALL folded in (Decisions 12-16, Asks A1/A6/A9/A10 revised/added, Inferences 1-4 tightened). Resolution check confirmed round-1 Criticals/Highs genuinely resolved (player nullifier, off-by-one, revert ordering, hot admin) with the app-agnostic subsidy correctly surfaced as an Ask. Transcript: `audit-codex.md`.

## ELI5 companion

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
