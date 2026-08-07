/**
 * Deploys a QuotaFpc paymaster from a JSON config.
 *
 *   pnpm --filter contracts run deploy-fpc -- --config fpc/config/dark-forest.json [--yes|--dry-run]
 *
 * Thin CLI over @alejoamiras/quota-paymaster/operator. Everything that used to
 * live here — config validation, worst-case-vs-accepted-loss refusal, account
 * class-id verification against the installed packages, the deploy itself —
 * is the package's `parseQuotaFpcConfig` + `deployQuotaFpc`, behind its
 * confirm-by-digest ActionPlan. This file only wires env, wallet and fees.
 */
import fs from 'node:fs';

import { parseQuotaFpcConfig } from '@alejoamiras/quota-paymaster';
import { deployQuotaFpc } from '@alejoamiras/quota-paymaster/operator';

import { argvOf, confirmFromFlags, flag, opt } from '../operator/confirm.js';
import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { buildFeeSendFields, prepareFeePayment } from '../utils/feePayment.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';

async function main() {
    const argv = argvOf();
    const configPath = opt(argv, '--config');
    if (!configPath) {
        throw new Error(
            'Usage: deploy-fpc --config <path.json> [--yes] [--dry-run] [--allow-unverified-account-classes]'
        );
    }
    loadContractsEnv({ optional: true } as never);

    const config = parseQuotaFpcConfig(
        JSON.parse(fs.readFileSync(configPath, 'utf8')),
        process.env
    );

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const from = await getOrCreateAccount(wallet, node);
    const feeCtx = await prepareFeePayment(wallet, from);

    const contract = await deployQuotaFpc(
        {
            wallet: wallet as never,
            from,
            confirm: confirmFromFlags({
                yes: flag(argv, '--yes'),
                dryRun: flag(argv, '--dry-run'),
            }),
            onWarn: (msg) => console.warn(`  WARN ${msg}`),
        },
        config,
        {
            allowUnverifiedAccountClasses: flag(
                argv,
                '--allow-unverified-account-classes'
            ),
            sendOptions: { from, ...buildFeeSendFields(feeCtx) },
        }
    );

    console.log(`\nDeployed.`);
    console.log(`  QUOTA_FPC_CONTRACT_ADDRESS=${contract.address.toString()}`);
    console.log(`  QUOTA_FPC_DEPLOYER_ADDRESS=${from.toString()}`);
    console.log(
        `\nThe paymaster holds no fee juice yet and sponsors nothing until funded\n` +
            `ABOVE the sequencer reserve (see update-fpc-policy --show). Funding is\n` +
            `irreversible — fund in tranches.`
    );
}

main().catch((err) => {
    if ((err as { name?: string })?.name === 'ActionAborted') {
        process.exit(2);
    }
    console.error(err);
    process.exit(1);
});
