# Dark Forest Aztec client

## Player guide in the real game

The landing page’s **Player Guide** button opens `/play/:contract?guide=1`.
This uses the normal QuickGame entry: the configured default local account is
selected, otherwise the newest local account is used; when none exists,
QuickGame creates one. The existing wallet registration, home initialization,
prover and fee preflight run unchanged. Sponsorship follows the normal game’s
settings and fallback policy.

Once the game is ready, its six-chapter guide appears over the real map. A
completed tutorial can also be reopened through this entry or **Settings →
Restart Player Guide**. Closing the guide or choosing **Start playing** leaves
the player in the same game with the same account. Ordinary game entry keeps
its existing tutorial completion settings.
Completion or dismissal removes the `guide` query marker with a history
replacement while preserving other parameters and the URL fragment.

This is a personal QuickGame account: normal backup and export remain enabled.
The former shared account pool is no longer loaded by the entry flow. Existing
`/booth` links redirect into QuickGame with the guide enabled. Old
`?booth=...&searchCenter=...` bookmarks are normalized before the game mounts, so
neither a shared account nor a fixed booth spawn is selected. Legacy shared-account records remain excluded from personal backups; their
generation tools and custom spawn/recovery logic are not part of this flow.

## Guide behavior

The chapters cover the map and zoom, sending energy, moving ships, exploring
fog, explorer/terminal controls, and scoring/account safety. Guide components
live in `src/Frontend/Panes/BoothGuide`.

Mouse-related assisted actions demonstrate the gesture before performing it.
Energy assistance drags the actual local slider. The virtual cursor itself
never synthesizes DOM clicks. Manual and assisted sends share the same pending
energy calculation and transaction-event handler. Camera animations also share
one driver while preserving each exercise’s timing and interpolation. Sending
energy or ships calls the same game manager and transaction executor as manual
sending, using the current account.
The lesson advances after a valid local send request; proof generation and
transaction status continue in the background and failures remain in the log.

Zoom guidance gradually centers the view during its own exercises. Fog hints
stay inside the visible unexplored map, with clearance from explored chunks.
Terminal guidance follows the Edge/Bar setting; its icon also supports clicking.
The scoring step points at the top-left Score display. Clicking Score opens
Help at its Scoring section and hides that step's virtual cursor while the
player reads.
The guide automatically avoids open panels and the edge status/controls. When
space is tight it reduces its height and scrolls the contents internally; manual
dragging remains available.

The bottom-left toolbar includes an open-book **Player Guide** button with no
shortcut. It restarts the guide for the current account. The top-left status
area shows the current scoreboard rank; clicking it opens the full scoreboard,
with shared ranks for tied scores, current-player highlighting, and pagination.
Scores are read from the existing live indexer snapshot without extra RPCs or
transactions. The separate Score button still opens scoring help.

## Local checks

Use the project’s Node and pnpm versions, then start the client with `pnpm dev`.
Configure the existing `.env` and Connection settings for the intended network;
the tutorial entry does not override them.

Run the local regression suite from `client`:

```sh
node --import tsx --test tests/*.test.ts
```
