# Repository job-storage module — issue #635 ownership exit

The current `packages/repository/src/jobs/index.ts` moves to `@zmdb/jobs`. Background-job storage is not part of the ORM foundation; ORM exposes only database and transaction contracts the jobs
package may consume inward. No `@zmdb/orm/jobs` compatibility subpath is created.
