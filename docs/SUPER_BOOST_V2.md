# SUPER BOOST V2

Base: `2bc30f6a04b2997095aa21e9a986e99b9fa83854`.
Toolchain: Aztec 5.0.1; Node 24.12.0; pnpm 10.28.0.

The seven local branches form a cumulative stack. Commit each verified stage
before creating its successor. Do not push intermediate branches. The final
integration branch requires explicit authorization before pushing.

| Branch | Required change | Gate |
| --- | --- | --- |
| `perf/superboost-baseline` | Frozen behavioral reference, deterministic fixtures, measured baseline | Compile, reference tests, indexer tests, transaction benchmark |
| `perf/superboost-refresh` | Carry event/arrival indices, eliminate repeated matching scans, conditional work | Preserve arrival tie order, swap-removal order, artifact alignment and reverts |
| `perf/superboost-planet-split` | Static/Dynamic/Stats/Modifiers with authenticated roots and composition | Round trips, zero state, initialization, stale-witness rejection, all writers |
| `perf/superboost-move-fastpath` | Population-only, silver and artifact paths | Identical gameplay, authorization and timestamp checks |
| `perf/superboost-state-pack` | Dynamic packing, counters/flags, unchanged-write suppression | Full original integer ranges, canonical encoding, overflow fallback |
| `perf/superboost-events-batch` | Changed slots, batched updates, shared serialization | Correct zero clearing, ordering, duplicate and capacity handling |
| `perf/superboost-integration` | Indexer reconstruction/migration, CI gates, final comparison | Replay/reorg recovery, full test suite, end-to-end benchmarks |

## Benchmark contract

Use identical initial state and inputs at each stage for population-only move,
silver move, artifact move, uninitialized destination, one arrival, multiple
arrivals and upgrade. Record fee, DA/L2/public gas, simulation/proving duration,
storage reads/writes, hashes and public log fields where instrumentation provides
them. Missing metrics are unavailable, never zero. Do not infer gas savings from
source size, bytecode size or test duration. Each stage needs measured evidence
before advancing through its performance gate.

## Behavioral oracle

`contracts/libs/src/superboost_reference.nr` freezes the original refresh and
lazy-update implementation. Production contracts must not call it. Tests compare
both refresh APIs, including complete arrays and artifact-location indices.
Keep it unchanged as optimizations are introduced.

Run from `contracts/` with the pinned toolchain available:

```sh
aztec-nargo test --package libs --silence-warnings
aztec-nargo test --package types --silence-warnings
aztec compile
```

Run the indexer tests from the repository root:

```sh
node --experimental-transform-types packages/indexer-core/src/IndexerService.test.ts
```

## Migration constraints

Planet storage currently authenticates a single full-state hash; splitting it
changes the commitment protocol and cannot be rolled out as a struct-only edit.
All gameplay writers, private witnesses, public verifiers, generated artifacts,
deployment wiring and indexer reconstruction must agree on the new version.
Historical full-Planet events need explicit replay compatibility. Never replace
authenticated cold state with unverified client input.
