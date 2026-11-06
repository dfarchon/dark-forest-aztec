/**
 * Move admin on every deployed contract to a new address.
 *
 * The signing account is ACCOUNT_ADDRESS from the active network file.
 * Contracts already owned by the new admin are skipped. A contract owned by
 * anyone else stops the run before any transfer_admin transaction is sent.
 *
 *   pnpm admin:transfer-admin <new-admin-address>
 *   pnpm admin:transfer-admin <new-admin-address> --dry-run
 *   pnpm admin:transfer-admin <new-admin-address> --id <deployment-id>
 */
import { AztecAddress } from '@aztec-labs/aztec.js/addresses';
import type { ContractBase } from '@aztec-labs/aztec.js/contracts';
import { unwrapSimulateResult } from '@dfpunk/utils';

import { DEPLOY_DEFINITIONS } from '../deploy/definitions.ts';
import {
    AccountFundingRequiredError,
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
    'Usage: pnpm admin:transfer-admin <new-admin-address> [--id <deployment-id>] [--dry-run]';

const TRANSFER_ORDER = [
    ...DEPLOY_DEFINITIONS.map((definition) => definition.name).filter(
        (name) => name !== 'Admin'
    ),
    'Admin',
];

type Options = {
    newAdmin: AztecAddress;
    id?: string;
    dryRun: boolean;
};

type Planned = {
    name: string;
    contract: ContractBase;
    current: AztecAddress;
    action: 'skip' | 'transfer';
};

type RowStatus = 'skipped' | 'transferred' | 'not-sent';

type SummaryRow = {
    name: string;
    contractAddress: string;
    previous: string;
    next: string;
    status: RowStatus;
};

function parseOptions(): Options {
    const parsed = parseAdminArgs(process.argv.slice(2), {
        flags: ['dry-run'],
        usage: USAGE,
    });
    if (parsed.positionals.length !== 1) throw new Error(USAGE);
    const raw = parsed.positionals[0]!;
    if (!AztecAddress.isAddress(raw)) {
        throw new Error(`Invalid Aztec address: ${raw}\n${USAGE}`);
    }
    const newAdmin = AztecAddress.fromStringUnsafe(raw);
    if (newAdmin.isZero()) {
        throw new Error('New admin must not be the zero address.');
    }
    return { newAdmin, id: parsed.id, dryRun: parsed.flags.has('dry-run') };
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function parseAdminValue(value: unknown): AztecAddress {
    if (value instanceof AztecAddress) return value;
    const text = typeof value === 'string' ? value : String(value);
    if (!AztecAddress.isAddress(text)) {
        throw new Error(
            `Unexpected get_admin_unconstrained result: ${text || typeof value}`
        );
    }
    return AztecAddress.fromStringUnsafe(text);
}

async function readAdmin(
    contract: ContractBase,
    from: AztecAddress
): Promise<AztecAddress> {
    if (!('get_admin_unconstrained' in contract.methods)) {
        throw new Error(
            'get_admin_unconstrained is not in the local contract artifact.'
        );
    }
    const value = unwrapSimulateResult(
        await contract.methods.get_admin_unconstrained().simulate({ from })
    );
    return parseAdminValue(value);
}

function summaryRow(
    entry: Planned,
    nextAdmin: AztecAddress,
    status: RowStatus
): SummaryRow {
    return {
        name: entry.name,
        contractAddress: entry.contract.address.toString(),
        previous: entry.current.toString(),
        next: nextAdmin.toString(),
        status,
    };
}

function printSummary(rows: SummaryRow[]): void {
    const nameWidth = Math.max(...rows.map((row) => row.name.length), 0);
    console.log('');
    for (const row of rows) {
        console.log(
            `${row.status.padEnd(11)} ${row.name.padEnd(nameWidth)}  ${row.contractAddress}`
        );
        console.log(`             previous ${row.previous}`);
        console.log(`             next     ${row.next}`);
    }
}

function accountReminder(signer: AztecAddress, nextAdmin: AztecAddress): void {
    if (signer.equals(nextAdmin)) return;
    console.log(
        `\nLater admin:* commands still sign with ACCOUNT_ADDRESS (${signer.toString()}).`
    );
    console.log(
        `To manage these contracts as the new admin, point the network account at ${nextAdmin.toString()}.`
    );
    console.log('Authorized contract lists were not changed.');
}

async function main(): Promise<void> {
    const options = parseOptions();
    const commandHint =
        `pnpm admin:transfer-admin ${options.newAdmin.toString()}` +
        (options.id ? ` --id ${options.id}` : '');
    const target = await resolveAdminTarget({
        id: options.id,
        contracts: TRANSFER_ORDER,
    });
    const walletContext = options.dryRun
        ? await openAdminWallet(target)
        : await openAdminWallet(target, { commandHint });
    const signer = walletContext.admin;

    console.log(`Network     : ${target.network}`);
    console.log(`Deployment  : ${target.deploymentPath}`);
    console.log(`Aztec node  : ${target.nodeUrl}`);
    console.log(`Signer      : ${signer.toString()}`);
    console.log(`New admin   : ${options.newAdmin.toString()}`);

    const contracts = new Map<string, ContractBase>();
    for (const name of TRANSFER_ORDER) {
        contracts.set(
            name,
            await connectContract(walletContext.wallet, target.addresses, name)
        );
    }

    const readFailures: string[] = [];
    const planned: Planned[] = [];
    for (const name of TRANSFER_ORDER) {
        const contract = contracts.get(name)!;
        try {
            planned.push({
                name,
                contract,
                current: await readAdmin(contract, signer),
                action: 'transfer',
            });
        } catch (err) {
            readFailures.push(
                `  ${name} (${contract.address.toString()}): ${errorText(err)}`
            );
        }
    }
    if (readFailures.length > 0) {
        throw new Error(
            'Cannot read the current admin, so no transfer_admin transaction was sent.\n' +
                'get_admin_unconstrained must exist on the local artifact and on the deployed bytecode.\n' +
                'Run pnpm build:contracts and redeploy contracts that were deployed before this getter existed.\n\n' +
                readFailures.join('\n')
        );
    }

    const foreign = planned.filter(
        (entry) =>
            !entry.current.equals(signer) &&
            !entry.current.equals(options.newAdmin)
    );
    if (foreign.length > 0) {
        const lines = foreign.map(
            (entry) =>
                `  ${entry.name} (${entry.contract.address.toString()})\n` +
                `    admin: ${entry.current.toString()}`
        );
        throw new Error(
            'Refusing to transfer admin. No transfer_admin transaction was sent.\n' +
                `These contracts are not owned by ${signer.toString()} and are not already ${options.newAdmin.toString()}:\n\n` +
                lines.join('\n')
        );
    }

    for (const entry of planned) {
        if (entry.current.equals(options.newAdmin)) entry.action = 'skip';
    }

    const pending = planned.filter((entry) => entry.action === 'transfer');
    if (options.dryRun || pending.length === 0) {
        printSummary(
            planned.map((entry) =>
                summaryRow(
                    entry,
                    options.newAdmin,
                    entry.action === 'skip' ? 'skipped' : 'not-sent'
                )
            )
        );
        if (options.dryRun) {
            console.log(
                `\nDry run: ${pending.length} contract(s) would be transferred. No transactions sent.`
            );
        } else {
            console.log('\nAll contracts already use this admin.');
        }
        accountReminder(signer, options.newAdmin);
        return;
    }

    if (!walletContext.feeCtx) {
        throw new Error('Fee payment context was not initialized.');
    }
    const sendOptions = buildSendOpts(signer, walletContext.feeCtx);
    const rows: SummaryRow[] = [];

    for (let index = 0; index < planned.length; index++) {
        const entry = planned[index]!;
        if (entry.action === 'skip') {
            rows.push(summaryRow(entry, options.newAdmin, 'skipped'));
            continue;
        }
        try {
            console.log(`\nTransferring ${entry.name}...`);
            await entry.contract.methods
                .transfer_admin(options.newAdmin)
                .send(sendOptions);
            const updated = await readAdmin(entry.contract, signer);
            if (!updated.equals(options.newAdmin)) {
                throw new Error(
                    `Admin is ${updated.toString()} after transfer_admin.`
                );
            }
            rows.push(summaryRow(entry, updated, 'transferred'));
        } catch (err) {
            for (const rest of planned.slice(index)) {
                rows.push(
                    summaryRow(
                        rest,
                        options.newAdmin,
                        rest.action === 'skip' ? 'skipped' : 'not-sent'
                    )
                );
            }
            printSummary(rows);
            if (err instanceof AccountFundingRequiredError) throw err;
            throw new Error(
                `Stopped at ${entry.name}. Contracts already transferred are skipped on the next run.\n${errorText(err)}`
            );
        }
    }

    printSummary(rows);
    const transferred = rows.filter(
        (row) => row.status === 'transferred'
    ).length;
    console.log(`\nTransferred ${transferred} contract(s).`);
    accountReminder(signer, options.newAdmin);
}

main().catch((err) => {
    if (exitIfAccountFundingRequired(err)) return;
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
