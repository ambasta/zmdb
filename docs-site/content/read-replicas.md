Read replicas distribute read traffic across multiple database instances while writes always go to the primary. zmdb's `withReplicas` wrapper creates a composite driver that routes queries based on
execution effects recorded by the query compiler.

## Configuring Replicas

Pass a primary driver and an array of replica drivers:

```ts {"mode":"illustrative","id":"example-001","reason":"The application supplies the local modules ./drivers; this fence is an excerpt of that project."}
import { withReplicas, type ReplicaOptions } from '@zmdb/orm/replicas';
import { PgDriver } from './drivers';

const primary = new PgDriver(pool);
const replica1 = new PgDriver(replicaPool1);
const replica2 = new PgDriver(replicaPool2);

const driver = withReplicas({
  primary,
  replicas: [replica1, replica2],
});
```

The composite driver implements the same `Driver` interface:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies UserRepository, driver; this excerpt does not repeat those declarations."}
// All repository operations use this driver
const repo = new UserRepository(driver);
const user = await repo.findById(1); // May hit a replica
await repo.create({ name: 'Alice' }); // Always hits primary
```

## How Routing Works

Writes, DDL, locking reads and unknown raw statements require the primary. Ordinary compiled reads may use replicas in round-robin order. Raw-query callers declare the execution facts explicitly:

```ts {"mode":"compile","id":"example-003"}
import type { CompiledQuery } from '@zmdb/sql';

const query: CompiledQuery = {
  text: 'SELECT id FROM users',
  parameters: [],
  effects: { operation: 'SELECT', requiresPrimary: false, returnsRows: true },
};

void query; // Eligible for a replica; no SQL text is parsed to make that decision.
```

> [!NOTE] There's no replication lag detection. Reads may return stale data. For use cases requiring strong consistency, query the primary explicitly.

Transactions stay on the primary. A row-returning write still requires the primary; returning rows does not make it a replica read.

## Custom Load Balancing

Provide a custom `pick` function to control replica selection:

```ts {"mode":"illustrative","id":"example-004","reason":"The surrounding example supplies primary, replica1, replica2, replica3, withReplicas; this excerpt does not repeat those declarations."}
const driver = withReplicas({
  primary,
  replicas: [replica1, replica2, replica3],
  pick: (replicas, nextIndex) => {
    // Example: weighted random, health-based, or latency-based
    return replicas[nextIndex % replicas.length];
  },
});
```

The `pick` function receives the replica list and the current round-robin index.

## Handling Failures

If a replica fails, the driver throws. For resilience, wrap individual replicas with retry logic:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies CompiledQuery, Driver, ExecuteOptions; this excerpt does not repeat those declarations."}
class ResilientDriver implements Driver {
  constructor(
    private driver: Driver,
    private retries = 3,
  ) {}

  async execute(query: CompiledQuery, options?: ExecuteOptions) {
    for (let i = 0; i < this.retries; i++) {
      try {
        return await this.driver.execute(query, options);
      } catch (e) {
        if (i === this.retries - 1) throw e;
        await new Promise(r => setTimeout(r, 100 * (i + 1)));
      }
    }
    throw new Error('Unreachable');
  }
}
```

> [!TIP] Use connection pool health checks to remove unhealthy replicas from the pool automatically. Most pool libraries support this.

## Zero Replicas

If you pass an empty replicas array, all queries go to primary:

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies primary, withReplicas; this excerpt does not repeat those declarations."}
const driver = withReplicas({
  primary,
  replicas: [], // All queries hit primary
});
```

This is useful for gradual rollout — start with zero replicas, add them as you validate.

---

See also: [Drivers](./drivers.html) · [Repository](./repository.html) · [Query Compiler](./select.html)
