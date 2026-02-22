import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  worker: {
    format: "es",
  },
  plugins: [
    react(),
    nodePolyfills({
      include: [
        "buffer",
        "crypto",
        "util",
        "stream",
        "process",
        "events",
        "path",
        "string_decoder",
        "vm",
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
    exclude: ["@aztec/bb.js", "@aztec/noir-acvm_js", "@aztec/noir-noirc_abi"],
  },
});
