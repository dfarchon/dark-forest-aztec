# Phase 3 lessons — `@dfpunk/quota-fpc` package (2026-07-29)

## What shipped

`packages/quota-fpc/` (registered in `pnpm-workspace.yaml`), browser-safe, no node-only imports:

| Module | Responsibility |
|---|---|
| `generation.ts` | UTC day-index maths, the rollover grace window, reset countdown. All derived from CHAIN time, never the local clock. |
| `nullifiers.ts` | Seat and player nullifiers, mirroring the contract's domain separators. |
| `seat-picker.ts` | Free-seat discovery via nullifier-tree probes, with the `assertValidMaxUsers` guard inherited from aztec-kit. |
| `errors.ts` | The reason taxonomy plus user-facing copy, and revert-message mapping. |
| `sandwich.ts` | Transaction assembly, extracted from the proven spike into reusable form. |
| `allowance.ts` | Fee-source resolution (sponsored → self-pay → blocked) and the sync-await state machine. |

## Validation gate — PASSED

| Command | Result |
|---|---|
| `pnpm --filter @dfpunk/quota-fpc run test` | exit 0 — 26 tests across 4 files |
| `pnpm --filter @dfpunk/quota-fpc run build` (tsc) | exit 0 |
| `pnpm --filter @dfpunk/quota-fpc run format:check` | exit 0 |
| `pnpm --filter contracts run build-contracts` (re-run after the separator fix) | exit 0, 19 artifacts |

## The tests earned their keep immediately

**A real bug, caught on first run.** The player-nullifier domain separator was `1347240786`, commented `"PLYR"`. It is actually `0x504d4352` = **"PMCR"** — a typo. The assertion that the constant equals the ASCII of its own comment failed, and the value is now `0x504c5952` in both the contract and TypeScript. Harmless today because nothing is deployed and both sides shared the typo; after deployment it would have been an immutable oddity that made every future reader doubt the parity. Lesson: assert constants against their stated meaning, not just against each other.

**Second catch:** validation errors threw synchronously from functions that otherwise return promises, so callers had two error channels to handle. The nullifier helpers are now `async` throughout — one channel.

## Design notes worth keeping

- **Exhaustion requires positive evidence.** `resolveFeeSource` never reports "out of free transactions" from a timeout: an unsynced wallet and an exhausted one look identical, and guessing wrong pushes an active player toward a funding page they do not need. The taxonomy separates `sync-pending` (retryable) from `exhausted` (terminal for today), and `awaitAllowanceTransition` waits for a *specific expected transition* — including the note *disappearing*, which is the correct terminal signal for the final transaction.
- **Self-pay fallback is silent and preferred over blocking.** A player with their own fee juice is never stopped because sponsorship lapsed, spiked, or rolled over.
- **Everything is injectable** (`findFreeSeat`, `now`, `sleep`, `random`, the node probe), so the whole decision surface is unit-testable without a network — which is what let this phase's gate be meaningful despite the repo having no test infrastructure before.
- Seat selection is random among free seats, not lowest-first: concurrent newcomers would otherwise collide on seat 0 by construction.

## Gotchas

- `@aztec/foundation/crypto` is not an export path; poseidon lives at `@aztec/foundation/crypto/poseidon`.
- `AztecAddress.fromString` does not exist at 5.0.1 — it is `fromStringUnsafe`.
- Vitest under Node 24 needs `server.deps.inline: [/@aztec/]` (same as the spikes) for the packages' attribute-less JSON imports.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-3.md
