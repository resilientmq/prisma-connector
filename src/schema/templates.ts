/** Prisma datasource providers supported by the stable connector. */
export type SupportedPrismaProvider = 'postgresql' | 'mysql' | 'sqlite';

/** Physical table names used by generated Prisma model mappings. */
export interface ResilientMqPrismaTableNames {
    /** Inbox table. */
    inbox: string;

    /** Outbox table. */
    outbox: string;

    /** Optional metric-event table. */
    metrics: string;
}

/** Provider and feature options used to render connector models. */
export interface ResilientMqPrismaSchemaOptions {
    /** Datasource provider detected from the application schema. */
    provider?: SupportedPrismaProvider;

    /** Includes the optional event-oriented metrics model. */
    metrics?: boolean;

    /** Physical table name overrides without changing Prisma delegates. */
    tables?: Partial<ResilientMqPrismaTableNames>;
}

/** Prisma event model names owned by this connector. */
export const RESILIENTMQ_MODEL_NAMES = [
    'ResilientMqInboxEvent',
    'ResilientMqOutboxEvent'
] as const;

/** Optional Prisma metrics model name owned by this connector. */
export const RESILIENTMQ_METRICS_MODEL_NAME = 'ResilientMqMetricEvent' as const;

const DEFAULT_TABLES: ResilientMqPrismaTableNames = {
    inbox: 'resilientmq_inbox_events',
    outbox: 'resilientmq_outbox_events',
    metrics: 'resilientmq_metric_events'
};

/** Returns provider-optimized models with optional metrics and physical table names. */
export function getResilientMqPrismaModels(
    providerOrOptions?: SupportedPrismaProvider | ResilientMqPrismaSchemaOptions
): string {
    const options = normalizeOptions(providerOrOptions);
    const names: string[] = [...RESILIENTMQ_MODEL_NAMES];
    if (options.metrics) names.push(RESILIENTMQ_METRICS_MODEL_NAME);
    return names.map(name => getResilientMqPrismaModel(name, options)).join('\n\n');
}

/** Returns one connector-owned Prisma model. */
export function getResilientMqPrismaModel(
    name: string,
    options: ResilientMqPrismaSchemaOptions = {}
): string {
    const tables = {...DEFAULT_TABLES, ...options.tables};
    validateTableNames(tables);
    if (name === 'ResilientMqInboxEvent') return inboxModel(options.provider, tables.inbox);
    if (name === 'ResilientMqOutboxEvent') return outboxModel(options.provider, tables.outbox);
    if (name === RESILIENTMQ_METRICS_MODEL_NAME) return metricsModel(options.provider, tables.metrics);
    throw new Error(`Unknown ResilientMQ Prisma model "${name}"`);
}

/** Prisma 6 and Prisma 7 event models required by the connector. */
export const RESILIENTMQ_PRISMA_MODELS = getResilientMqPrismaModels();

function inboxModel(provider: SupportedPrismaProvider | undefined, table: string): string {
    return `model ResilientMqInboxEvent {
  id             String   @id @default(cuid())
  namespace      String
  serviceId      String
  messageId      String
  type           String?
  payloadJson    ${jsonType(provider, false)}
  routingKey     String?
  propertiesJson ${jsonType(provider, true)}
  status         String
  attempt        Int      @default(0)
  instanceId     String?
  fencingToken   String?
  leaseExpiresAt DateTime?
  lastAttemptAt  DateTime?
  completedAt    DateTime?
  errorName      String?
  errorMessage   ${errorType(provider, 'message')}
  errorStack     ${errorType(provider, 'stack')}
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([namespace, serviceId, messageId])
  @@index([namespace, status, leaseExpiresAt])
  @@map(${JSON.stringify(table)})
}`;
}

function outboxModel(provider: SupportedPrismaProvider | undefined, table: string): string {
    return `model ResilientMqOutboxEvent {
  id             String   @id @default(cuid())
  namespace      String
  messageId      String
  type           String?
  payloadJson    ${jsonType(provider, false)}
  routingKey     String?
  propertiesJson ${jsonType(provider, true)}
  status         String
  attempt        Int      @default(0)
  serviceId      String?
  instanceId     String?
  fencingToken   String?
  leaseExpiresAt DateTime?
  nextAttemptAt  DateTime?
  lastAttemptAt  DateTime?
  publishedAt    DateTime?
  errorName      String?
  errorMessage   ${errorType(provider, 'message')}
  errorStack     ${errorType(provider, 'stack')}
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([namespace, messageId])
  @@index([namespace, status, nextAttemptAt, leaseExpiresAt])
  @@map(${JSON.stringify(table)})
}`;
}

function metricsModel(provider: SupportedPrismaProvider | undefined, table: string): string {
    return `model ResilientMqMetricEvent {
  id         String   @id @default(cuid())
  namespace  String
  name       String
  timestamp  DateTime
  messageId  String?
  serviceId  String?
  instanceId String?
  attempt    Int?
  durationMs Int?
  errorName  ${errorType(provider, 'name')}
  createdAt  DateTime @default(now())

  @@index([namespace, timestamp])
  @@index([namespace, name, timestamp])
  @@map(${JSON.stringify(table)})
}`;
}

function jsonType(provider: SupportedPrismaProvider | undefined, optional: boolean): string {
    const suffix = optional ? '?' : '';
    return provider === 'postgresql' ? `Json${suffix} @db.JsonB` : `Json${suffix}`;
}

function errorType(provider: SupportedPrismaProvider | undefined, size: 'name' | 'message' | 'stack'): string {
    if (provider !== 'mysql') return 'String?';
    if (size === 'stack') return 'String?  @db.LongText';
    if (size === 'message') return 'String?  @db.Text';
    return 'String?';
}

function normalizeOptions(
    providerOrOptions?: SupportedPrismaProvider | ResilientMqPrismaSchemaOptions
): ResilientMqPrismaSchemaOptions {
    return typeof providerOrOptions === 'string' ? {provider: providerOrOptions} : providerOrOptions ?? {};
}

function validateTableNames(tables: ResilientMqPrismaTableNames): void {
    for (const [purpose, table] of Object.entries(tables)) {
        if (!table.trim()) throw new Error(`ResilientMQ ${purpose} table name must not be empty`);
        if (table.includes('\0')) throw new Error(`ResilientMQ ${purpose} table name contains an invalid null character`);
    }
}
