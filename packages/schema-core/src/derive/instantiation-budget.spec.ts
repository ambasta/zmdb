// What the type-first design costs the compiler, measured rather than asserted.
//
// The whole plan moves work from runtime to the type system: `CreateDTO<User>` is a mapped
// type over a filtered key set, `WhereDTO` another, `Populated` another again, and each is
// instantiated once per table per use site. That is a real budget and it is spent in a
// currency nobody watches — nothing fails when a build gets slower, it just gets slower, and
// by the time anyone measures it the cause is thirty commits back. That is RISK-6.
//
// So two numbers, both from `tsc --extendedDiagnostics` on a project this test generates:
//
//   1. A **ceiling**. A fixed schema costs at most N instantiations. Blunt, and it catches
//      the ordinary regression: a helper that stops being lazy, an `extends` that forces a
//      union to distribute.
//   2. A **scaling factor**, which is the one that matters. The same derivation is measured
//      at two table counts, and quadrupling the tables may not much more than quadruple the
//      cost. A ceiling goes stale the moment the fixture grows; superlinearity does not.
//      An accidental cross-product between tables — the failure mode that makes a large
//      schema uncompilable rather than merely slow — shows up here and only here.
//
//      It is the *marginal* cost that is compared, with an empty-project baseline subtracted
//      out. Without that subtraction the test is close to useless: the fixed floor of a
//      program (lib files, the `derive` module's own types) is around 25,000 instantiations
//      and eight tables add roughly 2,000, so the raw ratio for 4x the tables is about 1.3
//      and even genuinely quadratic per-table growth stays well under any plausible
//      threshold. Subtracting the floor makes linear read as 4.0 and quadratic as 16.
//
// The generated project imports the real `derive` and `tags` modules by path, so this
// measures the shipped types, not a model of them.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = new URL('../../../../', import.meta.url).pathname;
const SCRATCH = `${HERE}__budget__/`;

/**
 * The measured ceiling for `TABLES` tables, with headroom.
 *
 * Recorded, not derived: the point of a committed number is that changing it is a visible
 * edit with a reason in the commit message. Raise it when the derivation genuinely grows;
 * lower it when something gets cheaper, so the slack does not quietly accumulate.
 */
const CEILING = 35_000;
const TABLES = 8;

/**
 * Quadrupling the tables may cost at most this much more, per table above the baseline.
 *
 * Linear is 4.0 exactly, since the floor is subtracted. 5 leaves room for the mapped types
 * that the checker caches across tables (which pushes it slightly *below* 4) and for ordinary
 * measurement noise, while still failing on anything quadratic — that reads as 16.
 */
const MAX_SCALING = 5;
const SMALL = 4;
const LARGE = SMALL * 4;

/** One table's worth of tagged interface, using every tag the DTOs actually filter on. */
function taggedTable(index: number): string {
  return `
export interface Table${index} extends Table<'table_${index}'> {
  id: number & Sql<'serial'> & Serial & PrimaryKey;
  name: string & Sql<'varchar'> & Length<255> & Unique;
  slug: string & Sql<'text'> & Pattern<'^[a-z-]+$'>;
  score: number & Sql<'integer'> & Min<0> & Max<100>;
  note: (string & Sql<'text'> & MinLength<1>) | null;
  active: boolean & Sql<'boolean'>;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  secret: string & Sql<'text'> & Sensitive;
}

// Every derived shape, instantiated. A type nothing instantiates costs nothing, so an
// unused alias would measure the wrong thing.
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
// Forces the mapped types to be *resolved*, not merely referenced: an alias the checker
// never has to look inside is close to free, which would make the measurement a lie.
export declare const row${index}: Entity${index};
export declare const create${index}: Create${index};
export declare const where${index}: Where${index};
export const keys${index}: (keyof Read${index})[] = [];
`;
}

function project(directory: string, tables: number): void {
  mkdirSync(directory, { recursive: true });
  // The package's public subpaths, resolved through `tsconfig.base.json`'s `paths`, so the
  // generated file does not have to know how deep it was written.
  const source = [
    "import type { Entity, CreateDTO, UpdateDTO, ReadDTO, WhereDTO, OrderByDTO, PrimaryKeyOf, Wire, ListDTO, GetDTO } from '@zmdb/schema-core/derive';",
    "import type { HasDefault, Length, Max, Min, MinLength, Pattern, PrimaryKey, Sensitive, Serial, Sql, Table, Unique } from '@zmdb/schema-core/tags';",
    ...Array.from({ length: tables }, (_, index) => taggedTable(index)),
  ].join('\n');
  writeFileSync(`${directory}/schemas.ts`, `${source}\n`);
  writeFileSync(
    `${directory}/tsconfig.json`,
    `${JSON.stringify({ extends: `${ROOT}tsconfig.base.json`, files: ['schemas.ts'] }, undefined, 2)}\n`,
  );
}

/** `Instantiations:` from `--extendedDiagnostics`, and nothing else from it. */
function instantiations(directory: string): number {
  const argv = ['tsc', '--noEmit', '--extendedDiagnostics', '-p', `${directory}/tsconfig.json`];
  const options = { cwd: ROOT, encoding: 'utf8' as const, maxBuffer: 16 * 1024 * 1024 };
  let output: string;
  try {
    output = execFileSync('yarn', argv, options);
  } catch (error) {
    // `tsc` exits non-zero on a diagnostic but still prints the counts, and the diagnostic is
    // the more useful half of that. Reading stdout here is what turns "Command failed" into
    // the actual TypeScript error.
    output = (error as { stdout?: string }).stdout ?? String(error);
  }
  // The project must compile for the number to mean anything: a checker that gave up early
  // instantiates less, so a broken fixture would read as an improvement.
  if (/error TS\d+/.test(output)) throw new Error(`the generated budget project does not compile:\n${output}`);
  const match = /^Instantiations:\s+(\d+)$/m.exec(output);
  if (!match?.[1]) throw new Error(`no instantiation count in tsc output:\n${output}`);
  return Number(match[1]);
}

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

describe('type-instantiation budget (RISK-6)', () => {
  it(`stays under ${CEILING.toLocaleString()} instantiations for ${TABLES} tagged tables`, () => {
    const directory = `${SCRATCH}fixed`;
    project(directory, TABLES);
    const count = instantiations(directory);
    // Logged unconditionally: the number is the deliverable, and a passing test that prints
    // nothing gives no way to see the slack shrinking over several commits.
    console.log(
      `derive: ${count.toLocaleString()} instantiations for ${TABLES} tables (ceiling ${CEILING.toLocaleString()})`,
    );
    expect(count).toBeLessThanOrEqual(CEILING);
  }, 60_000);

  it('scales linearly in the number of tables', () => {
    // The floor: the same imports, no tables. Everything a program costs before the schema
    // does, which is most of it.
    const measure = (name: string, tables: number): number => {
      const directory = `${SCRATCH}${name}`;
      project(directory, tables);
      return instantiations(directory);
    };
    const baseline = measure('baseline', 0);
    const small = measure('small', SMALL) - baseline;
    const large = measure('large', LARGE) - baseline;
    expect(small, 'the tables must cost something measurable above the baseline').toBeGreaterThan(0);

    const ratio = large / small;
    console.log(
      `derive: baseline ${baseline.toLocaleString()}; ` +
        `${SMALL} tables +${small.toLocaleString()}, ${LARGE} tables +${large.toLocaleString()} ` +
        `= ${ratio.toFixed(2)}x for 4x the tables (max ${MAX_SCALING})`,
    );
    // The failure this catches: one table's derivation reaching across the others. It makes a
    // 50-table schema uncompilable while an 8-table fixture sits comfortably under any
    // ceiling, so the ceiling above cannot see it.
    expect(ratio).toBeLessThanOrEqual(MAX_SCALING);
  }, 120_000);
});
