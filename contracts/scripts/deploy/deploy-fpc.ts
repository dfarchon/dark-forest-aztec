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
    MAX_ALLOWED_TARGETS,
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

function parseArgs(argv: string[]): { configPath: string; dryRun: boolean } {
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
    };
}

async function main() {
    const { configPath, dryRun } = parseArgs(process.argv.slice(2));
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

    console.log(`Deploying QuotaFpc from ${deployer.toString()} …`);
    const deployment = QuotaFpcContract.deploy(
        wallet as never,
        BigInt(config.policy.maxFeeWei),
        config.policy.maxUsesPerDay,
        config.policy.maxUsersPerDay,
        allowed as never
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
