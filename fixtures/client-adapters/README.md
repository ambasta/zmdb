# Private adapter conformance harness

This workspace is test infrastructure for issues #690–#700. It is private, is not published, and must never become a dependency of an adapter package. Production adapters share the generated
`@zmdb/client` contract, not a cross-framework runtime state engine.

## Binding a framework

Each adapter test supplies an `AdapterConformanceBinding<ApiClient>`. The binding translates the adapter's native lifecycle into six test-only operations: prepare, mount, observe, update, refresh, and
dispose. The common cases then run the same generated client through that binding.

| Adapter family | Native mount used by the harness                                      | Native update supplied by its implementation issue        | Native disposal used by the harness               |
| -------------- | --------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| React          | `react-test-renderer` mount with activation inside `useEffect`        | renderer update with new hook dependencies or props       | renderer unmount inside `act`                     |
| Angular        | child `EnvironmentInjector` plus `runInInjectionContext`              | signal/input update inside the owning injector            | `EnvironmentInjector.destroy()` / `DestroyRef`    |
| Vue            | `effectScope().run(...)`                                              | update the watched `ref` in the same effect scope         | `effectScope.stop()` / `onScopeDispose`           |
| Svelte         | first subscription to an owning `readable` store                      | update the adapter's input store                          | final unsubscribe and the store teardown callback |
| Solid          | `createRoot(...)` with the adapter under the resulting owner          | update the resource source/accessor under that owner      | dispose the Solid root / `onCleanup`              |
| React Native   | the React binding above plus the package's AppState/connectivity port | native lifecycle event delivered through the bound port   | React unmount plus the configured native policy   |
| Next           | React client binding or one request-scoped server invocation          | React dependencies or a new request-local server call     | React unmount or completion of the server request |
| Nuxt           | Vue client scope or one Nitro request/plugin instance                 | Vue refs or request-local `useAsyncData` input/key change | scope stop or end of the Nitro request            |
| SvelteKit      | Svelte subscription or one `RequestEvent` load                        | store change or a new navigation/load                     | unsubscribe or navigation/request cancellation    |

The `bindPreparedAdapterSubject` bridge exists only to keep #689's missing-package `it.fails` cases executable. React, Angular, Vue, Svelte, Solid, Next, and Nuxt now use their real framework
lifecycles through the corresponding fixture modules; the remaining missing adapters still use the bridge as retirement triggers. No implementation copies the bridge into production.

`svelte-packed/` separately installs the client and Svelte tarballs, compiles browser and server component graphs, renders isolated server trees, and typechecks only public package declarations.

## Deterministic fixtures

- `generated/api.generated.ts` covers a query, mutation, alternate `202` success, documented errors, bearer authentication, and response validation.
- `controllable-transport.ts` numbers every request, records settlement order, exposes the exact abort reason, and tracks every delivered or undelivered request until it settles. `assertIdle()` turns
  a leaked request into a deterministic failure.
- `conformance-cases.ts` contains the shared query, mutation, error, cancellation, stale-result, and no-retry assertions.
- `ssr.ts` starts two concurrent authenticated requests and compares the credentials and results by request URL.
- `package-rules.ts` enforces the package matrix, framework peers, import purity, and the absence of server, ORM, database, or competing HTTP dependencies. Vue's three framework-owned runtime hooks
  are an explicit package-matrix allowance, and Nuxt's root/client/server entries are checked independently; adapter-created globals remain failures.

Import purity is measured after loading the adapter's required framework peers. This separates effects owned by a framework runtime—Angular core itself installs `ngDevMode` and devtools globals—from
network or global registration added by an adapter package.

## Packed projects

`runPackedProject` copies publish-ready package trees to a temporary staging area, runs `npm pack`, installs only the resulting tarballs into a clean application, verifies that installed packages are
not workspace symlinks, and then runs the supplied framework build/runtime commands in order. Callers must provide a publish-ready manifest when a committed manifest still contains `workspace:`
ranges.

This helper is orchestration, not qualification evidence by itself. Issues #691–#694 combine it with the real React, Angular, Vue, and Svelte packages, native lifecycle bindings, published manifests,
external typechecks, and common runtime cases. Issue #697 adds a packed Next App Router application with physical server/browser boundaries, request-local runtime evidence, and browser-output
inspection. Issue #698 adds a packed Nuxt 4.5.2 application that installs `@zmdb/client`, `@zmdb/vue`, and `@zmdb/nuxt` tarballs, builds the real module, renders concurrent requests with isolated
credentials, observes native Nuxt payload data, and exercises the browser plugin. Issue #700 remains responsible for cross-adapter qualification that no framework-specific slice can earn alone.
