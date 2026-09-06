// The bundler hook. One compiler session per build, one transform per module.
//
// `enforce: 'pre'` is load-bearing rather than decorative. The transform rewrites by
// text offset against the positions the TypeScript compiler parsed, so it has to see
// the module before anything else edits it. Running late means `sourceFile.text !== code`
// and the whole file degrades to the tag-only path — silently faster to build and
// silently slower to run, which is the worst way for this to fail.
//
// The session is opened on the first module and held for the build (REQ-TF-11). Loading
// the project is the expensive half; a checker call is a cheap round-trip. A session per
// file would make the AOT path cost more than the runtime walker it replaces.

import { resolveNaming, type NamingStrategyConfig } from '@zmdb/schema-core/naming';

import type { EmitOptions } from '../emit/index.js';
import { ReflectSession } from '../reflect/session.js';
import { transformCode, transformFile, type TransformDiagnostic } from '../transform/index.js';

export { transformCode } from '../transform/index.js';

/** Inline `validate(tags.X(…), …)` with no compiler. Type arguments need `transformFile`. */
export function transformTypeChecks(code: string): string {
  return transformCode(code);
}

export interface UnpluginLike {
  readonly name: string;
  /**
   * Rollup/Vite ordering. `'pre'` because the offsets this plugin rewrites at are only
   * valid for the text the compiler parsed.
   */
  readonly enforce?: 'pre' | 'post';
  transform(code: string, id: string): { code: string } | null;
  /**
   * Watch mode: re-check the changed file without reloading the project.
   *
   * The `change` argument is Rollup's, and it matters rather than being decorative: a
   * `changed` notification for a file the program has never seen does nothing at all, so a
   * newly added module has to be reported as `create` or it stays invisible.
   */
  watchChange?(id: string, change?: WatchChange): void;
  buildEnd?(): void;
}

/** Rollup's second argument to `watchChange`. */
export interface WatchChange {
  readonly event: 'create' | 'update' | 'delete';
}

export interface ZmdbAotOptions {
  /**
   * Absolute path to the `tsconfig.json` that defines the program. Without one — and
   * without `session` — the plugin cannot ask what a type is, so it inlines only the
   * `validate(tags.X(…), …)` form and leaves every `f<T>(…)` call alone.
   */
  readonly project?: string;
  readonly cwd?: string;
  /** An already-open session. The caller keeps ownership, including closing it. */
  readonly session?: ReflectSession;
  readonly emit?: EmitOptions;
  /** A named or custom build-time strategy, resolved once for this plugin instance. */
  readonly naming?: NamingStrategyConfig;
  /**
   * Called for each refused call site. The default throws, because a type the emitter
   * could not model means the call falls back to a runtime walker that has no
   * descriptor to walk — a build that "succeeded" and a program that throws on first
   * use (plan D4).
   */
  readonly onDiagnostic?: (diagnostic: TransformDiagnostic) => void;
}

const SOURCE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/;

export function zmdbAot(options: ZmdbAotOptions = {}): UnpluginLike {
  let session: ReflectSession | undefined = options.session;
  const reflect = { naming: resolveNaming(options.naming) } as const;
  /** Whether this plugin opened the session, and therefore has to close it. */
  let owned = false;
  /** Files already refreshed after a text mismatch, so the retry happens at most once. */
  const retried = new Set<string>();

  const ensureSession = (): ReflectSession | undefined => {
    if (session) return session;
    if (options.project === undefined) return undefined;
    session = ReflectSession.open({ project: options.project, ...(options.cwd ? { cwd: options.cwd } : {}) });
    owned = true;
    return session;
  };

  return {
    name: 'zmdb-aot',
    enforce: 'pre',

    transform(code: string, id: string): { code: string } | null {
      // Never dependencies and never declaration files: a package ships already-built
      // JavaScript, and rewriting it would be rewriting someone else's compiled output.
      if (id.includes('node_modules')) return null;
      if (id.endsWith('.d.ts') || !SOURCE.test(id)) return null;

      const open = ensureSession();
      if (!open) {
        const out = transformCode(code);
        return out === code ? null : { code: out };
      }

      // Workspace package exports point at source files, so a bundler can hand us a
      // dependency whose path does not contain `node_modules`. The compiler still marks
      // that file as an external library. Treat it exactly like an installed dependency:
      // framework code ships its own build and must not be recompiled as consumer code.
      const sourceFile = open.sourceFile(id);
      if (sourceFile !== undefined && open.program.isSourceFileFromExternalLibrary(sourceFile)) return null;

      let result = transformFile(id, code, {
        session: open,
        reflect,
        ...(options.emit ? { emit: options.emit } : {}),
      });

      // A stale program is the likely cause of a text mismatch, and it is cheap to rule
      // out: re-check this one file and try again. Once per file — if the text still
      // disagrees, something else edited the module and no refresh will fix that.
      if (isStale(result.diagnostics) && !retried.has(id)) {
        retried.add(id);
        // A module the program has never seen has to be announced as created; telling it a
        // file it does not know about "changed" is a no-op.
        if (open.sourceFile(id)) open.refresh([id]);
        else open.created([id]);
        result = transformFile(id, code, {
          session: open,
          reflect,
          ...(options.emit ? { emit: options.emit } : {}),
        });
      }

      const refusals = result.diagnostics.filter(diagnostic => diagnostic.position !== undefined);
      if (refusals.length > 0) {
        if (options.onDiagnostic) for (const refusal of refusals) options.onDiagnostic(refusal);
        else throw new Error(formatRefusals(refusals));
      }

      return result.changed ? { code: result.code } : null;
    },

    watchChange(id: string, change?: WatchChange): void {
      retried.delete(id);
      if (!session) return;
      if (change?.event === 'create') session.created([id]);
      else if (change?.event === 'delete') session.deleted([id]);
      else session.refresh([id]);
    },

    buildEnd(): void {
      if (owned) session?.close();
      session = undefined;
      owned = false;
      retried.clear();
    },
  };
}

/**
 * Whether the complaint was about the program's view of the file rather than the code.
 *
 * Both cases are recoverable and both are ordinary: the bundler is handing over a module
 * the compiler has not read yet (a new file) or has read at an older revision (an edit).
 * A refusal about a call site is not in here, because no amount of re-reading fixes it.
 */
function isStale(diagnostics: readonly TransformDiagnostic[]): boolean {
  return diagnostics.some(
    diagnostic =>
      diagnostic.position === undefined &&
      (diagnostic.reason.includes('not the text the compiler parsed') ||
        diagnostic.reason.includes('not part of the TypeScript project')),
  );
}

function formatRefusals(refusals: readonly TransformDiagnostic[]): string {
  const lines = refusals.map(refusal => {
    const where = refusal.path === '' ? '' : ` at \`${refusal.path}\``;
    const printed = refusal.source === undefined ? '' : ` (${refusal.source})`;
    return `  ${refusal.fileName}:${refusal.position ?? 0} — \`${refusal.callee ?? '?'}<T>\`${where}: ${refusal.reason}${printed}`;
  });
  return `@zmdb/compiler cannot compile ${refusals.length} call site(s):\n${lines.join('\n')}`;
}
