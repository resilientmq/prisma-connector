/** Minimal mutation result shared by Prisma 6 and Prisma 7. */
export interface PrismaBatchPayload {
    /** Number of rows affected by the mutation. */
    count: number;
}

/** Structural model delegate required by the connector. */
export interface PrismaModelDelegate {
    /** Creates one record. */
    create(args: {data: Record<string, unknown>}): Promise<unknown>;

    /** Finds the first matching record. */
    findFirst(args: Record<string, unknown>): Promise<unknown | null>;

    /** Finds matching records. */
    findMany(args: Record<string, unknown>): Promise<unknown[]>;

    /** Updates every matching record. */
    updateMany(args: {where: Record<string, unknown>; data: Record<string, unknown>}): Promise<PrismaBatchPayload>;

    /** Deletes every matching record. */
    deleteMany(args: {where: Record<string, unknown>}): Promise<PrismaBatchPayload>;
}

/** Structural Prisma client accepted without taking ownership of its lifecycle. */
export type PrismaClientLike = object;

/** Generated delegate names used by the connector. */
export interface PrismaModelNames {
    /** Delegate for the ResilientMqInboxEvent model. */
    inbox: string;

    /** Delegate for the ResilientMqOutboxEvent model. */
    outbox: string;
}

/** Shared store configuration. */
export interface PrismaEventStoreOptions {
    /** Application-owned Prisma client. */
    client: PrismaClientLike;

    /** Stable partition that prevents unrelated applications from sharing event identities. */
    namespace: string;

    /** Optional generated delegate name overrides. */
    models?: Partial<PrismaModelNames>;
}

/** Fully resolved store configuration. */
export interface ResolvedPrismaEventStoreOptions {
    /** Stable event partition. */
    namespace: string;

    /** Inbox model delegate. */
    inbox: PrismaModelDelegate;

    /** Outbox model delegate. */
    outbox: PrismaModelDelegate;
}

/** Pair of stores intended for one resilient service. */
export interface PrismaEventStores {
    /** Store used by ResilientConsumer. */
    consumer: import('./consumer-store.js').PrismaConsumerEventStore;

    /** Store used by ResilientEventPublisher. */
    publisher: import('./publisher-store.js').PrismaPublisherEventStore;
}
