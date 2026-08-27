# GitHub Actions workflows

## `ci.yml`

Runs type checking, unit coverage, Prisma 6 compatibility, Prisma 7 SQLite,
PostgreSQL and MariaDB integration tests, a production build, package metadata
normalization, audit, and tarball inspection.

## `release.yml`

Validates a version tag and publishes through npm trusted publishing. Configure
the npm trusted publisher with:

| Setting | Value |
| --- | --- |
| Organization or user | `resilientmq` |
| Repository | `prisma-connector` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed action | `npm publish` |

The workflow requires `id-token: write`, npm 11.5.1 or newer, a GitHub-hosted
runner, and no npm publication token.
