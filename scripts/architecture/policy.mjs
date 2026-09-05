// Canonical, read-only architecture constraints for the packages admitted by
// scripts/product/catalog.mjs. The catalog owns membership and npm identity;
// this record owns only dependency, reachability, and lockstep constraints.
//
// There are deliberately no ordinary third-party runtime allowances today.
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
  'query-compiler': packagePolicy({
    directory: 'packages/query-compiler',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: [],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [
      // Catalog inspection and declaration emission may invoke the formatter.
      './introspect',
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
  otel: packagePolicy({
    directory: 'packages/otel',
    zone: 'integration',
    ring: 6,
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
    ring: 3,
    allowedWorkspaceDependencies: ['ai', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      metro: ['./metro'],
      'metro-babel-transformer': ['./metro'],
      oxlint: ['./lint'],
      typescript: [
        './codegen',
        './metro',
        './plugin',
        './reflect',
        './testing',
        './transformer',
        './unplugin',
        'bin:zmdb-codegen',
      ],
    },
    toolingEntries: [
      // Programmatic AOT source generation.
      './codegen',
      // Generated source and declaration emission.
      './emit',
      // Oxlint plugin integration.
      './lint',
      // Metro build-pipeline adapter.
      './metro',
      // TypeScript compiler plugin entry.
      './plugin',
      // TypeScript program reflection.
      './reflect',
      // Compiler-oriented test utilities.
      './testing',
      // TypeScript source transformer.
      './transformer',
      // Bundler build-pipeline adapter.
      './unplugin',
      // Command-line AOT code generation.
      'bin:zmdb-codegen',
    ],
  }),
  repository: packagePolicy({
    directory: 'packages/repository',
    zone: 'runtime',
    ring: 4,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  sqlite: packagePolicy({
    directory: 'packages/sqlite',
    zone: 'runtime',
    ring: 5,
    allowedWorkspaceDependencies: ['query-compiler', 'repository'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  app: packagePolicy({
    directory: 'packages/app',
    zone: 'application',
    ring: 5,
    allowedWorkspaceDependencies: ['aot-validator', 'query-compiler', 'repository', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  jobs: packagePolicy({
    directory: 'packages/jobs',
    zone: 'application',
    ring: 6,
    allowedWorkspaceDependencies: ['app', 'query-compiler', 'repository', 'sqlite'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-grpc': packagePolicy({
    directory: 'packages/transport-grpc',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app', 'protobuf'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-nats': packagePolicy({
    directory: 'packages/transport-nats',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  'transport-rabbitmq': packagePolicy({
    directory: 'packages/transport-rabbitmq',
    zone: 'integration',
    ring: 6,
    allowedWorkspaceDependencies: ['app'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [],
  }),
  web: packagePolicy({
    directory: 'packages/web',
    zone: 'application',
    ring: 6,
    allowedWorkspaceDependencies: ['app', 'aot-validator', 'query-compiler', 'schema-core'],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {
      redis: ['./microservices/redis'],
      typescript: ['./contract/compiler'],
    },
    toolingEntries: [
      // Benchmark-only request and pipeline harnesses.
      './bench',
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
    ring: 7,
    allowedWorkspaceDependencies: [
      'app',
      'aot-validator',
      'query-compiler',
      'repository',
      'schema-core',
      'sqlite',
      'web',
    ],
    allowedRuntimeDependencies: [],
    optionalPeerEntries: {},
    toolingEntries: [
      // CLI orchestration, scaffolding, embedding, and application loading.
      './cli',
      // Filesystem-backed project configuration for build and CLI consumers.
      './config',
      // Public bundler integration delegated to the validator package.
      './unplugin',
      // Curated facade over the HTTP contract compiler.
      './web/contract/compiler',
      // The sole product command-line executable.
      'bin:zmdb',
    ],
  }),
});
