# Benchmark Results

> Validation + ORM suites. DNF rows are shown explicitly (never omitted):
> `dnf (anti-pattern)` for rejected patterns, `dnf (not implemented)` for
> supported-in-principle cases not yet wired. Numbers are indicative of the
> generating machine, not an official ranking.

| Suite | Case | Target | Result |
|-------|------|--------|--------|
| orm | active-record-save | zmdb | dnf (anti-pattern): active-record entity.save() rejected |
| orm | customer-by-id | drizzle | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | customer-by-id | kysely | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | customer-by-id | prisma | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | customer-by-id | zmdb | 47362 ops/s |
| orm | identity-map-dedup | zmdb | dnf (anti-pattern): identity map rejected by architecture |
| orm | lazy-relation-graph | zmdb | dnf (anti-pattern): proxy lazy-load rejected by architecture |
| orm | order-with-items | drizzle | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | order-with-items | kysely | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | order-with-items | prisma | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | order-with-items | zmdb | 18875 ops/s |
| orm | prepared-reuse | drizzle | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | prepared-reuse | kysely | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | prepared-reuse | prisma | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | prepared-reuse | zmdb | 49536 ops/s |
| orm | products-search | drizzle | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | products-search | kysely | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | products-search | prisma | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | products-search | zmdb | 28229 ops/s |
| orm | top-products | drizzle | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | top-products | kysely | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | top-products | prisma | dnf (not implemented): live-PostgreSQL + k6 competitor harness not wired in this environment |
| orm | top-products | zmdb | 5795 ops/s |
| validation | loose-assert | zmdb | 965799 ops/s |
| validation | safe-parse | zmdb | 462099 ops/s |
| validation | strict-assert | zmdb | 823079 ops/s |
| validation | strict-parse | zmdb | 440199 ops/s |
