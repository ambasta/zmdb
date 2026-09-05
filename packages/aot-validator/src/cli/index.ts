// `zmdb-codegen`: the AOT validator without a bundler.
//
// The unplugin gets the type information for free — a bundler hands it a module, it asks the
// compiler about the type arguments in it, and it hands back rewritten source that only the
// bundler ever sees. A project built by plain `tsc`, or run straight off `node --strip-types`,
// has nowhere to put that step, and REQ-AV-3 says the compiled path may not be a reward for
// choosing a particular bundler. So this writes the rewrite down.
//
// Per source file that validates anything, three files (see `./witness.ts` for why three)
// and one edit to the source: `is<User>(data)` becomes `zmdbIsUser(data)`, imported from a
// generated module. The result is checked in, so a clone of the repository builds the fast
// path with no tool at all in the way.
//
// ## The order matters, and it is not the obvious one
//
// Every witness is written *before* any of them is transformed. The reason is cost: telling
// the compiler about a new file is a snapshot update, and a snapshot update per file would
// make a hundred-file project a hundred re-checks. Two updates for the whole run is the
// difference between this being usable and being a thing people turn off (REQ-TF-11).
//
// ## `--check` writes nothing, and still checks everything
//
// A check that had to write the witnesses to verify them would be a check that dirties the
// tree it is auditing. It does not have to: the witness is a pure function of the scan, so a
// stale one is caught by comparing text. And if every witness matches, then the compiled
// modules are derivable from files already on disk — the transform runs against those, and
// its output is compared the same way.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { resolveNaming, type NamingStrategyConfig } from '@zmdb/schema-core/naming';

import { ReflectSession, type SourceFileHandle } from '../reflect/session.js';
import { CALLEES, transformFile } from '../transformer.js';
import { scan, type Entry, type SiteEntry, type TypeImport } from './scan.js';
import {
  artifactPaths,
  generatedModules,
  isGeneratedPath,
  quoteStyle,
  rewriteSource,
  witnessSource,
  type ArtifactPaths,
} from './witness.js';

export interface CodegenOptions {
  /** Path to the `tsconfig.json` that defines what to generate for. */
  readonly project: string;
  /** Report what would change and write nothing. */
  readonly check?: boolean | undefined;
  /** Where progress goes. Defaults to nowhere, so a library caller stays quiet. */
  readonly log?: ((line: string) => void) | undefined;
  /**
   * An already-open session, as the plugin takes. The caller keeps ownership, closing
   * included.
   *
   * A caller that already has the project loaded should not pay to load it again — that is
   * REQ-TF-11's whole point, and it applies to a tool driving `codegen` just as much as to
   * the build it is part of. It is also what makes the claim observable: the session records
   * its snapshot updates, so `verify:build-budget` can watch a 64-module run and see that the
   * project is opened once.
   */
  readonly session?: ReflectSession | undefined;
  /** A named or custom build-time strategy, resolved once for this run. */
  readonly naming?: NamingStrategyConfig;
}

export interface CodegenResult {
  /** Absolute paths written, or — under `--check` — that would have been. */
  readonly written: readonly string[];
  /** Absolute paths deleted, because their source stopped validating anything. */
  readonly deleted: readonly string[];
  /** Everything that stopped a file from being generated, formatted for a terminal. */
  readonly problems: readonly string[];
  readonly ok: boolean;
}

/**
 * Cheap pre-filter: does this file even mention one of the transformed functions with a type
 * argument? Reading a file and matching a regex is orders of magnitude less than asking the
 * compiler for its AST, and in a real project almost every file answers no.
 */
const MENTIONS_CALLEE = new RegExp(`\\b(?:${[...CALLEES].join('|')})\\s*<`);

export function codegen(options: CodegenOptions): CodegenResult {
  const project = resolve(options.project);
  if (options.session) return run(options.session, project, options);
  using session = ReflectSession.open({ project });
  return run(session, project, options);
}

// -----------------------------------------------------------------------------
// One pass
// -----------------------------------------------------------------------------

interface Candidate {
  readonly fileName: string;
  readonly sourceFile: SourceFileHandle;
  readonly code: string;
  readonly paths: ArtifactPaths;
  readonly hadWitness: boolean;
  /** The quote character this file writes its own imports with. */
  readonly style: string;
  /** Filled in by the scan. Empty means the file validates nothing any more. */
  entries: readonly Entry[];
  sites: readonly SiteEntry[];
  typeImports: readonly TypeImport[];
  calleeSources: ReadonlyMap<string, string>;
  witness: string;
}

function run(session: ReflectSession, project: string, options: CodegenOptions): CodegenResult {
  const root = dirname(project);
  const log = options.log ?? (() => undefined);
  const check = options.check === true;
  const reflect = { naming: resolveNaming(options.naming) } as const;
  const problems: string[] = [];
  const written: string[] = [];
  const deleted: string[] = [];
  const show = (path: string): string => relative(root, path) || path;

  const tsExtensions = session.compilerOptions()['allowImportingTsExtensions'] === true;

  // -- Phase 1: what to generate ---------------------------------------------

  const candidates: Candidate[] = [];
  for (const fileName of session.sourceFileNames()) {
    if (!isCandidate(fileName, root)) continue;
    const paths = artifactPaths(fileName);
    const hadWitness = existsSync(paths.witness);
    let code: string;
    try {
      code = readFileSync(fileName, 'utf8');
    } catch {
      // In the program but not on disk. A virtual file from another tool's plugin, or a race
      // with a delete; either way there is nothing here to rewrite.
      continue;
    }
    if (!hadWitness && !MENTIONS_CALLEE.test(code)) continue;

    const sourceFile = session.sourceFile(fileName);
    if (!sourceFile) {
      problems.push(`${show(fileName)}: in the project's file list but the compiler has no parse of it`);
      continue;
    }
    if (sourceFile.text !== code) {
      problems.push(`${show(fileName)}: changed on disk since the project loaded; run again`);
      continue;
    }

    const witnessFile = hadWitness ? session.sourceFile(paths.witness) : undefined;
    if (hadWitness && !witnessFile) {
      problems.push(
        `${show(paths.witness)}: exists but is not part of ${show(project)}. ` +
          'The witness has to be typechecked, so the project must include it.',
      );
      continue;
    }

    const scanned = scan({ sourceFile, witnessFile, tsExtensions });
    for (const refusal of scanned.refusals) {
      problems.push(`${show(fileName)}: cannot generate for \`${refusal.typeText}\` — ${refusal.reason}`);
    }
    if (scanned.refusals.length > 0) continue;

    const sourceName = show(fileName);
    const style = quoteStyle(sourceFile);
    candidates.push({
      fileName,
      sourceFile,
      code,
      paths,
      hadWitness,
      style,
      entries: scanned.entries,
      sites: scanned.sites,
      typeImports: scanned.typeImports,
      calleeSources: scanned.calleeSources,
      witness:
        scanned.entries.length === 0
          ? ''
          : witnessSource({
              sourceName,
              entries: scanned.entries,
              typeImports: scanned.typeImports,
              calleeSources: scanned.calleeSources,
              style,
            }),
    });
  }

  // -- Phase 2: the witnesses, then one snapshot update ---------------------

  const created: string[] = [];
  const refreshed: string[] = [];
  const stale = new Set<Candidate>();

  for (const candidate of candidates) {
    if (candidate.witness.length === 0) continue;
    const current = candidate.hadWitness ? readFileSync(candidate.paths.witness, 'utf8') : undefined;
    if (current === candidate.witness) continue;
    if (check) {
      // Without the right witness on disk there is nothing to transform, so this file's
      // compiled modules are not examined further — the answer is already "stale".
      written.push(candidate.paths.witness);
      stale.add(candidate);
      continue;
    }
    mkdirSync(dirname(candidate.paths.witness), { recursive: true });
    writeFileSync(candidate.paths.witness, candidate.witness);
    written.push(candidate.paths.witness);
    (candidate.hadWitness ? refreshed : created).push(candidate.paths.witness);
  }

  if (created.length > 0) session.created(created);
  if (refreshed.length > 0) session.refresh(refreshed);

  // -- Phase 3: the compiled modules and the rewrite ------------------------

  for (const candidate of candidates) {
    if (stale.has(candidate)) continue;

    if (candidate.witness.length === 0) {
      // The source stopped validating. Its artifacts are removed rather than left behind:
      // a witness with no referent is a validator for code that is gone.
      for (const path of [candidate.paths.witness, candidate.paths.js, candidate.paths.dts]) {
        if (!existsSync(path)) continue;
        deleted.push(path);
        if (!check) rmSync(path);
      }
      const rewritten = rewriteSource({
        sourceFile: candidate.sourceFile,
        code: candidate.code,
        sites: [],
        specifier: candidate.paths.specifier,
        entries: [],
        calleeSources: candidate.calleeSources,
        style: candidate.style,
      });
      emit(candidate.fileName, rewritten);
      continue;
    }

    const diagnostics = session.diagnostics(candidate.paths.witness);
    if (diagnostics.length > 0) {
      const first = diagnostics[0];
      problems.push(
        `${show(candidate.paths.witness)}: does not typecheck (TS${String(first?.code ?? 0)}: ${first?.text ?? ''}). ` +
          'A type read out of a file that does not compile is a guess.',
      );
      continue;
    }

    const errorModule =
      candidate.calleeSources.get('assert') ??
      candidate.calleeSources.get('assertShallow') ??
      candidate.calleeSources.get('assertEquals') ??
      '@zmdb/aot-validator/utilities';
    const transformed = transformFile(candidate.paths.witness, candidate.witness, {
      session,
      reflect,
      emit: { errorModule },
    });
    if (transformed.diagnostics.length > 0) {
      for (const diagnostic of transformed.diagnostics) {
        const where = diagnostic.path ? ` at \`${diagnostic.path}\`` : '';
        problems.push(
          `${show(candidate.fileName)}: ${diagnostic.callee ?? 'the transform'} refused${where} — ${diagnostic.reason}`,
        );
      }
      continue;
    }
    if (!transformed.changed) {
      problems.push(
        `${show(candidate.paths.witness)}: the transform left every call in place, so nothing was compiled`,
      );
      continue;
    }

    const modules = generatedModules({
      sourceName: show(candidate.fileName),
      entries: candidate.entries,
      typeImports: candidate.typeImports,
      calleeSources: candidate.calleeSources,
      style: candidate.style,
      transformed: transformed.code,
    });
    emit(candidate.paths.js, modules.js);
    emit(candidate.paths.dts, modules.dts);

    emit(
      candidate.fileName,
      rewriteSource({
        sourceFile: candidate.sourceFile,
        code: candidate.code,
        sites: candidate.sites,
        specifier: candidate.paths.specifier,
        entries: candidate.entries,
        calleeSources: candidate.calleeSources,
        style: candidate.style,
      }),
    );
  }

  function emit(path: string, text: string): void {
    let current: string | undefined;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      current = undefined;
    }
    if (current === text) return;
    written.push(path);
    if (check) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }

  for (const path of written) log(`${check ? 'stale' : 'wrote'} ${show(path)}`);
  for (const path of deleted) log(`${check ? 'orphan' : 'removed'} ${show(path)}`);

  return {
    written,
    deleted,
    problems,
    ok: problems.length === 0 && (!check || (written.length === 0 && deleted.length === 0)),
  };
}

/** Files this run may rewrite: the project's own TypeScript, minus what it generated. */
function isCandidate(fileName: string, root: string): boolean {
  if (fileName.includes(`${sep}node_modules${sep}`) || fileName.includes('/node_modules/')) return false;
  if (/\.d\.[cm]?ts$/.test(fileName)) return false;
  if (!/\.[cm]?tsx?$/.test(fileName)) return false;
  if (isGeneratedPath(fileName)) return false;
  // A project can reference files above its own directory; rewriting one would edit a
  // package this run was not pointed at.
  const inside = relative(root, fileName);
  return inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside);
}

// -----------------------------------------------------------------------------
// Watch
// -----------------------------------------------------------------------------

export interface WatchOptions extends CodegenOptions {
  /** Quiet period after a change before regenerating. Editors save in bursts. */
  readonly debounceMs?: number | undefined;
  /** Resolves when the watch should stop. Omit to watch until the process ends. */
  readonly until?: Promise<unknown> | undefined;
}

/**
 * Regenerate on every save, on one compiler session.
 *
 * The session is the whole reason this is not "run the CLI from a file watcher": reopening
 * the project per keystroke re-reads the config and re-walks the import graph, which is the
 * expensive half of a build. `ReflectSession.refresh` re-checks only what changed.
 */
export async function watchCodegen(options: WatchOptions): Promise<CodegenResult> {
  // The promise-based watcher, because it is the async-iterable one: the callback form
  // would need a queue between the events and the debounce.
  const { watch } = await import('node:fs/promises');
  const project = resolve(options.project);
  const root = dirname(project);
  const log = options.log ?? (() => undefined);
  // A borrowed session is not this function's to close, the way it is not the plugin's.
  const borrowed = options.session;
  const session = borrowed ?? ReflectSession.open({ project });

  let last = run(session, project, options);
  report(last, log);

  // Stopping is an abort rather than a flag, because the iteration parks in the watcher
  // until something changes: a flag checked at the top of the loop would leave the process
  // alive until the next unrelated save.
  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
  };
  void options.until?.then(stop, stop);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<string>();
  const flush = (): void => {
    const changed = [...pending];
    pending.clear();
    if (changed.length === 0) return;
    // Told about the edits, not asked to reload: `refresh` is what makes a watch cheaper
    // than a rebuild.
    const live = changed.filter(path => existsSync(path));
    if (live.length > 0) session.refresh(live);
    const gone = changed.filter(path => !existsSync(path));
    if (gone.length > 0) session.deleted(gone);
    last = run(session, project, options);
    report(last, log);
  };

  try {
    for await (const event of watch(root, { recursive: true, signal: controller.signal })) {
      const name = typeof event.filename === 'string' ? resolve(root, event.filename) : undefined;
      if (name === undefined) continue;
      if (isGeneratedPath(name) || !/\.[cm]?tsx?$/.test(name) || /\.d\.[cm]?ts$/.test(name)) continue;
      pending.add(name);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, options.debounceMs ?? 60);
    }
  } catch (error) {
    // `abort` is how this loop is meant to end, so it is not news.
    if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (!borrowed) session.close();
  }
  return last;
}

function report(result: CodegenResult, log: (line: string) => void): void {
  for (const problem of result.problems) log(`error: ${problem}`);
  if (result.problems.length === 0 && result.written.length === 0 && result.deleted.length === 0) log('up to date');
}
