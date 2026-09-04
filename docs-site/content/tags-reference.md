Every tag, in one place. Import from `zmdb/tags` (or `@zmdb/schema-core/tags`) unless noted.

Most tags are optional `unique symbol` property slots:

```ts
declare const zmdbSerial: unique symbol;
export type Serial = { readonly [zmdbSerial]?: true };
```

All three parts are load-bearing. `unique symbol` cannot be forged or collide with a data property of the same name. `?` means no runtime value is ever required, so the tag erases to nothing — a tagged declaration and its untagged twin compile to byte-identical JavaScript. And an all-optional (weak) object type is not assignable from an unrelated type, which is what makes `T[K] extends Serial` an exact question rather than a structural coincidence.

`Ext<E, N, A>` is the one structural exception. Its optional `__zmdbExt`
tuple carries the installable extension, SQL type name, and validated arguments
through reflection without adding a runtime symbol.

The module has **zero runtime exports**. There is nothing to import at runtime, no decorator metadata, no registry.

## Entity-level

Applied with `extends`, not intersected.

| Tag           | Payload          | Means                                                     |
| ------------- | ---------------- | --------------------------------------------------------- |
| `Table<Name>` | `string`         | This interface is a table, and `Name` is its name.        |
| `Fts<Name>`   | `string \| true` | Backing [full-text-search](./full-text-search.html) table |

```ts
interface Article extends Table<'articles'>, Fts<'articles_fts'> {}
```

## Structural

| Tag                  | Payload          | Emits                                                     |
| -------------------- | ---------------- | --------------------------------------------------------- |
| `Sql<T>`             | a SQL type name  | the column's DDL type                                     |
| `Ext<E, N, A>`       | three type args  | extension installation and the supplied column type       |
| `PrimaryKey`         | —                | `PRIMARY KEY`; two columns → composite                    |
| `Serial`             | —                | auto-increment, **and** `hasDefault`                      |
| `Unique`             | —                | `UNIQUE`                                                  |
| `HasDefault`         | —                | optional in `CreateDTO`; drops the column from `required` |
| `Sensitive`          | —                | never serialised; `ReadDTO<T>` cannot name it             |
| `References<Target>` | `'table.column'` | `FOREIGN KEY`                                             |
| `Length<N>`          | `number`         | `varchar(N)`, and `maxLength: N` in JSON Schema           |
| `Numeric<P, S>`      | two `number`s    | `numeric(P, S)`                                           |
| `Codec<Name>`        | `string`         | names a [custom type](./custom-types.html) codec          |
| `WireAs<W>`          | **a type**       | what the column looks like over the wire                  |

`Serial` and `HasDefault` are distinct on purpose. Supplying a defaulted column is legitimate, so it is _optional_ on insert; supplying a database-generated one is a mistake, so it is _absent_ from the insert type entirely.

`Serial` implies `hasDefault` and always has. A serial column's value comes from a sequence the database owns, so `INSERT` may omit it — and "may be omitted on insert" is exactly what `hasDefault` says to `CreateDTO`, to the JSON Schema's `required` list and to the [seeder](./seeding.html). Getting this wrong is invisible in the DDL and only the create path notices.

`WireAs<W>` is the only tag whose payload is a type rather than a literal, and it has to be: a codec's wire form is arbitrary — cents as a decimal string, a point as a pair of numbers — so nothing but the type itself can name it. A `Codec` column with no `WireAs` is a **build error**, not a column assumed to cross unchanged.

```ts
amount: number & Sql<'bigint'> & Codec<'Money'> & WireAs<string>;
// app: number   ·   wire: string   ·   db: BIGINT
```

`Sql<'timestamp'>` and `Sql<'bigint'>` need no `WireAs`: their wire form follows from the SQL type.

## The SQL types

`Sql<T>` takes one of these. `serial` is not among them — write `Serial` instead, which is the tag that means it.

| `Sql<…>`    | TypeScript | Postgres      | MySQL         | SQLite    |
| ----------- | ---------- | ------------- | ------------- | --------- |
| `integer`   | `number`   | `INTEGER`     | `INT`         | `INTEGER` |
| `bigint`    | `bigint`   | `BIGINT`      | `BIGINT`      | `INTEGER` |
| `numeric`   | `number`   | `NUMERIC`     | `DECIMAL`     | `NUMERIC` |
| `text`      | `string`   | `TEXT`        | `TEXT`        | `TEXT`    |
| `varchar`   | `string`   | `VARCHAR(n)`  | `VARCHAR(n)`  | `TEXT`    |
| `boolean`   | `boolean`  | `BOOLEAN`     | `TINYINT(1)`  | `INTEGER` |
| `timestamp` | `Date`     | `TIMESTAMPTZ` | `DATETIME(3)` | `TEXT`    |
| `json`      | your shape | `JSONB`       | `JSON`        | `TEXT`    |
| `jsonEnum`  | a union    | `TEXT`        | `TEXT`        | `TEXT`    |

Plus `Serial`, which is `SERIAL` / `INT AUTO_INCREMENT` / `INTEGER` (SQLite's rowid alias is what makes it auto-increment there).

That is the whole core set. Extension-backed types such as `vector`,
`geometry`, and `citext` use `Ext`; other storage types such as `uuid`, `date`,
`interval`, `inet`, and arrays need a [custom type](./custom-types.html) or a
`json` column. [Column Types](./column-types.html) has the reasoning.

> [!NOTE]
> `timestamp` is `TIMESTAMPTZ` in Postgres, not `TIMESTAMP`. Postgres reads the latter as "without time zone", which stores the wall clock and forgets the offset. MySQL has no zone-aware type with a usable range — `TIMESTAMP` converts to the session zone and stops in 2038 — so it gets `DATETIME(3)`, keeping the milliseconds a `Date` has, with the application owning the zone.

`Sql<…>` is required wherever the app type maps more than one way: `number` could be `integer` or `numeric`, `string` could be `text` or `varchar`. It is optional where the mapping is forced.

## Validation

| Tag            | Payload  | JSON Schema  |
| -------------- | -------- | ------------ |
| `Min<N>`       | `number` | `minimum`    |
| `Max<N>`       | `number` | `maximum`    |
| `MinLength<N>` | `number` | `minLength`  |
| `MaxLength<N>` | `number` | `maxLength`  |
| `Pattern<S>`   | `string` | `pattern`    |
| `Rule<Name>`   | `string` | a named rule |

```ts
age: number & Sql<'integer'> & Min<18> & Max<120>;
email: string & Sql<'varchar'> & Length<255> & Pattern<'^\\S+@\\S+$'>;
```

`Rule<Name>` is the named escape hatch, and an **unregistered name is a build error**, not a silently skipped check. The runtime vocabulary in `@zmdb/aot-validator` uses the same spellings — `tags.Min(18)`, `tags.Max(120)` — so there is one name per constraint rather than one per layer.

A template literal type derives a pattern on its own: `` `${string}@${string}` `` becomes `^[\s\S]*@[\s\S]*$`, merged with rather than replaced by an explicit `Pattern<…>`. `${number}` is refused — TypeScript accepts exponents, signs and `Infinity` there, so every short regex is either stricter or looser than the type, and both are wrong in a validator.

There is no `Enum` tag. A literal union is how you declare that, and TypeScript models it better than a flag does.

## Relations

| Tag                           | Cardinality | `Fk` / `Through` lives on |
| ----------------------------- | ----------- | ------------------------- |
| `ManyToOne<Target, Fk>`       | to-one      | this table                |
| `OneToMany<Target, Fk>`       | to-many     | the target table          |
| `OneToOne<Target, Fk>`        | to-one      | this table                |
| `ManyToMany<Target, Through>` | to-many     | a join table              |

```ts
interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'> & References<'users.id'>;
  author?: User & ManyToOne<'users', 'authorId'>;
  comments?: Comment[] & OneToMany<'comments', 'postId'>;
}
```

Cardinality is deliberately **not** readable back out of the tag. The declared type already says it — `User & ManyToOne<…>` is to-one and `Comment[] & OneToMany<…>` is to-many, natively — and a tag that has to be decoded is a tag that can disagree with the declaration.

A relation is not a column: `Entity<T>` excludes `author` and `comments`, or a join target becomes something to `INSERT`. See [Relations](./relations.html).

## Not tagged, on purpose

| Fact           | How you say it     |
| -------------- | ------------------ |
| Nullable       | `\| null`          |
| Optional       | `?`                |
| An enum column | a literal union    |
| An array       | `T[]`              |
| Immutable      | `readonly`         |
| A nested shape | a nested interface |

TypeScript already says all six, the reflection reads them off the type directly, and a second spelling would be a second source of truth.

`Nullable<T>` and `NonNull<T>` are exported as readability aliases. They are **not** tags: `Nullable<string>` is exactly `string | null`.

> [!WARNING]
> Spell a nullable column `(T & Tags) | null` — tags inside, `| null` outside. TypeScript normalises `(T | null) & Unique` into `(T & Unique) | (null & Unique)`, and `null & Unique` reduces to `never`, so the column silently stops being nullable. A trap with a mechanism, not a style preference.

## Two installs of `zmdb`

`unique symbol` identity is nominal, so two copies of `@zmdb/schema-core` in one `node_modules` produce two non-matching `Serial` tags from identical source text. The consequence is not a type error: the filter that picks serial columns collapses to `never`, `Omit<T, never>` is `T`, and a generated column silently becomes **required** on insert — while the emitted validator, which matches tags by name, still treats it as generated.

That asymmetry is why the build refuses it. The reflection can see the escaped symbol ids the type system distinguishes (`__@zmdbSerial@1` against `__@zmdbSerial@12`) and names both spellings in the error. Deduplicate the install.

## Web decorators

From `@zmdb/web`, and the only decorators in the project — they have nothing to do with schemas:

| Decorator                                | Module     | Records                                  |
| ---------------------------------------- | ---------- | ---------------------------------------- |
| `@Controller(prefix)`                    | `routing`  | route prefix                             |
| `@Get` `@Post` `@Put` `@Patch` `@Delete` | `routing`  | method + path                            |
| `@Module(def)`                           | `modules`  | controllers, providers, imports, exports |
| `@Inject(token)`                         | `di`       | constructor parameter token              |
| `@Gateway(namespace)`                    | `gateways` | gateway namespace                        |
| `@Subscribe(event)`                      | `gateways` | message handler                          |

None read runtime type metadata. There is no `@Injectable()`, no `@Body()`, no `@Param()`: the handler receives one typed `Ctx`. See [Architecture](./architecture.html).

---

See also: [Schema Declaration](./schema-declaration.html) · [Column Types](./column-types.html) · [Type Derivation](./type-derivation.html) · [Codemod](./codemod.html)
