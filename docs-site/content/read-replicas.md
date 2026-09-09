Read replicas distribute read traffic across multiple database instances while writes always go to the primary. zmdb's `withReplicas` wrapper creates a composite driver that routes queries based on
the SQL statement type.

## Configuring Replicas

Pass a primary driver and an array of replica drivers:

<!-- snippet: read-replicas.ts#snippet-1 -->

The composite driver implements the same `Driver` interface:

<!-- snippet: read-replicas.ts#snippet-2 -->

## How Routing Works

Writes (INSERT, UPDATE, DELETE) always go to the primary. Reads are round-robin'd across replicas:

<!-- snippet: read-replicas.ts#snippet-3 -->

> [!NOTE] There's no replication lag detection. Reads may return stale data. For use cases requiring strong consistency, query the primary explicitly.

## Custom Load Balancing

Provide a custom `pick` function to control replica selection:

<!-- snippet: read-replicas.ts#snippet-4 -->

The `pick` function receives the replica list and the current round-robin index.

## Handling Failures

If a replica fails, the driver throws. For resilience, wrap individual replicas with retry logic:

<!-- snippet: read-replicas.ts#snippet-5 -->

> [!TIP] Use connection pool health checks to remove unhealthy replicas from the pool automatically. Most pool libraries support this.

## Zero Replicas

If you pass an empty replicas array, all queries go to primary:

<!-- snippet: read-replicas.ts#snippet-6 -->

This is useful for gradual rollout — start with zero replicas, add them as you validate.

---

See also: [Drivers](./drivers.html) · [Repository](./repository.html) · [Query Compiler](./select.html)
