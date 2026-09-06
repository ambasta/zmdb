import { existsSync, readFileSync } from 'node:fs';
import { readFile, watch } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ReflectSession } from '@zmdb/compiler/reflect';
import type { HttpContractDeclaration } from '@zmdb/web/contract';
import { compileHttpContracts, generateHttpClient, type HttpContractSource } from '@zmdb/web/contract/compiler';
import { toOpenApi, type OpenApiDocument } from '@zmdb/web/openapi';
import type { FormatConfig } from 'oxfmt';

import type { ResolvedConfig, ResolvedHttpGenerationConfig } from '../../config/index.js';
import { writeTextAtomically } from '../atomic.js';
import { CliInvocationError } from '../errors.js';

const GENERATION_QUERY = 'zmdb-http-generation';
const RELATIVE_SPECIFIER = /^\.{1,2}\//u;
const TYPESCRIPT_SOURCE = /\.[cm]?tsx?$/u;
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

let contractLoader: Promise<void> | undefined;
let generationSequence = 0;

export interface ClientGenerateResult {
  readonly out: {
    readonly openApi: string;
    readonly client: string;
  };
  readonly operations: readonly string[];
  readonly changed: boolean;
  readonly contractFormat: 1;
  readonly generatorVersion: string;
}

export interface HttpArtifactGeneration {
  readonly result: ClientGenerateResult;
  /** Missing or byte-different outputs before this run. */
  readonly stale: readonly string[];
  /** Exact project-source dependency set used for watch invalidation. */
  readonly dependencies: readonly string[];
}

export interface GenerateHttpArtifactsOptions {
  readonly check?: boolean;
  /** A caller-owned session is retained and remains open after generation. */
  readonly session?: ReflectSession;
}

export interface WatchHttpArtifactsOptions {
  readonly debounceMs?: number;
  readonly until?: Promise<unknown>;
  readonly session?: ReflectSession;
  readonly log?: (generation: HttpArtifactGeneration) => void;
}

interface RenderedArtifacts {
  readonly openApi: string;
  readonly client: string;
  readonly operations: readonly string[];
  readonly contractFormat: 1;
  readonly generatorVersion: string;
  readonly dependencies: readonly string[];
}

/** Compile once, project both public artifacts, and write or check their exact bytes. */
export async function generateHttpArtifacts(
  config: ResolvedConfig,
  options: GenerateHttpArtifactsOptions = {},
): Promise<HttpArtifactGeneration> {
  const borrowed = options.session;
  const session = borrowed ?? ReflectSession.open({ project: config.project });
  try {
    return await generateWithSession(config, session, options.check === true);
  } finally {
    if (borrowed === undefined) session.close();
  }
}

/**
 * Keep one reflection session open and regenerate only after an input in the
 * last compiled dependency set changes.
 */
export async function watchHttpArtifacts(
  config: ResolvedConfig,
  options: WatchHttpArtifactsOptions = {},
): Promise<HttpArtifactGeneration> {
  requireHttpConfig(config);
  const borrowed = options.session;
  const session = borrowed ?? ReflectSession.open({ project: config.project });
  const log = options.log ?? (() => undefined);
  let last = await generateWithSession(config, session, false);
  let dependencies = new Set(last.dependencies);
  log(last);

  const controller = new AbortController();
  const stop = (): void => {
    controller.abort();
  };
  void options.until?.then(stop, stop);

  const projectRoot = dirname(resolve(config.project));
  const pendingRelevant = new Set<string>();
  const pendingCreated = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = Promise.resolve();
  let failure: unknown;

  const flush = (): void => {
    timer = undefined;
    const relevant = [...pendingRelevant];
    pendingRelevant.clear();
    if (relevant.length === 0) return;
    const observed = new Set([...relevant, ...pendingCreated]);
    pendingCreated.clear();

    queued = queued
      .then(async () => {
        const created: string[] = [];
        const changed: string[] = [];
        const deleted: string[] = [];
        for (const path of observed) {
          if (!existsSync(path)) {
            if (dependencies.has(path)) deleted.push(path);
          } else if (session.sourceFile(path) === undefined) {
            created.push(path);
          } else {
            changed.push(path);
          }
        }
        if (created.length > 0) session.created(created);
        if (changed.length > 0) session.refresh(changed);
        if (deleted.length > 0) session.deleted(deleted);

        last = await generateWithSession(config, session, false);
        dependencies = new Set(last.dependencies);
        log(last);
      })
      .catch((error: unknown) => {
        failure = error;
        controller.abort();
      });
  };

  try {
    for await (const event of watch(projectRoot, { recursive: true, signal: controller.signal })) {
      if (typeof event.filename !== 'string') continue;
      const path = resolve(projectRoot, event.filename);
      if (existsSync(path) && session.sourceFile(path) === undefined && TYPESCRIPT_SOURCE.test(path)) {
        pendingCreated.add(path);
      }
      if (!dependencies.has(path)) continue;
      pendingRelevant.add(path);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, options.debounceMs ?? 60);
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await queued;
    if (borrowed === undefined) session.close();
  }
  if (failure !== undefined) throw failure;
  return last;
}

async function generateWithSession(
  config: ResolvedConfig,
  session: ReflectSession,
  check: boolean,
): Promise<HttpArtifactGeneration> {
  const http = requireHttpConfig(config);
  const rendered = await renderArtifacts(http, session);
  const outputs = [
    { path: http.openApiOut, source: rendered.openApi },
    { path: http.clientOut, source: rendered.client },
  ] as const;
  const current = await Promise.all(outputs.map(output => readOptionalText(output.path)));
  const stale = outputs.flatMap((output, index) => (current[index] === output.source ? [] : [output.path]));

  if (!check) {
    for (const output of outputs) {
      if (stale.includes(output.path)) await writeTextAtomically(output.path, output.source);
    }
  }

  return {
    result: {
      out: { openApi: http.openApiOut, client: http.clientOut },
      operations: rendered.operations,
      changed: stale.length > 0,
      contractFormat: rendered.contractFormat,
      generatorVersion: rendered.generatorVersion,
    },
    stale,
    dependencies: rendered.dependencies,
  };
}

async function renderArtifacts(
  http: ResolvedHttpGenerationConfig,
  session: ReflectSession,
): Promise<RenderedArtifacts> {
  generationSequence += 1;
  const sources = await loadContractSources(http, generationSequence);
  const compiled = compileHttpContracts(sources, { session });
  const document = toOpenApi(compiled.ir);
  const client = generateHttpClient(compiled.ir);
  const openApiOperations = openApiOperationIds(document);
  if (!sameStrings(openApiOperations, client.operations)) {
    throw new Error(
      `HTTP artifact generation: OpenAPI operations [${openApiOperations.join(', ')}] ` +
        `do not match client operations [${client.operations.join(', ')}]`,
    );
  }
  const openApi = await formatOpenApi(http.openApiOut, document);
  return {
    openApi,
    client: client.source,
    operations: client.operations,
    contractFormat: client.contractFormat,
    generatorVersion: client.generatorVersion,
    dependencies: compiled.dependencies,
  };
}

async function formatOpenApi(path: string, document: OpenApiDocument): Promise<string> {
  const { format } = await import('oxfmt');
  const formatted = await format(path, `${JSON.stringify(document, null, 2)}\n`, FORMAT_OPTIONS);
  if (formatted.errors.length > 0) {
    throw new TypeError(`oxfmt could not format generated ${path}: ${JSON.stringify(formatted.errors)}`);
  }
  return formatted.code;
}

async function loadContractSources(
  http: ResolvedHttpGenerationConfig,
  generation: number,
): Promise<readonly HttpContractSource[]> {
  await installContractLoader();
  const modules = new Map<string, object>();
  const sources: HttpContractSource[] = [];

  for (const configured of http.contracts) {
    let loaded = modules.get(configured.file);
    if (loaded === undefined) {
      const url = pathToFileURL(configured.file);
      url.searchParams.set(GENERATION_QUERY, String(generation));
      const candidate: unknown = await import(url.href);
      if (typeof candidate !== 'object' || candidate === null) {
        throw new Error(`HTTP contract module ${configured.file} did not load as a module record`);
      }
      loaded = candidate;
      modules.set(configured.file, loaded);
    }

    const contract: unknown = Reflect.get(loaded, configured.exportName);
    if (!isHttpContractDeclaration(contract)) {
      throw new Error(
        `HTTP contract module ${configured.file} has no contract declaration export ${configured.exportName}`,
      );
    }
    sources.push({ file: configured.file, exportName: configured.exportName, contract });
  }
  return sources;
}

function requireHttpConfig(config: ResolvedConfig): ResolvedHttpGenerationConfig {
  if (config.http === undefined) {
    throw new CliInvocationError(
      `config ${config.configPath} must declare http.contracts, http.openApi.out and http.client.out`,
    );
  }
  return config.http;
}

function openApiOperationIds(document: OpenApiDocument): readonly string[] {
  const operationIds: string[] = [];
  for (const path of Object.keys(document.paths).toSorted()) {
    const item = document.paths[path];
    if (item === undefined) continue;
    for (const method of Object.keys(item).toSorted()) {
      const operation = item[method];
      if (operation !== undefined) operationIds.push(operation.operationId);
    }
  }
  return operationIds.toSorted();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isHttpContractDeclaration(value: unknown): value is HttpContractDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const operations = Reflect.get(value, 'operations');
  const securitySchemes = Reflect.get(value, 'securitySchemes');
  return (
    typeof operations === 'object' &&
    operations !== null &&
    !Array.isArray(operations) &&
    typeof securitySchemes === 'object' &&
    securitySchemes !== null &&
    !Array.isArray(securitySchemes)
  );
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * Lower Stage-3 decorators and propagate one cache-busting generation token
 * through relative project imports. Bare package imports keep their canonical
 * URL, preserving framework metadata-symbol identity.
 */
async function installContractLoader(): Promise<void> {
  contractLoader ??= import('esbuild').then(({ transformSync }) => {
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const parent = context.parentURL === undefined ? undefined : new URL(context.parentURL);
        const generation = parent?.searchParams.get(GENERATION_QUERY);
        if (generation === null || generation === undefined || !RELATIVE_SPECIFIER.test(specifier)) {
          return nextResolve(specifier, context);
        }

        const cleanParent = new URL(context.parentURL ?? '');
        cleanParent.search = '';
        cleanParent.hash = '';
        const mapped = typescriptSibling(specifier, cleanParent);
        if (mapped !== undefined) {
          mapped.searchParams.set(GENERATION_QUERY, generation);
          return { url: mapped.href, shortCircuit: true };
        }

        const resolved = nextResolve(specifier, { ...context, parentURL: cleanParent.href });
        if (!resolved.url.startsWith('file:')) return resolved;
        const url = new URL(resolved.url);
        url.searchParams.set(GENERATION_QUERY, generation);
        return { ...resolved, url: url.href };
      },
      load(url, context, nextLoad) {
        if (!url.startsWith('file:')) return nextLoad(url, context);
        const sourceUrl = new URL(url);
        sourceUrl.search = '';
        sourceUrl.hash = '';
        if (!TYPESCRIPT_SOURCE.test(sourceUrl.pathname)) return nextLoad(url, context);

        const file = fileURLToPath(sourceUrl);
        const transformed = transformSync(readFileSync(file, 'utf8'), {
          loader: file.endsWith('x') ? 'tsx' : 'ts',
          format: 'esm',
          target: 'es2022',
          sourcefile: file,
          sourcemap: 'inline',
          tsconfigRaw: {
            compilerOptions: {
              experimentalDecorators: false,
              useDefineForClassFields: true,
            },
          },
        });
        return { format: 'module', source: transformed.code, shortCircuit: true };
      },
    });
  });
  await contractLoader;
}

function typescriptSibling(specifier: string, parent: URL): URL | undefined {
  const replacements = specifier.endsWith('.js')
    ? [`${specifier.slice(0, -3)}.ts`, `${specifier.slice(0, -3)}.tsx`]
    : specifier.endsWith('.mjs')
      ? [`${specifier.slice(0, -4)}.mts`]
      : specifier.endsWith('.cjs')
        ? [`${specifier.slice(0, -4)}.cts`]
        : [];
  for (const replacement of replacements) {
    const candidate = new URL(replacement, parent);
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return undefined;
}
