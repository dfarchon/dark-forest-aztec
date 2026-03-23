import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(".");
const scriptPath = path.join(repoRoot, "server/scripts/build-server-image.sh");
const publishScriptPath = path.join(
  repoRoot,
  "server/scripts/publish-devnet-image.sh",
);

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o755 });
}

function runBuildScript(env = {}) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-build-image-bin-"));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-build-image-log-"));
  const nodeLog = path.join(logDir, "node.log");
  const dockerLog = path.join(logDir, "docker.log");

  writeExecutable(
    path.join(binDir, "node"),
    `#!/usr/bin/env bash
printf '%s\n' "$@" > "${nodeLog}"
exit 0
`,
  );

  writeExecutable(
    path.join(binDir, "docker"),
    `#!/usr/bin/env bash
printf '%s\n' "$@" > "${dockerLog}"
exit 0
`,
  );

  const result = spawnSync("bash", [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      ...env,
    },
    encoding: "utf8",
  });

  return {
    result,
    nodeArgs: fs.readFileSync(nodeLog, "utf8").trim().split("\n"),
    dockerArgs: fs.readFileSync(dockerLog, "utf8").trim().split("\n"),
  };
}

function runPublishScript(env = {}) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-publish-image-bin-"));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "dfpunk-publish-image-log-"));
  const bashLog = path.join(logDir, "bash.log");

  writeExecutable(
    path.join(binDir, "bash"),
    `#!/bin/bash
{
  printf 'IMAGE_REPO=%s\n' "$IMAGE_REPO"
  printf 'IMAGE_TAG=%s\n' "$IMAGE_TAG"
  printf 'IMAGE_PUSH=%s\n' "$IMAGE_PUSH"
  printf 'ARGS=%s\n' "$*"
} > "${bashLog}"
exit 0
`,
  );

  const result = spawnSync("/bin/bash", [publishScriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      ...env,
    },
    encoding: "utf8",
  });

  return {
    result,
    log: fs.readFileSync(bashLog, "utf8"),
  };
}

test("build script prepares artifacts and builds linux/amd64 image with --load by default", () => {
  const { result, nodeArgs, dockerArgs } = runBuildScript();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    nodeArgs[0],
    path.join(repoRoot, "server/scripts/prepare-contract-artifacts.mjs"),
  );
  assert.equal(nodeArgs[1], "--build-if-missing");
  assert.equal(dockerArgs[0], "buildx");
  assert.equal(dockerArgs[1], "build");
  assert.ok(dockerArgs.includes("--load"));
  assert.ok(dockerArgs.includes("--platform"));
  assert.ok(dockerArgs.includes("linux/amd64"));
  assert.ok(dockerArgs.includes("dfpunk-indexer-server:dev"));
});

test("build script pushes when IMAGE_PUSH=1", () => {
  const { result, dockerArgs } = runBuildScript({
    IMAGE_PUSH: "1",
    IMAGE_REPO: "ghcr.io/0xpabloli/dfpunk-aztec-server",
    IMAGE_TAG: "testnet",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(dockerArgs.includes("--push"));
  assert.ok(!dockerArgs.includes("--load"));
  assert.ok(dockerArgs.includes("ghcr.io/0xpabloli/dfpunk-aztec-server:testnet"));
});

test("publish helper defaults to the testnet GHCR release configuration", () => {
  const { result, log } = runPublishScript();

  assert.equal(result.status, 0, result.stderr);
  assert.match(log, /IMAGE_REPO=ghcr\.io\/0xpabloli\/dfpunk-aztec-server/);
  assert.match(log, /IMAGE_TAG=testnet/);
  assert.match(log, /IMAGE_PUSH=1/);
  assert.match(log, /ARGS=.*server\/scripts\/build-server-image\.sh/);
});
