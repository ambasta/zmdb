// The one place that talks to the TypeScript compiler.
//
// `typescript@7` is the Go compiler with a thin JS client: `import('typescript')`
// resolves to exactly two keys (`version`, `versionMajorMinor`) and the real surface
// lives behind subpath exports. The checker is `typescript/unstable/sync`, and every
// call round-trips to a `tsgo` child process over a synchronous pipe.
//
// Two consequences shape this file:
//
//  1. **One session per build, not one per type.** Spawning the server and loading a
//     project is the expensive part; a checker call is cheap. Every consumer takes a
//     `ReflectSession` and holds it for the whole run.
//  2. **`close()` is not optional.** The child process outlives the import if nobody
//     closes it, which in a test runner means a hung worker. `using` works, and
//     `withSession` is there for the cases that cannot use it.
//
// `unstable` in the specifier is the compiler's word, not ours: the API is not
// covered by TypeScript's stability guarantee, so it is contained here rather than
// spread over the reflection and the emitter.

import { API } from 'typescript/unstable/sync';
import type { Checker, Diagnostic, Program } from 'typescript/unstable/sync';

/** A parsed source file, as the checker's client models one. */
export type SourceFileHandle = NonNullable<ReturnType<Program['getSourceFile']>>;

export interface SessionOptions {
  /** Absolute path to the `tsconfig.json` that defines the program. */
  readonly project: string;
  /** Working directory for module resolution. Defaults to the project's directory. */
  readonly cwd?: string;
}

/**
 * An open compiler session: one server process, one loaded project, one checker.
 *
 * ```ts
 * using session = ReflectSession.open({ project: '/abs/tsconfig.json' });
 * const ir = irFromType({ checker: session.checker, location: sf }, type);
 * ```
 */
export class ReflectSession implements Disposable {
  readonly checker: Checker;
  readonly program: Program;

  #api: { close(): void };
  #closed = false;

  private constructor(api: { close(): void }, program: Program, checker: Checker) {
    this.#api = api;
    this.program = program;
    this.checker = checker;
  }

  static open(options: SessionOptions): ReflectSession {
    const cwd = options.cwd ?? options.project.replace(/[/\\][^/\\]*$/, '');
    const api = new API({ cwd });
    // `getProjects()` is empty rather than throwing when the config does not parse,
    // and an empty project list would otherwise surface much later as "every type is
    // `unsupported`" — a wrong answer dressed up as a supported one.
    const project = api.updateSnapshot({ openProjects: [options.project] }).getProjects()[0];
    if (!project) {
      api.close();
      throw new Error(`could not load a TypeScript project from ${options.project}`);
    }
    return new ReflectSession(api, project.program, project.checker);
  }

  /** The parsed file, or `undefined` when it is not part of the program. */
  sourceFile(fileName: string): SourceFileHandle | undefined {
    return this.program.getSourceFile(fileName);
  }

  /**
   * Semantic diagnostics for one file. The reflection reads types, and a type in a
   * file that does not compile is a guess, so callers check this before trusting
   * anything derived from it.
   */
  diagnostics(fileName: string): readonly Diagnostic[] {
    return this.program.getSemanticDiagnostics(fileName);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#api.close();
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** `try`/`finally` around a session, for callers that cannot use `using`. */
export function withSession<T>(options: SessionOptions, fn: (session: ReflectSession) => T): T {
  const session = ReflectSession.open(options);
  try {
    return fn(session);
  } finally {
    session.close();
  }
}
