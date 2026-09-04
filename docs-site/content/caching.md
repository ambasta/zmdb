> **ToDo / feature gap.** There is no query cache, no result cache and no
> invalidation. Every repository call reaches the driver, and every driver call
> reaches the database.

## Why that default is defensible

A cache that is not invalidated correctly serves wrong data, and invalidation is the hard part — an ORM-level cache has to guess which cached results a write affects, and it guesses from the table name, which is too coarse to be right and too fine to be safe. Getting it wrong looks like a bug in your application, not in the cache.

So the position is: caching is a decision about _this_ query's staleness tolerance, and that decision belongs where you can see the query.

## Cache a driver

Because `Driver` is one method over `{ text, parameters }`, a read-through cache is a wrapper:

```ts
export function cached(inner: Driver, ttlMs: number): Driver {
  const store = new Map<string, { at: number; rows: readonly Record<string, unknown>[] }>();

  return {
    async execute(query) {
      const isRead = /^\s*(select|with)/i.test(query.text);
      if (!isRead) {
        store.clear();
        return inner.execute(query);
      }

      const key = query.text + '�' + JSON.stringify(query.parameters);
      const hit = store.get(key);
      if (hit !== undefined && Date.now() - hit.at < ttlMs) return hit.rows;

      const rows = await inner.execute(query);
      store.set(key, { at: Date.now(), rows });
      return rows;
    },
  };
}
```

Read the two compromises in that code before using it:

- **`store.clear()` on any write** is the only invalidation that is definitely correct without knowing which query touches which table. It is also brutal — one insert empties the cache. Anything smarter needs to parse the SQL, which is where correctness goes.
- **It is per process.** Two instances hold two caches with different contents, so a user's requests will see different data depending on which instance answers. For a read-mostly reference table that is fine; for anything a user just wrote it is not.

## Cache at the call site instead

Usually better, because the staleness decision is visible next to the query:

```ts
let categories: Entity<Category>[] | undefined;
let loadedAt = 0;

export async function getCategories() {
  if (categories === undefined || Date.now() - loadedAt > 60_000) {
    categories = [...(await categoryRepo.findAll())];
    loadedAt = Date.now();
  }
  return categories;
}
```

Ten lines, obvious semantics, and the next reader can tell exactly how stale the data can be.

## Cache the HTTP response

Often the right layer, because it caches the whole computation rather than one query:

```ts
@HttpGet('/categories')
async list() {
  const rows = await this.repo.findAll();
  return respond({
    body: stringify(rows),
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=60',
    },
  });
}
```

A CDN or the browser then serves it and your process is not involved at all. For anything genuinely public and slow-changing this beats every application-level cache.

## Shared cache, when you need one

Redis or Memcached, keyed by something you control — not by SQL text:

```ts
async function topPosts() {
  const key = 'posts:top:v2';
  const hit = await redis.get(key);
  if (hit !== null) return decode<Entity<Post>[]>(hit);

  const { items } = await postRepo.list({ orderBy: [{ column: 'views', dir: 'desc' }], page: { limit: 10 } });
  await redis.set(key, stringify(items), { EX: 60 });
  return items;
}
```

Two things worth copying: the `v2` in the key, so a shape change does not have to be invalidated (you just stop reading the old key), and `decode<T>` rather than `JSON.parse` — a cached value from an older deploy has an older shape, and [validating it](./serialization.html) turns that into an error rather than an `undefined` three layers up.

## What a built-in cache would have to solve

Invalidation, keyed on something finer than the table. Realistically that means the repository declaring which tables a query reads — which it knows — and writes invalidating by table. That is coarse but correct, and it is probably what would ship. Cross-process invalidation would remain the user's problem, because it needs a transport zmdb does not have.

---

See also: [Query Performance](./perf-queries.html) · [Writing a Driver](./custom-driver.html) · [DataLoaders](./dataloaders.html)
