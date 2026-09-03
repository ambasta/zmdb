# The config file — Spec (epic "The zmdb executable")

> Part of `zmdb`, exported as `./config`. Read by the executable (`../cli/SPEC.md`); an application
> never has to import it.

## 1. Two shapes, because half of it cannot be validated

The issue that proposed this asks for one `ZmdbConfig` and for the loaded object to be checked with the
project's own validator, "deliberate dogfooding: the config is external data at a boundary". The intent is
right and the shape is not, for a reason that is measured rather than stylistic.
`@zmdb/aot-validator`'s reflector refuses an object type with a callable property:

> `` `X` has a method (`driver`); only data types can be checked ``

so a `ZmdbConfig` carrying `driver?: () => Driver` cannot be reflected at all, let alone checked. And
`naming?: NamingStrategy | 'snake_case' | 'snake_case_plural'` is refused twice over: the object arm is a
type whose members are functions.

So the config is two types, and the split is exactly the line the validator draws:

```ts
/** Plain data. Validated with `assert<ZmdbConfigData>` at load. */
export interface ZmdbConfigData {
  /** Globs, resolved against the config file's directory (§3). */
  readonly schema: string | readonly string[];
  readonly dialect: Dialect;
  /** The tsconfig the globs are read through. Default `./tsconfig.json` (§4). */
  readonly project?: string;
  /** Where migration files and the snapshot live. Default `./migrations`. */
  readonly out?: string;
  readonly naming?: 'snake_case' | 'snake_case_plural';
  readonly migrations?: {
    readonly table?: string;
    /** Postgres only (§6). */
    readonly schema?: string;
  };
  readonly introspect?: IntrospectOptions;
}

/** What `defineConfig` takes and the loader returns. */
export interface ZmdbConfig extends ZmdbConfigData {
  /** Checked with `typeof === 'function'`, not validated. */
  readonly driver?: () => Driver | Promise<Driver>;
  /** A custom strategy, where the two named ones do not fit. */
  readonly namingStrategy?: NamingStrategy;
}

export declare function defineConfig(config: ZmdbConfig): ZmdbConfig;
```

`naming` takes the two named strategies and nothing else; a custom one gets its own key. That is not
cosmetic tidying — a `string | object` union where the object arm carries functions has no validatable
spelling, and collapsing it into one key would have forced the whole config out of the validator.

The loader splits the two callable keys off, runs `assert<ZmdbConfigData>` over what is left, and checks
each callable with `typeof`. Two consequences worth stating rather than discovering:

- **The dogfooding claim gets narrower and more honest.** Every plain-data field — including `dialect`,
  which is a string union and is therefore checked exactly — is validated by the project's own emitted
  validator, with the field path in the error. The two function fields are checked for callability and
  nothing else, because nothing can check the body of a function before it runs.
- **`IntrospectOptions` must stay plain data.** The moment the introspection epic puts a callback in it,
  the whole `ZmdbConfigData` type stops reflecting and this section's split has to move. That is a
  constraint on that epic, recorded here because it will not be obvious there.

`defineConfig` is the identity function. It exists for inference and autocompletion, and it deliberately
does **not** validate: a throw at the consumer's module scope would fire in their editor and their build
for a file only the CLI reads, and the CLI has to handle a config that never called `defineConfig` anyway.
Validation belongs at the boundary that consumes the value, which is one place, not two.

## 2. Discovery walks up, and every command says where it stopped

`--config <path>` wins outright. Otherwise: `zmdb.config.ts`, then `zmdb.config.mjs`, then
`zmdb.config.js`, in the current directory, then in each parent — **stopping at the first directory that
contains a `package.json`.**

`docs-site/content/config-file.md` argues for no discovery at all, and its argument is the one that
matters:

> There is no discovery step and no ambient configuration, which has a real upside: a repository cannot be
> constructed against the wrong database because a config file was resolved from the wrong directory.

That risk is real and it is at its worst for `migrate`, `push` and `pull`, which write to a live server.
Two decisions answer it without giving up discovery, which every comparable tool has and which people
reasonably expect:

1. **The walk stops at a package boundary.** In a monorepo, running `zmdb generate` inside
   `packages/orders` can never silently pick up the config in `packages/billing`'s parent. The one
   directory that could be wrong is your own.
2. **Every command prints the resolved config path as its first line of output, and includes it as
   `config` in every `--json` payload.** The failure mode the page names is not "discovery happened", it
   is "discovery happened invisibly". A command that tells you which file it read, before it does
   anything, converts a silent wrong-database run into a line in the log you can grep for.

There is no cascade, no merging of a parent config into a child, and no environment-variable overlay. The
first file found is the whole configuration.

## 3. Every relative path resolves against the config file, never the cwd

`schema`, `out`, `project` and any path inside `introspect` resolve against the directory containing the
config file. This is the single most common source of confusion in tools of this kind, and the reason to
pick the config file's directory is that it is the only choice under which `zmdb generate` means the same
thing from every directory in the repository.

The one exception is `--config` itself, which resolves against the cwd, because it is typed on a command
line and not written in a file.

## 4. Loading: Node's own type stripping, and what that costs

Node ≥ 22.18 strips types natively and this project targets 26.x, so the loader is
`await import(pathToFileURL(configPath))` and nothing else. No bundler, no compile-to-temp, no
dependency. What that buys and what it costs, in full, because the costs will be reported as bugs:

**It cannot resolve tsconfig `paths` aliases.** A config that imports `@app/schema` fails. Node has no
knowledge of the alias, and teaching it would mean reading and interpreting the tsconfig before loading
the file that names the tsconfig.

**It cannot rewrite a `.js` specifier onto a `.ts` file.** `import { driver } from './src/config.js'` where
only `config.ts` exists is `ERR_MODULE_NOT_FOUND` — and that spelling is exactly what a project with
`allowImportingTsExtensions: false` writes everywhere, including this repository. Under Node, either the
import names the real extension (`./src/config.ts`, which needs
`allowImportingTsExtensions: true` in the consumer's tsconfig), or it names a file that has actually been
built.

**It strips, it does not transform.** Only erasable syntax: no `enum`, no `namespace`, no parameter
properties. In practice a config file contains none of these, which is part of why stripping is enough.

**The escape hatch is Node's, not ours.** A project that needs alias or specifier resolution passes its
own loader hook — `NODE_OPTIONS='--import ./loader.mjs' zmdb generate`, which is what this repository
does for its own sources. The CLI documents that and adds no second mechanism, because a resolver the CLI
implements is a resolver that disagrees with the one the consumer's editor and build already use.

Rejected: a bundler-based load. It adds a build tool to a project whose selling point is a peer
dependency on `typescript` and nothing else, and it introduces module duplication — a bundled config that
imports the application's connection module gets its own copy of it, so a config with a top-level `new
Pool()` opens a second pool that nothing closes.

**A load failure reports the underlying error.** The message is the config path, then the real
`Error.message` and `Error.cause`, never "failed to load config". And `ERR_MODULE_NOT_FOUND` gets one
extra sentence naming the `.js`-specifier case above, because that will be the most common failure and
the raw Node message does not explain it.

The default export is used if present, otherwise the named export `config`. Anything else — no export, two
exports, a promise that rejects — is an exit-2 usage error naming what was found.

## 5. `schema` globs are read through a project, and a miss is an error

A glob is a list of files; the reflector needs a `Program`. So `project` (default `./tsconfig.json`, the
same default and the same flag name `zmdb-codegen` already uses) names the tsconfig, the CLI opens one
compiler session over it, and `schema` selects from the files that project already includes.

**A glob that matches a file the project does not include is an error, not a silent skip.** The reflector
cannot read a declaration outside the program, so the alternative is a `generate` run that quietly emits a
migration missing three tables. The message names the file and the project.

This is also the answer to the docs page's other objection — that globs "mean the CLI has to load
TypeScript, which means a loader, which means a build-tool dependency in a project with zero runtime
dependencies". The compiler is already a **peer** dependency of `@zmdb/aot-validator`, and `zmdb-codegen`
already opens the consumer's project to do its work. The dependency the page is protecting against has
already been paid for, once, deliberately, and it is not a runtime one.

## 6. Fields that are not portable are refused, not ignored

`migrations.schema` names a Postgres schema. SQLite has no schemas and MySQL's are databases, so on
either dialect the field is an exit-2 usage error naming the dialect. Silently ignoring it is how a
consumer ends up believing the ledger lives somewhere it does not.

`migrations.table` defaults to `_zmdb_migrations`, which is currently a constant inlined into a
`CREATE TABLE IF NOT EXISTS` template in `@zmdb/query-compiler`'s migration runner. Making it
configurable is a change to that package, not to this one, and `../cli/SPEC.md` §4 records the other
change the same table needs — its `version` column is too narrow for the versions the CLI generates.

## 7. The application does not read this file

The docs page names the dilemma exactly: a CLI-only config means two sources of connection truth, and an
application that reads the config means zmdb acquires an initialisation step, "the thing its architecture
currently does without".

**Decision: the config is CLI-only.** The application keeps constructing its own driver and passing it,
and no zmdb API gains an implicit-config path. The mitigation for two sources of truth is that `driver` is
a thunk, so the config can delegate rather than duplicate:

```ts
// zmdb.config.ts
import { defineConfig } from 'zmdb/config';

export default defineConfig({
  schema: ['src/**/*.schema.ts'],
  dialect: 'postgres',
  driver: () => import('./src/db.ts').then(m => m.driver),
});
```

That is one source of connection truth with a four-line adapter, and it is the shape
`config-file.md`'s own "Doing it yourself" section already recommends writing. `driver` stays optional:
`generate`, `check`, `upgrade` and `export` never open a connection, and requiring one would make a
schema-only workflow need a database.

## 8. Non-goals (rejected)

- **One `ZmdbConfig` validated whole.** §1 — the validator refuses callable properties, and pretending
  otherwise would ship an `assert` that cannot be emitted.
- **`naming` as a `string | NamingStrategy` union.** §1.
- **`defineConfig` validating.** §1 — the boundary that reads the value is the one that checks it.
- **No discovery at all.** §2 — discovery with a package-boundary stop and a printed path answers the
  objection that motivated it.
- **A config cascade, a parent merge, or an env overlay.** §2.
- **Paths relative to the cwd.** §3.
- **A bundler, or a compile-to-temp step.** §4.
- **A zmdb-implemented alias resolver.** §4 — it would disagree with the consumer's editor.
- **Silently skipping a glob miss.** §5.
- **The application reading the config.** §7.
