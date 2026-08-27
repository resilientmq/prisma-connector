# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-27

### Added

- Prisma 6.19 and Prisma 7 inbox and outbox stores implementing the atomic
  lease and fencing contracts from `@resilientmq/core` 3.
- Idempotent schema installer for single-file and multi-file Prisma schemas.
- Explicit, opt-in development migration execution.
- Provider-neutral event serialization and namespace isolation.
- Concurrent claim, expired lease, stale owner, delayed retry, and packaging
  test coverage.
- Real integration coverage for SQLite, PostgreSQL, and MariaDB.
- Experimental Prisma 8 PostgreSQL collection bridge and contract models.
- Object-oriented factories for the stable and experimental stores, plus an
  object-oriented schema manager and injectable CLI.
- Unit coverage above 90% for statements, lines, and functions, with edge-case
  coverage for serialization, timestamps, schema discovery, and CLI execution.
- Clean-checkout type checking that generates and validates integration clients
  before checking database-specific test types.
- Datasource-driven native JSON models for PostgreSQL, MySQL/MariaDB, and SQLite.
- Optional persisted metric facts with a shared bounded buffer and ready-to-use
  consumer and publisher configuration bindings.
- Physical inbox, outbox, and metrics table mappings configurable during schema
  installation without renaming Prisma models or delegates.
- Persistence model and production schema rollout documentation.
- npm trusted publishing workflow using GitHub OIDC and provenance.

[Unreleased]: https://github.com/resilientmq/prisma-connector/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/resilientmq/prisma-connector/releases/tag/v0.1.0
