import type {PrismaEventStores, PrismaModelDelegate} from '../types.js';
import {PrismaConsumerEventStore} from '../consumer-store.js';
import {PrismaPublisherEventStore} from '../publisher-store.js';

/** Opaque Prisma 8 predicate expression. */
export type Prisma8Expression = unknown;

/** Logical helpers exported by the Prisma 8 ORM client package. */
export interface Prisma8LogicalOperators {
    /** Joins predicates with logical AND. */
    and(...expressions: Prisma8Expression[]): Prisma8Expression;

    /** Joins predicates with logical OR. */
    or(...expressions: Prisma8Expression[]): Prisma8Expression;
}

/** Field operations exposed to a Prisma 8 where callback. */
export interface Prisma8FieldAccessor {
    /** Equality predicate. */
    eq(value: unknown): Prisma8Expression;

    /** Set-membership predicate. */
    in(values: readonly unknown[]): Prisma8Expression;

    /** Less-than-or-equal predicate. */
    lte(value: unknown): Prisma8Expression;

    /** Null predicate. */
    isNull(): Prisma8Expression;

    /** Ascending order expression. */
    asc(): unknown;

    /** Descending order expression. */
    desc(): unknown;
}

/** Structural Prisma 8 model collection required by the experimental bridge. */
export interface Prisma8CollectionLike {
    /** Applies a predicate callback. */
    where(predicate: (model: Record<string, Prisma8FieldAccessor>) => Prisma8Expression): Prisma8CollectionLike;

    /** Applies an order expression. */
    orderBy(order: (model: Record<string, Prisma8FieldAccessor>) => unknown): Prisma8CollectionLike;

    /** Limits returned rows. */
    limit(value: number): Prisma8CollectionLike;

    /** Returns all matching rows. */
    all(): PromiseLike<unknown[]>;

    /** Returns the first matching row. */
    first(): Promise<unknown | null>;

    /** Creates one row. */
    create(data: Record<string, unknown>): Promise<unknown>;

    /** Updates matching rows and returns their count. */
    updateAndCount(data: Record<string, unknown>): Promise<number>;

    /** Deletes matching rows and returns their count. */
    deleteAndCount(): Promise<number>;
}

/** Structural Prisma 8 client with namespaced ORM models. */
export interface Prisma8ClientLike {
    /** ORM namespaces emitted from the Prisma 8 contract. */
    orm: Record<string, Record<string, Prisma8CollectionLike>>;
}

/** Experimental Prisma 8 PostgreSQL bridge options. */
export interface Prisma8EventStoreOptions {
    /** Application-owned Prisma 8 PostgreSQL client. */
    client: Prisma8ClientLike;

    /** Stable ResilientMQ identity partition. */
    namespace: string;

    /** Prisma 8 database schema namespace. */
    databaseNamespace?: string;

    /** Logical operators imported from the Prisma 8 ORM client package. */
    operators: Prisma8LogicalOperators;
}

/** Builds experimental Prisma 8 PostgreSQL stores over the contract query API. */
export class Prisma8PostgresEventStoreFactory {
    private readonly inboxDelegate: Prisma8Delegate;
    private readonly outboxDelegate: Prisma8Delegate;
    private readonly namespace: string;

    /** Resolves the configured contract namespace and ResilientMQ collections. */
    constructor(options: Prisma8EventStoreOptions) {
        const databaseNamespace = options.databaseNamespace ?? 'public';
        const models = options.client.orm[databaseNamespace];
        if (!models) throw new Error(`Prisma 8 client does not expose the "${databaseNamespace}" namespace`);
        const inbox = models.ResilientMqInboxEvent;
        const outbox = models.ResilientMqOutboxEvent;
        if (!inbox || !outbox) throw new Error('Prisma 8 contract does not expose the ResilientMQ models');
        this.inboxDelegate = new Prisma8Delegate(inbox, options.operators);
        this.outboxDelegate = new Prisma8Delegate(outbox, options.operators);
        this.namespace = options.namespace;
    }

    /** Creates the experimental inbox store. */
    createConsumerStore(): PrismaConsumerEventStore {
        return new PrismaConsumerEventStore(this.inboxDelegate, this.namespace);
    }

    /** Creates the experimental outbox store. */
    createPublisherStore(): PrismaPublisherEventStore {
        return new PrismaPublisherEventStore(this.outboxDelegate, this.namespace);
    }

    /** Creates the experimental inbox and outbox stores as one pair. */
    createEventStores(): PrismaEventStores {
        const consumer = this.createConsumerStore();
        const publisher = this.createPublisherStore();
        return {
            consumer,
            publisher,
            consumerOptions: {store: consumer},
            publisherOptions: {store: publisher}
        };
    }
}

/** Creates experimental Prisma 8 PostgreSQL stores over the contract query API. */
export function createPrisma8PostgresEventStores(options: Prisma8EventStoreOptions): PrismaEventStores {
    return new Prisma8PostgresEventStoreFactory(options).createEventStores();
}

class Prisma8Delegate implements PrismaModelDelegate {
    constructor(
        private readonly collection: Prisma8CollectionLike,
        private readonly operators: Prisma8LogicalOperators
    ) {}

    async create(args: {data: Record<string, unknown>}): Promise<unknown> {
        return this.collection.create(args.data);
    }

    async findFirst(args: Record<string, unknown>): Promise<unknown | null> {
        return this.applyQuery(args).first();
    }

    async findMany(args: Record<string, unknown>): Promise<unknown[]> {
        return await this.applyQuery(args).all();
    }

    async updateMany(args: {where: Record<string, unknown>; data: Record<string, unknown>}): Promise<{count: number}> {
        const data = await this.resolveIncrementData(args.where, args.data);
        return {count: await this.applyWhere(args.where).updateAndCount(data)};
    }

    async deleteMany(args: {where: Record<string, unknown>}): Promise<{count: number}> {
        return {count: await this.applyWhere(args.where).deleteAndCount()};
    }

    private applyQuery(args: Record<string, unknown>): Prisma8CollectionLike {
        let query = args.where && typeof args.where === 'object'
            ? this.applyWhere(args.where as Record<string, unknown>)
            : this.collection;
        const orderBy = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [];
        for (const item of orderBy) {
            const [field, direction] = Object.entries(item as Record<string, unknown>)[0] ?? [];
            if (!field) continue;
            query = query.orderBy(model => direction === 'desc' ? model[field]!.desc() : model[field]!.asc());
        }
        if (typeof args.take === 'number') query = query.limit(Math.max(0, args.take));
        return query;
    }

    private applyWhere(where: Record<string, unknown>): Prisma8CollectionLike {
        return this.collection.where(model => this.toExpression(model, where));
    }

    private toExpression(model: Record<string, Prisma8FieldAccessor>, where: Record<string, unknown>): Prisma8Expression {
        const expressions = Object.entries(where).map(([field, expected]) => {
            if (field === 'OR') {
                return this.operators.or(...(expected as Record<string, unknown>[])
                    .map(condition => this.toExpression(model, condition)));
            }
            if (field === 'AND') {
                return this.operators.and(...(expected as Record<string, unknown>[])
                    .map(condition => this.toExpression(model, condition)));
            }
            const accessor = model[field];
            if (!accessor) throw new Error(`Prisma 8 model does not expose field "${field}"`);
            if (expected === null) return accessor.isNull();
            if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
                const operation = expected as Record<string, unknown>;
                if ('in' in operation) return accessor.in(operation.in as unknown[]);
                if ('lte' in operation) return accessor.lte(operation.lte);
            }
            return accessor.eq(expected);
        });
        return expressions.length === 1 ? expressions[0] : this.operators.and(...expressions);
    }

    private async resolveIncrementData(
        where: Record<string, unknown>,
        data: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
        const increments = Object.entries(data).filter(([, value]) => value && typeof value === 'object' && 'increment' in value);
        if (increments.length === 0) return data;
        const current = await this.applyWhere(where).first() as Record<string, unknown> | null;
        if (!current) return data;
        const resolved = {...data};
        for (const [field, operation] of increments) {
            resolved[field] = Number(current[field] ?? 0) + Number((operation as Record<string, unknown>).increment);
        }
        return resolved;
    }
}
