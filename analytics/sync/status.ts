import type Database from "better-sqlite3";

import {
  actionsMaxBlock,
  blockTip,
  derivedThrough,
  eventsAtBlock,
  inspectIntegrity,
} from "./db.ts";
import { sameHash, type ChainSource } from "./model.ts";

export interface StatusReport {
  startBlock: number;
  localBlock: number | null;
  localHash: string | null;
  eventsAtTip: number;
  provenTip: number;
  provenHash: string | null;
  behind: number;
  proposedTip: number;
  continuity: "empty" | "ok" | "reorg" | "unknown";
  contiguous: boolean;
  holes: string[];
  eventsOutside: number;
  derivedThrough: number | null;
  actionsMaxBlock: number | null;
}

export async function collectStatus(
  db: Database.Database,
  source: ChainSource,
  startBlock: number,
): Promise<StatusReport> {
  const local = blockTip(db);
  const provenTip = await source.provenTip();
  const proposedTip = await source.proposedTip();
  const provenHeader = await source.block(provenTip);
  const integrity = inspectIntegrity(db, startBlock);
  let continuity: StatusReport["continuity"] = "empty";
  if (local) {
    const remote = await source.block(local.number);
    if (!remote) continuity = "unknown";
    else continuity = sameHash(remote.hash, local.hash) ? "ok" : "reorg";
  }
  const localBlock = local?.number ?? null;
  const behind =
    localBlock == null
      ? Math.max(0, provenTip - (startBlock - 1))
      : Math.max(0, provenTip - localBlock);
  return {
    startBlock,
    localBlock,
    localHash: local?.hash ?? null,
    eventsAtTip: localBlock == null ? 0 : eventsAtBlock(db, localBlock),
    provenTip,
    provenHash: provenHeader?.hash ?? null,
    behind,
    proposedTip,
    continuity,
    contiguous: integrity.contiguous,
    holes: integrity.holes,
    eventsOutside: integrity.eventsOutside,
    derivedThrough: derivedThrough(db),
    actionsMaxBlock: actionsMaxBlock(db),
  };
}

export function formatStatus(report: StatusReport): string {
  const lines = [
    `start block: ${report.startBlock}`,
    `local block: ${report.localBlock ?? "none"}`,
    `local hash: ${report.localHash ?? "none"}`,
    `events at local tip: ${report.eventsAtTip}`,
    `proven tip: ${report.provenTip}`,
    `proven hash: ${report.provenHash ?? "unavailable"}`,
    `behind: ${report.behind}`,
    `proposed tip: ${report.proposedTip} (not synced)`,
    `continuity: ${report.continuity}`,
    `blocks: ${report.contiguous ? "contiguous" : `gaps ${report.holes.join(", ")}`}`,
  ];
  if (report.eventsOutside > 0) {
    lines.push(`events outside synced blocks: ${report.eventsOutside}`);
  }
  lines.push(`derived through: ${report.derivedThrough ?? "none"}`);
  lines.push(`actions max block: ${report.actionsMaxBlock ?? "none"}`);
  if (
    report.localBlock != null &&
    report.derivedThrough !== report.localBlock
  ) {
    lines.push("actions are behind local blocks; run derive");
  }
  return lines.join("\n");
}
