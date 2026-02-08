/**
 * Test environment: prepares 3 accounts (1 admin + 2 users) and loads contract instances.
 * Run deploy + configure first, then run this script or build tests on top of it.
 *
 * Run: pnpm exec tsx scripts/test-setup.ts  or  node --experimental-transform-types scripts/test-setup.ts
 */
import { AztecAddress } from '@aztec/aztec.js/addresses';
import type { ContractBase } from '@aztec/aztec.js/contracts';
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import type { AztecNode } from '@aztec/aztec.js/node';
import { createAztecNodeClient } from '@aztec/aztec.js/node';
import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    createAccountWithCredentials,
    getContractInstances,
    getSponsoredPFCContract,
    loadAccountFromCredentials,
    loadAccountFromEnv,
    registerContractsWithWallet,
    setupWallet,
    type TestAccountCredentials,
} from './utils/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from contracts/ so it works regardless of cwd (e.g. run from repo root)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Path to persisted test accounts (user1, user2) so they can be reused across runs. */
const TEST_ACCOUNTS_PATH = path.join(__dirname, '.test-accounts.json');

type TestAccountsFile = {
    user1: TestAccountCredentials;
    user2: TestAccountCredentials;
};

// ---------------------------------------------------------------------------
// Contract function lists (from Config / Admin / Core #[external("public")])
// ---------------------------------------------------------------------------

const CONFIG_FUNCTIONS = [
    'set_default_world_config',
    'set_world_config',
    'set_default_snark_constants',
    'set_snark_constants',
    'set_default_game_config',
    'set_game_config_core',
    'set_planet_level_thresholds',
    'set_default_game_config_planet_type_weights_tier',
    'set_planet_type_weights_tier',
    'set_default_artifacts_config',
    'set_artifacts_config',
    'set_default_spaceships_config',
    'set_spaceships_config',
    'set_default_space_junk_config',
    'set_space_junk_config',
    'set_default_capture_zones_config',
    'set_capture_zones_config',
    'set_default_upgrade_config',
    'set_upgrade_config',
    'initialize_cumulative_rarities',
    'set_planet_default_stats',
    'set_upgrade',
    'set_upgrade_by_branch_level',
    'get_admin_public',
    'get_world_config_public',
    'get_snark_constants_public',
    'get_game_config_core_public',
    'get_planet_level_thresholds_public',
    'get_planet_type_weights_tier_public',
    'get_artifacts_config_public',
    'get_spaceships_config_public',
    'get_space_junk_config_public',
    'get_capture_zones_config_public',
    'get_planet_default_stats_public',
    'get_upgrade_public',
    'get_upgrade_by_branch_level_public',
    'get_upgrade_config_public',
    'get_all_upgrades_public',
    'get_cumulative_rarity_public',
] as const;

export const ADMIN_FUNCTIONS = [
    'transfer_admin',
    'set_config_storage_address',
    'set_global_state_storage_address',
    'set_player_storage_address',
    'set_planet_meta_storage_address',
    'set_planet_owner_storage_address',
    'set_planet_caps_storage_address',
    'set_planet_resources_storage_address',
    'set_planet_mods_storage_address',
    'pause',
    'unpause',
    'set_owner',
    'deduct_score',
    'add_score',
    'safe_set_owner_public',
    'admin_set_world_radius',
    'create_planet',
    'admin_initialize_planet',
] as const;

const CORE_FUNCTIONS = [
    'transfer_admin',
    'set_config_storage_address',
    'set_global_state_storage_address',
    'set_player_storage_address',
    'set_planet_meta_storage_address',
    'set_planet_owner_storage_address',
    'set_planet_caps_storage_address',
    'set_planet_resources_storage_address',
    'set_planet_mods_storage_address',
    'set_planet_coords_storage_address',
    'set_planet_events_storage_address',
    'set_planet_artifacts_storage_address',
    'set_arrivals_storage_address',
    'set_artifacts_storage_address',
    'refresh_planet_public',
    'reveal_location',
    'initialize_player_public',
] as const;

const PLANET_UPGRADE_FUNCTIONS = [
    'transfer_admin',
    'set_config_storage_address',
    'set_planet_owner_storage_address',
    'set_planet_caps_storage_address',
    'set_planet_resources_storage_address',
    'upgrade_planet',
] as const;

/** All contracts and their public method names (for iteration or assertions). */
const CONTRACT_FUNCTIONS = {
    Config: CONFIG_FUNCTIONS,
    Admin: ADMIN_FUNCTIONS,
    Core: CORE_FUNCTIONS,
    PlanetUpgrade: PLANET_UPGRADE_FUNCTIONS,
} as const;

export type ConfigFunctionName = (typeof CONFIG_FUNCTIONS)[number];
export type AdminFunctionName = (typeof ADMIN_FUNCTIONS)[number];
export type CoreFunctionName = (typeof CORE_FUNCTIONS)[number];
export type PlanetUpgradeFunctionName =
    (typeof PLANET_UPGRADE_FUNCTIONS)[number];

// ---------------------------------------------------------------------------

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || 'http://localhost:8080';
const PROVER_ENABLED = process.env.PROVER_ENABLED !== 'false';

const CONTRACT_SPECS = [
    {
        name: 'Config',
        modulePath: './artifacts/Config.ts',
        exportName: 'ConfigContract',
    },
    {
        name: 'GlobalStateStorage',
        modulePath: './artifacts/GlobalStateStorage.ts',
        exportName: 'GlobalStateStorageContract',
    },
    {
        name: 'PlayerStorage',
        modulePath: './artifacts/PlayerStorage.ts',
        exportName: 'PlayerStorageContract',
    },
    {
        name: 'PlanetOwnerStorage',
        modulePath: './artifacts/PlanetOwnerStorage.ts',
        exportName: 'PlanetOwnerStorageContract',
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
        name: 'PlanetUpgrade',
        modulePath: './artifacts/PlanetUpgrade.ts',
        exportName: 'PlanetUpgradeContract',
    },
];

const ENV_KEYS: Array<[string, string]> = [
    ['Config', 'CONFIG_CONTRACT_ADDRESS'],
    ['GlobalStateStorage', 'GLOBAL_STATE_STORAGE_CONTRACT_ADDRESS'],
    ['PlayerStorage', 'PLAYER_STORAGE_CONTRACT_ADDRESS'],
    ['PlanetOwnerStorage', 'PLANET_OWNER_STORAGE_CONTRACT_ADDRESS'],
    ['Admin', 'ADMIN_CONTRACT_ADDRESS'],
    ['Core', 'CORE_CONTRACT_ADDRESS'],
    ['PlanetUpgrade', 'PLANET_UPGRADE_CONTRACT_ADDRESS'],
];

function addressesFromEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, key] of ENV_KEYS) {
        const v = process.env[key];
        if (!v) throw new Error(`Missing ${key} in .env (run deploy first)`);
        out[name] = v;
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
    /** Aztec node client (e.g. for getDecodedPublicEvents). */
    node: AztecNode;
    /** Options for sending a tx from a given address (includes SponsoredFPC fee). */
    sendOpts: (from: AztecAddress) => {
        from: AztecAddress;
        fee: { paymentMethod: SponsoredFeePaymentMethod };
    };
};

/**
 * Prepares 3 accounts (admin from .env, 2 created fresh) and loads Config / Admin / Core / PlanetUpgrade instances.
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

    const admin = await loadAccountFromEnv(wallet);

    let user1: AztecAddress;
    let user2: AztecAddress;
    if (fs.existsSync(TEST_ACCOUNTS_PATH)) {
        const saved = JSON.parse(
            fs.readFileSync(TEST_ACCOUNTS_PATH, 'utf-8')
        ) as TestAccountsFile;
        user1 = await loadAccountFromCredentials(wallet, saved.user1);
        user2 = await loadAccountFromCredentials(wallet, saved.user2);
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
    console.log('\n✅ Contracts loaded: Config, Admin, Core, PlanetUpgrade');

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
