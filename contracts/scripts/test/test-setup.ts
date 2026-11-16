/**
 * Test environment: prepares 1 admin + N users and loads contract instances.
 *
 * Runtime model (gasMainRound2):
 * - Network config comes from `networks/<AZTEC_NETWORK>.env` (see runtime/env.ts).
 * - Contract addresses come from the latest complete deploy manifest
 *   (`contracts/deployments/<network>/<id>/manifest.json`, written by `pnpm deploy:run`).
 * - The admin is the deployer account (`ACCOUNT_*` in the network file).
 * - Users are generated offline once per network and saved in
 *   `scripts/.test-accounts.json` (gitignored). Schnorr initializerless accounts need no deploy tx.
 * - User count comes from `TEST_USER_COUNT` (default 5, minimum 2).
 * - Fee payment follows `FEE_PAYMENT_MODE` (`sponsored` | `account`); there is no default.
 *
 * Run deploy + bootstrap first, then run this script or build tests on top of it.
 * Run: pnpm exec tsx scripts/test/test-setup.ts
 */
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { ContractBase } from '@aztec-labs/aztec.js/contracts';
import type { AztecNode } from '@aztec-labs/aztec.js/node';
import { unwrapSimulateResult } from '@dfpunk/utils';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { openBootstrapContext } from '../bootstrap/context.ts';
import { generateAccountKeys } from '../runtime/account.ts';
import {
    assertFeePaymentReady,
    buildSendOpts,
    exitIfAccountFundingRequired,
} from '../utils/feePayment.ts';
import {
    loadAccountFromCredentials,
    type TestAccountCredentials,
} from '../utils/wallet.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to persisted test accounts so they can be reused across runs. */
const TEST_ACCOUNTS_PATH = path.join(__dirname, '..', '.test-accounts.json');

type NetworkTestAccounts = {
    users: TestAccountCredentials[];
};

/** Legacy file shape before N-user support. */
type LegacyNetworkTestAccounts = {
    user1: TestAccountCredentials;
    user2: TestAccountCredentials;
};

/** File layout: one entry per network name so switching AZTEC_NETWORK never reuses stale keys. */
type TestAccountsFile = Record<
    string,
    NetworkTestAccounts | LegacyNetworkTestAccounts
>;

const COMMAND_HINT = 'pnpm exec tsx scripts/test/test-setup.ts';

const DEFAULT_USER_COUNT = 5;
const MIN_USER_COUNT = 2;

export function resolveTestUserCount(): number {
    const raw = process.env.TEST_USER_COUNT;
    if (raw == null || raw === '') return DEFAULT_USER_COUNT;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < MIN_USER_COUNT) {
        throw new Error(
            `TEST_USER_COUNT must be an integer >= ${MIN_USER_COUNT} (got ${JSON.stringify(raw)})`
        );
    }
    return n;
}

export type TestAccounts = {
    /** Admin account (the deployer account from the active networks/*.env file). */
    admin: AztecAddress;
    /** Regular users (generated offline once per network, then reused). */
    users: AztecAddress[];
    /** All accounts in order: [admin, ...users]. */
    all: AztecAddress[];
};

export type TestContext = {
    accounts: TestAccounts;
    contracts: Record<string, ContractBase>;
    /** Aztec node client (e.g. for getPublicEvents). */
    node: AztecNode;
    /** Active network name (`AZTEC_NETWORK`). */
    network: string;
    /** `sponsored` or `account` (from `FEE_PAYMENT_MODE`). */
    feeMode: 'sponsored' | 'account';
    /**
     * Options for sending a tx from a given address.
     * Sponsored mode includes the SponsoredFPC payment method; account mode omits `fee`
     * so the SDK charges FeeJuice from the sender.
     */
    sendOpts: (from: AztecAddress) => ReturnType<typeof buildSendOpts>;
};

function isCredentials(value: unknown): value is TestAccountCredentials {
    if (!value || typeof value !== 'object') return false;
    const o = value as Record<string, unknown>;
    return (
        typeof o.salt === 'string' &&
        typeof o.secretKey === 'string' &&
        typeof o.signingKey === 'string' &&
        typeof o.address === 'string'
    );
}

function normalizeNetworkAccounts(
    entry: NetworkTestAccounts | LegacyNetworkTestAccounts | undefined
): TestAccountCredentials[] {
    if (!entry) return [];
    if ('users' in entry && Array.isArray(entry.users)) {
        return entry.users.filter(isCredentials);
    }
    const legacy = entry as LegacyNetworkTestAccounts;
    const out: TestAccountCredentials[] = [];
    if (isCredentials(legacy.user1)) out.push(legacy.user1);
    if (isCredentials(legacy.user2)) out.push(legacy.user2);
    return out;
}

function readTestAccountsFile(): TestAccountsFile {
    if (!fs.existsSync(TEST_ACCOUNTS_PATH)) return {};
    const parsed = JSON.parse(
        fs.readFileSync(TEST_ACCOUNTS_PATH, 'utf-8')
    ) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as TestAccountsFile;
}

function writeTestAccountsFile(file: TestAccountsFile): void {
    fs.writeFileSync(
        TEST_ACCOUNTS_PATH,
        JSON.stringify(file, null, 2) + '\n',
        'utf-8'
    );
}

function toCred(k: {
    salt: string;
    secretKey: string;
    signingKey: string;
    address: string;
}): TestAccountCredentials {
    return {
        salt: k.salt,
        secretKey: k.secretKey,
        signingKey: k.signingKey,
        address: k.address,
    };
}

async function getOrCreateNetworkTestAccounts(
    network: string,
    count: number
): Promise<NetworkTestAccounts> {
    const file = readTestAccountsFile();
    const existingRaw = file[network];
    const users = normalizeNetworkAccounts(existingRaw);
    const priorCount = users.length;
    const wasLegacy =
        existingRaw != null &&
        !('users' in existingRaw) &&
        ('user1' in existingRaw || 'user2' in existingRaw);

    while (users.length < count) {
        const keys = await generateAccountKeys();
        users.push(toCred(keys));
    }

    const appended = users.length > priorCount;
    const needsPersist =
        wasLegacy || appended || !existingRaw || !('users' in existingRaw);
    if (needsPersist) {
        file[network] = { users };
        writeTestAccountsFile(file);
        if (wasLegacy) {
            console.log(
                `♻️  Migrated legacy test accounts for "${network}" -> users[${users.length}]`
            );
        }
        if (appended) {
            console.log(
                `🆕 Generated test users for network "${network}" (now ${users.length}) -> ${path.relative(process.cwd(), TEST_ACCOUNTS_PATH)}`
            );
        } else if (wasLegacy) {
            console.log(
                `   Persisted ${path.relative(process.cwd(), TEST_ACCOUNTS_PATH)}`
            );
        }
    }

    return { users };
}

/**
 * Prepares accounts (admin = deployer, plus N generated users) and loads every deployed contract.
 * Requires `pnpm deploy:run` and `pnpm bootstrap` to have completed on the active network.
 *
 * In `account` fee mode the test users must hold FeeJuice too; the script stops with a
 * funding guide (exit code 2 via AccountFundingRequiredError) if they do not.
 */
export async function getTestContext(): Promise<TestContext> {
    const userCount = resolveTestUserCount();
    const boot = await openBootstrapContext({ commandHint: COMMAND_HINT });
    const { session, contracts } = boot;
    const { wallet, aztecNode, feeCtx, deployer: admin } = session;

    const creds = await getOrCreateNetworkTestAccounts(
        session.network,
        userCount
    );
    const users: AztecAddress[] = [];
    for (let i = 0; i < userCount; i++) {
        const userCred = creds.users[i];
        if (!userCred) {
            throw new Error(
                `Missing test account credentials for user index ${i}`
            );
        }
        users.push(
            await loadAccountFromCredentials(wallet, userCred, aztecNode)
        );
    }

    // Account mode: every sender pays its own fees. The deployer was preflighted by the session.
    if (feeCtx.mode === 'account') {
        for (const user of users) {
            await assertFeePaymentReady({
                feeCtx,
                aztecNode,
                accountAddress: user,
                commandHint: COMMAND_HINT,
            });
        }
    }

    // Ensure account contracts are known senders so account-auth notes can be discovered
    // even when using a fresh local PXE store.
    const senderEntries: [AztecAddress, string][] = [
        [admin, 'admin-self'],
        ...users.map(
            (addr, i) => [addr, `user${i + 1}-self`] as [AztecAddress, string]
        ),
    ];
    for (const [addr, label] of senderEntries) {
        try {
            await wallet.registerSender(addr, label);
        } catch {
            /* ignore */
        }
    }

    const sendOpts = (from: AztecAddress) => buildSendOpts(from, feeCtx);

    return {
        accounts: {
            admin,
            users,
            all: [admin, ...users],
        },
        contracts,
        node: aztecNode,
        network: session.network,
        feeMode: feeCtx.mode,
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

/**
 * Ensure the on-chain SnarkConfig has `disable_zk_checks = true`.
 *
 * System contracts gate their init / move / reveal / find ZK proof asserts
 * behind `if !snark_config.disable_zk_checks { ... }`. With this flag set,
 * test scripts can pass fixed coordinates instead of searching for a valid
 * spawn (which is slow because of the narrow perlin band).
 *
 * Reads the current config; if ZK checks are still enabled, sends
 * `Config.set_snark_config({ ...current, disable_zk_checks: true })` from the
 * admin account, then re-reads and returns the updated config (so its hash
 * matches on-chain storage for downstream `provided_snark_config` use).
 */
export async function ensureZkDisabled(
    ctx: TestContext
): Promise<Record<string, unknown>> {
    const Config = ctx.contracts['Config'];
    if (!Config) {
        throw new Error(
            'Config contract not loaded; cannot toggle disable_zk_checks.'
        );
    }
    const admin = ctx.accounts.admin;

    const current = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: admin })
    ) as Record<string, unknown>;

    if (current.disable_zk_checks) {
        console.log('   ZK checks already disabled (disable_zk_checks=true).');
        return current;
    }

    console.log(
        '   ZK checks enabled; setting disable_zk_checks=true via admin...'
    );
    const newConfig = { ...current, disable_zk_checks: true };
    await Config.methods.set_snark_config(newConfig).send(ctx.sendOpts(admin));

    const updated = unwrapSimulateResult(
        await Config.methods.get_snark_config().simulate({ from: admin })
    ) as Record<string, unknown>;
    console.log(
        `   ✅ disable_zk_checks is now ${Boolean(updated.disable_zk_checks)}.`
    );
    return updated;
}

/** Log the callable functions of each loaded contract (from its artifact) for reference. */
function printContractFunctions(ctx: TestContext) {
    console.log('\n📋 Contract functions (for tests):\n');
    for (const [name, contract] of Object.entries(ctx.contracts)) {
        const artifact = (
            contract as unknown as {
                artifact?: {
                    functions?: { name: string; isInternal?: boolean }[];
                };
            }
        ).artifact;
        const fns = (artifact?.functions ?? [])
            .filter((fn) => !fn.isInternal && fn.name !== 'constructor')
            .map((fn) => fn.name)
            .sort();
        console.log(`  ${name}: ${fns.length} functions`);
        for (const fn of fns) {
            console.log(`    - ${fn}`);
        }
        console.log('');
    }
}

async function main() {
    const userCount = resolveTestUserCount();
    console.log(
        `🔗 Setting up test context (1 admin + ${userCount} users)...\n`
    );

    const ctx = await getTestContext();

    console.log(`✅ Network: ${ctx.network} (fee mode: ${ctx.feeMode})`);
    console.log('✅ Accounts:');
    console.log('   admin:', ctx.accounts.admin.toString());
    for (let i = 0; i < ctx.accounts.users.length; i++) {
        console.log(`   user${i + 1}:`, ctx.accounts.users[i]!.toString());
    }
    console.log(
        '\n✅ Contracts loaded:',
        Object.keys(ctx.contracts).join(', ')
    );

    printContractFunctions(ctx);

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
        if (exitIfAccountFundingRequired(err)) return;
        console.error(err);
        process.exit(1);
    });
}
