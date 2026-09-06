// Set consistent npm publish metadata on all @zmdb packages + write per-package
// README, and copy the root LICENSE into each. Idempotent — run with `node`.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const REPO = 'https://github.com/ambasta/zmdb';
const VERSION = '1.0.0-alpha.4';

const META = {
  client: {
    description: 'Dependency-free HTTP client runtime for generated and manually declared zmdb operations.',
    keywords: ['typescript', 'http', 'fetch', 'client', 'zmdb'],
  },
  react: {
    description: 'React context, query, and mutation lifecycle bindings for generated zmdb clients.',
    keywords: ['client', 'react', 'typescript', 'zmdb'],
  },
  angular: {
    description: 'Angular dependency-injection, signal, lifecycle, and Observable bindings for generated zmdb clients.',
    keywords: ['typescript', 'angular', 'client', 'dependency-injection', 'signals', 'rxjs', 'zmdb'],
  },
  vue: {
    description: 'Vue plugin, reactive query, and mutation lifecycle bindings for generated zmdb clients.',
    keywords: ['client', 'composables', 'typescript', 'vue', 'zmdb'],
  },
  svelte: {
    description:
      'Typed Svelte context, lazy query stores, mutation stores, and lifecycle cancellation for generated zmdb clients.',
    keywords: ['client', 'stores', 'svelte', 'typescript', 'zmdb'],
  },
  next: {
    description: 'Request-scoped Next.js server clients and React browser bindings for generated zmdb clients.',
    keywords: ['client', 'nextjs', 'react', 'typescript', 'zmdb'],
  },
  nuxt: {
    description:
      'Nuxt module, request-scoped Nitro transport, Vue bindings, and native hydration for generated zmdb clients.',
    keywords: ['client', 'nuxt', 'nitro', 'ssr', 'typescript', 'vue', 'zmdb'],
  },
  solid: {
    description: 'Solid context, resource and owner-lifetime bindings for generated zmdb clients.',
    keywords: ['client', 'solid', 'solidjs', 'typescript', 'zmdb'],
  },
  'schema-core': {
    description:
      'Schema DSL + compile-time type derivation (Entity/Create/Update/read DTOs), relations, OpenAPI, seeding, and custom types — the single source of truth for a zmdb data layer.',
    keywords: ['typescript', 'orm', 'schema', 'dto', 'type-derivation', 'openapi', 'zmdb'],
  },
  ai: {
    description:
      'Provider-neutral AI tool documents, bounded chat orchestration, shared tool invocation, and OpenAPI-derived tools for zmdb.',
    keywords: ['typescript', 'ai', 'llm', 'function-calling', 'json-schema', 'openapi', 'zmdb'],
  },
  'ai-anthropic': {
    description: 'Anthropic Messages API chat driver for the provider-neutral @zmdb/ai runtime.',
    keywords: ['typescript', 'ai', 'anthropic', 'chat', 'llm', 'zmdb'],
  },
  'ai-langchain': {
    description: 'Optional LangChain structured-tool adapter for provider-neutral zmdb AI tool documents.',
    keywords: ['typescript', 'ai', 'llm', 'langchain', 'json-schema', 'zmdb'],
  },
  'ai-vercel': {
    description: 'Optional Vercel AI SDK tool adapter for provider-neutral zmdb AI tool documents.',
    keywords: ['typescript', 'ai', 'llm', 'vercel', 'function-calling', 'zmdb'],
  },
  mcp: {
    description:
      'Transport-neutral MCP client and server cores with validated tool dispatch, authenticated identity, and bounded remote calls.',
    keywords: ['typescript', 'ai', 'llm', 'mcp', 'model-context-protocol', 'json-rpc', 'zmdb'],
  },
  'query-compiler': {
    description:
      'SQL-first, dialect-aware query compiler: SELECT/INSERT/UPDATE/DELETE, joins, aggregations, full-text search, set operations, schema-object DDL, and migration diffing.',
    keywords: ['typescript', 'sql', 'query-builder', 'postgres', 'mysql', 'sqlite', 'migrations', 'zmdb'],
  },
  'aot-validator': {
    description:
      'Ahead-of-time compiled validation and JSON Ser/De: is/assert/validate/equals/random, unions, transforms — inlined to straight-line JavaScript at build time, no runtime parser.',
    keywords: ['typescript', 'validation', 'aot', 'runtime-types', 'json', 'serialization', 'zmdb'],
  },
  protobuf: {
    description:
      "Zero-dependency protobuf calls, typed gRPC service artifacts, and the wire runtime targeted by zmdb's ahead-of-time compiler.",
    keywords: ['typescript', 'protobuf', 'grpc', 'serialization', 'aot', 'zmdb'],
  },
  repository: {
    description:
      'Auto-validating CRUD repository over a zmdb schema: transactions, populate, read-replicas, lifecycle events, and framework adapters. No proxies, no identity map.',
    keywords: ['typescript', 'repository', 'crud', 'transactions', 'data-layer', 'zmdb'],
  },
  sqlite: {
    description:
      'Complete SQLite vertical for zmdb: SQL dialect, migrations, introspection, embedded migrations, and a node:sqlite driver with no third-party database client.',
    keywords: ['typescript', 'sqlite', 'node-sqlite', 'database', 'orm', 'migrations', 'zmdb'],
  },
  app: {
    description:
      'Protocol-neutral application kernel for zmdb: Stage-3 metadata, dependency injection, modules, lifecycle, messaging, commands, events, CQRS, state, health, and observability.',
    keywords: [
      'typescript',
      'application-framework',
      'decorators',
      'stage-3',
      'dependency-injection',
      'messaging',
      'cqrs',
      'zmdb',
    ],
  },
  jobs: {
    description:
      'Typed queues, workers, dead letters, scheduling, leases, and a built-in SQLite memory backend for zmdb applications.',
    keywords: ['typescript', 'jobs', 'queue', 'worker', 'scheduler', 'cron', 'zmdb'],
  },
  'jobs-postgres': {
    description: 'node-postgres JobStore adapter for caller-owned PostgreSQL pools and clients.',
    install: 'npm add @zmdb/jobs-postgres@alpha pg',
    keywords: ['adapter', 'jobs', 'pg', 'postgres', 'queue', 'typescript', 'zmdb'],
  },
  otel: {
    description: 'OpenTelemetry API adapter for the explicit observability ports owned by the zmdb application kernel.',
    install: 'npm add @zmdb/otel@alpha @opentelemetry/api',
    keywords: ['adapter', 'observability', 'opentelemetry', 'telemetry', 'typescript', 'zmdb'],
  },
  'transport-grpc': {
    description:
      'Typed gRPC server and client integration for generated @zmdb/protobuf service artifacts and the @zmdb/app lifecycle.',
    install: 'npm add @zmdb/transport-grpc@alpha @grpc/grpc-js',
    keywords: ['grpc', 'http2', 'protobuf', 'transport', 'typescript', 'zmdb'],
  },
  'transport-nats': {
    description: 'Core NATS transport strategy for the public messaging contract owned by the zmdb application kernel.',
    install: 'npm add @zmdb/transport-nats@alpha @nats-io/transport-node',
    keywords: ['messaging', 'nats', 'request-reply', 'transport', 'typescript', 'zmdb'],
  },
  'transport-rabbitmq': {
    description:
      'RabbitMQ transport strategy for the zmdb application messaging contract, with confirmed retries and owned dead-letter topology.',
    install: 'npm add @zmdb/transport-rabbitmq@alpha amqplib',
    keywords: ['amqp', 'messaging', 'rabbitmq', 'transport', 'typescript', 'zmdb'],
  },
  'transport-redis': {
    description: 'Redis Pub/Sub transport strategy for the protocol-neutral zmdb application messaging contract.',
    install: 'npm add @zmdb/transport-redis@alpha redis',
    keywords: ['messaging', 'pubsub', 'redis', 'transport', 'typescript', 'zmdb'],
  },
  web: {
    description:
      'HTTP framework for the zmdb application kernel: Stage-3 controllers, typed request context, middleware, OpenAPI, gateways, testing, and runtime adapters.',
    keywords: ['typescript', 'web-framework', 'http', 'decorators', 'stage-3', 'openapi', 'zmdb'],
  },
  zmdb: {
    description:
      'The zmdb umbrella package — one install that re-exports the whole ecosystem (schema-core, query-compiler, aot-validator, repository). Define your schema once; types, validation, CRUD and more derive at compile time.',
    keywords: ['typescript', 'orm', 'data-layer', 'schema', 'validation', 'sql', 'zmdb'],
  },
};

for (const [name, m] of Object.entries(META)) {
  const dir = join(ROOT, 'packages', name);
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // Ordered, publish-ready shape (preserve existing exports/engines/scripts).
  const next = {
    name: pkg.name,
    version: VERSION,
    description: m.description,
    keywords: m.keywords,
    license: 'GPL-3.0-or-later',
    author: 'zmdb contributors',
    homepage: `${REPO}#readme`,
    repository: { type: 'git', url: `git+${REPO}.git`, directory: `packages/${name}` },
    bugs: { url: `${REPO}/issues` },
    type: 'module',
    sideEffects: pkg.sideEffects ?? false,
    exports: pkg.exports,
    // The committed (dev) manifest. `.github/scripts/repoint-dist.mjs` rewrites
    // `exports`, `bin`, `main`, `types` and `files` onto `dist` in CI, right before
    // publish; nothing here should assume the published shape.
    files: ['src', 'README.md', 'LICENSE'],
    engines: pkg.engines ?? { node: '>=26' },
    publishConfig: { access: 'public', tag: 'alpha' },
    scripts: pkg.scripts ?? { build: 'node ../../scripts/build-package.mjs', test: 'vitest run' },
  };
  // Every field this rewrite does not name is a field it would delete. `bin` in
  // particular: dropping it publishes @zmdb/aot-validator with no `zmdb-codegen`,
  // which nothing in the repo would notice because the repo runs the binary by path.
  for (const field of ['bin', 'dependencies', 'devDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    if (pkg[field]) next[field] = pkg[field];
  }
  writeFileSync(pkgPath, JSON.stringify(next, null, 2) + '\n');

  // Copy LICENSE.
  copyFileSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));

  // Per-package README.
  const exportList = Object.keys(pkg.exports || { '.': '' })
    .map(e => (e === '.' ? `\`${pkg.name}\`` : `\`${pkg.name}/${e.replace('./', '')}\``))
    .join(', ');
  const readme = `# ${pkg.name}

${m.description}

Part of **[zmdb](${REPO})** — a zero-maintenance TypeScript data layer where you
define your schema once and entities, DTOs, validation, serialization, OpenAPI
and CRUD all derive at compile time.

## Install

\`\`\`bash
${m.install ?? `npm add ${pkg.name}@alpha`}
\`\`\`

> **Prerelease** (\`${VERSION}\`, published under the \`alpha\` dist-tag). Requires
> **Node.js 26+** and is **ESM-only**. Ships built ESM \`.js\` + \`.d.ts\` under
> \`./dist\`.

## Entry points

${exportList}

## Documentation

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
`;
  writeFileSync(join(dir, 'README.md'), readme);

  // Keep tests, type-level tests and specs out of the published tarball — `src` ships
  // for the sourcemaps, not so that somebody installs the test suite.
  const npmignore = [
    '*.spec.ts',
    '**/*.spec.ts',
    '*.type-test.ts',
    '**/*.type-test.ts',
    'SPEC.md',
    '**/SPEC.md',
    'tsconfig.json',
    'tsconfig.build.json',
    '',
  ];
  writeFileSync(join(dir, '.npmignore'), npmignore.join('\n'));

  console.log(`prepared ${pkg.name} @ ${VERSION}`);
}
console.log('DONE');
