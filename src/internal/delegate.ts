import type {
    PrismaClientLike,
    PrismaEventStoreOptions,
    PrismaModelDelegate,
    PrismaModelNames,
    ResolvedPrismaEventStoreOptions
} from '../types.js';

const DEFAULT_MODELS: PrismaModelNames = {
    inbox: 'resilientMqInboxEvent',
    outbox: 'resilientMqOutboxEvent'
};

/** Resolves and validates the generated Prisma delegates. */
export function resolveStoreOptions(options: PrismaEventStoreOptions): ResolvedPrismaEventStoreOptions {
    if (!options.namespace.trim()) {
        throw new Error('Prisma event store namespace must not be empty');
    }

    const names = {...DEFAULT_MODELS, ...options.models};
    return {
        namespace: options.namespace,
        inbox: resolveDelegate(options.client, names.inbox),
        outbox: resolveDelegate(options.client, names.outbox)
    };
}

/** Resolves one model delegate without depending on generated Prisma client types. */
export function resolveDelegate(client: PrismaClientLike, name: string): PrismaModelDelegate {
    const candidate = (client as Record<string, unknown>)[name];
    if (!isDelegate(candidate)) {
        throw new Error(`Prisma client does not expose the required model delegate "${name}"`);
    }
    return candidate;
}

function isDelegate(value: unknown): value is PrismaModelDelegate {
    if (!value || typeof value !== 'object') return false;
    const delegate = value as Record<string, unknown>;
    return ['create', 'findFirst', 'findMany', 'updateMany', 'deleteMany']
        .every(method => typeof delegate[method] === 'function');
}
