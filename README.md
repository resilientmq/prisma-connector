# @resilientmq/prisma-connector

<!-- Package -->
[![npm version](https://img.shields.io/npm/v/@resilientmq/prisma-connector.svg?logo=npm)](https://www.npmjs.com/package/@resilientmq/prisma-connector)
[![CI](https://img.shields.io/github/actions/workflow/status/resilientmq/prisma-connector/ci.yml?branch=main&logo=github&label=CI)](https://github.com/resilientmq/prisma-connector/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

<!-- Runtime -->
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.19-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.19%20%7C%207%20%7C%208_experimental-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![ResilientMQ core](https://img.shields.io/badge/ResilientMQ_core-3.x-5C2D91)](https://www.npmjs.com/package/@resilientmq/core)

Prisma persistence for the fenced inbox and distributed outbox contracts in
`@resilientmq/core`.

The connector provides atomic ownership across replicas, lease recovery after
process failure, and fencing that rejects writes from an expired owner. The
application retains ownership of the Prisma client and its lifecycle.

## Table of contents

- [Delivery guarantees](#delivery-guarantees)
- [Compatibility](#compatibility)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Schema management](#schema-management)
- [Custom generated model names](#custom-generated-model-names)
- [Persisted metrics](#persisted-metrics)
- [Prisma 8 prerelease](#prisma-8-prerelease)
- [Persistence model](#persistence-model)
- [Development](#development)
- [Contributors](#contributors)
- [License](#license)

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

Add provider-optimized persistence models to the application schema:

```bash
npx resilientmq-prisma init --metrics
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
  namespace: 'orders-production',
  metrics: true
});
const stores = storeFactory.createEventStores();

const consumer = new ResilientConsumer({
  ...consumerConfig,
  ...stores.consumerOptions
});

const publisher = new ResilientEventPublisher({
  ...publisherConfig,
  ...stores.publisherOptions
});
```

The functional factory remains available as a compact equivalent:

```ts
import {createPrismaEventStores} from '@resilientmq/prisma-connector';

const stores = createPrismaEventStores({
  client: prisma,
  namespace: 'orders-production',
  metrics: true
});
```

Keep `namespace` stable across all replicas of one deployment and distinct
between applications that may reuse message IDs. Do not disconnect Prisma from
the connector; start and stop the application-owned client at the application
boundary.

When metrics persistence is enabled, consumer and publisher share one buffered
sink. Flush it during graceful shutdown before disconnecting Prisma:

```ts
await consumer.stop();
await publisher.disconnect();
await stores.metricsSink?.flush();
await prisma.$disconnect();
```

## Schema management

| Command | Behavior |
| --- | --- |
| `resilientmq-prisma init` | Adds inbox and outbox models and runs `prisma format`. |
| `resilientmq-prisma init --metrics` | Also adds the event-oriented metrics model. |
| `resilientmq-prisma schema check` | Exits non-zero when models are absent or incompatible. |
| `resilientmq-prisma schema print` | Prints the provider-neutral models. |
| `resilientmq-prisma schema print --provider postgresql` | Prints PostgreSQL models with native JSONB. |

Schema discovery gives an explicit `--schema` highest priority, then checks the
`prisma.schema` path in the application's `package.json`, `prisma.config.*`, and
finally the conventional `prisma/schema.prisma` and `schema.prisma` paths. A
schema file or multi-file schema directory is supported. The datasource is read
from that resolved primary schema or a sibling schema file.

The detected provider controls storage types:

| Provider | Payload and properties | Error details |
| --- | --- | --- |
| PostgreSQL | `Json @db.JsonB` | Native PostgreSQL text |
| MySQL/MariaDB | `Json` | `TEXT` and `LONGTEXT` where needed |
| SQLite | `Json` | Prisma SQLite JSON mapping |

Prisma 6.19 is above the Prisma 6.2 release that introduced SQLite JSON
support. Partially installed or incompatible models fail without overwriting
application schema content.

Provider-specific reference fragments are published in `prisma/postgresql`,
`prisma/mysql`, and `prisma/sqlite`. The CLI remains the preferred installation
path because it detects the application's provider and preserves its existing
schema layout.

Physical table names can be changed without changing Prisma model names or
generated delegate access:

```bash
npx resilientmq-prisma init \
  --metrics \
  --inbox-table app_event_inbox \
  --outbox-table app_event_outbox \
  --metrics-table app_resilience_metrics
```

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

Physical table overrides from the CLI only change `@@map`. Delegate overrides
are therefore unnecessary unless the application manually renames the Prisma
models themselves. Metrics delegates can be overridden with `models.metrics`.

## Persisted metrics

`metrics: true` resolves `resilientMqMetricEvent`, creates a
`PrismaMetricsSink`, and wraps it in core's `BufferedMetricsSink`. Emission stays
outside RabbitMQ ACK and publisher-confirm paths. Each row is one compact fact:
name, timestamp, message identity, stable service identity, process identity,
attempt, duration, and error name. Payloads and stacks are deliberately absent.

`consumerOptions` and `publisherOptions` already contain the correct store and
shared `metricsSink`. Core's independent `metricsEnabled` option may still be
used when an in-process aggregate returned by `getMetrics()` is also required.

Buffer bounds are configurable:

```ts
const stores = createPrismaEventStores({
  client: prisma,
  namespace: 'orders-production',
  metrics: {bufferCapacity: 20_000, batchSize: 200}
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

Payloads and AMQP properties are stored as native JSON and must be JSON
serializable. Objects and arrays are persisted directly without a connector
wrapper, so database JSON operators address application fields at their natural
path. Rows written by 0.1.0 with `{value: ...}` remain readable during rolling
upgrades. Error stacks remain bounded text and metric rows never contain
payloads or stacks.

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

## Contributors

Thanks to everyone who has contributed to this project:

[![Contributors](https://contrib.rocks/image?repo=resilientmq/prisma-connector)](https://github.com/resilientmq/prisma-connector/graphs/contributors)

Want to help? Read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © [ResilientMQ](https://github.com/resilientmq)
