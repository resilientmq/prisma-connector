import {BufferedMetricsSink} from '@resilientmq/core';
import {PrismaConsumerEventStore} from './consumer-store.js';
import {PrismaMetricsSink} from './metrics-sink.js';
import {PrismaPublisherEventStore} from './publisher-store.js';
import {resolveDelegate, resolveModelNames, resolveStoreOptions} from './internal/delegate.js';
import type {PrismaEventStoreOptions, PrismaEventStores} from './types.js';

/** Builds inbox and outbox stores from one validated Prisma configuration. */
export class PrismaEventStoreFactory {
    private readonly resolved: ReturnType<typeof resolveStoreOptions>;
    private readonly metricsSink: BufferedMetricsSink | undefined;

    /** Validates the namespace and resolves the generated Prisma delegates. */
    constructor(options: PrismaEventStoreOptions) {
        this.resolved = resolveStoreOptions(options);
        const metricsOptions = options.metrics === true ? {} : options.metrics || undefined;
        if (metricsOptions) {
            const names = resolveModelNames(options.models);
            const sink = new PrismaMetricsSink(resolveDelegate(options.client, names.metrics), this.resolved.namespace);
            this.metricsSink = new BufferedMetricsSink(
                sink,
                metricsOptions.bufferCapacity ?? 10_000,
                metricsOptions.batchSize ?? 100
            );
        }
    }

    /** Creates the inbox store. */
    createConsumerStore(): PrismaConsumerEventStore {
        return new PrismaConsumerEventStore(this.resolved.inbox, this.resolved.namespace);
    }

    /** Creates the outbox store. */
    createPublisherStore(): PrismaPublisherEventStore {
        return new PrismaPublisherEventStore(this.resolved.outbox, this.resolved.namespace);
    }

    /** Returns the shared buffered metrics sink when persistence is enabled. */
    createMetricsSink(): BufferedMetricsSink | undefined {
        return this.metricsSink;
    }

    /** Creates the inbox and outbox stores as one pair. */
    createEventStores(): PrismaEventStores {
        const consumer = this.createConsumerStore();
        const publisher = this.createPublisherStore();
        const metricsSink = this.createMetricsSink();
        return {
            consumer,
            publisher,
            ...(metricsSink ? {metricsSink} : {}),
            consumerOptions: {store: consumer, ...(metricsSink ? {metricsSink} : {})},
            publisherOptions: {store: publisher, ...(metricsSink ? {metricsSink} : {})}
        };
    }
}

/** Creates isolated inbox and outbox stores using an application-owned Prisma client. */
export function createPrismaEventStores(options: PrismaEventStoreOptions): PrismaEventStores {
    return new PrismaEventStoreFactory(options).createEventStores();
}

export {PrismaConsumerEventStore} from './consumer-store.js';
export {PrismaPublisherEventStore} from './publisher-store.js';
export {PrismaMetricsSink} from './metrics-sink.js';
export {OUTBOX_CLAIMED_STATUS} from './constants.js';
export type {
    PrismaBatchPayload,
    PrismaClientLike,
    PrismaEventStoreOptions,
    PrismaEventStores,
    PrismaMetricsOptions,
    PrismaModelDelegate,
    PrismaModelNames
} from './types.js';
