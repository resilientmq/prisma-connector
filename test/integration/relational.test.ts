import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {PrismaMariaDb} from '@prisma/adapter-mariadb';
import {PrismaPg} from '@prisma/adapter-pg';
import type {EventMessage} from '@resilientmq/core';
import {createPrismaEventStores, type PrismaClientLike} from '../../src/index.js';

interface IntegrationPrismaClient extends PrismaClientLike {
    $disconnect(): Promise<void>;
    resilientMqInboxEvent: {deleteMany(): Promise<unknown>};
    resilientMqOutboxEvent: {deleteMany(): Promise<unknown>};
    resilientMqMetricEvent: {deleteMany(): Promise<unknown>; findMany(): Promise<Array<Record<string, unknown>>>};
}

type PrismaClientConstructor = new (options: {adapter: unknown}) => IntegrationPrismaClient;

const provider = process.env.TEST_DATABASE_PROVIDER;
const enabled = provider === 'postgresql' || provider === 'mysql';
const integration = enabled ? describe : describe.skip;

integration(`Prisma 7 ${provider ?? 'relational'} integration`, () => {
    let prisma: IntegrationPrismaClient;
    const message: EventMessage = {messageId: 'relational-event', type: 'integration.test', payload: {valid: true}};

    beforeAll(async () => {
        const generated = provider === 'postgresql' ? 'generated-postgresql' : 'generated-mysql';
        const moduleUrl = pathToFileURL(resolve(`test/integration/${generated}/client.ts`)).href;
        const module = await import(moduleUrl) as {PrismaClient: PrismaClientConstructor};
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is required for relational integration tests');
        const adapter = provider === 'postgresql' ? new PrismaPg(url) : new PrismaMariaDb(url);
        prisma = new module.PrismaClient({adapter});
    });

    beforeEach(async () => {
        await prisma.resilientMqInboxEvent.deleteMany();
        await prisma.resilientMqOutboxEvent.deleteMany();
        await prisma.resilientMqMetricEvent.deleteMany();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('preserves exclusive inbox and outbox ownership under contention', async () => {
        const stores = createPrismaEventStores({client: prisma, namespace: 'relational'});
        const inboxClaims = await Promise.all(Array.from({length: 24}, (_, index) => stores.consumer.claimConsumeEvent({
            event: message,
            serviceId: 'consumer',
            instanceId: `consumer-${index}`,
            attempt: 1,
            leaseDurationMs: 30_000,
            now: Date.now()
        })));
        expect(inboxClaims.filter(claim => claim.outcome === 'acquired')).toHaveLength(1);

        const messages = Array.from({length: 48}, (_, index) => ({...message, messageId: `publish-${index}`}));
        await Promise.all(messages.map(event => stores.publisher.saveEvent(event)));
        const batches = await Promise.all(Array.from({length: 6}, (_, index) => stores.publisher.claimPendingEvents({
            serviceId: 'publisher',
            instanceId: `publisher-${index}`,
            limit: 8,
            leaseDurationMs: 30_000,
            now: Date.now()
        })));
        const claimed = batches.flat().map(claim => claim.event.messageId);
        expect(claimed).toHaveLength(48);
        expect(new Set(claimed)).toHaveLength(48);
    });

    it('stores native JSON payloads and buffered metric facts', async () => {
        const stores = createPrismaEventStores({client: prisma, namespace: 'relational', metrics: true});
        await stores.publisher.saveEvent(message);
        await expect(stores.publisher.getEvent(message)).resolves.toMatchObject(message);
        stores.metricsSink?.emit({name: 'publish.confirmed', timestamp: 2_000, messageId: message.messageId});
        await stores.metricsSink?.flush();
        await expect(prisma.resilientMqMetricEvent.findMany()).resolves.toMatchObject([{
            namespace: 'relational',
            name: 'publish.confirmed',
            messageId: message.messageId,
            timestamp: new Date(2_000)
        }]);
    });
});
