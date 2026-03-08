FROM node:24.12.0-slim AS base

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json server/
COPY packages/contracts/package.json packages/contracts/
COPY packages/indexer-server-core/package.json packages/indexer-server-core/

# Install only server and its workspace dependencies
RUN pnpm install --frozen-lockfile --filter server...

# Copy source code
COPY server/ server/
COPY packages/contracts/ packages/contracts/
COPY packages/indexer-server-core/ packages/indexer-server-core/

# Data directory for SQLite (mount a volume here)
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3001

ENV SQLITE_PATH=/data/indexer.db
ENV PORT=3001

CMD ["node", "--experimental-transform-types", "server/src/index.ts"]
