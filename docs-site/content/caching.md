Repository result caching is off by default. A read opts in at the call site,
where its staleness tolerance is visible:

```ts
const user = await userRepo.findById(userId, {
  cache: {
    ttlMs: 5_000,
    tags: [`user:${userId}`],
  },
});
```

`findById`, `findOne`, `find`, `findAll` and `list` accept the same `cache`
option. Omitting it performs no key construction and no store call. Passing
`cache: false` bypasses an existing store in both directions: it neither reads
nor fills the cache.

## Invalidation is the API

Every cached read receives an automatic `table:<table>` tag. A successful write
through that repository invalidates the table tag after the driver operation
completes:

```ts
await userRepo.findById(userId, {
  cache: { ttlMs: 30_000 },
});

await userRepo.update(userId, { email: nextEmail });
// The next cached users read misses because table:users was invalidated.
```

Table invalidation is coarse on purpose: changing one user invalidates every
cached users query. The repository does not attempt to decide which cached
`WHERE` clauses the changed row satisfies.

Use caller tags when another table or a narrower application concept also
depends on the write. Repositories participating in a cross-repository tag must
be constructed with the same `CacheStore`:

```ts
const tag = `account-summary:${accountId}`;

const summary = await summaryRepo.findOne({ accountId }, { cache: { ttlMs: 30_000, tags: [tag] } });

await userRepo.update(userId, { email: nextEmail }, { invalidateTags: [tag] });
```

`create`, `upsert`, `update`, `updateMany`, `increment` and `delete` accept
`invalidateTags` in their write options. The repository invalidates its table
tag plus those caller tags. It does not infer cross-table dependencies.

## What invalidation cannot see

The guarantee stops at the repository/store boundary:

- SQL executed directly through a driver, a database console, a trigger or
  another data-access library does not call `invalidateTags`.
- The default memory store belongs to one repository instance in one process.
  Another process has another cache.
- A shared adapter can make `invalidateTags` global, but the application owns
  that transport and its delivery guarantees.
- If invalidation fails, the completed database write still succeeds and TTL is
  the remaining stale-data bound.

Choose `ttlMs` as the maximum stale interval the caller can tolerate under those
conditions. Do not cache a result that must always reflect an out-of-band write.

## Default and pluggable stores

The first opted-in read without a configured store lazily creates a
process-local `memoryStore()` for that repository. It is TTL-aware,
least-recently-used and bounded to 1,000 entries by default:

```ts
import { memoryStore } from '@zmdb/repository';

const store = memoryStore({ maxEntries: 5_000 });
const users = new UserRepository(driver, 'postgres', { cacheStore: store });
```

A shared backend implements three operations:

```ts
export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlMs: number, tags: readonly string[]): Promise<void>;
  invalidateTags(tags: readonly string[]): Promise<void>;
}
```

No store is global or ambient. Pass it in the repository constructor or through
`defineRepository(..., { cacheStore })`.

Store failures degrade to the database path. A failed `get` performs the read;
failed `set` and `invalidateTags` calls do not replace a successful database
result or write with a cache error. The first failure is reported once per
repository instance.

## Keys, deploys and revalidation

Keys are deterministic readable strings containing the dialect, schema IR
fingerprint, table, compiled SQL and type-tagged parameters. A numeric `1` and a
string `'1'` are different keys; object keys are sorted; binary view types
remain distinct.

The schema fingerprint makes a declaration change miss an older value in a
shared store. Cache hits are not revalidated against the database: doing that
round trip would remove the benefit of the cache. TTL, tags and `cache: false`
are the explicit freshness controls.

Results are returned as fresh **shallow** row copies. Treat them as immutable:
reassigning a top-level property does not change a later hit, but nested JSON
objects are not deep-cloned and must not be mutated.

## Why this is not an identity map

| Property        | Result cache                            | Identity map                       |
| --------------- | --------------------------------------- | ---------------------------------- |
| Entry point     | Explicit `cache` option                 | Every entity read                  |
| Freshness       | TTL, table tags and caller tags         | Session coherence                  |
| Object identity | Fresh shallow copy                      | Same object reference              |
| Writes          | Explicit invalidation, no write-through | Tracks objects for flush/coherence |
| Default         | Off                                     | Fundamental ORM behavior           |

The cache stores query results, not live entities. It never observes property
mutation, infers writes or makes ordinary uncached reads consult prior objects.
The request-scoped [DataLoader](./dataloaders.html) is narrower still: its
lifetime is one explicit request context.

---

See also: [Query Performance](./perf-queries.html) · [Writing a Driver](./custom-driver.html) ·
[DataLoaders](./dataloaders.html) · [Why fetched rows are inert](./inert-rows.html)
