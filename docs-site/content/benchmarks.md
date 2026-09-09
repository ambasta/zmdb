The [benchmarks dashboard](../benchmarks/index.html#suite-optimizations) starts with the **9 September 2026** optimization measurements, comparing baseline `9c8c206f` with the changes integrated in
`4c9cf2f4`. It includes native JSON serialization, generated numeric validation, HTTP handling on Node/Bun/Deno, and eager/deferred nested PostgreSQL relation loading.

Serialization took 53–55% less time on the measured inputs. Mean HTTP throughput rose 6–20% across the four workloads; repository loading throughput rose about 10%. These are short before/after
experiments: numeric validation differences were small, deferred-loading results varied, and neither ORM lane establishes a consistent p99 improvement. The dashboard includes all measured cases,
sample ranges, runtime versions and [downloadable per-run measurements](../benchmarks/optimizations-2026-09-09-samples.json.gz).

The full-text indexes are in the shared database seed for every ORM participant. The corrected 13-route fixture passed 27 response-parity checks across zmdb, Drizzle and Kysely. No competitor was
reranked using an older unindexed run against a newly indexed zmdb run. The
[earlier comparative investigation and profiles](https://github.com/ambasta/zmdb/blob/9c8c206f1f0703ec49dc2723e8df16fab82b0288/benchmarks/rca/2026-09-08.md) retain their original revision and
measurement conditions.

The [engineering panel](../benchmarks/index.html#suite-engineering) retains the earlier measurements for editor/compiler operations, builds, packaging, installed consumers, startup and PostgreSQL
replay. Each metric includes its unit, sample count, median and min–max range, with the captured revision, tool versions, date and machine details.

Download the [summary and per-metric samples](../benchmarks/engineering.json) or [complete raw runs and command output](../benchmarks/engineering-raw.json.gz). The
[baseline script](https://github.com/ambasta/zmdb/blob/main/benchmarks/scripts/baseline.mjs) defines the metrics; the
[reproduction guide](https://github.com/ambasta/zmdb/blob/main/benchmarks/harness/README.md#engineering-costs) describes setup and individual workloads.

Percentile rows summarize **per-run percentiles**, not a pooled latency distribution. Installed size includes TypeScript and installation tooling. OS caches are not flushed, cached builds retain
filesystem/dependency caches, and PostgreSQL shares the machine with the load generator.

The older upstream competitor results remain separately labelled historical. Their PostgreSQL 16, validation and HTTP peer results were not rerun with either the engineering capture or the latest
optimization measurements. The historical HTTP panel also identifies its separate dated Node refresh.
