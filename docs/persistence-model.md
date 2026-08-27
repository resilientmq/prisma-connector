# Persistence model

`@resilientmq/prisma-connector` implements the atomic inbox and distributed
outbox interfaces required by `@resilientmq/core` 3.x. It uses conditional
database updates as compare-and-swap operations; it does not rely on a
process-local mutex.

## Ownership identity

| Store | Durable identity | Active ownership |
| --- | --- | --- |
| Inbox | `namespace`, `serviceId`, `messageId` | `instanceId`, `fencingToken`, `leaseExpiresAt` |
| Outbox | `namespace`, `messageId` | `serviceId`, `instanceId`, `fencingToken`, `leaseExpiresAt` |

The core hashes the configured consumer `serviceId` before it reaches the
store. The connector persists that stable value and does not derive an identity
from a hostname, PID, or replica name. `instanceId` and `fencingToken` are
ephemeral and change whenever ownership changes.

## Inbox transitions

An unseen event is inserted directly into `PROCESSING` with an active lease. A
retryable or expired row may be claimed through one conditional update. A row
in a terminal state returns `completed`; a row with a live lease returns `busy`.

Only a transition matching the stable identity, active instance, and fencing
token can complete or release processing. Therefore an old handler cannot
overwrite a result after another replica recovers its expired lease.

## Outbox transitions

New outbox events begin in `PENDING`. A publisher claims ready rows by changing
them to the connector's claimed state and assigning a fresh lease and fencing
token. Batch candidates are intentionally over-read and then claimed with
conditional updates, so returned rows are exclusively owned even when several
replicas scan the same index concurrently.

A successful RabbitMQ confirm moves the actively owned row to `PUBLISHED`. A
failure releases it to `ERROR` with `nextAttemptAt`; no replica may claim it
before that deadline. An expired claimed row is recoverable by another replica.

## Crash recovery

Leases eliminate permanent `PROCESSING` or claimed rows after process death.
Recovery is demand-driven: another consumer delivery or publisher backlog pass
observes the expiration and acquires a new fenced claim. Operational monitoring
should alert on old active rows, but it must compare their lease expiration
rather than treating every active state as dead.

## Database operations

Claim and transition methods map to single `create`, `updateMany`, or
`deleteMany` statements against a structural Prisma delegate. This keeps the
connector compatible with generated Prisma 6 and Prisma 7 clients without
taking ownership of `$connect`, `$disconnect`, or application transactions.

The generated indexes support the identity lookups and pending/expired scans.
Applications should retain those indexes when extending the models. Changes to
column names, unique constraints, status fields, lease fields, or fencing fields
are incompatible with the connector contract.

## Schema rollout

The schema installer only adds complete missing models. If exactly one model is
present, or required fields are missing, it stops instead of guessing how to
repair application-owned schema content.

Use this rollout order:

1. Run `resilientmq-prisma init` in development.
2. Review and commit the schema and generated migration.
3. Validate with `resilientmq-prisma schema check` in CI.
4. Deploy the migration before starting application code that configures the
   connector.

Rolling back application code does not require deleting the tables. Removing
tables or changing unique constraints is a separate destructive migration and
must only happen after all connector users have been removed.
