import type {EventMessage} from '@resilientmq/core';
import {
    Prisma8PostgresEventStoreFactory,
    createPrisma8PostgresEventStores,
    type Prisma8CollectionLike,
    type Prisma8Expression,
    type Prisma8FieldAccessor
} from '../src/v8/index.js';

type Expression =
    | {op: 'eq' | 'in' | 'lte'; field: string; value: unknown}
    | {op: 'null'; field: string}
    | {op: 'and' | 'or'; expressions: Expression[]};

type Row = Record<string, unknown>;

describe('Prisma 8 experimental bridge', () => {
    it('translates fenced claims to the Prisma 8 collection API', async () => {
        const inbox = new MemoryPrisma8Collection([], 'inbox');
        const outbox = new MemoryPrisma8Collection([], 'outbox');
        const stores = createPrisma8PostgresEventStores({
            client: {orm: {public: {ResilientMqInboxEvent: inbox, ResilientMqOutboxEvent: outbox}}},
            namespace: 'v8',
            operators: {
                and: (...expressions) => ({op: 'and', expressions}) as Expression,
                or: (...expressions) => ({op: 'or', expressions}) as Expression
            }
        });
        const event: EventMessage = {messageId: 'event-1', payload: {version: 8}};

        expect(await stores.publisher.saveEventIfNotExists(event)).toBe(true);
        expect(await stores.publisher.saveEventIfNotExists(event)).toBe(false);
        const claims = await Promise.all(Array.from({length: 20}, (_, index) => stores.consumer.claimConsumeEvent({
            event,
            serviceId: 'consumer',
            instanceId: `replica-${index}`,
            attempt: 1,
            leaseDurationMs: 30_000,
            now: 1_000
        })));
        expect(claims.filter(claim => claim.outcome === 'acquired')).toHaveLength(1);

        const publication = await stores.publisher.claimPublishEvent({
            event,
            serviceId: 'publisher',
            instanceId: 'publisher-1',
            leaseDurationMs: 30_000,
            now: 1_000
        });
        expect(publication).not.toBeNull();
        if (!publication) throw new Error('Expected publication claim');
        await expect(stores.publisher.completePublishedEvent({
            event,
            serviceId: 'publisher',
            instanceId: 'publisher-1',
            fencingToken: publication.fencingToken,
            now: 1_001
        })).resolves.toBe(true);
    });

    it('rejects missing namespaces and contract models', () => {
        const operators = {
            and: (...expressions: Prisma8Expression[]) => ({op: 'and', expressions}),
            or: (...expressions: Prisma8Expression[]) => ({op: 'or', expressions})
        };
        expect(() => createPrisma8PostgresEventStores({
            client: {orm: {}}, namespace: 'v8', operators
        })).toThrow(/public/);
        expect(() => createPrisma8PostgresEventStores({
            client: {orm: {public: {}}}, namespace: 'v8', operators
        })).toThrow(/models/);
    });

    it('creates individual stores through the object-oriented bridge', () => {
        const operators = {
            and: (...expressions: Prisma8Expression[]) => ({op: 'and', expressions}),
            or: (...expressions: Prisma8Expression[]) => ({op: 'or', expressions})
        };
        const factory = new Prisma8PostgresEventStoreFactory({
            client: {orm: {events: {
                ResilientMqInboxEvent: new MemoryPrisma8Collection([], 'inbox'),
                ResilientMqOutboxEvent: new MemoryPrisma8Collection([], 'outbox')
            }}},
            databaseNamespace: 'events',
            namespace: 'v8',
            operators
        });

        expect(factory.createConsumerStore()).toBeDefined();
        expect(factory.createPublisherStore()).toBeDefined();
        expect(factory.createEventStores()).toMatchObject({consumer: expect.anything(), publisher: expect.anything()});
    });
});

class MemoryPrisma8Collection implements Prisma8CollectionLike {
    constructor(
        private readonly rows: Row[],
        private readonly identity: 'inbox' | 'outbox',
        private readonly filters: Expression[] = [],
        private readonly orders: Array<{field: string; direction: 'asc' | 'desc'}> = [],
        private readonly maximum?: number
    ) {}

    where(predicate: (model: Record<string, Prisma8FieldAccessor>) => Prisma8Expression): Prisma8CollectionLike {
        return new MemoryPrisma8Collection(this.rows, this.identity, [...this.filters, predicate(accessors()) as Expression], this.orders, this.maximum);
    }

    orderBy(order: (model: Record<string, Prisma8FieldAccessor>) => unknown): Prisma8CollectionLike {
        return new MemoryPrisma8Collection(this.rows, this.identity, this.filters, [...this.orders, order(accessors()) as {field: string; direction: 'asc' | 'desc'}], this.maximum);
    }

    limit(value: number): Prisma8CollectionLike {
        return new MemoryPrisma8Collection(this.rows, this.identity, this.filters, this.orders, value);
    }

    all(): PromiseLike<unknown[]> {
        return Promise.resolve(this.selected().map(row => structuredClone(row)));
    }

    async first(): Promise<unknown | null> {
        return structuredClone(this.selected()[0] ?? null);
    }

    async create(data: Row): Promise<unknown> {
        const duplicate = this.rows.some(row => row.namespace === data.namespace && row.messageId === data.messageId
            && (this.identity === 'outbox' || row.serviceId === data.serviceId));
        if (duplicate) throw Object.assign(new Error('duplicate'), {code: '23505'});
        const now = new Date();
        const row = {
            id: String(this.rows.length + 1),
            attempt: 0,
            serviceId: null,
            instanceId: null,
            fencingToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            createdAt: now,
            updatedAt: now,
            ...structuredClone(data)
        };
        this.rows.push(row);
        return structuredClone(row);
    }

    async updateAndCount(data: Row): Promise<number> {
        const selected = this.selected();
        selected.forEach(row => Object.assign(row, structuredClone(data)));
        return selected.length;
    }

    async deleteAndCount(): Promise<number> {
        const selected = new Set(this.selected());
        const before = this.rows.length;
        for (let index = this.rows.length - 1; index >= 0; index -= 1) {
            if (selected.has(this.rows[index]!)) this.rows.splice(index, 1);
        }
        return before - this.rows.length;
    }

    private selected(): Row[] {
        let selected = this.rows.filter(row => this.filters.every(filter => evaluate(row, filter)));
        for (const order of [...this.orders].reverse()) {
            selected = [...selected].sort((left, right) => {
                const result = compare(left[order.field], right[order.field]);
                return order.direction === 'desc' ? -result : result;
            });
        }
        return this.maximum === undefined ? selected : selected.slice(0, this.maximum);
    }
}

function accessors(): Record<string, Prisma8FieldAccessor> {
    return new Proxy({}, {
        get: (_target, field: string) => ({
            eq: (value: unknown) => ({op: 'eq', field, value}),
            in: (value: unknown[]) => ({op: 'in', field, value}),
            lte: (value: unknown) => ({op: 'lte', field, value}),
            isNull: () => ({op: 'null', field}),
            asc: () => ({field, direction: 'asc'}),
            desc: () => ({field, direction: 'desc'})
        })
    });
}

function evaluate(row: Row, expression: Expression): boolean {
    if ('expressions' in expression) {
        return expression.op === 'and'
            ? expression.expressions.every(item => evaluate(row, item))
            : expression.expressions.some(item => evaluate(row, item));
    }
    if (expression.op === 'null') return row[expression.field] === null;
    if (expression.op === 'in') return (expression.value as unknown[]).includes(row[expression.field]);
    if (expression.op === 'lte') return ordered(row[expression.field]) <= ordered(expression.value);
    return comparable(row[expression.field]) === comparable(expression.value);
}

function comparable(value: unknown): number | string | null | undefined {
    return value instanceof Date ? value.getTime() : value as number | string | null | undefined;
}

function ordered(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return Number.NaN;
}

function compare(left: unknown, right: unknown): number {
    const a = comparable(left);
    const b = comparable(right);
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    return a < b ? -1 : 1;
}
