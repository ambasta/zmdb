import { existsSync, readFileSync } from 'node:fs';
import { glob, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { format as formatWithOxfmt, FormatConfig } from 'oxfmt';

import {
  templateFor,
  type ScaffoldKind,
  type ScaffoldName,
  type TemplateFile,
  type TemplatePlan,
} from './templates/index.js';

const SCAFFOLD_KINDS: readonly ScaffoldKind[] = ['project', 'schema', 'controller', 'module', 'repository', 'command'];

const FORMAT_OPTIONS: FormatConfig = {
  arrowParens: 'avoid',
  bracketSpacing: true,
  endOfLine: 'lf',
  insertFinalNewline: true,
  objectWrap: 'preserve',
  printWidth: 120,
  quoteProps: 'as-needed',
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
};

const PACKAGE_VERSION = packageVersion();
let formatter: Promise<{ readonly format: typeof formatWithOxfmt }> | undefined;

export interface ScaffoldOptions {
  readonly cwd: string;
  readonly kind: string;
  readonly name: string;
  readonly package?: string;
  readonly dryRun?: boolean;
}

export interface ScaffoldFile {
  readonly path: string;
  readonly source: string;
}

export interface ScaffoldResult {
  readonly kind: ScaffoldKind;
  readonly name: ScaffoldName;
  readonly target: string;
  readonly files: readonly ScaffoldFile[];
  readonly instructions: readonly string[];
  readonly dryRun: boolean;
}

interface WorkspacePackage {
  readonly name: string;
  readonly path: string;
  readonly relativePath: string;
}

interface Workspace {
  readonly root: string;
  readonly packages: readonly WorkspacePackage[];
}

interface Target {
  readonly root: string;
  readonly displayRoot: string;
}

export class ScaffoldUsageError extends Error {}

export class ScaffoldConflictError extends Error {}

/** Resolve, format and write one scaffold without ever editing an existing file. */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const kind = scaffoldKind(options.kind);
  const name = scaffoldName(options.name);
  const cwd = resolve(options.cwd);
  const target = await resolveTarget(cwd, kind, name, options.package);
  const plan = templateFor(kind)({ name, packageVersion: PACKAGE_VERSION });
  const files = await formattedFiles(plan);
  const absoluteFiles = files.map(file => ({
    ...file,
    absolutePath: confinedPath(target.root, file.path),
  }));

  const conflicts = absoluteFiles.filter(file => existsSync(file.absolutePath));
  if (conflicts.length > 0) {
    throw new ScaffoldConflictError(
      `refusing to overwrite existing ${plural(conflicts.length, 'file')}: ${conflicts
        .map(file => file.path)
        .join(', ')}`,
    );
  }

  if (options.dryRun !== true) {
    for (const file of absoluteFiles) {
      await mkdir(dirname(file.absolutePath), { recursive: true });
      try {
        await writeFile(file.absolutePath, file.source, { flag: 'wx' });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          throw new ScaffoldConflictError(`refusing to overwrite existing file: ${file.path}`, { cause: error });
        }
        throw error;
      }
    }
  }

  return {
    kind,
    name,
    target: target.displayRoot,
    files: files.map(file => ({
      path: kind === 'project' ? `${name.fileStem}/${file.path}` : file.path,
      source: file.source,
    })),
    instructions: plan.instructions ?? [],
    dryRun: options.dryRun === true,
  };
}

export function renderScaffold(result: ScaffoldResult): string {
  if (result.dryRun) {
    return result.files.map(file => `--- ${file.path}\n${file.source}`).join('');
  }
  const created = result.files.map(file => `created ${file.path}`).join('\n');
  const instructions = result.instructions.length === 0 ? '' : `\n\n${result.instructions.join('\n\n')}`;
  return `${created}${instructions}\n`;
}

function scaffoldKind(value: string): ScaffoldKind {
  const kind = SCAFFOLD_KINDS.find(candidate => candidate === value);
  if (kind !== undefined) return kind;
  throw new ScaffoldUsageError(
    `unknown scaffold kind "${value}"; expected ${SCAFFOLD_KINDS.map(candidate => `"${candidate}"`).join(', ')}`,
  );
}

function scaffoldName(input: string): ScaffoldName {
  const words = input
    .trim()
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(word => word.length > 0);
  const fileStem = words.map(word => word.toLowerCase()).join('-');
  const pascal = words.map(capitalize).join('');
  if (fileStem.length === 0 || !/^[$A-Z_a-z][$\w]*$/.test(pascal)) {
    throw new ScaffoldUsageError(`name "${input}" cannot become a valid TypeScript identifier`);
  }
  const first = pascal[0];
  if (first === undefined) {
    throw new ScaffoldUsageError(`name "${input}" cannot become a valid TypeScript identifier`);
  }
  const camel = `${first.toLowerCase()}${pascal.slice(1)}`;
  const snake = words.map(word => word.toLowerCase()).join('_');
  return {
    input,
    fileStem,
    pascal,
    camel,
    constant: words.map(word => word.toUpperCase()).join('_'),
    table: pluralTable(snake),
  };
}

function capitalize(value: string): string {
  const first = value[0];
  return first === undefined ? value : `${first.toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function pluralTable(value: string): string {
  if (value.endsWith('s')) return value;
  if (value.endsWith('ch') || value.endsWith('sh') || /[xz]$/.test(value)) return `${value}es`;
  if (/[^aeiou]y$/.test(value)) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

async function formattedFiles(plan: TemplatePlan): Promise<readonly ScaffoldFile[]> {
  const files: ScaffoldFile[] = [];
  for (const file of plan.files) {
    files.push({
      path: normalizeTemplatePath(file.path),
      source: await formatTemplate(file),
    });
  }
  return files;
}

async function formatTemplate(file: TemplateFile): Promise<string> {
  if (file.path.endsWith('.ts') || file.path.endsWith('.mjs') || file.path.endsWith('.json')) {
    formatter ??= import('oxfmt');
    const { format } = await formatter;
    const result = await format(file.path, file.source, FORMAT_OPTIONS);
    if (result.errors.length > 0) {
      throw new TypeError(`oxfmt could not format generated ${file.path}: ${JSON.stringify(result.errors)}`);
    }
    return result.code;
  }
  return `${file.source.replaceAll(/\r\n?/g, '\n').replaceAll(/\n+$/g, '')}\n`;
}

function normalizeTemplatePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replaceAll(/^\.\/+/g, '');
  if (normalized.length === 0 || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new TypeError(`template path must stay below the target: ${JSON.stringify(path)}`);
  }
  return normalized;
}

function confinedPath(root: string, path: string): string {
  const absolute = resolve(root, ...path.split('/'));
  if (!inside(root, absolute)) {
    throw new TypeError(`template path escapes the target: ${JSON.stringify(path)}`);
  }
  return absolute;
}

async function resolveTarget(
  cwd: string,
  kind: ScaffoldKind,
  name: ScaffoldName,
  requestedPackage: string | undefined,
): Promise<Target> {
  const [workspace, nearestPackage] = await Promise.all([discoverWorkspace(cwd), nearestPackageRoot(cwd)]);
  let base: string;

  if (workspace === undefined) {
    if (requestedPackage !== undefined) {
      throw new ScaffoldUsageError(`--package "${requestedPackage}" was supplied, but no workspace was found`);
    }
    if (kind === 'project') {
      base = cwd;
    } else if (nearestPackage === undefined) {
      throw new ScaffoldUsageError(`no package.json was found from ${cwd}`);
    } else {
      base = nearestPackage;
    }
  } else if (requestedPackage !== undefined) {
    base = namedWorkspacePackage(workspace, requestedPackage).path;
  } else {
    const enclosing = workspace.packages.filter(candidate => inside(candidate.path, cwd));
    if (enclosing.length === 1) {
      const selected = enclosing[0];
      if (selected === undefined) throw new Error('unreachable workspace package selection');
      base = selected.path;
    } else if (
      nearestPackage !== undefined &&
      nearestPackage !== workspace.root &&
      inside(workspace.root, nearestPackage) &&
      !workspace.packages.some(candidate => inside(candidate.path, nearestPackage))
    ) {
      // A package nested below an unrelated workspace root is still its own boundary.
      // This is how generated fixtures and vendored projects avoid being mistaken for
      // undeclared packages of the outer checkout.
      base = nearestPackage;
    } else {
      throw ambiguousWorkspace(workspace);
    }
  }

  const root = kind === 'project' ? resolve(base, name.fileStem) : base;
  return {
    root,
    displayRoot: relative(cwd, root) || '.',
  };
}

function namedWorkspacePackage(workspace: Workspace, requested: string): WorkspacePackage {
  const matches = workspace.packages.filter(
    candidate => candidate.name === requested || candidate.relativePath === requested,
  );
  if (matches.length !== 1) {
    const qualifier = matches.length === 0 ? 'was not found' : 'is ambiguous';
    throw new ScaffoldUsageError(
      `workspace package "${requested}" ${qualifier}; candidates:\n${workspaceCandidates(workspace)}`,
    );
  }
  const match = matches[0];
  if (match === undefined) throw new Error('unreachable named workspace package selection');
  return match;
}

function ambiguousWorkspace(workspace: Workspace): ScaffoldUsageError {
  return new ScaffoldUsageError(
    `refusing to guess a workspace package; pass --package <name>. Candidates:\n${workspaceCandidates(workspace)}`,
  );
}

function workspaceCandidates(workspace: Workspace): string {
  if (workspace.packages.length === 0) return '  (none found)';
  return workspace.packages.map(candidate => `  ${candidate.name} (${candidate.relativePath})`).join('\n');
}

async function discoverWorkspace(cwd: string): Promise<Workspace | undefined> {
  let directory = cwd;
  while (true) {
    const manifest = await readJson(resolve(directory, 'package.json'));
    const packagePatterns = workspacePatterns(manifest);
    const pnpmPatterns = packagePatterns === undefined ? await readPnpmWorkspace(directory) : undefined;
    const patterns = packagePatterns ?? pnpmPatterns;
    if (patterns !== undefined) {
      return {
        root: directory,
        packages: await workspacePackages(directory, patterns),
      };
    }

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function workspacePackages(root: string, patterns: readonly string[]): Promise<readonly WorkspacePackage[]> {
  const include = patterns
    .filter(pattern => !pattern.startsWith('!'))
    .map(packageManifestPattern)
    .filter(pattern => pattern.length > 0);
  const exclude = patterns
    .filter(pattern => pattern.startsWith('!'))
    .map(pattern => packageManifestPattern(pattern.slice(1)))
    .filter(pattern => pattern.length > 0);
  if (include.length === 0) return [];

  const rootPath = await realpath(root);
  const packages = new Map<string, WorkspacePackage>();
  for await (const manifestPath of glob(include, {
    cwd: root,
    ...(exclude.length === 0 ? {} : { exclude }),
  })) {
    const lexicalPath = resolve(root, dirname(manifestPath));
    const packagePath = await realpath(lexicalPath);
    if (!inside(rootPath, packagePath)) continue;
    const manifest = await readJson(resolve(packagePath, 'package.json'));
    const relativePath = relative(rootPath, packagePath).split(sep).join('/');
    const named = stringProperty(manifest, 'name');
    packages.set(packagePath, {
      name: named ?? relativePath,
      path: packagePath,
      relativePath,
    });
  }
  return [...packages.values()].toSorted((left, right) => {
    const byName = left.name.localeCompare(right.name);
    return byName === 0 ? left.relativePath.localeCompare(right.relativePath) : byName;
  });
}

function packageManifestPattern(pattern: string): string {
  const trimmed = pattern.trim().replaceAll('\\', '/').replaceAll(/\/+$/g, '');
  if (trimmed.length === 0) return '';
  return trimmed.endsWith('package.json') ? trimmed : `${trimmed}/package.json`;
}

function workspacePatterns(manifest: unknown): readonly string[] | undefined {
  if (!record(manifest)) return undefined;
  const workspaces = Reflect.get(manifest, 'workspaces');
  if (stringArray(workspaces)) return workspaces;
  if (!record(workspaces)) return undefined;
  const packages = Reflect.get(workspaces, 'packages');
  return stringArray(packages) ? packages : undefined;
}

async function readPnpmWorkspace(directory: string): Promise<readonly string[] | undefined> {
  const path = resolve(directory, 'pnpm-workspace.yaml');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }

  const lines = text.split(/\r?\n/);
  const patterns: string[] = [];
  let packageIndent: number | undefined;
  for (const line of lines) {
    const packages = /^(\s*)packages:\s*(.*)$/.exec(line);
    if (packages !== null) {
      packageIndent = packages[1]?.length ?? 0;
      patterns.push(...quotedValues(packages[2] ?? ''));
      continue;
    }
    if (packageIndent === undefined || /^\s*(?:#.*)?$/.test(line)) continue;
    const indent = /^\s*/.exec(line)?.[0].length ?? 0;
    if (indent <= packageIndent) break;
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (item !== null) {
      const value = unquote(stripYamlComment(item[1] ?? ''));
      if (value.length > 0) patterns.push(value);
    }
  }
  return packageIndent === undefined ? undefined : patterns;
}

function quotedValues(value: string): readonly string[] {
  const matches = value.matchAll(/['"]([^'"]+)['"]/g);
  return [...matches].map(match => match[1] ?? '').filter(item => item.length > 0);
}

function stripYamlComment(value: string): string {
  const comment = value.indexOf(' #');
  return comment === -1 ? value.trim() : value.slice(0, comment).trim();
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  return (first === "'" && last === "'") || (first === '"' && last === '"') ? value.slice(1, -1) : value;
}

async function nearestPackageRoot(cwd: string): Promise<string | undefined> {
  let directory = cwd;
  while (true) {
    if (existsSync(resolve(directory, 'package.json'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw new ScaffoldUsageError(`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function record(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!record(value)) return undefined;
  const property = Reflect.get(value, key);
  return typeof property === 'string' && property.length > 0 ? property : undefined;
}

function errorCode(error: unknown): string | undefined {
  if (!record(error)) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

function packageVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  );
  const version = stringProperty(manifest, 'version');
  if (version === undefined) throw new TypeError('zmdb package.json has no version');
  return version;
}
