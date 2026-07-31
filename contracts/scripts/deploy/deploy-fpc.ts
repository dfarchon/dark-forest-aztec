/**
 * Deploys a QuotaFpc paymaster from a config file.
 *
 *   pnpm --filter contracts run deploy-fpc -- --config fpc/config/dark-forest.json
 *
 * The contract is app-agnostic; everything specific to a deployment — which
 * contracts it sponsors, the daily allowance, the per-transaction ceiling, and
 * the maximum the operator accepts losing — comes from that config, validated
 * before anything is sent.
 *
 * Deploying does NOT fund. Funding is a separate, deliberate step, because fee
 * juice sent to the paymaster can never be recovered.
 */
import fs from 'node:fs';
import path from 'node:path';

import { AztecAddress } from '@aztec/aztec.js/addresses';

import {
    MAX_ALLOWED_ACCOUNT_CLASSES,
    MAX_ALLOWED_TARGETS,
    padAllowedAccountClasses,
    padAllowedTargets,
    parseQuotaFpcConfig,
    QuotaFpcConfigError,
} from '../../fpc/config/schema.js';
import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { buildFeeSendFields, prepareFeePayment } from '../utils/feePayment.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { setupWallet } from '../utils/wallet.js';
import { getOrCreateAccount } from '../utils/wallet.js';

const FEE_JUICE_DECIMALS = 18n;

function formatFeeJuice(wei: bigint): string {
    const whole = wei / 10n ** FEE_JUICE_DECIMALS;
    const frac = (wei % 10n ** FEE_JUICE_DECIMALS)
        .toString()
        .padStart(Number(FEE_JUICE_DECIMALS), '0')
        .slice(0, 4);
    return `${whole}.${frac} FJ`;
}

/**
 * Class ids are hashes of the account artifacts, pinned to the installed
 * `@aztec/accounts` version. A config carrying ids from a different version
 * would deploy an immutable allowlist that matches NO real account — every
 * sponsorship attempt would fail — so recompute and refuse on any mismatch.
 * Known upstream classes are checked by name; an unrecognized name FAILS unless
 * `--allow-unverified-account-class` is passed, so a typo cannot quietly ship
 * an unchecked id.
 */
async function verifyAccountClassIds(
    classes: { name: string; classId: string }[],
    allowUnverified: boolean
): Promise<{ verified: number; unverified: number }> {
    const { getContractClassFromArtifact } =
        await import('@aztec/aztec.js/contracts');
    const {
        SchnorrAccountContractArtifact,
        SchnorrInitializerlessAccountContractArtifact,
    } = await import('@aztec/accounts/schnorr');

    const known = new Map<string, bigint>();
    for (const [name, artifact] of [
        ['SchnorrAccount', SchnorrAccountContractArtifact],
        [
            'SchnorrInitializerlessAccount',
            SchnorrInitializerlessAccountContractArtifact,
        ],
    ] as const) {
        const { id } = await getContractClassFromArtifact(artifact);
        known.set(name, id.toBigInt());
    }

    let verified = 0;
    let unverified = 0;
    for (const entry of classes) {
        const expected = known.get(entry.name.trim());
        if (expected === undefined) {
            // Fail closed. A typo ("SchnorrInitializerlesAccount") would
            // otherwise ship an unverified id behind a warning nobody reads —
            // bricking sponsorship at best, blessing hostile code at worst.
            if (!allowUnverified) {
                throw new Error(
                    `Cannot verify account class "${entry.name}": not one this script knows ` +
                        `(${[...known.keys()].join(', ')}). Fix the name, or pass ` +
                        `--allow-unverified-account-class to ship its id unchecked on purpose.`
                );
            }
            console.warn(
                `  WARNING: ${entry.name} ships UNVERIFIED (--allow-unverified-account-class).`
            );
            unverified += 1;
            continue;
        }
        if (BigInt(entry.classId) !== expected) {
            throw new Error(
                `Config classId for ${entry.name} (${entry.classId}) does not match the installed ` +
                    `@aztec/accounts artifact (0x${expected.toString(16).padStart(64, '0')}). ` +
                    `The config is pinned to a different version — update it, or deploy from the matching checkout. ` +
                    `Deploying anyway would ship an immutable allowlist that rejects every real account.`
            );
        }
        verified += 1;
    }
    return { verified, unverified };
}

function parseArgs(argv: string[]): {
    configPath: string;
    dryRun: boolean;
    allowUnverified: boolean;
} {
    const configIndex = argv.indexOf('--config');
    if (configIndex === -1 || !argv[configIndex + 1]) {
        throw new Error(
            'Usage: deploy-fpc --config <path-to-config.json> [--dry-run]\n' +
                'Example: --config fpc/config/dark-forest.json'
        );
    }
    return {
        configPath: argv[configIndex + 1],
        dryRun: argv.includes('--dry-run'),
        allowUnverified: argv.includes('--allow-unverified-account-class'),
    };
}

async function main() {
    const { configPath, dryRun, allowUnverified } = parseArgs(
        process.argv.slice(2)
    );
    loadContractsEnv({ optional: true } as never);

    const resolved = path.resolve(process.cwd(), configPath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Config not found: ${resolved}`);
    }

    let config;
    try {
        config = parseQuotaFpcConfig(
            JSON.parse(fs.readFileSync(resolved, 'utf-8'))
        );
    } catch (err) {
        if (err instanceof QuotaFpcConfigError) {
            // A bad policy cannot be corrected after deployment, so fail loudly
            // and say exactly what to change.
            console.error(`\nConfig rejected: ${err.message}\n`);
            process.exit(2);
        }
        throw err;
    }

    const perGeneration =
        BigInt(config.policy.maxFeeWei) *
        BigInt(config.policy.maxUsesPerDay) *
        BigInt(config.policy.maxUsersPerDay);
    // 3x: up to three generations are chargeable within one UTC day around a
    // rollover (see the freshness logic in the contract). This is what the
    // config's loss-cap check gates on.
    const worstCasePerDay = perGeneration * 3n;

    console.log(`\nDeployment:  ${config.name}`);
    if (config.description) console.log(`             ${config.description}`);
    console.log(`\nPolicy`);
    console.log(
        `  per-transaction ceiling   ${formatFeeJuice(BigInt(config.policy.maxFeeWei))}`
    );
    console.log(`  transactions per user/day ${config.policy.maxUsesPerDay}`);
    console.log(`  users per day             ${config.policy.maxUsersPerDay}`);
    console.log(
        `  worst case per day (3 gen) ${formatFeeJuice(worstCasePerDay)}`
    );
    console.log(
        `  accepted maximum loss     ${formatFeeJuice(BigInt(config.maxLossWei))}`
    );
    console.log(
        `\nSponsored contracts (${config.resolvedTargets.length}/${MAX_ALLOWED_TARGETS})`
    );
    for (const target of config.resolvedTargets) {
        console.log(`  ${target.name.padEnd(20)} ${target.address}`);
    }
    console.log(
        `\nSponsored account classes (${config.allowedAccountClasses.length}/${MAX_ALLOWED_ACCOUNT_CLASSES})`
    );
    for (const accountClass of config.allowedAccountClasses) {
        console.log(
            `  ${accountClass.name.padEnd(30)} ${accountClass.classId}`
        );
    }
    const { verified, unverified } = await verifyAccountClassIds(
        config.allowedAccountClasses,
        allowUnverified
    );
    // Report both counts: saying "class ids match" while some shipped
    // unchecked would misrepresent what was actually verified.
    console.log(
        `  ${verified} verified against the installed @aztec/accounts artifacts` +
            (unverified > 0 ? `, ${unverified} UNVERIFIED` : '')
    );
    console.log(
        `  unpublished-account requirement  ${config.requireUnpublishedAccounts ? 'ON' : 'OFF — published accounts can upgrade to hostile code and still be sponsored'}`
    );

    if (dryRun) {
        console.log('\nDry run: config is valid, nothing was sent.\n');
        return;
    }

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    console.log(`\nConnecting to ${nodeUrl} …`);
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const deployer = await getOrCreateAccount(wallet, node);
    // Same fee path the game's own deploy uses, so a fresh deployer with no
    // fee juice can still publish (FEE_PAYMENT_MODE, default 'sponsored').
    const feeCtx = await prepareFeePayment(wallet);

    const { QuotaFpcContract } = await import('../artifacts/QuotaFpc.js');
    const allowed = padAllowedTargets(
        config.resolvedTargets.map((t) => t.address)
    ).map((a) => AztecAddress.fromStringUnsafe(a));
    const allowedClasses = padAllowedAccountClasses(
        config.allowedAccountClasses.map((c) => BigInt(c.classId))
    );

    console.log(`Deploying QuotaFpc from ${deployer.toString()} …`);
    const deployment = QuotaFpcContract.deploy(
        wallet as never,
        BigInt(config.policy.maxFeeWei),
        config.policy.maxUsesPerDay,
        config.policy.maxUsersPerDay,
        allowed as never,
        allowedClasses as never,
        config.requireUnpublishedAccounts as never
    );
    await deployment.send({ from: deployer, ...buildFeeSendFields(feeCtx) });
    const fpc = await deployment.register();

    console.log(`\nDeployed.`);
    console.log(`  QUOTA_FPC_CONTRACT_ADDRESS=${fpc.address.toString()}`);
    console.log(`  QUOTA_FPC_DEPLOYER_ADDRESS=${deployer.toString()}`);
    console.log(
        `\nThe paymaster holds no fee juice yet and will sponsor nothing until funded.` +
            `\nFund it in tranches — there is no withdraw — keeping the total at or under` +
            `\n${formatFeeJuice(BigInt(config.maxLossWei))}.\n`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
