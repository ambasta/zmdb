// Canonical, read-only architecture constraints for the packages admitted by
// scripts/product/catalog.mjs. The catalog owns membership and npm identity;
// this record owns only dependency, reachability, and lockstep constraints.
//
// There are deliberately no ordinary third-party runtime allowances today.
// Required peers for technology-selected integration and provider packages are
// governed by their manifests and packed fixtures rather than this dependency
// allowance.
// Build/compiler dependencies remain confined to the tooling selectors whose
// adjacent comments explain the accepted purpose.

const freezeArray = values => Object.freeze([...values]);

const freezeEntryAssignments = assignments =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(assignments).map(([dependency, selectors]) => [dependency, freezeArray(selectors)]),
    ),
  );

function packagePolicy({
  directory,
  zone,
  ring,
  allowedWorkspaceDependencies,
  allowedRuntimeDependencies,
  optionalPeerEntries,
  toolingEntries,
}) {
  return Object.freeze({
    directory,
    zone,
    ring,
    allowedWorkspaceDependencies: freezeArray(allowedWorkspaceDependencies),
    allowedRuntimeDependencies: freezeArray(allowedRuntimeDependencies),
    optionalPeerEntries: freezeEntryAssignments(optionalPeerEntries),
    toolingEntries: freezeArray(toolingEntries),
    release: 'lockstep',
  });
}

export const PACKAGE_POLICY = Object.freeze({
  client: packagePolicy({
    directory: 'packages/client',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [
      // Deterministic transport doubles and request helpers for consumer tests.
      './testing',
    ],
  }),
  react: packagePolicy({
    directory: 'packages/react',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'react-native': packagePolicy({
    directory: 'packages/react-native',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'react'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  angular: packagePolicy({
    directory: 'packages/angular',
    zone: 'integration',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  vue: packagePolicy({
    directory: 'packages/vue',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  next: packagePolicy({
    directory: 'packages/next',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'react'],
    allowedRuntimeDependencies: [
      // Next's server export loads the framework's official build-time client-boundary marker.
      'server-only',
    ],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  nuxt: packagePolicy({
    directory: 'packages/nuxt',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'vue'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'query-compiler': packagePolicy({
    directory: 'packages/query-compiler',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  migrations: packagePolicy({
    directory: 'packages/migrations',
    zone: 'foundation',
    ring: 1,
    allowedWorkspaceDependencies: ['query-compiler'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [
      // Formatter-backed TypeScript declaration emission.
      './declarations',
      // Filesystem-backed migration discovery, persistence, and project commands.
      './files',
      // Deterministic migration protocol test support.
      './testing',
    ],
  }),
  'schema-core': packagePolicy({
    directory: 'packages/schema-core',
    zone: 'foundation',
    ring: 1,
    allowedWorkspaceDependencies: ['query-compiler'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  svelte: packagePolicy({
    directory: 'packages/svelte',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  solid: packagePolicy({
    directory: 'packages/solid',
    zone: 'integration',
    ring: 1,
    allowedWorkspaceDependencies: ['client'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  sveltekit: packagePolicy({
    directory: 'packages/sveltekit',
    zone: 'integration',
    ring: 2,
    allowedWorkspaceDependencies: ['client', 'svelte'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  ai: packagePolicy({
    directory: 'packages/ai',
    zone: 'runtime',
    ring: 2,
    allowedWorkspaceDependencies: ['schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [
      // Compile-time tool generation; ordinary AI runtime exports do not load it.
      './compiler',
    ],
  }),
  'ai-anthropic': packagePolicy({
    directory: 'packages/ai-anthropic',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@anthropic-ai/sdk': ['.'],
    },
    toolingEntries: [],
  }),
  'ai-langchain': packagePolicy({
    directory: 'packages/ai-langchain',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@langchain/core': ['.'],
    },
    toolingEntries: [],
  }),
  'ai-vercel': packagePolicy({
    directory: 'packages/ai-vercel',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      ai: ['.'],
    },
    toolingEntries: [],
  }),
  mcp: packagePolicy({
    directory: 'packages/mcp',
    zone: 'integration',
    ring: 3,
    allowedWorkspaceDependencies: ['ai'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  mssql: packagePolicy({
    directory: 'packages/mssql',
    zone: 'integration',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      mssql: ['.'],
    },
    toolingEntries: [],
  }),
  otel: packagePolicy({
    directory: 'packages/otel',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  protobuf: packagePolicy({
    directory: 'packages/protobuf',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'aot-validator': packagePolicy({
    directory: 'packages/aot-validator',
    zone: 'runtime',
    ring: 2,
    allowedWorkspaceDependencies: ['schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  compiler: packagePolicy({
    directory: 'packages/compiler',
    zone: 'tooling',
    ring: 3,
    allowedWorkspaceDependencies: ['ai', 'aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      metro: ['./metro'],
      'metro-babel-transformer': ['./metro'],
      oxlint: ['./lint'],
    },
    toolingEntries: [
      // Project compilation and generated-artifact materialisation.
      '.',
      // Filesystem-backed project configuration.
      './config',
      // Generated source and declaration emission.
      './emit',
      // Compiler diagnostic types.
      './errors',
      // Oxlint plugin integration.
      './lint',
      // Metro build-pipeline adapter.
      './metro',
      // TypeScript program reflection.
      './reflect',
      // Compiler-oriented test utilities.
      './testing',
      // TypeScript source transformer.
      './transform',
      // Bundler build-pipeline adapter.
      './unplugin',
    ],
  }),
  repository: packagePolicy({
    directory: 'packages/repository',
    zone: 'runtime',
    ring: 3,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  postgres: packagePolicy({
    directory: 'packages/postgres',
    zone: 'runtime',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      pg: ['.'],
    },
    toolingEntries: [],
  }),
  cockroach: packagePolicy({
    directory: 'packages/cockroach',
    zone: 'runtime',
    ring: 5,
    allowedWorkspaceDependencies: ['migrations', 'postgres', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  singlestore: packagePolicy({
    directory: 'packages/singlestore',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['migrations', 'mysql', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      mysql2: ['.'],
    },
    toolingEntries: [],
  }),
  sqlite: packagePolicy({
    directory: 'packages/sqlite',
    zone: 'runtime',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  mysql: packagePolicy({
    directory: 'packages/mysql',
    zone: 'integration',
    ring: 4,
    allowedWorkspaceDependencies: ['migrations', 'query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      mysql2: ['.'],
    },
    toolingEntries: [],
  }),
  app: packagePolicy({
    directory: 'packages/app',
    zone: 'application',
    ring: 4,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'repository', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  jobs: packagePolicy({
    directory: 'packages/jobs',
    zone: 'application',
    ring: 5,
    allowedWorkspaceDependencies: ['app', 'query-compiler', 'repository', 'sqlite'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-grpc': packagePolicy({
    directory: 'packages/transport-grpc',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app', 'protobuf'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-nats': packagePolicy({
    directory: 'packages/transport-nats',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-rabbitmq': packagePolicy({
    directory: 'packages/transport-rabbitmq',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-redis': packagePolicy({
    directory: 'packages/transport-redis',
    zone: 'integration',
    ring: 5,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'jobs-postgres': packagePolicy({
    directory: 'packages/jobs-postgres',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['jobs', 'postgres'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  web: packagePolicy({
    directory: 'packages/web',
    zone: 'application',
    ring: 5,
    allowedWorkspaceDependencies: ['app', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@zmdb/compiler': ['./contract/compiler'],
      typescript: ['./contract/compiler'],
    },
    toolingEntries: [
      // HTTP contract code generation.
      './contract/compiler',
      // Runtime inspection and developer diagnostics.
      './devtools',
      // Server test doubles and harness helpers.
      './testing',
    ],
  }),
  zmdb: packagePolicy({
    directory: 'packages/zmdb',
    zone: 'facade',
    ring: 6,
    allowedWorkspaceDependencies: [
      'app',
      'aot-validator',
      'compiler',
      'migrations',
      'query-compiler',
      'repository',
      'schema-core',
      'sqlite',
      'web',
    ],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      '@zmdb/mssql': ['./cli', './drivers/mssql', 'bin:zmdb'],
      '@zmdb/postgres': ['./drivers/pg'],
    },
    toolingEntries: [
      // CLI orchestration, scaffolding, embedding, and application loading.
      './cli',
      // Curated facade over project compilation.
      './compiler',
      // Filesystem-backed project configuration for build and CLI consumers.
      './config',
      // Curated schema-lifecycle facade.
      './migrations',
      // Cross-package test fixtures and harness helpers.
      './testing',
      // Public bundler integration delegated to the compiler package.
      './unplugin',
      // Curated facade over the HTTP contract compiler.
      './web/contract/compiler',
      // Curated facade over HTTP runtime inspection and diagnostics.
      './web/devtools',
      // Curated facade over HTTP test doubles and harness helpers.
      './web/testing',
      // The sole product command-line executable.
      'bin:zmdb',
    ],
  }),
});
