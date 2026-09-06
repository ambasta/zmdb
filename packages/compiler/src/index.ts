import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import type { NamingStrategy } from '@zmdb/schema-core/naming';

import { codegen } from './codegen/index.js';
import { artifactPaths, isGeneratedPath } from './codegen/witness.js';
import type { CompilerDiagnostic } from './errors.js';
import { openPreparedSession, type ReflectSession } from './reflect/session.js';

export type { CompilerDiagnostic } from './errors.js';

export interface CompileProjectOptions {
  readonly project: string;
  readonly files?: readonly string[];
  readonly naming?: NamingStrategy;
}

export interface CompiledArtifact {
  /** Rewritten application source. Its path is the matching member of `CompileResult.files`. */
  readonly source: string;
  readonly witnessPath: string;
  readonly runtimePath: string;
  readonly declarationPath: string;
  readonly witness: string;
  readonly runtime: string;
  readonly declaration: string;
}

export interface CompileResult {
  readonly project: string;
  readonly files: readonly string[];
  readonly artifacts: readonly CompiledArtifact[];
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly dependencies: readonly string[];
}

export interface WriteCompileResultOptions {
  readonly check?: boolean;
}

export interface WriteCompileResult {
  readonly written: readonly string[];
  readonly deleted: readonly string[];
  readonly stale: readonly string[];
}

interface SelectedProject {
  readonly files: readonly string[];
  readonly shadowFiles: readonly string[];
  readonly dependencies: readonly string[];
  readonly diagnostics: readonly CompilerDiagnostic[];
}

/**
 * Compile one project without changing it.
 *
 * The existing codegen pipeline runs against a disposable sibling shadow. Keeping the
 * shadow at the same directory depth preserves relative `extends` and `paths` entries,
 * while the real project remains byte-for-byte untouched until `writeCompileResult`.
 */
export async function compileProject(options: CompileProjectOptions): Promise<CompileResult> {
  const project = resolve(options.project);
  const root = dirname(project);
  const shadow = mkdtempSync(join(dirname(root), `.zmdb-compile-${basename(root)}-`));
  try {
    copyProject(root, shadow);
    const shadowProject = join(shadow, relative(root, project));
    let session: ReflectSession;
    try {
      session = openPreparedSession({ project: shadowProject }, config =>
        writeGeneratedProject(shadowProject, config.fileNames),
      );
    } catch (error: unknown) {
      return {
        project,
        files: [],
        artifacts: [],
        diagnostics: [
          {
            code: 'ZMDB_PROJECT',
            message: error instanceof Error ? error.message : String(error),
            file: project,
          },
        ],
        dependencies: [],
      };
    }

    try {
      const selected = selectProjectFiles(session, project, shadowProject, options.files);
      if (selected.diagnostics.length > 0) {
        return {
          project,
          files: selected.files,
          artifacts: [],
          diagnostics: selected.diagnostics,
          dependencies: selected.dependencies,
        };
      }

      const generated = codegen({
        project: session.project,
        files: selected.shadowFiles,
        session,
        ...(options.naming === undefined ? {} : { naming: options.naming }),
      });
      const diagnostics = generated.problems.map((message): CompilerDiagnostic => ({ code: 'ZMDB_COMPILE', message }));
      const artifacts = selected.files.flatMap((file, index): readonly CompiledArtifact[] => {
        const shadowFile = selected.shadowFiles[index];
        if (shadowFile === undefined) return [];
        const shadowPaths = artifactPaths(shadowFile);
        if (!existsSync(shadowPaths.witness) || !existsSync(shadowPaths.js) || !existsSync(shadowPaths.dts)) {
          return [];
        }
        const paths = artifactPaths(file);
        return [
          {
            source: readFileSync(shadowFile, 'utf8'),
            witnessPath: paths.witness,
            runtimePath: paths.js,
            declarationPath: paths.dts,
            witness: readFileSync(shadowPaths.witness, 'utf8'),
            runtime: readFileSync(shadowPaths.js, 'utf8'),
            declaration: readFileSync(shadowPaths.dts, 'utf8'),
          },
        ];
      });

      return {
        project,
        files: selected.files,
        artifacts,
        diagnostics,
        dependencies: selected.dependencies,
      };
    } finally {
      session.close();
    }
  } finally {
    rmSync(shadow, { recursive: true, force: true });
  }
}

function writeGeneratedProject(project: string, files: readonly string[]): string {
  const root = dirname(project);
  const prepared = join(root, '.zmdb-compile.tsconfig.json');
  const extended = relative(root, project).replaceAll(sep, '/');
  const roots = files.map(file => relative(root, file).replaceAll(sep, '/')).toSorted();
  writeFileSync(
    prepared,
    `${JSON.stringify(
      {
        extends: extended.startsWith('.') ? extended : `./${extended}`,
        files: roots,
        include: ['**/*.zmdb.witness.ts'],
        exclude: [],
      },
      undefined,
      2,
    )}\n`,
  );
  return prepared;
}

/** Apply or check one previously compiled result. No compilation occurs here. */
export async function writeCompileResult(
  result: CompileResult,
  options: WriteCompileResultOptions = {},
): Promise<WriteCompileResult> {
  const expected = new Map<string, string>();
  const artifactByWitness = new Map(result.artifacts.map(artifact => [pathKey(artifact.witnessPath), artifact]));

  for (const file of result.files) {
    const paths = artifactPaths(file);
    const artifact = artifactByWitness.get(pathKey(paths.witness));
    if (artifact === undefined) continue;
    expected.set(file, artifact.source);
    expected.set(paths.witness, artifact.witness);
    expected.set(paths.js, artifact.runtime);
    expected.set(paths.dts, artifact.declaration);
  }

  const stale: string[] = [];
  const deletions: string[] = [];
  for (const file of result.files) {
    const paths = artifactPaths(file);
    if (artifactByWitness.has(pathKey(paths.witness))) continue;
    for (const path of [paths.witness, paths.js, paths.dts]) {
      if (existsSync(path)) {
        deletions.push(path);
        stale.push(path);
      }
    }
  }

  for (const [path, source] of expected) {
    if (readText(path) !== source) stale.push(path);
  }

  const orderedStale = [...new Set(stale)].toSorted();
  const orderedDeleted = [...new Set(deletions)].toSorted();
  if (options.check === true) {
    return { written: [], deleted: orderedDeleted, stale: orderedStale };
  }

  for (const path of orderedDeleted) unlinkSync(path);
  const written: string[] = [];
  let sequence = 0;
  for (const path of orderedStale) {
    const source = expected.get(path);
    if (source === undefined) continue;
    writeAtomic(path, source, sequence++);
    written.push(path);
  }
  return { written, deleted: orderedDeleted, stale: orderedStale };
}

function selectProjectFiles(
  session: ReflectSession,
  project: string,
  shadowProject: string,
  requested: readonly string[] | undefined,
): SelectedProject {
  const root = dirname(project);
  const shadowRoot = dirname(shadowProject);
  const members = new Map(
    session
      .sourceFileNames()
      .filter(file => isProjectSource(file, shadowRoot))
      .map(shadowFile => {
        const file = normalize(join(root, relative(shadowRoot, shadowFile)));
        return [pathKey(file), { file, shadowFile: normalize(shadowFile) }] as const;
      }),
  );
  const diagnostics: CompilerDiagnostic[] = [];
  const selected: { readonly file: string; readonly shadowFile: string }[] = [];
  const seen = new Set<string>();
  const candidates =
    requested === undefined
      ? [...members.values()].map(member => member.file)
      : requested.map(file => normalize(isAbsolute(file) ? file : resolve(root, file)));

  for (const file of candidates) {
    const key = pathKey(file);
    if (seen.has(key)) {
      diagnostics.push({ code: 'ZMDB_DUPLICATE_FILE', message: `duplicate project file ${file}`, file });
      continue;
    }
    seen.add(key);
    if (isGeneratedPath(file)) {
      diagnostics.push({ code: 'ZMDB_GENERATED_INPUT', message: `generated input is not compilable: ${file}`, file });
      continue;
    }
    const member = members.get(key);
    if (member === undefined) {
      diagnostics.push({
        code: 'ZMDB_PROJECT_MEMBER',
        message: `${file} is not a source member of ${project}`,
        file,
      });
      continue;
    }
    selected.push(member);
  }

  const ordered = selected.toSorted((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  const selectedPaths = new Set(ordered.map(member => pathKey(member.file)));
  const dependencies = [...members.values()]
    .filter(member => !selectedPaths.has(pathKey(member.file)))
    .map(member => member.file)
    .toSorted();
  return {
    files: ordered.map(member => member.file),
    shadowFiles: ordered.map(member => member.shadowFile),
    dependencies,
    diagnostics,
  };
}

function isProjectSource(file: string, root: string): boolean {
  if (file.includes(`${sep}node_modules${sep}`) || file.includes('/node_modules/')) return false;
  if (/\.d\.[cm]?ts$/.test(file) || !/\.[cm]?tsx?$/.test(file) || isGeneratedPath(file)) return false;
  const inside = relative(root, file);
  return inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside);
}

function copyProject(root: string, shadow: string): void {
  cpSync(root, shadow, {
    recursive: true,
    filter(source) {
      const name = basename(source);
      return name !== '.git' && name !== 'node_modules';
    },
  });
  const modules = join(root, 'node_modules');
  if (existsSync(modules)) symlinkSync(modules, join(shadow, 'node_modules'), 'dir');
}

function pathKey(path: string): string {
  const value = normalize(path);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function writeAtomic(path: string, source: string, sequence: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.zmdb-${String(process.pid)}-${String(sequence)}`);
  try {
    writeFileSync(temporary, source);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}
