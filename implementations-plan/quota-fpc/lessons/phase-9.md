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
