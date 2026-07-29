# Research: Nethermind aztec-fpc (prior art for spike 1B)

Source: https://github.com/NethermindEth/aztec-fpc (Apache-2.0, "Alpha", 247 commits, active 2026-02→06, no external audit). Recon 2026-07-29 (`main` @ `72075d2`). **Pins Aztec `4.2.0-aztecnr-rc.2`, not 5.0.1** — every primitive must be re-verified before copying; the agent spot-verified only `DefaultEntrypoint` + `ExecutionPayload` as API-identical at 5.0.1.

## What it is

A production-oriented "pay fees in any token" FPC: operator signs Schnorr price quotes (domain-separated, nullifier-replay-protected, TTL-capped), an attestation REST service issues them, a top-up daemon keeps the FPC funded from L1, TS SDK glues it. **No call-binding, no on-chain quota/rate-limits** (their only rate limit is HTTP-level on the quote endpoint) — their threat model is "operator prices each tx", not "bound per-player allowance".

## Directly useful for spike 1B

1. **`DefaultEntrypoint` from `@aztec/entrypoints/default` EXISTS at 5.0.1** and is exactly the generic non-account-origin `EntrypointInterface` we assumed was deleted (only the multi-call authwit'd `DefaultDappEntrypoint` was). Nethermind's cold-start flow uses it in production shape: single-call `ExecutionPayload` → `entrypoint.createTxExecutionRequest(payload, gasSettings, chainInfo)` → `pxe.proveTx` → `node.sendTx` (`sdk/src/payment-method.ts:242-262`, e2e-proven in `scripts/tests/cold-start-validation.ts:275-326` against a live node). Our sandwich's outer tx is a single call to `QuotaFpc.entrypoint(...)` — this slots straight in.
2. **FPC-as-tx-root Noir recipe, live-network-proven**: `cold_start_entrypoint` (`contracts/fpc/src/main.nr:139-243`) — `assert(self.context.maybe_msg_sender().is_none(), "must be tx entrypoint")` + `#[allow_phase_change]` + `set_as_fee_payer()` + `end_setup()`, including a negative TXE test that nested invocation fails. De-risks sandwich evidence (i).
3. **Signed-quote pattern** (`main.nr:245-321`): clean reference for domain-separated Schnorr attestations if we ever want an off-chain-signed component (not needed for our on-chain quota design).

## NOT provided — remains our spike's novel work

- **The sandwich's key move has no precedent**: neither of their entrypoints invokes the *user's account entrypoint* mid-stack. `fee_entrypoint` is the standard sibling shape (called BY the account); `cold_start_entrypoint` executes Token/TokenBridge calls ITSELF as msg_sender (the AppSubscription-style shape that breaks msg_sender apps — deliberately scoped to Token-only). No test anywhere observes a downstream app's msg_sender.
- **Payload argument-encoding**: their root-call args are plain scalars + one signature — the "player-signed AppPayload as an argument to a non-account root call" encoding (analogous to `DefaultAccountEntrypoint.#buildEntrypointCallData`) is ours to build.
- Call-binding asserts and per-player quota state: absent entirely.

## Net effect on spike 1B sizing

Evidence (i) (node accepts FPC-as-origin) is near-free — proven pattern + existing SDK class. The spike's real risk concentrates on (ii)+(iii) (mid-stack account-entrypoint invocation preserving msg_sender) and the payload encoding — precisely the parts with no prior art anywhere (aztec-packages included).
