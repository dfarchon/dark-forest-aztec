# Codex audit — round 1 (2026-07-29)

Model gpt-5.6-sol @ xhigh, read-only. Session 019fae3c-fba5-7252-9ccd-826ba707ce47.

Verdict: **reject** (see findings; addressed in plan revision — see Decision ledger).

Main-agent verification notes: the uses>0 off-by-one claim was verified true against aztec-kit main.nr:158-174 (pop, assert-found, conditional reinsert, NO uses>0 assert). The seat-nullifier-lacks-player claim verified true (main.nr:282-289 commits (config_id, seat) only). sync-env suffix-match claim verified true (both auditors agree).

---

## 1. Adversarial / security review

I would first claim every seat—no Sybil identities required. The seat nullifier commits only to `(generation, seat)`, not the player ([plan.md:62](implementations-plan/quota-fpc/plan.md:62)). One account can subscribe repeatedly using different seats and accumulate multiple quota notes. `get_quota_info(...limit(1))` then cannot even report the total. This is a global subscription budget, not a per-player allowance. Add a second nullifier keyed by `(generation, player)`.

I would then spend those quotas on arbitrary high-gas calls, not Dark Forest. The setup-phase FPC cannot see or bind the application payload. “All gameplay actions” versus “curated subset” is therefore unenforceable by the contract. A gas-burner or deliberately reverting call can consume the full balance-bound exposure.

The bound is also understated:

- `{day(anchor), day(anchor)+1}` lets tomorrow’s seats and quota be exhausted today.
- Anchors may be up to 24 hours old, so the simultaneously usable union is previous/current/next—approximately three generations, not two ([private_context.nr:442-444](~/Projects/aztec-packages/noir-projects/aztec-nr/aztec/src/context/private_context.nr:442)).
- The copied decrement logic has an off-by-one: a note with `uses == 0` still passes `sponsor`; it is merely not reinserted. There is no `uses > 0` assertion ([reference main.nr:152-180](~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr:152)). The effective cap is `max_uses + 1`.

Revert grief is worse than documented. Quota nullification before `end_setup()` survives application failure, while TxExecutor automatically retries every reverted receipt once ([TxExecutor.ts:428-452](client/src/Session/TxExecutor/TxExecutor.ts:428)); one failed action can burn two uses and two fees. On initial subscription, the proposed/reference ordering puts the note insertion after `end_setup`, but the seat nullifier before it ([reference main.nr:284-302](~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr:284)): a reverted first action can permanently consume a seat without leaving the quota note.

Finally, the “offline” admin key is actually a hot homelab key if systemd uses it unattended. Theft allows hostile future registrations, permanent namespace squatting, and balance drain. On-chain fixed policy caps/generation bounds or a permissionless fixed-policy rotator would be materially safer.

## 2. Assumption attack

### Facts

- Facts 1–8 are broadly correct, except “sponsor plumbing end-to-end” does not include quota-to-account fallback. With a sponsor address, TxExecutor always selects the FPC ([TxExecutor.ts:315-360](client/src/Session/TxExecutor/TxExecutor.ts:315)).
- Fact 9 is false as written: there are multiple scripts under `contracts/scripts/test/` and corresponding `test:*` commands. There is no CI or coherent Vitest suite.
- Recon’s claim that `sync-env-and-artifacts.ts` needs a QUOTA-specific allowlist change is false: `_CONTRACT_ADDRESS`, `_DEPLOYER_ADDRESS`, and `_DEPLOYMENT_SALT` are already generically accepted ([sync-env-and-artifacts.ts:38-46](contracts/scripts/deploy/sync-env-and-artifacts.ts:38)).

### Inferences

1. Setup identity is plausible and Phase 1 is necessary, but insufficient. It must test app revert persistence, duplicate subscriptions by one sender, zero-use behavior, real `move`, and external-wallet account behavior.
2. Header timestamp access is already supported by `get_anchor_block_header`; its security interpretation is unsafe because anchors can be stale for 24 hours.
3. `estimateGas` is the wrong 5.0.1 API. Simulation exposes raw `gasUsed` only with `includeMetadata: true` ([interaction_options.d.ts:164-178](node_modules/.pnpm/@aztec+aztec.js@5.0.1_typescript@5.9.3/node_modules/@aztec/aztec.js/dest/contract/interaction_options.d.ts:164)). One sample per method is unsafe for state-dependent branches, teardown, public-phase repricing, and changing gas prices.
4. Embedded-PXE note discovery is plausible; external-wallet discovery and scopes remain unproved.
5. A mainnet canary is not an acceptable fallback for failure to test the real game flow locally.

### Asks

Missing decisions include: acceptance of an app-agnostic public subsidy; per-player versus per-seat semantics; strict-current-day versus tomorrow pre-consumption; explicit maximum-loss budget derived from policy; embedded-only versus external-wallet support; runtime account-payment switching; and hot-key compromise/recovery. Ask #4 misleadingly suggests curated actions are enforceable. Ask #3 overvalues address secrecy—the deployed funded contract is discoverable on-chain.

## 3. Implementation critique

The setup-phase fork is the better of the two presented structures, but only for an intentionally app-agnostic subsidy.

The competing outline is indeed unusable verbatim, but the plan misses the decisive reason: SubscriptionFPC derives `config_id` from the wrapped call’s target and selector ([reference main.nr:146-150](~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr:146)). Wrapping `account.entrypoint` therefore requires a separate admin config for every player account and loses game-function granularity anyway. Its stated phase objections are weaker: the initializerless account has no top-of-stack assertion, and `EXTERNAL` payment does not call `end_setup()` ([account.nr:55-73](~/Projects/aztec-packages/noir-projects/aztec-nr/aztec/src/authwit/account.nr:55)).

The new workspace package is reasonable, but browser-safe exports should be separated from node/operator code. A separate deployment pipeline and sync allowlist modification duplicate existing machinery.

Phase 1 is correctly first, but mainnet must remain blocked until the actual game contract—not merely `fpc_test_target`—passes locally. Gas calibration needs production-shaped two-pass simulations, branch/worst-case fixtures, separate subscribe/sponsor and public/private overheads, explicit fee-price caps, and regression tests using the exact declared settings.

## 4. Verdict

reject (with blocking findings: the design does not enforce per-player quotas, permits tomorrow’s allocation to be drained early, understates exposure, and lacks safe revert/gas/fallback behavior)

- **Critical:** One account can claim every seat, and arbitrary non-DF calls can drain the entire funded balance.
- **High:** Freshness permits future-day pre-drain and roughly three-generation exposure.
- **High:** Zero-use off-by-one; app reverts plus automatic retry can double-charge quota.
- **High:** Hot immutable admin can brick future generations or authorize hostile policy.
- **High:** Gas calibration and runtime account-funding fallback are incomplete.
- **Medium:** External-wallet note discovery and real-game sandbox execution are unproved.
- **Low:** Test-inventory and env-sync reuse claims are inaccurate.
---

# Codex final fresh-context pass (2026-07-29)

Model gpt-5.6-sol @ xhigh, NEW session 019fae4e-6192-7300-9609-96590e7360fd (fresh context: revised plan + ledger + round-1 transcripts).

Verdict: **conditional approve** — conditions folded into the plan (Decisions 12-16, Asks A9-A10); see plan.md Audit verdicts.

## 1. Resolution check

- **Critical — one player claiming every seat:** genuinely resolved. The player nullifier prevents multiple subscriptions while the seat nullifier preserves the global capacity cap. Concurrent duplicate subscriptions simply race and one fails. Add TS↔Noir siloed-nullifier parity tests as planned.
- **Critical — arbitrary non-DF subsidy:** not resolved technically; it is correctly exposed as Ask A4. Approval therefore depends on explicit acceptance and a hard maximum-loss tranche. The plan should not describe FPC-attributed transactions as necessarily “DF gameplay” ([plan.md:87](implementations-plan/quota-fpc/plan.md:87), [plan.md:162](implementations-plan/quota-fpc/plan.md:162)).
- **High — future generation/exposure:** only partially resolved. The 600-second window still lets an attacker reserve all of tomorrow’s seats before midnight. Expiration reduces simultaneous exposure to roughly two generations, but `SLACK` is unspecified and the claimed one-day spend bound omits a near-2× rolling-window burst ([plan.md:65](implementations-plan/quota-fpc/plan.md:65), [plan.md:154](implementations-plan/quota-fpc/plan.md:154)).
- **High — off-by-one, revert ordering, blind retry:** genuinely resolved by remaining-based notes, pre-`end_setup` insertion and quota-aware retry suppression. The reference confirms the unsafe original ordering ([reference main.nr:291](~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr:291)).
- **High — hot admin:** genuinely resolved. New trade-off: no pause, withdrawal or emergency containment; an attacker can consume the entire funded tranche after a defect is discovered.
- **High — gas/fallback:** directionally resolved, but fee clamping is underspecified.
- **Fable H1 sync lifecycle:** only partially resolved. A timeout followed by “player nullifier exists + note absent” still cannot distinguish exhaustion from an unsynced PXE after reload. The public Wallet interface exposes no PXE synced-height method ([wallet.d.ts:208](node_modules/.pnpm/@aztec+aztec.js@5.0.1_typescript@5.9.3/node_modules/@aztec/aztec.js/dest/wallet/wallet.d.ts:208)).
- **H2 note insertion:** resolved.
- **H3 fee volatility:** partially resolved; `QuotaFeeSpike` is sound, but the clamp arithmetic needs specification.

## 2. Fresh adversarial findings

- **High — rollover denial/outage:** the +1 window permits next-day seat exhaustion at 23:50. Conversely, after midnight a PXE anchored more than ten minutes behind cannot use the new generation. `ChainClock` reads the node’s latest block, while proving uses the PXE anchor, so these clocks can disagree ([ChainClock.ts:54](client/src/Backend/Utils/ChainClock.ts:54), [base_wallet.js:323](node_modules/.pnpm/@aztec+wallet-sdk@5.0.1_typescript@5.9.3_zod@4.3.6/node_modules/@aztec/wallet-sdk/dest/base-wallet/base_wallet.js:323)).
- **High — sync classification remains heuristic:** polling must await the exact expected state transition, including disappearance on the final use. On cold start, timed absence must remain `Unknown/SyncPending`, not automatically trigger self-payment.
- **Medium — two-dimensional fee math:** the contract checks `daGas×feeDA + l2Gas×feeL2` ([reference main.nr:48](~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr:48)). Independently dividing `max_fee` by each gas limit can permit a 2× total. Require an exact dot-product algorithm and parity tests.
- **Medium — external-wallet manifest omitted:** quota registration, utility queries and `subscribe`/`sponsor` scopes must be added dynamically to [capabilities.ts:64](client/src/config/capabilities.ts:64), or external quota mode must be de-scoped.
- **Medium — constructor invariants missing:** require `max_uses > 0` and `max_users > 0`; otherwise `max_uses=0` still grants the subscription transaction. The reference validates both ([reference main.nr:125](~/Projects/aztec-kit/packages/contracts/aztec/noir/subscription-fpc/src/main.nr:125)).
- **Low — seat-collision recovery:** an unincluded/dropped collision is safe to retry with a new seat; blanket no-retry unnecessarily harms availability.

## 3. Inferences and Asks

Inference 1 is safe only with exact dot-product clamping. Inference 2 is unsafe as verified: a local Phase-1 sandbox cannot establish mainnet browser-PXE latency, and optimistic localStorage cannot make an undiscovered note spendable. Inference 3 is safely gated by A6. Inference 4 is safe for implementation, but the Phase-6 client smoke should be mandatory before meaningful funding.

A2, A4–A8 are appropriate. A1’s 5–10 FJ default is premature: choose the tranche after calibration and cap it at accepted total loss, not “several worst-case days.” A3 is not an architectural approval decision. Replace it or add decisions for the 10-minute pre-squat/rollover policy, concrete `SLACK`, and acceptance of no pause/recovery.

## 4. Verdict

**conditional approve (with conditions: specify and test rollover/SLACK semantics and obtain explicit acceptance of pre-squatting and 2× rolling exposure; make sync classification evidence-based and never infer exhaustion/self-pay from timed note absence; add constructor invariants and exact two-dimensional fee-cap tests; update external-wallet capabilities or de-scope that path; derive the initial tranche only after calibration and explicit maximum-loss acceptance)**