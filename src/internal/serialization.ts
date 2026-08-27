import type {EventMessage} from '@resilientmq/core';

/** Database row fields needed to reconstruct an event. */
export interface StoredEventRow {
    messageId: string;
    type?: string | null;
    payloadJson: string;
    routingKey?: string | null;
    propertiesJson?: string | null;
    status?: string | null;
}

/** Serializes an event into provider-neutral scalar fields. */
export function serializeEvent(event: EventMessage): Record<string, unknown> {
    return {
        messageId: event.messageId,
        type: event.type ?? null,
        payloadJson: stringify(event.payload, 'payload'),
        routingKey: event.routingKey ?? null,
        propertiesJson: event.properties === undefined ? null : stringify(event.properties, 'properties')
    };
}

/** Reconstructs an event from a persistence row. */
export function deserializeEvent(row: StoredEventRow): EventMessage {
    const event: EventMessage = {
        messageId: row.messageId,
        payload: JSON.parse(row.payloadJson)
    };
    if (row.type !== null && row.type !== undefined) event.type = row.type;
    if (row.routingKey !== null && row.routingKey !== undefined) event.routingKey = row.routingKey;
    if (row.propertiesJson !== null && row.propertiesJson !== undefined) {
        event.properties = JSON.parse(row.propertiesJson) as NonNullable<EventMessage['properties']>;
    }
    if (row.status !== null && row.status !== undefined) event.status = row.status;
    return event;
}

/** Converts an Error into bounded persistence fields. */
export function serializeError(error: Error | undefined): Record<string, string | null> {
    if (!error) return {errorName: null, errorMessage: null, errorStack: null};
    return {
        errorName: error.name.slice(0, 255),
        errorMessage: error.message.slice(0, 8192),
        errorStack: error.stack?.slice(0, 32768) ?? null
    };
}

/** Detects a Prisma unique-constraint violation across client versions. */
export function isUniqueConstraintError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as {code?: unknown; cause?: unknown};
    if (candidate.code === 'P2002' || candidate.code === '23505') return true;
    return candidate.cause !== undefined && isUniqueConstraintError(candidate.cause);
}

/** Converts an unknown database row into a checked event row. */
export function asStoredEventRow(value: unknown): StoredEventRow {
    if (!value || typeof value !== 'object') throw new Error('Prisma returned an invalid event row');
    const row = value as Record<string, unknown>;
    if (typeof row.messageId !== 'string' || typeof row.payloadJson !== 'string') {
        throw new Error('Prisma returned an event row without messageId or payloadJson');
    }
    return row as unknown as StoredEventRow;
}

function stringify(value: unknown, field: string): string {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new Error(`${field} is not JSON serializable`);
        return serialized;
    } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : '';
        throw new TypeError(`Event ${field} is not JSON serializable${detail}`, {cause: error});
    }
}
