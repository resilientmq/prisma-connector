import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/cli.js';
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
});
