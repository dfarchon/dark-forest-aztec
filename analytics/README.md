# Analytics

The page does not read the database. Sync proven blocks into SQLite, then export `report.json`. The page only fetches `/report.json`.

Run commands from the repo root. Node `24.22.1` and pnpm `10.28.0`.

## Setup

`analytics/.env` and `analytics/networks/*.env` are not committed.

1. Copy `.env.example` to `.env` and set `AZTEC_NETWORK` to `local`, `testnet`, or `mainnet`.
2. Copy `networks/<network>.env.example` to `networks/<network>.env` and set `AZTEC_NODE_URL`. Do not copy `contracts/networks`; those files contain account keys.
3. Import the current universe:

```bash
pnpm --filter analytics import
```

This copies `contracts/deployments` to `analytics/deployments`. The default universe is `deployments/<network>/latest`. Re-run `import` only when the universe changes, or set `DEPLOYMENT_ID` in the network env.

The database defaults to `analytics/data/<network>/<deployment-id>/events.db` and is gitignored.

## Update

```bash
pnpm --filter analytics status
pnpm --filter analytics sync
pnpm --filter analytics report
```

`status` shows the local tip, the proven tip, how far behind the database is, and whether the local tip hash still matches the node.

`sync` pulls proven blocks only, in batches of 100, and derives any pending actions. When caught up it prints `local block … matches proven tip …`.

`report` writes `analytics/web/public/report.json` with a 3600-second bucket. For another bucket or path, use `dashboard`, for example `dashboard 86400` or `dashboard --out <path>`.

Preview locally:

```bash
pnpm --filter analytics-web dev
```

## Extra commands

- `pnpm --filter analytics derive` — fill in actions when `status` says `actions are behind local blocks`. A normal `sync` already does this.
- `pnpm --filter analytics derive:rebuild` — delete `actions` and derive them again from every stored block.

If the node cannot return the local tip hash, `sync` stops without writing. Run it again later. On a reorg it rewinds to the last matching hash and pulls those blocks again.
