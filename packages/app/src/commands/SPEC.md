# Command applications — Spec (epic "Scaffolding, CLI applications and the data browser")

> Part of `@zmdb/app`, exported as `./commands`. A command application is a module graph without a socket: `createCommandApp` is to `createApplication` what a terminal is to a request. The `zmdb`
> executable itself is a different thing entirely and lives in `zmdb`'s `src/cli/SPEC.md`.

## 1. The proposed surface cannot be written, and the reason is the decorator standard

The issue that opened this asks for:

```ts
@Command({ name: 'import-users', description: 'Load users from a CSV' })
class ImportUsers {
  constructor(private readonly users: UserRepository) {}
  async run(@Args() args: ImportArgs): Promise<number> {}
}
```

Three of those four lines are impossible in this project, and each one for a reason that is already load-bearing somewhere else.

**A parameter property is not erasable syntax.** `constructor(private readonly users: …)` needs a transform, and the whole point of the CLI's loading story is that it does not have one — Node strips
types, it does not transform them, which `zmdb`'s `src/config/SPEC.md` §4 states as a cost and which applies with full force to the file a command application lives in.

**There is no constructor injection at all.** `Constructor<T>` in `../di/index.ts` is `new () => T`, and `Container.build` is `withActiveContainer(this, () => new Ctor())` — zero arguments, by design.
Dependencies arrive through `@Inject` field decorators whose initialisers resolve from the active container. So a command injects exactly the way a controller does:

```ts
@Command({ name: 'import-users', description: 'Load users from a CSV' })
export class ImportUsers {
  @Inject(USERS) private readonly users!: BaseRepository<User>;
  async run(args: ImportArgs): Promise<void> {}
}
```

**There are no parameter decorators.** This project is on stage-3 decorators — `ClassFieldDecoratorContext`, `context.metadata`, and a `Symbol.metadata` polyfill in `../polyfill.ts` — and the stage-3
proposal has no parameter decorators. There are none anywhere in the app or web packages: `../../../web/src/routing/index.ts` has a class decorator and five method decorators and nothing else, and a
route handler receives **one** argument, the `Ctx` object the pipeline builds. `@Args()` would be the first parameter decorator in the project and would require turning on a different, older decorator
implementation for every consumer.

So `run(args)` takes its argument positionally, and `@Args` does not exist. `docs-site/content/web-cli-apps.md` asks for `@Option` metadata, which fails for the same reason and is also unnecessary —
§3 derives the option list from the args type instead of from decorators on it.

### 1.1 The AOT transform does not rescue any of the three

The fair objection to all of the above is that this project already rewrites TypeScript at build time, so a transform could desugar the parameter property, drop the parameter decorator and thread the
constructor arguments. Taken one at a time, the transform is powerless over the first, unnecessary for the second, and would have to become a different thing entirely for the third.

**`@Args()` fails before the transform can see the file.** With `experimentalDecorators: false` — which is what `tsconfig.json` sets, project-wide — the compiler answers a parameter decorator with
`error TS1206: Decorators are not valid here.` `transformFile` is handed a `ReflectSession`'s checker and source file, so it runs strictly downstream of that error, on a program the consumer's editor
is already reporting as broken.

The only fix is `experimentalDecorators: true` in every consumer's tsconfig, which does not add parameter decorators so much as swap the implementation out from under every decorator already in use —
`@Inject`, `@Get`, `@Module` — along with the `context.metadata` and `Symbol.metadata` polyfill they are built on. And it buys nothing: §3 gets the option list, the coercions and `--help` from
`toJsonSchema<A>()`, which is the AOT reading the args type.

The information a parameter decorator would have carried by hand is already derived, from the one place that cannot fall out of sync with the type.

**The parameter property is not blocked by the transform's ability — it is blocked by the transform being optional.** `tsc` desugars a parameter property perfectly well, so a command that is _built_
can already contain one; what cannot contain one is a command that is _stripped_, which is the loading story §8 is about.

The transformer is deliberately allowed to do nothing: it rewrites eight named call sites by text offset (`transformer.ts`'s `CALLEES`) and leaves alone any it cannot reach, and §8 depends on that
degradation being survivable — an untransformed `assert<A>` still reaches a runtime fallback that throws a sentence naming the problem. An undesugared parameter property is not a degraded path.

It is `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at module load, before any zmdb code runs, so the surface would only exist for consumers who run a bundler plugin — which is exactly the mandatory bundler
`zmdb`'s `src/config/SPEC.md` §4 rejects, for reasons that have nothing to do with commands.

**Constructor injection needs a token, and a transform can only see a type.** Passing arguments to `new Ctor()` is the mechanical part and `Container.build` could do it from a static list. The part no
transform can supply is what goes in the list. `@Inject(USERS)` names a **value** with identity, and `../di/SPEC.md` freezes that: "Tokens are explicit values", "no `emitDecoratorMetadata` / no
reflection".

From `constructor(users: UserRepository)` the transformer has a type and nothing else, and a type does not determine a token — a primary and a read replica are both `BaseRepository<User>` under two
different tokens, and that is a normal thing to register, not a corner case.

Making the type the key means a build-time registry mapping types to providers across the whole program, resolved by a tool the consumer may not be running: `emitDecoratorMetadata` with extra steps
and a worse failure mode.

There is also a blunter obstacle. The reflector refuses classes outright — `reflect/index.ts` answers a type with a method with `` `X` has a method (`m`); only data types can be checked `` — and a
repository is nothing but methods. The AOT reflects the shape of data crossing a boundary. A dependency graph is made of behaviour, so the one component that reads types cannot describe a single node
of it.

## 2. The surface

```ts
export interface CommandDef<A> {
  readonly name: string;
  readonly description: string;
  /** `toJsonSchema<A>()` — the option list, the coercions and `--help` all come from this (§3). */
  readonly args?: JsonSchemaObject;
  /** `assert<A>` — run after coercion (§3). */
  readonly validate?: (raw: unknown) => A;
  /** Positional parameter names, in order, for `--help` and for `args` (§4). */
  readonly positionals?: readonly string[];
}

export declare function Command<A>(def: CommandDef<A>): <T extends CommandClass<A>>(target: T, context: ClassDecoratorContext<T>) => void;

export type CommandClass<A> = abstract new () => { run(args: A): unknown };

export interface CommandApp extends AsyncDisposable {
  readonly container: Container;
  /** Parse, dispatch, and resolve to the process exit code. Never calls `process.exit`. */
  run(argv?: readonly string[]): Promise<number>;
  init(): Promise<void>;
}

export declare function createCommandApp(rootModule: ModuleClass): CommandApp;
```

`createCommandApp(rootModule: ModuleClass)`, not `rootModule: unknown` as proposed. `ModuleClass` is what `createApp` takes and what `compileModule` needs; `unknown` would accept a string and fail at
runtime for no gain.

`run` **returns** the exit code and never calls `process.exit`. The bin calls `process.exitCode = await app.run()`, which is what lets a test assert the exit code without a subprocess and lets
`await using` finish disposing — `process.exit` in the middle of an `AsyncDisposable` truncates the pool shutdown, which is precisely the hang `web-cli-apps.md` warns about, from the other end.

Passing `args`/`validate` as values rather than deriving them from a type argument is the pattern the HTTP package already uses: `../../../web/src/data/index.ts`'s `validateWith` and
`../../../web/src/dto-pipes/index.ts`'s `dtoChain({ decode, validate })` both take the validator as a function, because a decorator factory runs at class-definition time and cannot see a type argument
the AOT transform has to rewrite at its own call site.

## 3. `toJsonSchema<A>()` is the option list, and it has to be, because nothing else knows the types

Every value out of `parseArgs` is a `string`, a `boolean`, or an array of one of those. An args type with `readonly limit: number` therefore fails `assert` on the string `'100'` unless something
converts first — and the framework cannot know which fields are numbers without reflection, which this project does not do.

`toJsonSchema<A>()` answers exactly that question. It is one of the eight transform callees, it is happy with a plain interface (it does not require a `Table<'…'>` tag the way `schemaOf` does), and it
returns `{ type: 'object', properties, required }`. From that one value the framework derives all three of the things a decorator-based runner normally needs separate metadata for:

1. **The `parseArgs` options object** — one entry per property, `type: 'boolean'` for a boolean and `type: 'string'` for everything else, `multiple: true` for an array property.
2. **The coercion map** — which properties to run through `Number` before validating. `@zmdb/aot-validator`'s `coerce.number` from `./advanced` is that conversion and already throws a `TypeError` on
   `NaN`.
3. **`--help`** — the property names, and `required` to mark which are mandatory.

The order is **coerce, then validate**, which is the order `dtoChain` already uses for the wire boundary (`wireDecoder` before `validate`) and for the same reason: the coercion converts and does not
reject, so a `--limit abc` is reported by the validator against the declared type rather than surfacing as `NaN` inside the command.

Three consequences of using the document as the source, each of which will otherwise be found the hard way:

- **A `Sensitive` property is not an option.** `jsonSchemaFromShape` filters `column.sensitive` out of `properties`, so the command runner never registers a flag for it and `--token` is a usage error.
  The emitted document also erases the property's name, so the frozen `CommandDef` surface cannot produce an earlier registration error naming it. A secret does not belong in argv anyway — it belongs
  in the environment.
- **Nothing below the first level is described.** `toJsonSchema` is documented as having "no structure below the first level", so a nested object or a nested array in an args type is refused at
  registration. argv is flat; this costs nothing.
- **Properties come back sorted alphabetically**, because `jsonSchemaFromShape` sorts them. `--help` is therefore alphabetical, which is the right order for a flag list. Positionals are not, which is
  why they are a separate ordered array in `CommandDef` (§4) rather than being read out of the document.

A command with no `args` skips all of this. `parseArgs` runs in non-strict mode for it, and `run` receives the raw `{ values, positionals }`.

## 4. argv to DTO, with the conventions named individually

`parseArgs` from `node:util` does the parsing — a Node built-in, no dependency, and the thing both `web-cli.md` and `web-cli-apps.md` already recommend by name. The mapping rules, each of which has a
conventional meaning that is wrong to get wrong:

| Argv               | Becomes                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `--dry-run`        | `dryRun: true` — kebab-case flag, camelCase property, converted both ways      |
| `--no-dry-run`     | `dryRun: false` — `parseArgs`'s `allowNegative`, on for every boolean property |
| `--tag a --tag b`  | `tag: ['a', 'b']` — `multiple: true` when the property is an array             |
| `--tag a`          | `tag: ['a']` — an array property is always an array, never a bare string       |
| `--limit 100`      | `limit: 100` — coerced because the document says `number` (§3)                 |
| `import users.csv` | the first positional, bound to `positionals[0]`'s name                         |
| `-- --raw --flags` | `argv.passthrough`, never merged into the DTO                                  |

The kebab↔camel conversion is bidirectional and total: the option registered with `parseArgs` is the kebab-cased property name, the DTO key is the camelCase one, and `--help` prints the kebab form. A
property that is already kebab-case in the type is a compile-time impossibility worth ignoring, and one that contains a digit boundary (`v2Api`) converts to `--v2-api` and back deterministically.

Two details that are `parseArgs` facts rather than choices:

- **`allowNegative` is on for booleans and only booleans.** Verified against Node 26.8.1: `--no-dry-run` yields `false` for a `boolean` option. Enabling it for a string option would make `--no-file`
  mean `file: false`, which the declared type refuses one step later with a confusing message.
- **`--` does not separate itself.** With `allowPositionals`, everything after `--` lands in `positionals` alongside the real ones — `['pos1', 'raw', '--x']` for `pos1 -- raw --x`. Recovering the
  split requires `tokens: true` and slicing at the `option-terminator` token's index. So the framework always passes `tokens: true`, because the alternative is a passthrough that silently becomes a
  positional argument.

An unknown flag is a usage error: strict `parseArgs` throws `ERR_PARSE_ARGS_UNKNOWN_OPTION` and the framework reports it with the command's `--help` and **exit code 2**. That number is not chosen here
— it is the convention `zmdb-codegen` set and `zmdb`'s `src/cli/SPEC.md` §2 froze, and a command application that disagreed with the executable that scaffolded it would be gratuitous.

## 5. The exit code comes from the return value, with `void` meaning success

| `run` returns or throws | Exit code                             |
| ----------------------- | ------------------------------------- |
| `undefined` / `void`    | 0                                     |
| a `number`              | that number, floored into `0…255`     |
| `true` / `false`        | 0 / 1                                 |
| throws                  | 1, with the error's message on stderr |

`void` meaning 0 is the important row: the common command does its work and returns nothing, and requiring `return 0` is how a project ends up with commands that fall off the end and exit 0 by
accident and commands that return `undefined` and exit 1. Both spellings are explicit here.

A thrown error is 1, never 2, because 2 means "the invocation is wrong" and a command that got as far as running was invoked correctly. `--json` is not a framework concern for a command application:
the command owns its stdout, and imposing an envelope on it would be imposing an output format on somebody else's tool.

`web-cli-apps.md` is right that "a script that logs an error and exits 0 makes CI and cron think it succeeded", and the whole reason the framework owns the exit code is that this is the mistake it can
make structurally impossible.

## 6. Container binding extends `@Module` without a second registry

`compileModule` now builds `def.commands ?? []` through the same `Container` as controllers and exposes the instances on `CompiledModule.commands`. A class listed nowhere is never instantiated, and
constructing one directly would still make an `@Inject` initializer throw. Listing a command in `controllers` remains wrong: it would be treated as an HTTP route source.

`createApplication` drives one construction ledger containing value providers, factory results that were actually resolved, built controllers and built commands. A command whose construction resolves
a connection pool therefore records the pool before the command, and reverse shutdown stops the command first. No second lifecycle list or command-specific container exists.

Nothing else changes. The container is the same `Container`, the token is the same token, and `repositoryToken<T>` from `../data/index.ts` is how a command gets a repository — so a command and a
controller injecting the same repository get the same instance from the same singleton binding, which is the property that makes a command application worth having over a standalone script.

## 7. Dispatch, help, and disposal

`run(argv = process.argv.slice(2))` reads the first positional as the command name. No name, or `--help`, prints the command list with each `description`; an unknown name prints the list and exits 2.
A single registered command may be invoked with no name, which is what makes a one-command binary read like one.

`--help` after a command name prints that command's usage from its `args` document: the kebab-cased flags, which are required, and the positionals in declaration order. Help goes to stdout and exits
0, because `cmd --help | less` is how people read it; a usage _error_ goes to stderr and exits 2.

`CommandApp` is `AsyncDisposable` and the generated bin is:

```ts
await using app = createCommandApp(AppModule);
await app.init();
process.exitCode = await app.run();
```

`await using` rather than a `finally`, for the reason `web-cli-apps.md` puts first and best: without disposal the pool keeps the process alive after the work finishes, so the command hangs instead of
exiting. That is the single most common way a script like this is broken, and it is why the scaffold in `zmdb`'s `src/cli/SPEC.md` §13.1 generates this file rather than describing it.

## 8. The AOT transform is not optional here, and the failure is loud

A command application validates argv, which is external input, so its `assert` has to be real. Run under Node's type stripping the transform does not run, `assert<A>` is called with no witness, and
the fallback in `@zmdb/aot-validator`'s `./utilities` throws `runtime type witness required in test/fallback mode`.

The runtime must reject this input. This corrects `docs-site/content/web-cli-apps.md:127`, which says that "any `assert<T>()` in a script is permissive … otherwise your validation is decoration." The
assertion is not permissive. The page's advice to build the script instead of running it through type stripping remains correct. The generated `.spec.ts` includes a transformer canary so the failure
appears in tests rather than in the first production invocation.

The framework adds no check of its own. A canary that `createCommandApp` ran itself would be a validation call in a package that does not otherwise make one, and the throw from the real call site
names the real file.

## 9. Non-goals (rejected)

- **`@Args` as a parameter decorator.** §1 — stage-3 decorators have none, and this project has none.
- **`@Option` per-property decorators.** §1, §3 — the args document already carries the option list.
- **Constructor injection.** §1 — `Constructor<T>` is `new () => T`, and a parameter property does not survive type stripping.
- **A build-time transform that supplies either of them.** §1.1 — a parameter decorator is a compiler error upstream of the transform, and a constructor parameter's type is not a token.
- **`createCommandApp(rootModule: unknown)`.** §2 — `ModuleClass` is what `compileModule` needs.
- **`process.exit` inside `run`.** §2 — it truncates disposal, which is the hang this is meant to avoid.
- **A runtime parser or a hand-written argv schema.** §3, §4 — `toJsonSchema` and `parseArgs` between them need neither.
- **`allowNegative` for string options.** §4.
- **Merging `--` passthrough into the DTO.** §4.
- **A `--json` envelope imposed on a command's stdout.** §5 — the command owns its output.
- **Constructing unresolved providers to look for hooks.** §6 — provider lifecycle records only values and factory results that already exist; shutdown must not create a dependency just to stop it.
- **Listing a command in `controllers` to get it built.** §6 — it would register it as a route source.

## Package ownership amendment (#645)

Command applications are protocol-neutral and move to `@zmdb/app/commands`. `Command`, `CommandDef`, `CommandClass`, `CommandApp` and `createCommandApp` keep this contract but compile through
`createApplication`, not an HTTP `createApp`.

The move does not create the standalone project CLI package and does not add filesystem discovery. `@zmdb/web/cli` is deleted with no forwarder. Runtime error prefixes become `@zmdb/app` because that
is the sole declaration owner.
