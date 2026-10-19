/**
 * Loader for contracts network selection and per-network config.
 *
 * `.env` contributes only `AZTEC_NETWORK`. Other keys in that file are ignored.
 * Network parameters come from `networks/<AZTEC_NETWORK>.env`.
 * Network keys are filled in by hand. `pnpm account:generate` only appends
 * ACCOUNT_* at the end of that file and never overwrites existing lines.
 */
import fs from 'fs';
import path from 'path';

export const CONTRACTS_PACKAGE_ROOT = path.resolve(
    import.meta.dirname,
    '../..'
);

export const SECRET_KEYS = [
    'ACCOUNT_SALT',
    'ACCOUNT_SECRET_KEY',
    'ACCOUNT_SIGNING_KEY',
    'ACCOUNT_ADDRESS',
] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

const NETWORK_NAME_RE = /^[A-Za-z0-9_-]+$/;

export type LoadedNetwork = {
    network: string;
    envFilePath: string;
    networkFilePath: string;
    values: Record<string, string>;
};

let loaded: LoadedNetwork | null = null;

function parseEnvFile(content: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (key) out[key] = value;
    }
    return out;
}

function readEnvFile(filePath: string): Record<string, string> {
    return parseEnvFile(fs.readFileSync(filePath, 'utf-8'));
}

function resolveNetworkName(envFilePath: string): string {
    const fromShell = process.env.AZTEC_NETWORK?.trim();
    if (fromShell) return fromShell;

    if (!fs.existsSync(envFilePath)) {
        throw new Error(
            `Missing AZTEC_NETWORK. Create ${path.relative(process.cwd(), envFilePath)} with AZTEC_NETWORK=local (see .env.example).`
        );
    }

    const fromFile = readEnvFile(envFilePath).AZTEC_NETWORK?.trim();
    if (fromFile) return fromFile;

    throw new Error(
        `Missing AZTEC_NETWORK in ${path.relative(process.cwd(), envFilePath)}. Set AZTEC_NETWORK=local (see .env.example).`
    );
}

export function loadNetworkEnv(): LoadedNetwork {
    if (loaded) return loaded;

    const envFilePath = path.join(CONTRACTS_PACKAGE_ROOT, '.env');
    const network = resolveNetworkName(envFilePath);
    if (!NETWORK_NAME_RE.test(network)) {
        throw new Error(
            `Invalid AZTEC_NETWORK "${network}". Use a name like local, testnet, or mainnet.`
        );
    }

    const networkFilePath = path.join(
        CONTRACTS_PACKAGE_ROOT,
        'networks',
        `${network}.env`
    );
    if (!fs.existsSync(networkFilePath)) {
        const examplePath = path.join(
            CONTRACTS_PACKAGE_ROOT,
            'networks',
            `${network}.env.example`
        );
        const exampleHint = fs.existsSync(examplePath)
            ? ` Copy ${path.relative(process.cwd(), examplePath)} to ${path.relative(process.cwd(), networkFilePath)} and fill it in.`
            : '';
        throw new Error(
            `Missing network config at ${path.relative(process.cwd(), networkFilePath)}.${exampleHint}`
        );
    }

    loaded = {
        network,
        envFilePath,
        networkFilePath,
        values: readEnvFile(networkFilePath),
    };
    return loaded;
}

/** Clear the cached load and read `networks/<name>.env` again. */
export function reloadNetworkEnv(): LoadedNetwork {
    loaded = null;
    return loadNetworkEnv();
}

export function getNetworkValue(key: string): string | undefined {
    const value = loadNetworkEnv().values[key];
    if (value === undefined || value === '') return undefined;
    return value;
}

export type PxeStoreDirResult =
    | { ok: true; path: string }
    | { ok: false; reason: string };

/**
 * Validate `PXE_STORE_DIR`: relative to the contracts package root, inside
 * that package, and not under `networks/`.
 */
export function validatePxeStoreDir(
    raw: string | undefined,
    network: string,
    networkFilePath: string
): PxeStoreDirResult {
    if (!raw) {
        return {
            ok: false,
            reason:
                `Missing PXE_STORE_DIR in ${path.relative(process.cwd(), networkFilePath)}. ` +
                `Copy the matching networks/*.env.example and set PXE_STORE_DIR=.store/${network}.`,
        };
    }
    if (path.isAbsolute(raw)) {
        return {
            ok: false,
            reason: `PXE_STORE_DIR must be a path relative to the contracts package root (got ${raw}).`,
        };
    }

    const resolved = path.resolve(CONTRACTS_PACKAGE_ROOT, raw);
    const rel = path.relative(CONTRACTS_PACKAGE_ROOT, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        return {
            ok: false,
            reason: `PXE_STORE_DIR must stay inside the contracts package (got ${raw}).`,
        };
    }
    if (rel === 'networks' || rel.startsWith(`networks${path.sep}`)) {
        return {
            ok: false,
            reason: `PXE_STORE_DIR must not point at networks/ (got ${raw}).`,
        };
    }
    return { ok: true, path: resolved };
}

/**
 * Absolute PXE/wallet cache directory for the active network.
 * `PXE_STORE_DIR` is relative to the contracts package root and must stay
 * inside that package (not `networks/`).
 */
export function resolvePxeStoreDir(): string {
    const ctx = loadNetworkEnv();
    const result = validatePxeStoreDir(
        getNetworkValue('PXE_STORE_DIR'),
        ctx.network,
        ctx.networkFilePath
    );
    if (!result.ok) throw new Error(result.reason);
    return result.path;
}

export function isSecretKey(key: string): boolean {
    return (SECRET_KEYS as readonly string[]).includes(key);
}
