import { DARK_FOREST_REFERENCE_GAS_PROFILE } from '@alejoamiras/quota-paymaster';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { AztecNode } from '@aztec/aztec.js/node';
import type { Wallet } from '@aztec/aztec.js/wallet';
import { SponsoredFpcClient } from '@dfarchon/sponsored-fpc';

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
    const client = new SponsoredFpcClient({
        wallet: args.wallet,
        node: args.node,
        address: fpcAddress,
        gasProfile: DARK_FOREST_REFERENCE_GAS_PROFILE,
        nodeUrl: process.env.AZTEC_NODE_URL ?? 'http://127.0.0.1:8080',
    });
    const txHash = await client.sendCalls(args.calls, args.player);
    return { txHash: String(txHash) };
}
