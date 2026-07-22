import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const require = createRequire(import.meta.url);

/**
 * sqlite3mc's loader resolves `sqlite3.wasm` and `sqlite3-opfs-async-proxy.js`
 * via dynamic paths relative to the emitted worker chunk. Vite hashes the wasm
 * and never emits the proxy script, so production requests 404 → SPA HTML.
 * Emit both under the fixed names the runtime expects.
 */
function emitSqliteRuntimeAssets(): Plugin {
  const opfsProxySource = readFileSync(
    require.resolve("@aztec/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js"),
    "utf8"
  );

  return {
    name: "emit-sqlite-runtime-assets",
    generateBundle(_options, bundle) {
      const sqliteWasm = Object.values(bundle).find(
        (output) =>
          output.type === "asset" &&
          /^assets\/sqlite3-.*\.wasm$/.test(output.fileName)
      );

      if (sqliteWasm?.type === "asset") {
        this.emitFile({
          type: "asset",
          fileName: "assets/sqlite3.wasm",
          source: sqliteWasm.source,
        });
      }

      this.emitFile({
        type: "asset",
        fileName: "assets/sqlite3-opfs-async-proxy.js",
        source: opfsProxySource,
      });
    },
  };
}

export default defineConfig({
  worker: {
    format: "es",
  },
  plugins: [
    emitSqliteRuntimeAssets(),
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
