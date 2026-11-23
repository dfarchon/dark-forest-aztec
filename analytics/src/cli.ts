import path from "node:path";

import { blockTip, openDatabase } from "../sync/db.ts";
import {
  analyticsPackageRoot,
  contractsPackageRoot,
  loadConfig,
} from "../config/config.ts";
import { copyDeployments } from "../config/deployment.ts";
import { derivePending, rebuildActions } from "../sync/derive.ts";
import {
  formatOverview,
  formatPlayer,
  overviewReport,
  playerReport,
} from "../analysis/reports.ts";
import { createAztecChainSource } from "../sync/aztecSource.ts";
import { collectStatus, formatStatus } from "../sync/status.ts";
import { sync } from "../sync/sync.ts";
import {
  buildPlanetInitReport,
  writePlanetInitFiles,
} from "../analysis/planetInits.ts";
import {
  buildDashboardReport,
  dashboardJsonPath,
  writeDashboardReport,
} from "../analysis/dashboard.ts";

function usage(): string {
  return `Usage:
  pnpm --filter analytics import
  pnpm --filter analytics status
  pnpm --filter analytics sync
  pnpm --filter analytics derive
  pnpm --filter analytics derive:rebuild
  pnpm --filter analytics player <address>
  pnpm --filter analytics overview
  pnpm --filter analytics overview <from> <to>
  pnpm --filter analytics planets
  pnpm --filter analytics planets <seconds>
  pnpm --filter analytics dashboard
  pnpm --filter analytics dashboard <seconds>
  pnpm --filter analytics dashboard --out <path>`;
}

function parseDashboardArgs(args: string[]): {
  bucketSeconds: number;
  out?: string;
} {
  let bucketSeconds = 3600;
  let out: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--out") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(
          "[analytics] dashboard --out requires a path\n" + usage(),
        );
      }
      out = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("-")) {
      throw new Error(
        `[analytics] unknown dashboard argument ${arg}\n${usage()}`,
      );
    }
    if (arg !== undefined) positional.push(arg);
  }
  if (positional.length === 1) bucketSeconds = Number(positional[0]);
  else if (positional.length !== 0) {
    throw new Error(
      "[analytics] dashboard takes no arguments, <seconds>, or --out <path>\n" +
        usage(),
    );
  }
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) {
    throw new Error(
      "[analytics] dashboard <seconds> must be a positive integer",
    );
  }
  return { bucketSeconds, out: out ? resolveDashboardOut(out) : undefined };
}

function resolveDashboardOut(out: string): string {
  if (path.isAbsolute(out)) return out;
  const fromPackage = path.relative(analyticsPackageRoot(), process.cwd());
  const insidePackage =
    fromPackage === "" ||
    (!fromPackage.startsWith("..") && !path.isAbsolute(fromPackage));
  if (
    insidePackage &&
    (out === "analytics" ||
      out.startsWith(`analytics${path.sep}`) ||
      out.startsWith("analytics/"))
  ) {
    return path.resolve(analyticsPackageRoot(), "..", out);
  }
  return path.resolve(out);
}

function commandArgs(): string[] {
  return process.argv.slice(3).filter((arg) => arg !== "--");
}

function rejectArgs(args: string[], command: string): void {
  if (args.length === 0) return;
  throw new Error(`[analytics] ${command} does not take arguments\n${usage()}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command === "import") {
    rejectArgs(commandArgs(), "import");
    const networks = copyDeployments(
      contractsPackageRoot(),
      analyticsPackageRoot(),
    );
    console.log(
      `copied contracts/deployments to analytics/deployments (${networks} networks)`,
    );
    return;
  }
  const config = loadConfig();
  console.log(`network: ${config.network}`);
  console.log(`deployment: ${config.deploymentId}`);
  console.log(`database: ${config.dbPath}`);
  const db = openDatabase(config.dbPath);
  try {
    if (command === "status") {
      rejectArgs(commandArgs(), "status");
      console.log(`node: ${config.nodeUrl}`);
      const report = await collectStatus(
        db,
        createAztecChainSource(config.nodeUrl, config.addresses),
        config.startBlock,
      );
      console.log(formatStatus(report));
      return;
    }
    if (command === "sync") {
      rejectArgs(commandArgs(), "sync");
      console.log(`node: ${config.nodeUrl}`);
      await sync({
        db,
        source: createAztecChainSource(config.nodeUrl, config.addresses),
        startBlock: config.startBlock,
        log: (message) => console.log(message),
      });
      return;
    }
    if (command === "derive") {
      const rebuild = process.argv.includes("--rebuild");
      rejectArgs(
        commandArgs().filter((arg) => arg !== "--rebuild"),
        "derive",
      );
      const count = rebuild ? rebuildActions(db) : derivePending(db);
      console.log(`derived ${count} actions`);
      return;
    }
    if (command === "player") {
      const args = commandArgs();
      if (args.length !== 1 || args[0]?.startsWith("-")) {
        throw new Error("[analytics] player requires an address\n" + usage());
      }
      console.log(formatPlayer(playerReport(db, args[0])));
      return;
    }
    if (command === "overview") {
      const args = commandArgs();
      const tip = blockTip(db)?.number ?? config.startBlock;
      let blockFrom = config.startBlock;
      let blockTo = tip;
      if (args.length === 2) {
        blockFrom = Number(args[0]);
        blockTo = Number(args[1]);
      } else if (args.length !== 0) {
        throw new Error(
          "[analytics] overview takes no arguments, or <from> <to>\n" + usage(),
        );
      }
      if (!Number.isInteger(blockFrom) || !Number.isInteger(blockTo)) {
        throw new Error("[analytics] overview <from> <to> must be integers");
      }
      console.log(formatOverview(overviewReport(db, blockFrom, blockTo)));
      return;
    }
    if (command === "planets") {
      const args = commandArgs();
      let bucketSeconds = 3600;
      if (args.length === 1) bucketSeconds = Number(args[0]);
      else if (args.length !== 0) {
        throw new Error(
          "[analytics] planets takes no arguments, or <seconds>\n" + usage(),
        );
      }
      if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) {
        throw new Error(
          "[analytics] planets <seconds> must be a positive integer",
        );
      }
      const report = buildPlanetInitReport(db, bucketSeconds);
      const files = writePlanetInitFiles(config.dbPath, report);
      console.log(`planets: ${report.planetCount}`);
      console.log(
        `buckets: ${new Set(report.points.map((point) => point.bucket)).size}`,
      );
      console.log(`data: ${files.dataPath}`);
      console.log(`page: ${files.pagePath}`);
      return;
    }
    if (command === "dashboard") {
      const { bucketSeconds, out } = parseDashboardArgs(commandArgs());
      const report = buildDashboardReport(db, bucketSeconds);
      const outPath = out
        ? path.resolve(out)
        : dashboardJsonPath(config.dbPath);
      writeDashboardReport(outPath, report);
      console.log(`players: ${report.summary.players}`);
      console.log(`operations: ${report.summary.operations}`);
      console.log(`report: ${outPath}`);
      return;
    }
    throw new Error(`[analytics] unknown command ${command}\n${usage()}`);
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
