// Upstream functional-test suite -> the zmdb test that asserts the same behaviour, or an
// explicit "we don't do that" argument.
//
// zmdb claims to be a single replacement for Drizzle, Kysely, MikroORM, NestJS and Typia. The
// docs gate checks that claim against what those projects document. This checks it against what
// they *test*, and .github/scripts/verify-api-coverage.mjs fails the build when a suite in
// coverage/inventory.mjs has no entry here, or when an entry names a test that no longer exists.
//
// Three kinds of entry:
//
//   'upstream suite': 'a zmdb test title'
//       Covered. The title must be the exact text of an `it()`/`test()` in some *.spec.ts, so
//       deleting or renaming that test breaks this file rather than quietly weakening the claim.
//
//   'upstream suite': ['title one', 'title two']
//       Covered by more than one test, because the upstream suite bundles more than one claim.
//
//   'upstream suite': oos(REASON, 'docs-slug')
//       We deliberately do not do this. REASON is the argument, not a label, and the slug points
//       at the page saying what we do instead.
//
// A key may contain `*`, which matches any run of characters. Upstream test trees are full of
// families that are one behaviour written out N times — Drizzle asserts eighteen permutations of
// `[Find Many] Get users with posts + …` — and one entry covering the family is a truer statement
// than eighteen copies of the same mapping. Exact keys always beat patterns, and among patterns
// the most literal one wins, so a narrow entry is never absorbed by a broad one.
//
// Many-to-one is expected. What is not acceptable is an upstream behaviour with no answer.

/** Mark an upstream suite as deliberately out of scope. */
const oos = (reason, see) => ({ outOfScope: reason, see });

// ---------------------------------------------------------------------------
// The arguments, made once each
//
// A rationale repeated across twenty rows should be one rationale cited twenty times, not twenty
// paraphrases that can drift apart. Each of these is an argument about zmdb's design, and each is
// the reason for every row that cites it.
// ---------------------------------------------------------------------------

const NO_PLUGIN_LAYER =
  'Kysely lets you intercept and rewrite every compiled query through a plugin chain, which is ' +
  'how it does camelCase mapping, JSON result parsing and join deduplication. zmdb has no such ' +
  'seam on purpose: the compiler is a pure function from a builder to a frozen CompiledQuery, ' +
  'and a hook that can rewrite SQL after the fact is a hook that can invalidate every guarantee ' +
  'the type-first declaration just bought. Naming is settled at declaration time instead.';

const NO_BUILDER_SURGERY =
  'Kysely builders can be un-built: clearSelect, clearWhere, clearOrderBy and $dynamic exist so a ' +
  'query can be assembled by code that also takes parts back off. zmdb builders are immutable and ' +
  'additive, and a conditional query is expressed by deciding before you build rather than by ' +
  'building and then subtracting, which keeps the compiled output a function of the calls made.';

const NO_QUERY_LOG =
  'Query logging, logOnce and the queryId plumbing are an observability layer around execution. ' +
  'zmdb compiles queries and hands them to a driver it does not own, so logging belongs to that ' +
  'driver or to whatever wraps it — adding a second one inside the compiler would only report on ' +
  'the half of the round trip that never fails.';

const NO_CANCELLATION =
  'Cancelling an in-flight query, releasing a connection on premature iterator exit and async ' +
  'disposal are all connection-lifetime concerns. zmdb does not own the connection: a driver is ' +
  'an interface with query() and the pooling, cancellation and disposal semantics belong to the ' +
  'library that actually holds the socket. See the driver contract for what we do require.';

const NO_EXPLAIN =
  'EXPLAIN and query-plan assertions test the database planner, not the query builder. zmdb ' +
  'compiles to plain SQL you can EXPLAIN yourself with the driver you already have, and a test ' +
  'asserting a plan shape would be asserting a fact about one version of one engine.';

const NO_CTE =
  'zmdb has no WITH clause. A CTE is the point where a query stops being a description of one ' +
  'table and becomes a small program, and the compiler deliberately stops short of that: the ' +
  'builders compile a single statement whose shape a reader can predict from the calls. Compose ' +
  'in the application, or hand written SQL to the driver, which zmdb never gets in the way of.';

const NO_MERGE =
  'MERGE is a general conditional-write statement with matched and unmatched arms that can each ' +
  'insert, update or delete. zmdb supports the one case applications actually reach for — upsert ' +
  'via ON CONFLICT / ON DUPLICATE KEY — because that is expressible in every dialect we target, ' +
  'whereas MERGE is not, and a builder that compiles to it on some dialects is a portability trap.';

const NO_JSON_PATH =
  'Kysely and Drizzle both build JSON path traversal into the query language, so a document ' +
  'column can be queried like a table. zmdb treats a json column as an opaque value: it validates ' +
  'the shape on the way in and hands the parsed value back, and reaching into it with a path ' +
  'operator is a per-dialect syntax we would have to reproduce three ways to be honest about.';

const NO_EXOTIC_JOIN =
  'Cross joins, lateral joins and APPLY are not in the join builder. zmdb joins are declared on ' +
  'the type as relations, which is what lets populate and the aggregate helpers resolve their ON ' +
  'clauses for you; a join with no relation behind it has nothing to resolve, so it belongs in ' +
  'hand-written SQL where the reader can see exactly what it does.';

const NO_STREAMING_CURSOR =
  'Streaming a result set needs a server-side cursor, which is a driver capability rather than a ' +
  'compiler one, and the dialects disagree about it. zmdb pages with keyset cursors instead: they ' +
  'work on every dialect, hold no server state between requests and survive a client that goes ' +
  'away halfway through.';

const NO_DIALECT_ONLY_SYNTAX =
  'This is syntax one engine has and the others do not — REPLACE INTO, SELECT ... FOR UPDATE OF, ' +
  'TOP, materialized-view refresh, enum types created with CREATE TYPE. zmdb only compiles what ' +
  'all three target dialects can run, because a builder that quietly produces SQL that fails on ' +
  'the dialect you deploy to is worse than one that never offered it.';

const NO_IDENTITY_MAP =
  'MikroORM is a unit-of-work ORM: an identity map, change tracking, flush ordering, lazy ' +
  'references and proxies. zmdb returns plain rows and writes when you tell it to. That is the ' +
  'central design decision, not an omission — no proxies means a row is the object you got, and ' +
  'no flush means the SQL that ran is the SQL your call described.';

const NO_ENTITY_METADATA =
  'These test a decorator-and-metadata entity layer: EntitySchema, defineEntity, the entity ' +
  'generator, reflection over decorators, discovery and duplicate class detection. zmdb derives ' +
  'all of it from the TypeScript type at build time, so there is no second declaration to keep in ' +
  'step and nothing to discover at boot.';

const NO_MIKRO_KYSELY =
  'MikroORM recently grew a Kysely escape hatch — get-kysely, the plugin, reusing its client. ' +
  'That is an integration between two upstream projects and not a behaviour of either public API; ' +
  'zmdb ships its own compiler, and its escape hatch is that a driver takes raw SQL.';

const NO_MICROSERVICE_TCP =
  'zmdb message clients and dispatchers are transport strategies over brokers; they do not invent ' +
  'a bespoke length-prefixed JSON socket protocol. TCP framing, reconnect, TLS identity and flow ' +
  'control are a transport product of their own, and a thin in-framework socket would be a worse ' +
  'answer than using a broker or ordinary HTTP.';

const NO_GRAPHQL =
  'Code-first and schema-first GraphQL are a second API surface with their own resolver, guard ' +
  'and pipe story. zmdb generates OpenAPI from the same types that generate the validators and ' +
  'the DDL, because one declaration producing every artifact is the point; a GraphQL schema is ' +
  'reachable from the same IR, but it is not something we test or claim today.';

const NO_WEBSOCKETS =
  'NestJS gateways are bidirectional socket.io and ws servers with acknowledgements and ' +
  'request-scoped providers. zmdb gateways are one-directional: a typed event handler and ' +
  'server-sent events. A full duplex socket server needs a connection lifecycle the fetch-shaped ' +
  'pipeline does not have, and half of one would be the worst of both.';

const NO_REQUEST_SCOPE =
  'Request-scoped and durable providers make the injector re-resolve a subtree per request, which ' +
  'is why NestJS needs scope bubbling, inquirer injection and parallel-resolution tests. zmdb has ' +
  'singleton and transient providers and passes request state explicitly through the context ' +
  'object, so there is no scope to bubble and nothing to resolve twice.';

const NO_CUSTOM_VERSIONING =
  'NestJS lets an application supply an arbitrary version extractor and treats its answer as a ' +
  'single value or an ordered preference list. zmdb supports one explicit path, header or media-type ' +
  'strategy so the request contract is fixed in startup configuration and has a finite document ' +
  'shape; a custom callback would be a fourth strategy no generated document can describe and a ' +
  'precedence framework the versioning specification deliberately rejects.';

const NO_PLATFORM_ADAPTER =
  'These are Express and Fastify adapter behaviours: body parsers, static file serving, app ' +
  'locals, getUrl, listen, raw body access and instance sharing. zmdb speaks Fetch Request and ' +
  'Response and ships a thin node:http bridge, so the host is the platform and there is no ' +
  'adapter abstraction with two implementations to keep honest.';

const NO_FACTORY_FORM =
  'Typia offers both typia.is<T>(x) and typia.createIs<T>() — the second returning a reusable ' +
  'closure. zmdb only has the call-site form, because the AOT transformer inlines the check where ' +
  'it is written; a factory would hand back a function whose body is the thing we were trying not ' +
  'to allocate, and the inlined form is what the benchmarks measure.';

const NO_CLONE_PRUNE =
  'typia.plain.clone, prune and classify copy or strip a value against its type. zmdb validates ' +
  'and it serializes, and both read the value without rebuilding it — that allocation-free ' +
  'property is asserted directly. A clone that walks a type to produce a second object is the ' +
  'opposite of that, and an application that wants one can spread the row it already has.';

const NO_NAME_NOTATION =
  'typia.notations converts every key of a value between camel, snake, kebab and pascal case. ' +
  'zmdb settles the mapping between a property name and a column name once, in the declaration, ' +
  'where it is visible; converting names at runtime means the name in the error message is not ' +
  'the name in the source, which is the bug this design exists to prevent.';

const NO_HTTP_DECODERS =
  'typia.http parses query strings, headers and form data into a typed value, since it has no ' +
  'framework of its own. zmdb does: the pipeline decodes and validates a request body through the ' +
  'DTO pipes, and path and query parameters arrive on the context. The behaviour is covered there ' +
  'rather than by a standalone string-to-type parser.';

const NO_DATABASE_TRIGGERS =
  'A database trigger runs because another statement touched a table, so the behavior is absent ' +
  'from the call site and can also fire for writes made outside the application. Stored routines ' +
  'are explicit declarations and explicit calls; triggers have separate timing, event, transition ' +
  'row and recursion semantics and remain a separate capability that zmdb does not claim.';

const NO_INHERITANCE_MAPPING =
  'Single-table, joined and table-per-type inheritance, polymorphic relations and loadable mixins ' +
  'map a class hierarchy onto tables. zmdb has a discriminator helper for reading a subtype off a ' +
  'row and otherwise does not: a hierarchy spread across tables makes the SQL for a simple read ' +
  'unpredictable, which is the property the compiler is built to preserve.';

// ---------------------------------------------------------------------------
// Kysely — the query builder
// ---------------------------------------------------------------------------
export const kysely = {
  // --- SELECT --------------------------------------------------------------
  select: ['compiles where + orderBy + limit', 'compiles andWhere with sequential placeholders'],
  where: ['compiles where + orderBy + limit', 'validates normalized canonical operators and produces expected SQL'],
  'where > whereRef': oos(
    'whereRef compares two columns to each other rather than a column to a bound value. zmdb ' +
      'where clauses always take a value and always parameterize it, which is what makes the ' +
      'injection tests exhaustive; a column-to-column predicate has no parameter and so needs a ' +
      'second, unparameterized path through the compiler that nothing else uses.',
    'joins',
  ),
  'order-by > order by': 'compiles where + orderBy + limit',
  'group-by > group by': 'groups by multiple columns',
  having: 'multiple HAVING predicates are AND-joined and parameterized',
  'aggregate-function > aggregate functions': [
    'COUNT + GROUP BY + ORDER BY + pagination',
    'SUM + HAVING (parameterized)',
    'count, sum, avg, min and max each project one aggregate with its alias',
  ],
  'aggregate-function > aggregate functions > execute order-sensitive aggregate functions': oos(
    'An order-sensitive aggregate — string_agg or array_agg with its own ORDER BY inside the call ' +
      '— needs a second ordering scope that belongs to one projection item rather than to the ' +
      'query. zmdb aggregate items are an expression and an alias, and orderBy is a property of ' +
      'the statement; expressing this would mean a nested clause builder for one function family.',
    'aggregations',
  ),
  'expression > expressions': 'expr() emits a raw computed expression with alias',
  case: oos(
    'A CASE expression is a conditional evaluated by the database. zmdb projects columns and ' +
      'aggregates, and a computed projection goes through expr(), which takes the SQL you wrote ' +
      'and an alias. A typed CASE builder would be a second expression language inside the ' +
      'compiler, and expr() already reaches the same SQL without one.',
    'aggregations',
  ),
  coalesce: oos(
    'COALESCE is a scalar function call, and adding one helper per function is how a query ' +
      'builder acquires a standard library that never quite matches the dialect you are on. zmdb ' +
      'projects a function call through expr(), which is checked against the same identifier ' +
      'quoting as everything else and stays readable as the SQL it is.',
    'aggregations',
  ),
  'array > arrays': oos(
    'Postgres array columns with their own containment and overlap operators are a single-dialect ' +
      'type. zmdb declares a list-valued column as json, which every target dialect can store, ' +
      'and expands an array *parameter* into a parameterized IN list — a different thing that is ' +
      'tested directly, including the empty-list case that silently matches everything.',
    'column-types',
  ),
  'json > json helpers': oos(NO_JSON_PATH, 'json-properties'),
  'json-traversal > *': oos(NO_JSON_PATH, 'json-properties'),
  'parse-json-results-plugin > *': oos(NO_PLUGIN_LAYER, 'column-types'),

  // --- INSERT / UPDATE / DELETE -------------------------------------------
  'insert > insert into': ['INSERT ... RETURNING', 'valid create executes an INSERT'],
  update: 'UPDATE ... SET ... WHERE',
  delete: 'DELETE ... WHERE',
  'replace > replace into': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-mysql'),
  merge: oos(NO_MERGE, 'upsert'),
  'merge > *': oos(NO_MERGE, 'upsert'),

  // --- joins ---------------------------------------------------------------
  'join > inner join': 'inner join basic',
  'join > left join': ['left join with qualified on-columns', 'mixes left + inner joins with aliases'],
  'join > right join': 'right-joins the target table, keeping rows with no match on the left',
  'join > right join > full join': oos(
    'A FULL OUTER JOIN keeps unmatched rows from both sides, which SQLite and MySQL do not have. ' +
      'zmdb compiles inner, left and right joins because all three dialects run all three, and a ' +
      'builder method that works on one of them is a portability trap dressed as a feature.',
    'joins',
  ),
  'join > cross join': oos(NO_EXOTIC_JOIN, 'joins'),
  'join > cross join > *': oos(NO_EXOTIC_JOIN, 'joins'),
  'deduplicate-joins > *': oos(NO_PLUGIN_LAYER, 'joins'),

  // --- set operations, CTEs -----------------------------------------------
  'set-operation > set operations': [
    'UNION joins two selects with renumbered placeholders (pg)',
    'UNION ALL / INTERSECT / EXCEPT keywords',
  ],
  with: oos(NO_CTE, 'select'),
  'with-schema > with schema > with': oos(NO_CTE, 'select'),

  // --- schema qualification ------------------------------------------------
  'with-schema > with schema > select from': 'qualifies an object with its schema',
  'with-schema > with schema > *': 'qualifies an object with its schema',

  // --- DDL -----------------------------------------------------------------
  'schema > create table': [
    'renders every column type for postgres',
    'renders every column type for mysql',
    'renders every column type for sqlite',
    'names every declared column in every dialect',
  ],
  'schema > drop table': 'create_table down drops the table (postgres)',
  'schema > create index': [
    'creates a non-unique index',
    'creates a unique, multi-column, partial index',
    'emits an ivfflat index with its lists option',
    'emits an hnsw index with m and ef_construction',
  ],
  'schema > drop index': 'creates a non-unique index',
  'schema > create view': 'creates a plain view',
  'schema > drop view': 'drops a view',
  'schema > refresh materialized view': oos(NO_DIALECT_ONLY_SYNTAX, 'materialized-views'),
  'schema > create schema': 'creates a schema',
  'schema > drop schema': 'creates a schema',
  'schema > drop schema > create type': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'schema > drop schema > alter type': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'schema > drop schema > drop type': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'schema > alter table': 'maps the target of an alter, in every dialect',
  'schema > alter table > add column': [
    'detects an added column',
    'emits up SQL for add_column',
    'down reverses up for add_column',
  ],
  'schema > alter table > drop column': 'mysql down drops the added column with backticks',
  'schema > alter table > add index': 'creates a non-unique index',
  'schema > alter table > drop index': 'creates a non-unique index',
  'schema > alter table > add check constraint': 'check constraint',
  'schema > alter table > add unique constraint':
    'drops the unique constraint and the foreign key on the way to the DDL',
  'schema > alter table > add foreign key constraint': [
    'emits ON DELETE CASCADE on the foreign key',
    'emits every supported referential action',
    'creates the supporting index MySQL requires',
  ],
  'schema > alter table > add primary key constraint':
    'emits a composite primary key as two column constraints, which no dialect accepts',
  'schema > alter table > drop constraint': 'diffs a changed action into a drop and an add',
  'schema > alter table > rename constraint': oos(
    'Renaming a constraint has the same problem as dropping one by name, plus Postgres and MySQL ' +
      'spell it differently and SQLite cannot do it at all. The migration diff works in terms of ' +
      'tables and columns, which every dialect can alter, and a constraint change is expressed by ' +
      'the column declaration that produced it.',
    'indexes-constraints',
  ),
  'schema > alter table > rename': oos(
    'Renaming a table or a column is the one migration a snapshot diff cannot infer: a dropped ' +
      'column and an added column look exactly like a rename, and guessing wrong destroys data. ' +
      'zmdb emits the drop and the add it can prove, and a rename is a migration you write, ' +
      'which is the case where hand-written SQL is the right answer rather than a fallback.',
    'migrations',
  ),
  'schema > alter table > rename column': oos(
    'Renaming a table or a column is the one migration a snapshot diff cannot infer: a dropped ' +
      'column and an added column look exactly like a rename, and guessing wrong destroys data. ' +
      'zmdb emits the drop and the add it can prove, and a rename is a migration you write, ' +
      'which is the case where hand-written SQL is the right answer rather than a fallback.',
    'migrations',
  ),
  'schema > alter table > mixed column alterations': 'maps the target of an alter, in every dialect',
  'schema > alter table > set schema': 'qualifies an object with its schema',
  'schema > alter table > parse schema name': 'qualifies an object with its schema',

  // --- migration runner ----------------------------------------------------
  'migration > migrateToLatest': 'up applies all pending migrations and records versions asynchronously',
  'migration > migrateToLatest > *':
    'executes migrations in ascending version order regardless of input array ordering',
  'migration > migrateUp': 'up is idempotent (re-running applies nothing)',
  'migration > migrateDown': 'down rolls back the latest migration asynchronously',
  'migration > migrateDown > *':
    'handles failure during down rollback: does not revert recorded version if execution fails',
  'migration > migrateTo': 'CLI dispatch: up → status → down',
  'migration > migrateTo > *': 'executes migrations in ascending version order regardless of input array ordering',
  'migration > getMigrations': 'status reflects applied vs pending asynchronously',
  'file-migration-provider > *': oos(
    'FileMigrationProvider reads migrations off disk by directory convention. zmdb takes an array ' +
      "of migrations, so where they came from is the application's decision — a glob import, a " +
      'generated index, or a literal list. The ordering and failure semantics that actually matter ' +
      'are tested against that array, and a filesystem walk would only test the filesystem.',
    'migrations',
  ),

  // --- execution, transactions --------------------------------------------
  transaction: ['commits on success (BEGIN … COMMIT)', 'rolls back on throw (BEGIN … ROLLBACK)'],
  'controlled-transaction > *': [
    'nested savepoints use distinct names and release on success',
    'inner savepoint rollback preserves outer writes (outer commits)',
  ],
  'execute > executeTakeFirstOrThrow': 'findOne adds LIMIT 1',
  'execute > Kysely.executeQuery': 'round-trips create/find/update/delete against in-memory node:sqlite',
  'raw-query > raw queries': 'calls query(text, params) and returns rows by default (prepared: false)',
  'raw-sql > raw sql': 'allows unmapped raw Postgres/SQL operators to fall through as-written',
  'sql-injection > select': [
    'main query compiler escapes malicious inputs in table, columns, and wheres',
    'prevents SQL injection through quote breakout in single identifiers',
  ],
  'sanitize-identifiers > sanitize identifiers': 'escapes internal double quotes in PostgreSQL and SQLite identifiers',
  'handle-empty-in-lists-plugin > *': 'compiles empty whereIn to 1 = 0 and empty whereNotIn to 1 = 1',
  'safe-null-comparison-plugin > *':
    'compiles whereNotIn filtering null and undefined values to prevent three-valued logic traps',
  'camel-case > camel case': oos(NO_PLUGIN_LAYER, 'schema-declaration'),
  'immediate-value-plugin > *': oos(NO_PLUGIN_LAYER, 'raw-sql'),
  'plugin-composition > *': oos(NO_PLUGIN_LAYER, 'raw-sql'),
  clear: oos(NO_BUILDER_SURGERY, 'dynamic-queries'),
  explain: oos(NO_EXPLAIN, 'perf-queries'),
  'logging > *': oos(NO_QUERY_LOG, 'logging'),
  cancellation: oos(NO_CANCELLATION, 'query-cancellation'),
  'cancellation > *': oos(NO_CANCELLATION, 'query-cancellation'),
  'async-dispose > *': oos(NO_CANCELLATION, 'query-cancellation'),
  'introspect > getSchemas': 'reads tables, columns, nullability and primary keys from a real sqlite database',
  'introspect > getTables': [
    'reads tables, columns, nullability and primary keys from a real sqlite database',
    'reads indexes including a unique one and an expression one',
  ],
  'introspect > getTables > implicit autoincrement': 'recognises a serial column per dialect',
};

// ---------------------------------------------------------------------------
// Drizzle ORM — schema declaration and the query builder
// ---------------------------------------------------------------------------
export const drizzle = {
  // --- relational queries (db.query.x.findMany / findOne) ------------------
  // Drizzle's relational suite is 130 assertions over one API crossed with limit, where, orderBy,
  // partial select and nesting depth. zmdb's populate is the same feature.
  '[Find Many] Get users with posts': 'findById(id, { populate }) attaches the typed to-many relation',
  '[Find One] Get users with posts': 'findById(id, { populate }) attaches the typed to-many relation',
  '[Find Many] *': 'find(where, { populate }) attaches relations to every matching row',
  '[Find One] *': 'find(where, { populate }) attaches relations to every matching row',
  'Get user *invitee*': 'populates to-many and to-one relations returning widened entity types',
  'Get user with invitee and posts*': oos(
    "Drizzle resolves an arbitrarily deep nested read — user, their posts, each post's comments, " +
      "each comment's owner — in one call. zmdb populates one level: a relation of the row you " +
      'asked for. Deeper nesting is a second populate on the rows you got, which keeps the number ' +
      'of queries a reader can predict from the code rather than from the shape of the tree.',
    'relations',
  ),
  'Get user with posts and posts with comments*': oos(
    "Drizzle resolves an arbitrarily deep nested read — user, their posts, each post's comments, " +
      "each comment's owner — in one call. zmdb populates one level: a relation of the row you " +
      'asked for. Deeper nesting is a second populate on the rows you got, which keeps the number ' +
      'of queries a reader can predict from the code rather than from the shape of the tree.',
    'relations',
  ),
  'Get users with groups + custom':
    'AggregateSpec auto-resolves joins from relation references or explicit spec.joins in a single roundtrip',
  'Get groups with users + custom':
    'AggregateSpec auto-resolves joins from relation references or explicit spec.joins in a single roundtrip',
  'Get groups with users + orderBy + limit': 'find(where, { populate }) attaches relations to every matching row',
  'Filter by columns not present in select': 'filters using subqueries and EXISTS conditions on real SQLite',

  // --- schema declaration --------------------------------------------------
  'table config*': [
    'drops the unique constraint and the foreign key on the way to the DDL',
    'names a generated constraint deterministically',
  ],
  'define constraints as array*': [
    'drops the unique constraint and the foreign key on the way to the DDL',
    'emits a composite foreign key referencing a composite key',
  ],
  'Object keys as column names': 'names every declared column in every dialect',
  'prefixed table': 'names every declared column in every dialect',
  'all types': ['renders every column type for postgres', 'renders every column type for sqlite'],
  'all date and time columns*': [
    'writes a Date and reads a Date back',
    'stores it as the ISO-8601 text the DDL declares, which sorts chronologically',
  ],
  'timestamp timezone': 'binds it as ISO-8601 UTC text, since node:sqlite binds no object at all',
  'insert null timestamp': 'allows explicit null for nullable json columns while rejecting primitives',
  'insert bigint values': 'hands a Date and a bigint over untouched',
  'array types': oos(NO_JSON_PATH, 'json-properties'),
  'array mapping and parsing': oos(NO_JSON_PATH, 'json-properties'),
  'array operators': oos(NO_JSON_PATH, 'json-properties'),
  'network types': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'char *': 'renders every column type for mysql',
  'select from enum': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'select from enum as ts enum': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  '$default function': 'accepts the payload every column is happy with',
  'test $onUpdateFn and $onUpdate works*': oos(
    'Drizzle can attach a function to a column that runs on every update, so updatedAt maintains ' +
      'itself. zmdb writes what the payload says and nothing else: a value that appears in the ' +
      'row without appearing in the call is a value no reader of the call can predict. A lifecycle ' +
      'hook is the place for it, and hooks fire in a tested order around every write.',
    'lifecycle-hooks',
  ),
  'insert multiple rows into table with generated identity column': 'refuses a database-generated column on insert',
  'insert with auto increment': 'keys a MySQL auto-increment column, one way or the other',
  'proper json and jsonb handling': 'accepts valid object and array payloads for json columns on create and update',
  'set json/jsonb fields*': oos(NO_JSON_PATH, 'json-properties'),
  'set null to jsonb field': 'allows explicit null for nullable json columns while rejecting primitives',
  'json insert': 'accepts valid object and array payloads for json columns on create and update',

  // --- select --------------------------------------------------------------
  'select all fields': 'findById compiles a SELECT and maps the row',
  'select partial': 'compiles where + orderBy + limit',
  'select distinct': oos(
    'SELECT DISTINCT and DISTINCT ON are a de-duplication step over a result set. zmdb has no ' +
      'distinct method: the reads it compiles are keyed reads, relation loads and grouped ' +
      'aggregates, and a grouped aggregate already collapses duplicates by the columns you named. ' +
      'A bare DISTINCT is usually a missing GROUP BY, and the aggregate builder is where it goes.',
    'aggregations',
  ),
  'select sql': 'expr() emits a raw computed expression with alias',
  'select typed sql': 'expr() emits a raw computed expression with alias',
  'select from sql': 'allows unmapped raw Postgres/SQL operators to fall through as-written',
  'select from raw sql*': 'allows unmapped raw Postgres/SQL operators to fall through as-written',
  'select from alias': 'self-join with aliases',
  'select a field without joining its table': 'left join with qualified on-columns',
  'table selection with single table': 'findById compiles a SELECT and maps the row',
  'select with group by*': [
    'groups by multiple columns',
    'groupBy + having + orderBy + pagination compose in the right order',
  ],
  having: 'having filters grouped results',
  'select with exists': 'compiles whereExists and orWhereExists clauses',
  'select with empty array in inArray': 'compiles empty whereIn to 1 = 0 and empty whereNotIn to 1 = 1',
  'select with empty array in notInArray': 'compiles empty whereIn to 1 = 0 and empty whereNotIn to 1 = 1',
  'select count()': 'grouped count + sum returns typed computed columns',
  'select count w/ custom mapper': 'grouped count + sum returns typed computed columns',
  '$count *': 'grouped count + sum returns typed computed columns',
  'aggregate function: *': 'count, sum, avg, min and max each project one aggregate with its alias',
  'orderBy with aliased column': 'compiles where + orderBy + limit',
  'limit 0': 'compiles where + orderBy + limit',
  'limit -1': 'compiles where + orderBy + limit',
  'test if method with sql operators': 'allows unmapped raw Postgres/SQL operators to fall through as-written',
  'select for': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'select + .get() for empty result': 'findOne adds LIMIT 1',
  'sql.identifier escape': 'escapes internal double quotes in PostgreSQL and SQLite identifiers',
  'insert with spaces': 'escapes internal double quotes in PostgreSQL and SQLite identifiers',

  // --- subqueries and joins -----------------------------------------------
  'join subquery': 'compiles scalar comparison and IN subqueries with sequential parameter offsets',
  'join subquery with join': 'compiles multi-level nested subqueries with continuous parameter renumbering',
  'select from a one subquery': 'compiles scalar comparison and IN subqueries with sequential parameter offsets',
  'select from a many subquery': 'compiles scalar comparison and IN subqueries with sequential parameter offsets',
  'select all fields from subquery without alias':
    'compiles scalar comparison and IN subqueries with sequential parameter offsets',
  'select from subquery sql': 'compiles multi-level nested subqueries with continuous parameter renumbering',
  'partial join with alias': 'mixes left + inner joins with aliases',
  'full join with alias': oos(
    'A FULL OUTER JOIN keeps unmatched rows from both sides, which SQLite and MySQL do not have. ' +
      'zmdb compiles inner, left and right joins because all three dialects run all three, and a ' +
      'builder method that works on one of them is a portability trap dressed as a feature.',
    'joins',
  ),
  'left join (lateral)': oos(NO_EXOTIC_JOIN, 'joins'),
  'left join (*': [
    'left join keeps the orphan product (null supplier)',
    'findJoined left-joins product→supplier and returns flat rows',
  ],
  'inner join (lateral)': oos(NO_EXOTIC_JOIN, 'joins'),
  'cross join*': oos(NO_EXOTIC_JOIN, 'joins'),
  'join on aliased sql from select': 'self-join with alias still compiles (regression from #85)',
  'join on aliased sql from with clause': oos(NO_CTE, 'select'),

  // --- insert / update / delete -------------------------------------------
  'insert + select': 'create → findById → update → delete round-trip',
  'insert sql': 'INSERT ... RETURNING',
  'insert many': 'commits all writes in a batch',
  'insert many with returning': 'INSERT ... RETURNING',
  'insert with default values': 'accepts the payload every column is happy with',
  'insert with overridden default values': 'accepts the payload every column is happy with',
  '*Insert all defaults in *': 'accepts the payload every column is happy with',
  'query check: insert single empty row': 'accepts the payload every column is happy with',
  'query check: insert multiple empty rows': 'accepts the payload every column is happy with',
  'insert undefined': 'leaves an explicitly undefined key alone, so a spread still works',
  'update undefined': 'update strips explicit undefined properties before payload validation',
  'insert into - select*': oos(
    'INSERT ... SELECT copies rows inside the database, so the values never reach the ' +
      'application and never reach the validator either. Every zmdb write is validated against ' +
      'the declared type before it compiles, which is the guarantee the whole design is for; a ' +
      'statement whose values are a query is a hole in it, and raw SQL is the honest way to it.',
    'raw-sql',
  ),
  'insert returning sql': 'INSERT ... RETURNING',
  'update returning sql': 'UPDATE ... SET ... WHERE',
  'delete returning sql': 'DELETE ... WHERE',
  'insert with onConflict do nothing*': 'compiles PostgreSQL ON CONFLICT DO NOTHING with and without target',
  'insert with onConflict do update*': [
    'compiles PostgreSQL ON CONFLICT DO UPDATE (default non-target columns)',
    'compiles PostgreSQL ON CONFLICT DO UPDATE with specific update columns',
  ],
  'insert with onConflict chained*': 'compiles SQLite ON CONFLICT DO UPDATE and DO NOTHING',
  'build query insert with onConflict*': 'compiles PostgreSQL ON CONFLICT DO UPDATE with custom field values',
  'update with returning all fields': 'update validates a partial patch then updates',
  'update with returning partial': 'update validates a partial patch then updates',
  'delete with returning all fields': 'delete compiles a DELETE and reports success',
  'delete with returning partial': 'delete compiles a DELETE and reports success',
  'update with limit and order by': 'compiles where + orderBy + limit',
  'delete with limit and order by': 'compiles where + orderBy + limit',
  'update - from*': oos(
    'UPDATE ... FROM sets columns from a join against another table, so the values written are ' +
      'chosen by the database rather than by the caller. zmdb validates every write against the ' +
      'declared type before compiling it, and a patch whose values are a subquery cannot be ' +
      'validated at all. Read, then write what you decided, or drop to raw SQL deliberately.',
    'raw-sql',
  ),

  // --- CTEs, views, set operations ----------------------------------------
  'with - *': oos(NO_CTE, 'select'),
  '* as cte': oos(NO_CTE, 'select'),
  'sql operator as cte': oos(NO_CTE, 'select'),
  view: 'creates a plain view',
  'materialized view': 'creates a materialized view (pg)',
  'select from existing view': 'creates a plain view',
  'subquery with view': 'creates a plain view',
  'join view as subquery': 'creates a plain view',
  'set operations *': [
    'UNION joins two selects with renumbered placeholders (pg)',
    'UNION ALL / INTERSECT / EXCEPT keywords',
  ],

  // --- prepared statements, transactions, misc ----------------------------
  'prepared statement': 'runs as prepared statement when prepared: true is passed',
  'prepared statement reuse':
    'reuses prepared statement references and runs regex at most once per unique query string',
  'prepared statement with placeholder in *': 'compiles andWhere with sequential placeholders',
  'prepared statement built using $dynamic': oos(NO_BUILDER_SURGERY, 'dynamic-queries'),
  'insert: placeholders on columns with encoder': 'compiles andWhere with sequential placeholders',
  'async api - *': 'round-trips create/find/update/delete against in-memory node:sqlite',
  'insert via db.*': 'round-trips create/find/update/delete against in-memory node:sqlite',
  transaction: 'commits on success (BEGIN … COMMIT)',
  'transaction rollback': 'rolls back on throw (BEGIN … ROLLBACK)',
  'nested transaction': 'nested savepoints use distinct names and release on success',
  'nested transaction rollback': 'inner savepoint rollback preserves outer writes (outer commits)',
  'build query': 'compile() is pure (twice → equal)',
  'toSQL()': 'compile() is pure (twice → equal)',
  // Drizzle re-runs a slice of the whole suite against a non-default schema. What is being
  // asserted across all twenty is one thing: every statement carries the schema qualifier.
  'mySchema - *': 'qualifies an object with its schema',
  policy: 'creates a policy (default command ALL)',
  'Enable RLS function': 'enables RLS on a table (pg)',
};

// ---------------------------------------------------------------------------
// MikroORM — the repository and unit of work
// ---------------------------------------------------------------------------
export const mikroOrm = {
  'entity-manager': [
    'create → findById → update → delete round-trip',
    'findAll returns plain data objects (no proxy / no class instance)',
  ],
  'query-builder': ['compiles where + orderBy + limit', 'find(where: WhereDTO) compiles typed filter to SQL'],
  'schema-generator': [
    'renders every column type for postgres',
    'renders every column type for mysql',
    'renders every column type for sqlite',
  ],
  migrations: [
    'creates the version table, and creating it again is not an error',
    'up applies all pending migrations and records versions asynchronously',
    'down rolls back the latest migration asynchronously',
  ],
  transactions: [
    'commits on success (BEGIN … COMMIT)',
    'rolls back on throw (BEGIN … ROLLBACK)',
    'savepoint releases on success',
  ],
  'disable-transactions': 'routes repository SQL through the active transaction',
  upsert: [
    'upsert atomically inserts or updates single record on conflict',
    'upsert with specific updateFields selectively updates columns on conflict',
  ],
  'pivot-table-upsert': 'upsert formats target and updateFields SQL',
  'batch-insert': 'commits all writes in a batch',
  truncate: 'delete compiles a DELETE and reports success',
  'count-by': 'grouped count + sum returns typed computed columns',
  'load-count-where': 'summarizes child metrics grouped by parent attributes in a single SQLite query',
  'cursor-based-pagination': [
    'paginates forward across custom sorted datasets with zero duplication or omission',
    'filters with user where condition during cursor pagination',
  ],
  'paginate-flag': 'list returns a ListResult with hasMore trimming (limit+1)',
  'partial-loading': 'compiles where + orderBy + limit',
  'populate-hints': 'findById(id, { populate }) attaches the typed to-many relation',
  'populate-limit': oos(
    'A per-relation limit on a populate — "each user\'s three most recent orders" — needs either ' +
      'a window function or one query per parent, and MikroORM picks per-dialect strategies to ' +
      'get there. zmdb runs exactly one batched IN query per relation and says so; a hint that ' +
      'silently turns one query into N is the thing that design exists to rule out.',
    'relations',
  ),
  collection: 'attaches child orders to each user, as plain rows (no shared refs)',
  'non-pk-relation-target': 'a read that does not populate attaches nothing',
  'composite-keys': [
    'findById compiles parameterized multi-column SQL predicates',
    'throws ValidationError at runtime when composite key is missing fields or non-object',
  ],
  'sharing-column-in-composite-fk': 'update compiles complete compound key predicates for composite key entities',
  'custom-types': [
    'round-trips',
    'flatten prefixes each field with the column prefix',
    'emits CREATE EXTENSION IF NOT EXISTS before any table that uses it',
    'renders a parameterised extension type',
    'refuses an extension type on mysql, naming the dialect and the type',
    'refuses an extension type on sqlite, naming the dialect and the type',
    'derives number[] with the dimension as minItems and maxItems in JSON Schema',
    'does not drop an extension on diff',
  ],
  embeddables: [
    'flatten prefixes each field with the column prefix',
    'lift extracts prefixed columns back into a value object',
  ],
  'default-values': 'accepts the payload every column is happy with',
  'generated-columns': ['stored generated column', 'virtual generated column (no STORED)'],
  'check-constraint': 'check constraint',
  createForeignKeyConstraint: [
    'emits ON DELETE CASCADE on the foreign key',
    'names a generated constraint deterministically',
  ],
  'custom-order': [
    'compiles where + orderBy + limit',
    'orders by a cosine distance with the query vector parameterised',
  ],
  'entity-default-order': 'compiles where + orderBy + limit',
  'multiple-schemas': 'qualifies an object with its schema',
  'multiple-schemas-entity-manager': 'qualifies an object with its schema',
  wilcardSchemaIndex: 'qualifies an object with its schema',
  'attach-database': 'qualifies an object with its schema',
  naming: [
    'applies the column strategy once, into the IR',
    'leaves physicalName equal to name when no strategy is configured',
    'lets an explicit column name beat the strategy',
    'fails the build when two properties collide on one physical name, naming both',
    'emits DDL with physical names and derives Entity with property names',
    'derives an index name from physical names',
    'records physical names in the snapshot',
    'does not rewrite a raw SQL fragment',
    'resolves naming before query compilation without runtime strategy calls',
  ],
  fulltext: ['findByFullText returns rows matching the term', 'findByFullText excludes non-matching rows'],
  'view-entities': ['creates a plain view', 'creates a materialized view (pg)'],
  'virtual-entities': 'creates a plain view',
  'raw-queries': [
    'allows unmapped raw Postgres/SQL operators to fall through as-written',
    'projects a distance as a selected column with an alias',
    'emits ST_DWithin as a predicate with typed arguments',
    'refuses a caller-supplied distance operator string',
  ],
  'read-replicas': [
    'routes writes to primary, reads to replicas (round-robin)',
    'falls back to primary when no replicas',
  ],
  'balanced-strategy': 'routes writes to primary, reads to replicas (round-robin)',
  seeder: [
    'seedRows is reproducible for the same seed+count',
    'generated values respect column types; auto-inc id omitted',
  ],
  events: 'fires preInsert then postInsert around create, in order',
  'event-manager': ['emits to matching subscribers in order', 'unsubscribe removes exactly that subscriber'],
  validation: 'rejects an invalid create with ValidationError and writes nothing',
  'find-one-or-fail-strict': 'findOne adds LIMIT 1',
  serialization: 'encodes a row back to the forms the published document describes',
  accessors: 'lift extracts prefixed columns back into a value object',
  inheritance: ['discriminatorFor returns the type tag', 'rowToSubtype reads the discriminator + subtype columns'],
  'using-index-hints': oos(
    'An index hint tells the planner which index to use, in syntax each engine spells its own way ' +
      'and MySQL and Postgres disagree about having at all. zmdb generates the indexes the ' +
      'declaration asks for and then trusts the planner; a hint compiled into a portable builder ' +
      'is advice that is wrong on two of the three dialects it would be emitted for.',
    'perf-queries',
  ),
  filters: [
    'applies a declared filter to every single-table read',
    'applies the target filter when populating a to-one relation',
    'applies the target filter to the batched query of a to-many populate',
    'applies a filter to an aggregation and a group-by',
    'applies a write filter to updateMany and deleteMany',
    'throws when a parameterised filter is called without its parameter, naming the filter',
    'disables one named filter for one call and leaves the others applied',
    'soft-deletes by updating rather than deleting, and hides the row from subsequent reads',
    'reads soft-deleted rows only when the filter is explicitly disabled',
    'applies a filter before LIMIT rather than post-filtering rows',
  ],
  formulas: oos(
    'A formula property is a SQL expression that loads as if it were a column, so a read of an ' +
      'entity silently evaluates it. zmdb projects computed values through the aggregate ' +
      "builder's expr(), where the expression sits next to the query that needs it rather than " +
      'on the type, and a plain read stays a plain read of declared columns.',
    'aggregations',
  ),
  'unit-of-work': oos(NO_IDENTITY_MAP, 'inert-rows'),
  'auto-flush': oos(NO_IDENTITY_MAP, 'inert-rows'),
  'auto-refreshing': oos(NO_IDENTITY_MAP, 'inert-rows'),
  refresh: oos(NO_IDENTITY_MAP, 'inert-rows'),
  hydration: oos(NO_IDENTITY_MAP, 'inert-rows'),
  clone: oos(NO_IDENTITY_MAP, 'inert-rows'),
  'entity-assigner': oos(NO_IDENTITY_MAP, 'inert-rows'),
  'lazy-ref': oos(NO_IDENTITY_MAP, 'loading-strategies'),
  'lazy-scalar-properties': oos(NO_IDENTITY_MAP, 'loading-strategies'),
  'optimistic-lock': oos(NO_IDENTITY_MAP, 'inert-rows'),
  'concurrency-checks': oos(NO_IDENTITY_MAP, 'inert-rows'),
  dataloader: [
    'coalesces findById calls in one tick into a single IN query',
    'fetches a duplicated id once and resolves both callers',
    'resolves undefined for an id the batch did not return',
    'rejects every call in a batch when the driver errors',
    'does not share loaded rows between two scopes',
    'does not batch across ticks',
  ],
  'joined-strategy': oos(
    'MikroORM can load a relation either as a JOIN or as a second SELECT, and the strategy is ' +
      'configurable per entity or per query. zmdb picks by cardinality and says which: a to-one ' +
      'is a join, a to-many is a batched IN. The number of queries a populate runs is then a fact ' +
      'about the relation rather than about configuration two files away.',
    'loading-strategies',
  ),
  'single-table-inheritance': oos(NO_INHERITANCE_MAPPING, 'inheritance'),
  'table-per-type-inheritance': oos(NO_INHERITANCE_MAPPING, 'inheritance'),
  'polymorphic-relations': oos(NO_INHERITANCE_MAPPING, 'inheritance'),
  'loadable-mixin': oos(NO_INHERITANCE_MAPPING, 'inheritance'),
  decorators: oos(NO_ENTITY_METADATA, 'pure-typescript'),
  reflection: oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'entity-generator': oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'define-entity-setclass': oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'duplicate-class-names': oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'custom-entity-manager': oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'compiled-functions': oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'special-object-keys': oos(NO_ENTITY_METADATA, 'pure-typescript'),
  'result-cache': [
    'serves a second identical query from the cache',
    'treats a differently-typed parameter as a different key',
    'expires a cached result after its TTL',
    'invalidates by tag on a write to the table',
    'does not cache anything when no cache option is given',
    'misses a shared-store value when the schema fingerprint changes',
  ],
  'cache-adapters': [
    'treats a differently-typed parameter as a different key',
    'expires a cached result after its TTL',
    'invalidates by tag on a write to the table',
    'does not cache anything when no cache option is given',
    'misses a shared-store value when the schema fingerprint changes',
  ],
  'stored-routines': [
    'emits CREATE OR REPLACE FUNCTION with a dollar-quoted body',
    'chooses a safe dollar-quote tag when the body contains $$',
    'emits a MySQL function as a drop-then-create pair',
    'refuses a routine on sqlite, naming the routine',
    're-emits a routine when its body changes',
    'does not re-emit when only trailing whitespace differs',
    'compiles a function call to SELECT with bound arguments',
    'compiles a procedure call to CALL with bound arguments',
    'types a set-returning function as rows',
    'validates arguments against the declared parameter types before calling',
    'calls a real function',
  ],
  trigger: oos(NO_DATABASE_TRIGGERS, 'stored-routines'),
  'native-enums': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'deferrable-constraints': oos(NO_DIALECT_ONLY_SYNTAX, 'dialect-postgres'),
  'get-kysely': oos(NO_MIKRO_KYSELY, 'raw-sql'),
  'get-kysely-transaction-context': oos(NO_MIKRO_KYSELY, 'raw-sql'),
  'mikro-kysely-plugin': oos(NO_MIKRO_KYSELY, 'raw-sql'),
  'kysely-convert-values-where-clause': oos(NO_MIKRO_KYSELY, 'raw-sql'),
  'reusing-kysely-client': oos(NO_MIKRO_KYSELY, 'raw-sql'),
  'native-query-builder': oos(NO_MIKRO_KYSELY, 'raw-sql'),
  streaming: oos(NO_STREAMING_CURSOR, 'streaming'),
  cancellation: oos(NO_CANCELLATION, 'query-cancellation'),
  'on-reserve-connection': oos(NO_CANCELLATION, 'query-cancellation'),
  'terminated-connection': oos(NO_CANCELLATION, 'query-cancellation'),
  logging: oos(NO_QUERY_LOG, 'logging'),
  cli: 'emits machine-readable output under --json for every command',
};

// ---------------------------------------------------------------------------
// NestJS — the HTTP application framework
// ---------------------------------------------------------------------------
export const nestjs = {
  'hello-world/e2e/hello-world': 'routes a request to a module controller',
  'hello-world/e2e/guards': 'short-circuits with ChainError(403) when a guard returns false',
  'hello-world/e2e/interceptors': 'runs guard → pipe → interceptor(before) → handler → interceptor(after)',
  'hello-world/e2e/local-pipes': 'pipes fold the body left-to-right',
  'hello-world/e2e/exceptions': 'a matching exception filter maps a thrown handler error',
  'hello-world/e2e/middleware': 'runs guard → pipe → interceptor(before) → handler → interceptor(after)',
  'hello-world/e2e/middleware-class': 'runs guard → pipe → interceptor(before) → handler → interceptor(after)',
  'hello-world/e2e/middleware-execute-order': 'runs guard → pipe → interceptor(before) → handler → interceptor(after)',
  'hello-world/e2e/schema-in-pipes': [
    'passes a valid body through (typed)',
    'rejects an invalid body via the chain (400)',
  ],
  'hello-world/e2e/standard-schema-serializer': [
    'serializes the handler result via the provided serializer',
    'composes validation + serialization',
  ],
  'hello-world/e2e/router-module': 'records routes with composed paths in declaration order',
  'hello-world/e2e/router-module-middleware': 'records routes with composed paths in declaration order',
  'hello-world/e2e/adapter': 'handles via the Fetch adapter',
  'hello-world/e2e/force-console': oos(NO_QUERY_LOG, 'web-logging'),
  'hello-world/e2e/exclude-middleware': oos(
    'NestJS applies middleware by route pattern with exclusions, so whether a request passes ' +
      'through a piece of middleware is computed from a path matcher configured elsewhere. zmdb ' +
      'composes guards, pipes and interceptors onto the controller they belong to, so the chain a ' +
      'request runs is readable from the handler rather than from a registration order.',
    'web-middleware',
  ),
  'hello-world/e2e/middleware-before-init': oos(NO_PLATFORM_ADAPTER, 'web-overview'),
  'hello-world/e2e/middleware-with-versioning': 'runs route guards only for the selected version',
  'hello-world/e2e/instance': oos(NO_PLATFORM_ADAPTER, 'web-overview'),
  'hello-world/e2e/multiple': oos(NO_PLATFORM_ADAPTER, 'web-overview'),
  'query-method/e2e/query-method': 'strips the query string from the path',
  'cors/e2e/': oos(NO_PLATFORM_ADAPTER, 'web-middleware'),
  'send-files/e2e/': oos(NO_PLATFORM_ADAPTER, 'web-overview'),
  'nest-application/sse/e2e/': 'frames an async iterable as SSE',
  'nest-application/global-prefix/e2e/global-prefix': 'composes an empty prefix and root paths correctly',
  'nest-application/*': oos(NO_PLATFORM_ADAPTER, 'web-overview'),
  'injector/e2e/injector': ['registers and resolves an instance', 'populates injected fields from the container'],
  'injector/e2e/multiple-providers': 'builds controllers with providers resolved from imports',
  'injector/e2e/default-values': 'throws UnresolvedTokenError for an unregistered token',
  'injector/e2e/inherited-optional': 'throws UnresolvedTokenError for an unregistered token',
  'injector/e2e/optional-factory-provider-dep': 'throws UnresolvedTokenError for an unregistered token',
  'injector/e2e/property-injection': 'populates injected fields from the container',
  'injector/e2e/core-injectables': 'builds controllers with providers resolved from imports',
  'injector/e2e/for-root-for-feature-resolution': 'compiles an import chain without controllers',
  'injector/e2e/many-global-modules': 'compiles an import chain without controllers',
  'injector/e2e/circular*': oos(
    'NestJS resolves circular dependencies with forwardRef, which needs a two-phase injector that ' +
      'can hand out an unfinished instance. zmdb resolves providers in one pass and a cycle is an ' +
      'error, because a provider holding a reference to something not yet constructed is a bug ' +
      'that shows up later and further away than the declaration that caused it.',
    'web-di',
  ),
  'injector/e2e/introspection': 'describes the large fixture graph',
  'injector/e2e/scoped-instances': oos(NO_REQUEST_SCOPE, 'web-injection-scopes'),
  'injector/e2e/parallel-request-scoped-resolution': oos(NO_REQUEST_SCOPE, 'web-injection-scopes'),
  'injector/e2e/request-scope*': oos(NO_REQUEST_SCOPE, 'web-injection-scopes'),
  'injector/e2e/request-scoped-factory-provider': oos(NO_REQUEST_SCOPE, 'web-injection-scopes'),
  'scopes/e2e/transient-scope': 'resolves transient providers fresh each time; singletons cached',
  'scopes/e2e/*': oos(NO_REQUEST_SCOPE, 'web-injection-scopes'),
  'lazy-modules/e2e/*': 'constructs a lazy module provider on the first request to its route, not at startup',
  'module-utils/test/integration-module': 'builds controllers with providers resolved from imports',
  'hooks/e2e/on-module-init': 'runs init hooks in order and onShutdown on dispose (reversed)',
  'hooks/e2e/on-app-bootstrap': 'runs init hooks in order and onShutdown on dispose (reversed)',
  'hooks/e2e/lifecycle-hook-order': 'runs the same lifecycle hooks as createApp, in order',
  'hooks/e2e/on-module-destroy': 'runs init hooks in order and onShutdown on dispose (reversed)',
  'hooks/e2e/on-app-shutdown': 'runs init hooks in order and onShutdown on dispose (reversed)',
  'hooks/e2e/before-app-shutdown': 'runs init hooks in order and onShutdown on dispose (reversed)',
  'hooks/e2e/enable-shutdown-hook': oos(
    'enableShutdownHooks makes NestJS listen for SIGTERM and run its shutdown sequence. zmdb ' +
      'exposes dispose() and runs the hooks in reverse registration order; which process signal ' +
      "should call it is the application's decision, and a framework that installs its own " +
      'signal handler is a framework fighting whatever supervises the process.',
    'web-overview',
  ),
  'graceful-shutdown/e2e/': 'runs init hooks in order and onShutdown on dispose (reversed)',
  'testing-module-override/e2e/modules-override': 'applies a provider override (stub is injected)',
  'auto-mock/test/bar.service': 'applies a provider override (stub is injected)',
  'discovery/e2e/discover-by-meta': 'reads back metadata a Stage-3 decorator wrote — no reflect-metadata, no as',
  'route-conflict/e2e/conflict-policy': 'lets the first-declared route win when two match',
  'route-conflict/e2e/resolution-strategy': [
    'keeps identically-shaped routes of different methods apart',
    '404s a path whose segment count matches no route',
  ],
  'route-conflict/e2e/wildcard*': 'collapses duplicate slashes and strips trailing slashes',
  'route-conflict/e2e/versioned-wildcard': 'preserves first-registered route ordering within one version bucket',
  'versioning/e2e/custom-versioning': oos(NO_CUSTOM_VERSIONING, 'web-versioning'),
  'versioning/e2e/default-versioning': [
    'uses the configured default when the request names no version',
    'uses the configured default when Accept names no version',
  ],
  'versioning/e2e/header-versioning': [
    'routes a request to the handler for its declared version',
    'returns 400 with the route-specific supported versions for an unknown version',
    'lets a version-specific route shadow a neutral route regardless of registration order',
  ],
  'versioning/e2e/media-type-versioning': [
    'selects the highest-quality acceptable version',
    'treats q=0 as a prohibition rather than selecting that version',
    'returns 406 with supported versions for an unknown media-type version',
  ],
  'versioning/e2e/uri-versioning':
    'expands one multi-version route at registration and leaves routing metadata unchanged',
  'inspector/e2e/graph-inspector': 'describes the large fixture graph',
  'repl/e2e/*': [
    'boots the container and resolves a provider in the repl scope',
    'does not start an HTTP listener',
    'the repl does not listen on a non-loopback address',
    'awaits and prints a promise result',
    'releases connections on exit',
  ],
  'websockets/e2e/*': oos(NO_WEBSOCKETS, 'web-gateways'),
  'microservices/e2e/disconnected-client': 'a transport send failure reaches the caller',
  'microservices/e2e/sum-rpc': [
    'request handlers return a correlated result reply',
    'two concurrent calls resolve their own replies when responses arrive out of order',
  ],
  'microservices/e2e/sum-rpc-async': 'request handlers return a correlated result reply',
  'microservices/e2e/sum-rpc-tls': oos(NO_MICROSERVICE_TCP, 'web-microservices'),
  'microservices/e2e/tcp-json-socket-pipeline': oos(NO_MICROSERVICE_TCP, 'web-microservices'),
  'graphql-code-first/e2e/*': oos(NO_GRAPHQL, 'web-graphql'),
  'graphql-schema-first/e2e/*': oos(NO_GRAPHQL, 'web-graphql'),
  'typeorm/e2e/*': oos(
    'These assert that a third-party module can be wired in with forRoot and forRootAsync. zmdb ' +
      'is the data layer as well as the HTTP layer, so a database module to configure ' +
      'asynchronously is not a thing it composes with — the repository takes a driver, and the ' +
      'driver is constructed by the application before the app is.',
    'repository',
  ),
};

// ---------------------------------------------------------------------------
// Typia — AOT validation
// ---------------------------------------------------------------------------
export const typia = {
  is: ['inlines `is<T>` from the checker', 'accepts and rejects exactly what the runtime walker does'],
  assert: [
    'inlines `assert<T>` to a throw against the real error class',
    'throws the real AssertError, imported rather than redeclared',
  ],
  validate: ['reports every failure with an exact nested path', 'each issue carries expected/value/message'],
  assertEquals: 'strict rejects excess keys with a structured issue',
  validateEquals: 'agrees about excess properties',
  equals: 'strict rejects excess keys',
  'compare.equals': 'strict rejects excess keys',
  'compare.createEquals': oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  IValidation: 'each issue carries expected/value/message',
  'IValidation.ISuccess': 'allocates no issue on a valid input',
  random: 'builds a value its own check accepts',
  Resolved: 'reads a nested property directly rather than binding it',
  literals: 'spells a small literal union as a comparison chain',
  'reflect.schema': 'reads back metadata a Stage-3 decorator wrote — no reflect-metadata, no as',
  'reflect.schemas': 'the committed witness makes exactly the calls the plugin fixture still makes',
  'reflect.literals': 'switches to a hoisted Set once a literal union gets wide',
  'reflect.name': 'names the helper after the type, so generated code is readable',
  'json.schema': 'describes the create body the type describes',
  'json.schemas': 'embeds the documents in the OpenAPI document',
  'json.application': 'emits a 3.1 doc with paths and converted path params',
  'json.stringify': 'produces a response JSON.stringify can actually serialize',
  'json.assertStringify': 'encodes a row back to the forms the published document describes',
  'json.validateStringify': 'encodes a list, because a findMany result is one',
  'json.isStringify': 'produces a response JSON.stringify can actually serialize',
  'json.assertParse': 'decodes the two types JSON cannot carry, and copies the rest through',
  'json.isParse': 'decodes before validating, so the ISO string a body carries reaches the handler as a Date',
  'json.validateParse': 'still reports what the decode could not convert, as a 400 from the validator',
  'json.isEncode': 'produces a response JSON.stringify can actually serialize',
  'json.assertEncode': 'encodes a row back to the forms the published document describes',
  'json.validateEncode': 'encodes a list, because a findMany result is one',
  'protobuf.assertDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.assertEncode': 'produces bytes a reference implementation decodes',
  'protobuf.createAssertDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.createDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.createEncode': 'produces bytes a reference implementation decodes',
  'protobuf.createIsDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.createValidateDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.decode': 'decodes bytes produced by a reference implementation',
  'protobuf.encode': 'produces bytes a reference implementation decodes',
  'protobuf.isDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.isEncode': 'produces bytes a reference implementation decodes',
  'protobuf.message': 'emits a .proto descriptor that a reference parser accepts',
  'protobuf.validateDecode': 'decodes bytes produced by a reference implementation',
  'protobuf.validateEncode': 'produces bytes a reference implementation decodes',
  'llm.schema': 'produces a schema an LLM tool call can be validated against',
  'llm.parameters': 'produces a schema an LLM tool call can be validated against',
  'llm.application': 'produces a schema an LLM tool call can be validated against',
  'llm.controller': oos(
    'typia.llm.controller turns a class of methods into a tool-calling application, so the ' +
      'framework decides which function an LLM may invoke. zmdb generates the JSON Schema for a ' +
      "function's parameters and validates a call against it, and leaves dispatch to the " +
      'application, which is where the authorization decision about calling it also lives.',
    'llm-json-schema',
  ),
  'llm.structuredOutput': 'produces a schema an LLM tool call can be validated against',
  'llm.parse': 'decodes the two types JSON cannot carry, and copies the rest through',
  'llm.coerce': 'coerce.number converts numeric strings',
  'llm.createCoerce': oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  'llm.createParse': oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  'tags.Type': 'respects bounds',
  'tags.Minimum': 'inlines Min',
  'tags.Maximum': 'enforces the bounds the schema declares',
  'tags.ExclusiveMinimum': 'enforces the bounds the schema declares',
  'tags.ExclusiveMaximum': 'enforces the bounds the schema declares',
  'tags.MultipleOf': 'respects bounds',
  'tags.MinLength': 'enforces a pattern, and the length a varchar implies',
  'tags.MaxLength': 'inlines MaxLength',
  'tags.MinItems': 'walks an array with a counted for loop, not a callback',
  'tags.MaxItems': 'walks an array with a counted for loop, not a callback',
  'tags.Pattern': [
    'inlines Pattern safely with escaped slashes and quotes',
    'Pattern evaluation parity between runtime fallback and compiled inline checks',
  ],
  'tags.Format': 'enforces a pattern, and the length a varchar implies',
  'tags.TagBase': 'a branded value is its base value at runtime — zero footprint',
  assertGuard: oos(
    'typia.assertGuard<T>(x) narrows its argument through a TypeScript assertion signature rather ' +
      "than returning the value. zmdb's assert returns what it validated, which composes: the " +
      'result is the input at a narrower type and can be handed straight on. An assertion ' +
      'signature only narrows a variable already in scope, so it cannot be used in an expression.',
    'validators-assert',
  ),
  assertGuardEquals: oos(
    'typia.assertGuard<T>(x) narrows its argument through a TypeScript assertion signature rather ' +
      "than returning the value. zmdb's assert returns what it validated, which composes: the " +
      'result is the input at a narrower type and can be handed straight on. An assertion ' +
      'signature only narrows a variable already in scope, so it cannot be used in an expression.',
    'validators-assert',
  ),
  createIs: oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  createAssert: oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  createValidate: oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  createRandom: oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  createValidateEquals: oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  createClone: oos(NO_CLONE_PRUNE, 'validators-shallow'),
  'json.createStringify': oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  'json.createAssertParse': oos(NO_FACTORY_FORM, 'jit-vs-aot'),
  'plain.*': oos(NO_CLONE_PRUNE, 'validators-shallow'),
  'notations.*': oos(NO_NAME_NOTATION, 'naming-strategy'),
  CamelCase: oos(NO_NAME_NOTATION, 'naming-strategy'),
  PascalCase: oos(NO_NAME_NOTATION, 'naming-strategy'),
  SnakeCase: oos(NO_NAME_NOTATION, 'naming-strategy'),
  KebabCase: oos(NO_NAME_NOTATION, 'naming-strategy'),
  'http.*': oos(NO_HTTP_DECODERS, 'web-validation'),
};

export const MAPPING = {
  kysely: kysely,
  drizzle: drizzle,
  'mikro-orm': mikroOrm,
  nestjs: nestjs,
  typia: typia,
};

/** Every distinct out-of-scope argument, for the anti-patterns page and the gate's summary. */
export function outOfScope() {
  const seen = new Map();
  for (const [source, table] of Object.entries(MAPPING)) {
    for (const [suite, target] of Object.entries(table)) {
      if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
      const existing = seen.get(target.outOfScope);
      if (existing) existing.suites.push(`${source}: ${suite}`);
      else seen.set(target.outOfScope, { reason: target.outOfScope, see: target.see, suites: [`${source}: ${suite}`] });
    }
  }
  return [...seen.values()];
}
