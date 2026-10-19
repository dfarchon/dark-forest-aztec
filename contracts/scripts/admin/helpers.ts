export type ParsedAdminArgs = {
    flags: Set<string>;
    id: string | undefined;
    positionals: string[];
};

export function parseAdminArgs(
    argv: string[],
    options: {
        flags?: readonly string[];
        usage: string;
    }
): ParsedAdminArgs {
    const allowed = new Set(options.flags ?? []);
    const args = argv.filter((arg) => arg !== '--');
    const flags = new Set<string>();
    const positionals: string[] = [];
    let id: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--id') {
            const next = args[i + 1];
            if (!next || next.startsWith('-')) {
                throw new Error(`Missing value for --id.\n${options.usage}`);
            }
            id = next;
            i += 1;
            continue;
        }
        if (arg.startsWith('--id=')) {
            id = arg.slice('--id='.length);
            if (!id) {
                throw new Error(`Missing value for --id.\n${options.usage}`);
            }
            continue;
        }
        if (arg.startsWith('-')) {
            const name = arg.startsWith('--') ? arg.slice(2) : undefined;
            if (!name || !allowed.has(name)) {
                throw new Error(`Unknown option: ${arg}\n${options.usage}`);
            }
            flags.add(name);
            continue;
        }
        positionals.push(arg);
    }

    return { flags, id, positionals };
}

export function jsonReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}
