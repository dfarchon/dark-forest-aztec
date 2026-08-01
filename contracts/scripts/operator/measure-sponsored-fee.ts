/**
 * Measures what a SPONSORED transaction actually costs the paymaster.
 *
 *   pnpm --filter contracts run measure-sponsored-fee -- \
 *     --fpc 0x… --target 0x… --method ping --count 3
 *
 * Why a dedicated script rather than reading the deploy receipt: a sponsored
 * transaction is not an ordinary one. It runs the paymaster's private circuits
 * (allowlist binding, account-class check, unpublished proof, quota
 * bookkeeping) and only then the app call, so its cost is structurally higher
 * than a plain send. That difference is precisely what has to be budgeted, and
 * it cannot be inferred from fee rates alone.
 *
 * Two figures come out, and they are not the same thing:
 *   - FIRST-of-day, which also claims a seat and opens the allowance note, and
 *   - SUBSEQUENT, which only decrements it.
 *
 * The target must be on the paymaster's allowlist and the sender must be an
 * allowlisted, unpublished account — the same rules real players are held to.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';

import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';

function parseArgs(argv: string[]) {
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i === -1 ? undefined : argv[i + 1];
    };
    const fpc = get('--fpc');
    const target = get('--target');
    if (!fpc || !target) {
        throw new Error(
            'Usage: measure-sponsored-fee --fpc <address> --target <address> [--method ping] [--count 2] [--json out.json]'
        );
    }
    for (const [flag, v] of [
        ['--fpc', fpc],
        ['--target', target],
    ] as const) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
            throw new Error(`${flag} is not a 32-byte address: ${v}`);
        }
    }
    return {
        fpc,
        target,
        method: get('--method') ?? 'ping',
        count: Number(get('--count') ?? '2'),
        jsonOut: get('--json'),
    };
}

async function main() {
    const { fpc, target, method, count, jsonOut } = parseArgs(
        process.argv.slice(2)
    );
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const player = await getOrCreateAccount(wallet, node);

    const { getFeeJuiceBalance } = await import('@aztec/aztec.js/utils');
    const { buildSandwichPayload, generationAt, findFreeSeat } =
        await import('@dfpunk/quota-fpc');
    const { QuotaFpcContract } = await import('../artifacts/QuotaFpc.js');
    const { FpcTestTargetContract } =
        await import('../artifacts/FpcTestTarget.js');
    const { DefaultEntrypoint } = await import('@aztec/entrypoints/default');
    const { Gas, GasSettings } = await import('@aztec/stdlib/gas');
    const { waitForTx } = await import('@aztec/aztec.js/node');
    const {
        QUOTA_DA_GAS_LIMIT,
        QUOTA_L2_GAS_LIMIT,
        QUOTA_TEARDOWN_DA_GAS_LIMIT,
        QUOTA_TEARDOWN_L2_GAS_LIMIT,
        QUOTA_FEE_HEADROOM_MULTIPLIER,
    } = await import('@dfpunk/quota-fpc');

    const fpcAddress = AztecAddress.fromStringUnsafe(fpc);
    const paymaster = await QuotaFpcContract.at(fpcAddress, wallet as never);
    const app = await FpcTestTargetContract.at(
        AztecAddress.fromStringUnsafe(target),
        wallet as never
    );

    const block = await node.getBlockData('latest');
    if (!block) {
        throw new Error(
            `Node ${nodeUrl} returned no latest block — it is still syncing, or the URL is wrong.`
        );
    }
    const chainSeconds = BigInt(block.header.globalVariables.timestamp);
    const generation = generationAt(chainSeconds);

    console.log(`\nMeasuring sponsored transactions on ${nodeUrl}`);
    console.log(`  paymaster  ${fpc}`);
    console.log(`  target     ${target}.${method}()`);
    console.log(`  player     ${player.toString()}`);
    console.log(`  generation ${generation}`);

    const before = await getFeeJuiceBalance(fpcAddress, node);
    console.log(`  balance    ${formatFeeJuiceWei(before)}`);

    // Ask the paymaster whether this player has already subscribed today. A
    // second subscribe in the same generation is refused by design (one per
    // player per day), so re-running this script must continue the existing
    // allowance rather than trying to open a new one.
    const infoRaw: unknown = await paymaster.methods
        .get_quota_info(player, generation)
        .simulate({ from: player });
    const info = (infoRaw as { result?: unknown }).result ?? infoRaw;
    const alreadySubscribed = Boolean((info as [boolean, number])[0]);
    console.log(
        `  subscribed today? ${alreadySubscribed ? `yes, ${(info as [boolean, number])[1]} left` : 'no'}`
    );

    const results: { label: string; feeWei: string }[] = [];
    for (let i = 0; i < count; i++) {
        const first = i === 0 && !alreadySubscribed;
        const seat = first
            ? await findFreeSeat({
                  node: node as never,
                  fpcAddress,
                  generation,
                  maxUsers: 2,
              })
            : undefined;

        // `--method` is operator-supplied, so this index is dynamic by design;
        // an unknown name fails loudly on the next line rather than silently.
        const methods = app.methods as unknown as Record<
            string,
            () => { request(): Promise<unknown> }
        >;
        if (typeof methods[method] !== 'function') {
            throw new Error(
                `Target has no method "${method}". Pass --method with one it does have.`
            );
        }
        const requested = await methods[method]().request();
        const calls =
            (requested as { calls?: unknown[] }).calls ?? (requested as never);

        const payload = await buildSandwichPayload(
            {
                calls: calls as never,
                player,
                fpcAddress,
                generation,
                seat: seat ?? undefined,
            },
            wallet as never,
            paymaster as never
        );

        const gasSettings = GasSettings.fallback({
            gasLimits: new Gas(QUOTA_DA_GAS_LIMIT, QUOTA_L2_GAS_LIMIT),
            teardownGasLimits: new Gas(
                QUOTA_TEARDOWN_DA_GAS_LIMIT,
                QUOTA_TEARDOWN_L2_GAS_LIMIT
            ),
            maxFeesPerGas: (await node.getCurrentMinFees()).mul(
                QUOTA_FEE_HEADROOM_MULTIPLIER
            ),
        });
        const req = await new DefaultEntrypoint().createTxExecutionRequest(
            payload as never,
            gasSettings,
            (await (
                wallet as never as { getChainInfo(): Promise<never> }
            ).getChainInfo()) as never
        );
        const proven = await (
            wallet as never as {
                pxe: { proveTx(r: unknown, o: unknown): Promise<never> };
            }
        ).pxe.proveTx(req, { scopes: [player] });
        const tx = await (proven as never as { toTx(): Promise<never> }).toTx();
        await node.sendTx(tx as never);
        const receipt = await waitForTx(
            node,
            (tx as never as { getTxHash(): never }).getTxHash()
        );

        const fee = (receipt as { transactionFee?: bigint })?.transactionFee;
        const label = first ? 'first-of-day' : 'subsequent';
        console.log(
            `\n  ${label.padEnd(13)} fee ${fee ? formatFeeJuiceWei(fee) : 'unknown'}  (${fee} wei)`
        );
        if (typeof fee === 'bigint') {
            results.push({ label, feeWei: fee.toString() });
        }
    }

    const after = await getFeeJuiceBalance(fpcAddress, node);
    console.log(
        `\n  paymaster balance ${formatFeeJuiceWei(before)} -> ${formatFeeJuiceWei(after)}`
    );
    console.log(`  actually spent    ${formatFeeJuiceWei(before - after)}`);

    if (jsonOut) {
        const fs = await import('node:fs');
        fs.writeFileSync(jsonOut, `${JSON.stringify(results, null, 2)}\n`);
        console.log(`\n  measurements written to ${jsonOut}`);
    }
    console.log();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
