import {EventConsumeStatus, type EventMessage} from '@resilientmq/core';
import {PrismaConsumerEventStore} from '../src/index.js';
import {MemoryPrismaDelegate} from './support/memory-delegate.js';

const event: EventMessage = {messageId: 'event-1', type: 'order.created', payload: {orderId: 42}};

describe('PrismaConsumerEventStore', () => {
    it('allows only one owner under concurrent claims', async () => {
        const store = new PrismaConsumerEventStore(new MemoryPrismaDelegate(), 'orders');
        const claims = await Promise.all(Array.from({length: 100}, (_, index) => store.claimConsumeEvent({
            event,
            serviceId: 'consumer-service',
            instanceId: `instance-${index}`,
            attempt: 1,
            leaseDurationMs: 30_000,
            now: 1_000
        })));

        expect(claims.filter(claim => claim.outcome === 'acquired')).toHaveLength(1);
        expect(claims.filter(claim => claim.outcome === 'busy')).toHaveLength(99);
    });

    it('recovers an expired lease and rejects the stale fencing token', async () => {
        const store = new PrismaConsumerEventStore(new MemoryPrismaDelegate(), 'orders');
        const first = await store.claimConsumeEvent({
            event, serviceId: 'service', instanceId: 'old', attempt: 1, leaseDurationMs: 100, now: 1_000
        });
        const recovered = await store.claimConsumeEvent({
            event, serviceId: 'service', instanceId: 'new', attempt: 2, leaseDurationMs: 100, now: 1_101
        });
        expect(first.outcome).toBe('acquired');
        expect(recovered.outcome).toBe('acquired');
        if (first.outcome !== 'acquired' || recovered.outcome !== 'acquired') throw new Error('Expected acquired claims');

        await expect(store.transitionConsumeEvent({
            event,
            serviceId: 'service',
            instanceId: 'old',
            fencingToken: first.fencingToken,
            status: EventConsumeStatus.DONE,
            now: 1_102
        })).resolves.toBe(false);
        await expect(store.transitionConsumeEvent({
            event,
            serviceId: 'service',
            instanceId: 'new',
            fencingToken: recovered.fencingToken,
            status: EventConsumeStatus.DONE,
            now: 1_103
        })).resolves.toBe(true);
    });

    it('reports terminal events as completed', async () => {
        const store = new PrismaConsumerEventStore(new MemoryPrismaDelegate(), 'orders');
        const claim = await store.claimConsumeEvent({
            event, serviceId: 'service', instanceId: 'one', attempt: 1, leaseDurationMs: 100, now: 1_000
        });
        if (claim.outcome !== 'acquired') throw new Error('Expected acquired claim');
        await store.transitionConsumeEvent({
            event,
            serviceId: 'service',
            instanceId: 'one',
            fencingToken: claim.fencingToken,
            status: EventConsumeStatus.DONE,
            now: 1_001
        });

        await expect(store.claimConsumeEvent({
            event, serviceId: 'service', instanceId: 'two', attempt: 2, leaseDurationMs: 100, now: 2_000
        })).resolves.toEqual({outcome: 'completed'});
    });

    it('allows a retry transition to be reclaimed immediately', async () => {
        const store = new PrismaConsumerEventStore(new MemoryPrismaDelegate(), 'orders');
        const claim = await store.claimConsumeEvent({
            event, serviceId: 'service', instanceId: 'one', attempt: 1, leaseDurationMs: 100, now: 1_000
        });
        if (claim.outcome !== 'acquired') throw new Error('Expected acquired claim');
        await store.transitionConsumeEvent({
            event,
            serviceId: 'service',
            instanceId: 'one',
            fencingToken: claim.fencingToken,
            status: EventConsumeStatus.RETRY,
            now: 1_001,
            error: new Error('temporary')
        });

        const retry = await store.claimConsumeEvent({
            event, serviceId: 'service', instanceId: 'two', attempt: 2, leaseDurationMs: 100, now: 1_002
        });
        expect(retry.outcome).toBe('acquired');
    });

    it('implements the legacy CRUD compatibility surface', async () => {
        const delegate = new MemoryPrismaDelegate();
        const store = new PrismaConsumerEventStore(delegate, 'orders');
        await store.saveEvent(event);
        expect(await store.getEvent(event)).toMatchObject(event);
        await store.updateEventStatus(event, EventConsumeStatus.RETRY);
        expect(await store.getEventsByStatus(EventConsumeStatus.RETRY)).toHaveLength(1);
        await store.batchUpdateEventStatus([{event, status: EventConsumeStatus.DONE}]);
        expect((await store.getEvent(event))?.status).toBe(EventConsumeStatus.DONE);
        await store.deleteEvent(event);
        expect(await store.getEvent(event)).toBeNull();
    });

    it('rejects payloads that cannot be serialized', async () => {
        const store = new PrismaConsumerEventStore(new MemoryPrismaDelegate(), 'orders');
        await expect(store.claimConsumeEvent({
            event: {messageId: 'invalid', payload: 1n},
            serviceId: 'service',
            instanceId: 'one',
            attempt: 1,
            leaseDurationMs: 100,
            now: 1_000
        })).rejects.toThrow(/not JSON serializable/);
    });

    it('rejects invalid lease timestamps', async () => {
        const store = new PrismaConsumerEventStore(new MemoryPrismaDelegate(), 'orders');
        await expect(store.claimConsumeEvent({
            event,
            serviceId: 'service',
            instanceId: 'one',
            attempt: 1,
            leaseDurationMs: 100,
            now: Number.NaN
        })).rejects.toThrow(/Invalid Unix timestamp/);
    });
});
