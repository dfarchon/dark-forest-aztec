#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.DFPUNK_REPO_ROOT ?? path.resolve(__dirname, "../..");
const packagesArtifactsDir = path.join(
  repoRoot,
  "packages",
  "contracts",
  "src",
  "artifacts",
);
const scriptsArtifactsDir = path.join(
  repoRoot,
  "contracts",
  "scripts",
  "artifacts",
);
const requiredArtifacts = [
  "WorldStorage.ts",
  "world-WorldStorage.json",
  "PlayerStorage.ts",
  "player-PlayerStorage.json",
];
const shouldBuildIfMissing = process.argv.includes("--build-if-missing");

function hasRequiredArtifacts(dir) {
  return requiredArtifacts.every((file) =>
    fs.existsSync(path.join(dir, file)),
  );
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function syncArtifacts() {
  if (!hasRequiredArtifacts(scriptsArtifactsDir)) {
    throw new Error(
      `Source artifacts are missing required files in ${scriptsArtifactsDir}`,
    );
  }

  fs.rmSync(packagesArtifactsDir, { recursive: true, force: true });
  ensureParentDir(path.join(packagesArtifactsDir, ".keep"));
  fs.cpSync(scriptsArtifactsDir, packagesArtifactsDir, { recursive: true });

  console.log(
    `[prepare-contract-artifacts] synced contracts/scripts/artifacts -> packages/contracts/src/artifacts`,
  );
}

function runBuildContracts() {
  const customCommand = process.env.DFPUNK_PREPARE_BUILD_COMMAND;
  const result = customCommand
    ? spawnSync(customCommand, {
        cwd: repoRoot,
        stdio: "inherit",
        shell: true,
      })
    : spawnSync("pnpm", ["--dir", "contracts", "build-contracts"], {
        cwd: repoRoot,
        stdio: "inherit",
      });

  if (result.status !== 0) {
    throw new Error(
      customCommand
        ? `Custom build command failed: ${customCommand}`
        : "pnpm --dir contracts build-contracts failed",
    );
  }
}

function main() {
  if (hasRequiredArtifacts(packagesArtifactsDir)) {
    console.log(
      `[prepare-contract-artifacts] using existing ${packagesArtifactsDir}`,
    );
    return;
  }

  if (hasRequiredArtifacts(scriptsArtifactsDir)) {
    syncArtifacts();
    return;
  }

  if (!shouldBuildIfMissing) {
    throw new Error(
      "Contract artifacts are missing from both packages/contracts/src/artifacts and contracts/scripts/artifacts.",
    );
  }

  console.log(
    "[prepare-contract-artifacts] artifacts missing; running contracts build-contracts",
  );
  runBuildContracts();

  if (!hasRequiredArtifacts(scriptsArtifactsDir)) {
    throw new Error(
      `Contracts build completed but ${scriptsArtifactsDir} is still missing required artifacts`,
    );
  }

  syncArtifacts();
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[prepare-contract-artifacts] ${message}`);
  process.exit(1);
}
