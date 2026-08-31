zmdb runs inside the **actual upstream benchmark harnesses** against the **real competitor libraries**:

- **ORM** — the drizzle-benchmarks routes + k6 vs Drizzle/Kysely against real PostgreSQL 16. zmdb serves all 13 routes (0 DNF).
- **Validation** — the moltar typescript-runtime-type-benchmarks runner vs Zod v3/v4, Valibot, Ajv, TypeBox, ArkType, myzod, typia — across **Node, Bun and Deno**.

DNF cases are enumerated individually, never summed or faked; we don't claim a "fastest" title we haven't earned across the full workload.

📊 **Interactive dashboard:** [open the benchmarks →](../benchmarks/index.html)
