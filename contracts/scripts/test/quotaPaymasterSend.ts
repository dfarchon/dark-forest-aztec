import {
    buildSandwichPayload,
    DARK_FOREST_REFERENCE_GAS_PROFILE,
    findFreeSeat,
    generationAt,
    maxFeePerGasWithHeadroom,
} from '@alejoamiras/quota-paymaster';
import {
    QuotaFpcContract,
    QuotaFpcContractArtifact,
} from '@alejoamiras/quota-paymaster/artifacts/quota-fpc';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { DefaultEntrypoint } from '@aztec/entrypoints/default';
import { Gas, GasFees, GasSettings } from '@aztec/stdlib/gas';

export async function sendWithQuotaPaymaster(args: {
    wallet: Wallet;
    node: AztecNode;
    player: AztecAddress;
    calls: unknown[];
}): Promise<{ txHash: string; generation: number; seat?: number }> {
    const addressValue = process.env.QUOTA_FPC_CONTRACT_ADDRESS;
    if (!addressValue) throw new Error('QUOTA_FPC_CONTRACT_ADDRESS is not set');
    const fpcAddress = AztecAddress.fromStringUnsafe(addressValue);
    const wallet = args.wallet as Wallet & {
        pxe: {
            proveTx(
                request: unknown,
                opts: { scopes: AztecAddress[] }
            ): Promise<{
                toTx(): Promise<{ getTxHash(): unknown }>;
            }>;
        };
        getChainInfo(): Promise<unknown>;
        registerContractClass(artifact: unknown): Promise<void>;
        registerContract(instance: unknown, artifact?: unknown): Promise<void>;
    };

    await wallet.registerContractClass(QuotaFpcContractArtifact);
    const instance = await args.node.getContract(fpcAddress);
    if (!instance) throw new Error(`QuotaFpc is not deployed at ${fpcAddress}`);
    await wallet.registerContract(instance, QuotaFpcContractArtifact);
    const fpc = QuotaFpcContract.at(fpcAddress, wallet);

    const block = await args.node.getBlockData('latest');
    if (!block) throw new Error('Could not load the latest block');
    const generation = generationAt(
        BigInt(block.header.globalVariables.timestamp)
    );
    const quotaResponse = await fpc.methods
        .get_quota_info(args.player, generation)
        .simulate({ from: args.player });
    const quotaRaw =
        (quotaResponse as unknown as { result?: unknown }).result ??
        quotaResponse;
    const [subscribed, remaining] = quotaRaw as unknown as [boolean, bigint];

    let seat: number | undefined;
    if (!subscribed || Number(remaining) === 0) {
        const policyResponse = await fpc.methods.get_policy().simulate({
            from: args.player,
        });
        const policy = ((policyResponse as unknown as { result?: unknown })
            .result ?? policyResponse) as unknown as { max_users: bigint };
        const available = await findFreeSeat({
            node: args.node as never,
            fpcAddress,
            generation,
            maxUsers: Number(policy.max_users),
        });
        if (available === null) throw new Error('QuotaFpc has no free seat');
        seat = available;
    }

    console.log(
        `   Quota before: generation=${generation}, subscribed=${subscribed}, remaining=${remaining}${seat === undefined ? '' : `, seat=${seat}`}`
    );
    const payload = await buildSandwichPayload(
        {
            calls: args.calls as never,
            player: args.player,
            fpcAddress,
            generation,
            seat,
        },
        wallet as never,
        fpc as never
    );

    const profile = DARK_FOREST_REFERENCE_GAS_PROFILE;
    const fees = await args.node.getCurrentMinFees();
    const gasSettings = GasSettings.fallback({
        gasLimits: new Gas(profile.daGasLimit, profile.l2GasLimit),
        teardownGasLimits: new Gas(
            profile.teardownDaGasLimit,
            profile.teardownL2GasLimit
        ),
        maxFeesPerGas: new GasFees(
            maxFeePerGasWithHeadroom(profile, BigInt(fees.feePerDaGas)),
            maxFeePerGasWithHeadroom(profile, BigInt(fees.feePerL2Gas))
        ),
    });
    const request = await new DefaultEntrypoint().createTxExecutionRequest(
        payload,
        gasSettings,
        (await wallet.getChainInfo()) as never
    );
    const proven = await wallet.pxe.proveTx(request, { scopes: [args.player] });
    const tx = await proven.toTx();
    const txHash = tx.getTxHash();
    await args.node.sendTx(tx as never);
    return { txHash: String(txHash), generation, seat };
}
