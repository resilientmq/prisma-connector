import {PrismaConsumerEventStore} from './consumer-store.js';
import {PrismaPublisherEventStore} from './publisher-store.js';
import {resolveStoreOptions} from './internal/delegate.js';
import type {PrismaEventStoreOptions, PrismaEventStores} from './types.js';

/** Creates isolated inbox and outbox stores using an application-owned Prisma client. */
export function createPrismaEventStores(options: PrismaEventStoreOptions): PrismaEventStores {
    const resolved = resolveStoreOptions(options);
    return {
        consumer: new PrismaConsumerEventStore(resolved.inbox, resolved.namespace),
        publisher: new PrismaPublisherEventStore(resolved.outbox, resolved.namespace)
    };
}

export {PrismaConsumerEventStore} from './consumer-store.js';
export {PrismaPublisherEventStore} from './publisher-store.js';
export {OUTBOX_CLAIMED_STATUS} from './constants.js';
export type {
    PrismaBatchPayload,
    PrismaClientLike,
    PrismaEventStoreOptions,
    PrismaEventStores,
    PrismaModelDelegate,
    PrismaModelNames
} from './types.js';
