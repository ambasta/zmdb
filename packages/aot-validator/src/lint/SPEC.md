# Lint Rules — Spec (epic "A lint plugin for the mistakes the type system cannot catch")

> Part of `@zmdb/aot-validator`, exported as `./lint` (§7). Loaded by a linter, never by an
> application, which is why it belongs in the build-time half of this package's export map.

## 1. The host, decided by one sentence in oxlint's own type definitions

`yarn lint` runs oxlint 1.81.0, and it does support plugins: `jsPlugins` takes a path to a plugin module,
and the plugin API is ESLint's — `create(context)`, `context.report`, `fix`, `suggest`, `meta.fixable`,
`meta.type`, all declared in `node_modules/oxlint/dist/plugins-dev.d.ts`. So the "oxlint or ESLint"
question mostly dissolves: one ESLint-shaped `{ meta, rules }` object loads in both, and TypeScript
plugin files are supported natively on Node ≥ 22.18 (this repo runs 26.8.1), so the rules can live in
`src/` as `.ts` alongside everything else.

What does not dissolve is this, verbatim from `plugins-dev.d.ts`:

> Parser services for the file.
>
> **Oxlint does not offer any parser services.**

`context.parserServices` is typed `Readonly<Record<string, unknown>>` and is empty. There is no
TypeScript program behind an oxlint JS plugin, so **no rule that has to resolve a declared type can run
under oxlint.** `--type-aware` does not change this: it turns on _built-in_ rules through the separate
`oxlint-tsgolint` package, and hands a JS plugin nothing.

And this repository has no ESLint at all — no dependency, no config, no invocation. So a type-aware rule
would ship in an artifact this project cannot execute, which collides head-on with §6's precision bar,
because that bar is measured by running the rules over this repository's own source.

**Decision: every shipped rule is syntactic.** Rules needing type information are named in §3 as needing
a host this project does not have, and are not written, not stubbed and not shipped disabled.

Two consequences of the alpha status. `jsPlugins` is documented as "in alpha and not subject to semver",
so the plugin pins an oxlint range rather than a caret, and the rule bodies stay inside the intersection
of the two hosts' APIs — no `parserServices`, and no `SourceCode` method whose behaviour differs between
them. Being wrong about that is a broken lint run for a consumer, not a broken build here.

## 2. `Rule` is already taken twice, so the exported type is `LintRule`

The issue proposing this asks for `export const rules: Record<string, Rule>`. `Rule` is spoken for:

- `../index.ts` — `export interface Rule { kind: string; args: readonly unknown[] }`, the argument of
  `validate(r: Rule, expr)`.
- `@zmdb/schema-core`'s `src/tags/index.ts` — `export type Rule<Name extends string>`, a tag.

A third `Rule` in the same package would make `import { Rule }` ambiguous by reading order for anyone who
touches both surfaces, and the two that exist are both older and both load-bearing. The exported type is
`LintRule`.

The plugin object's own shape is dictated by the hosts, not chosen: the default export is
`{ meta: { name, version }, rules: { … } }`, because that is what both loaders read. `rules` is a
property of that object, not a top-level export, so the name is fine there.

**`configs` cannot be one exported value for both hosts.** ESLint flat config consumes an array of config objects; oxlint reads `jsPlugins` plus a `rules` map out of JSON and cannot evaluate a JavaScript config object at all.

So the ESLint half is exported — `export const configs: { readonly recommended: unknown; readonly strict: unknown }` — and the oxlint half is a documented `.oxlintrc.json` snippet on the docs page. That is a real reduction in the API surface the issue proposed, and pretending otherwise would ship an export that one of the two hosts silently ignores.

## 3. The rule set

The docs page already publishes seven rule names; this issue names four. One rule appears in both lists
under two names — `no-interpolated-sql` (docs) and `no-sql-concatenation` (issue). The published name
wins, because it is already published and because it describes the mechanism rather than one spelling of
it: `'…' + v` and `` `…${v}` `` are the same bug, and the template form is the common one, which the word
"concatenation" reads as excluding.

| Rule                           | Detects                                             | Fix        | `recommended` | `strict` |
| ------------------------------ | --------------------------------------------------- | ---------- | ------------- | -------- |
| `no-distributed-nullable-tags` | `(T \| null) & Tag` on a table property             | autofix    | error         | error    |
| `no-unknown-json-column`       | `unknown` inside an intersection                    | suggestion | error         | error    |
| `no-interpolated-sql`          | a template literal with substitutions in a SQL sink | none       | error         | error    |
| `require-sql-on-number`        | a bare `number` on a table property                 | none       | warn          | error    |
| `no-unbounded-find`            | `find()` / `find({})`                               | none       | warn          | error    |
| `no-empty-patch`               | `update(id, {})`                                    | none       | warn          | error    |

### The diagnostic contract

The report node is part of the contract: RuleTester assertions use it to freeze both the start and end
location, rather than accepting a diagnostic that points at the whole declaration or call. Messages are
literal strings, not fragments.

| Rule                           | Exact message                                                                                     | Report node                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------ |
| `no-distributed-nullable-tags` | `Move null and undefined outside the tagged intersection; nullish values cannot carry zmdb tags.` | the outer `TSIntersectionType` |
| `no-unknown-json-column`       | `unknown & X collapses to X; use object & Sql<'json'> or declare the JSON shape.`                 | the `TSUnknownKeyword`         |
| `no-interpolated-sql`          | `Do not interpolate values into SQL text; use driver parameters.`                                 | the `TemplateLiteral`          |
| `require-sql-on-number`        | `A bare number is ambiguous; add Sql<'integer'> or Sql<'numeric'>.`                               | the `TSNumberKeyword`          |
| `no-unbounded-find`            | `find() and find({}) are unbounded; use list() with a page.`                                      | the `CallExpression`           |
| `no-empty-patch`               | `update(id, {}) performs no write; it reads and returns the matching row.`                        | the second `ObjectExpression`  |

`no-distributed-nullable-tags` fixes the outer intersection to a union whose nullish arm is bare.
`no-unknown-json-column` has no fix and offers one suggestion, exactly `Replace unknown with object`,
which replaces only the `TSUnknownKeyword`. The other four rules have neither a fix nor a suggestion.

### The three that ship as errors

**`no-distributed-nullable-tags`.** A `PropertySignature` inside a `TSInterfaceDeclaration` whose heritage
names `Table<…>`, whose annotation is a `TSIntersectionType` with a member that is a `TSUnionType`
containing `TSNullKeyword` or `TSUndefinedKeyword`. The fix rewrites it to a union of intersections with
the `null` arm left bare.

The fix is safe, and the reason is worth writing down rather than assuming: every tag in the vocabulary is an object type with one optional symbol slot, so `null & Tag` is `never`. The arm the fix stops tagging is uninhabitable before the fix, so no code can depend on it.

That reasoning is also the fix's precondition — it fires only when the union has exactly one `null`/`undefined` arm _and_ every other intersection member is a local binding for a known declaration-tag export from `@zmdb/schema-core/tags` or `zmdb/tags`. Those modules also export non-tag helpers such as `Nullable`, `NonNull`, `ColumnSqlType` and `RelationKind`; importing one of those does not satisfy the precondition.

Import tracking, not type resolution; `(A | B) & C` for arbitrary `A`, `B`, `C` is a real semantic change and the rule leaves it alone.

**`no-unknown-json-column`.** An intersection with a `TSUnknownKeyword` member. Reported with a
_suggestion_ rather than a fix, because `object` and `Record<string, …>` are both plausible replacements
and they are not equivalent — the rule offers `object` and does not apply it.

**`no-interpolated-sql`.** A `TemplateLiteral` with at least one expression, in a sink the rule can see without types: the `text` property of an object literal that also has a `parameters` property, and an argument to a call whose callee property is `execute`. The sibling property is the syntactic marker that separates a `CompiledQuery` from generic `{ start, end, text }` edit objects.

A template literal with no substitutions, and a plain string literal, are both fine — which is precisely what keeps the SQL-string features out of the rule. The expression-index tag this epic's sibling will add takes its SQL as a _type_ argument, and a type-level string literal cannot contain a substitution, so it can never trip this rule; a filter fragment written as a plain literal cannot either.

A `BinaryExpression` using `+` is outside this frozen detector, as is an interpolation assigned to a
variable before that variable reaches a sink. An interpolated filter fragment is reported only when it is
literally one of the two named sink shapes. The tests do not widen the rule beyond those AST shapes.

No fix: the correct rewrite invents a placeholder and moves the value into `params`, and the placeholder
spelling is dialect-dependent.

Its failure mode, stated because it will be observed: the sink is matched by _shape_, so an object literal
with both `text` and `parameters` is flagged wherever it goes — a true positive by intent, even if the
object never reaches a driver — and a template assigned to `text` through a variable two statements
earlier is missed. Under-reporting is the correct direction for a rule with no type information.

### The three that ship as warnings

**`require-sql-on-number`.** Precise only on a literal annotation and **defeated by a type alias**: `type Money = number & Sql<'numeric'>; price: Money` is correct code the rule does not report, while `type Qty = number; qty: Qty` is a mistake it also misses. Resolving either alias would require the parser services §1 rules out.

It remains a warning because it is an early, incomplete duplicate of a build error that already exists — `schemaOf<T>()` refuses a bare `number` because it spells both `integer` and `numeric` — so the rule's entire value is arrival time, under the cursor instead of in the build log. That is worth a warning and not worth an error.

**`no-unbounded-find`.** `find` with no argument or with an empty object literal. Whether the receiver is a
repository needs types, so this is a method-name match. `Array.prototype.find` takes a callback and never
`{}`, which is what keeps the noise low in practice — and "low in practice" is not the error bar.

**`no-empty-patch`.** See §4: the behaviour this rule was specified against does not exist.

### The four that do not ship, each for its own reason

**`no-truthiness-in-where-builder`** is `@typescript-eslint/strict-boolean-expressions`, which is
type-aware, better, and already recommended by name on the docs page. A syntactic imitation can only flag
every `if (x)` in a file that also builds a `where`, or nothing.

**`no-select-star-with-sensitive`** has to resolve a declared type to see a tag. §1.

**`no-find-by-id-without-key`** has to do the same, and more importantly it is a lint rule patching a hole in a type this project owns. `PrimaryKeyOf<T>` is `unknown` when the type declares no primary key (`@zmdb/schema-core`'s `src/derive/index.ts`), so `findById(anything)` type-checks and then throws `schema … has no primary key` at runtime from `@zmdb/repository`.

The fix belongs in the alias: that branch should yield a string literal naming the problem, so the compiler's own "Argument of type 'number' is not assignable to parameter of type '…'" reads as the diagnostic. Its test is a `*.type-test.ts` and its owner is the repository, not this plugin. The `[PrimaryKeyKeys<T>] extends [never]` guard the shipped alias already uses is the right shape — only the branch's value changes.

**`no-untransformed-schema-of`** — §5.

## 4. `no-empty-patch`: the behaviour the rule was specified against does not exist

The issue withholds the autofix because deleting the call "changes behaviour if the call was awaited for
its error". There is no error. `@zmdb/repository`'s `update` validates the patch, fires `preUpdate`, and
builds the keyed `where`; on an empty patch it **returns `this.firstMatching(where)`** — the same
single-row `SELECT` body `findById` uses after key validation. A write silently degrades to a read.

Three things follow.

The fix is still withheld, for a better reason: the call returns the row, so deleting it deletes a read
the caller may be using.

The case the rule catches — a literal `{}` — is the one nobody writes. The case that bites is a patch
assembled conditionally that comes out empty at runtime, and no syntactic rule can see it. So the rule is
a warning: it is a tidiness check, not a bug detector, and labelling it as one would misrepresent what it
found.

The bug detector belongs in the runtime. A write that quietly becomes a read is worth surfacing at the
call, and that is a decision for the repository package — named here so the epic does not mistake a lint
warning for having addressed it.

## 5. `no-untransformed-schema-of` reads nothing from disk, and does not ship

The issue offers two options — read `tsconfig`/`vite.config`/`zmdb.config` from disk, or a per-file
heuristic — and asks for one to be picked with its failure mode. Neither is shippable, for reasons
specific to this project:

- **There is no one file to read.** The transformer is wired through a bundler or test-runner integration,
  not through `compilerOptions.plugins` — this repo wires it in `vitest.config.ts`, and no `tsconfig.json`
  in the repository names a transform plugin at all. A consumer may wire it through vite, webpack, rollup,
  ts-patch, or none of those because they ran `zmdb-codegen`. A rule that reads `tsconfig.json` reports on
  a correctly configured project that configures it elsewhere — a false positive on working code, which
  §6 forbids outright.
- **`zmdb.config.ts` does not record transform installation.** Its loader and shape now exist, but the
  file names schema, dialect and tooling paths — not whether Vite, Rollup, webpack, ts-patch or
  `zmdb-codegen` performs the AOT rewrite. Reading it still cannot prove this rule's condition.
- **The heuristic reports on every project it cannot prove is configured**, which is all of them.

The clearest form of this check is not a lint rule. `schemaOf<T>()` already throws with a long explanatory
message when the transform did not run, and one line in a consumer's own test suite turns that into a
build failure. The docs page should say so. This is the "it cannot, so say so" answer step 1 asked for,
recorded rather than papered over with a rule that fires on correct code.

## 6. The precision bar is a shipping criterion, and the unit is the plugin

A rule ships in `recommended` at `error` only if it produces **zero findings on this repository's own
source**, except where a finding is a genuine bug. Anything less is `warn` in `recommended` and `error` in
`strict`.

The reason the bar is absolute rather than a percentage: a plugin that reports on correct code gets added
to an ignore list, and an ignore list is per-plugin, not per-rule. So the cost of one noisy error is not
one wrong report — it is the other five rules, silently. That is also why no rule ships off by default as a
compromise: a rule nobody enables has the same value as a rule nobody wrote, at a higher maintenance cost.

The implementation dogfood run reports nothing under `packages/`, `fixtures/`, `examples` or
`benchmarks/`. It excludes the deliberately invalid `.input.ts` samples. One exact file override disables
only `no-unknown-json-column` for `schema-core/src/json.type-test.ts`, whose compile-only assertion proves
that `unknown & Sql<'json'>` collapses to the tag; the other enabled rules still scan that file. Everything
else in those four trees is scanned. Rules 1–3 clear the bar.

Forcing all six rules to error over the same trees reports five deliberate test-only warning matches:
four repository specs that exercise `update(id, {})` and one populate spec that exercises unbounded
`find()`. It reports no additional shipped-source finding. Those exact matches are why the three
method-name/literal detectors remain warnings in `recommended` rather than pretending their signal is
error-grade.

### Repository integration

The root `.oxlintrc.json` loads this source entry as the `zmdb` plugin and enables all six
`recommended` severities. Oxlint loads plugins before a package build has created this source tree's
`.js` siblings, so `scripts/zmdb-lint-plugin.mjs` registers `scripts/ts-specifier-hook.mjs` and then
dynamically imports the TypeScript entry. That adapter makes both `yarn lint` and the direct
`npx oxlint` gate load the same rules. CI invokes `yarn lint` in its existing lint step, so dogfooding
adds rules to one parse and traversal rather than running a second linter.

`maxWarnings` remains zero. Exact overrides disable only the rule each deliberate sample exercises:
the two invalid rule fixtures, the compile-only `unknown & Sql<'json'>` proof, four empty-patch tests
across three files, and one unbounded populate test. Every other built-in and zmdb rule still reads
those files.

Measured on 2026-09-04 with seven warm local runs on the parent and current checkouts, median `yarn lint`
wall-clock time moved from 0.410 s to 0.768 s: +0.358 s (+87.3%). A one-line unoverridden
`repo.update(id, {})` probe exited 1 with `zmdb/no-empty-patch`; the complete repository exited 0.

The rules are tested with oxlint's own `RuleTester`, whose test cases are ESLint-shaped — deliberately, so
they port — and which exposes settable `describe` and `it` statics. Assigning vitest's to them puts the
rule tests in the ordinary suite with no second runner and no second reporter.

The rule tests import the lint entry normally and invoke RuleTester's registration callbacks immediately
inside each outer Vitest test. The parser, traversal, diagnostics, fix passes and suggestions are still
RuleTester's; there is no second lint harness.

No rule is autofixable unless its fix is behaviour-preserving on code that already type-checks. One rule
qualifies, one offers a suggestion, and the rest report. That ratio is the expected one for a plugin whose
subject is mistakes the type system cannot catch: if the fix were mechanical, the type usually could have
caught it.

## 7. Packaging: a `./lint` subpath, not a new package

The argument for a separate package is that a consumer gets the rules without the transformer.

That argument is already satisfied by a gate. `.github/scripts/verify-exports.mjs` partitions this package's subpaths into a runtime surface and a `BUILD_TIME_ENTRIES` set, on exactly this reasoning — a build-time entry must not be reachable from an application bundle, or a consumer ships a compiler to a browser.

A lint plugin is loaded by a linter and never by an application, so `./lint` joins that set and the isolation the separate package would buy is enforced by CI instead of by a `package.json`.

`package.json` exports `"./lint": "./src/lint/index.ts"`, which
`it('declares every export as a source path the build mirrors', …)` in `../plugin/packaging.spec.ts`
covers; the build-time export assertion names the subpath explicitly, and the import-graph gate rejects
any path from that entry to `typescript`, which keeps the rules independent of the transformer/compiler
runtime.

Against the new package: one more artifact to version, publish and changelog, for rules that are a few
hundred lines and share this package's vocabulary.

What the subpath costs, priced and accepted: a consumer who wants only the rules installs the whole
package. It is one `devDependencies` entry, and the rules do not import the compiler — which is not a
promise, it is the gate above.

## 8. What the docs page has to change

`docs-site/content/lint-rules.md` remains `status: 'todo'` and is owned by its own `[Docs]` sub-issue.
The implementation slice corrects only present-tense claims made false by the shipped subpath; that
sub-issue still owns the complete setup and rule reference, including these decisions:

- "An `@zmdb/eslint-plugin` package" — §7 is a `./lint` subpath, and §1 makes oxlint the first host rather
  than the fallback.
- It lists `no-truthiness-in-where-builder` among the rules worth having; §3 does not ship it, and the
  page's own "What you can enforce today" section already contains the better answer two headings later.
- It does not say that two of its seven rules describe mistakes the reflector already refuses at build
  time — the distribution trap and `unknown & X` both have named diagnostics in `../reflect/index.ts`.
  That is the difference between "zmdb cannot catch this" and "zmdb catches this later than you would
  like", and only the second one is true.

## 9. Non-goals (rejected)

- **Type-aware rules.** §1. Not written, not stubbed, not shipped disabled.
- **A third `Rule` type.** §2.
- **One `configs` value serving both hosts.** §2 — the hosts do not read the same thing.
- **`no-truthiness-in-where-builder`.** §3 — an existing type-aware rule does it properly.
- **`no-find-by-id-without-key`.** §3 — fix the type, not the linter.
- **`no-untransformed-schema-of`.** §5 — it cannot be made precise, and the runtime already refuses.
- **An autofix that changes behaviour.** §6.
- **A separate `@zmdb/eslint-plugin` package.** §7.
- **Rules encoding this repository's own discipline** — no `any`, no `as`, no suppressions, no
  `new Function`. That is library discipline, as the docs page already says, and shipping it as a
  consumer recommendation would be the fastest way onto an ignore list.
