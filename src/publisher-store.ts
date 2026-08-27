import {randomUUID} from 'node:crypto';
import {
    EventPublishStatus,
    type ClaimedPublishEvent,
    type DistributedPublisherEventStore,
    type EventMessage,
    type PublishClaimRequest,
    type PublishEventClaimRequest,
    type PublishTransitionRequest
} from '@resilientmq/core';
import {OUTBOX_CLAIMED_STATUS, OUTBOX_READY_STATUSES} from './constants.js';
import type {PrismaModelDelegate} from './types.js';
import {asStoredEventRow, deserializeEvent, isUniqueConstraintError, serializeError, serializeEvent} from './internal/serialization.js';
import {toDate} from './internal/time.js';

/** Prisma-backed outbox store with distributed leases and fenced transitions. */
export class PrismaPublisherEventStore implements DistributedPublisherEventStore {
    /** Creates a publisher store for one namespace and generated outbox delegate. */
    constructor(
        private readonly outbox: PrismaModelDelegate,
        private readonly namespace: string
    ) {}

    /** Persists an outbox event. */
    async saveEvent(event: EventMessage): Promise<void> {
        await this.outbox.create({data: this.newEventData(event)});
    }

    /** Persists an outbox event only when its namespace and message ID are new. */
    async saveEventIfNotExists(event: EventMessage): Promise<boolean> {
        try {
            await this.saveEvent(event);
            return true;
        } catch (error) {
            if (isUniqueConstraintError(error)) return false;
            throw error;
        }
    }

    /** Updates an outbox status through the compatibility surface. */
    async updateEventStatus(event: EventMessage, status: EventPublishStatus): Promise<void> {
        await this.outbox.updateMany({
            where: this.identity(event),
            data: {status, updatedAt: new Date()}
        });
    }

    /** Retrieves one outbox event. */
    async getEvent(event: EventMessage): Promise<EventMessage | null> {
        const row = await this.outbox.findFirst({where: this.identity(event)});
        return row ? deserializeEvent(asStoredEventRow(row)) : null;
    }

    /** Deletes one outbox event. */
    async deleteEvent(event: EventMessage): Promise<void> {
        await this.outbox.deleteMany({where: this.identity(event)});
    }

    /** Retrieves outbox events by exact status. */
    async getEventsByStatus(status: EventPublishStatus): Promise<EventMessage[]> {
        return this.getPendingEvents(status);
    }

    /** Retrieves a bounded set of outbox events by exact status. */
    async getPendingEvents(status: EventPublishStatus, limit = 100): Promise<EventMessage[]> {
        const rows = await this.outbox.findMany({
            where: {namespace: this.namespace, status},
            orderBy: {createdAt: 'asc'},
            take: Math.max(0, limit)
        });
        return rows.map(row => deserializeEvent(asStoredEventRow(row)));
    }

    /** Applies compatibility status updates in parallel. */
    async batchUpdateEventStatus(updates: Array<{event: EventMessage; status: EventPublishStatus}>): Promise<void> {
        await Promise.all(updates.map(({event, status}) => this.updateEventStatus(event, status)));
    }

    /** Atomically claims one known outbox event. */
    async claimPublishEvent(request: PublishEventClaimRequest): Promise<ClaimedPublishEvent | null> {
        const fencingToken = randomUUID();
        const leaseExpiresAt = request.now + request.leaseDurationMs;
        const result = await this.outbox.updateMany({
            where: {
                ...this.identity(request.event),
                OR: this.claimableConditions(request.now)
            },
            data: {
                status: OUTBOX_CLAIMED_STATUS,
                serviceId: request.serviceId,
                instanceId: request.instanceId,
                fencingToken,
                leaseExpiresAt: toDate(leaseExpiresAt),
                lastAttemptAt: toDate(request.now),
                attempt: {increment: 1},
                ...serializeError(undefined)
            }
        });
        if (result.count !== 1) return null;
        return {event: request.event, fencingToken, leaseExpiresAt};
    }

    /** Claims a bounded batch without allowing two replicas to own the same row. */
    async claimPendingEvents(request: PublishClaimRequest): Promise<ClaimedPublishEvent[]> {
        if (request.limit <= 0) return [];
        const candidates = await this.outbox.findMany({
            where: {
                namespace: this.namespace,
                OR: this.claimableConditions(request.now)
            },
            orderBy: [{nextAttemptAt: 'asc'}, {createdAt: 'asc'}],
            take: request.limit * 8
        });
        const claims: ClaimedPublishEvent[] = [];
        for (const row of candidates) {
            if (claims.length === request.limit) break;
            const event = deserializeEvent(asStoredEventRow(row));
            const claim = await this.claimPublishEvent({...request, event});
            if (claim) claims.push(claim);
        }
        return claims;
    }

    /** Completes publication only for the active fencing token. */
    async completePublishedEvent(request: PublishTransitionRequest): Promise<boolean> {
        const result = await this.outbox.updateMany({
            where: this.ownedIdentity(request),
            data: {
                status: EventPublishStatus.PUBLISHED,
                serviceId: null,
                instanceId: null,
                fencingToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                publishedAt: toDate(request.now),
                updatedAt: toDate(request.now),
                ...serializeError(undefined)
            }
        });
        return result.count === 1;
    }

    /** Releases a failed publication for a future fenced claim. */
    async releasePublishEvent(request: PublishTransitionRequest): Promise<boolean> {
        const result = await this.outbox.updateMany({
            where: this.ownedIdentity(request),
            data: {
                status: EventPublishStatus.ERROR,
                serviceId: null,
                instanceId: null,
                fencingToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: toDate(request.nextAttemptAt ?? request.now),
                updatedAt: toDate(request.now),
                ...serializeError(request.error)
            }
        });
        return result.count === 1;
    }

    private newEventData(event: EventMessage): Record<string, unknown> {
        return {
            namespace: this.namespace,
            ...serializeEvent(event),
            status: EventPublishStatus.PENDING
        };
    }

    private identity(event: EventMessage): Record<string, unknown> {
        return {namespace: this.namespace, messageId: event.messageId};
    }

    private ownedIdentity(request: PublishTransitionRequest): Record<string, unknown> {
        return {
            ...this.identity(request.event),
            status: OUTBOX_CLAIMED_STATUS,
            serviceId: request.serviceId,
            instanceId: request.instanceId,
            fencingToken: String(request.fencingToken)
        };
    }

    private claimableConditions(now: number): Record<string, unknown>[] {
        return [
            {
                status: {in: [...OUTBOX_READY_STATUSES]},
                OR: [{nextAttemptAt: null}, {nextAttemptAt: {lte: toDate(now)}}]
            },
            {
                status: OUTBOX_CLAIMED_STATUS,
                OR: [{leaseExpiresAt: null}, {leaseExpiresAt: {lte: toDate(now)}}]
            }
        ];
    }
}
