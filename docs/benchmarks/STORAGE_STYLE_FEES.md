# Storage-style fee measurement

Compare gameplay transaction cost across contract storage styles on a fresh local Aztec network. The harness lives in `contracts/scripts/test/` and is shared by `9stx6/devkitV52` (historical numbers) and `9stx6/gasMainRound2` (current work).

## Sections in `storage-style-fees.json`

Each top-level key in [storage-style-fees.json](storage-style-fees.json) is one measured run: `commit`, `measured_at`, and a `functions` list of the five gameplay calls.

| Section | Branch / style | Status |
| --- | --- | --- |
| `devkit`, `devkitBeforeSliceWrites`, `devkitSliceWrites`, `devkitNoSplitRoots`, `devkitSkipUnchangedRows` | DevKit packed-arrival experiments (27-28 Sep 2026) | Historical, from V52 |
| `devkitMain` | Main's single `state_roots` hash, full `Arrival` slots, `#[aztec]` (27 Sep 2026) | Historical, from V52 |
| `aztec520` | Aztec 5.2.0 run (28 Sep 2026) | Historical, from V52 |
| `devkitV52` | Latest V52 run (28 Sep 2026, commit `5abe77f-nosplit`). It was named `current` in the V52 file. | Historical, from V52 |
| `currentPre` | `gasMainRound2` baseline BEFORE dirty-row / skip-unchanged gas work (15 Nov 2026) | Measured |
| `currentPost` | `gasMainRound2` AFTER gas work (same scenario, fresh chain) | Measured |
| `current` | Alias of the latest core-five gameplay run | Measured |
| `currentWired` | Expanded suite: core five + buy_hat, transfer_planet, create_planet, reveal, admin give, config/pause (15 Nov 2026) | Measured |

Add more sections with any name. The runner only overwrites the section you name.

Numbers from V52 were taken on a sandbox where the fee schedule charged L2 gas and zero DA gas, so the receipt fee follows L2 gas.

## All function differences (billed L2)

Sources in [storage-style-fees.json](storage-style-fees.json):

| Column | Section | Meaning |
| --- | --- | --- |
| Main | `devkitMain` | Original main-style storage (full Arrival slots, single `state_roots`) |
| V52 | `devkitV52` | Optimized DevKit / V52 target |
| Pre | `currentPre` | `gasMainRound2` before dirty-row / skip-unchanged work |
| Post | `currentPost` | Same branch after gas opts (core five only) |
| Wired | `currentWired` | Latest full suite after arrival re-emit + hat/transfer + all harnesses |

Em dash (—) = not measured in that section (method did not exist in the harness yet).

### Core five vs Main / Pre / Post

| Function | Main | V52 | Pre | Post | Wired | Wired−Main | Wired−Pre | Wired−Post |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| initialize_player | 1,028,414 | 831,158 | 892,931 | 890,294 | 890,294 | −138,120 (−13.4%) | −2,637 (−0.3%) | 0 |
| give_spaceships | 2,655,419 | 1,530,795 | 1,768,775 | 1,769,129 | 1,769,156 | −886,263 (−33.4%) | +381 | +27 |
| move | 3,782,976 | 1,300,288 | 1,921,021 | 1,300,873 | 1,301,245 | −2,481,731 (−65.6%) | −619,776 (−32.3%) | +372 |
| upgrade_planet | 1,949,767 | 1,123,206 | 1,136,350 | 1,123,338 | 1,210,797 | −738,970 (−37.9%) | +74,447 (+6.6%) | +87,459 (+7.8%) |
| withdraw_silver | 2,008,785 | 1,177,232 | 1,187,400 | 1,174,172 | 1,261,631 | −747,154 (−37.2%) | +74,231 (+6.3%) | +87,459 (+7.4%) |

`upgrade_planet` / `withdraw_silver` rose ~87k vs Post because `ArrivalStorage.reemit_batch` now runs on the refresh path. `move` stayed flat.

### Public L2 (core five)

| Function | Main | Pre | Post | Wired | Wired−Main | Wired−Post |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| initialize_player | 437,614 | 302,131 | 299,494 | 299,494 | −138,120 (−31.6%) | 0 |
| give_spaceships | 2,064,619 | 1,177,975 | 1,178,329 | 1,178,356 | −886,263 (−42.9%) | +27 |
| move | 3,192,176 | 1,330,221 | 710,073 | 710,445 | −2,481,731 (−77.7%) | +372 |
| upgrade_planet | 1,358,967 | 545,550 | 492,538 | 579,997 | −778,970 (−57.3%) | +87,459 (+17.8%) |
| withdraw_silver | 1,417,985 | 596,600 | 543,372 | 630,831 | −787,154 (−55.5%) | +87,459 (+16.1%) |

### Newly harnessed methods (Wired only — no Main/Pre/Post baseline)

| Function | Wired billed L2 | public L2 |
| --- | ---: | ---: |
| buy_hat | 720,843 | 130,043 |
| transfer_planet | 721,002 | 130,202 |
| create_planet | 941,865 | 351,065 |
| reveal_location | 849,614 | 258,814 |
| admin_give_artifact | 831,592 | 240,792 |
| admin_give_spaceship | 943,920 | 353,120 |
| set_world_config | 932,958 | 342,158 |
| admin_set_world_radius | 681,099 | 90,299 |
| pause | 679,827 | 89,027 |
| unpause | 679,908 | 89,108 |
| safe_set_owner | 760,785 | 169,985 |
| prospect_planet | 1,165,822 | 575,022 |
| find_artifact | 1,506,487 | 915,687 |
| activate_artifact | 1,306,908 | 716,108 |
| deactivate_artifact | 1,242,080 | 651,280 |
| withdraw_artifact | 1,240,349 | 649,549 |
| deposit_artifact | 1,240,268 | 649,468 |

## gasMainRound2 before vs after (15 Nov 2026)

Billed L2 on a fresh local network with `FEE_PAYMENT_MODE=sponsored` and `SPONSORED_FPC=true`. Same five-call scenario as V52.

| Function | currentPre | currentPost | Delta | V52 target |
| --- | ---: | ---: | ---: | ---: |
| initialize_player | 892,931 | 890,294 | -2,637 | 831,158 |
| give_spaceships | 1,768,775 | 1,769,129 | +354 | 1,530,795 |
| **move** | **1,921,021** | **1,300,873** | **-620,148** | **1,300,288** |
| upgrade_planet | 1,136,350 | 1,123,338 | -13,012 | 1,123,206 |
| withdraw_silver | 1,187,400 | 1,174,172 | -13,228 | 1,177,232 |

`move` public L2: 1,330,221 → **710,073** (V52 target ~710,142). Primary win is dirty-row skips + conditional arrival verify/write + zero-id artifact skip on the public path.

## Historical V52 numbers

Billed L2 gas. `Skip unchanged rows` and `Latest` are DevKit runs where unchanged side rows are skipped, empty arrival batches are omitted, and `move` skips artifact checks when the id is zero. `DevKitMain` is the single-root style with full arrival slots.

| Function | Skip unchanged rows | Latest | DevKitMain | Fee |
| --- | ---: | ---: | ---: | ---: |
| initialize_player | 831,158 | 831,158 | 1,028,414 | 8,477,811,600,000 |
| give_spaceships | 1,531,122 | 1,531,122 | 2,655,419 | 15,617,444,400,000 |
| move | 1,362,427 | 1,300,942 | 3,782,976 | 13,269,608,400,000 |
| upgrade_planet | 1,123,533 | 1,123,533 | 1,949,767 | 11,460,036,600,000 |
| withdraw_silver | 1,177,559 | 1,177,559 | 2,008,785 | 12,011,101,800,000 |

`move` public L2 is 710,142. The other four functions match the previous DevKit run. Teardown gas was 0 for every row.

Aztec 5.2.0 on the same five calls is the `aztec520` section. Billed L2 matches the latest 5.0.1 DevKit column: initialize_player 831,158, give_spaceships 1,531,122, move 1,300,942, upgrade_planet 1,123,533, withdraw_silver 1,177,559.

These numbers are for the V52 contracts. `gasMainRound2` changed `initialize_player` (see below), so do not compare its first row to V52 without re-measuring.

## What is recorded

Each included transaction prints one `FEE_MEASURE` line from `contracts/scripts/test/feeMeasureLog.ts`:

- `total`, `public`, `billed`, and `teardown` DA and L2 gas from wallet simulation
- `fee` from the receipt `transactionFee` when the node provides it

Missing fields stay empty. They are never written as zero.

## How to run on gasMainRound2

The scripts use the `gasMainRound2` runtime, not the V52 `.env` layout:

- Network config: `contracts/networks/<AZTEC_NETWORK>.env` (copy the `.example`, run `pnpm account:generate`). `contracts/.env` only selects `AZTEC_NETWORK`.
- `FEE_PAYMENT_MODE` is required (`sponsored` or `account`). A missing value is an error; there is no default.
- Contract addresses come from the latest complete deploy manifest in `contracts/deployments/<network>/`.
- The admin is the deployer account. `user1` and `user2` are generated once per network and saved in `contracts/scripts/.test-accounts.json` (gitignored). In `account` mode they also need FeeJuice; the run stops with a funding guide if they do not.

Start a fresh Aztec local network with SponsoredFPC funded, then from `contracts/`:

```sh
SPONSORED_FPC=true SEQ_MIN_TX_PER_BLOCK=1 SEQ_BLOCK_DURATION_MS=6000 aztec start --local-network
pnpm build:contracts                  # artifacts must match the checked-out contracts
pnpm deploy:run && pnpm bootstrap     # deploy and configure
pnpm test:fee-payment                 # offline sanity check, no node needed
FEE_MEASURE_COMMIT="$(git rev-parse HEAD)" pnpm test:measure-fees currentPre   # or currentPost
```

`pnpm test:measure-fees <section>` runs `scripts/test/measure-storage-fees.ts`, writes `docs/benchmarks/storage-style-fees.json`, and keeps all other sections. Use `currentPre` / `currentPost` for before/after comparisons.

`pnpm test:measure-wired-fees currentWired` runs the expanded harness (`measure-wired-fees.ts`) for every client-wired write that has a fee script. Offline wiring inventory: `pnpm test:wiring`.

Helper scripts in `contracts/scripts/test/`:

- `pnpm exec tsx scripts/test/test-env.ts` prints the active network config (secrets hidden) and the latest deployment.
- `pnpm exec tsx scripts/test/test-setup.ts` builds the 3-account context and lists contract functions.
- `test-configure-resume.ts` and `test-moveProof.ts` are stubs. They depended on V52-only modules and are not part of the fee-measure path.

The recorded player functions for `test:measure-fees`, in order:

1. `initialize_player` for user 1
2. `initialize_player` for user 2 (setup only, not recorded)
3. `give_spaceships` on user 1's home planet
4. `move` from user 2's home to an uninitialized planet
5. `upgrade_planet` for user 2
6. `withdraw_silver` for user 1

`test:measure-wired-fees` continues with `buy_hat`, `create_planet`, `transfer_planet`, `reveal_location`, `admin_give_*`, config/pause, then `test-remaining-wired.ts` for `safe_set_owner`, `prospect_planet`, `find_artifact`, `activate_artifact`, `deactivate_artifact`, `withdraw_artifact`, `deposit_artifact`. That covers all 22 client-wired write methods.

Reset the chain before each measured run so every run starts from the same empty state and the same fee mode.

## gasMainRound2 differences from V52

`Core.initialize_player` creates the home planet on an empty slot. Its arguments after the config structs are only `planet_state` (must be `Planet::zero()`), `player_state`, and `world`. It has no `planet_events`, `planet_artifacts`, `arrivals`, `arrival_artifacts`, or `arrival_artifact_locations` arguments. The test scripts pass exactly that list.

`move`, `upgrade_planet`, `withdraw_silver`, and `give_spaceships` keep their V52 argument lists.

## Planet writes

`PlanetStorage.set` stores the full planet hash in `state_roots` and emits the full `PlanetUpdate` log. Gameplay checks the full `state_roots` hash. The indexer reconstructs the planet from `PlanetUpdate`. A planet-events or planet-artifacts row is written only when a field other than `last_updated` changed. An empty arrival batch is not passed into the public call. `move` checks a moved or activated artifact only when its id is not zero. The voyage log still includes the empty event slots, because a shorter log is dropped by the indexer.
