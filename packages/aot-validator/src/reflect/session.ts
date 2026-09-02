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

/** What a snapshot update was for. The session keeps the log; see `updates`. */
export type SessionUpdate = 'open' | 'refresh' | 'invalidate';

// The three things a watcher can report about a file. Mutable arrays, and not because
// anything here mutates them: the compiler's own `FileChangeSummary` declares them mutable,
// and under `exactOptionalPropertyTypes` a `readonly string[]` will not go in.
interface FileEdits {
  changed?: string[];
  created?: string[];
  deleted?: string[];
}

/**
 * How many compiler servers this process has started.
 *
 * REQ-TF-11 asks for one `API` instance per build, which is the difference between a
 * build that loads the project once and one that loads it per file. A claim like that
 * needs a number behind it, so the counter lives here and the build-budget test reads
 * it.
 */
let apiInstances = 0;

export function apiInstanceCount(): number {
  return apiInstances;
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
  readonly project: string;

  #api: API;
  #program: Program;
  #checker: Checker;
  #closed = false;
  readonly #updates: SessionUpdate[] = ['open'];

  private constructor(api: API, project: string, program: Program, checker: Checker) {
    this.#api = api;
    this.project = project;
    this.#program = program;
    this.#checker = checker;
  }

  /**
   * The checker and program come from the *current* snapshot, so they are getters
   * rather than fields: after `refresh` the old pair belongs to a disposed snapshot,
   * and a caller holding one would be reading a program that no longer exists.
   */
  get checker(): Checker {
    return this.#checker;
  }

  get program(): Program {
    return this.#program;
  }

  /** Every snapshot update this session has performed, in order. See `SessionUpdate`. */
  get updates(): readonly SessionUpdate[] {
    return this.#updates;
  }

  static open(options: SessionOptions): ReflectSession {
    const cwd = options.cwd ?? options.project.replace(/[/\\][^/\\]*$/, '');
    apiInstances++;
    const api = new API({ cwd });
    // `getProjects()` is empty rather than throwing when the config does not parse,
    // and an empty project list would otherwise surface much later as "every type is
    // `unsupported`" — a wrong answer dressed up as a supported one.
    const project = api.updateSnapshot({ openProjects: [options.project] }).getProjects()[0];
    if (!project) {
      api.close();
      throw new Error(`could not load a TypeScript project from ${options.project}`);
    }
    return new ReflectSession(api, options.project, project.program, project.checker);
  }

  /**
   * Pick up edits to `changed` without reloading the project.
   *
   * This is the whole of watch-mode support, and the reason it is one method rather
   * than "open a new session" is cost: `openProjects` re-reads the config and re-walks
   * the import graph, which is the expensive half of a build. `fileChanges` re-checks
   * the files that changed. A watch that reopened the project per keystroke would make
   * the AOT path slower than the runtime one it replaces.
   */
  refresh(changed: readonly string[]): void {
    this.#files({ changed: [...changed] });
  }

  /**
   * Tell the program about files that did not exist when it loaded.
   *
   * A `changed` notification for a file the program has never seen is a no-op — measured:
   * `getSourceFile` keeps returning `undefined` — so a new module has to arrive as
   * `created` or it stays invisible for the rest of the build. That is exactly the shape
   * of "add a file in watch mode", so it is not an edge case.
   */
  created(files: readonly string[]): void {
    this.#files({ created: [...files] });
  }

  deleted(files: readonly string[]): void {
    this.#files({ deleted: [...files] });
  }

  #files(changes: FileEdits): void {
    if (Object.values(changes).every(names => names.length === 0)) return;
    this.#update('refresh', { fileChanges: changes });
  }

  /** For the cases a watcher cannot describe — a config change, a new dependency. */
  invalidateAll(): void {
    this.#update('invalidate', { fileChanges: { invalidateAll: true } });
  }

  #update(kind: SessionUpdate, params: Parameters<API['updateSnapshot']>[0]): void {
    if (this.#closed) throw new Error('the compiler session is closed');
    // Deliberately no `openProjects` here: the open is ref-counted and persists across
    // snapshots, so naming it again would both leak a reference and reload the project.
    const snapshot = this.#api.updateSnapshot(params);
    const project = snapshot.getProject(this.project) ?? snapshot.getProjects()[0];
    if (!project) throw new Error(`the TypeScript project ${this.project} disappeared from the snapshot`);
    this.#program = project.program;
    this.#checker = project.checker;
    this.#updates.push(kind);
  }

  /** The parsed file, or `undefined` when it is not part of the program. */
  sourceFile(fileName: string): SourceFileHandle | undefined {
    return this.#program.getSourceFile(fileName);
  }

  /**
   * Semantic diagnostics for one file. The reflection reads types, and a type in a
   * file that does not compile is a guess, so callers check this before trusting
   * anything derived from it.
   */
  diagnostics(fileName: string): readonly Diagnostic[] {
    return this.#program.getSemanticDiagnostics(fileName);
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
