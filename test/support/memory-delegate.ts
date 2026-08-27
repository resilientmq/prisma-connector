import type {PrismaBatchPayload, PrismaModelDelegate} from '../../src/index.js';

type Row = Record<string, unknown>;

/** In-memory Prisma delegate used to exercise compare-and-swap behavior. */
export class MemoryPrismaDelegate implements PrismaModelDelegate {
    readonly rows: Row[] = [];

    /** Creates a row while enforcing the connector compound identity. */
    async create(args: {data: Row}): Promise<unknown> {
        const duplicate = this.rows.some(row => row.namespace === args.data.namespace
            && row.messageId === args.data.messageId
            && (args.data.serviceId === undefined || row.serviceId === args.data.serviceId));
        if (duplicate) throw Object.assign(new Error('Unique constraint failed'), {code: 'P2002'});
        const now = new Date();
        const row = {
            id: String(this.rows.length + 1),
            createdAt: now,
            updatedAt: now,
            attempt: 0,
            serviceId: null,
            instanceId: null,
            fencingToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            ...clone(args.data)
        };
        this.rows.push(row);
        return clone(row);
    }

    /** Finds the first matching row. */
    async findFirst(args: {where?: Row}): Promise<unknown | null> {
        const row = this.rows.find(candidate => matches(candidate, args.where ?? {}));
        return row ? clone(row) : null;
    }

    /** Finds matching rows with Prisma-like ordering and limits. */
    async findMany(args: {where?: Row; orderBy?: Row | Row[]; take?: number}): Promise<unknown[]> {
        let rows = this.rows.filter(row => matches(row, args.where ?? {}));
        const orders = Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [];
        rows = [...rows].sort((left, right) => compareRows(left, right, orders));
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map(clone);
    }

    /** Applies an atomic conditional update. */
    async updateMany(args: {where: Row; data: Row}): Promise<PrismaBatchPayload> {
        let count = 0;
        for (const row of this.rows) {
            if (!matches(row, args.where)) continue;
            applyData(row, args.data);
            count += 1;
        }
        return {count};
    }

    /** Deletes matching rows. */
    async deleteMany(args: {where: Row}): Promise<PrismaBatchPayload> {
        let count = 0;
        for (let index = this.rows.length - 1; index >= 0; index -= 1) {
            if (!matches(this.rows[index] ?? {}, args.where)) continue;
            this.rows.splice(index, 1);
            count += 1;
        }
        return {count};
    }
}

function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, expected]) => {
        if (key === 'OR') return (expected as Row[]).some(condition => matches(row, condition));
        if (key === 'AND') return (expected as Row[]).every(condition => matches(row, condition));
        if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
            const operators = expected as Row;
            if ('in' in operators) return (operators.in as unknown[]).includes(row[key]);
            if ('lte' in operators) return ordered(row[key]) <= ordered(operators.lte);
        }
        return comparable(row[key]) === comparable(expected);
    });
}

function comparable(value: unknown): unknown {
    return value instanceof Date ? value.getTime() : value;
}

function ordered(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return new Date(value).getTime();
    return Number.NaN;
}

function applyData(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) {
            row[key] = Number(row[key] ?? 0) + Number((value as Row).increment);
        } else {
            row[key] = clone(value);
        }
    }
}

function compareRows(left: Row, right: Row, orders: Row[]): number {
    for (const order of orders) {
        const [field, direction] = Object.entries(order)[0] ?? [];
        if (!field) continue;
        const a = comparable(left[field]);
        const b = comparable(right[field]);
        if (a === b) continue;
        const result = a === null || a === undefined ? -1 : b === null || b === undefined ? 1 : a < b ? -1 : 1;
        return direction === 'desc' ? -result : result;
    }
    return 0;
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
