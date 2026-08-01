# Phase 9 — admin-updatable policy

Approved 2026-07-31. Safe fallback: `e27e8c8`. Plan baseline: `d4ef731`.

## 9.1 — Contract

**Done 2026-07-31.** Gate: `pnpm --filter contracts run build-contracts` exit 0, `pnpm --filter contracts run lint` exit 0, `QuotaFpc.ts` regenerated with `admin` as the first constructor arg plus `schedule_settings`, `get_scheduled_settings`, `get_admin`.

What changed and why:

- `PolicyBundle` (max_fee, max_uses, max_users, allowed_targets) in ONE `DelayedPublicMutable`, replacing two `PublicImmutable`s. One historical read and one expiration-tightening per sponsored tx instead of two.
- `BOOTSTRAP_DELAY = 0` generic + constructor writes the bundle THEN raises the delay to 12h. Reversing those two lines is the deploy-bricking trap recon found: the value would read as all-zeroes (not error) for 12h, so the paymaster would sponsor nothing, silently.
- **`QuotaNote` changed shape: `{ spent, seat, generation }`, was `{ remaining, generation }`.** `remaining` is relative to the policy that wrote it, so `min(remaining, new_max_uses)` over-grants by one (remaining already excludes the subscribe use). `spent` is absolute. `seat` is carried so a `max_users` cut binds cohorts admitted under a larger cap — without it, 100 admitted players keep spending under a later, higher `max_fee` and the loss bound is false.
- CAS on a monotonic `schedule_revision` (`PublicMutable<u64>`), not a timestamp: a timestamp is retained after activation, is non-zero from the bootstrap write, and same-block replacements share it.
- `get_quota_info` now derives remaining from the LIVE policy, so the badge cannot advertise an allowance a reduction already removed.
- Contract header rewritten — it still said "No admin, no setters".

Gotcha for later phases: the constructor arity changed (admin is FIRST), so every `QuotaFpcContract.deploy(...)` call site needs updating — deploy script and integration tests both.

## 9.2 — Config + deploy

**Done 2026-07-31.** Gate: `pnpm --filter @dfpunk/quota-fpc run test` exit 0 (43 passed, incl. 5 new adminAddress cases), `pnpm --filter contracts run lint` exit 0, dry-run prints the admin disclosure + "sanity check only" loss-cap wording, and an UNSET admin env var is refused (exit 2) rather than defaulted.

- `adminAddress` supports the same `env:` indirection as targets — still explicit (unset var = hard error, never "use the deployer"), and a dry-run prints the resolved value without loading a signer, which was codex Med-6's exact concern with a deployer default.
- `worstCasePerDayWei` extracted to schema.ts and now the ONLY copy (was duplicated in deploy-fpc.ts); `formatFeeJuice` local copy deleted in favour of shared `formatFeeJuiceWei`.
- Both config JSONs point admin at `env:QUOTA_FPC_ADMIN_ADDRESS`, with the custody decision recorded in dark-forest.json's comment.

## 9.3 — Update script

**Done 2026-07-31.** Gate: `pnpm --filter contracts run lint` exit 0, plus the full command sequence against the live local chain (node :8590, FPC `0x0038f347…`):

- `--show` → current settings + PENDING block with UTC activation + cutover warning ✓
- `--dry-run` reduction → prints impact warning, sends nothing ✓
- real schedule → accepted ✓
- second write, no flag → **refused, exit 2** ✓
- `--replace-pending` → **based on PENDING** (kept max-uses 3 while live was 5) ✓
- `--max-fee-wei 1` → **refused, exit 3** (floor 122400000000000 wei at current fees) ✓

**The bootstrap fix is proven on a real chain**: immediately after deploy, `--show` reported the real policy (5/20/0.001 FJ), not the all-zero bundle the naive ordering produces.

Two bugs the live run found that review did not:

1. **Chain time vs wall clock.** "Is a change pending?" compared on-chain timestamps against `Date.now()`. The local chain runs ~9.7h off wall clock (normal for an idling network), so the answer would have been wrong — a queued change reported as already live. Now reads the latest block's timestamp via `node.getBlockData('latest')` (the pattern `harness.ts:41` already used) and prints the skew when it exceeds 5 min. Would have been wrong on mainnet too, just less visibly.
2. **Skew wording printed backwards** — said "behind your machine" while showing a negative number; the chain was AHEAD. Direction now computed explicitly.

Also fixed in 9.1 but worth noting here: `get_quota_info` now derives remaining from the LIVE policy. It previously returned the note's stored value, so after a reduction the badge would advertise transactions the player no longer had.

## 9.4 — Tests

**Done 2026-07-31.** Gate: `pnpm --filter @dfpunk/quota-fpc run test` exit 0, and the integration suite **19/19, zero skipped** against the live local chain. Evidence emitted: `EVIDENCE[activation] inert before the delay elapsed, in force after` and `EVIDENCE[clamp] a reduction bound an allowance issued under the old policy`.

Nine Phase 9 cases: bootstrap-live-at-first-anchor, admin-only setter, setter invariants (zero uses / no targets), CAS stale-vs-correct revision, activation inert-then-binding, clamping an already-issued allowance, plus the pre-existing account-class and published-account cases still green.

Two things cost a run each:

1. **`.send().wait()` does not exist here** — `send()` already awaits inclusion. Five tests failed identically; the pattern elsewhere in the file (`await deploy.send({from})`) was right there.
2. **`warpL2TimeAtLeastBy` is NOT on the ordinary node client.** It lives on a separate debug client via `createAztecNodeDebugClient` from `@aztec/stdlib/interfaces/client` — the normal API deliberately has no way to move the clock. Codex predicted this exact snag ("provided the harness creates the debug client") when it verified the warp was viable; I skimmed past it.

Design notes worth keeping:
- Warping is **global and irreversible**, so the two time-travel tests deploy their own paymaster (`deployOwnFpc`). Running them against the shared instance would invalidate every generation and anchor the other tests captured in `beforeAll`.
- The clamp test cuts `max_uses` to exactly what the claimant already spent, so a pass means they have NOTHING left rather than "one fewer" — that distinguishes real clamping from the off-by-one my first formula had.

## 9.5 — Docs + handoff

**Done 2026-07-31.** Gate: `pnpm --filter client run lint` exit 0, `pnpm --filter client run build` ✓ built, doc-claim grep returns no live claims, artifact republished to the same URL.

Six claims in `handoff.html` were falsified by this phase and are rewritten:
- "deliberately **no admin key**. Nothing is privileged after deployment, so nothing can be stolen" → a "Somebody holds a key" section separating what the key CAN do (raise limits, redirect sponsorship) from what it CANNOT (withdraw — the protocol forbids it for everyone; shorten the 12h notice; touch the account-class rules).
- "there is no 'update' transaction — you deploy a fresh instance" → the actual `update-fpc-policy` commands, the 12h notice, the two refusals, and the warning that a reduction binds players mid-day.
- "raise by redeploying" → "adjustable, takes 12h".
- "four independent security reviews" → seven.
- "when you retune, the small remainder in the old instance is what's stranded" → retuning strands nothing now, but the balance is still the only cap and the key can raise limits.
- "redeploy if you want bigger quotas" → one command, 12h notice.

**My own gate was wrong first.** The doc-claim grep matched `client/dist/**` build artifacts, which embed Noir source containing unrelated "no admin" text — it would have failed forever on noise. Scoped to source files with `--exclude-dir=dist,target,node_modules,artifacts`; it then found one genuinely stale sentence.

`docs/quota-fpc-local.md` gains a "3b. Retuning a deployed paymaster" section with the commands, both refusals, the mid-day reduction behaviour, the pre-activation wobble, and a callout that `fpc/config/*.json` goes stale once you retune on-chain.

## Post-implementation audits (2026-07-31)

Two independent reviews of the finished code. **No Critical findings.** Both verified the same core as correct: constructor write-then-raise ordering, exact `spent`/`seat` arithmetic with no over-grant across any sequence of policy changes, CAS atomicity, setter invariants matching the constructor, and the account-class controls remaining immutable and unreachable from the admin path.

One reviewer added a sharp detail: `BOOTSTRAP_DELAY = 0` is safe **only** because the constructor's delay raise is unconditional — remove it and `get_effective_minimum_delay_at` computes `0 - 1` and underflows every private read.

### Fixed

1. **False-green tests, AGAIN (both reviewers, High).** The activation and clamp tests asserted on `get_policy` / `get_quota_info` — getters with their own independent clamp. Deleting the enforcement asserts from `sponsor_and_execute` would have left both green. Worse, `(false, 0)` is also what "no note found" returns, so a PXE that lost the note across the warp would have passed too. All three time-travel tests now drive a REAL sponsored send and require the private path to refuse it. **Third occurrence in this project of a test passing for the wrong reason — the pattern is always "assert on the observable rather than the mechanism".**
2. **Seat clamp had no coverage at all** — the half that evicts players. Added.
3. **The eviction message was a lie to players.** It reused `"No sponsorship seats available today"` → `no-seats` → *"Today's sponsored transactions have all been claimed"*, which is false: seats are free, this player was evicted by a `max_users` cut. New contract message `"Sponsorship seat no longer within capacity"`, new `seat-revoked` reason, honest copy.
4. **`adminAddress` was not range-checked against the field modulus**, and the test's own `ADMIN = 0x33..33` was ABOVE it — so "a sane config parses" used an impossible address. A mistyped-but-plausible address would deploy and permanently lose control, since the admin is immutable with no transfer. Schema now rejects; test constant fixed; case added.
5. **My clamp fix was time-of-day dependent** — a +12h warp can cross UTC midnight, making the sponsored send fail as "not currently sponsorable" instead of proving the clamp. Added `warpChainToDayStart` so those tests start a day with 12h of headroom either side.

### Deferred, with reasons

- **Client-side protections (High, codex).** The plan's cutover section promised a shared gas profile, a live `max_fee` precheck, one fresh-anchor retry, and a user-visible notice before self-pay. NOT implemented — the script-side floor guard is point-in-time and overridable, so a fee rise between scheduling and activation can still make sponsored sends unprovable, and `TxExecutor.ts:345` still logs and charges silently. **This is a real gap between plan and implementation and should be the first thing done next.**
- **Operator script read-consistency (Med).** Live settings, scheduled settings and chain time are read separately; if activation lands between them, an unrelated edit can reschedule the pre-activation bundle. Needs a consistent snapshot plus a re-read before submit.
- **`--cancel` and a pending→next field diff (Med).** `--replace-pending` carries unrelated pending fields forward silently.
- **No-op reschedule restarts the 12h clock (Low).**
- **`seat-picker` picks uniformly at random (Low).** With seats now consequential, a `max_users` cut evicts a random subset; lowest-free-seat allocation would bind the newest cohort instead.

## MAINNET FEE MEASUREMENT — the sandbox figure was wrong by ~888,000x (2026-08-01)

Read from the live mainnet node (`getCurrentMinFees`, stable across three reads at block 22469 — not a spike):

```
feePerL2Gas  1,686,254,293,252 wei
feePerDaGas  0
```

At the client's gas LIMITS (50k DA / 6M L2, `gas-profile.ts`):

| | |
|---|---|
| per-tx at limits | **10.12 FJ** |
| client applies 2x headroom, so `max_fee` must be at least | **20.24 FJ** |
| `dark-forest.json` currently sets | **0.0000228 FJ** |
| shortfall | **~888,000x** |

**Consequences, all of which had to be caught before funding:**

1. **Deploying the current config would produce a paymaster that sponsors nothing.** Every sponsored transaction would exceed `max_fee` and fail to prove. The showcase would have looked completely broken, and the cause (`Gas settings exceed the sponsorship allowance`) points at the paymaster rather than at the config.
2. **The artifact calculator was wildly optimistic.** Its default said 90,000 sponsored transactions cost ~$0.03; at real mainnet rates the same figure is **~$26,600**. The honest per-transaction cost at the ceiling is **~$0.30**, not $0.0000003.
3. **The funded 800 AZTEC buys ~40 transactions at the ceiling**, not millions. Actual spend will be lower — the ceiling is charged on gas LIMITS while the fee paid follows gas USED — but the order of magnitude stands.
4. **The reference policy is unaffordable.** 100 users x 30 transactions = 3,000 per generation would need ~60,700 FJ per generation against 800 FJ funded, i.e. ~76x the entire budget.

The whole "funding is not the binding constraint, the policy is" framing in the handoff was an artefact of measuring on a network that charges almost nothing. **On mainnet, funding is exactly the binding constraint.**

Measuring BEFORE deploying (rather than deploying a disposable instance first) cost nothing and caught all of this — `getCurrentMinFees` is a free read and is precisely the input the client multiplies to build `maxFeesPerGas`.

## MAINNET DEPLOYMENT — live 2026-08-01

```
paymaster  0x11c2c722967ff512e143620292e0cce90bd96406c3c5af63db65df9901caaf37
admin      0x157e64ac5ca521894cff836599ea449c8e25ae81bc7e1f2e7a8cf933b7442ba7
deploy tx  0x251f6c73e96ae4f189610f7f4037c9679a0ac0479761afd7d6fbf9c073ae9b65
funded     300 FJ (bridged from L1, claimed on the paymaster's behalf)
```

**First measured mainnet transaction fee: 6.855300444128783688 FJ** (the deploy itself, status `checkpointed`). Against the 20.24 FJ worst case at the client's gas limits, that confirms real usage sits comfortably under the ceiling rather than the ceiling being arbitrary.

### Two things mainnet does that no local network does

1. **SponsoredFPC is unfunded on mainnet.** `FEE_PAYMENT_MODE=sponsored` fails with `Not enough balance for fee payer`. A fresh account genuinely cannot transact — which is precisely the onboarding wall this project exists to remove, encountered first-hand.
2. **A bridged account holds a CLAIM, not a balance**, so it cannot pay for the transaction that would redeem it. `FeeJuicePaymentMethodWithClaim` bundles the claim into the transaction it pays for. A bridged CONTRACT has the mirror problem — it cannot send at all — so someone else must call `FeeJuice.claim` on its behalf. Both paths now exist as operator scripts (`bridge-fee-juice`, `claim-fee-juice`) and as a claim mode in `prepareFeePayment`.

### My mistake, recorded because it cost real money

I derived the deployer address with `getSchnorrInitializerlessAccountContractAddress(secret, signingKey, salt)`. The real signature is **`(signingPrivateKey, salt, secretKey)`** — permuted. The resulting address was not the account the wallet uses, and **60 AZTEC (~$0.88) was bridged to it before the mismatch surfaced**. Fee juice cannot be moved, so it is stranded at an address whose keys I hold only in permuted form; recoverable in principle by instantiating the account with the permuted values, not worth the effort at this size.

**Lesson: never derive an address from a helper whose argument order you have assumed.** The wallet reports its own derived address (`read-fee-juice-balance` prints it) — ask it, and compare, before sending anything anywhere.

### Codex loop — round 2 of the post-implementation audit

No Critical. Confirmed all five earlier fixes genuinely landed, and independently verified the arithmetic (floor 20.235 FJ, so 25 FJ clears it; worst case 750 FJ under the 800 funded). Two High findings, both fixed:

1. **The retry was unsafe.** Any exception rebuilt the transaction with a fresh nonce, so a lost `sendTx` response would replay the player's move and burn a second allowance. Now allow-listed to failures that provably occur before broadcast.
2. **The headline fix missed its main case.** `trySponsoredSend` *returns undefined* — rather than throwing — when the allowance is spent, seats are gone, or the paymaster is empty. Those are the common cases, and they bypassed both retry and notice, so the exact scenario the work set out to fix still charged players silently. Now throws a typed reason.
3. Med: the gas profile was still copied in the operator script behind a stale TODO, despite the commit message claiming it was shared. `contracts` now depends on `@dfpunk/quota-fpc` and imports `sponsoredFeeFloorWei`.

## Version compatibility: 5.0.1 stack vs 5.1.0 mainnet node — RESOLVED

Checked before spending anything, because a mismatch in the account-class allowlist would silently reject every real player.

| Check | Result |
|---|---|
| SDK 5.0.1 → mainnet node | connects; `nodeVersion 5.1.0`, `protocolVersion 4248422647`, `l1ChainId 1` |
| Our initializerless Schnorr class id | `0x28c2905b…706f` |
| That class publicly registered on mainnet? | **no — and this is expected**, initializerless accounts are never published, which is exactly what `require_unpublished_account` relies on |
| Dark Forest allowlisted contracts live on mainnet | **6/6** (Core, Move, ArtifactProspect, ArtifactFind, ArtifactAction, ArtifactVault) |

**The reasoning that resolves it: class ids follow the CLIENT, not the node.** A class id is a hash of the account artifact shipped in `@aztec/accounts`. Dark Forest's client is this repository, pinned to 5.0.1, so players get 5.0.1 initializerless accounts regardless of which node version the network runs. The node's version does not enter that hash.

Confirmed empirically afterwards: a sponsored transaction from a 5.0.1-derived account was accepted by the 5.1.0 mainnet node and paid for by the paymaster.

Standing consequence, already documented as the version-bump caveat: if DF rebuilds its client on a newer `@aztec/accounts`, the class id changes and sponsorship stops for players on the new build until the paymaster is redeployed.

## MEASURED: what a sponsored transaction actually costs on mainnet

| | fee juice | ~USD @ $0.0146 |
|---|---|---|
| First sponsored transaction of a player's day | **0.8516** | ~$0.012 |
| Each subsequent one | **0.8220** | ~$0.012 |
| A contract deployment, for scale | 6.855 | ~$0.10 |
| Worst case at the client's gas limits | 20.24 | ~$0.30 |
| Configured ceiling | 25 | ~$0.37 |

The first is dearer because it also claims the player's seat and opens the allowance note. Roughly **thirty-fold headroom** between real cost and the ceiling.

How the estimate travelled, which is the whole argument for measuring:

| Source | 90,000 sponsored transactions |
|---|---|
| Sandbox guess (original config) | $0.03 |
| Mainnet fee rates x gas LIMITS | $26,595 |
| **Measured reality** | **~$1,117** |

Only the last is trustworthy. The rate-based figure is a ceiling, not a price — transactions are billed on gas USED.

**A gameplay-level figure is still outstanding** and cannot be scripted: `initialize_player` needs mined spawn coordinates plus indexer-derived state hashes, which is why Phase 4 originally required manual play. A real Dark Forest move costs the above plus the game's own logic. The client is configured for a capture session (`client/.env`, `VITE_QUOTA_DEBUG=true`) which logs each sponsorship decision, allowance read and settled fee.

**Accidental proof, worth recording**: re-running the measurement script was refused on mainnet with `Invalid tx: Existing nullifier` — the one-subscription-per-player-per-day rule enforcing itself on a live network, unprompted.

## Final verification (2026-08-01)

- Integration suite: **20/20 on a live local network, none skipped** — re-run after the codex-driven fixes to confirm no regression. Includes the three time-travel cases that fast-forward 12h to prove activation timing, allowance clamping, and seat eviction on the private path.
- Gates: `pnpm --filter @dfpunk/quota-fpc run test` (43 passed), `pnpm --filter client run lint`, `pnpm --filter contracts run build-contracts` — all exit 0.
- PR: https://github.com/dfarchon/dark-forest-aztec/pull/37 (fork `alejoamiras:worktree-quota-fpc` -> `dfarchon/main`).
- Secret scan before pushing: no env or key material tracked; the drpc RPC key exists only in gitignored `contracts/.env.mainnet`; the sole `SECRET=` match in the diff is a console template printing a claim to the operator's own terminal.

### Mainnet artifacts

| | |
|---|---|
| **Production paymaster (DF contracts only)** | **`0x0572042f6b9a6e6d33077a15c203ca81006ae162eab322efe32eeaffff5729d4`** — 100 FJ |
| Superseded paymaster (older bytecode) | `0x11c2c722967ff512e143620292e0cce90bd96406c3c5af63db65df9901caaf37` — 300 FJ stranded, see below |
| Admin / deployer | `0x157e64ac5ca521894cff836599ea449c8e25ae81bc7e1f2e7a8cf933b7442ba7` |
| Measurement paymaster (disposable) | `0x1e87a754a2cf05587897200226deebfe92aa09fa0d32740b4623e29de0dbece4` — ~118 FJ |
| Measurement target (disposable) | `0x1e189ffa5b964a97534890c88306f8077774dc62ff890cd2aa337ee4d6a8eb84` |
| Stranded by the derivation mistake | 60 AZTEC at `0x05a76212…b25c` (recoverable in principle) |

### Still open

1. **Gameplay-level fee.** Requires playing through the client — `initialize_player` needs mined spawn coordinates plus indexer state. The client is configured (`client/.env`, `VITE_QUOTA_DEBUG=true`) and logs each sponsorship decision, allowance read and settled fee. A real move costs the measured sandwich overhead plus the game's own logic.
2. **Two fee snapshots** in the affordability precheck versus the gas settings (codex Low). Fees can move between the two reads, which slightly weakens the exactness of the pre-proof check.

## Round 3: fixing what the verification pass found (2026-08-01)

The audit that was supposed to bless the deployment returned **"Not sound for mainnet as-is"** instead. Four findings, and the two that mattered were both cases of a stated guarantee being false rather than merely weak.

### The client build was broken, and lint said otherwise

`resolveFeeSource` returns `{ kind: "blocked", reason }`, but the caller compared `source.kind` against `"self-pay-exhausted"` and `"sync-pending"` — values that live on `reason`, not `kind`. Two `TS2367` errors. The build had been broken for some time, and every unavailability reason collapsed into one, so `sync-pending` — the only retryable case — never retried.

It survived because **the gate that was run was `lint`, and the gate that would have caught it was `tsc`**. This is the second time in this plan that a green result came from running the wrong command. The rule that follows: a gate is only evidence for the failure mode it can actually observe, and "the code compiles" is not something a linter observes. `pnpm --filter client run build` is now the gate, not `lint`.

### Sponsored-then-self-paid could submit a move twice

On a failed sponsored send the client fell through to an ordinary self-paid send. That is correct only when the failure provably happened *before* broadcast; otherwise the move may already be in the mempool and the player pays for — and plays — the same move twice.

The predicate was doing two jobs at once. It is now split: `isProvablyPreBroadcast()` answers "is retrying SAFE", `isRetryableBeforeBroadcast()` answers "is retrying safe AND useful". Anything not provably pre-broadcast now fails loudly rather than silently duplicating. Paying twice is recoverable; a duplicated move in a game with irreversible state is not.

### The bridge script could strand funds silently

The claim secret is generated *inside* `bridgeTokensPublic` and returned only after the L1 deposit mines. A crash in that window loses an unrecoverable preimage — fee juice with no claim secret cannot be redeemed by anyone, ever.

Mitigated, not eliminated: a mode-0600 journal records IN_FLIGHT before the L1 write and the claim the instant it exists, so a loss is visible rather than silent. The honest fix is to generate the secret locally and call the portal deposit directly, which is recorded in the file header as the next change.

### Reversing codex on the `max_uses` asymmetry

Codex found that raising `max_uses` does not revive already-exhausted players — terminal notes were deleted, and the player nullifier bars re-subscribing — and recommended documenting it and fixing it in a later revision. That recommendation was **not** taken.

The reasoning: the DF team's most likely first action after handoff is turning exactly this knob, and with a 12-hour activation delay the change lands mid-generation almost by construction. So the failure is not an edge case, it is the expected path — a raise that quietly helps only the players who did not need it.

The note is now inserted unconditionally on both paths, including when already terminal. **Exhaustion is the assert, never the note's absence.** The note records what has been SPENT, not what remains, so it stays meaningful when the policy moves underneath it. Cost is one note on the last transaction of a player's day; the previous behaviour was cheaper and wrong.

This is the shape of the whole plan in miniature: storing consumption rather than entitlement is what makes a value safe to change later. The same reasoning produced `spent` over `remaining` in Phase 8.

## Round 4: the verification pass finds the fixes half-done (2026-08-01)

Re-audited. Verdict: **"still not sound for mainnet"** — every one of the four fixes came back PARTIAL. Worth recording, because the pattern is consistent: each fix was correct about the thing it addressed and wrong about its own edges.

### `Existing nullifier` was not safe to treat as pre-broadcast

The retry predicate allow-listed the error signatures known to be raised before broadcast. `Existing nullifier` was included, reasoned safe because this executor runs at `maxConcurrency: 1` and therefore never has two sponsored sends in flight.

That reasoning was too small. The conflicting transaction does not have to come from this queue — a reload, a second device, or a second executor instance all produce one, and the concurrency setting is a constructor argument, not an invariant. And the error is raised *precisely because* something else got there first, which is the opposite of evidence that this move was never sent. Removed from the allow-list.

The general lesson: **an allow-list of "safe" error signatures is only as sound as the least-examined entry.** Reasoning about one entry from a local property of the process is not enough when the conflict is, by definition, non-local.

### The bridge journal was a mitigation pretending to be a fix

The audit refused the journal-only approach for mainnet funds, and it was right to. Writing an IN_FLIGHT marker before the deposit makes a loss *visible*; it does not make it *recoverable*, because the claim secret still only existed inside the SDK call. It also introduced a new failure: the post-deposit journal append could throw before the secret was ever printed, so a disk-full condition would have destroyed funds that the old code would have merely printed. The mitigation was strictly worse than nothing in that branch.

Two further faults, both mine: `mode: 0o600` applies only when a file is created, not to an existing one; and the journal lived at `process.cwd()`, i.e. **inside the repository** — a file full of claim secrets, one `git add -A` from being published.

Rewritten to do the real thing. The deposit is now assembled from the same SDK primitives (`generateClaimSecret`, the portal's own `L1TokenManager` for approval, `depositToAztecPublic`, `extractEvent`) in the one order that is safe: generate the secret, `fsync` it to a journal in the home directory, and only then touch L1. Everything the deposit produces afterwards — message key, leaf index — is re-readable from the L1 logs forever. The secret is the only unrecoverable part, so it is the only part that must exist on disk beforehand.

Verified end-to-end against the local network rather than reasoned about: minted L1 fee asset, ran the real script, got `SECRET_GENERATED` then `DEPOSIT_CONFIRMED` in a `0600` journal, and confirmed the deposit is claimable on L2 with the locally-generated secret. That last step matters most — a subtly wrong secret would produce a deposit that mines successfully and can never be redeemed, which looks exactly like success until it doesn't.

### A gate was wrong for the third time

The audit found `buildSendOpts` still declared `SponsoredFeePaymentMethod` while returning `FeePaymentMethod` — a `TS2322` that `pnpm --filter contracts run lint` cannot see, because that script is `eslint .` and nothing more. This is the third time in this plan a green gate came from a command that could not observe the failure.

The standing correction: **name the failure mode first, then pick the command that observes it.** For type errors that is `tsc`, for the client it is `run build`, and neither is `lint`.

### An idle local network looks exactly like a broken bridge

The end-to-end bridge test appeared to fail: the L1 deposit mined, but ten minutes of polling never found the L1→L2 message, and the claim kept returning `No L1 to L2 message found for message hash`. The natural reading is that the hand-rolled deposit produced a malformed message.

It did not. **Neither chain was advancing.** Local anvil mines on demand, not on a timer, and the sequencer produces L2 blocks only when there is something to put in them — so with no other work running, an L1→L2 message simply sits in the inbox forever. `anvil_mine` plus one trivial integration test (L1 370→390, L2 146→153) and the message was consumed immediately.

This is the local-run counterpart to the standing rule that *a service being unreachable is not proof it is broken*: **on an idle local network, "not yet included" is the default state, not a symptom.** Diagnose by checking whether the block numbers move before concluding anything about the code. Mainnet has no such failure mode — both chains advance regardless of what this repo is doing.

### An artifact copy step made a green gate meaningless

`compile-contracts` writes `contracts/target/`, but the client imports `@dfpunk/contracts/artifacts/…`, which is a *copy* made by `copy-artifacts`. Running only the compile step left the two 17 minutes apart, so the client build that "passed" had bundled the previous bytecode. The integration tests were unaffected — they import from `target/` directly, which is why they genuinely did exercise the change.

Same failure family as the lint-instead-of-tsc habit: a gate ran, and it was green, and it was not looking at the artifact under test. `build-contracts` (compile → codegen → copy) is the step that makes them agree; verify with `cmp` rather than assuming.

### The network reserves the WORST case, not the real cost

The measurement paymaster was funded with 12 FJ — comfortably more than the ~0.85 a sponsored transaction actually costs — and sponsored nothing:

```
Invalid tx: Insufficient fee payer balance (required=20458700481600000000, available=12000000000000000000)
```

The sequencer admits a transaction only if the fee payer can cover **gas limits × fee rates**, i.e. the most it could conceivably cost, not what it will cost. At mainnet rates with the client's 2× headroom that is **~20.5 FJ**, against a settled fee of ~0.85 — a 24× gap.

So a paymaster has a **minimum working balance**, not merely a budget, and below it everything looks healthy: positive balance, correct policy, and every player quietly billed their own gas. The failure appears only at submission, long after the funding decision.

This is now surfaced where it will actually be read — `update-fpc-policy --show` computes the reserve from live fee rates and says plainly whether the balance clears it — and called out in the handoff. It is exactly the class of fact that is obvious once measured and invisible until then.

### Measured on mainnet, with the shipping bytecode

| | |
|---|---|
| First of day (claims a seat, opens the allowance) | **0.8491 FJ** |
| Subsequent | **0.8219 – 0.8227 FJ** |
| Worst case the client permits | 20.24 FJ |
| Contract ceiling | 25 FJ |

Statistically identical to the pre-fix bytecode (0.8516 / 0.8220), which confirms the unconditional-insert change did not move the cost: it only affects the terminal transaction, and a terminal transaction now costs what an ordinary one does instead of slightly less. The artifact's calculator figures stand.

### Funding before the audit cleared cost 300 FJ

The first paymaster was deployed and funded with 300 FJ *before* the verification audit ran. The audit then forced a contract change, and a contract change is a new **contract class** — so the repo's artifact no longer matched the deployed instance, and `update-fpc-policy --show` against the live address failed outright with `No artifact registered for contract class 0x147f9a9b…`. The PR's own tooling could not operate the paymaster it had deployed.

That made the redeploy compulsory rather than cosmetic, and the 300 FJ unrecoverable: fee juice is protocol-non-transferable, so there is no withdraw, no migration, and no sweep. Roughly $4.50, which is cheap tuition for the actual lesson:

**Fund last.** Deploying is ~7 FJ and repeatable; funding is irreversible and one-way. The correct order is deploy → verify the tooling can drive the deployed instance → audit → *then* fund, and fund a canary before the tranche. The second deployment followed exactly that sequence: deploy (7 FJ), `--show` against the new address, audit clearance, 5 FJ canary bridged and claimed, then the remaining 95.

The general form: **when one step is reversible and the next is not, never let the irreversible one run first for convenience.** Nothing about funding early made anything faster; it only removed the option to change my mind.

### One finding was an artifact of my own concurrency

The audit reported the `max_uses == 1` case as still unfixed. It was not — the auditor happened to read `main.nr` while a background job had temporarily reverted it to run a negative check. Running an experiment that mutates the working tree while an audit reads it makes the audit's output untrustworthy in both directions. That the auditor independently concluded "the new enforcement test cannot pass against current code" is, by accident, exactly the negative result the experiment was designed to produce.
