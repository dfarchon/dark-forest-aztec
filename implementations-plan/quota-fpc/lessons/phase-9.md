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

