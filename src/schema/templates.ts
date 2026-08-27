/** Prisma 6 and Prisma 7 models required by the connector. */
export const RESILIENTMQ_PRISMA_MODELS = `model ResilientMqInboxEvent {
  id             String   @id @default(cuid())
  namespace      String
  serviceId      String
  messageId      String
  type           String?
  payloadJson    String
  routingKey     String?
  propertiesJson String?
  status         String
  attempt        Int      @default(0)
  instanceId     String?
  fencingToken   String?
  leaseExpiresAt DateTime?
  lastAttemptAt  DateTime?
  completedAt    DateTime?
  errorName      String?
  errorMessage   String?
  errorStack     String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([namespace, serviceId, messageId])
  @@index([namespace, status, leaseExpiresAt])
  @@map("resilientmq_inbox_events")
}

model ResilientMqOutboxEvent {
  id             String   @id @default(cuid())
  namespace      String
  messageId      String
  type           String?
  payloadJson    String
  routingKey     String?
  propertiesJson String?
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
  errorMessage   String?
  errorStack     String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([namespace, messageId])
  @@index([namespace, status, nextAttemptAt, leaseExpiresAt])
  @@map("resilientmq_outbox_events")
}`;

/** Prisma datasource providers supported by the stable connector. */
export type SupportedPrismaProvider = 'postgresql' | 'mysql' | 'sqlite';

/** Returns models with provider-specific native types where required. */
export function getResilientMqPrismaModels(provider?: SupportedPrismaProvider): string {
    if (provider !== 'mysql') return RESILIENTMQ_PRISMA_MODELS;
    return RESILIENTMQ_PRISMA_MODELS
        .replaceAll('payloadJson    String\n', 'payloadJson    String   @db.LongText\n')
        .replaceAll('propertiesJson String?\n', 'propertiesJson String?  @db.LongText\n')
        .replaceAll('errorMessage   String?\n', 'errorMessage   String?  @db.Text\n')
        .replaceAll('errorStack     String?\n', 'errorStack     String?  @db.LongText\n');
}

/** Prisma model names owned by this connector. */
export const RESILIENTMQ_MODEL_NAMES = [
    'ResilientMqInboxEvent',
    'ResilientMqOutboxEvent'
] as const;
