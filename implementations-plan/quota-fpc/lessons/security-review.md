# Security review — codex bug-hunt loops (2026-07-29)

Two defensive Codex reviews (`xhigh`), one on the contract + config, one on the
client send/allowance path. No Critical defects. Findings and dispositions below.

## Contract + config

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| C1 | High | `player` is untrusted: a malicious account contract passed as `player` ignores the signed payload and sponsors arbitrary calls (the FPC has already become fee payer) | **OPEN — user decision.** See below. |
| C2 | Med | Loss-cap check used 1× per-generation; ~3 generations are chargeable around a rollover | FIXED — schema + deploy display use 3× |
| C3 | Low | Fee ceiling added teardown gas; protocol `getFeeLimit()` bills `gas_limits × fees` only | FIXED — verified vs aztec-packages v5.0.1 source |
| C4 | Low | Config accepted u128/u32 overflow and named zero-address targets | FIXED — bounds + zero checks, 5 tests |

## Client

| # | Sev | Finding | Disposition |
|---|-----|---------|-------------|
| L1 | High | PXE lag after a sponsored tx can read as "spent" (note gone, nullifier present) | OPEN — needs pending-send tracking; low fund risk (display + a blocked move, not a wrong charge) |
| L2 | High | Inconclusive allowance read can self-pay a funded player | Partially mitigated (production forces ownBalance 0n → blocks, not charges); the syncing/self-pay comment is still misleading |
| L3 | High | External-wallet quota mode can't work (reaches non-public `wallet.pxe`) | FIXED — external wallets no longer enter quota mode |
| L4 | High | Onboarding preflight promised sponsorship on any paymaster balance (even 1 wei, or a full day) | FIXED — confirms balance ≥ min AND a free seat |
| L5 | High | Lost `sendTx` RPC response can double-submit (paymaster + player both pay) | OPEN — needs idempotency; rare (requires a lost response) |
| L6 | High | Gas limits declared not measured; a heavy call can OOM at execution (paymaster pays, quota consumed) | OPEN — Phase 5 calibration, has real calls to measure now |
| L7 | Med | Badge is one transaction behind (published pre-send, never polled/reset) | OPEN — display only |
| L8 | Med | Dropped sponsored txs aren't retried (`waitForTx` throws on DROPPED) | OPEN — seat-collision UX |
| L9 | Low | `awaitAllowanceTransition` hardcodes `generation: 0`; dead code | OPEN — latent |

## C1 in detail — the "restricted to Dark Forest" guarantee

The sandwich's headline advantage over the standard sibling-call shape was
"sponsorship is restricted to DF, enforced on-chain, no redeploy." **C1 shows
that is only true for cooperative accounts.** The allowlist constrains the
*payload*, but a hostile contract passed as `player` need not execute the
payload — it runs its own logic while the FPC pays. This degrades the shape to
the same app-agnostic-but-quota-bounded posture as Ask A4 (accepted for the
PoC), still capped by `max_users × max_uses × max_fee` per generation and,
ultimately, the paymaster balance.

**The fix** (if we want the guarantee to actually hold): before the hand-off,
assert `get_contract_instance(player).original_contract_class_id` is one of a
constructor-fixed set of blessed account class ids. Sound because `to_address()`
includes the class id, so the oracle cannot return a forged class for `player`'s
address, and a blessed class id cannot coexist with malicious bytecode (the id
is the artifact hash).

**Why it's a user decision, not an automatic fix:**
- The blessed class id **differs by network**: `SimulatedSchnorrAccount` on a
  no-proofs local net vs `SchnorrAccount` on real-proof nets. It is a
  constructor IMMUTABLE, so a wrong value bricks all sponsorship unrecoverably.
- It requires deciding which account types to bless (Schnorr only? ECDSA too?).
- A4 (app-agnostic subsidy) was explicitly accepted for the PoC under the $20
  cap; C1 is the same risk, and the balance is the backstop either way.

Recommendation: for the capped showcase, accept A4/C1 as-is (disclosed to the DF
team). Before any un-capped funding, add the class-id binding with a spike that
proves both directions (honest account passes, a non-blessed contract is
rejected) against the target network's real account class id.
