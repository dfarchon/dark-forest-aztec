# State validation regression tests

These tests exercise the real system/storage contracts in the Aztec Test
Execution Environment (TXE), using the repository's Aztec 5.0.1 toolchain.

From `contracts/`, compile the contracts and run:

```sh
aztec compile
aztec test --package security_tests
```

With an already running TXE, the equivalent test command is:

```sh
aztec-nargo test --package security_tests --oracle-resolver http://127.0.0.1:8080
```

Coverage includes occupied-planet zero witnesses, creating absent planets,
preserving the existing planet clock on reveal, self-movement in private and
public entrypoints, repeated activation, and invalid spaceship configuration in
all three affected public handlers. Expected failures assert the specific reason
so a fixture/setup failure cannot masquerade as a successful regression test.

Public-handler tests intentionally set the sender to the contract itself inside
TXE to isolate storage validation after private execution. This is a test-only
capability, not an account's ability to bypass `only_self`. Private-entry tests
use ordinary light accounts. TXE executes the contracts without generating real
proofs or sending network transactions.

The fixes change system contract classes and internal public callback selectors.
Private client-facing argument lists and storage schemas are unchanged. Before
deployment, regenerate artifacts/bindings with the normal contract build and
update system addresses and storage permissions using the existing deployment
workflow. Deploying the fixes does not repair state already corrupted by older
classes; any such state needs separate inspection and migration.
