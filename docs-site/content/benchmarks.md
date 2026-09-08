The [engineering dashboard](../benchmarks/index.html#suite-engineering) renders the committed current-product measurements for editor/compiler operations, builds, packaging, installed consumers,
startup and PostgreSQL replay. Each metric includes its unit, sample count, median and min–max range, with the captured revision, tool versions, date and machine details.

Download the [summary and per-metric samples](../benchmarks/engineering.json) or [complete raw runs and command output](../benchmarks/engineering-raw.json.gz). The
[baseline script](https://github.com/ambasta/zmdb/blob/main/benchmarks/scripts/baseline.mjs) defines the metrics; the
[reproduction guide](https://github.com/ambasta/zmdb/blob/main/benchmarks/harness/README.md#engineering-costs) describes setup and individual workloads.

Percentile rows summarize **per-run percentiles**, not a pooled latency distribution. Installed size includes TypeScript and installation tooling. OS caches are not flushed, cached builds retain
filesystem/dependency caches, and PostgreSQL shares the machine with the load generator.

The older upstream competitor results remain separately labelled historical. Their PostgreSQL 16, validation, peer, Bun and Deno results were not rerun with the current-product engineering capture.
The HTTP panel also identifies its separate dated Node refresh.
