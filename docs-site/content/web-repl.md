> **Development-only local REPL.** Nothing starts it automatically. An explicit `zmdb repl` command boots the real application container, runs its startup lifecycle and opens a TTY-only Node REPL. It
> creates no HTTP server, debug socket or remote-attach port.

## Start the application shell

Name the root module as `<path>#<export>`:

```bash
zmdb repl ./src/app.module.ts#AppModule
```

In a single-package project the default is `./src/app.module.ts#AppModule`. A workspace root must name the module explicitly, so the command cannot silently choose the wrong package.

Application TypeScript is loaded through the same Stage-3 decorator transform used by `zmdb modules`. Importing the module runs its top-level code. The REPL then calls `createApp(AppModule)` and
`app.init()`; it does not construct a test application or apply provider overrides.

Before the prompt, stderr shows:

- the resolved CLI config path and root module;
- that dialect and database identity are application-owned;
- the prompt bindings, provider-token descriptions and history location.

The CLI cannot truthfully infer the live database name. Applications do not read `zmdb.config.ts`, `Driver` has no connection-name field, and inspecting provider values could execute factories or
print credentials. Put a safe environment label in your own startup output if operators need one.

## Prompt scope

| Binding                   | Value                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `app`                     | the initialized `App`                                           |
| `container`               | `app.container`                                                 |
| `get(tokenOrDescription)` | resolves a token object or one unique token description         |
| `tokens`                  | provider-token descriptions from the declared module graph      |
| `describe()`              | a readable module, provider, controller and finding description |
| `request(req)`            | `app.handle`; a string is shorthand for a `GET` request         |
| `load(name)`              | loads a lazy module handle by its class name                    |

Examples:

```text
zmdb> tokens
[ 'DATABASE', 'POSTS_REPOSITORY' ]
zmdb> get('POSTS_REPOSITORY')
BaseRepository { ... }
zmdb> await get('POSTS_REPOSITORY').findById(42)
{ id: 42, title: 'Measured, not guessed' }
zmdb> await request('/health')
{ status: 200, body: ..., headers: ... }
```

`get` still accepts the original token object:

```text
zmdb> const { POSTS } = await import('./src/tokens.js')
zmdb> get(POSTS)
```

Two distinct tokens may share one description. In that case `get('db')` refuses with an ambiguity error instead of selecting one; importing the actual token remains unambiguous.

## Top-level await

The prompt uses Node's asynchronous REPL evaluator. Promise results are awaited and printed:

```text
zmdb> await get('POSTS_REPOSITORY').list({ page: { limit: 5 } })
{ items: [ ... ], total: 37 }
```

There is no need to write `.then(console.log)`.

## Lazy modules

Lazy declarations are validated when the app boots but instantiated only when loaded. Use the named handle before resolving one of its providers:

```text
zmdb> await load('AdminModule')
zmdb> get('ADMIN_REPOSITORY')
```

`load` shares the application's normal single-flight and lifecycle behavior. An unknown or duplicated lazy-module name is refused rather than guessed.

## History

History defaults to:

```text
~/.zmdb_repl_history
```

The file is mode `0600`. Relocate it with `ZMDB_REPL_HISTORY`; a relative value is resolved under the home directory, not the current project. A path inside the nearest package tree is refused.

Disable history for a sensitive session:

```bash
zmdb repl ./src/app.module.ts#AppModule --no-history
```

The project directory never receives a history file.

## Shutdown

Leaving with `.exit`, Ctrl-D or an input close ends the session. The command then disposes the `App`, waits for in-flight lazy loads and calls `onShutdown` in reverse construction order. A pool
registered as a provider therefore closes through the same lifecycle as the server application.

## Security boundary

> [!WARNING] The REPL has whatever database authority the application providers have. It adds no confirmation or read-only layer. Prefer a read-only database role for incident work.

The boundary is structural:

- stdin must be a TTY; piped and network-controlled input exits 2;
- it opens no listener, not even on loopback, and accepts only local terminal input;
- there is no `--host`, `--port`, `--inspect` or remote protocol;
- `--json` is refused because an interactive conversation is not one JSON document;
- `node:repl` exists only under the policy-defined tooling entry `zmdb/cli`;
- `yarn verify:runtime-reachability` proves no ordinary export reaches the REPL or inspector implementation; `yarn verify:devtools-boundary` is its compatibility alias.

## AOT calls in the prompt

The application source loader lowers decorators, but it does not run the zmdb AOT validator transform over expressions typed at the prompt. An untransformed `assert<T>()` throws
`runtime type witness required in test/fallback mode`; it does not silently accept input. Use the built application or a test when checking generated validation.

Pure query compilation remains useful in the shell:

```text
zmdb> compiler.selectFrom('posts').select(['id']).where('published', '=', true).compile()
{ text: 'SELECT "id" FROM "posts" WHERE "published" = $1', parameters: [ true ] }
```

---

See also: [Module Inspector](./web-devtools.html) · [Lazy Modules](./web-lazy-modules.html) · [Standalone Applications](./web-standalone.html) · [Debugging Queries](./logging.html)
