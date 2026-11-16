/**
 * Runs after the root `pnpm install --frozen-lockfile` (package.json postinstall).
 * Clones missing tools at the commits in tools/vendor-pins.json, copies
 * overlays, then installs each tree from its own lockfile with --frozen-lockfile.
 *
 * Anvil, the Aztec CLI, and MongoDB are host binaries, not npm packages.
 * Otterscan, Presto, and Aztec Explorer are cloned via tools/vendor-pins.json.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.DFPUNK_SKIP_NESTED_INSTALL === "1") {
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const vendor = spawnSync("bash", ["scripts/dev/ensure-vendor-clones.sh"], {
  cwd: root,
  stdio: "inherit",
});
if (vendor.status !== 0) {
  process.exit(vendor.status ?? 1);
}

/**
 * Keep Otterscan engines.node / .nvmrc aligned with the tracked overlay pin.
 * Prefer tools/overlays/otherscan/.nvmrc; fall back to tooling/TOOLCHAIN.pins
 * if present (optional local pin file).
 */
function syncOtherscanNodePin() {
  let nodeVersion;
  const overlayNvmrc = join(root, "tools/overlays/otherscan/.nvmrc");
  const toolchainPins = join(root, "tooling/TOOLCHAIN.pins");

  if (existsSync(overlayNvmrc)) {
    nodeVersion = readFileSync(overlayNvmrc, "utf8").trim();
  } else if (existsSync(toolchainPins)) {
    const pins = Object.fromEntries(
      readFileSync(toolchainPins, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const i = line.indexOf("=");
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    );
    nodeVersion = pins.NODE_VERSION;
  }

  if (!nodeVersion) {
    console.log(
      "[install-nested] skip otherscan node pin sync (no overlay .nvmrc / TOOLCHAIN.pins)",
    );
    return;
  }

  const otherscanDir = join(root, "tools/otherscan");
  const pkgPath = join(otherscanDir, "package.json");
  if (!existsSync(pkgPath)) {
    return;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.engines = { ...(pkg.engines ?? {}), node: nodeVersion };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(otherscanDir, ".nvmrc"), `${nodeVersion}\n`);
  console.log(`[install-nested] tools/otherscan: engines.node=${nodeVersion}`);
}

syncOtherscanNodePin();

function run(job) {
  console.log(`[install-nested] ${job.label}: ${job.command} ${job.args.join(" ")}`);
  const result = spawnSync(job.command, job.args, {
    cwd: job.cwd,
    stdio: "inherit",
    env: { ...process.env, DFPUNK_SKIP_NESTED_INSTALL: "1" },
  });
  if (result.error) {
    const missing = result.error.code === "ENOENT";
    if (job.optionalCommand && missing) {
      console.log(
        `[install-nested] skip ${job.label}: ${job.command} is not on PATH. The local stack does not need it.`,
      );
      return;
    }
    console.error(
      `[install-nested] ${job.label}: cannot run ${job.command} (${result.error.message})`,
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const jobs = [
  {
    label: "tools/otherscan",
    cwd: join(root, "tools/otherscan"),
    lock: "pnpm-lock.yaml",
    command: "pnpm",
    args: ["install", "--frozen-lockfile"],
  },
  {
    label: "tools/aztec-explorer/frontend",
    cwd: join(root, "tools/aztec-explorer/frontend"),
    lock: "yarn.lock",
    command: "yarn",
    args: ["install", "--frozen-lockfile"],
  },
  {
    label: "tools/presto",
    cwd: join(root, "tools/presto"),
    lock: "bun.lock",
    command: "bun",
    args: ["install", "--frozen-lockfile"],
    // Local mprocs runs the Rust presto-server binary. Bun is only for this
    // vendored JS workspace. A missing bun must not fail the root install.
    optionalCommand: true,
    optional: true,
  },
];

for (const job of jobs) {
  const lockPath = join(job.cwd, job.lock);
  if (!existsSync(lockPath)) {
    if (job.optional) {
      console.log(`[install-nested] skip ${job.label} (not cloned yet)`);
      continue;
    }
    console.error(`[install-nested] missing lockfile ${lockPath}`);
    process.exit(1);
  }
  run(job);
}
