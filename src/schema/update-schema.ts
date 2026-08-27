import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, extname, isAbsolute, join, resolve} from 'node:path';
import {
    RESILIENTMQ_MODEL_NAMES,
    getResilientMqPrismaModels,
    type SupportedPrismaProvider
} from './templates.js';

/** Options for locating an application's Prisma schema. */
export interface ResolvePrismaSchemaOptions {
    /** Working directory used for relative paths. */
    cwd?: string;

    /** Explicit schema file or schema directory. */
    schema?: string;
}

/** Result of an idempotent schema transformation. */
export interface PrismaSchemaUpdate {
    /** Absolute file to write. */
    path: string;

    /** Original schema contents. */
    before: string;

    /** Resulting schema contents. */
    after: string;

    /** Whether the schema requires a write. */
    changed: boolean;

    /** Models added by the transformation. */
    addedModels: string[];
}

/** Locates a Prisma schema using CLI, package and Prisma configuration conventions. */
export function resolvePrismaSchemaPath(options: ResolvePrismaSchemaOptions = {}): string {
    const cwd = resolve(options.cwd ?? process.cwd());
    const configured = options.schema ?? readPackageSchema(cwd) ?? readConfigSchema(cwd);
    if (configured) return normalizeSchemaTarget(cwd, configured);

    const defaults = [join(cwd, 'prisma', 'schema.prisma'), join(cwd, 'schema.prisma')];
    const found = defaults.find(existsSync);
    if (found) return found;
    throw new Error('No Prisma schema found; provide --schema with a schema file or directory');
}

/** Computes the idempotent schema change without writing it. */
export function preparePrismaSchemaUpdate(path: string): PrismaSchemaUpdate {
    const absolutePath = resolve(path);
    const before = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
    const existing = scanTopLevelModels(before);
    const missing = RESILIENTMQ_MODEL_NAMES.filter(name => !existing.has(name));
    if (missing.length === 0) {
        validateOwnedModels(existing);
        return {path: absolutePath, before, after: before, changed: false, addedModels: []};
    }
    if (missing.length !== RESILIENTMQ_MODEL_NAMES.length) {
        throw new Error(`Prisma schema contains only part of the ResilientMQ models; missing ${missing.join(', ')}`);
    }
    const provider = detectProvider(absolutePath, before);
    const models = getResilientMqPrismaModels(provider);
    const separator = before.length === 0 ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const after = `${before}${separator}${models}\n`;
    return {path: absolutePath, before, after, changed: true, addedModels: [...missing]};
}

function detectProvider(schemaPath: string, source: string): SupportedPrismaProvider | undefined {
    const directory = dirname(schemaPath);
    const sources = [source];
    if (existsSync(directory) && statSync(directory).isDirectory()) {
        for (const name of readdirSync(directory).filter(name => name.endsWith('.prisma'))) {
            const sibling = join(directory, name);
            if (resolve(sibling) !== resolve(schemaPath)) sources.push(readFileSync(sibling, 'utf8'));
        }
    }
    const match = /\bprovider\s*=\s*"([^"]+)"/.exec(sources.join('\n'));
    const provider = match?.[1];
    if (!provider) return undefined;
    if (provider === 'postgresql' || provider === 'mysql' || provider === 'sqlite') return provider;
    if (provider === 'mongodb') {
        throw new Error('MongoDB is not supported by prisma-connector; use @resilientmq/mongoose-connector');
    }
    throw new Error(`Prisma datasource provider "${provider}" is not supported by this release`);
}

/** Writes the required models when the schema is not already current. */
export function updatePrismaSchema(path: string): PrismaSchemaUpdate {
    const update = preparePrismaSchemaUpdate(path);
    if (update.changed) writeFileSync(update.path, update.after, 'utf8');
    return update;
}

interface ModelBlock {
    body: string;
}

function normalizeSchemaTarget(cwd: string, configured: string): string {
    const target = isAbsolute(configured) ? configured : resolve(cwd, configured);
    if (existsSync(target) && statSync(target).isDirectory()) return join(target, 'resilientmq.prisma');
    if (extname(target) === '.prisma') return target;
    if (!existsSync(target)) {
        if (extname(target)) return target;
        return join(target, 'resilientmq.prisma');
    }
    throw new Error(`Unsupported Prisma schema target: ${target}`);
}

function readPackageSchema(cwd: string): string | undefined {
    const path = join(cwd, 'package.json');
    if (!existsSync(path)) return undefined;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {prisma?: {schema?: unknown}};
    return typeof parsed.prisma?.schema === 'string' ? parsed.prisma.schema : undefined;
}

function readConfigSchema(cwd: string): string | undefined {
    for (const name of ['prisma.config.ts', 'prisma.config.js', 'prisma.config.mjs']) {
        const path = join(cwd, name);
        if (!existsSync(path)) continue;
        const source = readFileSync(path, 'utf8');
        const match = /\bschema\s*:\s*(['"])(?<path>[^'"]+)\1/.exec(source);
        const configured = match?.groups?.path;
        if (configured) return resolve(dirname(path), configured);
    }
    return undefined;
}

function scanTopLevelModels(source: string): Map<string, ModelBlock> {
    const models = new Map<string, ModelBlock>();
    let cursor = 0;
    while (cursor < source.length) {
        cursor = skipTrivia(source, cursor);
        const keyword = readIdentifier(source, cursor);
        if (!keyword) {
            cursor += 1;
            continue;
        }
        cursor = keyword.end;
        if (keyword.value !== 'model') continue;
        cursor = skipTrivia(source, cursor);
        const name = readIdentifier(source, cursor);
        if (!name) throw new Error('Invalid Prisma model declaration');
        cursor = skipTrivia(source, name.end);
        if (source[cursor] !== '{') throw new Error(`Invalid Prisma model declaration for ${name.value}`);
        const end = findClosingBrace(source, cursor);
        models.set(name.value, {body: source.slice(cursor + 1, end)});
        cursor = end + 1;
    }
    return models;
}

function validateOwnedModels(models: Map<string, ModelBlock>): void {
    const required = {
        ResilientMqInboxEvent: ['namespace', 'serviceId', 'messageId', 'status', 'fencingToken', 'leaseExpiresAt'],
        ResilientMqOutboxEvent: ['namespace', 'messageId', 'status', 'fencingToken', 'leaseExpiresAt', 'nextAttemptAt']
    } as const;
    for (const [name, fields] of Object.entries(required)) {
        const body = models.get(name)?.body;
        if (!body) continue;
        const declared = new Set([...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s+/gm)].map(match => match[1]));
        const missing = fields.filter(field => !declared.has(field));
        if (missing.length) throw new Error(`Existing ${name} model is incompatible; missing ${missing.join(', ')}`);
    }
}

function skipTrivia(source: string, start: number): number {
    let cursor = start;
    while (cursor < source.length) {
        if (/\s/.test(source[cursor] ?? '')) {
            cursor += 1;
            continue;
        }
        if (source.startsWith('//', cursor)) {
            cursor = source.indexOf('\n', cursor + 2);
            if (cursor === -1) return source.length;
            continue;
        }
        if (source.startsWith('/*', cursor)) {
            const end = source.indexOf('*/', cursor + 2);
            if (end === -1) throw new Error('Unterminated block comment in Prisma schema');
            cursor = end + 2;
            continue;
        }
        break;
    }
    return cursor;
}

function readIdentifier(source: string, start: number): {value: string; end: number} | null {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(start));
    return match ? {value: match[0], end: start + match[0].length} : null;
}

function findClosingBrace(source: string, opening: number): number {
    let depth = 0;
    let quote: string | undefined;
    for (let cursor = opening; cursor < source.length; cursor += 1) {
        const current = source[cursor];
        if (quote) {
            if (current === '\\') cursor += 1;
            else if (current === quote) quote = undefined;
            continue;
        }
        if (current === '"' || current === "'") {
            quote = current;
            continue;
        }
        if (source.startsWith('//', cursor)) {
            const end = source.indexOf('\n', cursor + 2);
            if (end === -1) return source.length - 1;
            cursor = end;
            continue;
        }
        if (current === '{') depth += 1;
        if (current === '}') {
            depth -= 1;
            if (depth === 0) return cursor;
        }
    }
    throw new Error('Unterminated model block in Prisma schema');
}
