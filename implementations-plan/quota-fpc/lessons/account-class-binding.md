# Closing C1: account-class binding — spike log

Date: 2026-07-31. Goal: close the accepted-C1 hole (a custom account contract
can bypass the target allowlist) by allowlisting the *account classes* the
paymaster will hand off to.

## Spike findings (all verified against installed v5.0.1 packages)

1. **The earlier deferral rationale was wrong.** C1's fix was deferred on the
   belief that the account class id is "network-specific". It is not: a class id
   is a hash of the contract artifact — version-specific, identical across
   sandbox/testnet/mainnet for the same `@aztec/accounts` version, computable
   off-chain ahead of time.
2. **The embedded wallet deploys `schnorr_initializerless`** — confirmed at
   `client/src/Session/WalletManager/WalletManager.ts:669`
   (`createSchnorrInitializerlessAccount`) → `@aztec/wallets`
   `embedded_wallet.js` → `SchnorrInitializerlessAccountContract` from
   `@aztec/accounts/schnorr`. It is a DISTINCT artifact from plain Schnorr
   (pubkey via `immutables_hash`, constructor run as a simulation, no deploy
   tx), so it has its own class id. The `stubClassIds` map that assigns both
   types one id is for simulation stubs only — not the real class.
3. **Class ids computed** (from installed `@aztec/accounts@5.0.1` artifacts via
   `getContractClassFromArtifact`):
   - `SchnorrAccount`                → `0x0db539838feacc4420c8e33b01ffe733a8bae58bba2c403653691b1ed8d3d0c5`
   - `SchnorrInitializerlessAccount` → `0x28c2905b5e44745a50b78c9d3084443216b6b369a3c2ecf06640605bf630706f`
4. **The Noir primitive is sound and private-context-proven.**
   `aztec::oracle::get_contract_instance::get_contract_instance(address)`
   returns the address preimage and asserts `to_address() == address`
   (aztec-nr v5.0.1 `oracle/get_contract_instance.nr:15-21`); the address
   derivation commits to `original_contract_class_id`
   (`contract_instance.nr:32-44`), so the class id is unforgeable. It works for
   UNDEPLOYED accounts (validates the preimage, not a deployment record) —
   which is required, since initializerless accounts send no deploy tx. Prior
   art: the schnorr_initializerless account contract itself calls it in
   private (`schnorr_initializerless_account_contract/src/main.nr:50`).

## Codex audit 1 — CRITICAL, and my premise was wrong

Codex (session 019fb896-7026-7b73-8dd2-c86cc2a1ea50) returned **DO NOT SHIP**
against the first version of this fix, and it was right. I had told the user
"standard Schnorr accounts are not upgradeable". **False.**

- Upstream Schnorr accounts execute arbitrary public calls via their generic
  entrypoint (aztec-nr `authwit/entrypoint/app.nr`), so an account CAN call
  `ContractInstanceRegistry::update` on itself.
- The registry authorizes any contract updating ITSELF
  (contract_instance_registry_contract/src/main.nr:206 `msg.sender`).
- The private kernel validates the executed function against the **updated**
  class (`validate_contract_address.nr`, "Step 3"), while private context
  exposes only `original_contract_class_id`.

So class-allowlisting alone is bypassable: bless an account, schedule an
upgrade to hostile code, wait the delay, then get arbitrary transactions
sponsored. The fix as first written would have shipped a false guarantee.

### What makes it actually sound

`update` asserts **"msg.sender is not deployed"** (registry main.nr:210) — it
requires the caller's address nullifier to EXIST, i.e. the instance must be
PUBLISHED. Therefore:

- unpublished at the anchor => never updated, and cannot update later without
  publishing (which the same check then rejects) => **original class == the
  class that will execute**.
- The embedded wallet's initializerless accounts are never published (verified:
  the client has no deploy/publish path for them), so honest players pass.
- Plain `SchnorrAccount` IS published on deploy → it is exactly the vulnerable
  shape → **removed from the DF allowlist**, despite the earlier request to
  include both variants. The contract still takes an ARRAY (the generalization
  asked for); the reference config just lists the one safe class.

Implemented as `require_unpublished_account` (constructor immutable, config
`requireUnpublishedAccounts`, defaults true) using
`aztec::history::deployment::assert_contract_bytecode_was_not_published_by`
against the anchor header.

Also fixed from audit 1: the deploy script's class-id verification **failed
open** on an unrecognized name (a typo would ship an unverified id behind a
warning). Now fails closed unless `--allow-unverified-account-class`.

## Codex audit 2 — SOUND (session 019fb8ad-56b4-7cd1-886e-ff4de21e840b)

Fresh session, defensive framing (the first attempt was refused as a
"cybersecurity risk" for being phrased as an attack — same reframe that worked
earlier in this project). Verdict: **sound with `requireUnpublishedAccounts`**,
no bypass found. It independently confirmed:

- **Private code is not hint-selectable** — the linchpin. The kernel hashes
  `(selector, VK hash)` through the private-function tree, derives the class
  id, and requires the resulting address to equal the called address
  (`validate_contract_address.nr:85,199`). So an unpublished account can only
  execute the code of the class committed in its address preimage.
- **The nullifiers match exactly**: publication's siloed nullifier and the one
  the history helper proves non-inclusion of are the same computation
  (`private_context.nr:392`, `history/deployment.nr:23`).
- Both `update` AND `set_update_delay` require publication
  (registry `main.nr:211,257`).

### One thing I had documented WRONG

My comment claimed a post-anchor update "would be rejected by this same
check". False — a proof already built is not re-checked. The actual protection
is the KERNEL: every private account call reads the updated-class slot, and the
kernel caps the transaction's expiration at that read's time horizon
(`private_kernel_circuit_output_composer.nr:182`); an empty entry carries the
default 86,400s delay (`constants.nr:1344`), so the tx expires before any
post-anchor update could activate. Comment rewritten to state that mechanism.
**Lesson: an audit confirming the CONCLUSION does not confirm the REASONING —
read the findings even when the verdict is "sound".**

Also fixed from audit 2: the deploy script printed "class ids match" even when
an entry shipped unverified; it now reports verified/unverified counts.

## Testing lesson: the regression test was green for the wrong reason

It took FOUR iterations, and only tightening the assertion exposed it:

1. `.toThrow()` with no pattern → passed on `Insufficient fee payer balance`.
   The proof had SUCCEEDED; the check under test never ran. A bare `toThrow`
   on a path with many possible failures asserts almost nothing.
2. Pinned to `/nullifier non-inclusion/i` + funded the paymaster → then failed
   honestly: `deployMethod.send()` does not publish an instance.
3. `wallet.getContractInstance` does not exist (it is `getContractMetadata`).
4. `publishInstance` needs `currentContractClassId`, absent from the preimage;
   and publishing an instance first requires its CLASS to be published.

Final shape: publish the class (idempotently), publish a DEDICATED fresh
account's instance, assert `isContractPublished` is genuinely true, fund the
paymaster, then require the failure to match the non-inclusion error.

**Self-inflicted chain contamination:** an interim version used
`ctx.addresses[3] ?? other`, and the local network has only THREE accounts — so
it permanently published a SHARED test account, breaking "each user gets their
own allowance" on that chain forever. Publication is irreversible; tests that
publish must use accounts they create. Cost: a full chain wipe + restart.

## Remaining trade-offs

- **Version bumps**: a new `@aztec/accounts` version changes the class ids;
  players on it lose sponsorship until an FPC redeploy. Same
  "retune = redeploy" posture as the rest of the immutable policy.
- **Published accounts cannot be sponsored at all** under the reference config.
  That is deliberate. A fork that needs them can set
  `requireUnpublishedAccounts: false`, and thereby accepts the upgrade path
  above — the deploy output says so in plain words.

## Design

- Array of permitted class ids (constructor immutable, zero-padded, capacity 4)
  holding BOTH Schnorr variants per user request.
- Assert in `begin_sponsorship` (setup phase, shared by both entrypoints):
  unauthorized account classes cannot even prove a transaction.
- Config: `allowedAccountClasses: [{name, classId}]`; deploy script re-computes
  ids from the installed artifacts and fails on mismatch (catches version
  drift between config and reality).

## Implementation log (2026-07-31)

- Noir compiled first try; `@aztec/aztec.js` has NO root export — use the
  `/contracts` subpath for `getContractClassFromArtifact` (hit this twice in
  one hour: vitest and the deploy script).
- Deploy dry-run against dark-forest.json: drift check passes on matching
  artifacts; a valid-but-wrong classId is refused with the actionable message
  (verified with a doctored config — the first attempt at a fake id, 0xabab…,
  was ≥ field modulus and got caught by SCHEMA validation instead, which is
  itself the guard working, but doesn't exercise the comparator).
- Simulation-stub worry resolved: `buildAccountOverrides` swaps
  `currentContractClassId` for the stub but keeps the instance preimage —
  `original_contract_class_id` untouched — so the private check is unaffected.
  Confirmed empirically by the suite.
- Local sandbox from 07-29 was clock-dead (idle 2 days, heartbeat gone):
  even the heartbeat's own tx failed "Invalid expiration timestamp" — a
  bootstrap deadlock (no tx can land because the clock is stale; the clock
  stays stale because no tx lands). Only cure: fresh chain. Killed owned pgid,
  wiped datadir, restarted with identical env (captured from /proc). LESSON:
  once a heartbeat-dependent local chain misses ~a day, restart it — do not
  try to catch it up.
- Integration suite: 12/12 with the binding active, including the new
  rejection test (bogus-class FPC refuses the real initializerless player)
  and the all-zero-classes constructor revert. Two harness fixes were needed,
  both read-after-write sync lag, not contract behavior: (1) sponsoring
  against a JUST-deployed instance fails "uninitialized PublicImmutable"
  until the deploy block is anchored — poll a utility read first; (2) the
  exhaustion probe sees the last pop one sync late (same lag as the in-game
  badge) — poll briefly before asserting.
