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

export default defineConfig(({ command }) => ({
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
    // Vite refuses requests whose Host header it does not recognise, which
    // blocks reaching a dev server through any tunnel or reverse proxy — and
    // the wallet REQUIRES a secure context (crypto.subtle, OPFS), so plain
    // http://<lan-ip> is not an option and a proxy is the only way to test on
    // another device. Supplied by env so no machine's hostname is baked into
    // the repository.
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    // Dev-only escape hatch for testing from an origin the hosted indexer's
    // CORS allowlist doesn't know (a tunnel, a LAN hostname): set
    // INDEXER_PROXY_TARGET to the indexer's URL and point
    // VITE_INDEXER_BOOTSTRAP_URL at <this-origin>/indexer-api instead. The
    // dev server forwards server-side, so the browser only ever talks to its
    // own origin and CORS never enters the picture. No effect when unset.
    // `serve` only: vite preview inherits server.proxy, and a preview build is
    // not a dev sandbox. Path must be exactly /indexer-api/… (a bare prefix
    // also matches /indexer-apiX), and any traversal segment is refused rather
    // than forwarded — a target with a base path could otherwise be escaped.
    proxy:
      command === "serve" && process.env.INDEXER_PROXY_TARGET
        ? {
            "^/indexer-api(/|$)": {
              target: process.env.INDEXER_PROXY_TARGET,
              changeOrigin: true,
              rewrite: (path: string) => {
                const rest = path.replace(/^\/indexer-api/, "");
                if (rest.split("/").includes("..")) return "/";
                return rest || "/";
              },
            },
          }
        : undefined,
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
}));
