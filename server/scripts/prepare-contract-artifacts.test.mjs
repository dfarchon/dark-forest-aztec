import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const scriptPath = path.resolve("server/scripts/prepare-contract-artifacts.mjs");

function writeFile(filePath, content = "export const ok = true;\n") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function repoFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-contract-artifacts-"));
}

function runScript(repoRoot, args = [], env = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      ...env,
      DFPUNK_REPO_ROOT: repoRoot,
    },
    encoding: "utf8",
  });
}

test("copies contracts/scripts/artifacts when package artifacts are missing", () => {
  const root = repoFixture();
  writeFile(
    path.join(root, "contracts/scripts/artifacts/WorldStorage.ts"),
    "export const WorldStorageContract = {};\n",
  );
  writeFile(
    path.join(root, "contracts/scripts/artifacts/world-WorldStorage.json"),
    "{}\n",
  );
  writeFile(
    path.join(root, "contracts/scripts/artifacts/PlayerStorage.ts"),
    "export const PlayerStorageContract = {};\n",
  );
  writeFile(
    path.join(root, "contracts/scripts/artifacts/player-PlayerStorage.json"),
    "{}\n",
  );

  const result = runScript(root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.existsSync(
      path.join(root, "packages/contracts/src/artifacts/WorldStorage.ts"),
    ),
    true,
  );
});

test("keeps existing package artifacts without requiring scripts artifacts", () => {
  const root = repoFixture();
  writeFile(
    path.join(root, "packages/contracts/src/artifacts/WorldStorage.ts"),
    "export const WorldStorageContract = { existing: true };\n",
  );
  writeFile(
    path.join(root, "packages/contracts/src/artifacts/world-WorldStorage.json"),
    "{}\n",
  );
  writeFile(
    path.join(root, "packages/contracts/src/artifacts/PlayerStorage.ts"),
    "export const PlayerStorageContract = { existing: true };\n",
  );
  writeFile(
    path.join(root, "packages/contracts/src/artifacts/player-PlayerStorage.json"),
    "{}\n",
  );

  const result = runScript(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /using existing/);
});

test("fails clearly when neither source nor package artifacts exist", () => {
  const root = repoFixture();
  const result = runScript(root);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing from both/);
});
