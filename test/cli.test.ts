import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    LocalPrismaCommandExecutor,
    PrismaConnectorCli,
    runCli,
    type PrismaCommandExecutor
} from '../src/cli.js';
import {RESILIENTMQ_PRISMA_MODELS} from '../src/schema/index.js';

describe('resilientmq-prisma CLI', () => {
    beforeEach(() => {
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prints help and schema models', () => {
        expect(runCli(['help'])).toBe(0);
        expect(runCli(['schema', 'print'])).toBe(0);
        expect(runCli(['schema', 'print', '--provider', 'mysql'])).toBe(0);
        expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
        expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('model ResilientMqInboxEvent'));
        expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('@db.LongText'));
    });

    it('returns a failing check until both models exist', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-cli-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {}\n');
        expect(runCli(['schema', 'check', '--schema', schema])).toBe(1);
        writeFileSync(schema, `${RESILIENTMQ_PRISMA_MODELS}\n`);
        expect(runCli(['schema', 'check', '--schema', schema])).toBe(0);
    });

    it('returns an error for unknown arguments and missing option values', () => {
        expect(runCli(['unknown'])).toBe(1);
        expect(runCli(['check', '--schema'])).toBe(1);
        expect(runCli(['schema', 'print', '--provider', 'mongodb'])).toBe(1);
        expect(process.stderr.write).toHaveBeenCalled();
    });

    it('installs, formats, and migrates through injected dependencies', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-cli-'));
        const schema = join(directory, 'schema.prisma');
        const stdout = {write: vi.fn(() => true)};
        const stderr = {write: vi.fn(() => true)};
        const commandExecutor: PrismaCommandExecutor = {execute: vi.fn()};
        writeFileSync(schema, 'datasource db {\n  provider = "sqlite"\n}\n');
        const cli = new PrismaConnectorCli({cwd: directory, stdout, stderr, commandExecutor});

        expect(cli.run(['init', '--schema', schema, '--migrate', '--migration-name', 'add_inbox_outbox'])).toBe(0);
        expect(readFileSync(schema, 'utf8')).toContain('model ResilientMqInboxEvent');
        expect(commandExecutor.execute).toHaveBeenNthCalledWith(1, ['format', '--schema', schema]);
        expect(commandExecutor.execute).toHaveBeenNthCalledWith(2, [
            'migrate', 'dev', '--schema', schema, '--name', 'add_inbox_outbox'
        ]);
        expect(stderr.write).not.toHaveBeenCalled();

        expect(cli.run(['init', '--schema', schema])).toBe(0);
        expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('already current'));
    });

    it('passes a multi-file schema directory to Prisma', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-cli-'));
        const schemaDirectory = join(directory, 'prisma');
        mkdirSync(schemaDirectory);
        writeFileSync(join(schemaDirectory, 'base.prisma'), 'datasource db {\n  provider = "sqlite"\n}\n');
        const commandExecutor: PrismaCommandExecutor = {execute: vi.fn()};
        const cli = new PrismaConnectorCli({
            cwd: directory,
            stdout: {write: vi.fn()},
            stderr: {write: vi.fn()},
            commandExecutor
        });

        expect(cli.run(['init', '--schema', schemaDirectory])).toBe(0);
        expect(commandExecutor.execute).toHaveBeenCalledWith(['format', '--schema', schemaDirectory]);
    });

    it('reports injected command failures and a missing application Prisma binary', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-cli-'));
        const schema = join(directory, 'schema.prisma');
        const stderr = {write: vi.fn(() => true)};
        writeFileSync(schema, 'datasource db {\n  provider = "sqlite"\n}\n');
        const cli = new PrismaConnectorCli({
            cwd: directory,
            stdout: {write: vi.fn()},
            stderr,
            commandExecutor: {execute: () => { throw 'format unavailable'; }}
        });

        expect(cli.run(['init', '--schema', schema])).toBe(1);
        expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('format unavailable'));
        expect(() => new LocalPrismaCommandExecutor(directory).execute(['format'])).toThrow(/not installed/);
    });
});
