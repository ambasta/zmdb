// `@zmdb/compiler/testing` — tagged schema values, without a transform step.
//
// `schemaOf<User>()` is compiled away by the transform, and it has no runtime: a type
// argument does not survive to runtime, so a build that skipped the transform gets a thrown
// error rather than a plausible-looking empty schema. That is the right behaviour in an
// application and an awkward one in a test, because a unit test usually runs off the
// TypeScript source with no bundler in the way — `vitest`, `node --strip-types`, `tsx`. Ask
// for the schema there and you get the error, correctly, and no way forward.
//
// So this does through the compiler API what the transform does during a build: open the
// project, read exported tagged interfaces, and turn their IR into schema values. Tests can
// name individual exports with `schemasFrom`; build tools whose config already resolved a
// concrete file set use `schemasFromFiles`. Both return what the transform would have inlined
// — literally the same `schemaFromIR(schemaIrFromType(...))` expression — rather than a
// stand-in for the shipped path.
//
// ```ts
// import { schemasFrom } from '@zmdb/compiler/testing';
//
// export interface User extends Table<'users'> {
//   id: number & Sql<'integer'> & Serial & PrimaryKey;
//   email: string & Sql<'varchar'> & Length<255> & Unique;
// }
//
// const { User: users } = schemasFrom(import.meta.url, ['User']);
// ```
//
// The interfaces can live in the test file itself, which is the point: a fixture two
// directories away is a fixture nobody reads. They do have to be `export`ed, because the
// module's export table is how a name is resolved to a symbol.
//
// ## What it costs
//
// One compiler session per call — about 80ms to load a package-sized project, and about 3ms
// to resolve a type out of it. So a test should call once at module scope with every name it
// needs, while a command should pass its whole configured file set once. The session is
// closed before the call returns, because an open one holds a child process and a process
// that leaks those hangs on exit.
//
// It does check the module's own diagnostics first, which costs about 6ms and earns it back
// the first time somebody mistypes an import. A type read out of a file that does not compile
// comes back as an error type, and the reflection reports an error type as "the checker could
// not resolve this type" — true, unhelpful, and repeated once per column. The compile error is
// the thing that happened, so that is what gets raised.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CoreSchema, TaggedSchema } from '@zmdb/schema-core';
import { schemaFromIR, type SchemaIR } from '@zmdb/schema-core/ir';
import type { NamingStrategy } from '@zmdb/schema-core/naming';

import { schemaIrFromType, type ReflectDiagnostic, type ReflectOptions } from '../reflect/index.js';
import { ReflectSession } from '../reflect/session.js';

export interface SchemasFromOptions {
  /**
   * The `tsconfig.json` to read the module from. Defaults to the nearest one at or above the
   * module's own directory, which is the right answer for a test inside its package.
   */
  readonly project?: string | undefined;
  /**
   * What to do with a reflection that had to refuse something. The default throws, because a
   * schema with a column quietly missing is the failure mode this whole design exists to
   * prevent; pass a function to inspect them instead.
   */
  readonly onDiagnostics?: ((diagnostics: readonly ReflectDiagnostic[]) => void) | undefined;
  /** The already-resolved build-time naming strategy. */
  readonly naming?: NamingStrategy | undefined;
}

export interface SchemasFromFilesOptions extends SchemasFromOptions {
  /** The project that owns every selected declaration file. */
  readonly project: string;
}

function reflectOptions(options: SchemasFromOptions): ReflectOptions | undefined {
  return options.naming === undefined ? undefined : { naming: options.naming };
}

/**
 * The schema values for exported tagged interfaces in one module.
 *
 * `module` is a path or a `file:` URL — `import.meta.url` for the calling test file, which is
 * the usual case. The result is keyed by interface name, so it destructures.
 */
export function schemasFrom<const Names extends readonly string[]>(
  module: string,
  names: Names,
  options?: SchemasFromOptions,
): { [Name in Names[number]]: CoreSchema<string> };
/**
 * The same, with each schema remembering the type it came from.
 *
 * The reflection knows which interface it read, but a function cannot return a different type
 * per string it was handed, so the mapping is stated: `schemasFrom<{ User: User }>(…)`. What
 * comes back is a `TaggedSchema<User>`, exactly what `schemaOf<User>()` would have been, which
 * is what makes `Entity<…>`, `CreateDTO<…>` and a typed repository work off it.
 *
 * The name appears twice, once as a type and once as a string. That is the honest amount: the
 * string is what gets looked up at runtime and the type is what the compiler needs, and the
 * constraint ties them together so a typo in either is an error rather than an `undefined`.
 * Tests that only read the schema as data — IR, OpenAPI, seeding — want the erased overload
 * above and should not pay the extra line.
 */
export function schemasFrom<Types extends Record<string, object>>(
  module: string,
  names: readonly (keyof Types & string)[],
  options?: SchemasFromOptions,
): { [Name in keyof Types]: TaggedSchema<Types[Name]> };
export function schemasFrom(
  module: string,
  names: readonly string[],
  options: SchemasFromOptions = {},
): Record<string, CoreSchema<string>> {
  const irs: Record<string, SchemaIR> = schemaIrsFrom(module, names, options);
  const schemas: Record<string, CoreSchema<string>> = {};
  for (const [name, ir] of Object.entries(irs)) schemas[name] = schemaFromIR(ir);
  return schemas;
}

/**
 * Every exported tagged table declaration in a concrete file set.
 *
 * Config loading has already expanded and project-checked these files. This
 * bridge keeps the remaining compiler work in the reflection library: one
 * session for the project, one pass over each module's exports, and the same
 * `schemaFromIR` conversion used by `schemaOf<T>()` and `schemasFrom()`.
 */
export function schemasFromFiles(
  files: readonly string[],
  options: SchemasFromFilesOptions,
): readonly CoreSchema<string>[] {
  if (files.length === 0) throw new Error('the configured schema file set is empty');

  const session = ReflectSession.open({ project: options.project });
  try {
    const schemas = new Map<string, CoreSchema<string>>();
    const diagnostics: ReflectDiagnostic[] = [];

    for (const file of files.toSorted()) {
      const sourceFile = session.sourceFile(file);
      if (!sourceFile) {
        throw new Error(
          `${file} is not part of ${options.project}; the configured schema files must belong to the project`,
        );
      }

      const broken = session.diagnostics(file);
      if (broken.length > 0) {
        throw new Error(
          `${file} does not compile, so its table declarations cannot be read (${broken.length} diagnostic(s)):
` +
            broken
              .slice(0, 5)
              .map(one => `  TS${String(one.code)}: ${one.text}`)
              .join('
'),
        );
      }

      const moduleSymbol = session.checker.getSymbolAtLocation(sourceFile);
      if (!moduleSymbol) throw new Error(`${file} has no module symbol, so it exports nothing to read`);
      const exported = session.checker
        .getExportsOfModule(moduleSymbol)
        .toSorted((left, right) => left.name.localeCompare(right.name));

      for (const symbol of exported) {
        const type = session.checker.getDeclaredTypeOfSymbol(symbol);
        const reflected = schemaIrFromType(session.checker, type, sourceFile, reflectOptions(options));
        const isTable = reflected.diagnostics.every(diagnostic => !diagnostic.reason.includes("no Table<'name'> tag"));
        if (!isTable) continue;

        diagnostics.push(...reflected.diagnostics);
        const schema = schemaFromIR(reflected.ir);
        const previous = schemas.get(schema.ir.table);
        if (previous !== undefined) {
          if (JSON.stringify(previous.ir) !== JSON.stringify(schema.ir)) {
            throw new Error(`configured schema files export conflicting declarations for table ${schema.ir.table}`);
          }
          continue;
        }
        schemas.set(schema.ir.table, schema);
      }
    }

    if (diagnostics.length > 0) {
      if (options.onDiagnostics) options.onDiagnostics(diagnostics);
      else {
        throw new Error(
          `the reflection refused ${diagnostics.length} thing(s) in the configured schema files:
` +
            diagnostics.map(one => `  ${one.path ? `${one.path}: ` : ''}${one.reason}`).join('
'),
        );
      }
    }
    if (schemas.size === 0) {
      throw new Error(
        `the configured schema files export no tagged table declarations: ${files.toSorted().join(', ')}`,
      );
    }
    return [...schemas.values()].toSorted((left, right) => left.ir.table.localeCompare(right.ir.table));
  } finally {
    session.close();
  }
}

export function schemaIrsFrom<const Names extends readonly string[]>(
  module: string,
  names: Names,
  options: SchemasFromOptions = {},
): { [Name in Names[number]]: SchemaIR } {
  const file = module.startsWith('file:') ? fileURLToPath(module) : resolve(module);
  const project = options.project ?? nearestProject(file);

  const session = ReflectSession.open({ project });
  try {
    const sourceFile = session.sourceFile(file);
    if (!sourceFile) {
      throw new Error(
        `${file} is not part of ${project}. The tagged interfaces have to be in the program for ` +
          'the checker to have a declared type for them.',
      );
    }

    // Before anything is read off the type: a file that does not compile has error types in it,
    // and an error type reflects as a refusal per column rather than as the one problem it is.
    const broken = session.diagnostics(file);
    if (broken.length > 0) {
      throw new Error(
        `${file} does not compile, so its types cannot be read (${broken.length} diagnostic(s)):\n` +
          broken
            .slice(0, 5)
            .map(one => `  TS${String(one.code)}: ${one.text}`)
            .join('\n'),
      );
    }

    const { checker } = session;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) throw new Error(`${file} has no module symbol, so it exports nothing to read`);
    const exported = new Map(checker.getExportsOfModule(moduleSymbol).map(symbol => [symbol.name, symbol]));

    const irs: Record<string, SchemaIR> = {};
    const diagnostics: ReflectDiagnostic[] = [];
    for (const name of names) {
      const symbol = exported.get(name);
      if (!symbol) {
        // Naming the exports is worth the line: the usual cause is a missing `export`, and the
        // message "User is not exported" is not obviously that when the interface is right there.
        throw new Error(
          `${file} exports no \`${name}\`. It has to be \`export interface ${name}\` — the module's ` +
            `export table is how the name is resolved. Exports found: ${[...exported.keys()].join(', ') || 'none'}.`,
        );
      }
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      // One reflector per name, which `schemaIrFromType` gives us: the node budget and the
      // helper-name table are per-reflection state, and sharing them across unrelated tables
      // would make one table's refusals show up against another's.
      const result = schemaIrFromType(checker, type, sourceFile, reflectOptions(options));
      irs[name] = result.ir;
      diagnostics.push(...result.diagnostics);
    }

    if (diagnostics.length > 0) {
      if (options.onDiagnostics) options.onDiagnostics(diagnostics);
      else {
        throw new Error(
          `the reflection refused ${diagnostics.length} thing(s) in ${file}:\n` +
            diagnostics.map(one => `  ${one.path ? `${one.path}: ` : ''}${one.reason}`).join('\n'),
        );
      }
    }

    // boundary: `irs` is filled in by the loop above, one key per member of `names`, and the
    // loop throws rather than skipping when a name is not exported — so every key the return
    // type promises is present by the time this runs. What the assertion buys is the *literal*
    // keys: built from a `Record<string, SchemaIR>` because the names arrive as values, and no
    // amount of building it differently makes the compiler read them back off the array.
    return irs as { [Name in Names[number]]: SchemaIR };
  } finally {
    session.close();
  }
}

/**
 * The nearest `tsconfig.json` at or above a file.
 *
 * The same rule `tsc` uses for a bare invocation, and the same one the codegen CLI documents,
 * so a caller who has not thought about it gets the project they would have guessed.
 */
function nearestProject(file: string): string {
  let directory = dirname(file);
  for (;;) {
    const candidate = join(directory, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`no tsconfig.json at or above ${file}; pass \`project\` explicitly`);
    }
    directory = parent;
  }
}
