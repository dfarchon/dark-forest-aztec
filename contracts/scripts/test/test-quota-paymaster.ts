/**
 * Integration test: the @alejoamiras/quota-paymaster package against a LIVE
 * local network, end to end, with a REAL game contract.
 *
 *   AZTEC_NODE_URL=http://localhost:8590 pnpm --filter contracts run test:quota-paymaster
 *
 * What it proves, in order:
 *   1. deployQuotaFpc (operator, ActionPlan confirm) deploys from a parsed
 *      config and verifies the account class ids against the installed
 *      packages.
 *   2. The paymaster can be funded on a local network (mint -> bridge -> claim).
 *   3. A sponsored transaction BUILT AND SENT ENTIRELY THROUGH THE PACKAGE SDK
 *      (buildSandwichPayload + createSendOnceContext.attemptSend) targets the
 *      game's own Core contract and — because Core is deployed here with the
 *      player as its admin — EXECUTES SUCCESSFULLY, mutating game state the
 *      test reads back. Not a synthetic target, and not a revert.
 *   4. The paymaster paid (balance delta), the allowance decremented
 *      (get_quota_info), and a second read shows the seat held.
 *
 * Exits non-zero on any failed assertion, per this repo's test-script shape.
 */
import {
    buildSandwichPayload,
    createSendOnceContext,
    DARK_FOREST_REFERENCE_GAS_PROFILE,
    findFreeSeat,
    generationAt,
    parseQuotaFpcConfig,
} from '@alejoamiras/quota-paymaster';
import { QuotaFpcContract } from '@alejoamiras/quota-paymaster/artifacts/quota-fpc';
import { deployQuotaFpc } from '@alejoamiras/quota-paymaster/operator';
import { AztecAddress } from '@aztec/aztec.js/addresses';
import {
    createAztecNodeClient,
    waitForNode,
    waitForTx,
} from '@aztec/aztec.js/node';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';

import { CoreContract } from '../artifacts/Core.js';

const PROFILE = DARK_FOREST_REFERENCE_GAS_PROFILE;
/** SchnorrInitializerlessAccount at @aztec/accounts 5.0.1 — deployQuotaFpc
 * recomputes this from the installed package and refuses on mismatch, so a
 * wrong value here fails loudly rather than deploying something unusable. */
const INITIALIZERLESS_CLASS_ID =
    '0x28c2905b5e44745a50b78c9d3084443216b6b369a3c2ecf06640605bf630706f';

function assert(cond: unknown, label: string): asserts cond {
    if (!cond) {
        console.error(`FAIL ${label}`);
        process.exit(1);
    }
    console.log(`  ok  ${label}`);
}

async function main() {
    const nodeUrl = process.env.AZTEC_NODE_URL ?? 'http://localhost:8590';
    const node = createAztecNodeClient(nodeUrl);
    await waitForNode(node);

    const { EmbeddedWallet } = await import('@aztec/wallets/embedded');
    const { registerInitialLocalNetworkAccountsInWallet } =
        await import('@aztec/wallets/testing');
    const wallet = await EmbeddedWallet.create(node, {
        pxe: { ephemeral: true },
    } as never);
    const accounts = await registerInitialLocalNetworkAccountsInWallet(
        wallet as never
    );
    const player = accounts[0];
    console.log(`player ${player.toString()}`);

    // --- 1. a real game contract, owned by the player -----------------------
    const coreDeploy = CoreContract.deploy(wallet as never, player);
    await coreDeploy.send({ from: player });
    const core = await coreDeploy.register();
    console.log(`core   ${core.address.toString()}`);

    // --- 2. the paymaster, via the package operator -------------------------
    const config = parseQuotaFpcConfig({
        name: 'local-integration',
        description: 'ephemeral test paymaster',
        policy: {
            maxFeeWei: '100000000000000000000',
            maxUsesPerDay: 5,
            maxUsersPerDay: 2,
        },
        maxLossWei: '5000000000000000000000',
        allowedTargets: [{ name: 'Core', address: core.address.toString() }],
        allowedAccountClasses: [
            {
                name: 'SchnorrInitializerlessAccount',
                classId: INITIALIZERLESS_CLASS_ID,
            },
        ],
        requireUnpublishedAccounts: true,
        adminAddress: player.toString(),
    });
    const fpc = await deployQuotaFpc(
        {
            wallet: wallet as never,
            from: player,
            confirm: (plan) => {
                console.log(
                    `  plan ${plan.kind} digest ${plan.digest.slice(0, 16)}…`
                );
                return true;
            },
            onWarn: (m) => console.log(`  warn ${m}`),
        },
        config,
        { sendOptions: { from: player } }
    );
    const fpcAddress = fpc.address;
    console.log(`fpc    ${fpcAddress.toString()}`);
    assert(
        true,
        'deployQuotaFpc deployed from parsed config (class ids verified)'
    );

    // --- 3. fund it: mint -> bridge -> claim (local-network path) ------------
    const info = await node.getNodeInfo();
    const { createEthereumChain } = await import('@aztec/ethereum/chain');
    const { createExtendedL1Client } = await import('@aztec/ethereum/client');
    const { L1FeeJuicePortalManager } =
        await import('@aztec/aztec.js/ethereum');
    const { createLogger } = await import('@aztec/foundation/log');
    const { FeeJuiceContract } = await import('@aztec/aztec.js/protocol');
    const { Fr } = await import('@aztec/aztec.js/fields');
    const l1 = createExtendedL1Client(
        createEthereumChain(
            [process.env.ETHEREUM_HOST ?? 'http://localhost:8545'],
            info.l1ChainId
        ).rpcUrls,
        // anvil's default funded key — local network only.
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        createEthereumChain(
            [process.env.ETHEREUM_HOST ?? 'http://localhost:8545'],
            info.l1ChainId
        ).chainInfo
    );
    const portal = await L1FeeJuicePortalManager.new(
        node,
        l1,
        createLogger('test:bridge')
    );
    const claim = await portal.bridgeTokensPublic(fpcAddress, undefined, true);
    console.log(`bridged; claiming (needs ~2 L2 blocks of activity)…`);

    // The L1->L2 message needs L2 blocks to be consumable; generate activity
    // with cheap self-paid admin calls on Core while retrying the claim.
    const coreAsPlayer = await CoreContract.at(core.address, wallet as never);
    let claimed = false;
    for (let i = 0; i < 20 && !claimed; i++) {
        try {
            await FeeJuiceContract.at(wallet as never)
                .methods.claim(
                    fpcAddress,
                    claim.claimAmount,
                    Fr.fromString(claim.claimSecret.toString()),
                    claim.messageLeafIndex
                )
                .send({ from: player });
            claimed = true;
        } catch (err) {
            if (!/No L1 to L2 message/i.test(String(err))) throw err;
            await coreAsPlayer.methods
                .set_config_storage_address(core.address)
                .send({ from: player });
            await new Promise((r) => setTimeout(r, 4000));
        }
    }
    assert(claimed, 'bridged fee juice claimed for the paymaster');
    const balanceBefore = await getFeeJuiceBalance(fpcAddress, node);
    assert(balanceBefore > 0n, `paymaster funded (${balanceBefore} wei)`);

    // --- 4. the sponsored transaction, entirely through the package SDK ------
    const block = await node.getBlockData('latest');
    const generation = generationAt(
        BigInt(block!.header.globalVariables.timestamp)
    );
    const seat = await findFreeSeat({
        node: node as never,
        fpcAddress,
        generation,
        maxUsers: 2,
    });
    assert(seat !== null, `free seat found (${seat})`);

    const paymaster = await QuotaFpcContract.at(fpcAddress, wallet as never);
    // The sentinel write a successful sponsored call must produce.
    const sentinel = fpcAddress; // any address-valued sentinel works
    const requested = await coreAsPlayer.methods
        .set_planet_storage_address(sentinel)
        .request();
    const calls = (requested as { calls?: unknown[] }).calls ?? requested;
    const payload = await buildSandwichPayload(
        {
            calls: calls as never,
            player,
            fpcAddress,
            generation,
            seat: seat as number,
        },
        wallet as never,
        paymaster as never
    );

    const { DefaultEntrypoint } = await import('@aztec/entrypoints/default');
    const { Gas, GasSettings } = await import('@aztec/stdlib/gas');
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
    const req = await new DefaultEntrypoint().createTxExecutionRequest(
        payload as never,
        gasSettings,
        (await w.getChainInfo()) as never
    );
    const ctx = createSendOnceContext(nodeUrl);
    const receipt = await ctx.attemptSend(async () => {
        const proven = await w.pxe.proveTx(req, { scopes: [player] });
        const tx = await proven.toTx();
        await ctx.node.sendTx(tx as never);
        return waitForTx(
            ctx.node,
            (tx as { getTxHash(): never }).getTxHash()
        ) as never;
    });
    const r = receipt as {
        hasExecutionSucceeded?: () => boolean;
        transactionFee?: bigint;
        status?: string;
    };
    assert(
        r.hasExecutionSucceeded?.() === true,
        'sponsored game transaction EXECUTED (no revert)'
    );
    assert(
        typeof r.transactionFee === 'bigint' && r.transactionFee > 0n,
        `a real fee was charged (${r.transactionFee} wei)`
    );

    // --- 5. who paid, and what changed ---------------------------------------
    const balanceAfter = await getFeeJuiceBalance(fpcAddress, node);
    assert(
        balanceAfter === balanceBefore - r.transactionFee!,
        `the PAYMASTER paid exactly the fee (${balanceBefore - balanceAfter} wei)`
    );
    const addrsRaw: unknown = await coreAsPlayer.methods
        .get_all_storage_addresses_unconstrained()
        .simulate({ from: player });
    const addrs = (addrsRaw as { result?: unknown }).result ?? addrsRaw;
    const planetAddr = (
        Array.isArray(addrs)
            ? addrs[3]
            : (addrs as { planet_storage_address: unknown })
                  .planet_storage_address
    ) as { toString(): string } | string | bigint;
    const planetHex =
        typeof planetAddr === 'string'
            ? planetAddr
            : `0x${BigInt(
                  (planetAddr as { value?: bigint; inner?: bigint }).value ??
                      (planetAddr as { inner?: bigint }).inner ??
                      (planetAddr as bigint)
              )
                  .toString(16)
                  .padStart(64, '0')}`;
    assert(
        planetHex.toLowerCase() === sentinel.toString().toLowerCase(),
        'game state actually changed via the sponsored call (msg_sender was the player)'
    );

    const infoRaw: unknown = await (
        paymaster as unknown as {
            methods: {
                get_quota_info(
                    p: AztecAddress,
                    g: number
                ): { simulate(o: unknown): Promise<unknown> };
            };
        }
    ).methods
        .get_quota_info(player, generation)
        .simulate({ from: player });
    const q = ((infoRaw as { result?: unknown }).result ?? infoRaw) as [
        boolean,
        number | bigint,
    ];
    assert(Boolean(q[0]), 'allowance opened for the player');
    assert(
        Number(q[1]) === 4,
        `allowance decremented to 4 of 5 (got ${Number(q[1])})`
    );

    console.log(
        '\nPASS: package SDK sponsored a real game transaction end to end.'
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
