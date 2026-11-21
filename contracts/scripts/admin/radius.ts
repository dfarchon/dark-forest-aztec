/**
 * Read or set the live universe radius (`World.radius`).
 *
 * Moves and spawns check this value. It is not `WorldConfig.world_radius_min`.
 * The contract stores only the world hash, so the script recovers the current
 * world from `WorldUpdate` logs and checks that hash before sending.
 *
 *   pnpm admin:radius
 *   pnpm admin:radius show
 *   pnpm admin:radius 100000
 *   pnpm admin:radius 100000 --id <deployment-id>
 */
import type { AztecNode } from '@aztec-labs/aztec.js/node';
import { DomainSeparator } from '@aztec-labs/constants';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';
import { type AbiType, decodeFromAbi } from '@aztec-labs/stdlib/abi';
import { computeLogTag } from '@aztec-labs/stdlib/hash';
import { MAX_LOGS_PER_TAG } from '@aztec-labs/stdlib/interfaces/api-limit';
import { LogCursor, type PublicLogsQuery, Tag } from '@aztec-labs/stdlib/logs';
import { unwrapSimulateResult } from '@dfpunk/utils';

import { WorldStorageContract } from '../artifacts/WorldStorage.ts';
import {
    buildSendOpts,
    exitIfAccountFundingRequired,
} from '../utils/feePayment.ts';
import { parseAdminArgs } from './helpers.ts';
import {
    connectContract,
    openAdminWallet,
    resolveAdminTarget,
} from './session.ts';

const USAGE =
    'Usage: pnpm admin:radius [show | <new-radius>] [--id <deployment-id>]';

/** Move proofs reject a radius that does not fit in 32 bits. */
const MOVE_RADIUS_LIMIT = (1n << 32n) - 1n;
const U128_LIMIT = 1n << 128n;
const MAX_LOG_PAGES = 100;

type WorldState = {
    paused: boolean;
    radius: bigint;
    misc_nonce: bigint;
    next_change_block: number;
};

type WorldSnapshot = {
    state: WorldState;
    blockNumber: number;
};

type Options = {
    radius?: bigint;
    id?: string;
};

function parseOptions(): Options {
    const parsed = parseAdminArgs(process.argv.slice(2), { usage: USAGE });
    if (parsed.positionals.length > 1) {
        throw new Error(USAGE);
    }
    const command = parsed.positionals[0];
    if (command === undefined || command === 'show') {
        return { id: parsed.id };
    }
    if (!/^[1-9][0-9]*$/.test(command)) {
        throw new Error(`${USAGE}\nRadius must be a positive integer.`);
    }
    const radius = BigInt(command);
    if (radius >= U128_LIMIT) {
        throw new Error('Radius must fit in u128.');
    }
    return { radius, id: parsed.id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBigInt(value: unknown, label: string): bigint {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`${label} is not a non-negative integer.`);
        }
        return BigInt(value);
    }
    if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) {
        return BigInt(value);
    }
    if (
        isRecord(value) &&
        'toBigInt' in value &&
        typeof value.toBigInt === 'function'
    ) {
        return (value.toBigInt as () => bigint)();
    }
    throw new Error(`${label} is not an integer.`);
}

function isZeroId(id: unknown): boolean {
    try {
        return toBigInt(id, 'world id') === 0n;
    } catch {
        return false;
    }
}

function toWorldState(state: Record<string, unknown>): WorldState {
    if (typeof state.paused !== 'boolean') {
        throw new Error('World.paused is not a boolean.');
    }
    const nextChangeBlock = toBigInt(
        state.next_change_block,
        'World.next_change_block'
    );
    if (nextChangeBlock > 0xffff_ffffn) {
        throw new Error('World.next_change_block does not fit in u32.');
    }
    return {
        paused: state.paused,
        radius: toBigInt(state.radius, 'World.radius'),
        misc_nonce: toBigInt(state.misc_nonce, 'World.misc_nonce'),
        next_change_block: Number(nextChangeBlock),
    };
}

function printWorld(label: string, snapshot: WorldSnapshot): void {
    const { state } = snapshot;
    console.log(`\n${label} world (log block ${snapshot.blockNumber}):`);
    console.log(`  paused            : ${state.paused}`);
    console.log(`  radius            : ${state.radius}`);
    console.log(`  misc_nonce        : ${state.misc_nonce}`);
    console.log(`  next_change_block : ${state.next_change_block}`);
}

async function readLatestWorld(options: {
    node: AztecNode;
    contractAddress: PublicLogsQuery['contractAddress'];
    fromBlock: number;
}): Promise<WorldSnapshot> {
    const { node, contractAddress, fromBlock } = options;
    const tip = Number(await node.getBlockNumber());
    if (!Number.isSafeInteger(tip) || tip < 0) {
        throw new Error(`Node returned an invalid block number: ${tip}.`);
    }
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
        throw new Error(`Deployment start block is invalid: ${fromBlock}.`);
    }
    if (fromBlock > tip) {
        throw new Error(
            `Deployment start block ${fromBlock} is ahead of the node tip ${tip}.`
        );
    }

    const anchor = await node.getBlockData(BlockNumber(tip));
    const anchorHash = anchor?.blockHash;
    if (tip > 0 && !anchorHash) {
        throw new Error(
            `Block ${tip} has no hash; refusing to read unanchored world logs.`
        );
    }

    const event = WorldStorageContract.events.WorldUpdate;
    const logTag = new Tag(
        await computeLogTag(
            event.eventSelector.toField(),
            DomainSeparator.EVENT_LOG_TAG
        )
    );
    let afterLog: LogCursor | undefined;
    let latest: WorldSnapshot | undefined;

    for (let page = 0; page < MAX_LOG_PAGES; page += 1) {
        const query: PublicLogsQuery = {
            contractAddress,
            tags: [afterLog !== undefined ? { tag: logTag, afterLog } : logTag],
            fromBlock: BlockNumber(fromBlock),
            toBlock: BlockNumber(tip + 1),
            referenceBlock: anchorHash
                ? { number: BlockNumber(tip), hash: anchorHash }
                : undefined,
        };
        const [logs = []] = await node.getPublicLogsByTags(query);
        for (const log of logs) {
            let decoded: unknown;
            try {
                decoded = decodeFromAbi(
                    event.abiType as AbiType,
                    log.logData.slice(1)
                );
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                throw new Error(
                    `Failed to decode WorldUpdate in block ${log.blockNumber}: ${message}`
                );
            }
            if (!isRecord(decoded) || !isRecord(decoded.state)) {
                throw new Error(
                    `WorldUpdate in block ${log.blockNumber} is missing its state.`
                );
            }
            if (!isZeroId(decoded.id)) continue;
            latest = {
                state: toWorldState(decoded.state),
                blockNumber: Number(log.blockNumber),
            };
        }
        const last = logs[logs.length - 1];
        if (logs.length < MAX_LOGS_PER_TAG || last === undefined) {
            break;
        }
        afterLog = LogCursor.fromLog(last);
        if (page === MAX_LOG_PAGES - 1) {
            throw new Error(
                `More than ${MAX_LOG_PAGES * MAX_LOGS_PER_TAG} WorldUpdate logs; refusing to guess the current world.`
            );
        }
    }

    if (!latest) {
        throw new Error(
            `No WorldUpdate log found for WorldStorage ${contractAddress.toString()} between blocks ${fromBlock} and ${tip}. ` +
                'The contract stores only a hash, so the script needs that log to recover the current world.'
        );
    }
    return latest;
}

async function main(): Promise<void> {
    const options = parseOptions();
    const target = await resolveAdminTarget({
        id: options.id,
        contracts: ['Admin', 'WorldStorage'],
    });
    const setting = options.radius !== undefined;
    const walletContext = setting
        ? await openAdminWallet(target, {
              commandHint:
                  `pnpm admin:radius ${options.radius}` +
                  (options.id ? ` --id ${options.id}` : ''),
          })
        : await openAdminWallet(target);

    const worldStorage = await connectContract(
        walletContext.wallet,
        target.addresses,
        'WorldStorage'
    );
    console.log(`WorldStorage : ${worldStorage.address.toString()}`);
    console.log(`Deployment   : ${target.deploymentPath}`);
    console.log(`Aztec node   : ${target.nodeUrl}`);

    const current = await readLatestWorld({
        node: target.aztecNode,
        contractAddress: worldStorage.address,
        fromBlock: target.manifest.startBlock,
    });
    const matches = unwrapSimulateResult(
        await worldStorage.methods
            .verify_unconstrained(0, current.state)
            .simulate({ from: walletContext.admin })
    );
    if (matches !== true) {
        throw new Error(
            `World state from block ${current.blockNumber} does not match WorldStorage. ` +
                'The log may be from a reorg, or a newer update was not returned.'
        );
    }
    printWorld('Current', current);

    if (!setting || options.radius === undefined) return;
    if (options.radius === current.state.radius) {
        console.log(
            `\nRadius is already ${current.state.radius}. Nothing to do.`
        );
        return;
    }
    if (options.radius > MOVE_RADIUS_LIMIT) {
        console.log(
            `\nWarning: radius ${options.radius} exceeds ${MOVE_RADIUS_LIMIT}. ` +
                'Moves with ZK checks enabled will revert.'
        );
    }
    if (!walletContext.feeCtx) {
        throw new Error('Fee payment context was not initialized.');
    }

    const admin = await connectContract(
        walletContext.wallet,
        target.addresses,
        'Admin'
    );
    console.log(`\nAdmin        : ${admin.address.toString()}`);
    console.log(
        `Sending admin_set_world_radius ${current.state.radius} -> ${options.radius}...`
    );
    await admin.methods
        .admin_set_world_radius(options.radius, current.state)
        .send(buildSendOpts(walletContext.admin, walletContext.feeCtx));

    printWorld('Updated', {
        state: { ...current.state, radius: options.radius },
        blockNumber: current.blockNumber,
    });
    console.log(`\nUniverse radius is now ${options.radius}.`);
    console.log(
        'Clients pick this up after the indexer applies the new WorldUpdate.'
    );
}

main().catch((err) => {
    if (exitIfAccountFundingRequired(err)) return;
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
