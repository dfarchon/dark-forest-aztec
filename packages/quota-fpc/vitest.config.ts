import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @aztec packages import .json artifacts without import attributes, which
    // native Node ESM rejects; routing them through Vite's transform handles it.
    server: { deps: { inline: [/@aztec/] } },
  },
});
