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

import { generateOpenApiToolsModule } from '@zmdb/schema-core/llm/http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PACKAGES = join(ROOT, 'packages');
const SCHEMA_CORE = join(PACKAGES, 'schema-core');
const LLM = join(SCHEMA_CORE, 'src', 'llm');
const HOOK = join(ROOT, 'scripts', 'ts-specifier-hook.mjs');

type AiPackage = '@zmdb/ai' | '@zmdb/ai-anthropic' | '@zmdb/ai-langchain' | '@zmdb/ai-vercel' | '@zmdb/mcp';

interface PackageManifest {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, unknown>>;
}

interface ImportReference {
  readonly file: string;
  readonly specifier: string;
  readonly resolved: string | null;
}

interface PackedSchemaCore {
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
  'mcp/SPEC.md': '@zmdb/mcp',
  'mcp/client.ts': '@zmdb/mcp',
  'mcp/index.ts': '@zmdb/mcp',
  'mcp/mcp.spec.ts': '@zmdb/mcp',
  'mcp/mcp.type-test.ts': '@zmdb/mcp',
  'mcp/server.ts': '@zmdb/mcp',
  'providers.spec.ts': '@zmdb/ai',
  'providers.ts': '@zmdb/ai',
  'tool-runtime.ts': '@zmdb/ai',
} as const satisfies Readonly<Record<string, AiPackage>>;

const PROVIDER_NEUTRAL_FILES = Object.entries(FINAL_OWNER)
  .filter(([, owner]) => owner === '@zmdb/ai')
  .map(([path]) => path)
  .toSorted();

const CURRENT_PACKED_SUBPATHS = [
  '@zmdb/schema-core/llm',
  '@zmdb/schema-core/llm/ai-sdk',
  '@zmdb/schema-core/llm/chat',
  '@zmdb/schema-core/llm/http',
  '@zmdb/schema-core/llm/langchain',
  '@zmdb/schema-core/llm/mcp',
] as const;

const TARGET_AI_EXPORTS = ['.', './chat', './compiler', './http', './tool-runtime'] as const;
const AI_SDK_PEERS = ['@anthropic-ai/sdk', '@langchain/core', 'ai'] as const;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function filesUnder(directory: string): string[] {
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
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])(?:export|import)\b[^;]*?from\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.push(specifier ?? '');
  }
  for (const [, specifier] of source.matchAll(/(?:^|[\s;])import\s+['"]([^'"]+)['"]/g)) {
    specifiers.push(specifier ?? '');
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

function currentOwnership(paths: readonly string[]): readonly { readonly path: string; readonly owner: string }[] {
  return paths.map(path => ({ path, owner: packageOwner(join(LLM, path)) }));
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
  const production = Object.keys(FINAL_OWNER)
    .filter(path => path.endsWith('.ts') && !path.endsWith('.spec.ts') && !path.endsWith('.type-test.ts'))
    .map(path => join(LLM, path));
  const aotSources = [
    join(PACKAGES, 'aot-validator', 'src', 'transformer.ts'),
    join(PACKAGES, 'aot-validator', 'src', 'emit', 'index.ts'),
  ];

  for (const file of [...production, ...aotSources]) {
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

function packSchemaCore(): PackedSchemaCore {
  const directory = mkdtempSync(join(tmpdir(), 'zmdb-ai-boundary-'));
  packDirectory = directory;
  const unpacked = join(directory, 'unpacked');
  const app = join(directory, 'consumer');
  mkdirSync(unpacked, { recursive: true });
  mkdirSync(join(app, 'node_modules', '@zmdb'), { recursive: true });
  writeFileSync(join(app, 'package.json'), '{"name":"ai-boundary-consumer","private":true,"type":"module"}\n');

  const output = execFileSync('npm', ['pack', '--json', '--pack-destination', directory], {
    cwd: SCHEMA_CORE,
    encoding: 'utf8',
    env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0' },
  });
  const archive = join(directory, npmPackFilename(output));
  execFileSync('tar', ['-xzf', archive, '-C', unpacked, '--strip-components=1']);
  symlinkSync(unpacked, join(app, 'node_modules', '@zmdb', 'schema-core'), 'dir');
  mkdirSync(join(unpacked, 'node_modules', '@zmdb'), { recursive: true });
  symlinkSync(join(PACKAGES, 'query-compiler'), join(unpacked, 'node_modules', '@zmdb', 'query-compiler'), 'dir');

  const smoke = `const out = {};
for (const specifier of ${JSON.stringify(CURRENT_PACKED_SUBPATHS)}) {
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
    manifest: readJson<PackageManifest>(join(unpacked, 'package.json')),
    files: filesUnder(unpacked)
      .map(file => relative(unpacked, file))
      .toSorted(),
    imported,
    installedPeers,
  };
}

const readJsonFromText = <T>(text: string): T => JSON.parse(text) as T;

let packed: PackedSchemaCore;
let packDirectory: string | undefined;

beforeAll(() => {
  packed = packSchemaCore();
}, 60_000);

afterAll(() => {
  if (packDirectory !== undefined) rmSync(packDirectory, { recursive: true, force: true });
});

describe('AI package ownership and isolation (#704)', () => {
  it.fails('schema-core exposes no llm subpath or AI peer dependency', () => {
    // Measured at #703: 32 files, six export-map entries and three optional peers still belong
    // to schema-core. Each assertion names the real old owner rather than a future empty package.
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
  });

  it.fails('provider-neutral AI imports no provider or framework SDK', () => {
    // The present provider-neutral root reaches the Anthropic driver through chat's eager
    // re-export, and every mapped file is physically owned by schema-core.
    const entries = [
      join(LLM, 'index.ts'),
      join(LLM, 'chat', 'index.ts'),
      join(LLM, 'http', 'index.ts'),
      join(LLM, 'providers.ts'),
      join(LLM, 'tool-runtime.ts'),
      join(LLM, 'adapters', 'runtime.ts'),
    ];
    const forbidden = importClosure(entries)
      .filter(reference => AI_SDK_PEERS.includes(reference.specifier as (typeof AI_SDK_PEERS)[number]))
      .map(reference => `${relative(ROOT, reference.file)} -> ${reference.specifier}`)
      .toSorted();
    expect
      .soft(currentOwnership(PROVIDER_NEUTRAL_FILES))
      .toEqual(PROVIDER_NEUTRAL_FILES.map(path => ({ path, owner: '@zmdb/ai' })));
    expect.soft(forbidden).toEqual([]);
  });

  it.fails('each optional AI integration reaches exactly its declared peer', () => {
    const integrations = [
      {
        owner: '@zmdb/ai-anthropic',
        source: 'chat/drivers/anthropic.ts',
        peer: '@anthropic-ai/sdk',
        range: '0.123.0',
      },
      {
        owner: '@zmdb/ai-langchain',
        source: 'adapters/langchain.ts',
        peer: '@langchain/core',
        range: '^1.2.9',
      },
      { owner: '@zmdb/ai-vercel', source: 'adapters/ai-sdk.ts', peer: 'ai', range: '^7.0.83' },
    ] as const;

    for (const integration of integrations) {
      const file = join(LLM, integration.source);
      const owner = packageOwner(file);
      const manifest = readJson<PackageManifest>(join(SCHEMA_CORE, 'package.json'));
      expect.soft(owner, integration.source).toBe(integration.owner);
      expect.soft(manifest.dependencies, `${integration.owner} workspace dependencies`).toEqual({
        '@zmdb/ai': 'workspace:^',
      });
      expect.soft(manifest.peerDependencies, `${integration.owner} external peer`).toEqual({
        [integration.peer]: integration.range,
      });
    }
  });

  it.fails('MCP imports AI contracts but no schema-core private path', () => {
    const mcpFiles = Object.entries(FINAL_OWNER)
      .filter(([, owner]) => owner === '@zmdb/mcp')
      .map(([path]) => join(LLM, path));
    const crossOwnerRelatives = mcpFiles
      .filter(file => file.endsWith('.ts') && !file.endsWith('.spec.ts') && !file.endsWith('.type-test.ts'))
      .flatMap(importsOf)
      .filter(reference => reference.resolved !== null && projectedOwner(reference.resolved) !== '@zmdb/mcp')
      .map(reference => `${relative(ROOT, reference.file)} -> ${reference.specifier}`)
      .toSorted();
    expect
      .soft(currentOwnership(mcpFiles.map(file => relative(LLM, file))))
      .toEqual(mcpFiles.map(file => ({ path: relative(LLM, file), owner: '@zmdb/mcp' })));
    expect
      .soft(crossOwnerRelatives)
      .toEqual([
        'packages/schema-core/src/llm/mcp/server.ts -> @zmdb/ai/chat',
        'packages/schema-core/src/llm/mcp/server.ts -> @zmdb/ai/tool-runtime',
      ]);
  });

  it.fails('the AI package graph is acyclic', () => {
    const observed = projectedAiGraph();
    const expected = [
      '@zmdb/ai -> @zmdb/schema-core',
      '@zmdb/ai-anthropic -> @zmdb/ai',
      '@zmdb/ai-langchain -> @zmdb/ai',
      '@zmdb/ai-vercel -> @zmdb/ai',
      '@zmdb/aot-validator -> @zmdb/ai',
      '@zmdb/aot-validator -> @zmdb/schema-core',
      '@zmdb/mcp -> @zmdb/ai',
      '@zmdb/schema-core -> @zmdb/query-compiler',
    ];
    expect.soft(cycleIn(observed)).toBeNull();
    expect.soft(observed).toEqual(expected);
  });

  it.fails('toolFor codegen witnesses import from @zmdb/ai', () => {
    const files = [
      join(PACKAGES, 'aot-validator', 'src', 'transformer.ts'),
      join(PACKAGES, 'aot-validator', 'src', 'emit', 'index.ts'),
      join(PACKAGES, 'aot-validator', 'src', 'cli', 'scan.ts'),
      join(PACKAGES, 'aot-validator', 'src', 'tool-for.spec.ts'),
      join(PACKAGES, 'aot-validator', 'src', 'transform-code.spec.ts'),
    ];
    const stale = files
      .flatMap(file =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ file, index: index + 1, line }))
          .filter(entry => entry.line.includes('@zmdb/schema-core/llm')),
      )
      .map(entry => `${relative(ROOT, entry.file)}:${String(entry.index)} ${entry.line.trim()}`);
    const manifest = readJson<PackageManifest>(join(PACKAGES, 'aot-validator', 'package.json'));
    expect.soft(stale).toEqual([]);
    expect.soft(manifest.dependencies?.['@zmdb/ai']).toBe('workspace:^');
  });

  it.fails('every advertised AI subpath imports from a packed consumer', () => {
    // All six old LLM exports import successfully from the actual tarball, proving the tested
    // capability exists. It fails because that packed implementation is named schema-core and
    // advertises the old export map, not because an @zmdb/ai placeholder is absent.
    expect(Object.keys(packed.imported).toSorted()).toEqual([...CURRENT_PACKED_SUBPATHS]);
    expect(packed.files).toContain('src/llm/tool-runtime.ts');
    expect(packed.files).toContain('src/llm/providers.ts');
    expect.soft(packed.manifest.name).toBe('@zmdb/ai');
    expect.soft(Object.keys(packed.manifest.exports ?? {}).toSorted()).toEqual([...TARGET_AI_EXPORTS]);
  });

  it.fails('installing @zmdb/schema-core alone installs no AI SDK peer', () => {
    // The consumer contains only the packed schema-core package and none of the SDKs. The
    // remaining failure is its real packed peer contract, which still assigns all three SDK
    // edges to schema-core.
    expect(packed.installedPeers).toEqual([]);
    expect.soft(AI_SDK_PEERS.filter(peer => packed.manifest.peerDependencies?.[peer] !== undefined)).toEqual([]);
    expect.soft(packed.manifest.peerDependenciesMeta).not.toHaveProperty('@anthropic-ai/sdk');
    expect.soft(packed.manifest.peerDependenciesMeta).not.toHaveProperty('@langchain/core');
    expect.soft(packed.manifest.peerDependenciesMeta).not.toHaveProperty('ai');
  });

  it.fails('installing @zmdb/ai alone imports chat and HTTP tools without optional peers', () => {
    const rootKeys = packed.imported['@zmdb/schema-core/llm'];
    expect(packed.imported['@zmdb/schema-core/llm/chat']).toContain('run');
    expect(packed.imported['@zmdb/schema-core/llm/http']).toContain('toolsFromOpenApi');
    expect(packed.installedPeers).toEqual([]);
    expect.soft(packed.manifest.name).toBe('@zmdb/ai');
    expect.soft(rootKeys).toEqual(['lenientParse', 'toolFor', 'toolFromSchema']);
    expect.soft(AI_SDK_PEERS.filter(peer => packed.manifest.peerDependencies?.[peer] !== undefined)).toEqual([]);
  });

  it.fails('generated OpenAPI tool modules name @zmdb/ai/http', () => {
    const generated = generateOpenApiToolsModule({
      openapi: '3.1.0',
      info: { title: 'AI boundary probe', version: '1.0.0' },
      paths: {},
    });
    expect.soft(generated).toContain('// generated by @zmdb/ai/http — do not edit');
    expect.soft(generated).toContain("import type { OpenApiGeneratedTool } from '@zmdb/ai/http';");
    expect.soft(generated).not.toContain('@zmdb/schema-core/llm/http');
  });

  it.fails('no source file imports @zmdb/schema-core/llm after migration', () => {
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
