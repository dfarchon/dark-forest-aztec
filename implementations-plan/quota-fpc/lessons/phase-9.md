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

