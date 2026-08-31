> **ToDo / feature gap.** There is no DataLoader. Nothing coalesces separate
> repository calls made in the same tick into one batched query, and there is no
> per-request cache of already-fetched rows.

## Why this is usually asked for

The N+1 that `populate` solves is _within_ one call. The one a DataLoader solves is _across_ calls — most visibly under GraphQL, where each field resolver fetches independently and nothing sees the whole picture:

```ts
// 1 + N queries: one for the posts, one per post for its author
const posts = await postRepo.findAll();
for (const p of posts) {
  const author = await authorRepo.findById(p.authorId);
}
```

## Batch it yourself, which is most of what a loader does

```ts
const posts = await postRepo.findAll();
const authorIds = [...new Set(posts.map(p => p.authorId))];
const authors = await authorRepo.find({ id: { in: authorIds } });
const byId = new Map(authors.map(a => [a.id, a]));

const withAuthors = posts.map(p => ({ ...p, author: byId.get(p.authorId) }));
```

Two queries, and the deduplication is visible. If the shape above appears more than twice, the relation belongs in `populate` or `findJoined` — see [Loading Strategies](./loading-strategies.html) — which is why the explicit version being slightly tedious is not always a bad thing.

## A minimal loader, if you need one

Nothing stops you writing one; it is about fifteen lines and it has no zmdb-specific parts:

```ts
function createLoader<K, V>(fetch: (keys: readonly K[]) => Promise<Map<K, V>>) {
  let pending = new Map<K, ((v: V | undefined) => void)[]>();
  let scheduled = false;

  const flush = async () => {
    const batch = pending;
    pending = new Map();
    scheduled = false;
    const found = await fetch([...batch.keys()]);
    for (const [key, waiters] of batch) for (const w of waiters) w(found.get(key));
  };

  return (key: K): Promise<V | undefined> =>
    new Promise(resolve => {
      const waiters = pending.get(key) ?? [];
      waiters.push(resolve);
      pending.set(key, waiters);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
}

const authorLoader = createLoader<number, Entity<typeof authors>>(async ids => {
  const rows = await authorRepo.find({ id: { in: [...ids] } });
  return new Map(rows.map(r => [r.id, r]));
});
```

> [!WARNING]
> Construct it **per request**, not per process. A loader is a cache, and a
> process-lifetime cache of rows keyed by id is a stale-data bug and, under
> multi-tenancy, a data-leak bug. Register it as a request-scoped provider — see
> [Request Context](./web-request-context.html).

## What it would take

The mechanics are the easy half; the lifetime is the hard half. zmdb has no ambient request context (`AsyncLocalStorage` is not used anywhere), so a built-in loader would need either an explicit "unit of read" object threaded through calls, or the ambient-context machinery — and ambient state that quietly changes what a query returns is the thing the [identity map argument](./anti-patterns.html) rejects. A built-in version would most likely be an explicit `createLoaderSet(repos)` you construct and pass, not something that activates itself.

---

See also: [Loading Strategies](./loading-strategies.html) · [Query Performance](./perf-queries.html) · [Caching](./caching.html)
