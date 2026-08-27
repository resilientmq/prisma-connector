# `@resilientmq/prisma-connector`

Prisma persistence for the fenced inbox and distributed outbox contracts in
`@resilientmq/core`.

The connector prevents two replicas from owning the same event, recovers work
after a process dies, and rejects late writes from expired owners. It does not
create or close the application's Prisma client.

## Compatibility

| Prisma | Status | Databases |
| --- | --- | --- |
| 6.19 | Stable | PostgreSQL, MySQL/MariaDB, SQLite |
| 7.x | Stable | PostgreSQL, MySQL/MariaDB, SQLite |
| 8 RC | Experimental | PostgreSQL |

Prisma 7 applications must configure their database driver adapter as required
by Prisma. Prisma 8 uses a different contract and query API, so its bridge is
published from the explicit `/v8` entrypoint and is not part of the stable
compatibility guarantee.

MongoDB is intentionally outside this package. Use
`@resilientmq/mongoose-connector` for MongoDB workloads.

## Installation

```bash
npm install @resilientmq/core @resilientmq/prisma-connector
```

Install the Prisma version and database adapter required by the application.

## Add the persistence models

```bash
npx resilientmq-prisma init --schema ./prisma/schema.prisma
```

The command:

- locates a schema from `--schema`, `package.json`, `prisma.config.ts`, or the
  conventional Prisma paths;
- adds `ResilientMqInboxEvent` and `ResilientMqOutboxEvent` idempotently;
- supports a schema file or a multi-file schema directory;
- refuses partially installed or incompatible models;
- runs `prisma format`;
- never runs a migration unless `--migrate` is explicitly supplied.

The installer detects MySQL and MariaDB datasources and uses `LONGTEXT` for
serialized payloads, properties, and stack traces instead of the provider's
default bounded `VARCHAR` mapping.

Create a development migration explicitly when desired:

```bash
npx resilientmq-prisma init \
  --schema ./prisma/schema.prisma \
  --migrate \
  --migration-name add_resilientmq_event_store
```

For production, commit the generated migration and apply it through the
application's normal `prisma migrate deploy` process.

CI can verify that the models remain installed:

```bash
npx resilientmq-prisma schema check --schema ./prisma/schema.prisma
```

## Prisma 6 and Prisma 7 usage

```ts
import {PrismaClient} from './generated/prisma/client.js';
import {
    ResilientConsumer,
    ResilientEventPublisher
} from '@resilientmq/core';
import {createPrismaEventStores} from '@resilientmq/prisma-connector';

const prisma = new PrismaClient({adapter});

const stores = createPrismaEventStores({
    client: prisma,
    namespace: 'orders-production'
});

const consumer = new ResilientConsumer({
    ...consumerConfig,
    store: stores.consumer
});

const publisher = new ResilientEventPublisher({
    ...publisherConfig,
    store: stores.publisher
});
```

The application owns `prisma`, including connection setup and shutdown. The
`namespace` must be stable across every replica of the same deployment and
different between applications that may reuse message IDs.

## Guarantees

Inbox identity is scoped by `namespace`, the hashed ResilientMQ `serviceId`,
and `messageId`. Outbox identity is scoped by `namespace` and `messageId`.

Every processing transition checks the current `serviceId`, `instanceId`, and
`fencingToken`. A process that resumes after its lease expires cannot overwrite
the state produced by the replacement process.

Batch outbox claims use conditional compare-and-swap updates. A caller never
receives an event owned by another replica, and the connector never claims more
events than it returns.

Payloads and AMQP properties are serialized into provider-neutral text fields.
Values must therefore be JSON serializable.

## Prisma 8 RC

Prisma 8 support is experimental because Prisma 8 is still a release candidate
and has replaced generated delegates with a contract-based collection API.

```ts
import {and, or} from '@prisma/orm-postgres/orm-client';
import {createPrisma8PostgresEventStores} from '@resilientmq/prisma-connector/v8';

const stores = createPrisma8PostgresEventStores({
    client: db,
    namespace: 'orders-production',
    operators: {and, or}
});
```

Add the models from `prisma/v8/resilientmq.prisma` to the Prisma 8 contract and
emit the contract using the Prisma 8 CLI. Pin the Prisma RC version because the
query and migration APIs may still change before general availability.

## Development

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm audit
```

The test suite includes concurrent replicas, expired lease recovery, stale
fencing rejection, delayed publication retries, namespace isolation, Prisma
6.19 compatibility, and real SQLite, PostgreSQL, and MariaDB execution.

## License

MIT
