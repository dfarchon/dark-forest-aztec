# Contributing

Dark Forest Aztec is a TypeScript + Aztec Noir monorepo. This guide is short on purpose: it should help contributors and AI coding agents get oriented quickly, make scoped changes, and verify them before opening a PR.

## Environment

Required versions:

- Node.js `24.12.0`
- pnpm `10.28.0`

## Repository Map

- `client/` - React + Vite game client.
- `contracts/` - Aztec Noir contracts and deployment/configuration scripts.
- `server/` - off-chain indexer server with SQLite persistence and snapshot APIs.
- `packages/` - shared `@dfpunk/*` packages used across the client, contracts scripts, and server.
- `docs/` - project-level setup, architecture, and developer guides.

## Working Style

- Keep changes close to the layer you are modifying: client, contracts, server, or shared package.
- Prefer existing helpers and package boundaries over adding new abstractions.
- If a shared type or helper already exists under `packages/`, use it instead of redefining it locally.
- Treat Aztec state and hash conversions carefully. Avoid using `number`for values that can exceed JavaScript's safe integer range.
- Update docs when behavior, setup, environment variables, or public APIs change.

## AI-Assisted Development

When asking an AI tool to work in this repo, include:

- the target module path, such as `client/src/Session/Indexer/` or`contracts/system/move/`;
- the intended behavior change;
- the verification command it should run;
- links to the nearest README or docs page.

Good starting prompt:

```text
Read docs/developer-guide.md first. Then update only the client indexer code under client/src/Session/Indexer to support <feature>. 
Keep the EthConnection-compatible API intact and run the relevant format/check command.
```

## Pull Request Checklist

Before opening a PR:

- The change is scoped to the smallest practical module boundary.
- New or changed commands are documented.
- Markdown links point to existing files.
- Formatting or lint checks were run for the changed area.
- Generated contract artifacts are included only when the contract build or
  deployment output intentionally changed.

Commits should follow Conventional Commits. Commit hooks run through Husky and lint-staged.
