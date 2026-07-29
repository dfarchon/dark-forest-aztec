# Phase 7 lessons — the player-facing surface (2026-07-29)

## Validation gate — PASSED

| Command | Result |
|---|---|
| `pnpm --filter client run lint` | exit 0 |
| `pnpm --filter client run build` | exit 0 |
| `pnpm --filter @dfpunk/quota-fpc run test` (with sandbox) | exit 0 — **43 passed** across 6 files |

## What shipped

- `client/src/Session/QuotaStatus.ts` — reads a player's allowance for display and turns it into a badge label plus hover copy. Every read failure yields `unknown`, never a number.
- `QuotaBadge` in `TopBar`, beside the wallet balance: "12 free txs" in gold, "no free txs left" in red, with a tooltip explaining when the allowance returns. **Renders nothing when no paymaster is configured**, so existing builds look untouched.
- `test/display.test.ts` — six tests covering the copy and the revert mapping.

## The tests here are about honesty, not crashes

The failure mode for this surface is not an exception, it is *confidently telling a player something untrue*. So the tests assert on meaning:

- **Waiting and being out must read differently.** A wallet mid-sync and a spent allowance look identical to a naive check; conflating them sends an active player to a funding page they do not need.
- **"Out" always says when it comes back.** Exhausted and no-seats copy both name 00:00 UTC — a dead end with no horizon is the thing players complain about.
- **No internal vocabulary reaches the interface.** The copy is asserted to contain no "nullifier", "generation", "paymaster", "FPC", "wei", or even "quota". Players get "free transactions", which is what they actually are.
- **An unrecognised revert maps to no reason at all.** Forcing an unknown failure into the nearest bucket would show confident, wrong copy for an unrelated bug; `reasonFromRevert` returns `undefined` and the caller falls back to a generic message.

## Still deferred: transaction assembly

The sandwich assembly (`buildSandwichPayload` → paymaster-origin send) is written, unit-tested, and proven against a live chain in the integration suite, but is **not yet wired into `TxExecutor`'s send path**. What is missing is not the mechanism — it is the surrounding UX: the sync-pending pause between consecutive sponsored transactions, and routing an exhausted player into the existing bridge flow. Landing the send path without those would make the game feel broken in exactly the moments this feature is supposed to smooth over.

The badge therefore currently reads from a `getQuotaStatus()` hook the UI manager does not yet expose, so it renders as "off". That is deliberate and safe — the display degrades to invisible rather than to wrong — but it means **the counter is not live yet**, and Phase 8's showcase depends on closing that gap.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-7.md
