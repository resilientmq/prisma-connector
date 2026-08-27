import {
    PrismaConsumerEventStore,
    PrismaEventStoreFactory,
    PrismaPublisherEventStore,
    createPrismaEventStores
} from '../src/index.js';
import {MemoryPrismaDelegate} from './support/memory-delegate.js';

describe('createPrismaEventStores', () => {
    it('resolves default and custom delegate names', () => {
        const inbox = new MemoryPrismaDelegate();
        const outbox = new MemoryPrismaDelegate();
        expect(createPrismaEventStores({
            client: {customInbox: inbox, customOutbox: outbox},
            namespace: 'service',
            models: {inbox: 'customInbox', outbox: 'customOutbox'}
        })).toMatchObject({consumer: expect.anything(), publisher: expect.anything()});
    });

    it('rejects an empty namespace or missing model delegate', () => {
        expect(() => createPrismaEventStores({client: {}, namespace: ' '})).toThrow(/namespace/);
        expect(() => createPrismaEventStores({client: {}, namespace: 'service'})).toThrow(/resilientMqInboxEvent/);
    });

    it('creates each store independently through the object-oriented factory', () => {
        const factory = new PrismaEventStoreFactory({
            client: {
                resilientMqInboxEvent: new MemoryPrismaDelegate(),
                resilientMqOutboxEvent: new MemoryPrismaDelegate()
            },
            namespace: 'orders'
        });

        expect(factory.createConsumerStore()).toBeInstanceOf(PrismaConsumerEventStore);
        expect(factory.createPublisherStore()).toBeInstanceOf(PrismaPublisherEventStore);
        expect(factory.createEventStores()).toEqual({
            consumer: expect.any(PrismaConsumerEventStore),
            publisher: expect.any(PrismaPublisherEventStore),
            consumerOptions: {store: expect.any(PrismaConsumerEventStore)},
            publisherOptions: {store: expect.any(PrismaPublisherEventStore)}
        });
    });

    it('creates one buffered metrics sink and ready-to-spread runtime options', async () => {
        const metrics = new MemoryPrismaDelegate();
        const stores = createPrismaEventStores({
            client: {
                resilientMqInboxEvent: new MemoryPrismaDelegate(),
                resilientMqOutboxEvent: new MemoryPrismaDelegate(),
                resilientMqMetricEvent: metrics
            },
            namespace: 'orders',
            metrics: {bufferCapacity: 20, batchSize: 5}
        });

        expect(stores.consumerOptions).toEqual({store: stores.consumer, metricsSink: stores.metricsSink});
        expect(stores.publisherOptions).toEqual({store: stores.publisher, metricsSink: stores.metricsSink});
        stores.metricsSink?.emit({
            name: 'publish.confirmed',
            timestamp: 1_000,
            messageId: 'event-1',
            durationMs: 12
        });
        await stores.metricsSink?.flush();
        expect(metrics.rows).toMatchObject([{
            namespace: 'orders',
            name: 'publish.confirmed',
            timestamp: new Date(1_000),
            messageId: 'event-1',
            durationMs: 12
        }]);
    });

    it('requires the metrics delegate only when metrics persistence is enabled', () => {
        const client = {
            resilientMqInboxEvent: new MemoryPrismaDelegate(),
            resilientMqOutboxEvent: new MemoryPrismaDelegate()
        };
        expect(() => createPrismaEventStores({client, namespace: 'orders'})).not.toThrow();
        expect(() => createPrismaEventStores({client, namespace: 'orders', metrics: true})).toThrow(/resilientMqMetricEvent/);
    });
});
