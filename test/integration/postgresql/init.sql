CREATE TABLE IF NOT EXISTS resilientmq_inbox_events (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    type TEXT,
    "payloadJson" JSONB NOT NULL,
    "routingKey" TEXT,
    "propertiesJson" JSONB,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    "instanceId" TEXT,
    "fencingToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorName" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    UNIQUE (namespace, "serviceId", "messageId")
);

CREATE INDEX IF NOT EXISTS resilientmq_inbox_claims
    ON resilientmq_inbox_events(namespace, status, "leaseExpiresAt");

CREATE TABLE IF NOT EXISTS resilientmq_outbox_events (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    type TEXT,
    "payloadJson" JSONB NOT NULL,
    "routingKey" TEXT,
    "propertiesJson" JSONB,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    "serviceId" TEXT,
    "instanceId" TEXT,
    "fencingToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "errorName" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    UNIQUE (namespace, "messageId")
);

CREATE INDEX IF NOT EXISTS resilientmq_outbox_claims
    ON resilientmq_outbox_events(namespace, status, "nextAttemptAt", "leaseExpiresAt");

CREATE TABLE IF NOT EXISTS resilientmq_metric_events (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    timestamp TIMESTAMP(3) NOT NULL,
    "messageId" TEXT,
    "serviceId" TEXT,
    "instanceId" TEXT,
    attempt INTEGER,
    "durationMs" INTEGER,
    "errorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS resilientmq_metrics_time
    ON resilientmq_metric_events(namespace, timestamp);
CREATE INDEX IF NOT EXISTS resilientmq_metrics_name_time
    ON resilientmq_metric_events(namespace, name, timestamp);
