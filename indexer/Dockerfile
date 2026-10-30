FROM node:24.22.1-slim AS base

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY indexer/package.json indexer/
COPY packages/contracts/package.json packages/contracts/
COPY packages/indexer-core/package.json packages/indexer-core/

# Install only the indexer and its workspace dependencies
RUN pnpm install --frozen-lockfile --filter indexer...

# Copy source code
COPY indexer/ indexer/
COPY contracts/ contracts/
COPY packages/contracts/ packages/contracts/
COPY packages/indexer-core/ packages/indexer-core/

# Normalize runtime artifacts inside the image build.
RUN node indexer/scripts/prepare-contract-artifacts.mjs

# Data directory for SQLite (mount a volume here)
RUN mkdir -p /data

EXPOSE 3001

ENV SQLITE_PATH=/data/indexer.db
ENV PORT=3001

CMD ["node", "--experimental-transform-types", "indexer/src/index.ts"]
