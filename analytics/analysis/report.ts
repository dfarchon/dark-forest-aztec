/**
 * JSON contract for the activity page. This file has no Node or browser
 * dependencies so both the CLI and the Vite app can share it.
 */

export const DASHBOARD_REPORT_VERSION = 1;

const MAX_BUCKETS = 20_000;

const PREFERRED_ACTIONS = [
  "move",
  "upgrade_planet",
  "withdraw_silver",
  "find_artifact",
  "prospect_planet",
  "deposit_artifact",
  "activate_artifact",
  "initialize_player",
  "give_spaceships",
  "deactivate_artifact",
  "withdraw_artifact",
  "reveal_location",
];

export interface PlanetInitPoint {
  bucket: number;
  planetLevel: number;
  initialized: number;
  cumulative: number;
}

export interface ActionInput {
  timestamp: number;
  player: string;
  action: string;
  quantity: string | null;
}

export interface ArrivalInput {
  timestamp: number;
  arrivalType: number;
  silver: string;
}

export interface ArtifactInput {
  artifactType: number;
  rarity: number;
}

export interface DashboardInput {
  actions: ActionInput[];
  arrivals: ArrivalInput[];
  artifacts: ArtifactInput[];
  planetCount: number;
  planetInits: PlanetInitPoint[];
  bucketSeconds: number;
  generatedAt?: number;
}

export interface HourlyActivity {
  bucket: number;
  actions: Record<string, number>;
  activePlayers: number;
  silverMoved: string;
  silverWithdrawn: string;
}

export interface PlayerSummary {
  player: string;
  operations: number;
  kinds: number;
}

export interface VoyageCounts {
  normal: number;
  photoid: number;
  wormhole: number;
}

export interface ArtifactCount {
  artifactType: number;
  rarity: number;
  count: number;
}

export interface DashboardSummary {
  players: number;
  operations: number;
  planets: number;
  voyages: number;
  silverMoved: string;
  silverWithdrawn: string;
  from: number | null;
  to: number | null;
}

export interface DashboardReport {
  version: typeof DASHBOARD_REPORT_VERSION;
  generatedAt: number;
  bucketSeconds: number;
  summary: DashboardSummary;
  actions: string[];
  hourly: HourlyActivity[];
  players: PlayerSummary[];
  voyages: VoyageCounts;
  artifacts: ArtifactCount[];
  planetCount: number;
  planetInits: PlanetInitPoint[];
}

interface BucketState {
  actions: Map<string, number>;
  players: Set<string>;
  silverMoved: bigint;
  silverWithdrawn: bigint;
}

function assertBucket(bucketSeconds: number): void {
  if (!Number.isInteger(bucketSeconds) || bucketSeconds <= 0) {
    throw new Error(
      "[analytics] dashboard bucket size must be a positive integer",
    );
  }
}

function parseSilver(value: string | null | undefined): bigint {
  if (value == null || value === "") return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function timed(timestamp: number): boolean {
  return Number.isFinite(timestamp) && timestamp > 0;
}

export function orderedActions(names: Iterable<string>): string[] {
  const present = new Set(names);
  const preferred = new Set(PREFERRED_ACTIONS);
  const ordered = PREFERRED_ACTIONS.filter((name) => present.has(name));
  const rest = [...present]
    .filter((name) => !preferred.has(name))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...rest];
}

function emptyBucket(): BucketState {
  return {
    actions: new Map(),
    players: new Set(),
    silverMoved: 0n,
    silverWithdrawn: 0n,
  };
}

function fillHours(
  states: Map<number, BucketState>,
  names: string[],
  bucketSeconds: number,
): HourlyActivity[] {
  if (states.size === 0) return [];
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const bucket of states.keys()) {
    if (bucket < min) min = bucket;
    if (bucket > max) max = bucket;
  }
  const steps = (max - min) / bucketSeconds + 1;
  if (!Number.isFinite(steps) || steps > MAX_BUCKETS) {
    throw new Error(
      "[analytics] dashboard bucket size produces too many buckets",
    );
  }
  const hourly: HourlyActivity[] = [];
  for (let bucket = min; bucket <= max; bucket += bucketSeconds) {
    const state = states.get(bucket);
    const actions: Record<string, number> = {};
    for (const name of names) actions[name] = state?.actions.get(name) ?? 0;
    hourly.push({
      bucket,
      actions,
      activePlayers: state?.players.size ?? 0,
      silverMoved: (state?.silverMoved ?? 0n).toString(),
      silverWithdrawn: (state?.silverWithdrawn ?? 0n).toString(),
    });
  }
  return hourly;
}

export function aggregateDashboard(input: DashboardInput): DashboardReport {
  assertBucket(input.bucketSeconds);
  const bucketSeconds = input.bucketSeconds;
  const states = new Map<number, BucketState>();
  const ensure = (timestamp: number): BucketState => {
    const bucket = Math.floor(timestamp / bucketSeconds) * bucketSeconds;
    const existing = states.get(bucket);
    if (existing) return existing;
    const created = emptyBucket();
    states.set(bucket, created);
    return created;
  };

  const seen = new Set<string>();
  const playerOps = new Map<
    string,
    { operations: number; kinds: Set<string> }
  >();
  let operations = 0;
  let silverWithdrawn = 0n;
  let from: number | null = null;
  let to: number | null = null;
  const noteTime = (timestamp: number): void => {
    if (from == null || timestamp < from) from = timestamp;
    if (to == null || timestamp > to) to = timestamp;
  };

  for (const action of input.actions) {
    if (!timed(action.timestamp)) continue;
    operations += 1;
    noteTime(action.timestamp);
    seen.add(action.action);
    const state = ensure(action.timestamp);
    state.actions.set(
      action.action,
      (state.actions.get(action.action) ?? 0) + 1,
    );
    state.players.add(action.player);
    const stats = playerOps.get(action.player) ?? {
      operations: 0,
      kinds: new Set<string>(),
    };
    stats.operations += 1;
    stats.kinds.add(action.action);
    playerOps.set(action.player, stats);
    if (action.action === "withdraw_silver") {
      const amount = parseSilver(action.quantity);
      silverWithdrawn += amount;
      state.silverWithdrawn += amount;
    }
  }

  const voyages: VoyageCounts = { normal: 0, photoid: 0, wormhole: 0 };
  let voyageTotal = 0;
  let silverMoved = 0n;
  for (const arrival of input.arrivals) {
    voyageTotal += 1;
    if (arrival.arrivalType === 1) voyages.normal += 1;
    else if (arrival.arrivalType === 2) voyages.photoid += 1;
    else if (arrival.arrivalType === 3) voyages.wormhole += 1;
    const amount = parseSilver(arrival.silver);
    silverMoved += amount;
    if (!timed(arrival.timestamp)) continue;
    noteTime(arrival.timestamp);
    ensure(arrival.timestamp).silverMoved += amount;
  }

  for (const point of input.planetInits) {
    if (timed(point.bucket)) noteTime(point.bucket);
  }

  const artifactCounts = new Map<string, ArtifactCount>();
  for (const artifact of input.artifacts) {
    if (
      !Number.isInteger(artifact.artifactType) ||
      !Number.isInteger(artifact.rarity)
    ) {
      continue;
    }
    const key = `${artifact.artifactType}:${artifact.rarity}`;
    const existing = artifactCounts.get(key);
    if (existing) existing.count += 1;
    else {
      artifactCounts.set(key, {
        artifactType: artifact.artifactType,
        rarity: artifact.rarity,
        count: 1,
      });
    }
  }

  const names = orderedActions(seen);
  const players = [...playerOps.entries()]
    .map(([player, stats]) => ({
      player,
      operations: stats.operations,
      kinds: stats.kinds.size,
    }))
    .sort(
      (a, b) => b.operations - a.operations || a.player.localeCompare(b.player),
    );
  const artifacts = [...artifactCounts.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.artifactType - b.artifactType ||
      a.rarity - b.rarity,
  );

  return {
    version: DASHBOARD_REPORT_VERSION,
    generatedAt: input.generatedAt ?? Math.floor(Date.now() / 1000),
    bucketSeconds,
    summary: {
      players: playerOps.size,
      operations,
      planets: input.planetCount,
      voyages: voyageTotal,
      silverMoved: silverMoved.toString(),
      silverWithdrawn: silverWithdrawn.toString(),
      from,
      to,
    },
    actions: names,
    hourly: fillHours(states, names, bucketSeconds),
    players,
    voyages,
    artifacts,
    planetCount: input.planetCount,
    planetInits: input.planetInits,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSummary(value: unknown): value is DashboardSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.players === "number" &&
    typeof value.operations === "number" &&
    typeof value.planets === "number" &&
    typeof value.voyages === "number" &&
    typeof value.silverMoved === "string" &&
    typeof value.silverWithdrawn === "string" &&
    (value.from === null || typeof value.from === "number") &&
    (value.to === null || typeof value.to === "number")
  );
}

export function isDashboardReport(value: unknown): value is DashboardReport {
  if (!isRecord(value)) return false;
  if (value.version !== DASHBOARD_REPORT_VERSION) return false;
  if (typeof value.bucketSeconds !== "number") return false;
  if (!isSummary(value.summary)) return false;
  if (!isRecord(value.voyages)) return false;
  if (
    typeof value.voyages.normal !== "number" ||
    typeof value.voyages.photoid !== "number" ||
    typeof value.voyages.wormhole !== "number"
  ) {
    return false;
  }
  return (
    Array.isArray(value.actions) &&
    Array.isArray(value.hourly) &&
    Array.isArray(value.players) &&
    Array.isArray(value.artifacts) &&
    Array.isArray(value.planetInits) &&
    typeof value.planetCount === "number"
  );
}
