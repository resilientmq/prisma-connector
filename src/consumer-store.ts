import {randomUUID} from 'node:crypto';
import {
    EventConsumeStatus,
    type ConsumeClaimRequest,
    type ConsumeClaimResult,
    type ConsumeTransitionRequest,
    type ConsumerEventStore,
    type EventMessage
} from '@resilientmq/core';
import {INBOX_RETRYABLE_STATUSES} from './constants.js';
import type {PrismaModelDelegate} from './types.js';
import {asStoredEventRow, deserializeEvent, isUniqueConstraintError, serializeError, serializeEvent} from './internal/serialization.js';
import {toDate, toMilliseconds} from './internal/time.js';

/** Prisma-backed inbox store with atomic leases and fenced transitions. */
export class PrismaConsumerEventStore implements ConsumerEventStore {
    private readonly legacyServiceId = '__legacy__';

    /** Creates a consumer store for one namespace and generated inbox delegate. */
    constructor(
        private readonly inbox: PrismaModelDelegate,
        private readonly namespace: string
    ) {}

    /** Persists an event for compatibility with the legacy EventStore surface. */
    async saveEvent(event: EventMessage): Promise<void> {
        await this.inbox.create({
            data: {
                namespace: this.namespace,
                serviceId: this.legacyServiceId,
                ...serializeEvent(event),
                status: event.status ?? EventConsumeStatus.RECEIVED
            }
        });
    }

    /** Updates a legacy inbox event status. */
    async updateEventStatus(event: EventMessage, status: EventConsumeStatus): Promise<void> {
        await this.inbox.updateMany({
            where: this.legacyIdentity(event),
            data: {status, updatedAt: new Date()}
        });
    }

    /** Retrieves a legacy inbox event. */
    async getEvent(event: EventMessage): Promise<EventMessage | null> {
        const row = await this.inbox.findFirst({where: this.legacyIdentity(event)});
        return row ? deserializeEvent(asStoredEventRow(row)) : null;
    }

    /** Deletes a legacy inbox event. */
    async deleteEvent(event: EventMessage): Promise<void> {
        await this.inbox.deleteMany({where: this.legacyIdentity(event)});
    }

    /** Retrieves legacy inbox events by status. */
    async getEventsByStatus(status: EventConsumeStatus): Promise<EventMessage[]> {
        const rows = await this.inbox.findMany({
            where: {namespace: this.namespace, serviceId: this.legacyServiceId, status},
            orderBy: {createdAt: 'asc'}
        });
        return rows.map(row => deserializeEvent(asStoredEventRow(row)));
    }

    /** Applies legacy status updates in parallel. */
    async batchUpdateEventStatus(updates: Array<{event: EventMessage; status: EventConsumeStatus}>): Promise<void> {
        await Promise.all(updates.map(({event, status}) => this.updateEventStatus(event, status)));
    }

    /** Atomically acquires a new or expired inbox lease. */
    async claimConsumeEvent(request: ConsumeClaimRequest, contentionRetry = 0): Promise<ConsumeClaimResult> {
        const fencingToken = randomUUID();
        const leaseExpiresAt = request.now + request.leaseDurationMs;
        const identity = this.identity(request.serviceId, request.event);
        try {
            await this.inbox.create({
                data: {
                    namespace: this.namespace,
                    serviceId: request.serviceId,
                    ...serializeEvent(request.event),
                    status: EventConsumeStatus.PROCESSING,
                    attempt: request.attempt,
                    instanceId: request.instanceId,
                    fencingToken,
                    leaseExpiresAt: toDate(leaseExpiresAt),
                    lastAttemptAt: toDate(request.now)
                }
            });
            return {outcome: 'acquired', fencingToken, leaseExpiresAt};
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;
        }

        const claimed = await this.inbox.updateMany({
            where: {
                ...identity,
                OR: [
                    {status: {in: [...INBOX_RETRYABLE_STATUSES]}},
                    {
                        status: EventConsumeStatus.PROCESSING,
                        OR: [{leaseExpiresAt: null}, {leaseExpiresAt: {lte: toDate(request.now)}}]
                    }
                ]
            },
            data: {
                ...serializeEvent(request.event),
                status: EventConsumeStatus.PROCESSING,
                attempt: request.attempt,
                instanceId: request.instanceId,
                fencingToken,
                leaseExpiresAt: toDate(leaseExpiresAt),
                lastAttemptAt: toDate(request.now),
                completedAt: null,
                ...serializeError(undefined)
            }
        });
        if (claimed.count === 1) return {outcome: 'acquired', fencingToken, leaseExpiresAt};

        const current = await this.inbox.findFirst({where: identity});
        if (!current || typeof current !== 'object') {
            if (contentionRetry >= 3) throw new Error('Inbox claim could not stabilize after concurrent deletion');
            return this.claimConsumeEvent(request, contentionRetry + 1);
        }
        const row = current as Record<string, unknown>;
        if (row.status === EventConsumeStatus.DONE || row.status === EventConsumeStatus.ERROR) {
            return {outcome: 'completed'};
        }
        return {outcome: 'busy', leaseExpiresAt: toMilliseconds(row.leaseExpiresAt)};
    }

    /** Applies a terminal or retry transition only for the current lease owner. */
    async transitionConsumeEvent(request: ConsumeTransitionRequest): Promise<boolean> {
        const result = await this.inbox.updateMany({
            where: {
                ...this.identity(request.serviceId, request.event),
                status: EventConsumeStatus.PROCESSING,
                instanceId: request.instanceId,
                fencingToken: String(request.fencingToken)
            },
            data: {
                status: request.status,
                instanceId: null,
                fencingToken: null,
                leaseExpiresAt: null,
                completedAt: request.status === EventConsumeStatus.DONE || request.status === EventConsumeStatus.ERROR
                    ? toDate(request.now)
                    : null,
                updatedAt: toDate(request.now),
                ...serializeError(request.error)
            }
        });
        return result.count === 1;
    }

    private identity(serviceId: string, event: EventMessage): Record<string, unknown> {
        return {namespace: this.namespace, serviceId, messageId: event.messageId};
    }

    private legacyIdentity(event: EventMessage): Record<string, unknown> {
        return this.identity(this.legacyServiceId, event);
    }
}
