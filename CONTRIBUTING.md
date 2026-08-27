# Contributing

Open an issue before substantial feature or behavioral work. Use a short branch
name such as `feat/postgresql-claim-optimization` and Conventional Commits.

Before opening a pull request, run:

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm audit
```

Changes to lease ownership, fencing, retries, schema identity, or public types
must include tests covering concurrent replicas and expired ownership.
