# Research: restricting sponsorship to Dark Forest calls (Ask A4 follow-up)

Consolidated from three read-only research agents in `~/Projects/aztec-packages` (2026-07-29; checkout `v5-next` @ `8c7174fe27`, ~94 commits ahead of `v5.0.1` = `72666f8d`; **the entire fee/FPC/entrypoint/authwit surface verified byte-identical between v5.0.1 and HEAD**, so findings apply to our pinned version).

## Question

Can a quota FPC pay fees ONLY for transactions that genuinely call the Dark Forest contracts — ideally without redeploying DF's immutable mainnet contracts?

## Protocol facts established (with sources)

1. **No call-depth restriction on fee ops.** `set_as_fee_payer()` / `end_setup()` may be invoked by any private call at any depth; the kernel tracks them as tx-wide write-once singletons by side-effect counter, not call position (`private_context.nr:547-551,598-614`; kernel composer/validator `private_kernel_circuit_output_{composer,validator}.nr` — "cannot overwrite" asserts only; zero `depth` references in private-kernel-lib). Only static calls are barred (`private_call_data_validator.nr:257-268`).
2. **Phase-straddle guard is a macro opt-in, not protocol**: any standard `#[external("private")]` fn auto-asserts the phase didn't change during its body unless marked `#[allow_phase_change]` (`macros/.../external/private.nr:101-118`). Every frame that straddles the boundary needs the marker; standard account entrypoints already have it.
3. **Setup-phase public calls are effectively banned for apps**: default node/mempool allowlist contains exactly 3 protocol functions (`p2p/.../allowed_public_setup.ts:8-30`, enforced at ingestion AND block-building via `phases_validator.ts`); additionally a setup-phase public revert throws the ENTIRE tx out — no inclusion, no fee (`public_tx_simulator.ts:127-141`), and failed txs are evicted from mempools. ⇒ **any design that runs DF's game logic before `end_setup` is dead on arrival** (DF private fns enqueue large public calls).
4. **A private call cannot see its tx's other calls** — no app-payload hash, tx-request hash, or sibling call data exists in `PrivateContextInputs`/`CallContext` (`private_context_inputs.nr:9-15`). The standard sibling-call FPC shape (our PoC) is structurally blind to the app payload — confirming the PoC's app-agnostic Ask A4 is a real limitation, not a design miss.
5. **BUT constrained cross-contract same-tx reads exist**: `assert_note_exists` / `assert_nullifier_exists` with `for_pending(value, contract_address)` let contract A prove contract B emitted a specific pending note/nullifier earlier in the same tx — kernel-verified for contract match and counter ordering (`private_context.nr:674-731`, `validate_pending_read_requests.nr:34-76`).
6. **A protocol-native call-binding paymaster pattern exists upstream**: `AppSubscription` (`noir-contracts/contracts/app/app_subscription_contract`) — the paymaster is the TX ORIGIN (top-level entrypoint), authenticates the user via a standard authwit over the whole payload, does quota bookkeeping in setup, then executes the payload with a private-domain assert `call.target_address == dapp_address` (`dapp_payload.nr:37`) — an out-of-scope tx is unprovable. Caveats: selector/args NOT checked upstream (address-level only); the TS driver (`DefaultDappEntrypoint`) was deleted pre-5.0.1 (recoverable via `git show 2f870c29e6^:yarn-project/entrypoints/src/dapp_entrypoint.ts`; live template: `default_multi_call_entrypoint.ts`); pattern compiled but **unexercised by any current e2e test**.
7. No relevant fee-abstraction changes exist between v5.0.1 and current `v5-next` HEAD — nothing newer to wait for.

## The three candidate designs for DF

### Option 1 — "Sandwich" (NO DF redeploy) — the answer to "can we bind without redeploying"
`QuotaFpc.entrypoint(payload, user)` as **tx origin**: (setup, all-private) quota bookkeeping keyed to `user` + `set_as_fee_payer` + `end_setup`; assert every non-empty payload call targets a DF contract address (+ selector allowlist if desired — improve on upstream); then call **`user`'s account entrypoint** with the player-signed payload → account executes the game call → **game sees `msg_sender == player's account`** (account entrypoints verified to tolerate mid-stack invocation; fee ops at depth verified legal).
- Solves: binding ✓, per-player identity ✓ (payload signature is the player's own), msg_sender auth ✓, no DF redeploy ✓, game logic in revertible app phase ✓ (no allowlist issue — the FPC's setup effects are its own private notes/nullifiers only).
- Costs: custom TS `EntrypointInterface` + wallet integration (abandons the stock `contract.methods.X().send()` assembly — the biggest cost, this is real client surgery); double authorization surface (payload signature; outer authwit unnecessary if quota is keyed to the account whose entrypoint is invoked); pattern untested upstream — needs its own dedicated spike before anyone funds it.

### Option 2 — Game-attested, FPC-first (requires DF redeploy; simplest overall)
DF team adds, at the **start** of each sponsored game fn (+ `#[allow_phase_change]` on it): a call to `fpc.sponsor_game_action(player=its msg_sender)`; the FPC allowlists DF contract addresses as callers, does quota bookkeeping, `set_as_fee_payer` + `end_setup`. Game logic then runs in the app phase (revertible; allowlist irrelevant).
- Solves: binding ✓ (attested by the game contract itself), per-player ✓, standard-ish client path (a near-noop payment method).
- Costs: one-line-per-function change in DF contracts at their next redeploy; depth-2 FPC calls are kernel-legal but have zero upstream examples — spike (g) in Phase 1 probes exactly this.
- **Order matters fatally**: FPC call at the END of the game fn (the naive shape) puts game logic in the setup phase → mempool rejection + whole-tx-drop semantics (fact 3). FIRST only.

### Option 3 — Pending-nullifier attestation (ruled out for DF)
`[fpc.reserve(set_as_fee_payer), game_call, fpc.finalize(assert pending nullifier from game + end_setup)]` — protocol-supported via fact 5, but requires game logic before `end_setup` → dead per fact 3 for DF (public-call-heavy game fns); additionally requires DF contracts to emit FPC-derivable nullifiers (unverified, likely absent). Viable only for private-only dApps with derivable action nullifiers.

## Verdict for the roadmap

- **PoC (this plan): unchanged** — standard sibling-call shape, app-agnostic, bounded by quota + $20 balance cap. Correct scope for a showcase.
- **Scale-up recommendation to the DF team**: Option 2 if they're comfortable adding the call at their next redeploy (simplest, cleanest); Option 1 if redeploying is off the table (no contract changes, but significant client-side entrypoint work and an untested upstream pattern). Phase 1 spike (g) provides the depth-2 evidence for Option 2; Option 1 needs its own spike before commitment.
- **Incidental hardening for the PoC contract**: subscribe/sponsor must enqueue NO public calls (they don't — pure private) — now an explicit invariant + test, since a setup-phase public call would make every sponsored tx rejectable by default nodes (fact 3).
