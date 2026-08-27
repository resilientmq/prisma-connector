# @resilientmq/prisma-connector

Prisma persistence for the fenced inbox and distributed outbox contracts in
`@resilientmq/core`.

The connector provides atomic ownership across replicas, lease recovery after
process failure, and fencing that rejects writes from an expired owner. The
application retains ownership of the Prisma client and its lifecycle.

## Delivery guarantees

- Inbox claims are unique per `namespace`, stable core `serviceId`, and
  `messageId`.
- Outbox claims are unique per `namespace` and `messageId`.
- Every active claim has an ephemeral `instanceId`, expiration time, and fresh
  fencing token.
- A crashed process loses its claim after the lease expires; late transitions
  from that process are rejected.
- Deferred publishers can share a backlog without every replica publishing the
  same row.
- Schema installation is idempotent and migrations are always explicit.

These guarantees prevent concurrent ownership. They do not turn RabbitMQ and a
SQL database into one transaction. Application side effects and message
handlers must still be idempotent.

## Compatibility

| Connector entrypoint | Prisma | Status | Providers |
| --- | --- | --- | --- |
| Package root | 6.19 | Stable | PostgreSQL, MySQL/MariaDB, SQLite |
| Package root | 7.x | Stable | PostgreSQL, MySQL/MariaDB, SQLite |
| `/v8` | 8 prerelease | Experimental | PostgreSQL |

Node.js 20.19 or newer and `@resilientmq/core` 3.x are required. Prisma 7
applications must configure a database driver adapter. The Prisma 8 bridge is
isolated because its prerelease contract and query APIs may change.

MongoDB is intentionally outside this package. Use
`@resilientmq/mongoose-connector` for MongoDB workloads.

## Installation

```bash
npm install @resilientmq/core @resilientmq/prisma-connector
```

Install the Prisma client, CLI, and driver adapter required by the application.

## Quick start

Add the persistence models to the application schema:

```bash
npx resilientmq-prisma init --schema ./prisma/schema.prisma
```

Review the generated schema, create a migration, and regenerate the client:

```bash
npx prisma migrate dev --name add_resilientmq_event_store
npx prisma generate
```

Create the stores through the object-oriented factory:

```ts
import {PrismaClient} from './generated/prisma/client.js';
import {ResilientConsumer, ResilientEventPublisher} from '@resilientmq/core';
import {PrismaEventStoreFactory} from '@resilientmq/prisma-connector';

const prisma = new PrismaClient({adapter});
const storeFactory = new PrismaEventStoreFactory({
  client: prisma,
  namespace: 'orders-production'
});
const stores = storeFactory.createEventStores();

const consumer = new ResilientConsumer({
  ...consumerConfig,
  store: stores.consumer
});

const publisher = new ResilientEventPublisher({
  ...publisherConfig,
  store: stores.publisher
});
```

The functional factory remains available as a compact equivalent:

```ts
import {createPrismaEventStores} from '@resilientmq/prisma-connector';

const stores = createPrismaEventStores({
  client: prisma,
  namespace: 'orders-production'
});
```

Keep `namespace` stable across all replicas of one deployment and distinct
between applications that may reuse message IDs. Do not disconnect Prisma from
the connector; start and stop the application-owned client at the application
boundary.

## Schema management

| Command | Behavior |
| --- | --- |
| `resilientmq-prisma init` | Adds both models and runs `prisma format`. |
| `resilientmq-prisma schema check` | Exits non-zero when models are absent or incompatible. |
| `resilientmq-prisma schema print` | Prints the provider-neutral models. |
| `resilientmq-prisma schema print --provider mysql` | Prints models with unbounded MySQL text columns. |

Schema discovery checks `--schema`, `package.json`, `prisma.config.*`, and the
conventional Prisma paths. A schema file or multi-file schema directory is
supported. Partially installed or incompatible models fail without overwriting
application schema content.

The installer never creates a migration unless explicitly requested:

```bash
npx resilientmq-prisma init \
  --schema ./prisma/schema.prisma \
  --migrate \
  --migration-name add_resilientmq_event_store
```

For production, commit the generated migration and execute it through the
application's normal `prisma migrate deploy` process. CI can detect schema drift
with:

```bash
npx resilientmq-prisma schema check --schema ./prisma/schema.prisma
```

The same behavior is exposed programmatically through `PrismaSchemaManager`
from `@resilientmq/prisma-connector/schema`.

## Custom generated model names

Prisma normally generates `resilientMqInboxEvent` and
`resilientMqOutboxEvent`. Supply overrides only when the generated client uses
different delegate names:

```ts
const factory = new PrismaEventStoreFactory({
  client: prisma,
  namespace: 'orders-production',
  models: {
    inbox: 'customInbox',
    outbox: 'customOutbox'
  }
});
```

## Prisma 8 prerelease

Prisma 8 uses a contract-based collection API rather than the stable generated
delegate API. Its PostgreSQL bridge is deliberately explicit:

```ts
import {and, or} from '@prisma/orm-postgres/orm-client';
import {Prisma8PostgresEventStoreFactory} from '@resilientmq/prisma-connector/v8';

const stores = new Prisma8PostgresEventStoreFactory({
  client: db,
  namespace: 'orders-production',
  operators: {and, or}
}).createEventStores();
```

Add the models from `prisma/v8/resilientmq.prisma` to the Prisma 8 contract and
emit it with the matching Prisma prerelease CLI. Pin exact prerelease versions;
this entrypoint has no stable compatibility guarantee until Prisma 8 reaches
general availability.

## Persistence model

Payloads and AMQP properties are serialized into provider-neutral text fields
and must be JSON serializable. MySQL and MariaDB receive native `LONGTEXT`
annotations to avoid bounded `VARCHAR` payload storage.

See [docs/persistence-model.md](docs/persistence-model.md) for identities,
state transitions, leases, fencing, operational indexes, and failure recovery.

## Development

```bash
npm ci
npm run typecheck
npm run test:coverage
npm run test:integration
npm run build
npm audit --audit-level=high
npm pack --dry-run
```

The suite covers concurrent replicas, expired lease recovery, stale fencing,
delayed publication retries, namespace isolation, schema transformations,
Prisma 6.19 compatibility, and real SQLite, PostgreSQL, and MariaDB execution.
CI enforces at least 90% statements, lines, and functions, plus 80% branches.

## License

MIT
