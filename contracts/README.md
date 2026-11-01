# Contracts

Aztec Noir contracts for Dark Forest Aztec, plus the TypeScript scripts that build, check, deploy, and configure them.

Read [`docs/architecture.md`](../docs/architecture.md#contracts) first for the state hash model. This page covers how that model is implemented and how to verify changes.

## Layout

| Path             | Contents                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `types/`         | Storage state structs (`types/src/storage/`) and config structs (`types/src/config/`).       |
| `macros/`        | Compile-time macros shared by every contract. See [Macros](#macros).                         |
| `storage/<name>` | One contract per entity. Stores only `id -> hash(state)` and emits the full state as a log.  |
| `system/<name>`  | Game actions. Verify the caller's state against storage, apply the rule, write new state.    |
| `config/`        | Game configuration contract.                                                                 |
| `libs/`          | Game logic shared by system contracts (planet updates, arrivals, artifacts, batching).       |
| `circuits/`      | ZK checks for coordinates, perlin noise, init, move, and reveal.                             |
| `tests/`         | Test-only crates. `tests/state_hash` checks Noir hashes against the TypeScript client. `tests/high_level_planet` runs every action's math on upgraded high level planets and holds the move decay table. |
| `scripts/`       | `build/`, `check/`, `deploy/`, `bootstrap/`, `admin/`, `runtime/`. Each script has a header. |
| `baselines/`     | Local, git-ignored bytecode size snapshot used by `check:bytecode:compare`.                  |

## Following One Write

`Player` is the shortest complete example. The same pattern applies to every storage entity.

1. `types/src/storage/player.nr` declares the struct and derives its hash:

    ```rust
    #[derive(Eq, Serialize, Deserialize, Packable)]
    #[::macros::state_hash]
    pub struct Player { ... }
    ```

2. `storage/player/src/main.nr` stores the hash and emits the update:

    ```rust
    #[event]
    #[::macros::state_update]
    struct PlayerUpdate { id: AztecAddress, block_number: u32, state: Player }

    fn set(id: AztecAddress, state: Player) {
        self.internal.assert_authorized();
        let (root, log) = PlayerUpdate::encode_update(id, self.context.block_number(), state);
        self.storage.state_roots.at(id).write(root);
        unsafe { aztec::oracle::avm::emit_public_log(log.as_vector()); }
    }
    ```

3. `system/core/src/main.nr` splits each action in two. The private function receives the full `Player` from the client, hashes it with `compute_player_hash` (`libs/src/batch_utils.nr`, which maps the zero state to `0`), and applies the game rules. It then enqueues a public function with the old hash and the new state, which checks the hash against storage and writes:

    ```rust
    assert(self.view(player_storage.verify_hash(sender, player_state_hash)), "Player state hash mismatch");
    self.call(player_storage.set(sender, new_player));
    ```

4. The client rebuilds the same hash in `client/src/Session/TxExecutor/stateHash.ts`, and indexers decode the public log back into a `Player`.

## Macros

All three live in `macros/src/lib.nr`.

- **`#[::macros::state_hash]`** on a struct implements `StateHash`. `x.state_hash()` returns exactly `poseidon2_hash(x.serialize())`, but with the Poseidon2 sponge unrolled for the struct's width, which is cheaper in public functions. It also generates two tests per struct that compare both forms.
- **`#[::macros::state_update]`** on a storage `XxxUpdate` event generates `XxxUpdate::encode_update(id, block_number, state)`. It returns the state root and the public log from a single field expansion, so the stored hash and the emitted state cannot disagree. The event must keep the field order `id, block_number, state`.
- **`#[::macros::world_contract]`** replaces `#[aztec]` on every contract. In callers it rewrites `self.view(store.verify_hash(..))`, `verify_hashes_batch`, `is_initialized`, and `self.call(store.set(..))` / `set_arrival_locations_max20` into direct AVM calls, and it decodes fixed batch arguments (arrays of length 5, 9, or 20) inline. Contract code is written the normal SDK way; the rewrite is invisible at the call site.

### Rules

`pnpm check:style` enforces these outside `macros/`, `tests/`, and `mod tests` blocks:

- Hash structs with `x.state_hash()`, not `poseidon2_hash(x.serialize())`. Hashing a raw array such as `poseidon2_hash([key, x, y])` is fine.
- Storage contracts write through `encode_update`, not `self.emit`.
- Contracts use `#[::macros::world_contract]`, not a bare `#[aztec]`.

A failure prints the offending lines, the reason, and the fix.

## Setup

- Node.js and pnpm versions from [`CONTRIBUTING.md`](../CONTRIBUTING.md#environment), then `pnpm install` at the repo root.
- The Aztec CLI matching the `aztec-nr` tag in the package `Nargo.toml` files (currently `v6.0.0`). It provides `aztec` and `aztec-nargo`.

Run every command below from `contracts/`.

## Checks And Tests

| Command                       | Needs a build | What it catches                                                                 |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `pnpm check:style`            | No            | Code that bypasses the macros.                                                  |
| `pnpm check:hash`             | No            | Noir struct layout, client serializer order, or Aztec Poseidon2 drifting apart. |
| `pnpm check:aztec-upgrade`    | No            | `check:style` and `check:hash` together.                                        |
| `pnpm test:nr`                | No            | All Noir tests in the workspace.                                                |
| `pnpm test:decay-match`       | No            | Frontend and contract computing different move decay (UI offers a move that reverts). |
| `pnpm check:bytecode:compare` | Yes           | Per-function bytecode size changes against `baselines/bytecode.json`.           |
| `pnpm fmt:aztec:check`        | No            | Noir formatting.                                                                |

`check:hash` works in two steps. `scripts/check/state-hash-vectors.ts --check` regenerates `tests/state_hash/src/vectors.nr` in memory from the struct definitions and the client serializers, and fails if the committed file differs. Then the Noir tests assert that `poseidon2_hash(serialize())`, `state_hash()`, and `encode_update` all reproduce those client-computed hashes.

`test:decay-match` compares the move decay formula on both sides. `scripts/check/move-decay-vectors.ts --check` runs the frontend's `decayedPopArriving` (`client/src/Session/TxExecutor/MoveSimulation.ts`) over a fixed grid and fails if the committed table `tests/high_level_planet/src/move_decay_vectors.nr` differs. Then the Noir test `move_decay::matches_client_vectors` in the same crate asserts the contract returns the same number for every row. After an intended formula change, run `pnpm test:decay-match:regenerate`, review the diff, and update the other side until `test:decay-match` passes.

Bytecode sizes are a proxy for deployment cost and contract size limits, not per-transaction gas. To compare:

```bash
pnpm build:compile
pnpm check:bytecode:compare
```

## Common Changes

### Change a storage struct

1. Edit the struct in `types/src/storage/`.
2. Update the matching `serialize*` function in `client/src/Session/TxExecutor/stateHash.ts` to the same field order.
3. Run `pnpm check:hash:update` to regenerate the vectors, then `pnpm check:hash`.
4. Update the indexers that decode the public log.

A layout change changes every hash, so roots already stored on a deployed network no longer verify. Treat it as a redeploy.

### Add a storage entity

1. Add the struct to `types/src/storage/` with `#[::macros::state_hash]`.
2. Copy `storage/player` as the template: an `XxxUpdate` event with `#[::macros::state_update]` and a `set` that uses `encode_update`.
3. Add the package to the workspace `Nargo.toml`, with `macros` as a dependency.
4. Add a client serializer, then register the type in `STATES` in `scripts/check/state-hash-vectors.ts` and declare its event in `tests/state_hash/src/lib.nr`.
5. Run `pnpm check:hash:update` and `pnpm check:aztec-upgrade`.

### Upgrade Aztec

1. Before upgrading, build and record sizes: `pnpm build:compile && pnpm check:bytecode:snapshot`. The snapshot refuses to overwrite an existing baseline without `--force`.
2. Bump the `aztec-nr` tag in every `Nargo.toml` and the Aztec packages in the client.
3. Run `pnpm check:aztec-upgrade`. If Poseidon2 changed, `check:hash` fails, and existing onchain roots are invalid.
4. Run `pnpm build:compile && pnpm check:bytecode:compare` to review size changes.

## Build And Deploy

```bash
pnpm build          # format, compile, generate TypeScript bindings, copy artifacts
pnpm net:local      # start a local Aztec network (separate terminal)
pnpm deploy:start   # build, deploy, bootstrap config, publish addresses
```

Network selection comes from `.env` (`AZTEC_NETWORK`), and per-network settings from `networks/<network>.env`. Copy the matching `.example` file to start. See `scripts/runtime/env.ts` for details.
