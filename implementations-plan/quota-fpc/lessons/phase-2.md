# Phase 2 lessons — the `QuotaFpc` contract (2026-07-29)

Shape decision from the Phase 1 gate: **sandwich** (user, on spike 1B evidence). The contract therefore merges the audited quota core from spike 1A into the origin-entrypoint shape proven in spike 1B.

## What shipped

- `contracts/fpc/quota_fpc/src/main.nr` — the paymaster, deliberately **app-agnostic**: the allowlist and policy are constructor arguments, so forking it for another app means writing a config, not editing Noir.
- `contracts/fpc/fpc_test_target/` — test-only target that records observed `msg_sender`.
- `contracts/fpc/config/schema.ts` — typed config + validation.
- `contracts/fpc/config/dark-forest.json` — this deployment's config: six player-facing contracts allowlisted (Core, Move, ArtifactProspect, ArtifactFind, ArtifactAction, ArtifactVault); Admin and Config deliberately excluded so admin operations can never be sponsored.
- Both Noir packages registered in `contracts/Nargo.toml`.

## Validation gate — PASSED

| Command | Result |
|---|---|
| `pnpm --filter contracts run build-contracts` | exit 0 — 19 artifacts compiled, transpiled, codegen'd, copied (`contracts/target/QuotaFpc.ts` present) |
| `pnpm --filter contracts run lint` | exit 0 |
| `pnpm --filter contracts run aztec:fmt:check` | exit 0 — "No formatting changes were detected" |

## Design points worth remembering

- **The config carries a safety interlock.** `parseQuotaFpcConfig` refuses any config whose worst-case daily spend (`maxFee × maxUses × maxUsers`) exceeds the declared `maxLossWei`. Because the paymaster has no withdraw, a mis-sized policy is unrecoverable, so this is a hard error rather than a warning.
- **Allowlist capacity is 12 with six used.** It is immutable per deployment, so headroom now is cheaper than a redeploy later.
- **The 5-call payload ceiling is a non-issue for Dark Forest** — verified by reading the client: `TxExecutor` resolves each intent to exactly one contract method and there is no `BatchCall` anywhere in the repo. One slot used, four spare.
- **`maxFeeWei` in the config is a placeholder** pending Phase 5 calibration; deploying on a guessed ceiling is exactly how sponsorship silently stops working under congestion.

## Noir gotchas (cost real time)

- `#[contract_library_method]` functions are free functions, not methods: they cannot take `self` and cannot be called as `self.foo(...)`. Shared logic that needs the context takes `context: &mut PrivateContext` explicitly.
- `self.context` is **already** `&mut PrivateContext` — passing `&mut self.context` yields `&mut &mut PrivateContext` and fails. Pass `self.context`.
- `#[internal("public")]` does not expose a function on `enqueue_self`; enqueued public functions are `#[external("public")] #[only_self]`.
- `aztec-nargo compile` skips transpilation and verification-key generation; only the full `aztec compile` (what `build-contracts` runs) produces loadable artifacts.

LESSONS_FILE=implementations-plan/quota-fpc/lessons/phase-2.md
