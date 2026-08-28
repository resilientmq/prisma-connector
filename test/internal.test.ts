import type {EventMessage} from '@resilientmq/core';
import {
    asStoredEventRow,
    deserializeEvent,
    isUniqueConstraintError,
    serializeError,
    serializeEvent
} from '../src/internal/serialization.js';
import {toDate, toMilliseconds} from '../src/internal/time.js';

describe('Prisma value conversion', () => {
    it('round-trips every optional event field', () => {
        const event: EventMessage = {
            messageId: 'event-1',
            type: 'order.created',
            payload: {orderId: 42},
            routingKey: 'orders.created',
            properties: {headers: {traceId: 'trace-1'}},
            status: 'PENDING'
        };
        const serialized = serializeEvent(event);
        expect(serialized.payloadJson).toEqual({orderId: 42});
        expect(serialized.propertiesJson).toEqual({headers: {traceId: 'trace-1'}});
        const restored = deserializeEvent({
            ...serialized,
            status: event.status
        } as ReturnType<typeof asStoredEventRow>);

        expect(restored).toEqual(event);
    });

    it('omits absent optional event fields', () => {
        expect(serializeEvent({messageId: 'minimal', payload: null})).not.toHaveProperty('propertiesJson');
        expect(deserializeEvent({messageId: 'minimal', payloadJson: 'null'})).toEqual({
            messageId: 'minimal',
            payload: null
        });
    });

    it('reads legacy envelopes without wrapping new JSON documents', () => {
        expect(deserializeEvent({
            messageId: 'legacy',
            payloadJson: {value: {orderId: 42}},
            propertiesJson: {value: {headers: {traceId: 'trace-1'}}}
        })).toEqual({
            messageId: 'legacy',
            payload: {orderId: 42},
            properties: {headers: {traceId: 'trace-1'}}
        });
        expect(deserializeEvent({
            messageId: 'legacy-absent',
            payloadJson: {value: {orderId: 43}},
            propertiesJson: {absent: true}
        })).toEqual({messageId: 'legacy-absent', payload: {orderId: 43}});
        expect(deserializeEvent({
            messageId: 'direct-value-key',
            payloadJson: {value: {nested: true}},
            propertiesJson: {headers: {direct: true}}
        })).toEqual({
            messageId: 'direct-value-key',
            payload: {value: {nested: true}},
            properties: {headers: {direct: true}}
        });
    });

    it('serializes bounded errors and empty error state', () => {
        const error = new Error('failure');
        error.name = 'CustomError';
        expect(serializeError(error)).toMatchObject({errorName: 'CustomError', errorMessage: 'failure'});
        expect(serializeError(undefined)).toEqual({errorName: null, errorMessage: null, errorStack: null});
    });

    it('recognizes nested Prisma and PostgreSQL uniqueness errors', () => {
        expect(isUniqueConstraintError({code: 'P2002'})).toBe(true);
        expect(isUniqueConstraintError({cause: {code: '23505'}})).toBe(true);
        expect(isUniqueConstraintError({code: 'OTHER'})).toBe(false);
        expect(isUniqueConstraintError(null)).toBe(false);
    });

    it('validates database rows before deserialization', () => {
        expect(asStoredEventRow({messageId: 'one', payloadJson: '{}'})).toEqual({messageId: 'one', payloadJson: '{}'});
        expect(() => asStoredEventRow(null)).toThrow(/invalid event row/);
        expect(() => asStoredEventRow({messageId: 'one'})).toThrow(/without messageId or payloadJson/);
    });

    it('reports undefined, circular, and non-Error serialization failures', () => {
        expect(() => serializeEvent({messageId: 'undefined', payload: undefined})).toThrow(/not JSON serializable/);
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(() => serializeEvent({messageId: 'circular', payload: circular})).toThrow(/circular/i);
        expect(() => serializeEvent({
            messageId: 'throwing',
            payload: {toJSON: () => { throw 'serialization stopped'; }}
        })).toThrow('Event payload is not JSON serializable');
    });

    it('converts valid database dates and rejects invalid values', () => {
        expect(toDate(1_000)).toEqual(new Date(1_000));
        expect(toMilliseconds(new Date(2_000))).toBe(2_000);
        expect(toMilliseconds('1970-01-01T00:00:03.000Z')).toBe(3_000);
        expect(toMilliseconds(4_000)).toBe(4_000);
        expect(() => toDate(Number.POSITIVE_INFINITY)).toThrow(RangeError);
        expect(() => toMilliseconds('not-a-date')).toThrow(/invalid lease expiration/);
        expect(() => toMilliseconds({})).toThrow(/invalid lease expiration/);
    });
});
