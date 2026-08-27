import {PrismaConsumerEventStore} from './consumer-store.js';
import {PrismaPublisherEventStore} from './publisher-store.js';
import {resolveStoreOptions} from './internal/delegate.js';
import type {PrismaEventStoreOptions, PrismaEventStores} from './types.js';

/** Builds inbox and outbox stores from one validated Prisma configuration. */
export class PrismaEventStoreFactory {
    private readonly resolved: ReturnType<typeof resolveStoreOptions>;

    /** Validates the namespace and resolves the generated Prisma delegates. */
    constructor(options: PrismaEventStoreOptions) {
        this.resolved = resolveStoreOptions(options);
    }

    /** Creates the inbox store. */
    createConsumerStore(): PrismaConsumerEventStore {
        return new PrismaConsumerEventStore(this.resolved.inbox, this.resolved.namespace);
    }

    /** Creates the outbox store. */
    createPublisherStore(): PrismaPublisherEventStore {
        return new PrismaPublisherEventStore(this.resolved.outbox, this.resolved.namespace);
    }

    /** Creates the inbox and outbox stores as one pair. */
    createEventStores(): PrismaEventStores {
        return {
            consumer: this.createConsumerStore(),
            publisher: this.createPublisherStore()
        };
    }
}

/** Creates isolated inbox and outbox stores using an application-owned Prisma client. */
export function createPrismaEventStores(options: PrismaEventStoreOptions): PrismaEventStores {
    return new PrismaEventStoreFactory(options).createEventStores();
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
