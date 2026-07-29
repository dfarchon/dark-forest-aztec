# Phase 4 lessons — integration suite (2026-07-29)

Real compiled contracts, a live local network, and this package's own client code. Nothing mocked.

## Validation gate — PASSED (with one item explicitly outstanding, below)

| Command | Result |
|---|---|
| `QUOTA_FPC_SANDBOX_URL=… pnpm --filter @dfpunk/quota-fpc run test` | exit 0 — **36 passed** (26 unit + 10 integration) |
| `pnpm --filter @dfpunk/quota-fpc run test` (no sandbox) | exit 0 — 26 passed, 10 correctly skipped |

## What is now proven against a live chain

| Property | Evidence |
|---|---|
| The app sees the USER, not the paymaster | `observed == player address` on a real sponsored call |
| The paymaster pays, the user pays nothing | `fpcPaid: 7595511600000`, `playerPaid: 0` |
| **Allowlist binds sponsorship to the app** | a call to an unlisted contract cannot be proven |
| TS ↔ Noir nullifier parity | seat and player nullifiers identical on-chain and locally |
| One subscription per user per generation | second subscribe rejected |
| Allowance is exactly `max_uses` | 2 → 1 → note gone → `No sponsored transactions remaining` |
| Per-user isolation | a second user gets their own full allowance |
| Stale / premature generations | both refused with the freshness message |
| Seat beyond capacity | refused |
| Constructor invariants | `max_uses = 0` and an empty allowlist both rejected |

## The inclusion-time revert — the case Phase 1 could not reach

Phase 1 only produced *simulation-time* reverts, where nothing reaches the chain. The audits' real concern was a transaction that simulates cleanly and then fails at inclusion, which is what contention produces in a real game (ownership races, rate limits). `FpcTestTarget.claim_once` forces exactly that: a public one-shot flag, so the second transaction simulates against pre-state and reverts in the public phase.

Observed: `landed: false` (reverted), `fpcPaid: 6589016400000`, allowance `remaining 2 → 1`.

So an inclusion-time revert **consumes one use and the paymaster pays** — and, critically, the user keeps their seat and the rest of their allowance. The pre-`end_setup` note ordering (fable H2) does its job: nobody is left holding a burned seat with no allowance behind it. This is the correct trade — a reverting transaction still costs the sender something, or reverts would be a free griefing channel — and it is now demonstrated rather than argued.

## Outstanding before mainnet (blocks Phase 8)

The plan's Phase 4 also requires sponsoring the **real Dark Forest contracts** on a sandbox, not just `FpcTestTarget`. That leg is NOT done: it needs the full game deployment (17 contracts plus configuration) on the local network. The FPC mechanics are proven, but "a real `move` sponsored end to end" is still unproven, and the plan makes that the gate for funding anything on mainnet. It stays open.

## Gotchas that cost time

- **Proving scope must be the sponsored USER, not the paymaster.** The allowance note is delivered to the user, so `proveTx({ scopes: [...] })` needs their address; scoping to the fee payer fails with `Key validation request denied`.
- **Wait for inclusion before asserting.** Returning a transaction hash without awaiting the receipt produced phantom failures — `msg_sender` read back as the zero address purely because the block had not landed.
- `interaction.request()` returns an ExecutionPayload, not an array; the sandwich builder wants `payload.calls`.
- Field values come back **decimal** from a contract simulation and **hex** from the client; compare `BigInt(a) === BigInt(b)`, never the strings. A raw string comparison made a passing parity check look like a mismatch.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-4.md
