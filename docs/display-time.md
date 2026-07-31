# Display time and optimistic rendering

The client renders game motion (voyage dots, ETAs) from a smoothed,
continuously-advancing estimate of chain time, and renders the local
player's own unconfirmed moves optimistically. This note states the
invariants that keep both features fair in a multiplayer game and safe
against the on-chain timestamp assertions.

## Invariants

1. **Optimism is presentation-only, and only for your own intent.**
   Optimistic voyage dots are drawn exclusively from the local
   transaction queue (`getUnconfirmedMoves`). They reveal nothing the
   local player does not already know — the player clicked "send". No
   canonical game state (`GameObjects`, planet fields, arrivals) is ever
   mutated from optimistic or smoothed values.

2. **All shared reality is chain-synchronized.** Every player's view of
   committed state — ownership, energy, arrivals, combat outcomes —
   updates only from public chain events, block-gated, identically for
   everyone. Arrival application (`flushMaturedArrivals`) runs on raw
   block time, never display time. The "arriving" hold (landing beacon)
   is honest: it ends only when canonical state matures.

3. **Transactions never read the display layer.** Contract call
   timestamps come from raw block time (`ChainClock.now()/nowSec()`);
   the smoothed clock (`smoothedNowMs`) is display-only. The contracts
   assert `timestamp <= actual_timestamp` and freshness within 300s
   (`contracts/libs/src/batch_utils.nr`), so a display estimate running
   ahead of the sequencer must never reach a contract argument.

4. **A pre-inclusion shared view is impossible by protocol, not just by
   choice.** Move coordinates are private circuit inputs; the source and
   target location ids only become public in the event emitted at
   inclusion. Another player's client has nothing to render before the
   block mints — the same property the fog of war depends on. The chain
   is therefore the synchronization point for all players, necessarily.

## Consequences for multiplayer fairness

- Player A seeing their own pending move early confers no information or
  action advantage: A cannot act on the optimistic view (invariant 3),
  and A already knew the move was sent.
- Player B sees A's move at inclusion — unchanged from the original
  Dark Forest model. The display clock improves B's picture of moves B
  can already see: in-flight voyages advance continuously instead of
  stepping once per block.
- A failed or dropped transaction retracts its optimistic dot; nothing
  was ever applied, deducted, or shown to anyone else.
- Chain-tip reorgs: renderers follow the indexer store; the display
  clock's phase envelope is monotone, so display time never runs
  backwards through turbulence.

## The deliberately unbuilt feature

Optimistically *applying* arrivals (combat/capture outcomes before the
chain confirms) would shorten the "arriving" hold but create divergent
player realities and invite acting on unconfirmed ownership. It was
considered and deferred: if ever built, it must be a derived display
projection that never writes to canonical state and never feeds intent
construction (see the timestamp path via `Planet.lastUpdated` into
`move()`'s `uiTimestamp`, which makes naive optimistic mutation unsafe).

## Display clock model (summary)

Chain block timestamps are metronomic; block *delivery* to clients is
not (observed swings of tens of seconds). The smoother keeps an offset
high-water envelope — `offset = chainTimestamp − monotonicNow` — where
late deliveries refresh liveness but never lower phase. The display
advances at 1–1.5× wall rate while observations are fresh, never stalls
or reverses, freezes at a bounded extrapolation cap when starved, and
surfaces that state (`getDisplayTimeStale`) as "syncing..." instead of
a stuck countdown. Implementation: `client/src/Backend/Utils/TimeSmoother.ts`.
