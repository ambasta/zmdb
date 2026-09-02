// What a tagged declaration costs the compiler, measured on a generated project.
//
// One implementation, two consumers with different claims: `instantiation-budget.spec.ts`
// asserts the ceiling and the scaling factor (RISK-6), and `.github/scripts/verify-
// instantiations.mjs` ratchets the marginal cost and compares a tagged declaration against
// its untagged twin (REQ-TF-3). They were the same forty lines of project generator twice
// before this file existed, which is two chances to measure something slightly different and
// call the difference a regression.
//
// The generated project imports the real `derive` and `tags` modules through the workspace
// `paths`, so this measures the shipped types rather than a model of them.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const ROOT = new URL('../../../../../', import.meta.url).pathname;

/**
 * Where the generated projects go, and not negotiable by the caller.
 *
 * It has to be *inside* the repository. A project written to `/tmp` fails with `TS2688:
 * Cannot find type definition file for 'node'`, because `types` is resolved by walking up
 * from the project directory looking for `node_modules` and outside the tree there is none
 * to find. Gitignored; `cleanup()` removes it.
 */
const SCRATCH = new URL('../__budget__/', import.meta.url).pathname;

/** What to generate. The three axes are the three things anyone wants to compare. */
export interface Variant {
  /** How many tables the project declares. Zero is the floor: imports and nothing else. */
  readonly tables: number;
  /**
   * Whether the interfaces carry tags.
   *
   * `false` produces the *same* interfaces with every tag stripped — the untagged twin
   * REQ-TF-3's acceptance criterion is written against. Column names, count and app types
   * are identical, so the difference between the two measurements is the tags and nothing
   * else.
   */
  readonly tagged: boolean;
  /** Whether to instantiate the DTO suite over each table, or only declare the interfaces. */
  readonly derive: boolean;
}

export interface Measurement {
  readonly instantiations: number;
  readonly types: number;
  /** `Check time` from `--extendedDiagnostics`, in milliseconds. Not reproducible. */
  readonly checkMs: number;
}

/**
 * How many columns one table declares.
 *
 * Exported because the per-column cost is the number REQ-TF-3 is really about, and a caller
 * that hard-coded 8 would go quietly wrong the day a column is added to `taggedTable` below.
 */
export const COLUMNS_PER_TABLE = 8;

/**
 * One table's worth of tagged interface, using every tag the DTOs actually filter on.
 *
 * The constraint arguments vary with the table index, and that is the whole reason this
 * measures anything. The checker caches a generic instantiation per distinct type argument, so
 * an identical `Length<255>` on four thousand columns is instantiated *once* — an earlier
 * version of this fixture used the same arguments for every table and reported that 512 tagged
 * tables cost 523 instantiations in total, which flatters the design by measuring the cache
 * rather than the tags. Distinct arguments are also what a real schema has: two tables rarely
 * agree on their column lengths.
 */
function taggedTable(index: number): string {
  return `
export interface Table${index} extends Table<'table_${index}'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'varchar'> & Length<${255 + index}> & Unique;
  slug: string & Sql<'text'> & Pattern<'^[a-z${index}-]+$'>;
  score: number & Sql<'integer'> & Min<${index}> & Max<${100 + index}>;
  note: (string & Sql<'text'> & MinLength<${1 + index}>) | null;
  active: boolean & Sql<'boolean'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  secret: string & Sql<'text'> & Sensitive;
}
`;
}

/**
 * The same table with every column tag removed: the baseline REQ-TF-3 is measured against.
 *
 * `extends Table<'table_N'>` stays, and it has to. Every derivation is constrained to
 * `DeclaredTable`, so a type that does not say it is a table is not something `Entity<>`
 * accepts — an interface with the name slot stripped as well would not compile here, which is
 * REQ-TF-4 working rather than a problem with the fixture. So the baseline is a declared table
 * with nothing said about its columns, and the marginal cost this measures is the cost of the
 * *column* tags: the eight per-column intersections and the five distinct constraint arguments
 * they carry.
 */
function untaggedTable(index: number): string {
  return `
export interface Table${index} extends Table<'table_${index}'> {
  id: number;
  name: string;
  slug: string;
  score: number;
  note: string | null;
  active: boolean;
  createdAt: Date;
  secret: string;
}
`;
}

/**
 * Every derived shape, instantiated *and resolved*.
 *
 * A type nothing looks inside is close to free, so an unused alias would measure the wrong
 * thing — the `declare const`s below are what force the mapped types to be computed.
 */
function derivations(index: number): string {
  return `
export type Entity${index} = Entity<Table${index}>;
export type Create${index} = CreateDTO<Table${index}>;
export type Update${index} = UpdateDTO<Table${index}>;
export type Read${index} = ReadDTO<Table${index}>;
export type Where${index} = WhereDTO<Table${index}>;
export type OrderBy${index} = OrderByDTO<Table${index}>;
export type Key${index} = PrimaryKeyOf<Table${index}>;
export type Wire${index} = Wire<Table${index}>;
export type List${index} = ListDTO<Table${index}>;
export type Get${index} = GetDTO<Table${index}>;
export declare const row${index}: Entity${index};
export declare const create${index}: Create${index};
export declare const where${index}: Where${index};
export const keys${index}: (keyof Read${index})[] = [];
`;
}

const DERIVE_IMPORT =
  "import type { Entity, CreateDTO, UpdateDTO, ReadDTO, WhereDTO, OrderByDTO, PrimaryKeyOf, Wire, ListDTO, GetDTO } from '@zmdb/schema-core/derive';";
const TAGS_IMPORT =
  "import type { HasDefault, Length, Max, Min, MinLength, Pattern, PrimaryKey, Sensitive, Serial, Sql, Table, Unique } from '@zmdb/schema-core/tags';";

/**
 * Write one project under `SCRATCH`, named so two variants never share a directory.
 *
 * Both imports are present in every variant, tags included, so the untagged baseline pays
 * for loading the same modules. Otherwise the comparison would be measuring module
 * resolution rather than the declaration.
 */
function project(name: string, variant: Variant): string {
  const directory = `${SCRATCH}${name}`;
  mkdirSync(directory, { recursive: true });
  const table = variant.tagged ? taggedTable : untaggedTable;
  const source = [
    DERIVE_IMPORT,
    TAGS_IMPORT,
    // Referenced so the import is not elided in the untagged variant, and so both variants
    // instantiate exactly one tag either way.
    "export type _Anchor = Table<'anchor'>;",
    ...Array.from({ length: variant.tables }, (_, index) => table(index)),
    ...(variant.derive ? Array.from({ length: variant.tables }, (_, index) => derivations(index)) : []),
  ].join('\n');
  writeFileSync(`${directory}/schemas.ts`, `${source}\n`);
  writeFileSync(
    `${directory}/tsconfig.json`,
    `${JSON.stringify({ extends: `${ROOT}tsconfig.base.json`, files: ['schemas.ts'] }, undefined, 2)}\n`,
  );
  return directory;
}

/** `--extendedDiagnostics` for one generated project, and only the three numbers wanted. */
export function measure(name: string, variant: Variant): Measurement {
  const directory = project(name, variant);
  const argv = ['--noEmit', '--extendedDiagnostics', '-p', `${directory}/tsconfig.json`];
  const options = { cwd: ROOT, encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 };
  let output: string;
  try {
    output = execFileSync(`${ROOT}node_modules/.bin/tsc`, argv, options);
  } catch (error) {
    // `tsc` exits non-zero on a diagnostic but still prints the counts, and the diagnostic is
    // the more useful half of that. Reading stdout here is what turns "Command failed" into
    // the actual TypeScript error.
    output = (error as { stdout?: string }).stdout ?? String(error);
  }
  // The project must compile for the number to mean anything: a checker that gave up early
  // instantiates less, so a broken fixture would read as an improvement.
  if (/error TS\d+/.test(output)) throw new Error(`the generated budget project does not compile:\n${output}`);

  return {
    instantiations: number(output, 'Instantiations'),
    types: number(output, 'Types'),
    checkMs: Math.round(seconds(output, 'Check time') * 1000),
  };
}

/** Remove every generated project. Safe to call when there are none. */
export function cleanup(): void {
  rmSync(SCRATCH, { recursive: true, force: true });
}

function number(output: string, label: string): number {
  const match = new RegExp(`^${label}:\\s+(\\d+)$`, 'm').exec(output);
  if (!match?.[1]) throw new Error(`no \`${label}\` in tsc output:\n${output}`);
  return Number(match[1]);
}

function seconds(output: string, label: string): number {
  const match = new RegExp(`^${label}:\\s+([\\d.]+)s$`, 'm').exec(output);
  if (!match?.[1]) throw new Error(`no \`${label}\` in tsc output:\n${output}`);
  return Number(match[1]);
}
