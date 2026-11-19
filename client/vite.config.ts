import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const require = createRequire(import.meta.url);

const NOIR_ARTIFACT_PREFIX = "\0noir-artifact:";

/** Pre-loads large Noir `/artifacts/*.json` files as single `JSON.parse(...)` modules so Rollup AST memory stays within standard Node heap limits. */
function compactNoirArtifactJson(): Plugin {
  return {
    name: "compact-noir-artifact-json",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.includes(".json")) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved || resolved.external) return null;
      const clean = resolved.id.replace(/\\/g, "/").split("?")[0];
      if (
        clean.endsWith("-metadata.json") ||
        !/\/artifacts\/[^/]+\.json$/.test(clean)
      ) {
        return null;
      }
      return {
        id: `${NOIR_ARTIFACT_PREFIX}${clean}.mjs`,
        moduleSideEffects: false,
      };
    },
    load(id) {
      if (!id.startsWith(NOIR_ARTIFACT_PREFIX) || !id.endsWith(".mjs"))
        return null;
      const filePath = id.slice(NOIR_ARTIFACT_PREFIX.length, -4);
      const minified = JSON.stringify(
        JSON.parse(readFileSync(filePath, "utf8"))
      );
      return {
        code: `export default /* #__PURE__ */ JSON.parse(${JSON.stringify(minified)});`,
        map: { mappings: "" },
      };
    },
  };
}

/**
 * sqlite3mc's loader resolves `sqlite3.wasm` and `sqlite3-opfs-async-proxy.js`
 * via dynamic paths relative to the emitted worker chunk. Vite hashes the wasm
 * and never emits the proxy script, so production requests 404 → SPA HTML.
 * Emit both under the fixed names the runtime expects.
 */
function emitSqliteRuntimeAssets(): Plugin {
  const opfsProxySource = readFileSync(
    require.resolve("@aztec-labs/sqlite3mc-wasm/vendor/jswasm/sqlite3-opfs-async-proxy.js"),
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
    compactNoirArtifactJson(),
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          const clean = id
            .replace(NOIR_ARTIFACT_PREFIX, "")
            .replace(/\.mjs$/, "")
            .replace(/\\/g, "/")
            .split("?")[0];
          if (clean.endsWith("-metadata.json")) return;
          const match = clean.match(/\/artifacts\/([^/]+)\.json$/);
          if (!match) return;
          if (clean.includes("/fog-sdk/")) {
            return `fog-artifact-${match[1]}`;
          }
          if (clean.includes("/packages/contracts/")) {
            return `df-artifact-${match[1]}`;
          }
          return `aztec-artifact-${match[1]}`;
        },
      },
    },
  },
  resolve: {
    dedupe: [
      "@aztec-labs/foundation",
      "@aztec-labs/stdlib",
      "@aztec-labs/constants",
    ],
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
    include: [
      "@aztec-labs/aztec.js/fields",
      "@aztec-labs/aztec.js/addresses",
      "@aztec-labs/aztec.js/abi",
      "@aztec-labs/aztec.js/contracts",
      "@aztec-labs/aztec.js/wallet",
      "@aztec-labs/foundation > sha3",
      "@aztec-labs/foundation > hash.js",
      "@aztec-labs/foundation > detect-node",
      "@aztec-labs/stdlib > lodash.chunk",
      "@aztec-labs/stdlib > lodash.times",
      "@aztec-labs/stdlib > json-stringify-deterministic",
      "ms",
      "@aztec-labs/accounts/schnorr/lazy",
      "@aztec-labs/accounts/schnorr/stub/lazy",
      "msgpackr/index-no-eval",
      "pino",
    ],
    exclude: [
      "@alejoamiras/presto",
      "@aztec-foundation/bb.js",
      "@aztec-foundation/noir-acvm_js",
      "@aztec-foundation/noir-noirc_abi",
      "@aztec-labs/foundation",
      "@aztec-labs/stdlib",
      "@aztec-labs/constants",
      "@aztec-labs/kv-store/sqlite-opfs",
    ],
  },
});
