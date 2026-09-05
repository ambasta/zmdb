# Dialects — Spec (epic "The SQL dialect matrix — SQL Server, CockroachDB and SingleStore")

> `Dialect` grows from three members to six over the epic. The #507 mechanism lives in `index.ts`, and
> SQL Server landed in #508 while #509 ships CockroachDB and SingleStore as
> parented variants. The mechanism decision and what it costs are in
> `../../SPEC.md` §5e.

## 1. The inventory, and the number it produced

This is the pre-mechanism inventory measured by the spec freeze. At that point the count of every
`switch (dialect)` in the compiler was **zero**: each listed decision was an inline comparison against a
string literal. That changed the mechanism decision, because a comparison and an exhaustive switch fail
differently when the union grows: the switch stops compiling, while `dialect === 'mysql'` silently takes
the other branch.

Fourteen comparisons, in seven files:

| Site                            | Decision at the freeze                                          | Trait it becomes |
| ------------------------------- | --------------------------------------------------------------- | ---------------- |
| `../quoting.ts:11`              | `mysql` gets backticks, everyone else double quotes             | `quote`          |
| `../quoting.ts:73`              | `postgres` gets `$n`, everyone else `?`                         | `placeholder`    |
| `../set-ops/index.ts:26`        | `postgres` renumbers placeholders across fragments              | `placeholder`    |
| `../index.ts:227`               | `VALUES(col)` on `mysql`, `EXCLUDED.col` elsewhere              | `upsert`         |
| `../index.ts:269`               | `INSERT IGNORE` versus `ON CONFLICT DO NOTHING`                 | `upsert`         |
| `../index.ts:294`               | `ON DUPLICATE KEY UPDATE` versus `ON CONFLICT DO UPDATE`        | `upsert`         |
| `../migrations/index.ts:207`    | a `varchar` with no length degrades to `TEXT` on `mysql`        | `types`          |
| `../migrations/index.ts:215`    | `serial` is `INT AUTO_INCREMENT` on `mysql`                     | `types`          |
| `../schema-objects/index.ts:37` | materialized view refused off `postgres`                        | `features`       |
| `../schema-objects/index.ts:44` | materialized view drop refused off `postgres`                   | `features`       |
| `../schema-objects/index.ts:92` | `ENABLE ROW LEVEL SECURITY` refused off `postgres`              | `features`       |
| `../schema-objects/index.ts:96` | `CREATE POLICY` refused off `postgres`                          | `features`       |
| `../fts/index.ts:68`            | `sqlite` joins a companion table, and refuses without one       | `fts`            |
| `../fts/index.ts:113`           | `to_tsvector … @@` on `postgres`, `MATCH … AGAINST` on the rest | `fts`            |

Two dialect-keyed tables: `DDL_TYPES` (`../migrations/index.ts:145`) and `DIALECT_PARAM_LIMITS`
(`../index.ts:39`).

And — the part the inventory was not looking for and the reason it was worth doing — **eight places that
emit dialect-specific SQL with no branch at all.** These are not divergences waiting to be extended. They
are one dialect's grammar shipped as if it were universal:

| Site                            | Emits unconditionally                       | Already wrong on                       |
| ------------------------------- | ------------------------------------------- | -------------------------------------- |
| `../clauses.ts:178`             | `` ` LIMIT n` ``                            | nothing yet; `mssql` has no `LIMIT`    |
| `../clauses.ts:179`             | `` ` OFFSET n` `` with no preceding `LIMIT` | **`mysql` and `sqlite`, today** (§3.3) |
| `../index.ts:196`               | `` ` RETURNING …` ``                        | `mysql`, which has no `RETURNING`      |
| `../migrations/index.ts:253`    | `ALTER COLUMN c TYPE t`                     | `mysql`, which spells it `MODIFY`      |
| `../migrations/index.ts:262`    | `CREATE TABLE t ()` as the down of a drop   | `mysql`, `sqlite`, `mssql`             |
| `../schema-objects/index.ts:58` | `CREATE SEQUENCE … START … INCREMENT`       | `mysql` and `sqlite` have no sequences |
| `../schema-objects/index.ts:73` | `GENERATED ALWAYS AS (…) STORED`            | `mssql` spells it `AS (…) PERSISTED`   |
| `../schema-objects/index.ts:23` | a partial index's `WHERE`                   | `mysql`, which has no filtered index   |

So the real inventory is **fourteen comparisons, two tables, and eight ungated emitters — twenty-four
sites**, and the accurate reading is that the compiler is less dialect-aware than its three-member union
suggests rather than more.

### 1.1 The number that actually decides the mechanism

At the freeze, adding three members to `Dialect` made exactly **three** files stop compiling: `DDL_TYPES`,
`DIALECT_PARAM_LIMITS`, and `../../../zmdb/src/three-types.spec.ts:67`, whose expectation table is a
`Readonly<Record<Dialect, string>>`. Every one of the other twenty-one sites kept compiling and quietly
produces Postgres SQL for SQL Server.

That is the failure the epic names in its architecture constraints — "a partially implemented dialect is
worse than an absent one: it type-checks and then produces wrong SQL" — and it is measurable: **three of
twenty-four sites are protected.** The mechanism's job is not elegance. It is to move the other twenty-one
into a table where a missing entry is a compile error, which is the only reason to do the refactor at all.

## 2. The mechanism: a traits record with an optional parent, resolved once

```ts
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'cockroach' | 'singlestore';

export type PlaceholderStyle = 'numbered' | 'positional' | 'named';

export type DialectFeature =
  | 'materializedView'
  | 'rowLevelSecurity'
  | 'sequences'
  | 'schemas'
  | 'partialIndex'
  | 'generatedColumns'
  | 'transactionalDdl'
  | 'foreignKeys';

export interface PaginationTail {
  readonly limit?: number;
  readonly offset?: number;
  /** Whether the statement already carries an ORDER BY. SQL Server's grammar needs it (§3.3). */
  readonly ordered: boolean;
}

export interface DialectTraits {
  readonly parent?: Dialect;
  readonly placeholder?: PlaceholderStyle;
  /** The open/close pair. The closing character escapes by doubling, on every dialect (§2.1). */
  readonly quote?: readonly [open: string, close: string];
  readonly paginate?: (tail: PaginationTail) => string;
  readonly returning?: 'suffix' | 'output' | 'none';
  readonly upsert?: 'onConflict' | 'onDuplicateKey' | 'merge' | 'none';
  readonly fts?: 'tsvector' | 'match' | 'companionTable' | 'none';
  readonly concat?: 'operator' | 'function';
  readonly booleanNot?: 'not' | 'bitwise';
  readonly types?: Readonly<Record<string, string>>;
  readonly features?: Readonly<Partial<Record<DialectFeature, boolean>>>;
  readonly paramLimit?: number;
  /** Driver error codes a unit of work may be retried on (§4.5). */
  readonly retryableCodes?: readonly string[];
}

/** Every dialect has an entry. A three-line entry is the point of `parent`, not a shortcut. */
export const DIALECTS: Readonly<Record<Dialect, DialectTraits>>;

export type ResolvedTraits = Omit<Required<DialectTraits>, 'parent'> & {
  readonly family: 'postgres' | 'mysql' | 'sqlite' | 'mssql';
  readonly features: Readonly<Record<DialectFeature, boolean>>;
};

/** Merged once at module load. Indexed, never walked. */
export const TRAITS: Readonly<Record<Dialect, ResolvedTraits>>;
```

The implementation strengthens the sketch at the type boundary: an entry with no `parent` must provide
every scalar trait, every feature and a complete `DialectTypeMap`; only an entry with an explicit parent may
provide partial overrides. That is what makes a missing root type mapping a compile error while still
allowing CockroachDB and SingleStore to inherit most of their maps.

`family` records the resolved root once. Non-trait grammar that genuinely
follows the wire family — telemetry names, introspection dispatch and existing
MySQL/Postgres migration forms — reads it instead of repeating literal
comparisons that would send a variant down the wrong fallback branch.

Five deliberate differences from the sketch in the sub-issue, each because the sketch does not survive
contact with the code:

**`quote` is a character pair, not a function.** All four quoting styles in the matrix turn out to be the same rule: wrap in the pair, and escape the closing character by doubling it.

Postgres and SQLite double `"`, MySQL doubles the backtick, SQL Server doubles `]`. `../quoting.ts` collapses to one implementation reading a pair from the table, and `quoteColumn` and `quoteTable`, which only split on `.` and scan for `AS`, need no dialect knowledge at all beyond it.

A `quote: (id: string) => string` per dialect would be four copies of one escape loop, which is four chances to get the escape wrong in a function whose entire purpose is preventing injection.

**`placeholder` is a style, not a formatter.** A formatter answers "what does parameter 3 look like" and that is not the only question asked: `../set-ops/index.ts:26` has to _renumber_ placeholders when it concatenates fragments, and `renumberPlaceholders` at `../quoting.ts:84` hard-codes `/\$(\d+)/g`. With a formatter, `mssql` gets correct placeholders in a single statement and duplicate `@p1`s across a `UNION`.

The style drives both — the pattern to match and the text to emit — so `renumberPlaceholders` gains a `dialect` parameter and the `postgres` check at `set-ops/index.ts:26` becomes `TRAITS[dialect].placeholder !== 'positional'`.

**`paginate` takes the whole tail, including whether the query is ordered.** The sketch's
`(limit?, offset?) => string` cannot express SQL Server's grammar, which is the divergence most likely to
be discovered in production (§3.3).

**`types` is a local `DialectTypeMap`, not an imported `SqlType` map.** `SqlType` lives in `@zmdb/schema-core` and this package deliberately has no dependencies, so the runtime module does not import it.

The implementation closes the type-level gap without crossing that boundary: each root mapping satisfies the local `DialectTypeMap`, and `../../../repository/src/dialect-types.type-test.ts` — in a package that already depends on both sides — proves `DialectSqlType` and `SqlType` are exactly equal. A missing mapping or a new schema type therefore breaks typecheck, while §7's runtime matrix independently checks the resolved maps.

The migration emitter widens that complete map only at the lookup of a hand-written unknown type, where the existing passthrough remains intentional.

**`features` is `Partial` on the way in and total on the way out.** An entry declares only what it differs
from its parent on; resolution fills the rest. A total `Record<DialectFeature, boolean>` in every entry
would mean six copies of nine booleans, and the fifth one to be added would be wrong.

### 2.1 Resolution is a module-level merge, because `Dialect` is not only a compiler argument

`createQueryCompiler(dialect)` is not the only door. `quoteIdentifier`, `ddlType`, `emitUp`, `emitDown`,
`setOperation`, `createIndexDdl`, `createViewDdl`, `enableRlsDdl`, `ftsSelectFrom`, `joinableSelectFrom` and
`aggregateSelectFrom` are all exported and all take a `Dialect` string rather than a compiler instance, and
`@zmdb/repository` calls several of them that way — its IN-list chunkers index
`DIALECT_PARAM_LIMITS[this.dialect]` directly.

So "merge the parent chain once at construction" is only true of the builders, and the other half of the
package would merge per call. Instead `TRAITS` is built once when the module is first evaluated and frozen,
and every site indexes it. That satisfies the epic's cost model — dialect dispatch is a property read, not a
walk — without changing a single exported signature except `renumberPlaceholders`, which gains a dialect.

Two consequences are easy to miss:

- **A cycle in `parent` is a load-time throw, not a stack overflow.** Every entry is resolved eagerly:
  three in #507, six when the epic is complete.
- **A missing entry cannot be filled in later.** `ddlType` keeps its unknown-type passthrough for a
  hand-written snapshot, but the repository's old `DIALECT_PARAM_LIMITS[…] ?? 1000` defences are gone:
  `TRAITS` is eager and total, so every `Dialect` has a real limit before any repository is constructed.

### 2.2 Cost of the full epic

The #507 mechanism moves the inventoried behavior behind the table without changing a shipped SQL string.
The later dialect slices supply the new values and the SQL corrections described below:

- `../quoting.ts` is rewritten around the pair, and `renumberPlaceholders` takes a dialect — every caller of
  which is in this package.
- `../clauses.ts` delegates its tail to `TRAITS[d].paginate`; the shipped entries deliberately reproduce
  the old `LIMIT`/`OFFSET` strings byte for byte. The MySQL/SQLite offset correction is the golden change
  described in §3.3, not part of the mechanism-only slice.
- `../index.ts` dispatches returning and upsert through traits. SQL Server's #508 slice supplies the
  named-part assembly required for middle-position `OUTPUT` and `MERGE` (§3.4–§3.5).
- `../migrations/index.ts` reads the resolved type map, and `../schema-objects/index.ts` reads total feature
  flags. The shipped flags preserve current behavior; dialect-specific corrections land with the dialects
  whose matrix rows require them.
- The `Record<Dialect, …>` shape kept everywhere and never widened to `Partial`, since it is the only
  compile-time lever in the package (§1.1).

The alternative — three more members and twenty-one more comparisons — costs less this week and produces a
compiler where adding the seventh dialect means auditing twenty-four sites by hand for the second time. The
traits record is chosen; the inventoried dispatch sites move behind it.

## 3. SQL Server (`mssql`)

No parent. SQL Server shares no ancestor with the other five, and giving it one to save two lines would mean
inheriting a default that is wrong and having to remember to override it.

```ts
mssql: {
  placeholder: 'named',
  quote: ['[', ']'],
  returning: 'output',
  upsert: 'merge',
  fts: 'none',
  concat: 'function',
  booleanNot: 'bitwise',
  paginate: mssqlPaginate,
  paramLimit: 2000,
  types: MSSQL_TYPES,
  features: {
    materializedView: false, rowLevelSecurity: false,
    sequences: true, schemas: true, partialIndex: true,
    generatedColumns: true, transactionalDdl: true, foreignKeys: true,
  },
  retryableCodes: ['1205'],
}
```

`paramLimit: 2000` is not a rounded guess: T-SQL's hard ceiling is 2100 parameters per batch, an order of
magnitude below the 60 000 the other dialects get, so the IN-list chunking at
`../../../repository/src/index.ts:282` becomes load-bearing rather than theoretical on this dialect. 2000
leaves the same proportional headroom the existing entries do.

### 3.1 Quoting

```
"users"        →  [users]
"select"       →  [select]
a "b" c        →  [a "b" c]         double quotes are ordinary characters inside brackets
weird]name     →  [weird]]name]     the closing bracket doubles
users.id       →  [users].[id]      each segment, as today
users AS u     →  [users] AS [u]
```

`QUOTED_IDENTIFIER` is on by default in every modern client, so `"x"` would also work — and is not used,
because it makes a string literal and an identifier differ by one server setting.

### 3.2 Placeholders

`@p1`, `@p2`, … one-based, in the same order the other dialects number. The `mssql` driver binds by name, so
the driver adapter maps the positional `parameters` array onto `p1…pn`; the compiler's contract that
`parameters` is "positional, in placeholder order" (`../../SPEC.md` §1) is unchanged and does the work.

```
selectFrom('users').where('email','=','a@b.com').orderBy('createdAt','desc').limit(10)
=> SELECT * FROM [users] WHERE [email] = @p1 ORDER BY [createdAt] DESC OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY
   parameters: ['a@b.com']
```

Across a set operation the numbering continues, which is the bug §2 exists to prevent:

```
union([q1, q2])   q1 has one parameter, q2 has one
=> SELECT * FROM [a] WHERE [x] = @p1 UNION SELECT * FROM [b] WHERE [y] = @p2
   parameters: [1, 2]
```

### 3.3 Pagination, the `ORDER BY` requirement, and a bug in two shipped dialects

T-SQL has no `LIMIT`. The form is a suffix of `ORDER BY`, and the grammar will not accept it without one:

```
.limit(10)              ORDER BY … OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY
.offset(20)             ORDER BY … OFFSET 20 ROWS
.limit(10).offset(20)   ORDER BY … OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY
neither                 ''
```

`OFFSET 0 ROWS` is emitted for a bare limit rather than special-cased, because one shape with a zero in it
is easier to read in a golden file than two shapes.

**A paginated query with no ordering is refused, not repaired.** The idiom exists — `ORDER BY (SELECT NULL)`
is legal and is what hand-written T-SQL does — and it is rejected here. A `LIMIT` without an `ORDER BY` is
already a latent bug on the original three dialects: the server may return any rows it likes, so page two can
repeat a row from page one, and nothing tells the author. SQL Server is the only dialect whose grammar
notices. Spending that on a synthesised clause buys a query that runs and keeps the bug; refusing costs one
error and names the fix:

```
UnsupportedFeatureError(
  'pagination without ORDER BY', 'mssql',
  'Dialect "mssql" spells LIMIT as OFFSET … FETCH NEXT, which SQL Server allows only after an ORDER BY. ' +
  'Add .orderBy(...) — an unordered page is not reproducible on any dialect.',
)
```

The refusal happens in `compile()`, which is a pure function, so the test for it costs exactly what a golden
SQL test costs (§6).

`TOP` is never emitted. It cannot express an offset, it is a prefix rather than a suffix so it would need a
second assembly path through the select builder, and having two pagination spellings for one dialect means
every future reader has to work out which one applies.

Writing the trait exposed a real defect in two shipped dialects. `tailClause` at `../clauses.ts:179` appends
`` ` OFFSET n` `` whether or not a `LIMIT` preceded it, and only Postgres accepts that. SQLite's grammar is
`LIMIT expr [OFFSET expr]` and MySQL's is the same shape, so `.offset(20)` with no `.limit()` has been
emitting a syntax error on two of the three dialects since the clause was written. The traits table makes it
visible because the branch has to be written down somewhere:

| Dialect    | `.offset(20)` alone                                    |
| ---------- | ------------------------------------------------------ |
| `postgres` | `OFFSET 20`                                            |
| `sqlite`   | `LIMIT -1 OFFSET 20` — the documented "no limit" idiom |
| `mysql`    | `LIMIT 18446744073709551615 OFFSET 20` — likewise      |
| `mssql`    | `OFFSET 20 ROWS`, and an `ORDER BY` is required        |

That is a change in emitted SQL for two existing dialects, so it belongs to this epic as a golden-test
change with its own line in the matrix, not as a quiet fix inside the mechanism slice.

### 3.4 `OUTPUT` is not a suffix, which is why the builders have to be taken apart

`returningClause` is appended: `text += returningClause(d, ret)` at `../index.ts:299`. `OUTPUT` sits in the
middle of the statement, and in a different middle for each verb:

```
INSERT INTO [users] ([email], [role]) OUTPUT INSERTED.[id] VALUES (@p1, @p2)
UPDATE [users] SET [role] = @p1 OUTPUT INSERTED.[id] WHERE [id] = @p2
DELETE FROM [users] OUTPUT DELETED.[id] WHERE [id] = @p1
```

| Verb     | Position                               | Pseudo-table |
| -------- | -------------------------------------- | ------------ |
| `INSERT` | after the column list, before `VALUES` | `INSERTED`   |
| `UPDATE` | after `SET`, before `WHERE`            | `INSERTED`   |
| `DELETE` | after the table, before `WHERE`        | `DELETED`    |

`RETURNING *` becomes `OUTPUT INSERTED.*`, and `DELETED.*` for a delete — the mapping is per verb, not per
column, and `UPDATE` returning the _old_ row is not expressible through `returning()` and is not being added
(§10).

So `makeInsert`, `makeUpdate` and `makeDelete` build their SQL from named parts and a `returning` trait
decides where the clause lands, with `'none'` for a dialect that has neither. `mysql` gets `'none'` and
therefore acquires its first refusal for `returning()`, which today it accepts and emits invalid SQL for.

One limitation is the server's and is documented rather than worked around: **`OUTPUT` without `INTO` is rejected on a table with an enabled trigger.** The compiler cannot know about triggers, so this is a genuine "fails at the server" case in a spec that otherwise forbids them.

The correct handling is a named entry in the dialect page and a `Non-goal`: `OUTPUT … INTO @table` needs a table variable, a `DECLARE`, and a second statement, and `../../SPEC.md` §5d froze `text` as exactly one statement for the cursor wrapper's sake.

### 3.5 `MERGE`, its lock hint, and the one semicolon in the package

T-SQL has no `ON CONFLICT`. `upsert: 'merge'`:

```
insertInto('users').values({ email: 'a@b.com', role: 'user' })
  .onConflict('email').doUpdate(['role'])

MERGE [users] WITH (HOLDLOCK) AS tgt
USING (VALUES (@p1, @p2)) AS src ([email], [role]) ON tgt.[email] = src.[email]
WHEN MATCHED THEN UPDATE SET [role] = src.[role]
WHEN NOT MATCHED THEN INSERT ([email], [role]) VALUES (src.[email], src.[role]);
parameters: ['a@b.com', 'user']
```

```
… .onConflict('email').doNothing()

MERGE [users] WITH (HOLDLOCK) AS tgt
USING (VALUES (@p1, @p2)) AS src ([email], [role]) ON tgt.[email] = src.[email]
WHEN NOT MATCHED THEN INSERT ([email], [role]) VALUES (src.[email], src.[role]);
```

Four decisions in that SQL, all of them the kind that is expensive to change later:

**`WITH (HOLDLOCK)` is not optional.** A bare `MERGE` takes an update lock on the matching key but nothing on the _absent_ key, so two concurrent upserts of the same new row both fall to `WHEN NOT MATCHED` and the second one violates the unique index. That is precisely the race the user reached for an upsert to avoid.

`HOLDLOCK` (serializable, on the target only) closes it at the cost of range locks, and shipping the fast racy version with a warning in prose would be shipping the bug.

**`src` is a `VALUES` row constructor, not a `SELECT`.** It keeps the parameters positional and in
placeholder order, which the whole package's contract depends on.

**The statement ends with a semicolon**, and it is the only statement in this package that does — `MERGE`
requires one. `../../SPEC.md` §5d froze "no trailing semicolon" as load-bearing because the streaming driver
embeds `text` in `DECLARE <name> CURSOR FOR <text>`. That invariant is narrowed here rather than broken: a
cursor wraps a `SELECT`, an upsert is not a `SELECT`, and no cursor ever sees this text. §5e records the
narrowing so the next reader of §5d finds it.

**A conflict target is mandatory on this dialect.** `onConflict()` with no argument relies on the server
inferring an arbiter index, which Postgres and SQLite do and `MERGE`'s `ON` predicate cannot:

```
UnsupportedFeatureError('upsert without a conflict target', 'mssql',
  'MERGE needs an explicit join predicate; pass the conflicting column(s) to onConflict(...).')
```

`MERGE`'s reputation is earned — filtered-index bugs, `OUTPUT` interactions and deadlock patterns are all
documented by Microsoft — and it is used anyway because the alternative is an `IF EXISTS`/`UPDATE`/`INSERT`
sequence, which is three statements where §5d froze one, and racy in a way `HOLDLOCK` cannot fix.

### 3.6 Types

All ten `SqlType` members, because nine is how a dialect half-ships:

| `SqlType`   | `mssql`             | Why not the obvious one                                                     |
| ----------- | ------------------- | --------------------------------------------------------------------------- |
| `serial`    | `INT IDENTITY(1,1)` | fits `columnDdl`'s `type` slot exactly as MySQL's `INT AUTO_INCREMENT` does |
| `integer`   | `INT`               |                                                                             |
| `bigint`    | `BIGINT`            |                                                                             |
| `numeric`   | `DECIMAL`           | `NUMERIC` is a synonym; `DECIMAL` matches the MySQL entry                   |
| `text`      | `NVARCHAR(MAX)`     | `TEXT` is deprecated and unusable with several string functions             |
| `varchar`   | `NVARCHAR`          | with `Length<N>`: `NVARCHAR(N)`; without: `NVARCHAR(MAX)` (§3.7)            |
| `boolean`   | `BIT`               |                                                                             |
| `timestamp` | `DATETIMEOFFSET(3)` | see below                                                                   |
| `json`      | `NVARCHAR(MAX)`     | SQL Server has no JSON column type; `JSON_VALUE` reads nvarchar             |
| `jsonEnum`  | `NVARCHAR(MAX)`     | matches the other three, all of which use their widest text type            |

`timestamp` is `DATETIMEOFFSET(3)` and **not `DATETIME2`**, which is what `docs-site/content/dialect-mssql.md:20` and the epic body both name. The rule this table follows was set by the Postgres entry and written into the comment above it at `../migrations/index.ts:154`: a `timestamp` column gets the dialect's zone-aware type where one with a usable range exists. Postgres gets `TIMESTAMPTZ` for that reason and MySQL gets `DATETIME(3)` only because its `TIMESTAMP` converts to the session zone and stops in 2038.

SQL Server has `DATETIMEOFFSET`, which keeps the offset and has the full range, so choosing `DATETIME2` would be choosing to forget the offset on the one dialect that can store it. `(3)` is milliseconds, which is the precision a JavaScript `Date` carries; the driver returns a `Date` either way.

`UNIQUEIDENTIFIER` appears nowhere in the table and cannot, because `SqlType` has no `uuid` member
(`../../../schema-core/src/index.ts:21`). A GUID column is declared `Sql<'varchar'>` with `Length<36>` and
filled by the application or a hand-written default, exactly as `dialect-cockroach.md:28` already
recommends for Cockroach. Adding a `uuid` member to `SqlType` is a schema-core change belonging to a
different epic, and doing it inside a dialect table would give one dialect a column type the others cannot
spell.

### 3.7 DDL and migrations

```
create_table        CREATE TABLE [events] ([at] DATETIMEOFFSET(3) NOT NULL, [id] INT IDENTITY(1,1) PRIMARY KEY, [name] NVARCHAR(MAX) NOT NULL)
drop_table          DROP TABLE [events]
add_column          ALTER TABLE [events] ADD [note] NVARCHAR(MAX)
drop_column         ALTER TABLE [events] DROP COLUMN [note]
alter_column_type   ALTER TABLE [events] ALTER COLUMN [note] NVARCHAR(MAX) NOT NULL
```

Three divergences in five ops, and the first two are shared with dialects that already ship:

- **`ADD`, not `ADD COLUMN`.** T-SQL rejects the keyword. `../migrations/index.ts:249` emits it
  unconditionally, so this becomes a trait on the op emitter.
- **`ALTER COLUMN [c] <type> NULL|NOT NULL` with no `TYPE` keyword.** SQL Server requires nullability to
  be restated: omitting it turns an existing `NOT NULL` column nullable. Generated `alter_column_type`
  operations therefore carry both the old and new nullability so `up` and `down` preserve the schema; a
  hand-built SQL Server operation without that metadata is refused. `../migrations/index.ts:253` emits the Postgres
  spelling for all dialects; MySQL wants `MODIFY COLUMN [c] <type>`; T-SQL wants the same words as Postgres
  minus one. This ungated site has been wrong for MySQL all along and is fixed here rather than in a
  separate issue, because the traits table has nowhere to put "wrong for one dialect".
- **`emitDown` of a `drop_table` is `CREATE TABLE t ()`**, and an empty column list is a syntax error
  outside Postgres. The `down` of a dropped table cannot be reconstructed from a `ChangeOp` — the columns
  are gone — so the correct behaviour on every dialect is to emit a comment and refuse to run, which is what
  `../migrations/SPEC.md` §4's `-- zmdb:down` sentinel already provides a place for. Named here because the
  matrix in §7 would otherwise need an `mssql` expectation for a statement that should not exist.

`varchar` with no `Length<N>`: `NVARCHAR` alone defaults to one character in a DDL context, which is worse
than either alternative, so it degrades to `NVARCHAR(MAX)` — the same degradation MySQL already does at
`../migrations/index.ts:207`, for the same reason, in the same place.

Sequences exist (`CREATE SEQUENCE … START WITH n INCREMENT BY n`, with `WITH` and `BY` where Postgres has
neither), generated columns are `AS (expr) PERSISTED` rather than `GENERATED ALWAYS AS (expr) STORED`, and
filtered indexes work unchanged. All three currently emit the Postgres spelling for every dialect.

### 3.8 What `mssql` refuses

| Feature                                 | Refusal                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| materialized views                      | inherited behaviour, now a trait. An indexed view needs `WITH SCHEMABINDING` plus a unique clustered index and is not the same object       |
| row-level security                      | SQL Server has RLS, through a predicate function and a security policy — a different shape that `RlsPolicy`'s `using` string cannot express |
| full-text search                        | `CONTAINS(col, @p1)` needs a full-text catalog and index the snapshot cannot declare, and the compiler cannot know whether one exists       |
| `returning()` on a table with a trigger | the server's refusal, not ours (§3.4)                                                                                                       |
| upsert with no conflict target          | §3.5                                                                                                                                        |
| pagination with no `ORDER BY`           | §3.3                                                                                                                                        |

Full-text search is refused rather than opted into. SQLite's precedent is an explicit `ftsTable` option
through which the caller asserts a companion object exists, and the same trick would work here with a
`fulltextIndexed` flag. It is not part of this epic: the value of the option is that it makes the assertion
visible. The bundled driver makes the dialect runnable, but the schema still cannot assert that the
required full-text catalog and index exist. §10.

### 3.9 Write expressions

`../../SPEC.md` §5b.3 gives the golden SQL for each write-expression variant per dialect. Two of the five
need an `mssql` row, and one of them is not a spelling difference:

```
set({ views: inc(1) })          UPDATE [posts] SET [views] = [views] + @p1
set({ stock: dec(2) })          UPDATE [posts] SET [stock] = [stock] - @p1
set({ nickname: coalesce('x') }) UPDATE [users] SET [nickname] = COALESCE([nickname], @p1)
set({ title: concat(' (draft)') }) UPDATE [posts] SET [title] = CONCAT([title], @p1)
set({ published: not() })       UPDATE [posts] SET [published] = ~[published]
```

`concat` is `CONCAT(...)`: T-SQL's concatenation operator is `+`, not `||`, and `+` on two `NVARCHAR`
expressions is ambiguous enough with numeric addition that the function is the better choice — which also
means `mssql` shares MySQL's spelling without sharing a parent, and is why `concat` is a trait rather than a
branch on `dialect === 'mysql'`.

`not()` is the interesting one. `NOT [published]` is a **syntax error** in T-SQL: `NOT` takes a boolean
expression and a `BIT` column is not one. `~` is bitwise complement over `BIT`, which yields exactly the
inverse and propagates `NULL` the same way `NOT` does on the other dialects. `../../SPEC.md` §5b.3 says
"`NOT` is the same token on all three", which was true of three and is not true of four; the `booleanNot`
trait is what stops that sentence from silently becoming wrong.

## 4. CockroachDB (`cockroach`)

```ts
cockroach: {
  parent: 'postgres',
  types: { serial: 'INT8 DEFAULT unique_rowid()', integer: 'INT4' },
  fts: 'none',
  features: { rowLevelSecurity: false },
  retryableCodes: ['40001'],
}
```

Five keys. That is the return on the mechanism, and it is the whole argument in §2.2's favour: a flat sixth
member means writing Cockroach's Postgres behaviour out again in twenty-one places, where nineteen of the
copies would be identical and two would be the ones that matter.

`types` merges over the parent's map key by key, so the eight entries Cockroach agrees with Postgres about —
including `timestamp: 'TIMESTAMPTZ'` — are inherited rather than repeated.

### 4.1 `serial` stays an integer, and the UUID advice stays a declaration

The pre-implementation Cockroach page suggested that a real dialect might map `serial` to
`UUID DEFAULT gen_random_uuid()`. It must not, and the reason is not about databases.

`Entity<T>` types a `Serial` column as `number`. A dialect that emitted `UUID` would give the application a
string where the type promised a number, silently, for every read — the exact class of bug
`../../../repository/src/index.ts:481`'s `decodeRows` closes for driver-shaped `timestamp`, `bigint`, and
extension vector values. A dialect table maps a declared type to a spelling; it does not get to change what
the column holds.

What it does get to do is make Cockroach's own behaviour explicit. Cockroach's `SERIAL` is not a sequence:
it is `INT8` with a `unique_rowid()` default, which embeds the node id specifically to avoid the
single-range hotspot that a monotonic key would create. Emitting `SERIAL` and inheriting that meaning by
accident is what DoD item 3 forbids, so the mapping writes it out.

The UUID primary key remains what `dialect-cockroach.md:26` already documents correctly and what
§3.6 says for SQL Server: a `Sql<'text'>` column with `PrimaryKey` and `HasDefault`, and
`ALTER TABLE … SET DEFAULT gen_random_uuid()` in a migration. `HasDefault` drops the column from
`CreateDTO<T>`'s required keys without claiming it is an auto-incrementing integer. No dialect change is
involved, which is the page's own conclusion at line 41.

### 4.2 `integer` is `INT4`

Cockroach's `INTEGER` is an alias for `INT8`. `Entity<T>` types an `integer` column as `number`, and a
64-bit column can hold values above `Number.MAX_SAFE_INTEGER`, so inheriting Postgres's `INTEGER` would
declare a column whose contents the application type cannot represent — and `decodeRows` would not catch it,
because it keys off the _declared_ type, where `integer` means "safe as a number". `INT4` makes the
declaration true. A caller who wants the 64-bit column declares `bigint`, which maps to `INT8` and is
decoded as a `bigint`.

### 4.3 What it refuses that Postgres allows

- **Full-text search.** There is no `to_tsvector`/`@@`. Inheriting the Postgres branch at
  `../fts/index.ts:113` would emit SQL that parses nowhere, which is the "inherited by accident" failure
  DoD item 3 names, and it is the clearest example in the epic of why every feature flag is written down per
  dialect rather than defaulted.
- **Row-level security.** Recent Cockroach versions have it; the versions in the field mostly do not, and a
  dialect cannot ask the server what it is. Refused, with the version caveat on the docs page rather than in
  a runtime check.
- **`INTERLEAVE`, `AS OF SYSTEM TIME`, locality clauses and zone configs** have no representation and are
  not being given one. They are raw SQL, which is what `dialect-cockroach.md:62` already says. `AS OF
SYSTEM TIME` is the one worth wanting on the select builder and it is a select-clause feature, not a
  dialect trait, so it belongs to whichever epic widens the builder — noted, not smuggled in here.

Materialized views are **inherited as supported**: Cockroach has them, without
`REFRESH … CONCURRENTLY`, which this package never emits.

Stored-routine DDL and set-returning function calls also inherit Postgres
grammar. Their parameter and return spellings still resolve through the
Cockroach type overrides.

### 4.4 Retryable errors, and where the retry belongs

Cockroach is serializable by default, so `40001` under contention is normal operation and the client is
expected to retry. `dialect-cockroach.md:60` calls this the single most important thing to know about
running on Cockroach, and it is right.

**The retry lives in the transaction wrapper in `@zmdb/repository`, not in the driver and not in the migration runner.** A retry re-runs a _unit of work_, and only the caller that owns the closure can re-run it; a driver sees statements and has no idea which ones belonged together.

What the driver contributes is the code, and what the dialect contributes is which codes are retryable — hence `retryableCodes` on the traits record, where `postgres` carries `['40001', '40P01']` (serialization failure and deadlock, both reachable under `SERIALIZABLE`) and Cockroach narrows it to `['40001']`.

A dialect table in the query compiler holding driver error codes needs a justification, and the precedent is
exact: `DIALECT_PARAM_LIMITS` at `../index.ts:39` is a _driver_ limit living in the compiler, for the same
reason — it is per-dialect knowledge with no SQL in it, and the alternative is a second per-dialect table in
a package that already imports this one.

What is **not** specified here is the retry policy's shape (attempt count, backoff, which errors abort
immediately). That is a `@zmdb/repository` transaction-API decision with its own epic; this freeze commits
only to where the classification data lives and that nothing in the compiler retries anything.

### 4.5 Asynchronous schema changes

`ALTER TABLE` returns before the change has propagated, and Cockroach rejects several DDL statements inside
an explicit transaction. `../../../zmdb/src/cli/SPEC.md` §5 wraps each migration in a transaction, and that stays:
`transactionalDdl: true` is inherited and correct. What changes is the advice, not the mechanism — a
migration whose `up` alters a column and then writes through it may need splitting into two versions, which
is a migration-authoring fact for the docs page and not something the emitter can detect.

## 5. SingleStore (`singlestore`)

```ts
singlestore: {
  parent: 'mysql',
  types: { serial: 'BIGINT AUTO_INCREMENT' },
  features: { foreignKeys: false },
  // plus the table-level vocabulary in §5.1, which is not a traits-record entry
}
```

Three keys — and unlike Cockroach, the interesting part of this dialect is not in the traits record at all.
It is new declaration vocabulary, which is why this section is longer than §4 despite the shorter entry.

### 5.1 `ShardKey` and `SortKey`, and where they go

SingleStore distributes rows by a shard key, and a table created without one gets an arbitrary choice.
`dialect-singlestore.md:40` states the consequence precisely: sharding on `customer_id` means a query
filtered by customer touches one partition, sharding on `id` means it fans out to all of them, and zmdb
cannot make that choice for the user. So the user has to be able to say it.

These are facts about a table, not a column, so they go where `Fts<Name>` already sits — the `extends`
clause — which is the conclusion `dialect-singlestore.md:52` reaches independently:

```ts
import type { PrimaryKey, ShardKey, SortKey, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'>, ShardKey<['customerId']>, SortKey<['id']> {
  id: number & Sql<'bigint'> & PrimaryKey;
  customerId: number & Sql<'bigint'>;
}
```

```ts
// packages/schema-core/src/tags/index.ts, beside Fts at line 84
export type ShardKey<Cols extends readonly string[]> = { readonly [zmdbShardKey]?: Cols };
export type SortKey<Cols extends readonly string[]> = { readonly [zmdbSortKey]?: Cols };
export type Rowstore = { readonly [zmdbRowstore]?: true };
```

A tuple type argument rather than the comma-separated string `Fts` and `References` use, because a shard key
is genuinely multi-column and `ShardKey<'a,b'>` would need a parser. The reflector already reads a tuple out
of a tag — `Numeric<P, S>` stores `readonly [P, S]` — so the shape is precedented; reading a tuple type
_argument_ is the new part, and it is one of the reasons this implementation slice touches
`@zmdb/schema-core` and not only this package.

The DDL:

```sql
CREATE TABLE `orders` (
  `customerId` BIGINT NOT NULL,
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  SHARD KEY (`customerId`),
  SORT KEY (`id`)
)
```

with `CREATE ROWSTORE TABLE` in place of `CREATE TABLE` when `Rowstore` is declared. Columnstore is
SingleStore's default for a new table, which is excellent for aggregates and poor for point lookups and
single-row updates, so the tag exists to make the transactional hot path sayable.

**`TableSnapshot` has no place to put any of this.** It is `{ name, columns }`, and a shard key is neither.
The implementation adds an optional table-options field to the snapshot, which means it also
appears in the snapshot JSON on disk and therefore in the diff — see §5.4.

The field is exact rather than an open options bag:

```ts
interface TableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
  readonly tableOptions?: TableOptions;
}
```

It is optional so every snapshot written before this dialect remains byte-identical. `rowstore?: true`
rather than `boolean` leaves no second spelling for columnstore: absence is columnstore, because that is
SingleStore's default.

### 5.2 A table declaring neither a shard key nor `Rowstore` is refused

`dialect-singlestore.md:42` puts it well: a `CREATE TABLE` with no sort key and no rowstore hint "is a
decision being made by omission". The entire reason to add this dialect rather than route through `mysql` is
to stop making it by omission, so on `singlestore` a `create_table` op for a table with neither declaration
is refused at migration-generation time, naming the table and both ways to fix it.

This was a compatibility-free addition: no schema at the implementation base could declare these tags,
and `singlestore` was not yet a `Dialect` value. It was the one moment where the refusal was free.

### 5.3 `serial` is `BIGINT AUTO_INCREMENT`, and it is still a sharp edge

MySQL's entry is `INT AUTO_INCREMENT`. SingleStore allocates auto-increment values per partition in large
strides, so the integer domain is consumed far faster than the row count suggests and an `INT` ceiling is
reachable on a table that is nowhere near two billion rows. `BIGINT` is the override.

Which leaves a seam this freeze names rather than hides: `Entity<T>` types a `Serial` column as `number`, `decodeRows` converts only columns _declared_ `bigint`, and a `serial` column is not one — so an id past `Number.MAX_SAFE_INTEGER` arrives as whatever `mysql2` produces for a `BIGINT`.

The fix is a declaration, not a dialect: `bigint & PrimaryKey & HasDefault` with the default written by hand, which types the column as a `bigint` and gets it decoded. The docs page must say so, because "ids are unique but not monotonic" (line 48) is the milder half of the same fact.

The page's related warning is worth carrying into the spec: keyset pagination ordered by id is unreliable
here, because per-partition allocation means a higher id is not a newer row. Order by a timestamp with a
tie-break.

### 5.4 A unique index outside the shard key, and where it can actually be caught

SingleStore cannot enforce a unique index that does not contain the shard key, and rejects it. So
`email: string & Sql<'text'> & Unique` on a table sharded by `id` fails.

`dialect-singlestore.md:52` says catching this "turns a deploy-time error into a compile-time one". **It cannot be compile-time, and the page has to be corrected.** `schemaOf` and the reflector know nothing about dialects — reflection reads a type, and the dialect is a runtime value from a config file (`../../../zmdb/src/config/SPEC.md` §1 types it as `Dialect` read off disk).

The earliest a dialect-specific rule can fire is where the dialect is first in scope, which is DDL emission: `zmdb generate`, before the migration is written, with an error naming the column, the shard key and the two ways out. That is still before deploy and it is still valuable — it is simply not the type system, and claiming otherwise on a docs page is how a user comes to trust a check that does not exist.

Shard keys are also **immutable**: SingleStore has no `ALTER` that changes one. `ChangeOp` has five kinds (`../migrations/index.ts:34`) and none of them can express "the table options changed", so once table options are in the snapshot, `diff` will see a changed shard key and have nothing to emit.

It must **refuse** — naming the table and saying that a shard-key change means creating a new table and copying — rather than producing an empty diff, which would let a developer edit the declaration, generate nothing, and believe the change had shipped.

### 5.5 Foreign keys are refused, not silently dropped

`TableSnapshot.foreignKeys` and the migration emitter now carry real named
constraints with referential actions. SingleStore cannot inherit that behavior
from MySQL: `foreignKeys: false` makes migration generation refuse a table whose
snapshot contains one. Suppressing the SQL would leave a declaration that
promises integrity while the database enforces none.

### 5.6 Stored-routine DDL is refused

SingleStore's `CREATE FUNCTION` and `CREATE PROCEDURE` grammar is not MySQL's
routine grammar. The schema-object emitter refuses `RoutineDef` DDL instead of
shipping a plausible MySQL statement. Existing scalar functions and procedures
can still be called through the inherited MySQL quoting and placeholders.

Everything else on the MySQL page applies unchanged and is inherited: backtick quoting, `?` placeholders,
`TINYINT(1)` booleans, no `RETURNING`, `INSERT IGNORE` and `ON DUPLICATE KEY UPDATE`.

## 6. The refusal mechanism

`UnsupportedFeatureError` already exists (`../errors.js`), already carries `feature` and `dialect` as
readable fields, and is already thrown for row-level security and for SQLite full-text search. The mechanism
is half-built; this freeze finishes it in three ways and invents nothing.

**One additive change to the class:** an optional third constructor argument, appended to the message.

```ts
export class UnsupportedFeatureError extends Error {
  readonly feature: string;
  readonly dialect: string;
  constructor(feature: string, dialect: string, hint?: string);
}
```

`feature` and `dialect` stay machine-readable so the matrix in §7 can assert against them; the hint is where
the sentence that saves the reader an hour goes. The existing two-argument calls are unchanged.

**`feature` becomes a closed vocabulary.** Today it is any string, and two call sites happen to agree on `'row-level security'`.

The runtime values are the existing human-readable feature names (`'materialized views'`, `'row-level security'`, `'full-text search'`), the closed extension operator/predicate names from `../../SPEC.md` §5a (`'l2'`, `'cosine'`, `'ip'`, `'st_contains'`, `'st_within'`, `'st_intersects'`, `'st_dwithin'`), and the statement-level refusals named here (`'pagination without ORDER BY'`, `'upsert without a conflict target'`, `'returning'`, `'alter column type'`, `'table options change'`).

Trait property names such as `materializedView` are not error messages. A closed set is what lets one test enumerate every refusal the matrix expects and fail when a new one appears undocumented.

**Compile-time where it is genuinely available, runtime where it is not.** There are exactly two
compile-time levers, and it is worth being precise about them because "compile-time error where possible" is
easy to promise and hard to cash:

1. `Record<Dialect, …>` on every dialect table. Adding a member breaks the build until every table has an
   entry. This is the whole of the exhaustiveness guarantee and the reason no dialect table is ever
   `Partial<Record<Dialect, …>>` (§1.1).
2. The `DialectFeature` union, so `features: { fullTextSearch: false }` cannot be misspelled.

Not available, and deliberately not pursued: **parameterising the builders by dialect.** A `QueryCompiler<'mssql'>` whose `.limit()` returned a type that only `.orderBy()` could compile would catch §3.3's refusal at the type level, which is the single most valuable compile-time check in this epic.

It is rejected because the dialect is not a literal at the boundary — it arrives from a config file as `Dialect` — so the type parameter would widen to the full union at the exact place it needed to be narrow, while threading through every builder interface, every `Repo` method and `defineRepository`.

The runtime refusal is acceptable because `compile()` is pure: a test asserting a refusal costs precisely what a test asserting golden SQL costs, and §7 requires both in the same table.

## 7. The test matrix

**Every construct, every dialect, one table, no gaps.** The pattern is not invented here; it is already in the repository at `../../../zmdb/src/three-types.spec.ts:63`, where a timestamp column's DDL is asserted against a `Readonly<Record<Dialect, string>>` iterated per dialect.

Two properties of that test are the reason it generalises: the expectation is the whole statement rather than a fragment (the comment there explains why — `TIMESTAMPTZ` contains `TIMESTAMP`, so half the obvious assertions pass either way), and the table is keyed by `Dialect`, so a missing dialect is a compile error.

The generalisation:

```ts
type Expectation = string | { readonly refused: string };
const refused = (feature: string): Expectation => ({ refused: feature });

const PAGINATION: Readonly<Record<Dialect, Expectation>> = {
  postgres: 'SELECT * FROM "t" OFFSET 20',
  mysql: 'SELECT * FROM `t` LIMIT 18446744073709551615 OFFSET 20',
  sqlite: 'SELECT * FROM "t" LIMIT -1 OFFSET 20',
  mssql: refused('pagination without ORDER BY'),
  cockroach: 'SELECT * FROM "t" OFFSET 20',
  singlestore: 'SELECT * FROM `t` LIMIT 18446744073709551615 OFFSET 20',
};
```

Four requirements, each of which closes a way partial support could ship quietly:

1. **A missing key is a compile failure**, not a skipped case. `Record<Dialect, …>`, never `Partial`.
2. **A refusal is spelled explicitly** with the `feature` string, and the test asserts an
   `UnsupportedFeatureError` carrying that exact `feature` and `dialect`. "Unimplemented" therefore cannot
   masquerade as "unsupported": an unimplemented construct throws something else, or emits SQL, and the
   assertion fails either way.
3. **Every construct with golden SQL in `../../SPEC.md` §4, §5a, §5b.3, §5c and §5d gets a row**, plus the
   DDL for all ten `SqlType` members and all five `ChangeOp` kinds. The `SqlType` coverage test is the
   exhaustiveness check the type system cannot provide (§2), and it holds the ten names as a local literal
   list because this package cannot import `SqlType`.
4. **The shared helper does not use `as`.** The existing test casts `Object.entries(DB) as [Dialect, string][]`;
   iterating a typed key list instead keeps the repository's no-`as` rule intact in the file that will be
   copied most.

Test titles are load-bearing — `tests/api-coverage/mapping.mjs` cites them by exact text — so a test that
exists today keeps its title when it is parameterised, and the per-dialect suffix goes on new titles only.

## 8. What "supported" means, per dialect

The epic requires this to be stated honestly. Six dialect values now ship, and
`packages/repository/src/drivers/` contains `pg.ts`, `sqlite.ts` and `mssql.ts`; MySQL remains a supported
dialect with no bundled adapter. "Supported" means the compiler emits correct SQL, with a bundled adapter
where the table says one exists.

| Dialect       | Driver here            | Always-on CI database                                   | Coverage                                                                |
| ------------- | ---------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `postgres`    | `drivers/pg.ts`        | yes                                                     | golden SQL + real E2E                                                   |
| `sqlite`      | `drivers/sqlite.ts`    | in-process                                              | golden SQL + real E2E                                                   |
| `mysql`       | none                   | no                                                      | golden SQL only, today                                                  |
| `mssql`       | `drivers/mssql.ts`     | no; opt-in through `ZMDB_MSSQL_URL`                     | complete golden matrix + loud-gated real E2E when a server is reachable |
| `cockroach`   | reuses `drivers/pg.ts` | no                                                      | complete golden matrix; live-server qualification remains               |
| `singlestore` | none                   | no: the image wants a licence key and several gigabytes | complete golden matrix; live-server qualification remains               |

SQL Server's opt-in suite executes generated DDL, the adapter's named-parameter binding, bracket escaping,
`OUTPUT`, ordered pagination, `MERGE`, timestamp round-trips and column migrations against a real server.
When `ZMDB_MSSQL_URL` is absent or unreachable, it emits a visible `[skip] SQL Server E2E: …` reason and
retains a passing availability assertion rather than silently disappearing.

Cockroach speaks the Postgres wire protocol, so the existing driver can run
against it with a connection string change. The always-on gate does not
currently start a Cockroach server, so accepting the emitted SQL there remains
deployment qualification rather than CI evidence.

SingleStore is the expensive one and the freeze does not pretend otherwise. Its divergences — shard keys,
per-partition auto-increment, the unique-index rule — are exactly the kind that a golden file cannot verify,
because the question is whether the server accepts the DDL.

#509 ships the complete golden matrix and explicit refusal tests, but no licensed live-server suite exists in
the repository. The docs page therefore says that server acceptance remains deployment qualification. A page
that flipped to `supported` while implying CI coverage that does not exist would be worse than the current
`todo`, which at least tells the truth.

## 9. Docs corrections now, support rewrite later

The tests freeze corrects the design claims that became false as soon as this spec was accepted:

- SQL Server uses `DATETIMEOFFSET(3)`, has no reachable `UNIQUEIDENTIFIER` abstract type, concatenates
  through `CONCAT`, and refuses unordered pagination rather than synthesising an order (§3).
- Cockroach keeps `serial` numeric as `INT8 DEFAULT unique_rowid()`, maps `integer` to `INT4`, refuses
  Postgres full-text SQL, and leaves UUID keys as the explicit declaration the page already demonstrates
  (§4).
- SingleStore's unique-index check is at migration generation rather than type reflection, and there is no
  foreign-key SQL to suppress in the current snapshot/emitter (§5).

#509 corrects the statements made false by the implementation while keeping both pages `todo`. #510 still
owns the final support-state rewrite, any status changes, and any additional live-coverage evidence.

## 10. Non-goals (rejected)

- **A flat six-member union.** §1.1, §2.2 — three of twenty-four sites are protected by the compiler today,
  and a flat union keeps it that way while tripling the copies.
- **Rewriting one dialect's SQL into another's by string transformation.** The epic's own architecture
  constraint, and the reason `parent` merges _traits_ rather than post-processing text.
- **`ORDER BY (SELECT NULL)` to satisfy SQL Server's pagination grammar.** §3.3 — it converts a caught bug
  into an uncaught one.
- **`TOP` as a second pagination form on `mssql`.** §3.3.
- **`OUTPUT … INTO @table` for trigger-bearing tables.** §3.4 — it needs a `DECLARE` and a second
  statement, and `../../SPEC.md` §5d froze `text` as one statement.
- **`RETURNING` the pre-update row.** §3.4 — `OUTPUT DELETED.*` on an `UPDATE` can express it and
  `returning()` cannot ask for it; adding the vocabulary is a builder change, not a dialect one.
- **`MERGE` without `WITH (HOLDLOCK)`.** §3.5 — a racy upsert is not an upsert.
- **An `IF EXISTS`/`UPDATE`/`INSERT` sequence instead of `MERGE`.** §3.5 — three statements, and still racy.
- **`UNIQUEIDENTIFIER`, or a `uuid` member on `SqlType`.** §3.6 — a schema-core change that would give one
  dialect a column type the others cannot spell.
- **Full-text search on `mssql`, including a `fulltextIndexed` opt-in.** §3.8 — the bundled adapter can run
  SQL Server, but the schema cannot assert that the required catalog and index exist.
- **`serial` mapping to a UUID on `cockroach`.** §4.1 — the dialect table maps spellings, not types.
- **`AS OF SYSTEM TIME` on the select builder.** §4.3 — a select-clause feature, not a dialect trait.
- **Retry logic anywhere in `@zmdb/query-compiler`.** §4.4 — the compiler emits text; the retry policy's
  shape belongs to the repository's transaction API.
- **Parameterising builders by dialect (`QueryCompiler<'mssql'>`).** §6 — the dialect is not a literal at
  the boundary, so the type would widen exactly where it needed to narrow.
- **`Partial<Record<Dialect, …>>` for any dialect table, including test expectation tables.** §1.1, §6, §7 —
  it is the only compile-time guarantee in the package.
- **Claiming CI coverage for `singlestore`.** §8.
