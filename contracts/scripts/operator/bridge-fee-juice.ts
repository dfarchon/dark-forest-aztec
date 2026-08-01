/**
 * Bridges real $AZTEC from L1 into Aztec fee juice.
 *
 *   pnpm --filter contracts run bridge-fee-juice -- --to 0x… --amount 50
 *
 * This is the step the paymaster exists to spare players from, and it is
 * genuinely one-way: fee juice cannot be moved or withdrawn once it lands, by
 * anyone, ever. Bridge only what you accept losing.
 *
 * Two audiences:
 *   - the DEPLOYER account, which needs juice before it can send anything on
 *     mainnet (the canonical SponsoredFPC has no balance there, so a fresh
 *     account genuinely cannot transact until this runs), and
 *   - the PAYMASTER itself, which is what actually funds sponsorship.
 *
 * The L1 side needs $AZTEC to bridge and ETH for gas. Bridging is asynchronous:
 * the L2 claim only becomes available once the message has been included, which
 * on mainnet takes a couple of L2 blocks. The claim is printed so a later
 * transaction can redeem it with FeeJuicePaymentMethodWithClaim — a fresh
 * account has no juice to pay for its own claim, so the claim rides along with
 * its first real transaction instead.
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';

import {
    getOptionalEnv,
    getRequiredEnv,
    loadContractsEnv,
} from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';

const FJ = 10n ** 18n;

function parseArgs(argv: string[]) {
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i === -1 ? undefined : argv[i + 1];
    };
    const to = get('--to');
    const amount = get('--amount');
    if (!to || !amount) {
        throw new Error(
            'Usage: bridge-fee-juice --to <l2-address> --amount <whole AZTEC> [--dry-run]'
        );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(to)) {
        throw new Error(`--to is not a 32-byte Aztec address: ${to}`);
    }
    if (!/^\d+$/.test(amount)) {
        throw new Error(
            `--amount must be a whole number of AZTEC, got ${amount}`
        );
    }
    return {
        to,
        amount: BigInt(amount) * FJ,
        dryRun: argv.includes('--dry-run'),
    };
}

async function main() {
    const { to, amount, dryRun } = parseArgs(process.argv.slice(2));
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const l1Rpc = getOptionalEnv('ETHEREUM_HOST') ?? 'http://localhost:8545';
    const l1Key = getRequiredEnv('L1_PRIVATE_KEY');

    const node = createTolerantAztecNodeClient(nodeUrl);
    const info = await node.getNodeInfo();

    const { createEthereumChain } = await import('@aztec/ethereum/chain');
    const { createExtendedL1Client } = await import('@aztec/ethereum/client');
    const { L1FeeJuicePortalManager } =
        await import('@aztec/aztec.js/ethereum');
    const { createLogger } = await import('@aztec/foundation/log');

    const chain = createEthereumChain([l1Rpc], info.l1ChainId);
    const l1Client = createExtendedL1Client(
        chain.rpcUrls,
        l1Key,
        chain.chainInfo
    );
    const l1Address = l1Client.account.address;

    console.log(`\nBridging fee juice`);
    console.log(`  L2 node      ${nodeUrl}`);
    console.log(`  L1 chain     ${info.l1ChainId}  via ${l1Rpc}`);
    console.log(`  from (L1)    ${l1Address}`);
    console.log(`  to (L2)      ${to}`);
    console.log(`  amount       ${formatFeeJuiceWei(amount)}`);
    console.log(
        `\n  This is IRREVERSIBLE. Fee juice cannot be withdrawn or transferred by anyone.`
    );

    if (dryRun) {
        console.log('\nDry run: nothing was sent.\n');
        return;
    }

    const portal = await L1FeeJuicePortalManager.new(
        node,
        l1Client,
        createLogger('quota-fpc:bridge')
    );
    // mint=false: on a real network the tokens must already be held. Passing
    // true here is a local-only convenience and would simply revert.
    const claim = await portal.bridgeTokensPublic(
        AztecAddress.fromStringUnsafe(to),
        amount,
        false
    );

    console.log(`\nBridged. The L2 claim is:`);
    console.log(`  QUOTA_FPC_CLAIM_AMOUNT=${claim.claimAmount}`);
    console.log(`  QUOTA_FPC_CLAIM_SECRET=${claim.claimSecret}`);
    console.log(`  QUOTA_FPC_CLAIM_MESSAGE_HASH=${claim.messageHash}`);
    console.log(`  QUOTA_FPC_CLAIM_LEAF_INDEX=${claim.messageLeafIndex}`);
    console.log(
        `\nThe claim is not spendable until the L1->L2 message is included — a couple of\n` +
            `L2 blocks. Check with 'read:claim-ready', then redeem it by attaching\n` +
            `FeeJuicePaymentMethodWithClaim to the recipient's first transaction.\n`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
