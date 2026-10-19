/**
 * Network runtime checks and the `pnpm net:print` report.
 *
 * Import `diagnoseNetwork` / `requireNetworkConfigured` from other scripts.
 * Running this file prints the current network config.
 */
import path from 'path';
import { fileURLToPath } from 'url';

import {
    getNetworkValue,
    isSecretKey,
    loadNetworkEnv,
    SECRET_KEYS,
    validatePxeStoreDir,
} from './env.ts';

export const REQUIRED_NETWORK_KEYS = [
    'AZTEC_NODE_URL',
    'ETHEREUM_HOST',
    'PXE_STORE_DIR',
    'FEE_PAYMENT_MODE',
] as const;

export const FEE_PAYMENT_MODES = ['sponsored', 'account'] as const;

export type FeePaymentMode = (typeof FEE_PAYMENT_MODES)[number];

const REPORT_KEYS = [
    ...SECRET_KEYS,
    'AZTEC_NODE_URL',
    'ETHEREUM_HOST',
    'PROVER_ENABLED',
    'FEE_PAYMENT_MODE',
    'ACCOUNT_MIN_BALANCE_FJ',
    'PXE_STORE_DIR',
] as const;

export type NetworkDiagnosis = {
    ok: boolean;
    reasons: string[];
    missing: string[];
};

function isFeePaymentMode(value: string): value is FeePaymentMode {
    return (FEE_PAYMENT_MODES as readonly string[]).includes(value);
}

export function diagnoseNetwork(): NetworkDiagnosis {
    const ctx = loadNetworkEnv();
    const reasons: string[] = [];
    const missing: string[] = [];

    for (const key of REQUIRED_NETWORK_KEYS) {
        if (!getNetworkValue(key)) {
            missing.push(key);
            reasons.push(`Missing ${key}`);
        }
    }

    const feeMode = getNetworkValue('FEE_PAYMENT_MODE');
    if (feeMode && !isFeePaymentMode(feeMode)) {
        reasons.push(
            `FEE_PAYMENT_MODE must be sponsored or account (got ${feeMode}).`
        );
    }

    const pxeRaw = getNetworkValue('PXE_STORE_DIR');
    if (pxeRaw) {
        const pxe = validatePxeStoreDir(
            pxeRaw,
            ctx.network,
            ctx.networkFilePath
        );
        if (!pxe.ok) reasons.push(pxe.reason);
    }

    return {
        ok: reasons.length === 0,
        reasons,
        missing,
    };
}

export function requireNetworkConfigured(): void {
    let diagnosis: NetworkDiagnosis;
    try {
        diagnosis = diagnoseNetwork();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nNetwork is not configured.\n  ${message}\n`);
        process.exit(1);
    }

    if (diagnosis.ok) return;

    const ctx = loadNetworkEnv();
    const rel = path.relative(process.cwd(), ctx.networkFilePath);
    const lines = [
        '\nNetwork is not configured.',
        `  Network: ${ctx.network}`,
        `  Config:  ${rel}`,
        '  Notes:',
        ...diagnosis.reasons.map((reason) => `    - ${reason}`),
        `  Fill the missing values in ${rel} (copy from the matching networks/*.env.example).`,
        '',
    ];
    console.error(lines.join('\n'));
    process.exit(1);
}

function padCenter(text: string, width: number): string {
    const gap = Math.max(0, width - text.length);
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
}

function displayValue(key: string, raw: string | undefined): string {
    if (isSecretKey(key)) return raw ? '(set)' : '(not set)';
    return raw && raw !== '' ? raw : '(not set)';
}

export function printNetworkReport(): void {
    const ctx = loadNetworkEnv();
    const diagnosis = diagnoseNetwork();
    const rel = (p: string) => path.relative(process.cwd(), p);

    const metaRows: { key: string; value: string }[] = [
        { key: 'Name', value: ctx.network },
        { key: 'Selector', value: rel(ctx.envFilePath) },
        { key: 'Config', value: rel(ctx.networkFilePath) },
        { key: 'Ready', value: diagnosis.ok ? 'yes' : 'no' },
    ];
    if (!diagnosis.ok) {
        for (const reason of diagnosis.reasons) {
            metaRows.push({ key: 'Note', value: reason });
        }
    }

    const keys = new Set<string>([...Object.keys(ctx.values), ...REPORT_KEYS]);
    const networkKeys: string[] = [];
    const accountKeys: string[] = [];
    for (const key of [...keys].sort()) {
        if (key === 'ACCOUNT_MIN_BALANCE_FJ') continue;
        if (key.startsWith('ACCOUNT_')) accountKeys.push(key);
        else networkKeys.push(key);
    }
    const feeModeIndex = networkKeys.indexOf('FEE_PAYMENT_MODE');
    networkKeys.splice(
        feeModeIndex >= 0 ? feeModeIndex + 1 : networkKeys.length,
        0,
        'ACCOUNT_MIN_BALANCE_FJ'
    );

    const toRow = (key: string) => ({
        key,
        value: displayValue(key, ctx.values[key]),
    });
    const networkRows = networkKeys.map(toRow);
    const accountRows = accountKeys.map(toRow);
    const fields = [...metaRows, ...networkRows, ...accountRows];

    const keyWidth = Math.max(
        'Key'.length,
        ...fields.map((row) => row.key.length)
    );
    const valueWidth = Math.max(
        'Value'.length,
        ...fields.map((row) => row.value.length)
    );

    const rule = (left: string, mid: string, right: string) =>
        left +
        '─'.repeat(keyWidth + 2) +
        mid +
        '─'.repeat(valueWidth + 2) +
        right;

    const line = (key: string, value: string) =>
        `│ ${padCenter(key, keyWidth)} │ ${value.padEnd(valueWidth)} │`;

    const lines = [
        '',
        rule('┌', '┬', '┐'),
        line('Key', 'Value'),
        rule('├', '┼', '┤'),
        ...metaRows.map((row) => line(row.key, row.value)),
        ...networkRows.map((row) => line(row.key, row.value)),
        ...(accountRows.length > 0 ? [rule('├', '┼', '┤')] : []),
        ...accountRows.map((row) => line(row.key, row.value)),
        rule('└', '┴', '┘'),
    ];
    console.log(lines.join('\n'));
}

function isMainModule(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
}

if (isMainModule()) {
    try {
        printNetworkReport();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\n${message}\n`);
        process.exit(1);
    }
}
