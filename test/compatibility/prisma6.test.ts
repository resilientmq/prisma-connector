import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
import type {EventMessage} from '@resilientmq/core';
import {createPrismaEventStores, type PrismaClientLike} from '../../src/index.js';

interface Prisma6Client extends PrismaClientLike {
    $disconnect(): Promise<void>;
    resilientMqInboxEvent: {deleteMany(): Promise<unknown>};
    resilientMqOutboxEvent: {deleteMany(): Promise<unknown>};
}

type Prisma6ClientConstructor = new () => Prisma6Client;

const compatibility = process.env.TEST_PRISMA_MAJOR === '6' ? describe : describe.skip;

compatibility('Prisma 6 compatibility', () => {
    let prisma: Prisma6Client;
    const databasePath = resolve('test/compatibility/prisma6/test.db');

    beforeAll(async () => {
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
            CREATE UNIQUE INDEX IF NOT EXISTS prisma6_inbox_identity
                ON resilientmq_inbox_events(namespace, serviceId, messageId);
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
            CREATE UNIQUE INDEX IF NOT EXISTS prisma6_outbox_identity
                ON resilientmq_outbox_events(namespace, messageId);
        `);
        database.close();
        const moduleUrl = pathToFileURL(resolve('test/compatibility/generated-prisma6/index.js')).href;
        const generated = await import(moduleUrl) as {PrismaClient: Prisma6ClientConstructor};
        prisma = new generated.PrismaClient();
    });

    beforeEach(async () => {
        await prisma.resilientMqInboxEvent.deleteMany();
        await prisma.resilientMqOutboxEvent.deleteMany();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('executes the fenced contracts using Prisma 6.19', async () => {
        const stores = createPrismaEventStores({client: prisma, namespace: 'prisma6'});
        const event: EventMessage = {messageId: 'event-1', payload: {version: 6}};
        expect(await stores.publisher.saveEventIfNotExists(event)).toBe(true);
        expect(await stores.publisher.saveEventIfNotExists(event)).toBe(false);
        const claims = await Promise.all(Array.from({length: 16}, (_, index) => stores.consumer.claimConsumeEvent({
            event,
            serviceId: 'consumer',
            instanceId: `replica-${index}`,
            attempt: 1,
            leaseDurationMs: 30_000,
            now: Date.now()
        })));
        expect(claims.filter(claim => claim.outcome === 'acquired')).toHaveLength(1);
    });
});
