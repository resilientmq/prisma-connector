import type {EventMessage} from '@resilientmq/core';

/** Database row fields needed to reconstruct an event. */
export interface StoredEventRow {
    messageId: string;
    type?: string | null;
    payloadJson: unknown;
    routingKey?: string | null;
    propertiesJson?: unknown;
    status?: string | null;
}

/** Serializes an event into provider-neutral scalar fields. */
export function serializeEvent(event: EventMessage): Record<string, unknown> {
    const serialized: Record<string, unknown> = {
        messageId: event.messageId,
        type: event.type ?? null,
        payloadJson: jsonValue(event.payload, 'payload'),
        routingKey: event.routingKey ?? null
    };
    if (event.properties !== undefined) {
        serialized.propertiesJson = jsonValue(event.properties, 'properties');
    }
    return serialized;
}

/** Reconstructs an event from a persistence row. */
export function deserializeEvent(row: StoredEventRow): EventMessage {
    const legacyEnvelope = isValueEnvelope(row.payloadJson)
        && (isValueEnvelope(row.propertiesJson) || isAbsentEnvelope(row.propertiesJson));
    const event: EventMessage = {
        messageId: row.messageId,
        payload: decodeJson(
            legacyEnvelope && isValueEnvelope(row.payloadJson)
                ? envelopeValue(row.payloadJson)
                : row.payloadJson
        )
    };
    if (row.type !== null && row.type !== undefined) event.type = row.type;
    if (row.routingKey !== null && row.routingKey !== undefined) event.routingKey = row.routingKey;
    if (row.propertiesJson !== null && row.propertiesJson !== undefined && !isAbsentEnvelope(row.propertiesJson)) {
        const storedProperties = legacyEnvelope && isValueEnvelope(row.propertiesJson)
            ? envelopeValue(row.propertiesJson)
            : row.propertiesJson;
        event.properties = decodeJson(storedProperties) as NonNullable<EventMessage['properties']>;
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
    if (typeof row.messageId !== 'string' || row.payloadJson === undefined) {
        throw new Error('Prisma returned an event row without messageId or payloadJson');
    }
    return row as unknown as StoredEventRow;
}

function jsonValue(value: unknown, field: string): unknown {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new Error(`${field} is not JSON serializable`);
        return JSON.parse(serialized);
    } catch (error) {
        const detail = error instanceof Error ? `: ${error.message}` : '';
        throw new TypeError(`Event ${field} is not JSON serializable${detail}`, {cause: error});
    }
}

function decodeJson(value: unknown): unknown {
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

function isValueEnvelope(value: unknown): value is {value: unknown} {
    return Boolean(
        value
        && typeof value === 'object'
        && Object.keys(value).length === 1
        && Object.hasOwn(value, 'value')
    );
}

function envelopeValue(value: {value: unknown}): unknown {
    return value.value;
}

function isAbsentEnvelope(value: unknown): boolean {
    return Boolean(
        value
        && typeof value === 'object'
        && Object.keys(value).length === 1
        && (value as {absent?: unknown}).absent === true
    );
}
