import {resolve} from 'node:path';
import Database from 'better-sqlite3';
import {PrismaBetterSqlite3} from '@prisma/adapter-better-sqlite3';
import {EventConsumeStatus, type EventMessage} from '@resilientmq/core';
import {createPrismaEventStores, type PrismaClientLike} from '../../src/index.js';
import {PrismaClient} from './generated/client.js';

const databasePath = resolve('test/integration/prisma/test.db');
const message: EventMessage = {messageId: 'event-1', type: 'integration.test', payload: {valid: true}};

describe('Prisma 7 SQLite integration', () => {
    const database = new Database(databasePath);
    database.exec(`
        CREATE TABLE IF NOT EXISTS resilientmq_inbox_events (
            id TEXT NOT NULL PRIMARY KEY,
            namespace TEXT NOT NULL,
            serviceId TEXT NOT NULL,
            messageId TEXT NOT NULL,
            type TEXT,
            payloadJson TEXT NOT NULL,
            routingKey TEXT,
            propertiesJson TEXT,
            status TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            instanceId TEXT,
            fencingToken TEXT,
            leaseExpiresAt DATETIME,
            lastAttemptAt DATETIME,
            completedAt DATETIME,
            errorName TEXT,
            errorMessage TEXT,
            errorStack TEXT,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS inbox_identity
            ON resilientmq_inbox_events(namespace, serviceId, messageId);
        CREATE INDEX IF NOT EXISTS inbox_claims
            ON resilientmq_inbox_events(namespace, status, leaseExpiresAt);
        CREATE TABLE IF NOT EXISTS resilientmq_outbox_events (
            id TEXT NOT NULL PRIMARY KEY,
            namespace TEXT NOT NULL,
            messageId TEXT NOT NULL,
            type TEXT,
            payloadJson TEXT NOT NULL,
            routingKey TEXT,
            propertiesJson TEXT,
            status TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            serviceId TEXT,
            instanceId TEXT,
            fencingToken TEXT,
            leaseExpiresAt DATETIME,
            nextAttemptAt DATETIME,
            lastAttemptAt DATETIME,
            publishedAt DATETIME,
            errorName TEXT,
            errorMessage TEXT,
            errorStack TEXT,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS outbox_identity
            ON resilientmq_outbox_events(namespace, messageId);
        CREATE INDEX IF NOT EXISTS outbox_claims
            ON resilientmq_outbox_events(namespace, status, nextAttemptAt, leaseExpiresAt);
        CREATE TABLE IF NOT EXISTS resilientmq_metric_events (
            id TEXT NOT NULL PRIMARY KEY,
            namespace TEXT NOT NULL,
            name TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            messageId TEXT,
            serviceId TEXT,
            instanceId TEXT,
            attempt INTEGER,
            durationMs INTEGER,
            errorName TEXT,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS metrics_time
            ON resilientmq_metric_events(namespace, timestamp);
        CREATE INDEX IF NOT EXISTS metrics_name_time
            ON resilientmq_metric_events(namespace, name, timestamp);
    `);
    database.close();

    const adapter = new PrismaBetterSqlite3({url: databasePath});
    const prisma = new PrismaClient({adapter});
    const stores = createPrismaEventStores({
        client: prisma as unknown as PrismaClientLike,
        namespace: 'integration',
        metrics: true
    });

    beforeEach(async () => {
        await prisma.resilientMqInboxEvent.deleteMany();
        await prisma.resilientMqOutboxEvent.deleteMany();
        await prisma.resilientMqMetricEvent.deleteMany();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('fences concurrent inbox ownership in a real database', async () => {
        const claims = await Promise.all(Array.from({length: 32}, (_, index) => stores.consumer.claimConsumeEvent({
            event: message,
            serviceId: 'consumer',
            instanceId: `replica-${index}`,
            attempt: 1,
            leaseDurationMs: 30_000,
            now: Date.now()
        })));
        expect(claims.filter(claim => claim.outcome === 'acquired')).toHaveLength(1);
    });

    it('recovers an inbox lease after process loss', async () => {
        const first = await stores.consumer.claimConsumeEvent({
            event: message,
            serviceId: 'consumer',
            instanceId: 'lost-process',
            attempt: 1,
            leaseDurationMs: 10,
            now: 1_000
        });
        const second = await stores.consumer.claimConsumeEvent({
            event: message,
            serviceId: 'consumer',
            instanceId: 'replacement',
            attempt: 2,
            leaseDurationMs: 10,
            now: 1_011
        });
        expect(first.outcome).toBe('acquired');
        expect(second.outcome).toBe('acquired');
    });

    it('distributes real outbox rows without duplicate claims', async () => {
        const events = Array.from({length: 40}, (_, index) => ({...message, messageId: `outbox-${index}`}));
        await Promise.all(events.map(event => stores.publisher.saveEvent(event)));
        const batches = await Promise.all(Array.from({length: 4}, (_, index) => stores.publisher.claimPendingEvents({
            serviceId: 'publisher',
            instanceId: `replica-${index}`,
            limit: 10,
            leaseDurationMs: 30_000,
            now: Date.now()
        })));
        const claimed = batches.flat().map(claim => claim.event.messageId);
        expect(claimed).toHaveLength(40);
        expect(new Set(claimed)).toHaveLength(40);
    });

    it('persists terminal inbox state', async () => {
        const claim = await stores.consumer.claimConsumeEvent({
            event: message,
            serviceId: 'consumer',
            instanceId: 'replica',
            attempt: 1,
            leaseDurationMs: 30_000,
            now: 1_000
        });
        if (claim.outcome !== 'acquired') throw new Error('Expected claim');
        await expect(stores.consumer.transitionConsumeEvent({
            event: message,
            serviceId: 'consumer',
            instanceId: 'replica',
            fencingToken: claim.fencingToken,
            status: EventConsumeStatus.DONE,
            now: 1_001
        })).resolves.toBe(true);
        const row = await prisma.resilientMqInboxEvent.findFirstOrThrow();
        expect(row.status).toBe(EventConsumeStatus.DONE);
        expect(row.leaseExpiresAt).toBeNull();
    });

    it('persists buffered metric facts outside the event path', async () => {
        stores.metricsSink?.emit({
            name: 'consume.completed',
            timestamp: 1_500,
            messageId: message.messageId,
            serviceId: 'consumer',
            durationMs: 25
        });
        await stores.metricsSink?.flush();
        await expect(prisma.resilientMqMetricEvent.findMany()).resolves.toMatchObject([{
            namespace: 'integration',
            name: 'consume.completed',
            messageId: message.messageId,
            serviceId: 'consumer',
            durationMs: 25,
            timestamp: new Date(1_500)
        }]);
    });

    it('stores payloads and properties as direct JSON values', async () => {
        const direct: EventMessage = {
            messageId: 'direct-json',
            payload: {orderId: 42, nested: {valid: true}},
            properties: {headers: {traceId: 'trace-1'}}
        };
        await stores.publisher.saveEvent(direct);
        const row = await prisma.resilientMqOutboxEvent.findFirstOrThrow();
        expect(row.payloadJson).toEqual(direct.payload);
        expect(row.propertiesJson).toEqual(direct.properties);
        expect(row.payloadJson).not.toHaveProperty('value');
    });

    it('round-trips a top-level JSON null payload', async () => {
        const event: EventMessage = {messageId: 'json-null', payload: null};
        await stores.publisher.saveEvent(event);
        await expect(stores.publisher.getEvent(event)).resolves.toMatchObject(event);
        const row = await prisma.resilientMqOutboxEvent.findFirstOrThrow();
        expect(row.payloadJson).toBeNull();
    });
});
