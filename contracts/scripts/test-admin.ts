/**
 * Script for testing Admin system contract functions.
 * Maintains off-chain GlobalState: reads GlobalStateUpdated from chain, or falls back to get_default_global_state_unconstrained.
 *
 * Run: pnpm exec tsx scripts/test-admin.ts  or  node --experimental-transform-types scripts/test-admin.ts
 */
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { GlobalStateStorageContract } from './artifacts/GlobalStateStorage.ts';
import { getDecodedPublicEvents } from './getDecodedPublicEvents.ts';
import {
    ADMIN_FUNCTIONS,
    type AdminFunctionName,
    getTestContext,
    type TestContext,
} from './test-setup.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Admin public function names (for reference when writing tests). */
const ADMIN_FN_LIST: readonly AdminFunctionName[] = ADMIN_FUNCTIONS;

/** Shape of GlobalState (matches Noir + artifact). Use for Admin.pause(g), Admin.unpause(g), etc. */
export type GlobalStateShape = {
    paused: boolean;
    planet_events_count: bigint | number;
    world_radius: bigint | number;
    misc_nonce: bigint | number;
    planet_ids_count: bigint | number;
    revealed_planet_ids_count: bigint | number;
    player_ids_count: bigint | number;
    next_change_block: bigint | number;
};

/**
 * Maintain global state off-chain: read latest from GlobalStateUpdated events, or use default from contract.
 */
async function loadGlobalState(ctx: TestContext): Promise<GlobalStateShape> {
    const GlobalStateStorage = ctx.contracts['GlobalStateStorage'];
    if (!GlobalStateStorage) {
        throw new Error('GlobalStateStorage contract not loaded');
    }

    const latestBlock = Number(await ctx.node.getBlockNumber());

    try {
        const events = await getDecodedPublicEvents(
            ctx.node,
            GlobalStateStorageContract.events.GlobalStateUpdated,
            0,
            latestBlock + 1
        );

        if (events.length > 0) {
            const last = events[events.length - 1];
            const state =
                (last as any).state ??
                (last as any).args?.state ??
                (last as any).data?.state;

            if (state) {
                return state as GlobalStateShape;
            }
        }
    } catch (err) {
        console.warn('[loadGlobalState] failed to decode GlobalStateUpdated events:', err);
    }

    const defaultState = await GlobalStateStorage.methods
        .get_default_global_state_unconstrained()
        .simulate({ from: ctx.accounts.admin });

    return defaultState as GlobalStateShape;
}

async function main() {
    console.log('🔗 Loading test context (admin + 2 users, contracts)...\n');
    const ctx: TestContext = await getTestContext();

    const Admin = ctx.contracts['Admin'];
    if (!Admin) {
        throw new Error('Admin contract not loaded');
    }

    const { admin, users } = ctx.accounts;
    const sendOpts = ctx.sendOpts;

    console.log('✅ Admin contract at:', Admin.address.toString());
    console.log('✅ Admin account:', admin.toString());
    console.log('✅ User1:', users[0].toString());
    console.log('✅ User2:', users[1].toString());
    console.log('\n📋 Admin public functions:', ADMIN_FN_LIST.length);
    ADMIN_FN_LIST.forEach((fn, i) => console.log(`   ${i + 1}. ${fn}`));

    // -------------------------------------------------------------------------
    // Maintain GlobalState off-chain: from latest GlobalStateUpdated or default
    // -------------------------------------------------------------------------
    console.log('\n🌍 Loading global state (from chain events or get_default_global_state_unconstrained)...');
    const currentGlobalState = await loadGlobalState(ctx);
    console.log('   currentGlobalState.paused =', currentGlobalState.paused);
    console.log('   currentGlobalState.world_radius =', currentGlobalState.world_radius);

    // Use currentGlobalState for Admin calls that need it, e.g.:
    //   await Admin.methods.pause(currentGlobalState).send(sendOpts(admin)).wait();
    //   await Admin.methods.unpause(currentGlobalState).send(sendOpts(admin)).wait();
    // -------------------------------------------------------------------------



    // Call pause or unpause based on current global state
    try {
        let receipt;
        if (currentGlobalState.paused) {
            console.log('\n▶️  currentGlobalState.paused is true → calling Admin.unpause()...');
            const tx = await Admin.methods.unpause(currentGlobalState).send(sendOpts(admin));
            receipt = await tx.wait();
            console.log('   ▶️  Unpause transaction committed successfully:', receipt);
        } else {
            console.log('\n⏸️  currentGlobalState.paused is false → calling Admin.pause()...');
            const tx = await Admin.methods.pause(currentGlobalState).send(sendOpts(admin));
            receipt = await tx.wait();
            console.log('   ⏸️  Pause transaction committed successfully:', receipt);
        }

        // After committing the transaction, read the GlobalStateUpdated event to get the latest global state and print it out
        const blockNumber = Number(receipt.blockNumber);
        try {
            const events = await getDecodedPublicEvents(
                ctx.node,
                GlobalStateStorageContract.events.GlobalStateUpdated,
                blockNumber,
                blockNumber + 1
            );
            if (events.length === 0) {
                console.warn('   No GlobalStateUpdated event in block', blockNumber);
            } else {
                const latestEvent = events[events.length - 1] as { state: GlobalStateShape };
                const state = latestEvent.state;
                console.log('   ✅ Latest global state:', state);
                console.log('      paused =', state.paused);
                console.log('      world_radius =', state.world_radius);
            }
        } catch (e) {
            console.warn('   Could not decode GlobalStateUpdated events:', (e as Error).message);
        }

    } catch (error) {
        console.error('Error while calling Admin.pause()/unpause():', error);
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
