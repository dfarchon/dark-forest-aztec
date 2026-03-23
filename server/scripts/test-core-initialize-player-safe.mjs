import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPublicEvents } from "@aztec/aztec.js/events";
import { BlockNumber } from "@aztec/foundation/branded-types";
import dotenv from "dotenv";

import { getTestContext } from "../../contracts/scripts/test/test-setup.ts";
import { unwrapSimulateResult } from "../../packages/utils/src/simulate.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

dotenv.config({ path: path.join(repoRoot, "contracts", ".env") });

const AZTEC_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

function toBigint(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(String(v ?? 0));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function worldZero() {
  return {
    paused: false,
    radius: 53_000n,
    misc_nonce: 0n,
    next_change_block: 0,
  };
}

function playerZero() {
  return {
    init_timestamp: 0,
    home_planet_id: 0n,
    last_reveal_timestamp: 0,
    score: 0n,
    space_junk: 0n,
    space_junk_limit: 0n,
    claimed_ships: false,
    last_updated: 0,
  };
}

function planetZero() {
  return {
    perlin: 0,
    created_at: 0,
    owner: AZTEC_ZERO,
    planet_level: 0,
    planet_type: 0,
    space_type: 0,
    is_home_planet: false,
    is_initialized: false,
    destroyed: false,
    invader: AZTEC_ZERO,
    capturer: AZTEC_ZERO,
    invade_start_block: 0,
    population_cap: 0n,
    population_growth: 0n,
    range: 0n,
    speed: 0n,
    defense: 0n,
    silver_cap: 0n,
    silver_growth: 0n,
    population: 0n,
    silver: 0n,
    upgrade_state_0: 0,
    upgrade_state_1: 0,
    upgrade_state_2: 0,
    last_updated: 0,
    pausers: 0n,
    energy_gro_doublers: 0n,
    silver_gro_doublers: 0n,
    hat_level: 0n,
    space_junk: 0n,
    has_tried_finding_artifact: false,
    prospected_block_number: 0,
  };
}

function isTransientError(message) {
  const text = String(message ?? "").toLowerCase();
  return (
    text.includes("tx dropped by p2p node") ||
    text.includes("pruning data after block") ||
    text.includes("due to reorg") ||
    text.includes("timeout")
  );
}

async function loadWorldFromEvents(ctx) {
  const latestBlock = Number(await ctx.node.getBlockNumber());
  const from = 0;
  const limit = latestBlock - from + 1;

  const mod = await import("../../contracts/scripts/artifacts/WorldStorage.ts");
  const WorldStorageContract = mod.WorldStorageContract;
  if (!WorldStorageContract?.events?.WorldUpdate) {
    return null;
  }

  const raw = await getPublicEvents(ctx.node, WorldStorageContract.events.WorldUpdate, {
    fromBlock: BlockNumber(from),
    toBlock: BlockNumber(from + limit),
    contractAddress: ctx.contracts.WorldStorage?.address,
  });

  const events = raw.events.map((e) => e.event);
  const worldEvent = events.filter((e) => String(e?.id) === "0" && e?.state).pop();
  if (!worldEvent?.state) {
    return null;
  }

  const s = worldEvent.state;
  return {
    paused: Boolean(s.paused),
    radius: toBigint(s.radius),
    misc_nonce: toBigint(s.misc_nonce),
    next_change_block: Number(s.next_change_block ?? 0),
  };
}

async function loadPlayerFromEvents(ctx, playerAddress) {
  const latestBlock = Number(await ctx.node.getBlockNumber());
  const from = 0;
  const limit = latestBlock - from + 1;
  const normalized = playerAddress.toLowerCase();

  const mod = await import("../../contracts/scripts/artifacts/PlayerStorage.ts");
  const PlayerStorageContract = mod.PlayerStorageContract;
  if (!PlayerStorageContract?.events?.PlayerUpdate) {
    return null;
  }

  const raw = await getPublicEvents(ctx.node, PlayerStorageContract.events.PlayerUpdate, {
    fromBlock: BlockNumber(from),
    toBlock: BlockNumber(from + limit),
    contractAddress: ctx.contracts.PlayerStorage?.address,
  });

  const events = raw.events.map((e) => e.event);
  const playerEvent = events
    .filter((e) => String(e?.id).toLowerCase() === normalized && e?.state)
    .pop();
  return playerEvent?.state ?? null;
}

async function getLatestBlockTimestamp(ctx) {
  const block = await ctx.node.getBlock("latest");
  if (block?.header?.globalVariables?.timestamp != null) {
    return toBigint(block.header.globalVariables.timestamp);
  }
  if (block?.timestamp != null) {
    return BigInt(Number(block.timestamp));
  }
  return BigInt(Math.floor(Date.now() / 1000));
}

async function ensureDisableZkChecks(ctx, user, admin, retries) {
  const Config = ctx.contracts.Config;
  if (!Config) {
    throw new Error("Config contract not loaded");
  }

  let snarkConfig = unwrapSimulateResult(await Config.methods.get_snark_config().simulate({ from: user }));
  if (snarkConfig.disable_zk_checks) {
    return snarkConfig;
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const patched = { ...snarkConfig, disable_zk_checks: true };
      await Config.methods.set_snark_config(patched).send(ctx.sendOpts(admin));
      const confirmed = unwrapSimulateResult(await Config.methods.get_snark_config().simulate({ from: user }));
      if (!confirmed.disable_zk_checks) {
        throw new Error("disable_zk_checks was not persisted");
      }
      return confirmed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries && isTransientError(msg)) {
        console.warn(
          `[safe-init] set_snark_config transient failure, retry ${attempt}/${retries - 1}`
        );
        await sleep(1200);
        snarkConfig = unwrapSimulateResult(await Config.methods.get_snark_config().simulate({ from: user }));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Failed to enable disable_zk_checks");
}

async function waitForPlayerInitialized(ctx, userAddress, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const p = await loadPlayerFromEvents(ctx, userAddress);
    if (p && toBigint(p.init_timestamp) > 0n) return true;
    await sleep(800);
  }
  return false;
}

function locationIdForUserIndex(userIndex) {
  return ((10_000_000n + BigInt(userIndex)) << 216n) | (255n << 64n);
}

async function main() {
  const userIndex = process.argv[2] === "1" ? 1 : 0;
  const userLabel = userIndex === 0 ? "user1" : "user2";
  const retries = Number(process.env.SERVER_E2E_INIT_RETRIES ?? "3");

  console.log(`[safe-init] Loading context for ${userLabel}...`);
  const ctx = await getTestContext();

  const Core = ctx.contracts.Core;
  const Config = ctx.contracts.Config;
  if (!Core || !Config) {
    throw new Error("Core or Config contract is missing from context");
  }

  const user = ctx.accounts.users[userIndex];
  const admin = ctx.accounts.admin;
  const sendOpts = ctx.sendOpts;

  const currentPlayer = await loadPlayerFromEvents(ctx, user.toString());
  if (currentPlayer && toBigint(currentPlayer.init_timestamp) > 0n) {
    console.log(
      `[safe-init] ${userLabel} already initialized (init_timestamp=${toBigint(currentPlayer.init_timestamp)})`
    );
    return;
  }

  const snarkConfig = await ensureDisableZkChecks(ctx, user, admin, retries);

  const level = 0;
  const radius = 0n;
  const perlin = Number(
    toBigint(unwrapSimulateResult(await Config.methods.get_game_config_core().simulate({ from: user })).init_perlin_min)
  );

  const worldConfig = unwrapSimulateResult(await Config.methods.get_world_config().simulate({ from: user }));
  const gameConfigCore = unwrapSimulateResult(await Config.methods.get_game_config_core().simulate({ from: user }));
  const planetLevelThresholds = unwrapSimulateResult(await Config.methods
    .get_planet_level_thresholds()
    .simulate({ from: user }));
  const spaceJunkConfig = unwrapSimulateResult(await Config.methods.get_space_junk_config().simulate({ from: user }));
  const tier0 = unwrapSimulateResult(await Config.methods.get_planet_type_weights_tier(0).simulate({ from: user }));
  const tier1 = unwrapSimulateResult(await Config.methods.get_planet_type_weights_tier(1).simulate({ from: user }));
  const tier2 = unwrapSimulateResult(await Config.methods.get_planet_type_weights_tier(2).simulate({ from: user }));
  const tier3 = unwrapSimulateResult(await Config.methods.get_planet_type_weights_tier(3).simulate({ from: user }));
  const planetDefaultStats = unwrapSimulateResult(await Config.methods.get_planet_default_stats(level).simulate({ from: user }));

  const locationId = locationIdForUserIndex(userIndex);
  const maxLocationId = toBigint(gameConfigCore.max_location_id);
  if (locationId >= maxLocationId) {
    throw new Error(
      `[safe-init] locationId ${locationId} is >= max_location_id ${maxLocationId}`
    );
  }

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const world = (await loadWorldFromEvents(ctx)) ?? worldZero();
      const timestamp = await getLatestBlockTimestamp(ctx);

      const args = [
        0n,
        0n,
        radius,
        locationId,
        perlin,
        level,
        timestamp,
        snarkConfig,
        planetDefaultStats,
        worldConfig,
        gameConfigCore,
        planetLevelThresholds,
        spaceJunkConfig,
        tier0,
        tier1,
        tier2,
        tier3,
        planetZero(),
        playerZero(),
        world,
      ];

      await Core.methods.initialize_player(...args).simulate(sendOpts(user));
      const receipt = await Core.methods.initialize_player(...args).send(sendOpts(user));
      const blockNumber =
        receipt && typeof receipt.blockNumber !== "undefined"
          ? Number(receipt.blockNumber)
          : undefined;

      const ok = await waitForPlayerInitialized(ctx, user.toString(), 15_000);
      if (!ok) {
        throw new Error("initialize_player tx sent but player state not observed in events");
      }

      console.log(
        `[safe-init] SUCCESS ${userLabel} location=${locationId} block=${blockNumber ?? "unknown"}`
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.toLowerCase().includes("player already initialized")) {
        console.log(`[safe-init] ${userLabel} already initialized`);
        return;
      }

      const racePlayer = await loadPlayerFromEvents(ctx, user.toString());
      if (racePlayer && toBigint(racePlayer.init_timestamp) > 0n) {
        console.log(`[safe-init] ${userLabel} initialized by concurrent tx`);
        return;
      }

      if (attempt < retries && isTransientError(msg)) {
        console.warn(
          `[safe-init] transient failure for ${userLabel}, retry ${attempt}/${retries - 1}`
        );
        await sleep(1400);
        continue;
      }

      throw err;
    }
  }

  throw new Error(`[safe-init] Failed to initialize ${userLabel} after ${retries} attempts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
