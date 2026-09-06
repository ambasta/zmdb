import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateOpenApiToolsModule } from '@zmdb/ai/http';
import { SyntaxKind, type Node } from 'typescript/unstable/ast';
import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isStringLiteral,
} from 'typescript/unstable/ast/is';
import { API, type Program } from 'typescript/unstable/sync';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PACKAGES = join(ROOT, 'packages');
const AI = join(PACKAGES, 'ai');
const AI_ANTHROPIC = join(PACKAGES, 'ai-anthropic');
const AI_LANGCHAIN = join(PACKAGES, 'ai-langchain');
const AI_VERCEL = join(PACKAGES, 'ai-vercel');
const COMPILER = join(PACKAGES, 'compiler');
const MCP = join(PACKAGES, 'mcp');
const MCP_SOURCE = join(MCP, 'src');
const SCHEMA_CORE = join(PACKAGES, 'schema-core');
const LLM = join(SCHEMA_CORE, 'src', 'llm');
const HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');

type AiPackage = '@zmdb/ai' | '@zmdb/ai-anthropic' | '@zmdb/ai-langchain' | '@zmdb/ai-vercel' | '@zmdb/mcp';

interface PackageManifest {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>;
}

interface ImportReference {
  readonly file: string;
  readonly specifier: string;
  readonly resolved: string | null;
}

interface PackedPackage {
  readonly directory: string;
  readonly manifest: PackageManifest;
  readonly files: readonly string[];
  readonly imported: Readonly<Record<string, readonly string[]>>;
  readonly installedPeers: readonly string[];
}

const FINAL_OWNER = {
  'SPEC.md': '@zmdb/ai',
  'adapters/SPEC.md': '@zmdb/ai',
  'adapters/ai-sdk.spec.ts': '@zmdb/ai-vercel',
  'adapters/ai-sdk.ts': '@zmdb/ai-vercel',
  'adapters/langchain.spec.ts': '@zmdb/ai-langchain',
  'adapters/langchain.ts': '@zmdb/ai-langchain',
  'adapters/runtime.ts': '@zmdb/ai',
  'chat/SPEC.md': '@zmdb/ai',
  'chat/chat.spec.ts': '@zmdb/ai',
  'chat/chat.type-test.ts': '@zmdb/ai',
  'chat/drivers/anthropic.spec.ts': '@zmdb/ai-anthropic',
  'chat/drivers/anthropic.ts': '@zmdb/ai-anthropic',
  'chat/index.ts': '@zmdb/ai',
  'http/SPEC.md': '@zmdb/ai',
  'http/caller.ts': '@zmdb/ai',
  'http/generate.ts': '@zmdb/ai',
  'http/index.ts': '@zmdb/ai',
  'http/openapi-tools.spec.ts': '@zmdb/ai',
  'http/parse.ts': '@zmdb/ai',
  'http/types.ts': '@zmdb/ai',
  'index.ts': '@zmdb/ai',
  'llm.spec.ts': '@zmdb/ai',
  'llm.type-test.ts': '@zmdb/ai',
  'providers.spec.ts': '@zmdb/ai',
  'providers.ts': '@zmdb/ai',
  'tool-runtime.ts': '@zmdb/ai',
} as const satisfies Readonly<Record<string, AiPackage>>;

const MCP_SOURCE_FILES = ['SPEC.md', 'client.ts', 'index.ts', 'mcp.spec.ts', 'mcp.type-test.ts', 'server.ts'] as const;

const TARGET_AI_EXPORTS = ['.', './chat', './compiler', './http', './tool-runtime'] as const;
const TARGET_ANTHROPIC_EXPORTS = ['.'] as const;
const AI_PACKED_SUBPATHS = [
  '@zmdb/ai',
  '@zmdb/ai/chat',
  '@zmdb/ai/compiler',
  '@zmdb/ai/http',
  '@zmdb/ai/tool-runtime',
] as const;
const ANTHROPIC_PACKED_SUBPATHS = ['@zmdb/ai-anthropic'] as const;
const AI_LANGCHAIN_PACKED_SUBPATHS = ['@zmdb/ai-langchain'] as const;
const AI_SDK_PEERS = ['@anthropic-ai/sdk', '@langchain/core', 'ai'] as const;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

function packageOwner(file: string): string {
  let directory = dirname(file);
  while (directory.startsWith(`${PACKAGES}${sep}`)) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest)) {
      const name = readJson<PackageManifest>(manifest).name;
      if (typeof name !== 'string') throw new Error(`${relative(ROOT, manifest)} has no package name`);
      return name;
    }
    directory = dirname(directory);
  }
  throw new Error(`${relative(ROOT, file)} is outside a workspace package`);
}

function resolveSpecifier(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const target = join(dirname(file), specifier);
  if (existsSync(target) && !target.endsWith(sep)) return target;
  if (target.endsWith('.js')) {
    const typescript = `${target.slice(0, -'.js'.length)}.ts`;
    if (existsSync(typescript)) return typescript;
  }
  const typescript = `${target}.ts`;
  if (existsSync(typescript)) return typescript;
  const barrel = join(target, 'index.ts');
  return existsSync(barrel) ? barrel : null;
}

function importsOf(file: string): ImportReference[] {
  const specifiers: string[] = [];
  const sourceFile = compilerProgram.getSourceFile(resolve(file));
  if (sourceFile === undefined) {
    const source = readFileSync(file, 'utf8');
    for (const [, fromSpecifier, sideEffectSpecifier] of source.matchAll(
      /^\s*(?:export|import)\b[^;\n]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm,
    )) {
      const specifier = fromSpecifier ?? sideEffectSpecifier;
      if (specifier !== undefined) specifiers.push(specifier);
    }
  } else {
    const visit = (node: Node): undefined => {
      if (
        (isImportDeclaration(node) || isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        isStringLiteral(node.moduleSpecifier)
      ) {
        specifiers.push(node.moduleSpecifier.text);
      } else if (
        isCallExpression(node) &&
        node.expression.kind === SyntaxKind.ImportKeyword &&
        node.arguments.length === 1
      ) {
        const [argument] = node.arguments;
        if (argument !== undefined && isStringLiteral(argument)) specifiers.push(argument.text);
      }
      node.forEachChild(visit);
      return undefined;
    };
    sourceFile.forEachChild(visit);
  }
  return specifiers.map(specifier => ({ file, specifier, resolved: resolveSpecifier(file, specifier) }));
}

function importClosure(entries: readonly string[]): ImportReference[] {
  const seen = new Set<string>();
  const queue = [...entries];
  const imports: ImportReference[] = [];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const reference of importsOf(file)) {
      imports.push(reference);
      if (reference.resolved !== null) queue.push(reference.resolved);
    }
  }
  return imports;
}

function implementationFile(path: string, owner: AiPackage): string {
  if (owner === '@zmdb/ai-anthropic' && path === 'chat/drivers/anthropic.ts') {
    return join(AI_ANTHROPIC, 'src', 'index.ts');
  }
  if (owner === '@zmdb/ai-langchain' && path === 'adapters/langchain.ts') {
    return join(AI_LANGCHAIN, 'src', 'index.ts');
  }
  if (owner === '@zmdb/ai-vercel' && path === 'adapters/ai-sdk.ts') {
    return join(AI_VERCEL, 'src', 'index.ts');
  }
  if (owner !== '@zmdb/ai') return join(LLM, path);
  if (path === 'adapters/runtime.ts' || path === 'tool-runtime.ts') {
    return join(AI, 'src', 'tool-runtime.ts');
  }
  if (path === 'chat/index.ts') return join(AI, 'src', 'chat', 'index.ts');
  if (path.startsWith('http/')) return join(AI, 'src', path);
  return join(AI, 'src', path);
}

function packageNameFromSpecifier(specifier: string): string | null {
  const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(?:\/.*)?$/.exec(specifier);
  return match?.[1] ?? null;
}

function projectedOwner(file: string): string {
  const llmPath = relative(LLM, file);
  if (!llmPath.startsWith('..')) {
    const owner = FINAL_OWNER[llmPath as keyof typeof FINAL_OWNER];
    if (owner !== undefined) return owner;
  }
  return packageOwner(file);
}

function projectedAiGraph(): string[] {
  const edges = new Set<string>();
  const production = Object.entries(FINAL_OWNER)
    .filter(([path]) => path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.type-test.ts'))
    .map(([path, owner]) => implementationFile(path, owner));
  const mcpProduction = MCP_SOURCE_FILES.filter(
    path => path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.type-test.ts'),
  ).map(path => join(MCP_SOURCE, path));
  const compilerSources = [join(COMPILER, 'src', 'transform', 'index.ts'), join(COMPILER, 'src', 'emit', 'index.ts')];

  for (const file of [...production, ...mcpProduction, ...compilerSources]) {
    const from = projectedOwner(file);
    for (const reference of importsOf(file)) {
      let to: string | null = null;
      if (reference.resolved !== null) {
        to = projectedOwner(reference.resolved);
      } else {
        const packageName = packageNameFromSpecifier(reference.specifier);
        if (packageName?.startsWith('@zmdb/') === true) to = packageName;
      }
      if (to !== null && to !== from) edges.add(`${from} -> ${to}`);
    }
  }

  const schemaManifest = readJson<PackageManifest>(join(SCHEMA_CORE, 'package.json'));
  for (const dependency of Object.keys(schemaManifest.dependencies ?? {})) {
    if (dependency.startsWith('@zmdb/')) edges.add(`@zmdb/schema-core -> ${dependency}`);
  }
  const aotManifest = readJson<PackageManifest>(join(PACKAGES, 'aot-validator', 'package.json'));
  for (const dependency of Object.keys(aotManifest.dependencies ?? {})) {
    if (dependency.startsWith('@zmdb/')) edges.add(`@zmdb/aot-validator -> ${dependency}`);
  }
  const compilerManifest = readJson<PackageManifest>(join(COMPILER, 'package.json'));
  for (const dependency of Object.keys(compilerManifest.dependencies ?? {})) {
    if (dependency.startsWith('@zmdb/')) edges.add(`@zmdb/compiler -> ${dependency}`);
  }
  return [...edges].toSorted();
}

function cycleIn(edges: readonly string[]): readonly string[] | null {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const [from, to] = edge.split(' -> ');
    if (from === undefined || to === undefined) throw new Error(`invalid edge ${edge}`);
    const targets = graph.get(from) ?? new Set<string>();
    targets.add(to);
    graph.set(from, targets);
    if (!graph.has(to)) graph.set(to, new Set());
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (node: string): readonly string[] | null => {
    if (visiting.has(node)) return [...path.slice(path.indexOf(node)), node];
    if (visited.has(node)) return null;
    visiting.add(node);
    path.push(node);
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle !== null) return cycle;
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
    return null;
  };

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== null) return cycle;
  }
  return null;
}

function npmPackFilename(output: string): string {
  const report: unknown = JSON.parse(output);
  const entry = Array.isArray(report) ? report[0] : isRecord(report) ? Object.values(report)[0] : undefined;
  if (!isRecord(entry) || typeof entry['filename'] !== 'string') {
    throw new Error(`npm pack returned no filename: ${output}`);
  }
  return entry['filename'];
}

function packWorkspacePackage(
  directoryName: string,
  specifiers: readonly string[],
  workspaceDependencies: readonly string[],
): PackedPackage {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-ai-boundary-'));
  packDirectories.push(directory);
  const unpacked = join(directory, 'unpacked');
  const app = join(directory, 'consumer');
  const packageDirectory = join(PACKAGES, directoryName);
  mkdirSync(unpacked, { recursive: true });
  mkdirSync(join(app, 'node_modules', '@zmdb'), { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"name":"ai-boundary-consumer","private":true,"type":"module"}\n');

  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', directory], {
    cwd: packageDirectory,
    encoding: 'utf8',
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  const archive = join(directory, npmPackFilename(output));
  execFileSync('tar', ['-xzf', archive, '-C', unpacked, '--strip-components=1']);
  const manifest = readJson<PackageManifest>(join(unpacked, 'package.json'));
  const packageName = manifest.name?.split('/')[1];
  if (packageName === undefined) throw new Error(`${directoryName} has no scoped package name`);
  symlinkSync(unpacked, join(app, 'node_modules', '@zmdb', packageName), 'dir');
  mkdirSync(join(unpacked, 'node_modules', '@zmdb'), { recursive: true });
  for (const dependency of workspaceDependencies) {
    symlinkSync(join(PACKAGES, dependency), join(unpacked, 'node_modules', '@zmdb', dependency), 'dir');
  }

  const smoke = `const out = {};
for (const specifier of ${JSON.stringify(specifiers)}) {
  out[specifier] = Object.keys(await import(specifier)).toSorted();
}
process.stdout.write(JSON.stringify(out));
`;
  const imported = readJsonFromText<Readonly<Record<string, readonly string[]>>>(
    execFileSync(process.execPath, [`--import=${HOOK}`, '--input-type=module', '--eval', smoke], {
      cwd: app,
      encoding: 'utf8',
    }),
  );
  const installedPeers = AI_SDK_PEERS.filter(peer => existsSync(join(app, 'node_modules', ...peer.split('/'))));
  return {
    directory,
    manifest,
    files: filesUnder(unpacked)
      .map(file => relative(unpacked, file))
      .toSorted(),
    imported,
    installedPeers,
  };
}

const readJsonFromText = <T>(text: string): T => JSON.parse(text) as T;

let packedAi: PackedPackage;
let packedAnthropic: PackedPackage;
let packedAiLangChain: PackedPackage;
let packedAiVercel: PackedPackage;
let packedMcp: PackedPackage;
let packedSchemaCore: PackedPackage;
let compilerApi: API;
let compilerProgram: Program;
const packDirectories: string[] = [];

beforeAll(() => {
  const project = join(PACKAGES, 'zmdb', 'tsconfig.json');
  compilerApi = new API({ cwd: join(PACKAGES, 'zmdb') });
  const loaded = compilerApi.updateSnapshot({ openProjects: [project] }).getProjects()[0];
  if (loaded === undefined) throw new Error(`could not load ${relative(ROOT, project)}`);
  compilerProgram = loaded.program;

  packedAi = packWorkspacePackage('ai', AI_PACKED_SUBPATHS, ['schema-core']);
  packedAnthropic = packWorkspacePackage('ai-anthropic', ANTHROPIC_PACKED_SUBPATHS, ['ai', 'schema-core']);
  packedAiLangChain = packWorkspacePackage('ai-langchain', AI_LANGCHAIN_PACKED_SUBPATHS, ['ai', 'schema-core']);
  packedAiVercel = packWorkspacePackage('ai-vercel', ['@zmdb/ai-vercel'], ['ai', 'schema-core', 'query-compiler']);
  packedMcp = packWorkspacePackage('mcp', ['@zmdb/mcp'], ['ai', 'schema-core']);
  packedSchemaCore = packWorkspacePackage(
    'schema-core',
    [
      '@zmdb/schema-core',
      '@zmdb/schema-core/custom-types',
      '@zmdb/schema-core/derive',
      '@zmdb/schema-core/dto',
      '@zmdb/schema-core/ir',
      '@zmdb/schema-core/naming',
      '@zmdb/schema-core/openapi',
      '@zmdb/schema-core/relations',
      '@zmdb/schema-core/tags',
    ],
    ['query-compiler'],
  );
}, 60_000);

afterAll(() => {
  compilerApi.close();
  for (const directory of packDirectories) rmSync(directory, { recursive: true, force: true });
});

describe('AI package ownership and isolation (#704, #705, #706, #707, #708, #709, #710)', () => {
  it('schema-core exposes no llm subpath or AI peer dependency', () => {
    const manifest = readJson<PackageManifest>(join(SCHEMA_CORE, 'package.json'));
    const llmExports = Object.keys(manifest.exports ?? {}).filter(
      path => path === './llm' || path.startsWith('./llm/'),
    );
    const aiPeers = AI_SDK_PEERS.filter(peer => manifest.peerDependencies?.[peer] !== undefined);
    expect
      .soft(
        filesUnder(LLM)
          .map(file => relative(LLM, file))
          .toSorted(),
      )
      .toEqual([]);
    expect.soft(llmExports).toEqual([]);
    expect.soft(aiPeers).toEqual([]);
    expect
      .soft(Object.keys(packedSchemaCore.imported).toSorted())
      .toEqual([
        '@zmdb/schema-core',
        '@zmdb/schema-core/custom-types',
        '@zmdb/schema-core/derive',
        '@zmdb/schema-core/dto',
        '@zmdb/schema-core/ir',
        '@zmdb/schema-core/naming',
        '@zmdb/schema-core/openapi',
        '@zmdb/schema-core/relations',
        '@zmdb/schema-core/tags',
      ]);
  });

  it('provider-neutral AI imports no provider or framework SDK', () => {
    const entries = [
      join(AI, 'src', 'index.ts'),
      join(AI, 'src', 'chat', 'index.ts'),
      join(AI, 'src', 'compiler.ts'),
      join(AI, 'src', 'http', 'index.ts'),
      join(AI, 'src', 'tool-runtime.ts'),
    ];
    const forbidden = importClosure(entries)
      .filter(reference => AI_SDK_PEERS.includes(reference.specifier as (typeof AI_SDK_PEERS)[number]))
      .map(reference => `${relative(ROOT, reference.file)} -> ${reference.specifier}`)
      .toSorted();
    const manifest = readJson<PackageManifest>(join(AI, 'package.json'));
    expect.soft(entries.map(file => packageOwner(file))).toEqual(entries.map(() => '@zmdb/ai'));
    expect.soft(forbidden).toEqual([]);
    expect.soft(manifest.dependencies).toBeUndefined();
    expect.soft(manifest.devDependencies?.['@zmdb/schema-core']).toBe('workspace:^');
    expect.soft(manifest.peerDependencies).toEqual({ '@zmdb/schema-core': '1.0.0-alpha.4' });
    expect.soft(AI_SDK_PEERS.filter(peer => manifest.dependencies?.[peer] !== undefined)).toEqual([]);
  });

  it('@zmdb/ai-anthropic reaches only @anthropic-ai/sdk among third-party peers', () => {
    const entry = join(AI_ANTHROPIC, 'src', 'index.ts');
    const manifest = readJson<PackageManifest>(join(AI_ANTHROPIC, 'package.json'));
    const aiManifest = readJson<PackageManifest>(join(AI, 'package.json'));
    const schemaManifest = readJson<PackageManifest>(join(SCHEMA_CORE, 'package.json'));
    const external = [
      ...new Set(
        importClosure([entry])
          .map(reference => packageNameFromSpecifier(reference.specifier))
          .filter((name): name is string => name !== null),
      ),
    ].toSorted();

    expect.soft(packageOwner(entry)).toBe('@zmdb/ai-anthropic');
    expect.soft(manifest.dependencies).toEqual({ '@zmdb/ai': 'workspace:1.0.0-alpha.4' });
    expect.soft(manifest.peerDependencies).toEqual({ '@anthropic-ai/sdk': '0.124.0' });
    expect.soft(manifest.devDependencies?.['@anthropic-ai/sdk']).toBe('0.124.0');
    expect.soft(manifest.peerDependenciesMeta).toEqual({
      '@anthropic-ai/sdk': { optional: true },
    });
    expect.soft(external).toEqual(['@anthropic-ai/sdk', '@zmdb/ai']);
    expect.soft(external.filter(name => !name.startsWith('@zmdb/'))).toEqual(['@anthropic-ai/sdk']);
    expect.soft(aiManifest.peerDependencies).toEqual({ '@zmdb/schema-core': '1.0.0-alpha.4' });
    expect.soft(aiManifest.dependencies?.['@anthropic-ai/sdk']).toBeUndefined();
    expect.soft(schemaManifest.devDependencies?.['@anthropic-ai/sdk']).toBeUndefined();
    expect.soft(schemaManifest.peerDependencies?.['@anthropic-ai/sdk']).toBeUndefined();
    expect.soft(schemaManifest.peerDependenciesMeta ?? {}).not.toHaveProperty('@anthropic-ai/sdk');
    expect.soft(Object.keys(packedAnthropic.imported)).toEqual([...ANTHROPIC_PACKED_SUBPATHS]);
    expect.soft(packedAnthropic.imported['@zmdb/ai-anthropic']).toEqual(['anthropicDriver']);
    expect.soft(packedAnthropic.installedPeers).toEqual([]);
    expect.soft(packedAnthropic.files).toContain('src/index.ts');
    expect.soft(Object.keys(packedAnthropic.manifest.exports ?? {})).toEqual([...TARGET_ANTHROPIC_EXPORTS]);
  });

  it('@zmdb/ai-vercel owns only the Vercel AI SDK peer', () => {
    const file = join(AI_VERCEL, 'src', 'index.ts');
    const manifest = readJson<PackageManifest>(join(AI_VERCEL, 'package.json'));
    const sdkImports = importClosure([file])
      .filter(reference => reference.specifier === 'ai' || reference.specifier.startsWith('ai/'))
      .map(reference => `${relative(ROOT, reference.file)} -> ${reference.specifier}`);

    expect.soft(packageOwner(file)).toBe('@zmdb/ai-vercel');
    expect.soft(manifest.dependencies).toEqual({ '@zmdb/ai': 'workspace:1.0.0-alpha.4' });
    expect.soft(manifest.peerDependencies).toEqual({ ai: '^7.0.93' });
    expect.soft(manifest.peerDependenciesMeta).toEqual({ ai: { optional: true } });
    expect.soft(sdkImports).toEqual([]);
  });

  it('publishes LangChain as its own optional-peer integration', () => {
    const manifest = readJson<PackageManifest>(join(AI_LANGCHAIN, 'package.json'));
    const source = join(AI_LANGCHAIN, 'src', 'index.ts');
    const schemaManifest = readJson<PackageManifest>(join(SCHEMA_CORE, 'package.json'));
    const aiManifest = readJson<PackageManifest>(join(AI, 'package.json'));

    expect.soft(packageOwner(source)).toBe('@zmdb/ai-langchain');
    expect.soft(Object.keys(manifest.exports ?? {})).toEqual(['.']);
    expect.soft(manifest.dependencies).toEqual({
      '@zmdb/ai': 'workspace:1.0.0-alpha.4',
    });
    expect.soft(manifest.peerDependencies).toEqual({ '@langchain/core': '^1.2.9' });
    expect.soft(manifest.peerDependenciesMeta).toEqual({
      '@langchain/core': { optional: true },
    });
    expect.soft(schemaManifest.peerDependencies ?? {}).not.toHaveProperty('@langchain/core');
    expect.soft(schemaManifest.peerDependenciesMeta ?? {}).not.toHaveProperty('@langchain/core');
    expect.soft(aiManifest.dependencies ?? {}).not.toHaveProperty('@langchain/core');
    expect.soft(aiManifest.peerDependencies ?? {}).not.toHaveProperty('@langchain/core');
  });

  it('MCP imports AI contracts but no schema-core private path', () => {
    const mcpFiles = MCP_SOURCE_FILES.map(path => join(MCP_SOURCE, path));
    const crossOwnerImports = mcpFiles
      .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.type-test.ts'))
      .flatMap(importsOf)
      .filter(reference => {
        const packageName = packageNameFromSpecifier(reference.specifier);
        return packageName?.startsWith('@zmdb/') === true && packageName !== '@zmdb/mcp';
      })
      .map(reference => `${relative(ROOT, reference.file)} -> ${reference.specifier}`)
      .toSorted();
    const manifest = readJson<PackageManifest>(join(MCP, 'package.json'));
    const schemaManifest = readJson<PackageManifest>(join(SCHEMA_CORE, 'package.json'));
    expect
      .soft(mcpFiles.map(file => ({ path: relative(MCP_SOURCE, file), owner: packageOwner(file) })))
      .toEqual(MCP_SOURCE_FILES.map(path => ({ path, owner: '@zmdb/mcp' })));
    expect
      .soft(crossOwnerImports)
      .toEqual(['packages/mcp/src/server.ts -> @zmdb/ai/chat', 'packages/mcp/src/server.ts -> @zmdb/ai/tool-runtime']);
    expect.soft(manifest.dependencies).toEqual({ '@zmdb/ai': 'workspace:1.0.0-alpha.4' });
    expect.soft(manifest.peerDependencies).toBeUndefined();
    const oldMcpDirectory = join(LLM, 'mcp');
    expect
      .soft(existsSync(oldMcpDirectory) ? filesUnder(oldMcpDirectory).map(file => relative(ROOT, file)) : [])
      .toEqual([]);
    expect.soft(schemaManifest.exports).not.toHaveProperty('./llm/mcp');
    expect
      .soft(packedMcp.imported['@zmdb/mcp'])
      .toEqual(['MCP_PROTOCOL_VERSION', 'McpProtocolError', 'createMcpClient', 'createMcpServer']);
    expect.soft(packedMcp.manifest.dependencies).toEqual({ '@zmdb/ai': 'workspace:1.0.0-alpha.4' });
    expect.soft(packedMcp.installedPeers).toEqual([]);
  });

  it('the AI package graph is acyclic', () => {
    const observed = projectedAiGraph();
    const expected = [
      '@zmdb/ai -> @zmdb/schema-core',
      '@zmdb/ai-anthropic -> @zmdb/ai',
      '@zmdb/ai-langchain -> @zmdb/ai',
      '@zmdb/ai-vercel -> @zmdb/ai',
      '@zmdb/aot-validator -> @zmdb/schema-core',
      '@zmdb/compiler -> @zmdb/ai',
      '@zmdb/compiler -> @zmdb/aot-validator',
      '@zmdb/compiler -> @zmdb/schema-core',
      '@zmdb/mcp -> @zmdb/ai',
      '@zmdb/schema-core -> @zmdb/query-compiler',
    ];
    expect.soft(cycleIn(observed)).toBeNull();
    expect.soft(observed).toEqual(expected);
  });

  it('toolFor codegen witnesses import from @zmdb/ai', () => {
    const files = [
      join(COMPILER, 'src', 'transform', 'index.ts'),
      join(COMPILER, 'src', 'emit', 'index.ts'),
      join(COMPILER, 'src', 'codegen', 'scan.ts'),
      join(COMPILER, 'src', 'tool-for.spec.ts'),
      join(COMPILER, 'src', 'transform-code.spec.ts'),
    ];
    const stale = files
      .flatMap(file =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ file, index: index + 1, line }))
          .filter(entry => entry.line.includes('@zmdb/schema-core/llm')),
      )
      .map(entry => `${relative(ROOT, entry.file)}:${String(entry.index)} ${entry.line.trim()}`);
    const manifest = readJson<PackageManifest>(join(COMPILER, 'package.json'));
    const runtimeManifest = readJson<PackageManifest>(join(PACKAGES, 'aot-validator', 'package.json'));
    expect.soft(stale).toEqual([]);
    expect.soft(manifest.dependencies?.['@zmdb/ai']).toBe('workspace:1.0.0-alpha.4');
    expect.soft(runtimeManifest.dependencies?.['@zmdb/ai']).toBeUndefined();
  });

  it('every advertised AI subpath imports from a packed consumer', () => {
    expect(Object.keys(packedAi.imported).toSorted()).toEqual([...AI_PACKED_SUBPATHS]);
    expect(packedAi.imported['@zmdb/ai']).toEqual(['lenientParse', 'toolFor', 'toolFromSchema']);
    expect(packedAi.imported['@zmdb/ai/chat']).toEqual(['defineTools', 'run']);
    expect(packedAi.imported['@zmdb/ai/compiler']).toEqual(['ToolSpecRefusalError', 'toolSchemaForProvider']);
    expect(packedAi.imported['@zmdb/ai/http']).toEqual([
      'OpenApiHttpError',
      'ToolSpecRefusalError',
      'bindOpenApiTool',
      'generateOpenApiToolsModule',
      'toolsFromOpenApi',
    ]);
    expect(packedAi.imported['@zmdb/ai/tool-runtime']).toEqual([
      'executeToolAdapter',
      'invokeTool',
      'serialiseToolResult',
    ]);
    expect(packedAi.files).toContain('src/tool-runtime.ts');
    expect(packedAi.files).toContain('src/chat/index.ts');
    expect.soft(packedAi.manifest.name).toBe('@zmdb/ai');
    expect.soft(Object.keys(packedAi.manifest.exports ?? {}).toSorted()).toEqual([...TARGET_AI_EXPORTS]);
  });

  it('the packed LangChain integration exposes only its root contract', () => {
    expect(packedAiLangChain.imported['@zmdb/ai-langchain']).toEqual(['langchainTool']);
    expect.soft(packedAiLangChain.manifest.name).toBe('@zmdb/ai-langchain');
    expect.soft(Object.keys(packedAiLangChain.manifest.exports ?? {})).toEqual(['.']);
    expect.soft(packedAiLangChain.manifest.peerDependencies).toEqual({ '@langchain/core': '^1.2.9' });
    expect.soft(packedAiLangChain.manifest.peerDependenciesMeta).toEqual({
      '@langchain/core': { optional: true },
    });
    expect.soft(packedAiLangChain.installedPeers).toEqual([]);
    expect.soft(packedAiLangChain.files).toContain('src/index.ts');
  });

  it('@zmdb/ai-vercel packs with one root and no installed SDK peer', () => {
    expect(packedAiVercel.imported['@zmdb/ai-vercel']).toEqual(['aiSdkTool']);
    expect(packedAiVercel.files).toContain('src/index.ts');
    expect.soft(packedAiVercel.manifest.name).toBe('@zmdb/ai-vercel');
    expect.soft(Object.keys(packedAiVercel.manifest.exports ?? {})).toEqual(['.']);
    expect.soft(packedAiVercel.manifest.dependencies).toEqual({
      '@zmdb/ai': 'workspace:1.0.0-alpha.4',
    });
    expect.soft(packedAiVercel.manifest.peerDependencies).toEqual({ ai: '^7.0.93' });
    expect.soft(packedAiVercel.manifest.peerDependenciesMeta).toEqual({ ai: { optional: true } });
    expect.soft(packedAiVercel.installedPeers).toEqual([]);
  });

  it('installing @zmdb/schema-core alone installs no AI SDK peer', () => {
    // The consumer contains only the packed schema-core package and none of the SDKs.
    // #706-#708 moved all three optional peers to their integration packages.
    expect(packedSchemaCore.installedPeers).toEqual([]);
    expect
      .soft(AI_SDK_PEERS.filter(peer => packedSchemaCore.manifest.peerDependencies?.[peer] !== undefined))
      .toEqual([]);
    expect.soft(packedSchemaCore.manifest.peerDependenciesMeta ?? {}).not.toHaveProperty('@anthropic-ai/sdk');
    expect.soft(packedSchemaCore.manifest.peerDependenciesMeta ?? {}).not.toHaveProperty('@langchain/core');
    expect.soft(packedSchemaCore.manifest.peerDependenciesMeta ?? {}).not.toHaveProperty('ai');
  });

  it('installing @zmdb/ai alone imports chat and HTTP tools without optional peers', () => {
    const rootKeys = packedAi.imported['@zmdb/ai'];
    expect(packedAi.imported['@zmdb/ai/chat']).toContain('run');
    expect(packedAi.imported['@zmdb/ai/http']).toContain('toolsFromOpenApi');
    expect(packedAi.installedPeers).toEqual([]);
    expect.soft(packedAi.manifest.name).toBe('@zmdb/ai');
    expect.soft(rootKeys).toEqual(['lenientParse', 'toolFor', 'toolFromSchema']);
    expect.soft(AI_SDK_PEERS.filter(peer => packedAi.manifest.peerDependencies?.[peer] !== undefined)).toEqual([]);
  });

  it('generated OpenAPI tool modules name @zmdb/ai/http', () => {
    const generated = generateOpenApiToolsModule({
      openapi: '3.1.0',
      info: { title: 'AI boundary probe', version: '1.0.0' },
      paths: {},
    });
    expect.soft(generated).toContain('// generated by @zmdb/ai/http — do not edit');
    expect.soft(generated).toContain("import type { OpenApiGeneratedTool } from '@zmdb/ai/http';");
    expect.soft(generated).not.toContain('@zmdb/schema-core/llm/http');
  });

  it('no source file imports @zmdb/schema-core/llm after migration', () => {
    const stale = filesUnder(PACKAGES)
      .filter(
        file =>
          (file.endsWith('.ts') || file.endsWith('.js')) &&
          !file.endsWith('.spec.ts') &&
          !file.endsWith('.type-test.ts') &&
          !file.includes(`${sep}dist${sep}`),
      )
      .flatMap(file =>
        importsOf(file)
          .filter(reference => /^@zmdb\/schema-core\/llm(?:\/|$)/.test(reference.specifier))
          .map(reference => `${relative(ROOT, file)} -> ${reference.specifier}`),
      )
      .toSorted();
    expect(stale).toEqual([]);
  });
});
