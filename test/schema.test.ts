import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
    PrismaSchemaManager,
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

    it('prefers package metadata over conventional paths while allowing an explicit override', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        mkdirSync(join(directory, 'prisma'));
        mkdirSync(join(directory, 'database'));
        const conventional = join(directory, 'prisma', 'schema.prisma');
        const configured = join(directory, 'database', 'primary.prisma');
        writeFileSync(conventional, 'datasource db { provider = "sqlite" }\n');
        writeFileSync(configured, 'datasource db { provider = "postgresql" }\n');
        writeFileSync(join(directory, 'package.json'), JSON.stringify({prisma: {schema: './database/primary.prisma'}}));

        expect(resolvePrismaSchemaPath({cwd: directory})).toBe(configured);
        expect(resolvePrismaSchemaPath({cwd: directory, schema: './prisma/schema.prisma'})).toBe(conventional);
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

    it('uses native JSON and provider-specific error text for MySQL', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "mysql"\n}\n');
        const update = preparePrismaSchemaUpdate(schema);
        expect(update.after).toContain('payloadJson    Json');
        expect(update.after).toContain('propertiesJson Json?');
        expect(update.after).toContain('errorMessage   String?  @db.Text');
    });

    it('uses PostgreSQL JSONB and SQLite JSON from the detected datasource', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const postgresql = join(directory, 'postgresql.prisma');
        const sqlite = join(directory, 'sqlite.prisma');
        writeFileSync(postgresql, 'datasource db {\n  provider = "postgresql"\n}\n');
        writeFileSync(sqlite, 'datasource db {\n  provider = "sqlite"\n}\n');

        expect(preparePrismaSchemaUpdate(postgresql).after).toContain('payloadJson    Json @db.JsonB');
        expect(preparePrismaSchemaUpdate(sqlite).after).toContain('payloadJson    Json\n');
        expect(preparePrismaSchemaUpdate(sqlite).after).not.toContain('@db.JsonB');
    });

    it('installs optional metrics with custom physical table names', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "postgresql"\n}\n');
        const options = {
            metrics: true,
            tables: {inbox: 'app_inbox', outbox: 'app_outbox', metrics: 'app_metrics'}
        } as const;

        const first = updatePrismaSchema(schema, options);
        const second = preparePrismaSchemaUpdate(schema, options);
        expect(first.addedModels).toEqual([
            'ResilientMqInboxEvent', 'ResilientMqOutboxEvent', 'ResilientMqMetricEvent'
        ]);
        expect(first.after).toContain('model ResilientMqMetricEvent');
        expect(first.after).toContain('@@map("app_inbox")');
        expect(first.after).toContain('@@map("app_outbox")');
        expect(first.after).toContain('@@map("app_metrics")');
        expect(second.changed).toBe(false);
    });

    it('can add metrics later without duplicating the event models', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "sqlite"\n}\n');
        updatePrismaSchema(schema);
        const update = updatePrismaSchema(schema, {metrics: true});
        expect(update.addedModels).toEqual(['ResilientMqMetricEvent']);
        expect(update.after.match(/model ResilientMqInboxEvent/g)).toHaveLength(1);
    });

    it('rejects requested table mappings that differ from installed models', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const schema = join(directory, 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "sqlite"\n}\n');
        updatePrismaSchema(schema, {tables: {inbox: 'first_inbox'}});
        expect(() => preparePrismaSchemaUpdate(schema, {tables: {inbox: 'other_inbox'}})).toThrow(/first_inbox/);
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

    it('supports object-oriented schema discovery and updates', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        mkdirSync(join(directory, 'prisma'));
        const schema = join(directory, 'prisma', 'schema.prisma');
        writeFileSync(schema, 'datasource db {\n  provider = "postgresql"\n}\n');
        const manager = new PrismaSchemaManager({cwd: directory});

        expect(manager.resolveSchemaPath()).toBe(schema);
        expect(manager.prepareUpdate(schema).changed).toBe(true);
        expect(manager.update(schema).changed).toBe(true);
        expect(manager.prepareUpdate(schema).changed).toBe(false);
    });

    it('resolves explicit relative and absolute schema targets', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const nested = join(directory, 'database');
        mkdirSync(nested);
        const schema = join(nested, 'events.prisma');
        writeFileSync(schema, 'datasource db {}\n');
        const manager = new PrismaSchemaManager({cwd: directory});

        expect(manager.resolveSchemaPath('./database/events.prisma')).toBe(schema);
        expect(manager.resolveSchemaPath(schema)).toBe(schema);
        expect(manager.resolveSchemaPath('./generated')).toBe(join(directory, 'generated', 'resilientmq.prisma'));
    });

    it('rejects malformed model declarations and unterminated comments', () => {
        const directory = mkdtempSync(join(tmpdir(), 'resilientmq-prisma-'));
        const invalidModel = join(directory, 'invalid-model.prisma');
        const invalidComment = join(directory, 'invalid-comment.prisma');
        writeFileSync(invalidModel, 'model {\n}\n');
        writeFileSync(invalidComment, '/* model ResilientMqInboxEvent {}');

        expect(() => preparePrismaSchemaUpdate(invalidModel)).toThrow(/Invalid Prisma model/);
        expect(() => preparePrismaSchemaUpdate(invalidComment)).toThrow(/Unterminated block comment/);
    });
});
