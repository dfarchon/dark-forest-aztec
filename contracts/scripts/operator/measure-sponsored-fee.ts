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

    // Both contracts already exist on chain, so their instances come from the
    // node rather than from instantiation params. Registering them is not
    // optional: `.at()` only builds a typed handle, and simulating a private
    // call needs the ARTIFACT in the local PXE. A PXE that happens to know them
    // (because it deployed them earlier in its own store) hides this — which is
    // why it worked during the original measurement and failed the first time
    // it ran against an existing deployment from a fresh store.
    const registerExisting = async (
        address: AztecAddress,
        artifact: unknown
    ) => {
        const instance = await (
            node as unknown as {
                getContract(a: AztecAddress): Promise<unknown>;
            }
        ).getContract(address);
        if (!instance) {
            throw new Error(
                `No contract deployed at ${address.toString()} on ${nodeUrl}`
            );
        }
        await (
            wallet as unknown as {
                registerContract(i: unknown, a: unknown): Promise<void>;
            }
        ).registerContract(instance, artifact);
    };

    const fpcAddress = AztecAddress.fromStringUnsafe(fpc);
    const targetAddress = AztecAddress.fromStringUnsafe(target);
    const { QuotaFpcContractArtifact } =
        await import('../artifacts/QuotaFpc.js');
    const { FpcTestTargetContractArtifact } =
        await import('../artifacts/FpcTestTarget.js');
    await registerExisting(fpcAddress, QuotaFpcContractArtifact);
    await registerExisting(targetAddress, FpcTestTargetContractArtifact);

    const paymaster = await QuotaFpcContract.at(fpcAddress, wallet as never);
    const app = await FpcTestTargetContract.at(targetAddress, wallet as never);

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

    // Never ask for more transactions than the allowance can actually cover.
    // Without this the run ends on a failure that looks like a defect but is
    // the policy working exactly as intended — and, worse, the exhausted state
    // is indistinguishable from "the note has not synced yet", since
    // get_quota_info reports (false, 0) for both.
    const remainingNow = alreadySubscribed
        ? Number((info as [boolean, number])[1])
        : Number.MAX_SAFE_INTEGER;
    const affordable = Math.min(count, remainingNow);
    if (affordable < count) {
        console.log(
            `  NOTE: asked for ${count}, but this player has ${remainingNow} sponsored transaction(s)\n` +
                `  left today. Measuring ${affordable}. The daily allowance resets at 00:00 UTC.`
        );
    }

    const results: { label: string; feeWei: string }[] = [];
    for (let i = 0; i < affordable; i++) {
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

        // The allowance note this transaction just wrote is not visible to the
        // local PXE the instant the transaction settles, and the NEXT iteration
        // needs it — `sponsor_and_execute` pops the note and asserts it found
        // one. Firing straight into the next send makes a healthy paymaster
        // report "No sponsored transactions remaining" purely because this
        // process outran its own note sync.
        //
        // The game client meets the same race and handles it properly, by
        // treating a sync-pending allowance as retryable rather than as
        // exhausted. This is only a measurement tool, so it waits instead.
        if (i + 1 < affordable) {
            const deadline = Date.now() + 120_000;
            for (;;) {
                const raw: unknown = await paymaster.methods
                    .get_quota_info(player, generation)
                    .simulate({ from: player });
                const info = (raw as { result?: unknown }).result ?? raw;
                if ((info as [boolean, number])[0]) break;
                if (Date.now() > deadline) {
                    throw new Error(
                        'Allowance never became visible to the local PXE; ' +
                            'the transaction settled but its note did not sync.'
                    );
                }
                await new Promise((r) => setTimeout(r, 3_000));
            }
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
