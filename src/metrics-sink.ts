import type {MetricsSink, ResilienceMetricEvent} from '@resilientmq/core';
import type {PrismaModelDelegate} from './types.js';

/** Persists compact ResilientMQ metric facts through a Prisma model delegate. */
export class PrismaMetricsSink implements MetricsSink {
    /** Creates a metrics sink for one stable application namespace. */
    constructor(
        private readonly metrics: PrismaModelDelegate,
        private readonly namespace: string
    ) {}

    /** Persists one event-oriented metric fact. */
    async emit(event: ResilienceMetricEvent): Promise<void> {
        await this.metrics.create({
            data: removeUndefined({
                namespace: this.namespace,
                ...event,
                timestamp: new Date(event.timestamp)
            })
        });
    }
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
