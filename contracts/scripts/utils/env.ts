/**
 * Single source for loading and reading `contracts/` env files in scripts.
 *
 * Two-phase loading:
 *   Phase 1 — always load `contracts/.env` to pick up `AZTEC_NETWORK` / `CONTRACTS_ENV_FILE`.
 *   Phase 2 — resolve the active env file and load it (override: true).
 *
 * Resolution order for the active file (first match wins):
 * 1. `CONTRACTS_ENV_FILE` — absolute path, or relative to `process.cwd()`
 * 2. If `AZTEC_NETWORK` is set (shell env or `.env`) and `contracts/.env.<AZTEC_NETWORK>` exists, use it
 * 3. Otherwise `contracts/.env`
 *
 * All writes (ACCOUNT_*, contract addresses, START_BLOCK) go to the active file.
 * Call `loadContractsEnv()` once at the start of each entry script before reading values.
 */
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

/** Absolute path to the `contracts/` package root (directory containing `.env`). */
export const CONTRACTS_PACKAGE_ROOT = path.resolve(
    import.meta.dirname,
    '..',
    '..'
);

let loadedPath: string | null = null;
let loadCalled = false;

/** Keys written by deploy / expected after configure (same set as `pnpm test:env`). */
export const ENV_KEYS = [
    'ACCOUNT_SALT',
    'ACCOUNT_SECRET_KEY',
    'ACCOUNT_SIGNING_KEY',
    'ACCOUNT_ADDRESS',
    'START_BLOCK',
    'CONFIG_CONTRACT_ADDRESS',
    'CONFIG_DEPLOYER_ADDRESS',
    'CONFIG_DEPLOYMENT_SALT',
    'WORLD_STORAGE_CONTRACT_ADDRESS',
    'WORLD_STORAGE_DEPLOYER_ADDRESS',
    'WORLD_STORAGE_DEPLOYMENT_SALT',
    'PLAYER_STORAGE_CONTRACT_ADDRESS',
    'PLAYER_STORAGE_DEPLOYER_ADDRESS',
    'PLAYER_STORAGE_DEPLOYMENT_SALT',
    'PLANET_STORAGE_CONTRACT_ADDRESS',
    'PLANET_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_STORAGE_DEPLOYMENT_SALT',
    'PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS',
    'PLANET_REVEALED_COORDS_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_REVEALED_COORDS_STORAGE_DEPLOYMENT_SALT',
    'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS',
    'PLANET_EVENTS_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_EVENTS_STORAGE_DEPLOYMENT_SALT',
    'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS',
    'PLANET_ARTIFACTS_STORAGE_DEPLOYER_ADDRESS',
    'PLANET_ARTIFACTS_STORAGE_DEPLOYMENT_SALT',
    'ARRIVAL_STORAGE_CONTRACT_ADDRESS',
    'ARRIVAL_STORAGE_DEPLOYER_ADDRESS',
    'ARRIVAL_STORAGE_DEPLOYMENT_SALT',
    'ARTIFACT_STORAGE_CONTRACT_ADDRESS',
    'ARTIFACT_STORAGE_DEPLOYER_ADDRESS',
    'ARTIFACT_STORAGE_DEPLOYMENT_SALT',
    'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS',
    'ARTIFACT_LOCATION_STORAGE_DEPLOYER_ADDRESS',
    'ARTIFACT_LOCATION_STORAGE_DEPLOYMENT_SALT',
    'ADMIN_CONTRACT_ADDRESS',
    'ADMIN_DEPLOYER_ADDRESS',
    'ADMIN_DEPLOYMENT_SALT',
    'CORE_CONTRACT_ADDRESS',
    'CORE_DEPLOYER_ADDRESS',
    'CORE_DEPLOYMENT_SALT',
    'MOVE_CONTRACT_ADDRESS',
    'MOVE_DEPLOYER_ADDRESS',
    'MOVE_DEPLOYMENT_SALT',
    'ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_ACTION_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_ACTION_SYSTEM_DEPLOYMENT_SALT',
    'ARTIFACT_FIND_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_FIND_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_FIND_SYSTEM_DEPLOYMENT_SALT',
    'ARTIFACT_PROSPECT_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_PROSPECT_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_PROSPECT_SYSTEM_DEPLOYMENT_SALT',
    'ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS',
    'ARTIFACT_VAULT_SYSTEM_DEPLOYER_ADDRESS',
    'ARTIFACT_VAULT_SYSTEM_DEPLOYMENT_SALT',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

/**
 * Resolve which env file path will be used (does not read the file).
 * Prefer calling `loadContractsEnv()` in entry scripts so `process.env` is populated.
 */
export function resolveContractsEnvFilePath(): string {
    const explicit = process.env.CONTRACTS_ENV_FILE;
    if (explicit) {
        return path.isAbsolute(explicit)
            ? explicit
            : path.resolve(process.cwd(), explicit);
    }
    const network = process.env.AZTEC_NETWORK;
    if (network) {
        const profilePath = path.join(
            CONTRACTS_PACKAGE_ROOT,
            `.env.${network}`
        );
        if (fs.existsSync(profilePath)) {
            return profilePath;
        }
    }
    return path.join(CONTRACTS_PACKAGE_ROOT, '.env');
}

export type LoadContractsEnvOptions = {
    /** If true, values in the file override existing `process.env` (default false). */
    override?: boolean;
};

/**
 * Load dotenv from the resolved contracts env file. Idempotent (subsequent calls no-op).
 *
 * Two-phase loading: `.env` is always loaded first so that `AZTEC_NETWORK` (and
 * `CONTRACTS_ENV_FILE`) are available in `process.env` before resolution. If a
 * network-specific file (`.env.<network>`) is resolved, it is loaded second with
 * `override: true` so its values take precedence. Writes target the resolved file.
 *
 * @returns Absolute path of the active env file (network-specific when applicable)
 */
export function loadContractsEnv(options?: LoadContractsEnvOptions): string {
    if (loadCalled) {
        return loadedPath!;
    }
    loadCalled = true;
    const override = options?.override ?? false;

    const baseEnvPath = path.join(CONTRACTS_PACKAGE_ROOT, '.env');
    if (fs.existsSync(baseEnvPath)) {
        dotenv.config({ path: baseEnvPath, override });
    }

    const targetPath = resolveContractsEnvFilePath();
    loadedPath = targetPath;

    if (targetPath !== baseEnvPath) {
        dotenv.config({ path: targetPath, override: true });
    }

    printEnvSummary(baseEnvPath, targetPath);

    return targetPath;
}

function isEnvDiagnosticsSilent(): boolean {
    const v = process.env.ACCOUNT_SILENT_DIAGNOSTICS?.toLowerCase().trim();
    return v === '1' || v === 'true';
}

function abbreviateAddress(addr: string): string {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function printEnvSummary(baseEnvPath: string, activePath: string): void {
    if (isEnvDiagnosticsSilent()) return;

    const rel = (p: string) => path.relative(process.cwd(), p);
    const network = process.env.AZTEC_NETWORK;
    const nodeUrl =
        process.env.AZTEC_NODE_URL ?? 'http://localhost:8080 (default)';
    const account = process.env.ACCOUNT_ADDRESS;

    const missing: string[] = [];
    for (const key of ENV_KEYS) {
        if (!process.env[key]) missing.push(key);
    }
    const setCount = ENV_KEYS.length - missing.length;

    const lines = ['\n--- env loaded ---'];
    lines.push(`  Base:    ${rel(baseEnvPath)}`);
    if (activePath !== baseEnvPath) {
        lines.push(`  Active:  ${rel(activePath)}`);
    }
    const feeMode = process.env.FEE_PAYMENT_MODE?.trim() || 'sponsored';
    lines.push(`  Network: ${network ?? '(unset)'}`);
    lines.push(`  Node:    ${nodeUrl}`);
    lines.push(`  Fee mode: ${feeMode}`);
    lines.push(
        `  Account: ${account ? abbreviateAddress(account) : '(not set)'}`
    );
    lines.push(`  Keys:    ${setCount}/${ENV_KEYS.length} set`);
    if (missing.length > 0) {
        lines.push(`  Missing: ${missing.join(', ')}`);
    }
    console.log(lines.join('\n'));
}

/**
 * Re-read the contracts env file into `process.env` (e.g. after appending new `ACCOUNT_*`).
 * Resets the idempotent guard so the file is parsed again.
 */
export function reloadContractsEnv(options?: LoadContractsEnvOptions): string {
    loadCalled = false;
    loadedPath = null;
    return loadContractsEnv(options);
}

/** Absolute path to the env file in use (after load, or resolved if not yet loaded). */
export function getContractsEnvFilePath(): string {
    return loadedPath ?? resolveContractsEnvFilePath();
}

export function getOptionalEnv(key: string): string | undefined {
    const v = process.env[key];
    if (v === undefined || v === '') return undefined;
    return v;
}

export function getRequiredEnv(key: string): string {
    const v = getOptionalEnv(key);
    if (!v) throw new Error(`Missing ${key} in contracts .env`);
    return v;
}

const DEFAULT_AZTEC_NODE_URL = 'http://localhost:8080';
const DEFAULT_ETHEREUM_HOST = 'http://localhost:8545';

export function getAztecNodeUrl(): string {
    return getOptionalEnv('AZTEC_NODE_URL') ?? DEFAULT_AZTEC_NODE_URL;
}

export function getEthereumHost(): string {
    return getOptionalEnv('ETHEREUM_HOST') ?? DEFAULT_ETHEREUM_HOST;
}

function isLocalSandboxUrl(url: string): boolean {
    return (
        /^https?:\/\/localhost(:\d+)?$/i.test(url) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(url)
    );
}

/**
 * Prover: off by default on local sandbox (fast); on remote nodes default on unless
 * `PROVER_ENABLED=false`. Override with `PROVER_ENABLED=true` on local if needed.
 */
export function getProverEnabled(): boolean {
    const url = getAztecNodeUrl();
    const explicit = getOptionalEnv('PROVER_ENABLED');
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;
    return !isLocalSandboxUrl(url);
}

export function getWriteEnvFile(): boolean {
    return getOptionalEnv('WRITE_ENV_FILE') !== 'false';
}

/** Profile label (e.g. shell `AZTEC_NETWORK=devnet`); does not load `.env.<network>` by itself. */
export function getAztecNetwork(): string | undefined {
    return getOptionalEnv('AZTEC_NETWORK');
}

/**
 * Fee payment mode for write scripts (`FEE_PAYMENT_MODE`).
 * Prefer importing {@link getFeePaymentMode} from `./feePayment.ts` (strict validation).
 * This helper only returns the raw env string for diagnostics.
 */
export function getFeePaymentModeRaw(): string {
    return getOptionalEnv('FEE_PAYMENT_MODE')?.trim() || 'sponsored';
}
