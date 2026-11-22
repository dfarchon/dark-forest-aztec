/** Contract assertions that a re-proof at the latest block time and state can clear. */
const STALE_PROOF_ERRORS = ["Timestamp too old", "hash mismatch"];

const MAX_DEPTH = 8;

/** Entire Noir files are attached for source maps and would flood the console. */
const SKIP_KEYS = new Set(["fileSource"]);

/**
 * Every string on a simulate() failure, labeled by where it sits on the object.
 * Walks message, cause, and any other own field, including non-enumerable ones.
 */
export function formatSimulationError(err: unknown): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();

  const push = (path: string, text: string) => {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const rendered = path ? `${path}: ${line}` : line;
      if (seen.has(rendered)) continue;
      seen.add(rendered);
      lines.push(rendered);
    }
  };

  const walk = (value: unknown, path: string, depth: number) => {
    if (value == null || depth > MAX_DEPTH) return;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      push(path, String(value));
      return;
    }
    if (typeof value !== "object") return;
    if (visited.has(value)) {
      push(path, "[circular]");
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(item, joinPath(path, `[${index}]`), depth + 1);
      });
      return;
    }

    const record = value as Record<string, unknown>;
    const site = functionSite(record);
    if (site) push(path, site);
    const source = sourceSite(record);
    if (source) push(path, source);

    if (value instanceof Error && value.name) {
      push(joinPath(path, "name"), value.name);
    }

    for (const key of Object.getOwnPropertyNames(value)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = readProperty(value, key);
      if (typeof child === "function" || child === undefined) continue;
      walk(child, joinPath(path, key), depth + 1);
    }
  };

  walk(err, "", 0);
  return lines.join("\n");
}

/** True when the full simulation text, including nested causes, is a stale proof. */
export function isStaleProofError(err: unknown): boolean {
  const text = typeof err === "string" ? err : formatSimulationError(err);
  return STALE_PROOF_ERRORS.some((needle) => text.includes(needle));
}

function joinPath(parent: string, key: string): string {
  if (!parent) return key;
  if (key.startsWith("[")) return `${parent}${key}`;
  return `${parent}.${key}`;
}

function functionSite(record: Record<string, unknown>): string {
  const contract =
    typeof record.contractName === "string" ? record.contractName : "";
  const fn = typeof record.functionName === "string" ? record.functionName : "";
  if (!contract && !fn) return "";
  if (contract && fn) return `at ${contract}.${fn}`;
  return `at ${contract || fn}`;
}

function sourceSite(record: Record<string, unknown>): string {
  const text =
    typeof record.locationText === "string" ? record.locationText : "";
  const file = typeof record.filePath === "string" ? record.filePath : "";
  if (!text && !file) return "";
  const line = typeof record.line === "number" ? String(record.line) : "";
  const column = typeof record.column === "number" ? String(record.column) : "";
  const place = [file, line, column].filter((part) => part !== "").join(":");
  const body = text || file;
  return place && text ? `at ${body} (${place})` : `at ${body}`;
}

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
