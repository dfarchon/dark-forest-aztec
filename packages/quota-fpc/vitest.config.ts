import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests are fast; the integration suite proves transactions against a
    // live network, where deploying and bridging take tens of seconds.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Integration tests share one chain and emit real nullifiers — order and
    // isolation matter, so never run them concurrently.
    fileParallelism: false,
    sequence: { concurrent: false },
    // @aztec packages import .json artifacts without import attributes, which
    // native Node ESM rejects; routing them through Vite's transform handles it.
    server: { deps: { inline: [/@aztec/] } },
  },
});
