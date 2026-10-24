import {
    DARK_FOREST_REFERENCE_GAS_PROFILE,
    maxFeePerGasWithHeadroom,
} from '@alejoamiras/quota-paymaster';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import { Fr } from '@aztec/aztec.js/fields';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { DefaultEntrypoint } from '@aztec/entrypoints/default';
import { EncodedAppEntrypointCalls } from '@aztec/entrypoints/encoding';
import { Gas, GasFees, GasSettings } from '@aztec/stdlib/gas';
import { ExecutionPayload } from '@aztec/stdlib/tx';

import {
    SponsoredFpcContract,
    SponsoredFpcContractArtifact,
} from '../artifacts/SponsoredFpc.ts';

export async function sendWithSponsoredFpc(args: {
    wallet: Wallet;
    node: AztecNode;
    player: AztecAddress;
    calls: unknown[];
}): Promise<{ txHash: string }> {
    const addressValue = process.env.SPONSORED_FPC_CONTRACT_ADDRESS;
    if (!addressValue)
        throw new Error('SPONSORED_FPC_CONTRACT_ADDRESS is not set');
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

    await wallet.registerContractClass(SponsoredFpcContractArtifact);
    const instance = await args.node.getContract(fpcAddress);
    if (!instance)
        throw new Error(`SponsoredFpc is not deployed at ${fpcAddress}`);
    await wallet.registerContract(instance, SponsoredFpcContractArtifact);
    const fpc = SponsoredFpcContract.at(fpcAddress, wallet);

    const encodedCalls = await EncodedAppEntrypointCalls.create(
        args.calls as never,
        Fr.random()
    );
    const authWitness = await wallet.createAuthWit(args.player, {
        consumer: args.player,
        innerHash: await encodedCalls.hash(),
    });
    const outer = await fpc.methods
        .sponsor_and_execute(encodedCalls as never, args.player)
        .request();
    const payload = new ExecutionPayload(
        outer.calls,
        [authWitness, ...outer.authWitnesses],
        [...outer.capsules],
        [...encodedCalls.hashedArguments, ...outer.extraHashedArgs],
        fpcAddress
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
    return { txHash: String(txHash) };
}
