# Phase 1 lessons — spikes 1A + 1B (2026-07-29)

Environment: local Aztec 5.0.1 network, node on port 8590 (claimed in `~/.agents/ports.md`), real-disk datadir under `~/.cache/dfpunk-quota-fpc-sandbox`, detached process group. Spike code: `spikes/quota-fpc/` (contracts in `noir/`, tests in `test/`). Commit `ecb4b68`.

**Result: 1A 7/7 green, 1B 2/2 green. Both shapes are viable; the sandwich additionally delivers call-binding.**

## Spike 1A — standard sibling-call shape (the audited baseline)

Shape under test is the real one: the player sends an ordinary app call (`SpikeTarget.record()`) and a custom `QuotaFeePaymentMethod` makes the FPC pay.

| Question | Evidence | Verdict |
|---|---|---|
| Keystone identity inference | `EVIDENCE[1A/app-msg-sender] observed == player address, matchesPlayer: true` | **CONFIRMED empirically** (was source-only) |
| Who pays | `fpcPaid: 62098722600000`, `playerPaid: 0` | FPC pays, player untouched |
| (b) note-sync latency | `syncedAfterMs: 265` vs `txMs: 4050` | Sync hides inside proving time — Ask A7 UX concern resolved |
| (c) double-subscribe | rejected on the player nullifier (asserted against a nullifier-specific message, not a generic throw) | per-player cap works |
| (d) exhaustion | remaining 2 → 1 → note gone; next call reverts `No sponsored transactions remaining` | exactly `max_uses`, **no off-by-one** |
| (f) freshness | `generation-1` and `generation+1` both rejected with `not currently sponsorable` | window enforced |
| per-player isolation | second player got `remaining: 2` independently | quota is genuinely per-player |
| constructor invariants | `max_uses=0` deploy rejected | codex final-pass condition satisfied |

### (a) App-revert: the plan's assumption was WRONG in an important way

Expected (from plan + audits): a reverting app call still burns quota and the FPC still pays. **Observed: neither.** `EVIDENCE[1A/app-revert] quotaBefore == quotaAfter (remaining 2), fpcPaid: 0` — the revert happens at *simulation/proving* time in the client, so the tx never reaches the chain at all.

Why the audits' framing still matters: their scenario is a tx that simulates fine and reverts *at inclusion* (state races — exactly what DF's rate limits and ownership asserts produce under contention). That path is NOT exercised by this spike and remains the real risk; the pre-`end_setup` note ordering (fable H2) is still the right defence. **Follow-up for Phase 4: force an inclusion-time revert (e.g. two conflicting txs in flight) rather than a simulation-time one.**

## Spike 1B — the sandwich (FPC as tx origin) — VIABLE

Tx `0x1405f5775751b01eaa638a11ee45ec7b1c71a237d140b4b4b9be84f59913baba`, status `proven`.

| Evidence | Result |
|---|---|
| (i) node accepts FPC-origin tx | YES — assembled with the stock `DefaultEntrypoint` (single call, origin = FPC) |
| (ii) account entrypoint verifies the player's payload signature mid-stack | YES — implied by successful proving; the account's `assert(valid_fn(...))` is in the executed path |
| (iii) **app sees the PLAYER as msg_sender** | **YES** — `observed == player`, not the FPC |
| (iv) out-of-scope payload unprovable | YES — rejected with our `non-allowlisted` assert before any fee is paid |
| who pays | `fpcPaid: 6744382800000`, `playerPaid: 0` |

### (v) Client-integration delta (the cost of the sandwich)

What the sandwich requires beyond the standard shape:
1. **Custom tx assembly**, bypassing `contract.methods.X().send()`: encode the app calls via `EncodedAppEntrypointCalls.create()`, have the player sign the payload hash (`wallet.createAuthWit(player, {consumer: player, innerHash: payloadHash})`), build the outer FPC call, then `DefaultEntrypoint().createTxExecutionRequest()` → `pxe.proveTx()` → `node.sendTx()`. ~40 lines in the spike (`test/spike-1b.test.ts` `sendSandwich`).
2. **`pxe` access**: reached via `(wallet as any).pxe` — a public runtime field but not on the typed `Wallet` interface. In DF the wallet is ours (EmbeddedWallet), so this is workable, but it IS reaching under the public API.
3. **`extraHashedArgs` plumbing**: the inner calls' `hashedArguments` must be attached to the ExecutionPayload or the account circuit cannot resolve the args.
4. **Explicit gas settings are mandatory** (they are for the quota FPC anyway): this network caps per-tx gas at l2 ≈ 6.54M and **da ≈ 55.9k** — the da cap is much tighter than expected and bit twice during the spike. Calibration must respect both dimensions.
5. Everything DF's TxExecutor does today (simulate → send → wait, error mapping, retry) sits on the standard path and would need a parallel path for quota txs.

Estimate: the sandwich is roughly a day of client work beyond the standard shape, concentrated in TxExecutor/wallet plumbing, plus its own tests. Not a blocker — but it is the difference between "wire a payment method into an existing switch" and "add a second tx-assembly path".

## Gotchas worth keeping (cost real time here)

- `SponsoredFeePaymentMethod` cannot be pointed at a custom FPC — it hardcodes `sponsor_unconditionally()`. Using it produced a *selector-not-found* error that made two negative tests pass **spuriously**; negative tests must assert on specific revert messages. (Now they do.)
- `assert(false)` is unprovable-by-construction: barretenberg cannot derive a verification key (`Assertion failed: (constant == fr::zero())`), which silently produced VK-less artifacts and a confusing deploy failure. Revert paths in test contracts must be witness-dependent (`assert(x != 0)` called with 0).
- Selector signatures use array notation: `entrypoint(([(Field,(u32),(Field),bool,bool,bool);5],Field),u8,bool)` = `0x9d57a239`. A flattened-tuple spelling silently yields a different selector.
- `aztec-nargo compile` skips the transpile/VK step that `aztec compile` performs — codegen then fails with "public bytecode has not been transpiled".
- This local network only builds blocks when txs arrive, so L1→L2 messages never mature on an idle node: funding must poke the chain (~15.5s, 3 pokes here).
- `AppPayload.function_calls` is private in aztec-nr; a layout-identical mirror struct is required to iterate it (that mirror is what makes call-binding possible).
- Node 24 + vitest needs `server.deps.inline: [/@aztec/]` for the packages' attribute-less JSON imports.

## Recommendation for the shape gate

**Go with the sandwich (Option 1)** if the ~1 day of extra client work is acceptable: it eliminates the app-agnostic subsidy (Ask A4) that both auditors flagged and the user pushed back on, it needs no DF contract redeploy, and it is now proven end-to-end rather than theorised. The quota mechanics are identical either way, so nothing from 1A is wasted — `SpikeFpc`'s quota core drops into the sandwich entrypoint as-is.

Residual risks to carry into Phase 2/4 if the sandwich is chosen: it remains an unusual shape with no upstream precedent (Nethermind's cold-start is origin-FPC but never calls an account entrypoint), so DF-specific integration (multi-call payloads, the 5-call cap, external wallets — de-scoped per A6) needs its own coverage, and the inclusion-time revert case above is still unproven in both shapes.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-1.md
