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
        "tty",
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
    include: [
      "@aztec/aztec.js/fields",
      "@aztec/aztec.js/addresses",
      "@aztec/aztec.js/abi",
      "@aztec/aztec.js/contracts",
      "@aztec/aztec.js/wallet",
      "@aztec/foundation/crypto/poseidon",
      "@aztec/accounts/ecdsa/lazy",
      "@aztec/accounts/ecdsa/stub/lazy",
      "@aztec/accounts/schnorr/lazy",
      "@aztec/accounts/schnorr/stub/lazy",
      "@aztec/standard-contracts/multi-call-entrypoint/lazy",
      "msgpackr/index-no-eval",
      "pino",
    ],
    exclude: [
      "@aztec/bb.js",
      "@aztec/noir-acvm_js",
      "@aztec/noir-noirc_abi",
      "@aztec/kv-store/sqlite-opfs",
    ],
  },
});
