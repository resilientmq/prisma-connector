#!/usr/bin/env node
import {existsSync, readdirSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
    RESILIENTMQ_PRISMA_MODELS,
    PrismaSchemaManager,
    getResilientMqPrismaModels,
    type SupportedPrismaProvider
} from './schema/index.js';

interface CliOptions {
    command: 'init' | 'check' | 'print' | 'help';
    schema?: string;
    migrate: boolean;
    migrationName: string;
    provider?: SupportedPrismaProvider;
}

/** Writable stream surface used by the command-line interface. */
export interface PrismaCliWriter {
    /** Writes one user-facing message. */
    write(message: string): unknown;
}

/** Executes application-local Prisma commands. */
export interface PrismaCommandExecutor {
    /** Runs Prisma with the supplied arguments or throws when it fails. */
    execute(args: string[]): void;
}

/** Dependencies accepted by the command-line interface. */
export interface PrismaConnectorCliOptions {
    /** Application directory used for schema and binary discovery. */
    cwd?: string;

    /** Standard output writer. */
    stdout?: PrismaCliWriter;

    /** Standard error writer. */
    stderr?: PrismaCliWriter;

    /** Prisma command executor. */
    commandExecutor?: PrismaCommandExecutor;
}

/** Executes the Prisma binary installed by the consuming application. */
export class LocalPrismaCommandExecutor implements PrismaCommandExecutor {
    /** Creates an executor rooted at the supplied application directory. */
    constructor(private readonly cwd = process.cwd()) {}

    /** Runs an application-local Prisma command synchronously. */
    execute(args: string[]): void {
        const binary = resolve(this.cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
        if (!existsSync(binary)) throw new Error('Prisma CLI is not installed in the application');
        const result = spawnSync(binary, args, {cwd: this.cwd, stdio: 'inherit', shell: process.platform === 'win32'});
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Prisma ${args[0]} failed with exit code ${result.status ?? 'unknown'}`);
    }
}

/** Object-oriented command-line facade with injectable I/O and process execution. */
export class PrismaConnectorCli {
    private readonly cwd: string;
    private readonly stdout: PrismaCliWriter;
    private readonly stderr: PrismaCliWriter;
    private readonly schemaManager: PrismaSchemaManager;
    private readonly commandExecutor: PrismaCommandExecutor;

    /** Creates a command-line facade for one application directory. */
    constructor(options: PrismaConnectorCliOptions = {}) {
        this.cwd = resolve(options.cwd ?? process.cwd());
        this.stdout = options.stdout ?? process.stdout;
        this.stderr = options.stderr ?? process.stderr;
        this.schemaManager = new PrismaSchemaManager({cwd: this.cwd});
        this.commandExecutor = options.commandExecutor ?? new LocalPrismaCommandExecutor(this.cwd);
    }

    /** Executes one CLI invocation and returns its process exit code. */
    run(argv = process.argv.slice(2)): number {
        try {
            const options = parseArguments(argv);
            if (options.command === 'help') {
                this.stdout.write(helpText());
                return 0;
            }
            if (options.command === 'print') {
                this.stdout.write(`${options.provider ? getResilientMqPrismaModels(options.provider) : RESILIENTMQ_PRISMA_MODELS}\n`);
                return 0;
            }

            const schemaPath = this.schemaManager.resolveSchemaPath(options.schema);
            if (options.command === 'check') return this.checkSchema(schemaPath);

            const update = this.schemaManager.update(schemaPath);
            this.stdout.write(update.changed
                ? `Added ${update.addedModels.join(', ')} to ${update.path}\n`
                : `ResilientMQ Prisma models are already current in ${update.path}\n`);
            const prismaSchemaTarget = resolvePrismaCommandTarget(update.path);
            this.commandExecutor.execute(['format', '--schema', prismaSchemaTarget]);
            if (options.migrate) {
                this.commandExecutor.execute(['migrate', 'dev', '--schema', prismaSchemaTarget, '--name', options.migrationName]);
            }
            return 0;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.stderr.write(`resilientmq-prisma: ${message}\n`);
            return 1;
        }
    }

    private checkSchema(schemaPath: string): number {
        const update = this.schemaManager.prepareUpdate(schemaPath);
        if (update.changed) {
            this.stderr.write(`ResilientMQ Prisma models are missing from ${update.path}\n`);
            return 1;
        }
        this.stdout.write(`ResilientMQ Prisma models are current in ${update.path}\n`);
        return 0;
    }
}

/** Executes the ResilientMQ Prisma schema CLI. */
export function runCli(argv = process.argv.slice(2)): number {
    return new PrismaConnectorCli().run(argv);
}

function parseArguments(argv: string[]): CliOptions {
    const first = argv[0] ?? 'help';
    const command = first === 'schema' ? argv[1] ?? 'help' : first;
    const offset = first === 'schema' ? 2 : 1;
    if (!['init', 'check', 'print', 'help', '--help', '-h'].includes(command)) {
        throw new Error(`Unknown command "${command}"`);
    }
    const normalized = command === '--help' || command === '-h' ? 'help' : command as CliOptions['command'];
    const options: CliOptions = {command: normalized, migrate: false, migrationName: 'add_resilientmq_event_store'};
    for (let index = offset; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--migrate') options.migrate = true;
        else if (argument === '--schema') options.schema = requireValue(argv, ++index, argument);
        else if (argument === '--migration-name') options.migrationName = requireValue(argv, ++index, argument);
        else if (argument === '--provider') options.provider = parseProvider(requireValue(argv, ++index, argument));
        else throw new Error(`Unknown option "${argument}"`);
    }
    return options;
}

function parseProvider(value: string): SupportedPrismaProvider {
    if (value === 'postgresql' || value === 'mysql' || value === 'sqlite') return value;
    throw new Error(`Unsupported Prisma provider "${value}"`);
}

function requireValue(argv: string[], index: number, option: string): string {
    const value = argv[index];
    if (!value) throw new Error(`${option} requires a value`);
    return value;
}

function resolvePrismaCommandTarget(schemaPath: string): string {
    const directory = dirname(schemaPath);
    if (!existsSync(directory) || !statSync(directory).isDirectory()) return schemaPath;
    const schemaFiles = readdirSync(directory).filter(name => name.endsWith('.prisma'));
    return schemaFiles.length > 1 ? directory : schemaPath;
}

function helpText(): string {
    return `Usage: resilientmq-prisma <command> [options]

Commands:
  init           Add the ResilientMQ models and run prisma format
  schema check   Fail when the ResilientMQ models are missing
  schema print   Print the models without modifying a file

Options:
  --schema <path>          Prisma schema file or multi-file schema directory
  --migrate                Run prisma migrate dev after updating the schema
  --migration-name <name>  Migration name used with --migrate
  --provider <provider>    Provider used by schema print: postgresql, mysql, sqlite
`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    process.exitCode = runCli();
}
