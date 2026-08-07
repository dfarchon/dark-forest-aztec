/**
 * Measures what a SPONSORED transaction actually costs the paymaster.
 *
 *   pnpm --filter contracts run measure-sponsored-fee -- \
 *     --fpc 0x… --target 0x… --artifact Core --method some_method --count 3
 *
 * Thin CLI over @alejoamiras/quota-paymaster: the measurement loop (seat vs
 * subsequent, allowance-visibility waits, receipt-vs-balance cross-check) is
 * the operator's `measureSponsoredFee`; the sandwich assembly and non-retrying
 * broadcast are the SDK's. This file supplies the target interaction —
 * `--artifact` names an artifact module under @dfpunk/contracts (the game's
 * own compiled contracts), since the paymaster only sponsors allowlisted
 * targets and those are, by definition, the app's.
 */
import {
    buildSandwichPayload,
    createSendOnceContext,
    DARK_FOREST_REFERENCE_GAS_PROFILE,
    findFreeSeat,
    generationAt,
    hasSubscribed,
} from '@alejoamiras/quota-paymaster';
import { formatFeeJuiceWei } from '@alejoamiras/quota-paymaster/operator';
import { AztecAddress } from '@aztec/aztec.js/addresses';

import { getOptionalEnv, loadContractsEnv } from '../utils/env.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';
import { getOrCreateAccount, setupWallet } from '../utils/wallet.js';
import { argvOf, opt } from './confirm.js';

const PROFILE = DARK_FOREST_REFERENCE_GAS_PROFILE;

async function main() {
    const argv = argvOf();
    const fpc = opt(argv, '--fpc');
    const target = opt(argv, '--target');
    const artifactName = opt(argv, '--artifact');
    const method = opt(argv, '--method') ?? 'ping';
    if (!fpc || !target || !artifactName) {
        throw new Error(
            'Usage: measure-sponsored-fee --fpc 0x… --target 0x… --artifact <Name> [--method ping] [--count 2]'
        );
    }
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const node = createTolerantAztecNodeClient(nodeUrl);
    const wallet = await setupWallet(node);
    const player = await getOrCreateAccount(wallet, node);
    const fpcAddress = AztecAddress.fromStringUnsafe(fpc);
    const targetAddress = AztecAddress.fromStringUnsafe(target);

    // Register the paymaster (package artifact) and the target (the app's own
    // artifact) — `.at()` alone leaves a fresh PXE without the artifacts.
    const { QuotaFpcContractArtifact } =
        await import('@alejoamiras/quota-paymaster/artifacts/quota-fpc');
    const fpcInstance = await (
        node as unknown as { getContract(a: AztecAddress): Promise<unknown> }
    ).getContract(fpcAddress);
    if (!fpcInstance) throw new Error(`No paymaster deployed at ${fpc}`);
    await (
        wallet as unknown as {
            registerContract(i: unknown, a: unknown): Promise<void>;
        }
    ).registerContract(fpcInstance, QuotaFpcContractArtifact);
    const artifactMod = (await import(
        `@dfpunk/contracts/artifacts/${artifactName}`
    )) as Record<string, unknown>;
    const artifact = artifactMod[`${artifactName}ContractArtifact`];
    const contractClass = artifactMod[`${artifactName}Contract`] as {
        at(
            a: AztecAddress,
            w: unknown
        ): Promise<{ methods: Record<string, (...args: never[]) => unknown> }>;
    };
    const instance = await (
        node as unknown as { getContract(a: AztecAddress): Promise<unknown> }
    ).getContract(targetAddress);
    if (!instance) throw new Error(`No contract deployed at ${target}`);
    await (
        wallet as unknown as {
            registerContract(i: unknown, a: unknown): Promise<void>;
        }
    ).registerContract(instance, artifact);
    const app = await contractClass.at(targetAddress, wallet as never);
    const { QuotaFpcContract } =
        await import('@alejoamiras/quota-paymaster/artifacts/quota-fpc');
    const paymaster = await QuotaFpcContract.at(fpcAddress, wallet as never);

    const { measureSponsoredFee } =
        await import('@alejoamiras/quota-paymaster/operator');
    const { DefaultEntrypoint } = await import('@aztec/entrypoints/default');
    const { Gas, GasSettings } = await import('@aztec/stdlib/gas');
    const { waitForTx } = await import('@aztec/aztec.js/node');
    const ctx = createSendOnceContext(nodeUrl);

    const readQuotaInfo = async () => {
        const raw: unknown = await (
            paymaster as unknown as {
                methods: {
                    get_quota_info(
                        p: AztecAddress,
                        g: number
                    ): { simulate(o: unknown): Promise<unknown> };
                };
            }
        ).methods
            .get_quota_info(player, await currentGeneration())
            .simulate({ from: player });
        const info = ((raw as { result?: unknown }).result ?? raw) as [
            boolean,
            number,
        ];
        return { hasAllowance: Boolean(info[0]), remaining: Number(info[1]) };
    };
    const currentGeneration = async () => {
        const block = await node.getBlockData('latest');
        return generationAt(BigInt(block!.header.globalVariables.timestamp));
    };

    const result = await measureSponsoredFee(
        {
            node: node as never,
            fpcAddress,
            readQuotaInfo,
            onProgress: (msg) => console.log(`  ${msg}`),
            sendSponsored: async (i) => {
                const generation = await currentGeneration();
                const first =
                    i === 0 &&
                    !(await hasSubscribed({
                        node: node as never,
                        fpcAddress,
                        generation,
                        player,
                    }));
                const seat = first
                    ? await findFreeSeat({
                          node: node as never,
                          fpcAddress,
                          generation,
                          maxUsers: 100,
                      })
                    : undefined;
                const requested = await (
                    app.methods[method](...([] as never[])) as {
                        request(): Promise<unknown>;
                    }
                ).request();
                const calls =
                    (requested as { calls?: unknown[] }).calls ?? requested;
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
                    gasLimits: new Gas(PROFILE.daGasLimit, PROFILE.l2GasLimit),
                    teardownGasLimits: new Gas(
                        PROFILE.teardownDaGasLimit,
                        PROFILE.teardownL2GasLimit
                    ),
                    maxFeesPerGas: (await node.getCurrentMinFees()).mul(
                        PROFILE.feeHeadroomMultiplier
                    ),
                });
                const w = wallet as unknown as {
                    pxe: {
                        proveTx(
                            r: unknown,
                            o: unknown
                        ): Promise<{ toTx(): Promise<unknown> }>;
                    };
                    getChainInfo(): Promise<unknown>;
                };
                const req =
                    await new DefaultEntrypoint().createTxExecutionRequest(
                        payload as never,
                        gasSettings,
                        (await w.getChainInfo()) as never
                    );
                const receipt = await ctx.attemptSend(async () => {
                    const proven = await w.pxe.proveTx(req, {
                        scopes: [player],
                    });
                    const tx = await proven.toTx();
                    await ctx.node.sendTx(tx as never);
                    return waitForTx(
                        ctx.node,
                        (tx as { getTxHash(): never }).getTxHash()
                    );
                });
                const fee = (receipt as { transactionFee?: bigint })
                    .transactionFee;
                if (typeof fee !== 'bigint') {
                    throw new Error('receipt carried no transactionFee');
                }
                return { transactionFeeWei: fee };
            },
        },
        { count: Number(opt(argv, '--count') ?? '2') }
    );

    console.log(`\nMeasured ${result.perTransactionWei.length} transactions:`);
    result.perTransactionWei.forEach((wei, i) =>
        console.log(`  #${i + 1}  ${formatFeeJuiceWei(wei)}`)
    );
    console.log(
        `  receipts total ${formatFeeJuiceWei(result.totalFromReceiptsWei)} | balance delta ${formatFeeJuiceWei(result.balanceDeltaWei)}`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
