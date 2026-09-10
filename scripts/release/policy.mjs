// Canonical, read-only release classification and compatibility policy.
//
// Product membership and npm identity remain owned by scripts/product/catalog.mjs.
// Dependency order comes from package manifests. This file
// owns only release units and the exact ranges promised across those units.

const BASELINE = '1.0.0-beta.2';

const freezeArray = values => Object.freeze([...values]);

function compatibility(range, floor, tested, evidence) {
  return Object.freeze({
    range,
    floor,
    tested: freezeArray(tested),
    evidence,
  });
}

const baseline = evidence => compatibility(BASELINE, BASELINE, [BASELINE], evidence);

function peer(range, floor, evidence, tested = [floor]) {
  return compatibility(range, floor, tested, evidence);
}

// Declared support tier, with the evidence that justifies it.
//
// `supported` means every push exercises the package against the real technology it
// integrates: a live database, an installed packed consumer, or the real peer library in
// process. Semantic versioning applies to it and it may take a stable version.
// `provisional` means every push exercises the package's own behaviour, but the promise
// it makes about an external runtime, such as a framework build, a bundler, a broker no
// push starts, or a host process, rests on evidence that no push runs. `gaps` names that
// evidence, and a provisional package stays in prerelease until every gap runs on every
// push.
//
// The tier is declared here rather than derived from the workflow file, because
// acceptance must not depend on a hosted continuous-integration provider's
// configuration. Whether the declaration is still true is a review question, and the
// evidence path is what a reviewer opens to answer it.
const supported = evidence => Object.freeze({ evidence, tier: 'supported' });
const provisional = (evidence, gaps) => Object.freeze({ evidence, gaps: freezeArray(gaps), tier: 'provisional' });

function releasePackage(group, support, evidence, internalIds = [], peers = {}) {
  return Object.freeze({
    group,
    internalCompatibility: Object.freeze(Object.fromEntries(internalIds.map(id => [id, baseline(evidence)]))),
    peers: Object.freeze(peers),
    support,
  });
}

const PUBLISH = '.github/scripts/verify-publish.mjs';
const SERVERS = 'fixtures/consumer-server-integrations';
const ADAPTERS = 'fixtures/client-adapters';

export const RELEASE_PACKAGE_POLICY = Object.freeze({
  ai: releasePackage(
    'integration',
    supported('packages/ai/src/langchain/index.spec.ts'),
    PUBLISH,
    ['schema', 'validator'],
    {
      '@anthropic-ai/sdk': peer('0.124.0', '0.124.0', PUBLISH),
      '@langchain/core': peer('^1.2.9', '1.2.9', 'fixtures/llm-adapters'),
      ai: peer('^7.0.93', '7.0.93', 'packages/ai/src/vercel/packed-consumer.spec.ts'),
    },
  ),
  validator: releasePackage('core', supported(PUBLISH), PUBLISH),
  app: releasePackage('core', supported(PUBLISH), PUBLISH, [], {
    '@opentelemetry/api': peer('^1.9.1', '1.9.1', SERVERS),
  }),
  cli: releasePackage(
    'tooling',
    supported('packages/cli/src/packed-cli.spec.ts'),
    'fixtures/consumer-cli',
    ['app', 'compiler', 'migrations', 'orm', 'schema', 'sql', 'web'],
    {
      esbuild: peer('>=0.28.2 <0.29.0', '0.28.2', 'fixtures/consumer-cli'),
      typescript: peer('>=7.0.2 <8.0.0', '7.0.2', 'fixtures/consumer-cli'),
    },
  ),
  client: releasePackage(
    'integration',
    provisional('packages/client/src/react/react.spec.ts', [ADAPTERS]),
    'packages/client/src/runtime.spec.ts',
    [],
    {
      '@angular/core': peer('>=22.1.5 <23.0.0', '22.1.5', ADAPTERS),
      react: peer('>=19.2.8 <20.0.0', '19.2.8', ADAPTERS),
      'react-native': peer('>=0.87.1 <0.88.0', '0.87.1', ADAPTERS),
      rxjs: peer('>=7.8.2 <8.0.0', '7.8.2', ADAPTERS),
      'solid-js': peer('>=1.9.15 <2.0.0', '1.9.15', ADAPTERS),
      svelte: peer('>=5.57.0 <6.0.0', '5.57.0', ADAPTERS),
      vue: peer('>=3.5.42 <4.0.0', '3.5.42', 'fixtures/client-adapters/vue'),
    },
  ),
  cockroach: releasePackage('integration', supported('fixtures/database-cockroach'), 'fixtures/database-cockroach', [
    'migrations',
    'orm',
    'postgres',
    'sql',
  ]),
  compiler: releasePackage(
    'tooling',
    supported('packages/compiler/src/metro/metro.integration.spec.ts'),
    'fixtures/consumer-compiler',
    ['ai', 'schema', 'sql', 'validator'],
    {
      metro: peer('>=0.87.0 <0.88.0', '0.87.0', 'fixtures/consumer-metro'),
      'metro-babel-transformer': peer('>=0.87.0 <0.88.0', '0.87.0', 'fixtures/consumer-metro'),
      oxlint: peer('>=1.81.0 <1.82.0', '1.81.0', 'fixtures/consumer-compiler'),
      typescript: peer('>=7.0.2 <8.0.0', '7.0.2', 'fixtures/consumer-compiler'),
    },
  ),
  jobs: releasePackage(
    'core',
    supported('packages/jobs/src/provider-lifecycle.spec.ts'),
    'packages/jobs/src/provider-lifecycle.spec.ts',
  ),
  'jobs-postgres': releasePackage(
    'integration',
    supported(SERVERS),
    'packages/jobs-postgres/src/index.spec.ts',
    ['jobs', 'postgres'],
    {
      pg: peer('^8.23.0', '8.23.0', 'packages/jobs-postgres/src/index.spec.ts'),
    },
  ),
  'jobs-sqlite': releasePackage('integration', supported(SERVERS), 'packages/jobs-sqlite/src/index.spec.ts', [
    'jobs',
    'sqlite',
  ]),
  mcp: releasePackage(
    'integration',
    provisional('packages/mcp/src/mcp.spec.ts', ['fixtures/consumer-mcp']),
    'fixtures/consumer-mcp',
    ['ai'],
  ),
  migrations: releasePackage('tooling', supported(PUBLISH), PUBLISH, ['schema', 'sql']),
  mssql: releasePackage(
    'integration',
    supported('fixtures/database-mssql'),
    'fixtures/database-mssql',
    ['migrations', 'orm', 'sql'],
    {
      mssql: peer('^12.7.0', '12.7.0', 'fixtures/database-mssql'),
    },
  ),
  mysql: releasePackage(
    'integration',
    supported('packages/mysql/src/live.spec.ts'),
    'fixtures/database-mysql',
    ['migrations', 'orm', 'sql'],
    {
      mysql2: peer('^3.24.3', '3.24.3', 'fixtures/database-mysql'),
    },
  ),
  next: releasePackage(
    'integration',
    provisional('packages/next/src/server.spec.ts', ['fixtures/next-app-router']),
    'fixtures/next-app-router',
    ['client'],
    {
      next: peer('>=16.3.4 <17.0.0', '16.3.4', 'fixtures/next-app-router'),
      react: peer('>=19.2.8 <20.0.0', '19.2.8', 'fixtures/next-app-router'),
      'react-dom': peer('>=19.2.8 <20.0.0', '19.2.8', 'fixtures/next-app-router'),
    },
  ),
  nuxt: releasePackage(
    'integration',
    provisional('packages/nuxt/src/server/server.spec.ts', ['fixtures/client-adapters/nuxt']),
    'fixtures/client-adapters/nuxt',
    ['client'],
    {
      nuxt: peer('>=4.5.2 <5.0.0', '4.5.2', 'fixtures/client-adapters/nuxt'),
      vue: peer('>=3.5.42 <4.0.0', '3.5.42', 'fixtures/client-adapters/nuxt'),
    },
  ),
  postgres: releasePackage(
    'integration',
    supported('fixtures/database-postgres'),
    'fixtures/database-postgres',
    ['migrations', 'orm', 'sql'],
    {
      pg: peer('^8.23.0', '8.23.0', 'fixtures/database-postgres'),
    },
  ),
  protobuf: releasePackage('integration', supported(PUBLISH), PUBLISH),
  sql: releasePackage('core', supported(PUBLISH), PUBLISH),
  orm: releasePackage('core', supported(PUBLISH), PUBLISH),
  schema: releasePackage('core', supported(PUBLISH), PUBLISH),
  singlestore: releasePackage(
    'integration',
    supported('packages/singlestore/src/singlestore.live.spec.ts'),
    'fixtures/database-singlestore',
    ['migrations', 'mysql', 'orm', 'sql'],
    {
      mysql2: peer('^3.24.3', '3.24.3', 'fixtures/database-singlestore'),
    },
  ),
  sqlite: releasePackage('integration', supported('packages/sqlite/src/driver.spec.ts'), 'fixtures/database-sqlite', [
    'migrations',
    'orm',
    'sql',
  ]),
  sveltekit: releasePackage(
    'integration',
    provisional('packages/sveltekit/src/server.spec.ts', ['fixtures/client-adapters/sveltekit-packed']),
    'fixtures/client-adapters/sveltekit-packed',
    ['client'],
    {
      '@sveltejs/kit': peer('>=2.70.3 <3.0.0', '2.70.3', 'fixtures/client-adapters/sveltekit-packed'),
      svelte: peer('>=5.57.0 <6.0.0', '5.57.0', 'fixtures/client-adapters/sveltekit-packed'),
    },
  ),
  transport: releasePackage(
    'integration',
    provisional(SERVERS, ['fixtures/consumer-transport-kafka', 'fixtures/consumer-transport-sqs']),
    SERVERS,
    ['app', 'protobuf'],
    {
      '@aws-sdk/client-sqs': peer('>=3.1127.0 <4.0.0', '3.1127.0', 'fixtures/consumer-transport-sqs'),
      '@grpc/grpc-js': peer('^1.14.4', '1.14.4', SERVERS),
      '@nats-io/transport-node': peer('^3.4.0', '3.4.0', SERVERS),
      amqplib: peer('^2.0.1', '2.0.1', SERVERS),
      kafkajs: peer('>=2.2.4 <3.0.0', '2.2.4', 'fixtures/consumer-transport-kafka'),
      redis: peer('^6.2.1', '6.2.1', SERVERS),
    },
  ),
  web: releasePackage('core', supported(PUBLISH), PUBLISH, ['compiler'], {
    typescript: peer('>=7.0.2 <8.0.0', '7.0.2', PUBLISH),
  }),
  zmdb: releasePackage('core', supported(PUBLISH), 'fixtures/consumer-product', [
    'cli',
    'cockroach',
    'compiler',
    'migrations',
    'mssql',
    'mysql',
    'postgres',
    'singlestore',
    'sqlite',
  ]),
});

// Release ids retired when 1.0.0-beta.3 folded sixteen single-purpose packages into
// entry points of four packages. Their released changelog sections stay in place as
// published history, so the changelog parser still accepts them as owners while the
// publish plan, which reads RELEASE_PACKAGE_POLICY, no longer knows them. The value is
// the specifier that replaced the retired npm package.
export const RETIRED_RELEASE_IDS = Object.freeze({
  'ai-anthropic': '@zmdb/ai/anthropic',
  'ai-langchain': '@zmdb/ai/langchain',
  'ai-vercel': '@zmdb/ai/vercel',
  angular: '@zmdb/client/angular',
  otel: '@zmdb/app/otel',
  react: '@zmdb/client/react',
  'react-native': '@zmdb/client/react-native',
  solid: '@zmdb/client/solid',
  svelte: '@zmdb/client/svelte',
  'transport-grpc': '@zmdb/transport/grpc',
  'transport-kafka': '@zmdb/transport/kafka',
  'transport-nats': '@zmdb/transport/nats',
  'transport-rabbitmq': '@zmdb/transport/rabbitmq',
  'transport-redis': '@zmdb/transport/redis',
  'transport-sqs': '@zmdb/transport/sqs',
  vue: '@zmdb/client/vue',
});
