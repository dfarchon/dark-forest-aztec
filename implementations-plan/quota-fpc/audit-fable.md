# Fable audit — round 1 (2026-07-29)

Independent top-tier Claude architectural review (Plan agent, model fable). Verdict: **conditional approve** (7 conditions — all adopted in plan revision; see Decision ledger).

Auditor-verified sources: aztec-kit `subscription-fpc/src/main.nr` (full), `seat-picker.ts`; dark-forest `TxExecutor.ts` (full), `move/src/main.nr:540-560`, `env.ts:85-130`, `sync-env-and-artifacts.ts:36-47`; aztec-nr v5.0.1 `private_context.nr` + `authwit/account.nr`; aztec.js 5.0.1 dist (`account_entrypoint`, `sponsored_fee_payment`, `account_entrypoint_meta_payment_method`, `contract_function_interaction`, `interaction_options`, wallet-sdk `base_wallet`, `gas_settings`).

Headline: the load-bearing design is sounder than the plan itself knows — both keystone inferences verified from source, plus a protocol guarantee (24h anchor-to-inclusion bound) that rescues the freshness design. But the plan had a blind spot around the client-side quota-note lifecycle (sync latency, revert/retry interaction, revertible note insertion), and several security-section claims were misstated.

## 1. Adversarial / security review

- **Old-anchor attack — defused only by the protocol's 24h anchor-inclusion bound** (`private_context.nr:189,442,635`): `expiration_timestamp = anchor_ts + MAX_TX_LIFETIME (24h)`. This protocol fact is the actual load-bearing member of the freshness design and must be stated and spike-verified; an SDK bump changing `MAX_TX_LIFETIME` silently changes the security argument.
- **Exposure bound is ~3 generations, not ~2** (anchor up to 24h old admits `{D-1, D}`; fresh anchor admits `{D, D+1}`). The `+1` branch means all of tomorrow's seats can be pre-squatted at any time today for FPC-paid fees. Mitigations: `set_expiration_timestamp((generation+1)*86400 + slack)` (API at `private_context.nr:648`); allow `day+1` only when the anchor is within the last N minutes of its day.
- **Drain vs griefing**: fees go to sequencers/burn — nobody profits from draining the FPC; all drain paths are griefing. Materially lowers attacker motivation; balance backstop is the real defense.
- **Seat-squat asymmetry**: burning the fee bound costs the attacker `max_users × max_uses` ClientIVC proofs (real compute); burning the seat bound costs only `max_users` cheap FPC-paid txs. Denial ~free, drain expensive.
- **Revert path claim wrong for `subscribe`**: reference inserts the note AFTER `end_setup()` (revertible; `main.nr:295-302`) while the seat nullifier is before (non-revertible). App-call revert ⇒ seat burned, note rolled back — player must re-subscribe consuming a second seat. Fix: insert the QuotaNote before `end_setup` (setup-phase note writes are legal — PrivateFeePaymentMethod's FPC does them); add an app-revert test.
- **Error attribution broken as specced**: PXE note-sync lag means the next queued tx's simulate can miss the fresh note → "no active subscription" error → active player misrouted to bridge flow. `MAX_RETRIES=1` blind re-fire (TxExecutor.ts:445-451) makes it worse (duplicate-nullifier tx or sim failure). Needs an await-note-visibility step and a sync check before any `QuotaExhausted` classification.
- **Admin-key story**: stolen key ⇒ hostile future configs ⇒ abandoning the FPC's remaining balance (not "stop using the key"). Admin account also needs ongoing fee juice for daily sign_up (runbook gap).
- **Privacy regression denied**: `feePayer = FPC` is public tx data — every sponsored tx is publicly labeled as DF gameplay (vs today's self-pay prod). Surface as an Ask, not "no regression".
- Holds up well: write-once configs (init-nullifier, `main.nr:107-111`), seat nullifiers as race-free capacity, fee assert in private setup, no new crypto, balance-as-backstop, msg_sender identity hook.

## 2. Assumption attack

**Facts**: 1,2,4,5,6,8,10 verified and hold (incl. wallet default `gasLimits = maxTxGasLimits` — "defaults blow past any sane max_fee" is literally true). Fact 7 true but should cite the init-nullifier mechanism, not a test. **Misstated**: recon §5's `sync-env-and-artifacts.ts` allowlist warning is false — `isAllowedKey` suffix-matches, `QUOTA_FPC_*` keys already pass (lines 39-47); the planned MOD is a phantom work item.

**Inferences**:
1. Keystone (fee-payload call runs as the account, setup phase, side effects allowed) — **VERIFIED TRUE from source**: `contract_function_interaction.js:62-65` merges the fee payload before the app call; `account_entrypoint.js` encodes both into one AppPayload; `authwit/account.nr` `entrypoint()` under `EXTERNAL` (auto-selected when `feePayer != from` — `base_wallet.js:184`) does nothing fee-wise and executes the calls from the account (`msg_sender == player`), still in setup until the FPC's `end_setup()`. Upgrade to Fact; keep the spike as empirical confirmation on both wallet paths. New constraint absorbed: AppPayload is fixed at **5 call slots**; the fee call consumes one.
2. Timestamp — verified true; delete the "drop the assert" fallback (unacceptable for a fund-custodying mainnet contract).
3. Gas estimation — plausible; `GasSettingsOption` Partial override + wallet estimation machinery confirmed.
4. Note discovery — pattern proven at-version, but the showcase depends on *latency* on a mainnet browser PXE; restate and measure in the spike.
5. Sandbox full-stack — fair as stated.
- **Unstated inference**: custom dapp-side `FeePaymentMethod` over the external wallet-sdk boundary; favorable evidence, unverified in prod even for the existing path. Verify or de-scope external wallets.

**Missing Asks**: A5 privacy labeling; A6 admin-key custody (plaintext .env on the same box that runs rotation = single point of compromise AND availability); A7 per-block throughput acceptance (one sponsored tx per block per player + sync latency, for a move-spam game); A8 base-fee headroom policy (fixed `max_fee` vs floating `maxFeesPerGas` ⇒ congestion can black out sponsorship for a generation; client should clamp `maxFeesPerGas` when possible).

## 3. Implementation critique

- (a) Setup-phase fork vs Competing Outline: rejection correct, but two of four stated reasons are factually wrong at 5.0.1 — `AccountActions::entrypoint` has NO top-of-stack assert, and under `EXTERNAL` there is no double `end_setup`. Re-ground the rejection on client-surgery cost, per-function seat incoherence, and the wallet boundary.
- (b) One global config per generation — correct; the fee payload is structurally unbound to the app call, so per-selector quotas would be client-claimed theater.
- (c) Deterministic UTC-day generation — sound with corrections (3-gen exposure, day+1 window, `set_expiration_timestamp`, compute client generation from ChainClock not wall clock).
- (d) `packages/quota-fpc` boundary — correct; ALSO move the quota-branch decision logic (subscribe-vs-sponsor, sync-await, error taxonomy) into the package for unit coverage (Phase 6's gate is only lint+build).
- (e) Spike-first is right but the spike tested the wrong risks — re-scope to: app-revert persistence, consecutive-tx note latency, external-wallet custom payment method, 24h anchor bound.
- (f) Gas: plumbing exists (`fee.gasSettings` Partial); gaps are the base-fee volatility outage mode and calibrating subscribe (heavier) separately from sponsor.
- Reuse map honored; only phantom item is the sync-env MOD.

## 4. Verdict

**conditional approve** (conditions: (1) note-insert before `end_setup` + app-revert tests; (2) client note-sync lifecycle design — await-visibility, no exhausted-classification on sim miss, quota-aware retry; (3) freshness corrections — cite 24h protocol bound, ~3-gen exposure restated, `set_expiration_timestamp`, ChainClock generation, delete drop-assert fallback; (4) re-scope Phase 1 spike to remaining unknowns; (5) base-fee headroom policy + client clamping; (6) surface Asks A5-A8; (7) fix the record — drop phantom sync-env MOD, re-ground Competing Outline rejection.)

**Findings**: Critical — none. High — H1 note-sync lifecycle unmodeled; H2 revertible subscribe note-insert; H3 fee-assert vs base-fee volatility. Medium — M1 exposure bound misstated; M2 uncited 24h protocol guarantee; M3 privacy regression denied; M4 wall-clock generation; M5 external-wallet inference unstated; M6 Phase 6 gate too weak for the riskiest logic. Low — L1 phantom sync-env MOD; L2 competing-outline rejection on false premises; L3 admin account fee juice for rotation; L4 stolen-key consequence understated; L5 policy-vs-funding arithmetic unstated; L6 5-call payload cap.

Critical files: `client/src/Session/TxExecutor/TxExecutor.ts`, `client/src/Session/WalletManager/WalletManager.ts`, `~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr` (fork source; ordering fix), `client/src/config/env.ts`, `contracts/scripts/deploy/sync-env-and-artifacts.ts` (verification only).
