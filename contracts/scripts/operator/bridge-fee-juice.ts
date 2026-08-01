/**
 * Bridges real $AZTEC from L1 into Aztec fee juice.
 *
 *   pnpm --filter contracts run bridge-fee-juice -- --to 0x… --amount 50 --yes
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
 * WHY THIS DOES NOT CALL `bridgeTokensPublic`
 * -------------------------------------------
 * The SDK's one-liner generates the claim secret INSIDE the call and returns it
 * only after the L1 deposit has mined. In that window the secret exists nowhere
 * but process memory, and a crash, disconnect, or RPC hiccup destroys it — with
 * it, the entire deposit, because fee juice whose claim preimage is lost cannot
 * be redeemed by anyone, ever. No amount of logging after the fact closes that
 * window; the ordering is what matters.
 *
 * So the deposit is assembled here from the same SDK pieces, in the one order
 * that is safe: generate the secret, fsync it to a journal OUTSIDE the repo,
 * and only then touch L1. Everything after the deposit — the message key, the
 * leaf index — is recoverable by re-reading the L1 logs. The secret is the only
 * part that is not, so it is the only part that must exist on disk beforehand.
 *
 * The L1 side needs $AZTEC to bridge and ETH for gas. Bridging is asynchronous:
 * the L2 claim only becomes available once the message has been included, which
 * on mainnet takes a couple of L2 blocks. The claim is printed so a later
 * transaction can redeem it with FeeJuicePaymentMethodWithClaim — a fresh
 * account has no juice to pay for its own claim, so the claim rides along with
 * its first real transaction instead.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    getOptionalEnv,
    getRequiredEnv,
    loadContractsEnv,
} from '../utils/env.js';
import { formatFeeJuiceWei } from '../utils/feeJuiceUnits.js';
import { createTolerantAztecNodeClient } from '../utils/nodeClient.js';

const FJ = 10n ** 18n;

/**
 * Default journal location, deliberately OUTSIDE the repository.
 *
 * This file holds claim secrets. A path inside the working tree is one
 * `git add -A` away from being published, and .gitignore only protects the
 * paths someone remembered to list. Putting it in the home directory means no
 * repository operation can ever pick it up.
 */
function defaultJournalPath(): string {
    return path.join(os.homedir(), '.aztec-fee-juice-bridge.jsonl');
}

/**
 * Append one record and do not return until the bytes are on the platter.
 *
 * `appendFileSync` alone is not enough: it returns once the write reaches the
 * OS page cache, so a crash or power loss in the next instant loses it — which
 * is exactly the failure this journal exists to survive. The explicit `fsync`
 * is the whole point. The mode argument only applies when the file is created,
 * so the permissions are re-asserted on every write.
 */
function journalSync(journalPath: string, record: unknown): void {
    const fd = fs.openSync(journalPath, 'a', 0o600);
    try {
        fs.writeSync(fd, `${JSON.stringify(record)}\n`);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    fs.chmodSync(journalPath, 0o600);
}

function parseArgs(argv: string[]) {
    const get = (flag: string) => {
        const i = argv.indexOf(flag);
        return i === -1 ? undefined : argv[i + 1];
    };
    const to = get('--to');
    const amount = get('--amount');
    if (!to || !amount) {
        throw new Error(
            'Usage: bridge-fee-juice --to <l2-address> --amount <whole AZTEC> [--yes] [--dry-run] [--journal <path>]'
        );
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(to)) {
        throw new Error(`--to is not a 32-byte Aztec address: ${to}`);
    }
    // A zero recipient would burn the deposit outright: the claim would be
    // payable to nobody, and there is no refund path.
    if (/^0x0+$/.test(to)) {
        throw new Error('--to is the zero address; the deposit would be lost');
    }
    if (!/^\d+$/.test(amount) || BigInt(amount) === 0n) {
        throw new Error(
            `--amount must be a positive whole number of AZTEC, got ${amount}`
        );
    }
    return {
        to,
        amount: BigInt(amount) * FJ,
        dryRun: argv.includes('--dry-run'),
        yes: argv.includes('--yes'),
        journalPath: get('--journal') ?? defaultJournalPath(),
    };
}

async function main() {
    const { to, amount, dryRun, yes, journalPath } = parseArgs(
        process.argv.slice(2)
    );
    loadContractsEnv({ optional: true } as never);

    const nodeUrl = getOptionalEnv('AZTEC_NODE_URL') ?? 'http://localhost:8080';
    const l1Rpc = getOptionalEnv('ETHEREUM_HOST') ?? 'http://localhost:8545';
    const l1Key = getRequiredEnv('L1_PRIVATE_KEY');

    const node = createTolerantAztecNodeClient(nodeUrl);
    const info = await node.getNodeInfo();
    const portalAddress = info.l1ContractAddresses.feeJuicePortalAddress;
    const tokenAddress = info.l1ContractAddresses.feeJuiceAddress;
    if (portalAddress.isZero() || tokenAddress.isZero()) {
        throw new Error('Fee juice portal or token is not deployed on this L1');
    }

    const { createEthereumChain } = await import('@aztec/ethereum/chain');
    const { createExtendedL1Client } = await import('@aztec/ethereum/client');
    const { L1FeeJuicePortalManager, generateClaimSecret } =
        await import('@aztec/aztec.js/ethereum');
    const { FeeJuicePortalAbi } =
        await import('@aztec/l1-artifacts/FeeJuicePortalAbi');
    const { extractEvent } = await import('@aztec/ethereum/utils');
    const { createLogger } = await import('@aztec/foundation/log');

    const logger = createLogger('quota-fpc:bridge');
    const chain = createEthereumChain([l1Rpc], info.l1ChainId);
    const l1Client = createExtendedL1Client(
        chain.rpcUrls,
        l1Key,
        chain.chainInfo
    );
    const l1Address = l1Client.account.address;
    const portalHex = portalAddress.toString() as `0x${string}`;

    console.log(`\nBridging fee juice`);
    console.log(`  L2 node      ${nodeUrl}`);
    console.log(`  L1 chain     ${info.l1ChainId}  via ${l1Rpc}`);
    console.log(`  from (L1)    ${l1Address}`);
    console.log(`  to (L2)      ${to}`);
    console.log(`  amount       ${formatFeeJuiceWei(amount)}`);
    console.log(`  portal       ${portalHex}`);
    console.log(`  journal      ${journalPath}`);
    console.log(
        `\n  This is IRREVERSIBLE. Fee juice cannot be withdrawn or transferred by anyone.`
    );

    if (dryRun) {
        console.log('\nDry run: nothing was sent.\n');
        return;
    }
    if (!yes) {
        console.error(
            `\nRefusing: this spends real funds and cannot be undone.\n` +
                `Re-run with --yes once the recipient and amount above are correct.\n`
        );
        process.exit(2);
    }

    // ---- The secret comes first, and reaches disk before anything else. ----
    const [claimSecret, claimSecretHash] = await generateClaimSecret();
    journalSync(journalPath, {
        state: 'SECRET_GENERATED',
        at: new Date().toISOString(),
        node: nodeUrl,
        l1Chain: info.l1ChainId,
        from: l1Address,
        to,
        amountWei: amount.toString(),
        claimSecret: claimSecret.toString(),
        claimSecretHash: claimSecretHash.toString(),
        note: 'If no DEPOSIT_CONFIRMED line follows, check L1 for a DepositToAztecPublic log carrying this secretHash — the key and index are recoverable from it, and this secret is what redeems it.',
    });

    // Approval is a separate, reversible L1 write; the SDK's token manager
    // already knows the ERC20 quirks, so there is no reason to reimplement it.
    const portal = await L1FeeJuicePortalManager.new(node, l1Client, logger);
    await portal
        .getTokenManager()
        .approve(amount, portalHex, 'FeeJuice Portal');

    const args = [to, amount, claimSecretHash.toString()] as const;
    // Simulate first: a revert here costs nothing, whereas a reverted deposit
    // costs gas and tells us less.
    await l1Client.simulateContract({
        address: portalHex,
        abi: FeeJuicePortalAbi,
        functionName: 'depositToAztecPublic',
        args: args as never,
    });

    // The inbox write is hard to estimate tightly and an out-of-gas revert here
    // would be the expensive kind of failure, so double the estimate — the same
    // 100% buffer the SDK's own inbox deposit path applies.
    const gasEstimate = await l1Client.estimateContractGas({
        address: portalHex,
        abi: FeeJuicePortalAbi,
        functionName: 'depositToAztecPublic',
        args: args as never,
        account: l1Client.account,
    } as never);
    const hash = await l1Client.writeContract({
        address: portalHex,
        abi: FeeJuicePortalAbi,
        functionName: 'depositToAztecPublic',
        args: args as never,
        gas: gasEstimate * 2n,
    } as never);
    console.log(`\n  L1 deposit tx ${hash}`);
    const receipt = await l1Client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
        throw new Error(`L1 deposit reverted: ${hash}`);
    }

    // key + index identify the L1->L2 message. Unlike the secret, these are
    // permanently readable from the L1 logs, so losing them here is recoverable.
    const log = extractEvent(
        receipt.logs,
        portalHex,
        FeeJuicePortalAbi,
        'DepositToAztecPublic',
        (l: { args: { secretHash: string; amount: bigint; to: string } }) =>
            l.args.secretHash.toLowerCase() ===
                claimSecretHash.toString().toLowerCase() &&
            l.args.amount === amount &&
            l.args.to.toLowerCase() === to.toLowerCase(),
        logger
    );

    journalSync(journalPath, {
        state: 'DEPOSIT_CONFIRMED',
        at: new Date().toISOString(),
        l1TxHash: hash,
        to,
        amountWei: amount.toString(),
        claimSecret: claimSecret.toString(),
        claimSecretHash: claimSecretHash.toString(),
        messageHash: log.args.key,
        messageLeafIndex: log.args.index.toString(),
    });

    console.log(`\nBridged. The L2 claim is:`);
    console.log(`  QUOTA_FPC_CLAIM_AMOUNT=${amount}`);
    console.log(`  QUOTA_FPC_CLAIM_SECRET=${claimSecret}`);
    console.log(`  QUOTA_FPC_CLAIM_MESSAGE_HASH=${log.args.key}`);
    console.log(`  QUOTA_FPC_CLAIM_LEAF_INDEX=${log.args.index}`);
    console.log(
        `\nAlso journalled to ${journalPath} (0600).\n` +
            `The claim is not spendable until the L1->L2 message is included — a couple of\n` +
            `L2 blocks. Check with 'read:claim-ready', then redeem it by attaching\n` +
            `FeeJuicePaymentMethodWithClaim to the recipient's first transaction.\n`
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
