End-to-end walkthroughs, as opposed to the task-shaped answers in [Guides](./guides.html). Each one starts from an empty directory and ends with something running.

## Start here

**[Quick Start](./quick-start.html)** — a schema, a query, a typed result, in about five minutes. Read this before anything else on this page.

**[Your First Application](./quick-start.html)** — a controller, a module, a repository behind DI, and a route that returns real rows.

## The three things that trip people up on day one

Worth knowing before you follow any tutorial, because each one produces a confusing failure rather than a clear error:

**The AOT transformer must be configured.** If it is not, `is<T>()` and `assert<T>()` return success and check nothing — validation that fails open. Write this test first, in every project:

```ts
it('the transformer is running', () => {
  expect(is<{ id: number }>({ id: 'x' })).toBe(false);
});
```

See [AOT Setup](./aot-setup.html).

**`References` is a tag, not a call.** The target is a `table.column` string literal, so there is nothing to import and no schema value to have on hand:

```ts
authorId: number & Sql<'integer'> & References<'users.id'>;
```

**The query builder is immutable.** `b.where(...)` returns a new builder; it does not modify `b`. Chain or reassign.

## Deploying

|                                                        |                                                  |
| ------------------------------------------------------ | ------------------------------------------------ |
| [Deployment](./deployment.html)                        | The general shape: build, migrate, roll          |
| [Vercel](./deploy-vercel.html)                         | Functions, and the connection arithmetic         |
| [Next.js](./deploy-nextjs.html)                        | Server components, route handlers, the bundler   |
| [Netlify](./deploy-netlify.html)                       | Functions and edge functions                     |
| [Supabase Edge Functions](./deploy-supabase-edge.html) | Deno, and the transformer problem                |
| [Railway](./deploy-railway.html)                       | A long-running container, which is the easy case |
| [Encore](./deploy-encore.html)                         | Infrastructure-from-code, and where it conflicts |

## Client applications

Start with [one generated HTTP client](./generated-client.html), then choose the framework guide that owns the application lifecycle:

|                                                      |                                                     |
| ---------------------------------------------------- | --------------------------------------------------- |
| [Client Applications](./framework-integrations.html) | support and ownership across all nine integrations  |
| [React](./client-react.html)                         | context, hooks, cancellation, and request-local SSR |
| [Angular](./client-angular.html)                     | DI, signals, `DestroyRef`, and RxJS cancellation    |
| [Vue](./client-vue.html)                             | plugin injection, reactive state, and SSR isolation |
| [Svelte](./client-svelte.html)                       | context, lazy stores, and subscriber teardown       |
| [Solid](./client-solid.html)                         | resources, owner disposal, Suspense, and errors     |
| [React Native](./client-react-native.html)           | AppState, connectivity, credentials, and Metro      |
| [Next.js](./client-next.html)                        | App Router request scopes and browser separation    |
| [Nuxt](./client-nuxt.html)                           | Nitro request clients and native hydration          |
| [SvelteKit](./client-sveltekit.html)                 | event fetch, load helpers, and navigation aborts    |

## Local development

|                                               |                                                |
| --------------------------------------------- | ---------------------------------------------- |
| [Local Postgres](./guide-local-postgres.html) | Docker, fast resets, `psql`                    |
| [Local MySQL](./guide-local-mysql.html)       | Docker, and the collation settings that matter |
| [PGlite](./connect-pglite.html)               | Postgres in-process, no daemon                 |
| [Testing](./testing.html)                     | Compile SQL with no database; fake the driver  |

## Going deeper

|                                                 |                                    |
| ----------------------------------------------- | ---------------------------------- |
| [Schema Declaration](./schema-declaration.html) | Columns, relations, options        |
| [Repository API](./repository.html)             | Every method, with the DTO types   |
| [Migrations](./migrations.html)                 | Snapshot, diff, emit, run          |
| [OpenAPI Generation](./openapi.html)            | Controllers to a spec              |
| [Anti-Patterns](./anti-patterns.html)           | What zmdb deliberately will not do |

---

See also: [Quick Start](./quick-start.html) · [Guides](./guides.html) · [Deployment](./deployment.html)
