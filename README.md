These violent delights have violent ends.

## Local development

**Default: Aztec v4 devnet.** The client defaults to `https://v4-devnet-2.aztec-labs.com`, so you can run the app without a local node:

```bash
pnpm --filter client dev
```

Open http://localhost:5173 and connect (e.g. play page). Set `VITE_PROVER_ENABLED=true` in `client/.env` for devnet (see `client/.env.example`).

**Optional: local sandbox.** For a full local stack (Anvil + Aztec node on port 8080 + indexer):

```bash
# Terminal 1: start backend (requires Aztec CLI + Node 24)
pnpm --filter server run e2e:runtime
# Terminal 2: client pointed at local node
VITE_AZTEC_NODE_URL=http://localhost:8080 pnpm --filter client dev
```

Or set the node URL in the in-app connection settings. See `server/README.md` and `client/.env.example`.
