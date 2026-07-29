import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Proving on a sandbox is slow; these are integration spikes, not unit tests.
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // One sandbox, shared state (nullifiers!) — never run files in parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ["verbose"],
    // @aztec packages import .json artifacts without import attributes, which
    // native Node ESM rejects; routing them through Vite's transform handles it.
    server: { deps: { inline: [/@aztec/] } },
  },
});
