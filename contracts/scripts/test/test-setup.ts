/**
 * Test environment: prepares 3 accounts (1 admin + 2 users) and loads contract instances.
 * Run deploy + configure first, then run this script or build tests on top of it.
 *
 * Run: pnpm exec tsx scripts/test/test-setup.ts  or  node --experimental-transform-types scripts/test/test-setup.ts
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import type { AztecNode } from '@aztec/aztec.js/node';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    createAccountWithCredentials,
    getAztecNodeUrl,
    getContractInstances,
    getOptionalEnv,
    getProverEnabled,
    getRequiredEnv,
    getSponsoredPFCContract,
    loadAccountFromCredentials,
    loadAccountFromEnv,
    loadContractsEnv,
    registerContractsWithWallet,
    setupWallet,
    type TestAccountCredentials,
} from '../utils/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadContractsEnv({ override: true });

/** Path to persisted test accounts (user1, user2) so they can be reused across runs. */
const TEST_ACCOUNTS_PATH = path.join(__dirname, '..', '.test-accounts.json');

type TestAccountsFile = {
    user1: TestAccountCredentials;
    user2: TestAccountCredentials;
};

// ---------------------------------------------------------------------------
// Contract function lists (from Config / Admin / Core / Move #[external(...)])
// ---------------------------------------------------------------------------

const CONFIG_FUNCTIONS = [
    // Setters
    'set_world_config',
    'set_snark_config',
    'set_game_config_core',
    'set_planet_level_thresholds',
    'set_default_game_config_planet_type_weights_tier',
    'set_planet_type_weights_tier',
    'set_artifacts_config',
    'set_spaceships_config',
    'set_space_junk_config',
    'set_capture_zones_config',
    'initialize_upgrades_defense',
    'initialize_upgrades_range',
    'initialize_upgrades_speed',
    'initialize_cumulative_rarities',
    'set_planet_default_stats',
    'set_default_upgrade_config',
    'set_upgrade',
    'set_upgrade_by_branch_level',
    // Getters
    'get_admin',
    'get_world_config',
    'get_snark_config',
    'get_game_config_core',
    'get_planet_level_thresholds',
    'get_planet_type_weights_tier',
    'get_artifacts_config',
    'get_spaceships_config',
    'get_space_junk_config',
    'get_capture_zones_config',
    'get_planet_default_stats',
    'get_upgrade_config',
    'get_upgrade',
    'get_upgrade_by_branch_level',
    'get_cumulative_rarity',
    // Hash getters
    'get_world_config_hash',
    'get_snark_config_hash',
    'get_game_config_core_hash',
    'get_planet_level_thresholds_hash',
    'get_planet_type_weights_tier_hash',
    'get_artifacts_config_hash',
    'get_spaceships_config_hash',
    'get_space_junk_config_hash',
    'get_capture_zones_config_hash',
    'get_planet_default_stats_hash',
    'get_all_planet_default_stats_hashes',
    // Verify (hash)
    'verify_world_config_hash',
    'verify_snark_config_hash',
    'verify_game_config_core_hash',
    'verify_artifacts_config_hash',
    'verify_upgrade_config_hash',
    'verify_planet_default_stats_hash',
    'verify_all_planet_default_stats_hashes',
    'verify_all_config_hashes',
    'verify_config_hashes',
] as const;

export const ADMIN_FUNCTIONS = [
    'transfer_admin',
    'set_config_storage_address',
    'set_world_storage_address',
    'set_player_storage_address',
    'set_planet_storage_address',
    'pause',
    'unpause',
    'set_owner',
    'deduct_score',
    'add_score',
    'safe_set_owner', // private
    'safe_set_owner_public',
    'admin_set_world_radius',
    'create_planet',
    'admin_initialize_planet',
] as const;

const CORE_FUNCTIONS = [
    'transfer_admin',
    'set_config_storage_address',
    'set_world_storage_address',
    'set_player_storage_address',
    'set_planet_storage_address',
    'set_planet_revealed_coords_storage_address',
    'set_planet_events_storage_address',
    'set_planet_artifacts_storage_address',
    'set_arrivals_storage_address',
    'set_artifact_storage_address',
    'set_artifact_location_storage_address',
    'refresh_planet_private', // private
    'refresh_planet_public',
    'reveal_location', // private
    'reveal_location_public',
    'initialize_player', // private
    'initialize_player_public',
    'upgrade_planet', // private
    'upgrade_planet_public',
    'withdraw_silver', // private
    'withdraw_silver_public',
] as const;

const MOVE_FUNCTIONS = [
    'transfer_admin',
    'set_config_storage_address',
    'set_world_storage_address',
    'set_player_storage_address',
    'set_planet_storage_address',
    'set_planet_events_storage_address',
    'set_planet_artifacts_storage_address',
    'set_arrivals_storage_address',
    'set_artifact_storage_address',
    'set_artifact_location_storage_address',
    'move', // private
    'move_public',
] as const;

const ARTIFACT_VAULT_FUNCTIONS = [
    'transfer_admin',
    'set_all_storage_addresses',
    'set_config_storage_address',
    'set_arrivals_storage_address',
    'set_artifact_storage_address',
    'set_artifact_location_storage_address',
    'set_planet_storage_address',
    'set_planet_artifacts_storage_address',
    'set_planet_events_storage_address',
    'set_player_storage_address',
    'set_world_storage_address',
    'create_artifact',
    'update_artifact',
    'deposit_artifact',
    'withdraw_artifact',
    'give_space_ships', // private
    'give_space_ships_public',
    'admin_give_artifact',
] as const;

const ARTIFACT_ACTION_FUNCTIONS = [
    'transfer_admin',
    'set_all_storage_addresses',
    'set_config_storage_address',
    'set_arrivals_storage_address',
    'set_artifact_storage_address',
    'set_artifact_location_storage_address',
    'set_planet_storage_address',
    'set_planet_artifacts_storage_address',
    'set_planet_events_storage_address',
    'set_player_storage_address',
    'set_world_storage_address',
    'prospect_planet',
    'prospect_planet_public',
    'find_artifact', // private
    'find_artifact_public',
    'activate_artifact',
    'activate_artifact_public',
    'deactivate_artifact',
    'deactivate_artifact_public',
] as const;

/** All contracts and their public method names (for iteration or assertions). */
const CONTRACT_FUNCTIONS = {
    Config: CONFIG_FUNCTIONS,
    Admin: ADMIN_FUNCTIONS,
    Core: CORE_FUNCTIONS,
    Move: MOVE_FUNCTIONS,
    ArtifactAction: ARTIFACT_ACTION_FUNCTIONS,
    ArtifactVault: ARTIFACT_VAULT_FUNCTIONS,
} as const;

export type ConfigFunctionName = (typeof CONFIG_FUNCTIONS)[number];
export type AdminFunctionName = (typeof ADMIN_FUNCTIONS)[number];
export type CoreFunctionName = (typeof CORE_FUNCTIONS)[number];
export type MoveFunctionName = (typeof MOVE_FUNCTIONS)[number];
export type ArtifactActionFunctionName =
    (typeof ARTIFACT_ACTION_FUNCTIONS)[number];
export type ArtifactVaultFunctionName =
    (typeof ARTIFACT_VAULT_FUNCTIONS)[number];

// ---------------------------------------------------------------------------

const AZTEC_NODE_URL = getAztecNodeUrl();
const PROVER_ENABLED = getProverEnabled();

const CONTRACT_SPECS = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
    {
        name: 'WorldStorage',
        modulePath: './artifacts/WorldStorage.ts',
        exportName: 'WorldStorageContract',
    },
    {
        name: 'PlayerStorage',
        modulePath: './artifacts/PlayerStorage.ts',
        exportName: 'PlayerStorageContract',
    },
    {
        name: 'PlanetStorage',
        modulePath: './artifacts/PlanetStorage.ts',
        exportName: 'PlanetStorageContract',
    },
    {
        name: 'PlanetRevealedCoordsStorage',
        modulePath: './artifacts/PlanetRevealedCoordsStorage.ts',
        exportName: 'PlanetRevealedCoordsStorageContract',
    },
    {
        name: 'PlanetEventsStorage',
        modulePath: './artifacts/PlanetEventsStorage.ts',
        exportName: 'PlanetEventsStorageContract',
    },
    {
        name: 'PlanetArtifactsStorage',
        modulePath: './artifacts/PlanetArtifactsStorage.ts',
        exportName: 'PlanetArtifactsStorageContract',
    },
    {
        name: 'ArrivalStorage',
        modulePath: './artifacts/ArrivalStorage.ts',
        exportName: 'ArrivalStorageContract',
    },
    {
        name: 'ArtifactStorage',
        modulePath: './artifacts/ArtifactStorage.ts',
        exportName: 'ArtifactStorageContract',
    },
    {
        name: 'ArtifactLocationStorage',
        modulePath: './artifacts/ArtifactLocationStorage.ts',
        exportName: 'ArtifactLocationStorageContract',
    },
    {
        name: 'ArtifactAction',
        modulePath: './artifacts/ArtifactAction.ts',
        exportName: 'ArtifactActionContract',
    },
    {
        name: 'ArtifactVault',
        modulePath: './artifacts/ArtifactValut.ts',
        exportName: 'ArtifactValutContract',
    },
    {
        name: 'Admin',
        modulePath: './artifacts/Admin.ts',
        exportName: 'AdminContract',
    },
    {
        name: 'Core',
        modulePath: './artifacts/Core.ts',
        exportName: 'CoreContract',
    },
    {
        name: 'Move',
        modulePath: './artifacts/Move.ts',
        exportName: 'MoveContract',
    },
];

const ENV_KEYS: Array<[string, string]> = [
    ['Config', 'CONFIG_CONTRACT_ADDRESS'],
    ['WorldStorage', 'WORLD_STORAGE_CONTRACT_ADDRESS'],
    ['PlayerStorage', 'PLAYER_STORAGE_CONTRACT_ADDRESS'],
    ['PlanetStorage', 'PLANET_STORAGE_CONTRACT_ADDRESS'],
    [
        'PlanetRevealedCoordsStorage',
        'PLANET_REVEALED_COORDS_STORAGE_CONTRACT_ADDRESS',
    ],
    ['PlanetEventsStorage', 'PLANET_EVENTS_STORAGE_CONTRACT_ADDRESS'],
    ['PlanetArtifactsStorage', 'PLANET_ARTIFACTS_STORAGE_CONTRACT_ADDRESS'],
    ['ArrivalStorage', 'ARRIVAL_STORAGE_CONTRACT_ADDRESS'],
    ['ArtifactStorage', 'ARTIFACT_STORAGE_CONTRACT_ADDRESS'],
    ['ArtifactLocationStorage', 'ARTIFACT_LOCATION_STORAGE_CONTRACT_ADDRESS'],
    ['ArtifactAction', 'ARTIFACT_ACTION_SYSTEM_CONTRACT_ADDRESS'],
    ['ArtifactVault', 'ARTIFACT_VAULT_SYSTEM_CONTRACT_ADDRESS'],
    ['Admin', 'ADMIN_CONTRACT_ADDRESS'],
    ['Core', 'CORE_CONTRACT_ADDRESS'],
    ['Move', 'MOVE_CONTRACT_ADDRESS'],
];

function addressesFromEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, key] of ENV_KEYS) {
        if (
            key === 'MOVE_CONTRACT_ADDRESS' ||
            key === 'ARTIFACT_SYSTEM_CONTRACT_ADDRESS'
        ) {
            const v = getOptionalEnv(key);
            if (v) out[name] = v;
            continue;
        }
        out[name] = getRequiredEnv(key);
    }
    return out;
}

export type TestAccounts = {
    /** Admin account (same as the .env account used by deploy/configure). */
    admin: AztecAddress;
    /** Two regular users (created and deployed on each run). */
    users: [AztecAddress, AztecAddress];
    /** All three accounts in order: [admin, user1, user2]. */
    all: [AztecAddress, AztecAddress, AztecAddress];
};

export type TestContext = {
    accounts: TestAccounts;
    contracts: Record<string, ContractBase>;
    /** Aztec node client (e.g. for getPublicEvents). */
    node: AztecNode;
    /** Options for sending a tx from a given address (includes SponsoredFPC fee). */
    sendOpts: (from: AztecAddress) => {
        from: AztecAddress;
        fee: { paymentMethod: SponsoredFeePaymentMethod };
    };
};

/**
 * Prepares 3 accounts (admin from .env, 2 created fresh) and loads Config / Admin / Core instances.
 * Requires deploy and configure to have been run and .env to contain ACCOUNT_* and contract addresses.
 */
export async function getTestContext(): Promise<TestContext> {
    const addresses = addressesFromEnv();

    const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await setupWallet(aztecNode, {
        clearStore: false,
        proverEnabled: PROVER_ENABLED,
    });

    const sponsoredFPC = await getSponsoredPFCContract();
    await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);

    const admin = await loadAccountFromEnv(wallet, aztecNode);

    let user1: AztecAddress;
    let user2: AztecAddress;
    if (fs.existsSync(TEST_ACCOUNTS_PATH)) {
        const saved = JSON.parse(
            fs.readFileSync(TEST_ACCOUNTS_PATH, 'utf-8')
        ) as TestAccountsFile;
        user1 = await loadAccountFromCredentials(
            wallet,
            saved.user1,
            aztecNode
        );
        user2 = await loadAccountFromCredentials(
            wallet,
            saved.user2,
            aztecNode
        );
    } else {
        const cred1 = await createAccountWithCredentials(wallet);
        user1 = AztecAddress.fromString(cred1.address);
        let cred2: TestAccountCredentials;
        try {
            cred2 = await createAccountWithCredentials(wallet);
            user2 = AztecAddress.fromString(cred2.address);
        } catch {
            user2 = user1;
            cred2 = cred1;
        }
        fs.writeFileSync(
            TEST_ACCOUNTS_PATH,
            JSON.stringify({ user1: cred1, user2: cred2 }, null, 2),
            'utf-8'
        );
    }

    // Ensure account contracts are known senders so account-auth notes can be discovered
    // even when using a fresh local PXE store.
    try {
        await wallet.registerSender(admin, 'admin-self');
    } catch {
        /* ignore */
    }
    try {
        await wallet.registerSender(user1, 'user1-self');
    } catch {
        /* ignore */
    }
    try {
        await wallet.registerSender(user2, 'user2-self');
    } catch {
        /* ignore */
    }

    const contracts = await getContractInstances(
        wallet,
        addresses,
        CONTRACT_SPECS
    );

    // Register contracts with PXE so simulate() can run code at their addresses (e.g. PlanetOwnerStorage.get_default_planet_owner_unconstrained).
    await registerContractsWithWallet(wallet, admin, CONTRACT_SPECS, ENV_KEYS);

    const sendOpts = (from: AztecAddress) => ({
        from,
        fee: {
            paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
        },
    });

    return {
        accounts: {
            admin,
            users: [user1, user2],
            all: [admin, user1, user2],
        },
        contracts,
        node: aztecNode,
        sendOpts,
    };
}

/**
 * Sends a no-op transaction (Admin.transfer_admin to self) to refresh the block timestamp.
 * Call this before the main test transaction so context.timestamp() in the next block is fresh.
 */
export async function sendTimestampRefreshTx(ctx: TestContext): Promise<void> {
    const Admin = ctx.contracts['Admin'];
    if (!Admin) return;
    const admin = ctx.accounts.admin;
    console.log(
        '   Sending timestamp refresh tx (Admin.transfer_admin self)...'
    );
    await Admin.methods.transfer_admin(admin).send(ctx.sendOpts(admin));
    console.log('   ✅ Timestamp refresh tx confirmed.');
}

/** Log contract function list for reference when writing tests. */
function printContractFunctions() {
    console.log('\n📋 Contract functions (for tests):\n');
    for (const [contract, fns] of Object.entries(CONTRACT_FUNCTIONS)) {
        console.log(`  ${contract}:`);
        for (const fn of fns) {
            console.log(`    - ${fn}`);
        }
        console.log('');
    }
}

async function main() {
    console.log('🌐 Aztec Node URL:', AZTEC_NODE_URL);
    console.log(
        '🔗 Setting up test context (3 accounts: 1 admin + 2 users)...\n'
    );

    const ctx = await getTestContext();

    console.log('✅ Accounts:');
    console.log('   admin:', ctx.accounts.admin.toString());
    console.log('   user1:', ctx.accounts.users[0].toString());
    console.log('   user2:', ctx.accounts.users[1].toString());
    console.log(
        '\n✅ Contracts loaded:',
        Object.keys(ctx.contracts).join(', ')
    );

    printContractFunctions();

    console.log(
        '💡 Use getTestContext() in your test file to get { accounts, contracts, sendOpts }.'
    );
}

// Only run main when this file is the entry script (not when imported by test-admin etc.)
const isEntryScript =
    typeof process !== 'undefined' &&
    process.argv[1] != null &&
    (process.argv[1].endsWith('test-setup.ts') ||
        process.argv[1].includes('test-setup'));
if (isEntryScript) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
