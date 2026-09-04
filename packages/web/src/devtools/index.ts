// @zmdb/web/devtools — an on-demand description of the declared module graph.
//
// This entry point is deliberately separate from the runtime package roots. It
// reconstructs the graph from decorator metadata only when called; App,
// CompiledModule and Container retain no inspector-specific state.

import type { Scope, Token } from '../di/index.js';
import { injectionsOf } from '../di/index.js';
import { moduleDefOf, type ModuleClass, type ModuleDef, type ProviderDef } from '../modules/index.js';
import { getRoutes, type HttpMethod } from '../routing/index.js';

export interface ModuleNode {
  readonly id: string;
  readonly name: string;
  readonly lazy: boolean;
  readonly imports: readonly string[];
}

export type ProviderNode =
  | {
      readonly kind: 'value';
      readonly id: string;
      readonly token: string;
      readonly module: string;
    }
  | {
      readonly kind: 'factory';
      readonly id: string;
      readonly token: string;
      readonly module: string;
      readonly scope: Scope;
      /** Factory bodies are opaque, so their dependency edges are unknowable. */
      readonly dependencies: readonly string[] | null;
    };

export interface RouteNode {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: string;
}

export interface ClassNode {
  readonly id: string;
  readonly name: string;
  readonly module: string;
  readonly routes: readonly RouteNode[];
  readonly dependencies: readonly string[];
}

export type FindingKind =
  | 'cycle'
  | 'unresolved-token'
  | 'eager-depends-on-lazy'
  | 'duplicate-provider'
  | 'shadowed-route'
  | 'duplicate-token-description'
  | 'anonymous-class';

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly subject: string;
  readonly path?: readonly string[];
}

export interface GraphDescription {
  readonly modules: readonly ModuleNode[];
  readonly providers: readonly ProviderNode[];
  readonly controllers: readonly ClassNode[];
  readonly findings: readonly Finding[];
}

export interface GraphFilter {
  readonly module?: string;
  readonly token?: string;
  readonly depth?: number;
  readonly providers?: boolean;
}

interface ImportEdge {
  readonly module: ModuleClass;
  readonly lazy: boolean;
}

interface ModuleRecord {
  readonly module: ModuleClass;
  readonly definition: ModuleDef | undefined;
  readonly imports: readonly ImportEdge[];
}

interface ProviderRecord {
  readonly definition: ProviderDef;
  readonly module: ModuleClass;
}

interface ControllerRecord {
  readonly controller: abstract new (...args: never[]) => object;
  readonly module: ModuleClass;
  readonly injections: readonly { readonly field: string | symbol; readonly token: Token<unknown> }[];
}

interface Projection {
  readonly modules: ReadonlySet<string>;
  readonly providers: ReadonlySet<string>;
  readonly controllers: ReadonlySet<string>;
  readonly details: boolean;
}

/** A visible marker that reverse factory edges cannot be derived from declarations. */
const UNKNOWN_FACTORY_DEPENDENTS = '<factory dependencies unknown>';
const DEFAULT_DEPTH = 2;
const MAX_UNFILTERED_PROVIDERS = 50;

/**
 * Reconstruct the declared graph without constructing a provider or controller.
 *
 * A cycle is returned as a finding instead of thrown, so this remains useful for
 * the graphs that `compileModule` correctly refuses to boot.
 */
export function describeGraph(rootModule: ModuleClass): GraphDescription {
  const records = new Map<ModuleClass, ModuleRecord>();
  const order: ModuleClass[] = [];
  const visited = new Set<ModuleClass>();
  const active = new Set<ModuleClass>();
  const stack: ModuleClass[] = [];
  const cyclePaths: ModuleClass[][] = [];

  const visit = (moduleClass: ModuleClass): void => {
    if (active.has(moduleClass)) {
      const repeatedAt = stack.indexOf(moduleClass);
      cyclePaths.push([...stack.slice(repeatedAt), moduleClass]);
      return;
    }
    if (visited.has(moduleClass)) {
      return;
    }

    active.add(moduleClass);
    stack.push(moduleClass);
    const definition = moduleDefOf(moduleClass);
    const imports = (definition?.imports ?? []).flatMap(declared => {
      const edge = importEdgeOf(declared);
      return edge === null ? [] : [edge];
    });
    records.set(moduleClass, { module: moduleClass, definition, imports });
    order.push(moduleClass);
    for (const imported of imports) {
      visit(imported.module);
    }
    stack.pop();
    active.delete(moduleClass);
    visited.add(moduleClass);
  };

  visit(rootModule);

  const moduleIds = idsFor(order, 'module', module => module.name, '<anonymous>');
  const eager = eagerModules(rootModule, records);
  const providerRecords: ProviderRecord[] = [];
  const controllerRecords: ControllerRecord[] = [];

  for (const moduleClass of order) {
    const definition = records.get(moduleClass)?.definition;
    for (const provider of definition?.providers ?? []) {
      providerRecords.push({ definition: provider, module: moduleClass });
    }
    for (const controller of definition?.controllers ?? []) {
      controllerRecords.push({
        controller,
        module: moduleClass,
        injections: injectionsOf(controller),
      });
    }
  }

  const allTokens = [
    ...providerRecords.map(record => record.definition.token),
    ...controllerRecords.flatMap(record => record.injections.map(injection => injection.token)),
  ];
  const tokenIds = idsFor(allTokens, 'provider', token => token.description, '<anonymous-token>');

  const modules: ModuleNode[] = order.map(moduleClass => ({
    id: idOf(moduleIds, moduleClass),
    name: moduleClass.name,
    lazy: !eager.has(moduleClass),
    imports: (records.get(moduleClass)?.imports ?? []).map(edge => idOf(moduleIds, edge.module)),
  }));

  const providers: ProviderNode[] = providerRecords.map(record => {
    const provider = record.definition;
    const common = {
      id: idOf(tokenIds, provider.token),
      token: provider.token.description,
      module: idOf(moduleIds, record.module),
    };
    if ('useValue' in provider) {
      return { kind: 'value', ...common };
    }
    return {
      kind: 'factory',
      ...common,
      scope: provider.scope ?? 'singleton',
      dependencies: null,
    };
  });

  const controllers: ClassNode[] = controllerRecords.map(record => {
    const moduleId = idOf(moduleIds, record.module);
    return {
      id: `controller:${moduleId.slice('module:'.length)}.${stableName(record.controller.name, '<anonymous>')}`,
      name: record.controller.name,
      module: moduleId,
      routes: getRoutes(record.controller).map(route => ({
        method: route.method,
        path: route.path,
        handler: route.handlerName,
      })),
      dependencies: record.injections.map(injection => idOf(tokenIds, injection.token)),
    };
  });

  const findings: Finding[] = [];
  const seenCycles = new Set<string>();
  for (const path of cyclePaths) {
    const ids = path.map(moduleClass => idOf(moduleIds, moduleClass));
    const key = ids.join('\0');
    if (seenCycles.has(key)) {
      continue;
    }
    seenCycles.add(key);
    findings.push({
      kind: 'cycle',
      severity: 'error',
      message: `Import cycle: ${ids.join(' -> ')}`,
      subject: ids[0] ?? 'module:<unknown>',
      path: ids,
    });
  }

  const providersByToken = groupBy(providerRecords, record => record.definition.token);
  for (const [token, registrations] of providersByToken) {
    const modulesForToken = unique(registrations.map(record => record.module));
    if (modulesForToken.length > 1) {
      findings.push({
        kind: 'duplicate-provider',
        severity: 'error',
        message:
          `Token "${token.description}" is registered by ` +
          modulesForToken.map(moduleClass => moduleClass.name || '<anonymous>').join(' and '),
        subject: idOf(tokenIds, token),
      });
    }
  }

  for (const record of controllerRecords) {
    const controllerId = controllerIdOf(controllers, record, moduleIds);
    for (const injection of record.injections) {
      const registrations = providersByToken.get(injection.token) ?? [];
      if (registrations.length === 0) {
        findings.push({
          kind: 'unresolved-token',
          severity: 'error',
          message:
            `${record.controller.name || '<anonymous>'}.${String(injection.field)} injects ` +
            `"${injection.token.description}", but no module registers it`,
          subject: controllerId,
        });
        continue;
      }
      if (eager.has(record.module) && registrations.every(registration => !eager.has(registration.module))) {
        findings.push({
          kind: 'eager-depends-on-lazy',
          severity: 'error',
          message:
            `Eager controller ${record.controller.name || '<anonymous>'} injects lazy-only token ` +
            `"${injection.token.description}"`,
          subject: controllerId,
        });
      }
    }
  }

  const routes = new Map<string, string>();
  for (const controller of controllers) {
    for (const route of controller.routes) {
      const key = `${route.method}\0${route.path}`;
      const first = routes.get(key);
      if (first === undefined) {
        routes.set(key, controller.id);
      } else {
        findings.push({
          kind: 'shadowed-route',
          severity: 'error',
          message: `${route.method} ${route.path} on ${controller.id} is shadowed by ${first}`,
          subject: controller.id,
        });
      }
    }
  }

  const tokensByDescription = groupBy(unique(allTokens), token => token.description);
  for (const [description, tokens] of tokensByDescription) {
    if (tokens.length < 2) {
      continue;
    }
    for (const token of tokens) {
      findings.push({
        kind: 'duplicate-token-description',
        severity: 'warning',
        message: `Distinct tokens share the description "${description}"`,
        subject: idOf(tokenIds, token),
      });
    }
  }

  for (const moduleClass of order) {
    if (moduleClass.name.length === 0) {
      findings.push({
        kind: 'anonymous-class',
        severity: 'warning',
        message: 'A module has no stable class name',
        subject: idOf(moduleIds, moduleClass),
      });
    }
  }
  for (const controller of controllers) {
    if (controller.name.length === 0) {
      findings.push({
        kind: 'anonymous-class',
        severity: 'warning',
        message: 'A controller has no stable class name',
        subject: controller.id,
      });
    }
  }
  for (const token of unique(allTokens)) {
    if (token.description.length === 0) {
      findings.push({
        kind: 'anonymous-class',
        severity: 'warning',
        message: 'A provider token has no stable description',
        subject: idOf(tokenIds, token),
      });
    }
  }

  return { modules, providers, controllers, findings };
}

/**
 * Return known direct reverse edges.
 *
 * Factory provider bodies are opaque. For a provider query, the sentinel keeps
 * that incompleteness visible instead of returning an unsafe "nothing else".
 */
export function dependentsOf(graph: GraphDescription, id: string): readonly string[] {
  const known = [
    ...graph.providers.flatMap(provider =>
      provider.kind === 'factory' && provider.dependencies?.includes(id) ? [provider.id] : [],
    ),
    ...graph.controllers.flatMap(controller => (controller.dependencies.includes(id) ? [controller.id] : [])),
  ];
  const asksAboutProvider = graph.providers.some(provider => provider.id === id);
  const hasOpaqueFactory = graph.providers.some(
    provider => provider.kind === 'factory' && provider.dependencies === null,
  );
  return asksAboutProvider && hasOpaqueFactory ? [...unique(known), UNKNOWN_FACTORY_DEPENDENTS] : unique(known);
}

/** Render a deterministic, readable module tree. */
export function renderTree(graph: GraphDescription, filter?: GraphFilter): string {
  const projection = project(graph, filter);
  const lines: string[] = [];

  for (const module of graph.modules) {
    if (!projection.modules.has(module.id)) {
      continue;
    }
    lines.push(`${module.name || '<anonymous>'}${module.lazy ? ' [lazy]' : ''}`);
    const imports = module.imports.filter(id => projection.modules.has(id)).map(id => displayId(id));
    if (imports.length > 0) {
      lines.push(`  imports: ${imports.join(', ')}`);
    }
    if (!projection.details) {
      continue;
    }
    for (const provider of graph.providers) {
      if (provider.module !== module.id || !projection.providers.has(provider.id)) {
        continue;
      }
      const detail =
        provider.kind === 'value'
          ? 'value'
          : `${provider.scope}; ${provider.dependencies === null ? 'dependencies unknown' : 'no dependencies'}`;
      lines.push(`  provider ${provider.token} (${detail})`);
    }
    for (const controller of graph.controllers) {
      if (controller.module !== module.id || !projection.controllers.has(controller.id)) {
        continue;
      }
      lines.push(`  controller ${controller.name || '<anonymous>'}`);
      for (const route of controller.routes) {
        lines.push(
          `    ${route.method.padEnd(6)} ${route.path.padEnd(30)} ${controller.name || '<anonymous>'}.${route.handler}`,
        );
      }
    }
  }

  if (graph.findings.length > 0) {
    lines.push('findings');
    for (const finding of graph.findings) {
      lines.push(`  ${finding.severity.toUpperCase()} ${finding.kind}: ${finding.message}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Render Graphviz DOT with every id and label quoted. */
export function renderDot(graph: GraphDescription, filter?: GraphFilter): string {
  const projection = project(graph, filter);
  const lines = ['digraph zmdb {', '  rankdir="LR";'];

  for (const module of graph.modules) {
    if (projection.modules.has(module.id)) {
      lines.push(
        `  ${quote(module.id)} [shape="box", label=${quote(`${module.name || '<anonymous>'}${module.lazy ? ' [lazy]' : ''}`)}];`,
      );
    }
  }
  for (const module of graph.modules) {
    if (!projection.modules.has(module.id)) {
      continue;
    }
    for (const imported of module.imports) {
      if (projection.modules.has(imported)) {
        lines.push(`  ${quote(module.id)} -> ${quote(imported)} [label="imports"];`);
      }
    }
  }

  if (projection.details) {
    for (const provider of graph.providers) {
      if (!projection.providers.has(provider.id)) {
        continue;
      }
      const unknown = provider.kind === 'factory' && provider.dependencies === null;
      const attributes = [
        'shape="ellipse"',
        `label=${quote(
          provider.kind === 'value'
            ? `${provider.token}\nvalue`
            : `${provider.token}\n${provider.scope}${unknown ? '\ndependencies unknown' : ''}`,
        )}`,
        ...(unknown ? ['style="dashed"'] : []),
      ];
      lines.push(`  ${quote(provider.id)} [${attributes.join(', ')}];`);
      if (projection.modules.has(provider.module)) {
        lines.push(`  ${quote(provider.module)} -> ${quote(provider.id)} [label="provides"];`);
      }
      if (provider.kind === 'factory' && provider.dependencies !== null) {
        for (const dependency of provider.dependencies) {
          if (projection.providers.has(dependency)) {
            lines.push(`  ${quote(provider.id)} -> ${quote(dependency)} [label="depends on"];`);
          }
        }
      }
    }

    for (const controller of graph.controllers) {
      if (!projection.controllers.has(controller.id)) {
        continue;
      }
      const routes = controller.routes.map(route => `${route.method} ${route.path} ${route.handler}`).join('\n');
      lines.push(
        `  ${quote(controller.id)} [shape="component", label=${quote(
          routes.length === 0 ? controller.name || '<anonymous>' : `${controller.name || '<anonymous>'}\n${routes}`,
        )}];`,
      );
      if (projection.modules.has(controller.module)) {
        lines.push(`  ${quote(controller.module)} -> ${quote(controller.id)} [label="controller"];`);
      }
      for (const dependency of controller.dependencies) {
        if (projection.providers.has(dependency)) {
          lines.push(`  ${quote(controller.id)} -> ${quote(dependency)} [label="injects"];`);
        }
      }
    }
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

function importEdgeOf(declared: unknown): ImportEdge | null {
  if (isModuleClass(declared)) {
    return { module: declared, lazy: false };
  }
  if (typeof declared !== 'object' || declared === null) {
    return null;
  }
  const candidate: { kind?: unknown; module?: unknown } = declared;
  return candidate.kind === 'lazy' && isModuleClass(candidate.module) ? { module: candidate.module, lazy: true } : null;
}

function isModuleClass(value: unknown): value is ModuleClass {
  return typeof value === 'function';
}

function eagerModules(root: ModuleClass, records: ReadonlyMap<ModuleClass, ModuleRecord>): ReadonlySet<ModuleClass> {
  const eager = new Set<ModuleClass>();
  const mark = (moduleClass: ModuleClass): void => {
    if (eager.has(moduleClass)) {
      return;
    }
    eager.add(moduleClass);
    for (const imported of records.get(moduleClass)?.imports ?? []) {
      if (!imported.lazy) {
        mark(imported.module);
      }
    }
  };
  mark(root);
  return eager;
}

function idsFor<T extends object>(
  values: readonly T[],
  namespace: string,
  describe: (value: T) => string,
  anonymous: string,
): ReadonlyMap<T, string> {
  const distinct = unique(values);
  const groups = groupBy(distinct, value => stableName(describe(value), anonymous));
  const ids = new Map<T, string>();
  const used = new Set<string>();
  for (const [description, group] of groups) {
    group.forEach((value, index) => {
      const base = `${namespace}:${description}${group.length > 1 ? `#${String(index + 1)}` : ''}`;
      let candidate = base;
      let disambiguator = 2;
      while (used.has(candidate)) {
        candidate = `${base}#${String(disambiguator)}`;
        disambiguator += 1;
      }
      used.add(candidate);
      ids.set(value, candidate);
    });
  }
  return ids;
}

function idOf<T extends object>(ids: ReadonlyMap<T, string>, value: T): string {
  return ids.get(value) ?? '<unknown>';
}

function controllerIdOf(
  controllers: readonly ClassNode[],
  record: ControllerRecord,
  moduleIds: ReadonlyMap<ModuleClass, string>,
): string {
  const expected = `controller:${idOf(moduleIds, record.module).slice('module:'.length)}.${stableName(
    record.controller.name,
    '<anonymous>',
  )}`;
  return controllers.find(controller => controller.id === expected)?.id ?? expected;
}

function stableName(name: string, fallback: string): string {
  return name.length === 0 ? fallback : name;
}

function groupBy<K, V>(values: readonly V[], keyOf: (value: V) => K): Map<K, V[]> {
  const groups = new Map<K, V[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [value]);
    } else {
      group.push(value);
    }
  }
  return groups;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function project(graph: GraphDescription, filter: GraphFilter = {}): Projection {
  const depth = filter.depth ?? DEFAULT_DEPTH;
  if (!Number.isInteger(depth) || depth < 0) {
    throw new Error(`depth must be a non-negative integer, received ${String(depth)}`);
  }

  const details = filter.providers === true || filter.module !== undefined || filter.token !== undefined;
  if (
    details &&
    filter.module === undefined &&
    filter.token === undefined &&
    graph.providers.length > MAX_UNFILTERED_PROVIDERS
  ) {
    const moduleNames = graph.modules.map(module => module.name || '<anonymous>').join(', ');
    throw new Error(
      `refusing an unfiltered graph with ${String(graph.providers.length)} provider nodes; ` +
        `filter with module or token (${moduleNames})`,
    );
  }

  const modules = new Set<string>();
  const providers = new Set<string>();
  const controllers = new Set<string>();

  if (filter.module !== undefined) {
    const root = graph.modules.find(module => module.name === filter.module || module.id === filter.module);
    if (root === undefined) {
      throw new Error(`no module named "${filter.module}"`);
    }
    const queue: { readonly id: string; readonly distance: number }[] = [{ id: root.id, distance: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || modules.has(current.id) || current.distance > depth) {
        continue;
      }
      modules.add(current.id);
      const node = graph.modules.find(module => module.id === current.id);
      for (const imported of node?.imports ?? []) {
        queue.push({ id: imported, distance: current.distance + 1 });
      }
    }
  } else if (filter.token === undefined) {
    for (const module of graph.modules) {
      modules.add(module.id);
    }
  }

  if (filter.token !== undefined) {
    const seeds = graph.providers.filter(provider => provider.token === filter.token || provider.id === filter.token);
    if (seeds.length === 0) {
      throw new Error(`no token named "${filter.token}"`);
    }
    const adjacency = dependencyAdjacency(graph);
    const queue: { readonly id: string; readonly distance: number }[] = seeds.map(provider => ({
      id: provider.id,
      distance: 0,
    }));
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || seen.has(current.id) || current.distance > depth) {
        continue;
      }
      seen.add(current.id);
      const provider = graph.providers.find(node => node.id === current.id);
      if (provider !== undefined) {
        providers.add(provider.id);
        modules.add(provider.module);
      }
      const controller = graph.controllers.find(node => node.id === current.id);
      if (controller !== undefined) {
        controllers.add(controller.id);
        modules.add(controller.module);
      }
      for (const neighbour of adjacency.get(current.id) ?? []) {
        queue.push({ id: neighbour, distance: current.distance + 1 });
      }
    }
  }

  if (details && filter.token === undefined) {
    for (const provider of graph.providers) {
      if (modules.has(provider.module)) {
        providers.add(provider.id);
      }
    }
    for (const controller of graph.controllers) {
      if (modules.has(controller.module)) {
        controllers.add(controller.id);
      }
    }
  }

  return { modules, providers, controllers, details };
}

function dependencyAdjacency(graph: GraphDescription): ReadonlyMap<string, ReadonlySet<string>> {
  const adjacency = new Map<string, Set<string>>();
  const connect = (left: string, right: string): void => {
    const fromLeft = adjacency.get(left);
    if (fromLeft === undefined) {
      adjacency.set(left, new Set([right]));
    } else {
      fromLeft.add(right);
    }
    const fromRight = adjacency.get(right);
    if (fromRight === undefined) {
      adjacency.set(right, new Set([left]));
    } else {
      fromRight.add(left);
    }
  };
  for (const provider of graph.providers) {
    if (provider.kind === 'factory' && provider.dependencies !== null) {
      for (const dependency of provider.dependencies) {
        connect(provider.id, dependency);
      }
    }
  }
  for (const controller of graph.controllers) {
    for (const dependency of controller.dependencies) {
      connect(controller.id, dependency);
    }
  }
  return adjacency;
}

function displayId(id: string): string {
  const separator = id.indexOf(':');
  return separator === -1 ? id : id.slice(separator + 1);
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;
}
