# Developer Guide

This guide is for developers and AI coding agents extending Dark Forest Aztec. It explains where to start, which files own which responsibilities, and how to make changes without crossing module boundaries unnecessarily.

## Read This First

Recommended order:

1. [README.md](../README.md) for positioning and quickstart.
2. [docs/architecture.md](architecture.md) for system data flow.
3. The nearest module README for the area you are changing.

Useful module docs:

- [server/README.md](../server/README.md)
- [client/src/Session/Indexer/README.md](../client/src/Session/Indexer/README.md)
- [docs/external-wallet.md](external-wallet.md)

## Module Boundaries

### Client

Path: `client/`

The client owns the browser experience: React UI, game window layout, local session state, rendering, wallet connection, and the client-side indexer.

Good client tasks:

- add or adjust panes, onboarding, settings, or gameplay UI;
- update game-state read paths in `client/src/Session/Indexer/`;
- improve wallet connection and local persistence flows;
- integrate new shared types or contract artifacts.

Avoid putting server-only persistence or contract deployment logic in the client. If a helper needs to be shared, consider whether it belongs under `packages/`.

### Contracts

Path: `contracts/`

Contracts are written in Noir and organized into storage and system layers. Storage contracts keep entity state hashes and public update events. System contracts implement game actions such as initialization, movement, and admin configuration.

Good contract tasks:

- change storage schema or event structure;
- update movement, scoring, or admin logic;
- regenerate TypeScript bindings after contract changes;
- update deploy/configure scripts when contract addresses or initialization flows change.

Contract scripts load environment variables through `contracts/scripts/utils/env.ts`. Prefer those helpers over reading `process.env` directly in new deploy/config scripts.

### Server

Path: `server/`

The server indexes public Aztec storage updates, persists snapshots to SQLite, and exposes snapshot/block/health APIs to clients.

Good server tasks:

- add or optimize snapshot endpoints;
- improve SQLite persistence, chunking, or restore behavior;
- update indexer service configuration;
- add operational docs for deployment.

Keep browser-only assumptions out of the server. The server should use contract metadata and public events, not client UI state.

### Shared Packages

Path: `packages/`

Shared packages contain types, constants, hashing, serialization, rendering, events, game logic, and utility code. They should stay small and explicit.

Use a shared package when:

- multiple top-level apps need the same type or helper;
- a renderer or game-logic helper is independent from React panes;
- a contract script and the client need the same conversion or validation.

Do not add a package just to hide one local helper. Start local, extract only when there is real reuse or a clear existing package home.

## Common Change Recipes

### Add A Client Feature

1. Locate the pane/view under `client/src/Frontend/`.
2. Check whether data already exists in the UI manager or indexer connection.
3. Reuse shared labels, buttons, and text components from existing panes.
4. Run `cd client && pnpm build` or the narrowest relevant check.

### Change Indexed State

1. Update the contract event or storage output first.
2. Regenerate contract artifacts and bindings.
3. Update table conversion in the client/server indexer layer.
4. Update snapshot compatibility docs or checks if the serialized shape changes.
5. Run the relevant contract and server tests.

### Add A Contract Action

1. Decide whether the behavior belongs in a system contract or storage contract.
2. Keep state-hash verification explicit.
3. Update scripts and generated artifacts.
4. Update client transaction construction and simulation handling.
5. Document new environment variables or operator steps.

### Update Explorer-Facing Rules

1. Update the actual game logic or config first.
2. Update the Help pane text in `client/src/Frontend/Panes/HelpPane.tsx`.
3. Update `docs/architecture.md` or the root `README.md` if the one-line public pitch should change.
4. Prefer dynamic values from onchain config in UI when possible.

## AI Agent Guidance

Give AI tools a narrow target and ask them to read local context first. Useful instructions:

- "Read this guide before editing."
- "Only edit files under `<target path>` unless a shared type requires a small package update."
- "Use existing components/helpers before introducing new abstractions."
- "After editing, run the nearest format/check command and report failures."

For architecture or setup changes, ask the agent to update documentation in the same PR. For gameplay or scoring changes, ask it to update the in-game Help pane and any user-facing docs if explorer-facing behavior changed.
