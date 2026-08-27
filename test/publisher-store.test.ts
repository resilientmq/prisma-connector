import {EventPublishStatus, type EventMessage} from '@resilientmq/core';
import {PrismaPublisherEventStore} from '../src/index.js';
import {MemoryPrismaDelegate} from './support/memory-delegate.js';

const event = (messageId: string): EventMessage => ({messageId, type: 'order.created', payload: {messageId}});

describe('PrismaPublisherEventStore', () => {
    it('inserts an event idempotently under concurrency', async () => {
        const store = new PrismaPublisherEventStore(new MemoryPrismaDelegate(), 'orders');
        const inserted = await Promise.all(Array.from({length: 100}, () => store.saveEventIfNotExists(event('one'))));
        expect(inserted.filter(Boolean)).toHaveLength(1);
    });

    it('distributes a batch without duplicate ownership', async () => {
        const delegate = new MemoryPrismaDelegate();
        const stores = Array.from({length: 8}, () => new PrismaPublisherEventStore(delegate, 'orders'));
        await Promise.all(Array.from({length: 80}, (_, index) => stores[0]!.saveEvent(event(`event-${index}`))));

        const batches = await Promise.all(stores.map((store, index) => store.claimPendingEvents({
            serviceId: 'publisher',
            instanceId: `replica-${index}`,
            limit: 20,
            leaseDurationMs: 30_000,
            now: 1_000
        })));
        const messageIds = batches.flat().map(claim => claim.event.messageId);
        expect(new Set(messageIds).size).toBe(messageIds.length);
        expect(messageIds).toHaveLength(80);
    });

    it('recovers expired publications and fences the previous owner', async () => {
        const store = new PrismaPublisherEventStore(new MemoryPrismaDelegate(), 'orders');
        const message = event('one');
        await store.saveEvent(message);
        const first = await store.claimPublishEvent({
            event: message, serviceId: 'publisher', instanceId: 'old', leaseDurationMs: 100, now: 1_000
        });
        const recovered = await store.claimPublishEvent({
            event: message, serviceId: 'publisher', instanceId: 'new', leaseDurationMs: 100, now: 1_101
        });
        expect(first).not.toBeNull();
        expect(recovered).not.toBeNull();
        if (!first || !recovered) throw new Error('Expected claims');

        await expect(store.completePublishedEvent({
            event: message,
            serviceId: 'publisher',
            instanceId: 'old',
            fencingToken: first.fencingToken,
            now: 1_102
        })).resolves.toBe(false);
        await expect(store.completePublishedEvent({
            event: message,
            serviceId: 'publisher',
            instanceId: 'new',
            fencingToken: recovered.fencingToken,
            now: 1_103
        })).resolves.toBe(true);
        expect((await store.getEvent(message))?.status).toBe(EventPublishStatus.PUBLISHED);
    });

    it('honors the retry deadline after releasing a claim', async () => {
        const store = new PrismaPublisherEventStore(new MemoryPrismaDelegate(), 'orders');
        const message = event('one');
        await store.saveEvent(message);
        const claim = await store.claimPublishEvent({
            event: message, serviceId: 'publisher', instanceId: 'one', leaseDurationMs: 100, now: 1_000
        });
        if (!claim) throw new Error('Expected claim');
        await store.releasePublishEvent({
            event: message,
            serviceId: 'publisher',
            instanceId: 'one',
            fencingToken: claim.fencingToken,
            now: 1_001,
            nextAttemptAt: 2_000,
            error: new Error('broker unavailable')
        });

        await expect(store.claimPublishEvent({
            event: message, serviceId: 'publisher', instanceId: 'early', leaseDurationMs: 100, now: 1_999
        })).resolves.toBeNull();
        await expect(store.claimPublishEvent({
            event: message, serviceId: 'publisher', instanceId: 'ready', leaseDurationMs: 100, now: 2_000
        })).resolves.not.toBeNull();
    });

    it('isolates identical message IDs in different namespaces', async () => {
        const delegate = new MemoryPrismaDelegate();
        const first = new PrismaPublisherEventStore(delegate, 'orders');
        const second = new PrismaPublisherEventStore(delegate, 'billing');
        await expect(first.saveEventIfNotExists(event('shared'))).resolves.toBe(true);
        await expect(second.saveEventIfNotExists(event('shared'))).resolves.toBe(true);
    });

    it('implements the legacy CRUD and bounded query surface', async () => {
        const store = new PrismaPublisherEventStore(new MemoryPrismaDelegate(), 'orders');
        await store.saveEvent(event('one'));
        await store.saveEvent(event('two'));
        expect(await store.getPendingEvents(EventPublishStatus.PENDING, 1)).toHaveLength(1);
        await store.batchUpdateEventStatus([{event: event('one'), status: EventPublishStatus.PUBLISHED}]);
        expect(await store.getEventsByStatus(EventPublishStatus.PUBLISHED)).toHaveLength(1);
        await store.deleteEvent(event('one'));
        expect(await store.getEvent(event('one'))).toBeNull();
    });

    it('returns no claims for an empty batch request', async () => {
        const store = new PrismaPublisherEventStore(new MemoryPrismaDelegate(), 'orders');
        await expect(store.claimPendingEvents({
            serviceId: 'publisher', instanceId: 'one', limit: 0, leaseDurationMs: 100, now: 1_000
        })).resolves.toEqual([]);
    });
});
