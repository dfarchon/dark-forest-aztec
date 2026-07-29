# Phase 5 lessons — deploy and calibration (2026-07-29)

## What shipped

- `contracts/scripts/deploy/deploy-fpc.ts` — deploys a paymaster from a config file. Prints the whole plan (policy, worst-case daily spend, accepted loss cap, every sponsored contract by name and address) before sending anything, and supports `--dry-run`.
- `contracts/scripts/operator/calibrate-gas.ts` — turns measured fees into the per-transaction ceiling.
- Measurement capture wired into the integration suite (`QUOTA_FPC_MEASURE=<file>`), so the number comes from real sponsored transactions rather than a spreadsheet.
- Scripts registered as `deploy-fpc` and `calibrate-fpc-gas`.

## Validation gate — PASSED

| Command | Result |
|---|---|
| `pnpm --filter contracts run deploy-fpc -- --config fpc/config/dark-forest.json --dry-run` | exit 0, full plan printed |
| Over-budget config (deliberate) | **exit 2**, refused with the exact arithmetic |
| `QUOTA_FPC_MEASUREMENTS=… pnpm --filter contracts run calibrate-fpc-gas` | exit 0, ceiling derived |
| Calibration without measurements | **exit 3**, refuses to guess |
| `pnpm --filter contracts run lint` | exit 0 (after `lint:fix` sorted imports) |
| `QUOTA_FPC_SANDBOX_URL=… pnpm --filter @dfpunk/quota-fpc run test` | exit 0 — 37 passed |

## The ceiling is now measured, not guessed

Five real sponsored transactions on the sandbox:

| Path | n | min (wei) | max (wei) |
|---|---|---|---|
| first-of-day | 3 | 7,242,734,400,000 | 7,595,511,600,000 |
| subsequent | 2 | 7,059,246,600,000 | 7,281,351,600,000 |

`maxFeeWei = 22,786,534,800,000` (costliest path × 3 headroom), now in `dark-forest.json` replacing the placeholder. Worst case per day moves to 0.0683 FJ against a 1370 FJ loss cap — four orders of magnitude of margin, which says the *balance*, not the policy, is what actually bounds risk at showcase scale.

First-of-day costs measurably more than subsequent transactions, as expected: it claims a seat, emits a second nullifier, and opens the allowance note. Sizing the ceiling off the average would have quietly broken every user's first transaction of the day.

## Two refusals worth keeping

Both scripts fail rather than proceed on incomplete information, because neither mistake is correctable after deployment:

- **The loss-cap interlock fires.** A config whose worst case (`maxFee × maxUses × maxUsers`) exceeds the declared `maxLossWei` exits 2 with both numbers and the instruction to lower the policy or raise the budget deliberately. Verified with a deliberately over-generous config: 3000 FJ/day against a 1370 FJ cap, rejected.
- **Calibration will not invent a number.** With no measurements it exits 3 and says how to produce them, explicitly noting the config's value must not be used for a funded deployment until then.

## Notes

- Deployment does not fund. Funding stays a separate, deliberate step; the deploy output says so and restates the cap.
- The measured ceiling landed within 4% of the placeholder guess — pleasant, but the point is that it is now evidence with a date and a method attached, and mainnet fees will differ, so it must be re-run there before funding.
- The repo's eslint enforces import sorting; `lint:fix` handles it.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-5.md
