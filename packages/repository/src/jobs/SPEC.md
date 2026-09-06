# Repository job-storage module — issue #635 ownership exit

The current `packages/repository/src/jobs/index.ts` leaves the ORM foundation. Issue #753 supersedes the earlier destination: durable queue tables, indexes, SQL, migrations, and transaction adapters
move to `@zmdb/jobs-sqlite` and `@zmdb/jobs-postgres`, not to provider-neutral `@zmdb/jobs`.

`@zmdb/jobs` does not consume an ORM driver or transaction directly. A selected provider exposes the public `JobStore` and transaction-scoped `JobEnqueuer` ports. No `@zmdb/orm/jobs`, repository
forwarder, private source import, or compatibility subpath is created.
