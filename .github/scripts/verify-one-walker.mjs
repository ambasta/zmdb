// One walker over column metadata, and this is the gate that keeps it one.
//
// There were four. The AOT validator's emitter, its runtime checker, the OpenAPI package's
// `scalarSchema` and the repository's `valueMatchesColumn` each took a column's `SqlType` and
// its validation rules and decided, privately, what a value of that column looks like. A fifth
// turned up later in the seeder (`genValue`, which read `col.type` and an enum flag and nothing
// else). None of them was wrong on its own terms and no two of them agreed: a `timestamp`
// accepted a `Date` in one, a `Date | string` in another, and an ISO string in the third, so
// which answer you got depended on which layer asked.
//
// They are one walk now, in `packages/schema-core/src/ir/`, and every back-end reads the
// `TypeIR` it produces. That is a property of the code as it stands rather than of the
// language, and it decays in the ordinary way: a back-end needs one more fact about a column,
// the IR does not carry it yet, and reading `schema.columns[name].type` right there is two lines
// against a refactor. The sixth walker arrives the same way the fifth did.
//
// Three checks, in increasing order of teeth:
//
//   1. **The deleted names.** `valueMatchesColumn`, `scalarSchema` and `genValue`, as code,
//      anywhere. They cannot collide with anything live, and a walker that comes back under its
//      old name is the cheapest case to catch. (`irFromSchema` is the fourth of these and is
//      covered by `verify:no-defineschema`, which already owns it.)
//
//   2. **Who may name the vocabulary.** `ColumnMeta`, `ColumnsMap` and `SqlType`, in library
//      source. A walk over column metadata has to name at least one of them to read one, so the
//      import list is the signal, and it is a short list with a reason per entry.
//
//   3. **Who may read a column's meaning.** `.flags.x`, `.validation`, and a comparison against
//      a SQL type. Check 2 misses these when the type is inferred rather than written —
//      `meta.flags.nullable` needs no annotation — and this is the shape the sixth walker
//      actually takes.
//
// Comments are stripped before matching, because explaining why there used to be four is a
// legitimate thing to write and most of the files that mention them are the ones that deleted
// them. Only library sources are scanned for checks 2 and 3: a spec that asserts
// `columns.email?.flags.unique` is checking the value a producer built, which is what a spec is
// for, and nothing in a spec ships.
//
// A stale entry fails too. An allowlist that still claims a file needs an exemption it stopped
// needing is how a gate turns into a list of names nobody reads.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** This gate. It has to name what it forbids, in all three checks. */
const SELF = '.github/scripts/verify-one-walker.mjs';

/** Check 1: the walkers that were deleted, by name. */
const DELETED = /\b(?:valueMatchesColumn|scalarSchema|genValue)\b/;

/** Check 2: the metadata vocabulary. Naming one of these is how you read a column as data. */
const VOCABULARY = /\b(?:ColumnMeta|ColumnsMap|SqlType)\b/;

/**
 * Check 3: reading what a column *means*.
 *
 * The SQL types listed are the seven that are only ever SQL types. `integer`, `bigint` and
 * `boolean` are left out on purpose: they are also `ScalarKind` members, so `scalar ===
 * 'integer'` in the emitter — a read of the IR, which is the thing this gate wants — would
 * match. The seven that remain are enough, because a walk over `SqlType` handles all ten or it
 * is not a walk over `SqlType`.
 */
const MEANING = /\.flags\.|\.validation\b|(?:===|!==|case)\s*'(?:serial|varchar|numeric|timestamp|jsonEnum|text|json)'/;

/**
 * The walker's own home. A prefix rather than a file list: `ir/` is the one place allowed to
 * hold all of this, and splitting it across more files there is a refactor, not a regression.
 */
const WALKER = 'packages/schema-core/src/ir/';
const HTTP_COMPILER = 'packages/web/src/contract/compiler/index.ts';

/** Check 2's exemptions: every library source outside `ir/` that may name the vocabulary. */
const MAY_NAME = new Map([
  [SELF, 'the gate'],
  ['packages/schema-core/src/index.ts', 'declares all three. The data model is not a reader of itself.'],
  [
    'packages/schema-core/src/tags/index.ts',
    "`ColumnSqlType = Exclude<SqlType, 'serial'>` — the tag vocabulary, at the type level only. " +
      "`Sql<'serial'>` is refused because `Serial` is the tag that means it.",
  ],
  [
    'packages/compiler/src/reflect/index.ts',
    'the producer. It maps a declared TypeScript type to a `SqlType`, which is the direction ' +
      'this gate exists to protect: one thing writes the vocabulary, one thing reads it.',
  ],
  ['packages/zmdb/src/schema.ts', 'the schema concern facade. A name passing through, not a read.'],
]);

/** Check 3's exemptions: every library source outside `ir/` that may read a column's meaning. */
const MAY_READ = new Map([
  [SELF, 'the gate'],
  [
    'packages/mysql/src/introspect.ts',
    'the official reverse MySQL catalog boundary. Its input is information_schema text, so no ' +
      'declaration or TypeIR exists yet; it creates the normalized snapshot consumed by drift checks.',
  ],
  [
    'packages/mysql/src/migrations.ts',
    'the official MySQL DDL boundary. It consumes normalized migration snapshots to spell server ' +
      'types and column constraints; it does not decide which application values a column admits.',
  ],
  [
    'packages/singlestore/src/migrations.ts',
    'the package-owned SingleStore DDL boundary. It consumes normalized migration snapshots to ' +
      'validate shard-key compatibility and spell server types; it does not walk declarations or decide values.',
  ],
  [
    'packages/migrations/src/index.ts',
    'the schema-lifecycle boundary. It snapshots structural declarations and plans changes before ' +
      'the SQL-owned type renderer turns those normalized facts into DDL.',
  ],
  [
    'packages/mssql/src/types.ts',
    'the SQL Server DDL boundary. It maps the generic migration snapshot to T-SQL spellings ' +
      'after the schema walk has already produced normalized column facts.',
  ],
  [
    'packages/sqlite/src/migrations.ts',
    'the package-owned SQLite DDL boundary. It maps normalized snapshot types and key flags to exact ' +
      'SQLite declarations and refusals; it does not decide which application values a column admits.',
  ],
  [
    'packages/postgres/src/migrations.ts',
    'the extracted PostgreSQL DDL boundary. It turns normalized migration snapshots into PostgreSQL ' +
      'types and schema-object SQL while the generic compatibility emitter remains until #675.',
  ],
  [
    'packages/mssql/src/introspect.ts',
    'the reverse SQL Server catalog boundary. Its input is validated sys catalog rows, so no ' +
      'declaration or TypeIR exists yet; it creates the normalized migration snapshot.',
  ],
  [
    'packages/sqlite/src/introspector.ts',
    'the reverse SQLite catalog boundary. Its input is external PRAGMA/catalog rows, so no declaration ' +
      'or TypeIR exists yet; it creates the normalized snapshot owned by the SQLite vertical.',
  ],
  [
    'packages/postgres/src/introspect.ts',
    'the package-owned reverse PostgreSQL catalog boundary. Its input is external catalog text, so ' +
      'no declaration or TypeIR exists yet; it creates the vertical package snapshot independently.',
  ],
  [
    'packages/migrations/src/declarations/emit.ts',
    'the reverse declaration boundary. It reads a normalized catalog snapshot before any ' +
      'declaration or TypeIR exists and turns those facts into inputs for the one tagged-property printer.',
  ],
  [
    'packages/migrations/src/declarations/tagged-property.ts',
    'the one normalized-facts-to-tagged-property printer, shared by catalog emission and the ' +
      'legacy builder codemod. It creates declaration source before reflection can produce a TypeIR.',
  ],
  [
    'packages/repository/src/index.ts',
    'one flag, `autoIncrement`, for the refusal when a payload supplies a column the database ' +
      'generates. That is a fact about who writes the column, not about what values it admits.',
  ],
  [
    'packages/compiler/src/reflect/index.ts',
    "the producer again, from the other side: `Sql<'integer'>` with `Serial` beside it is a " +
      '`serial`, a literal union is a `jsonEnum`, and a bare `number` is neither. Deciding ' +
      'which SQL type a declaration means is the opposite of reading one back.',
  ],
  [
    'packages/compiler/src/protobuf/decode.ts',
    "the matched `case 'timestamp'` is the decoder's private `TimestampPlan` discriminant. " +
      'The back-end receives TypeIR and never reads a column, its flags, validation, or SqlType.',
  ],
  [
    'packages/compiler/src/protobuf/encode.ts',
    "the matched `case 'timestamp'` is the encoder's private `TimestampPlan` discriminant. " +
      'The back-end receives TypeIR and never reads a column, its flags, validation, or SqlType.',
  ],
  [
    'packages/compiler/src/lint/rules/no-interpolated-sql.ts',
    "the matched `=== 'text'` is an ESTree object-property name. The lint rule reads source " +
      'syntax only; it imports no schema metadata and never reads a column or TypeIR.',
  ],
  [
    HTTP_COMPILER,
    'the matched `.flags` is a TypeScript SymbolFlags.Optional check on one HTTP declaration property. ' +
      'Leaf types cross Reflector.typeIR(), and the HTTP-specific checks below forbid a second TypeScript schema walk.',
  ],
]);

const problems = [];

/**
 * Source with its comments removed.
 *
 * Naive in the same way `verify-no-defineschema.mjs`'s is, and acceptable for the same reason:
 * the only question asked of the result is whether a handful of identifiers appear in it.
 */
function withoutComments(source) {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
}

/**
 * Every source file in the repository, including ones not yet committed.
 *
 * `--others --exclude-standard` is what makes this a gate rather than a report on the last
 * commit: a fifth walker in a new file is untracked right up until the moment it lands.
 */
function repositorySources() {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.ts', '*.mts', '*.mjs', '*.js'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\0')
    .filter(file => file.length > 0 && !file.endsWith('.d.ts') && !file.startsWith('benchmarks/'));
}

/** A shipped source file: under a package's `src`, not a test, not a corpus. */
function isLibrarySource(file) {
  return (
    /^packages\/[^/]+\/src\//.test(file) &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.type-test.ts') &&
    !file.includes('/__fixtures__/') &&
    !file.includes('/__testing__/') &&
    !file.includes('/testing/') &&
    !file.endsWith('/fixtures.ts')
  );
}

const deleted = [];
const naming = [];
const reading = [];
let scanned = 0;

for (const file of repositorySources()) {
  // `ls-files` reads the index, which still lists a file deleted in the working tree.
  if (!existsSync(join(ROOT, file))) continue;
  scanned++;
  const code = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
  if (DELETED.test(code)) deleted.push(file);
  if (!isLibrarySource(file) || file.startsWith(WALKER)) continue;
  if (VOCABULARY.test(code)) naming.push(file);
  if (MEANING.test(code)) reading.push(file);
}

for (const file of deleted) {
  if (file !== SELF) problems.push(`${file} uses a deleted walker's name as code.`);
}
for (const file of naming) {
  if (!MAY_NAME.has(file)) {
    problems.push(
      `${file} names \`ColumnMeta\`, \`ColumnsMap\` or \`SqlType\`. Read the \`TypeIR\` from ` +
        `\`schema.ir\` instead, or add the file to MAY_NAME with the reason it cannot.`,
    );
  }
}
for (const file of reading) {
  if (!MAY_READ.has(file)) {
    problems.push(
      `${file} reads a column's flags, its validation rules, or its \`SqlType\` directly. ` +
        `That is the fifth walker. Add the fact you need to the IR, or add the file to MAY_READ.`,
    );
  }
}
for (const [file, reason] of MAY_NAME) {
  if (file !== SELF && !naming.includes(file)) {
    problems.push(`${file} no longer names the vocabulary (${reason}). Remove it from MAY_NAME.`);
  }
}
for (const [file, reason] of MAY_READ) {
  if (file !== SELF && !reading.includes(file)) {
    problems.push(`${file} no longer reads a column's meaning (${reason}). Remove it from MAY_READ.`);
  }
}

// HTTP contracts may inspect the declaration envelope (groups, properties and exact
// statuses), but every leaf TypeScript type must cross the existing Reflector once.
// No other shipped web module may import the compiler API, and the compiler must not
// grow its own union/array/object schema traversal beside Reflector.typeIR().
const webCompilerUsers = repositorySources().filter(file => {
  if (!isLibrarySource(file) || !file.startsWith('packages/web/src/') || !existsSync(join(ROOT, file))) {
    return false;
  }
  const code = withoutComments(readFileSync(join(ROOT, file), 'utf8'));
  return /from\s+['"]typescript\/unstable\/(?:ast|sync)/.test(code);
});
if (webCompilerUsers.length !== 1 || webCompilerUsers[0] !== HTTP_COMPILER) {
  problems.push(
    `the shipped web TypeScript-compiler boundary is [${webCompilerUsers.join(', ')}], expected only ${HTTP_COMPILER}.`,
  );
}

const httpCompiler = withoutComments(readFileSync(join(ROOT, HTTP_COMPILER), 'utf8'));
const count = pattern => [...httpCompiler.matchAll(pattern)].length;
if (count(/\bReflectSession\.open\s*\(/g) !== 0) {
  problems.push(`${HTTP_COMPILER} opens its own ReflectSession instead of accepting the caller-owned session.`);
}
if (count(/\.typeIR\s*\(/g) !== 1) {
  problems.push(`${HTTP_COMPILER} must cross the existing Reflector.typeIR() boundary exactly once in source.`);
}
if (count(/\bjsonSchemaFromTypeIR\s*\(/g) !== 1) {
  problems.push(`${HTTP_COMPILER} must project JSON Schema through jsonSchemaFromTypeIR() exactly once in source.`);
}
if (count(/\.getPropertiesOfType\s*\(/g) !== 1) {
  problems.push(`${HTTP_COMPILER} must have one declaration-envelope property reader, not another schema walk.`);
}
const forbiddenHttpTypeWalk = [
  ...httpCompiler.matchAll(
    /\.(?:getTypes|getTypeArguments|isArrayType|isIntersectionType|isTupleType|isUnionType)\s*\(/g,
  ),
].map(match => match[0]);
if (forbiddenHttpTypeWalk.length > 0) {
  problems.push(
    `${HTTP_COMPILER} traverses TypeScript schema shapes directly (${forbiddenHttpTypeWalk.join(', ')}); ` +
      'delegate those types to Reflector.typeIR().',
  );
}

console.log(
  `one-walker: ${scanned} source file(s) scanned; ${naming.length} naming the vocabulary, ` +
    `${reading.length} reading a column's meaning, one web compiler envelope reader, all exempted with a reason.`,
);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('There is one walk from a column to what a value of it looks like, in');
  console.error('`packages/schema-core/src/ir/`, and every back-end reads its `TypeIR`. Four');
  console.error('private walks over the same metadata gave four answers for a `timestamp`, and the');
  console.error('one you got depended on which layer happened to ask.');
  process.exit(1);
}
console.log('one walk from a column to a value: the DDL, the validator, the JSON Schema and the seeder share it.');
