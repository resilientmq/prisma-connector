import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    preparePrismaSchemaUpdate,
    resolvePrismaSchemaPath,
    updatePrismaSchema
} from '../src/schema/index.js';

describe('Prisma schema installer', () => {
    it('adds both models and remains idempotent', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "sqlite"\n}\n');

        const first = updatePrismaSchema(schema);
        const second = updatePrismaSchema(schema);
        expect(first.addedModels).toEqual(['ResilientMqInboxEvent', 'ResilientMqOutboxEvent']);
        expect(second.changed).toBe(false);
        expect(readFileSync(schema, 'utf8').match(/model ResilientMqInboxEvent/g)).toHaveLength(1);
        expect(readFileSync(schema, 'utf8').match(/model ResilientMqOutboxEvent/g)).toHaveLength(1);
    });

    it('ignores model text inside comments', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, '// model ResilientMqInboxEvent {}\n');
        expect(preparePrismaSchemaUpdate(schema).addedModels).toHaveLength(2);
    });

    it('refuses a partially installed schema', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'model ResilientMqInboxEvent {\n id String @id\n}\n');
        expect(() => preparePrismaSchemaUpdate(schema)).toThrow(/only part/);
    });

    it('resolves a multi-file schema directory from package.json', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        mkdirSync(join(directory, 'prisma'));
        writeFileSync(join(directory, 'package.json'), JSON.stringify({prisma: {schema: './prisma'}}));
        expect(resolvePrismaSchemaPath({cwd: directory})).toBe(join(directory, 'prisma', 'resilientmq.prisma'));
    });

    it('resolves a schema from prisma.config.ts', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        mkdirSync(join(directory, 'database'));
        writeFileSync(join(directory, 'database', 'schema.prisma'), 'datasource db {}\n');
        writeFileSync(join(directory, 'prisma.config.ts'), "export default {schema: './database/schema.prisma'};\n");
        expect(resolvePrismaSchemaPath({cwd: directory})).toBe(join(directory, 'database', 'schema.prisma'));
    });

    it('rejects incompatible pre-existing models', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, `model ResilientMqInboxEvent {
  id String @id
}
model ResilientMqOutboxEvent {
  id String @id
}
`);
        expect(() => preparePrismaSchemaUpdate(schema)).toThrow(/incompatible/);
    });

    it('reports a missing schema with an actionable error', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        expect(() => resolvePrismaSchemaPath({cwd: directory})).toThrow(/--schema/);
    });

    it('uses unbounded text fields for MySQL payloads', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "mysql"\n}\n');
        const update = preparePrismaSchemaUpdate(schema);
        expect(update.after).toContain('payloadJson    String   @db.LongText');
        expect(update.after).toContain('errorMessage   String?  @db.Text');
    });

    it('rejects MongoDB and providers outside the supported matrix', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const mongodb = join(directory, 'mongodb.prisma');
        const sqlserver = join(directory, 'sqlserver.prisma');
        writeFileSync(mongodb, 'datasource db {\n  provider = "mongodb"\n}\n');
        expect(() => preparePrismaSchemaUpdate(mongodb)).toThrow(/mongoose-connector/);
        writeFileSync(sqlserver, 'datasource db {\n  provider = "sqlserver"\n}\n');
        expect(() => preparePrismaSchemaUpdate(sqlserver)).toThrow(/not supported/);
    });
});
