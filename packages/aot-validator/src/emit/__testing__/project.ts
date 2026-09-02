// A throwaway TypeScript project, for tests that need the real checker.
//
// Every emitted-output test now has to go through the compiler, because that is the only
// way `is<T>` learns what `T` is (REQ-TF-8). The setup is the same each time — a temp
// directory, a `tsconfig.json`, a module to rewrite — and the interesting part is what
// it costs: opening a session spawns a `tsgo` child process and loads a program, so this
// exists to make that **once per spec file** rather than once per assertion.
//
// Two constraints shaped the shape:
//
//  1. The module under test must be evaluatable by `new Function`, so it may contain no
//     imports, no `interface`, and no type annotations. Named types and tag aliases go
//     into `globals.d.ts` via the `declarations` option instead, where they are visible
//     to the module without an import that would survive into the output.
//  2. `transformFile` refuses to rewrite text the compiler did not parse, so `transform`
//     writes to disk and calls `session.refresh` before asking. That makes every test
//     here an exercise of the watch-mode path as a side effect.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TypeIR } from '@zmdb/schema-core/ir';
import type { Diagnostic } from 'typescript/unstable/sync';

import { AssertError } from '../../errors.ts';
import { findCallSites } from '../../reflect/callsites.ts';
import { Reflector } from '../../reflect/index.ts';
import { ReflectSession } from '../../reflect/session.ts';
import { transformFile, type TransformResult } from '../../transformer.ts';
import type { EmitOptions } from '../index.ts';

/** The repo root, so the temp project can resolve `@zmdb/*` by absolute path. */
const ROOT = new URL('../../../../../', import.meta.url).pathname;

const TSCONFIG = {
  compilerOptions: {
    target: 'ESNext',
    lib: ['ESNext'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    strict: true,
    // The fixture modules must be valid JavaScript so `new Function` can run the
    // output, which rules out annotating `(input) =>`. Everything the tests actually
    // care about — the type argument to `is<T>` — is still fully checked.
    noImplicitAny: false,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    verbatimModuleSyntax: true,
    isolatedModules: true,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
    // No `@types/node`: the temp directory has no `node_modules`, and nothing here
    // touches a Node builtin.
    types: [] as string[],
    paths: {
      '@zmdb/schema-core': [`${ROOT}packages/schema-core/src/index.ts`],
      '@zmdb/schema-core/*': [`${ROOT}packages/schema-core/src/*/index.ts`],
      '@zmdb/aot-validator': [`${ROOT}packages/aot-validator/src/index.ts`],
      '@zmdb/aot-validator/*': [`${ROOT}packages/aot-validator/src/*/index.ts`],
    },
  },
  include: ['**/*.ts'],
};

/**
 * The API the fixture module calls, declared globally so the module needs no import.
 *
 * The signatures are the honest ones — `assert<T>` returns `T` — because the fixture is
 * typechecked, and a fixture that does not compile makes every assertion about it a
 * guess.
 */
const GLOBALS = `import type * as ZmdbTags from '@zmdb/schema-core/tags';

declare global {
  type Min<N extends number> = ZmdbTags.Min<N>;
  type Max<N extends number> = ZmdbTags.Max<N>;
  type MinLength<N extends number> = ZmdbTags.MinLength<N>;
  type MaxLength<N extends number> = ZmdbTags.MaxLength<N>;
  type Length<N extends number> = ZmdbTags.Length<N>;
  type Pattern<S extends string> = ZmdbTags.Pattern<S>;

  function is<T>(value: unknown): value is T;
  function assert<T>(value: unknown): T;
  function assertEquals<T>(value: unknown): T;
  function equals<T>(value: unknown): value is T;
  function validate<T>(value: unknown): { success: boolean; data?: T; errors?: unknown[] };
  function random<T>(): T;

  const input: unknown;
`;

export interface ProjectOptions {
  /** Extra global declarations: named types the fixture modules refer to. */
  readonly declarations?: string;
  readonly emit?: EmitOptions;
}

export interface Built {
  /** The emitted source, so a test can assert what is and is not in it. */
  readonly code: string;
  /** The `check` the module declared, evaluated. */
  readonly check: (input: unknown) => unknown;
}

export class FixtureProject implements Disposable {
  readonly directory: string;
  readonly session: ReflectSession;
  /** The module the `transform`/`build`/`ir` helpers rewrite. */
  readonly module: string;

  readonly #emit: EmitOptions | undefined;
  #closed = false;

  private constructor(directory: string, session: ReflectSession, module: string, emit: EmitOptions | undefined) {
    this.directory = directory;
    this.session = session;
    this.module = module;
    this.#emit = emit;
  }

  /** The `tsconfig.json` that defines the project, for tests that drive the plugin. */
  get tsconfig(): string {
    return join(this.directory, 'tsconfig.json');
  }

  /**
   * Write a module and tell the session about it. Returns its path.
   *
   * `refresh: false` writes without telling the session, which leaves the program a
   * revision behind on purpose — the state the plugin's stale-file retry exists for.
   */
  write(name: string, source: string, options: { readonly refresh?: boolean } = {}): string {
    const path = join(this.directory, name);
    const fresh = !existsSync(path);
    writeFileSync(path, source);
    if (options.refresh === false) return path;
    if (fresh) this.session.created([path]);
    else this.session.refresh([path]);
    return path;
  }

  static open(options: ProjectOptions = {}): FixtureProject {
    const directory = mkdtempSync(join(tmpdir(), 'zmdb-emit-'));
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
    writeFileSync(join(directory, 'globals.d.ts'), `${GLOBALS}${options.declarations ?? ''}\n}\n\nexport {};\n`);
    const module = join(directory, 'module.ts');
    writeFileSync(module, '');
    const session = ReflectSession.open({ project: join(directory, 'tsconfig.json'), cwd: directory });
    return new FixtureProject(directory, session, module, options.emit);
  }

  /** Semantic diagnostics for the fixture itself. A broken fixture is not a finding. */
  diagnostics(): readonly Diagnostic[] {
    return [
      ...this.session.diagnostics(this.module),
      ...this.session.diagnostics(join(this.directory, 'globals.d.ts')),
    ];
  }

  transform(source: string): TransformResult {
    writeFileSync(this.module, source);
    this.session.refresh([this.module]);
    return transformFile(this.module, source, {
      session: this.session,
      ...(this.#emit ? { emit: this.#emit } : {}),
    });
  }

  /**
   * Transform `source` and evaluate it. `source` must assign the thing under test to a
   * `const check`, which is what comes back.
   *
   * The emitted `AssertError` import is turned into a parameter: `new Function` has no
   * module scope, and the point of the import is that the class is the *same* class in
   * dev and in a bundle, which a parameter preserves and a re-declaration would not.
   */
  build(source: string, options: { readonly expectUnchanged?: boolean } = {}): Built {
    const result = this.transform(source);
    if (result.diagnostics.length > 0) {
      throw new Error(`transform refused ${result.diagnostics.length} site(s): ${JSON.stringify(result.diagnostics)}`);
    }
    if (!result.changed && options.expectUnchanged !== true) {
      throw new Error('transform left the source unchanged; nothing was inlined');
    }
    return { code: result.code, check: evaluate(result.code) };
  }

  /**
   * The IR the emitter would be handed for `typeText`.
   *
   * The differential suite needs both sides of REQ-AV-4 to be talking about the *same*
   * type, so this goes through the same route `transformFile` does — a real call site, the
   * checker's answer for its type argument, one `Reflector` — rather than a second
   * hand-written description of the type that could drift from the first.
   */
  ir(typeText: string): TypeIR {
    const source = `const check = (input) => is<${typeText}>(input);\n`;
    writeFileSync(this.module, source);
    this.session.refresh([this.module]);
    const sourceFile = this.session.sourceFile(this.module);
    if (!sourceFile) throw new Error('the fixture module is not in the project');
    const site = findCallSites(sourceFile, new Set(['is']))[0];
    if (!site) throw new Error(`no call site found in: ${source}`);
    const type = this.session.checker.getTypeFromTypeNode(site.typeArgument);
    if (!type) throw new Error(`the checker has no type for \`${typeText}\``);
    const reflector = new Reflector(this.session.checker, sourceFile);
    const node = reflector.typeIR(type);
    if (reflector.diagnostics.length > 0) {
      throw new Error(`reflect refused \`${typeText}\`: ${JSON.stringify(reflector.diagnostics)}`);
    }
    return node;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.session.close();
    rmSync(this.directory, { recursive: true, force: true });
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

const IMPORT_LINE = /^import \{ AssertError as (\w+) \} from "[^"]*";\n/;

/** Evaluate emitted code and hand back its `check`. */
export function evaluate(code: string): (input: unknown) => unknown {
  const match = IMPORT_LINE.exec(code);
  if (!match) return new Function(`${code}\nreturn check;`)() as (input: unknown) => unknown;
  // `new Function` has no module scope, so the emitted import becomes a parameter. It
  // has to be the *same* class the runtime path throws, not a re-declaration: that
  // identity is the reason the emitted prelude imports it at all.
  const alias = match[1] as string;
  const factory = new Function(alias, `${code.replace(IMPORT_LINE, '')}\nreturn check;`) as (
    error: unknown,
  ) => (input: unknown) => unknown;
  return factory(AssertError);
}
