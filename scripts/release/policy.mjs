// Canonical, read-only release classification and compatibility policy.
//
// Product membership and npm identity remain owned by scripts/product/catalog.mjs.
// Dependency order comes from package manifests. This file
// owns only release units and the exact ranges promised across those units.

const BASELINE = '1.0.0-beta.1';

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

function releasePackage(group, evidence, internalIds = [], peers = {}) {
  return Object.freeze({
    group,
    internalCompatibility: Object.freeze(Object.fromEntries(internalIds.map(id => [id, baseline(evidence)]))),
    peers: Object.freeze(peers),
  });
}

const PUBLISH = '.github/scripts/verify-publish.mjs';

export const RELEASE_PACKAGE_POLICY = Object.freeze({
  ai: releasePackage('integration', PUBLISH, ['schema', 'validator']),
  'ai-anthropic': releasePackage('integration', PUBLISH, ['ai'], {
    '@anthropic-ai/sdk': peer('0.124.0', '0.124.0', PUBLISH),
  }),
  'ai-langchain': releasePackage('integration', 'fixtures/llm-adapters', ['ai'], {
    '@langchain/core': peer('^1.2.9', '1.2.9', 'fixtures/llm-adapters'),
  }),
  'ai-vercel': releasePackage('integration', 'packages/ai-vercel/src/packed-consumer.spec.ts', ['ai'], {
    ai: peer('^7.0.93', '7.0.93', 'packages/ai-vercel/src/packed-consumer.spec.ts'),
  }),
  angular: releasePackage('integration', 'fixtures/client-adapters', [], {
    '@angular/core': peer('>=22.1.5 <23.0.0', '22.1.5', 'fixtures/client-adapters'),
    rxjs: peer('>=7.8.2 <8.0.0', '7.8.2', 'fixtures/client-adapters'),
  }),
  validator: releasePackage('core', PUBLISH),
  app: releasePackage('core', PUBLISH),
  cli: releasePackage(
    'tooling',
    'fixtures/consumer-cli',
    ['app', 'compiler', 'migrations', 'orm', 'schema', 'sql', 'web'],
    {
      esbuild: peer('>=0.28.2 <0.29.0', '0.28.2', 'fixtures/consumer-cli'),
      typescript: peer('>=7.0.2 <8.0.0', '7.0.2', 'fixtures/consumer-cli'),
    },
  ),
  client: releasePackage('integration', 'fixtures/consumer-http-client'),
  cockroach: releasePackage('integration', 'fixtures/database-cockroach', ['migrations', 'orm', 'postgres', 'sql']),
  compiler: releasePackage('tooling', 'fixtures/consumer-compiler', ['ai', 'schema', 'sql', 'validator'], {
    metro: peer('>=0.87.0 <0.88.0', '0.87.0', 'fixtures/consumer-metro'),
    'metro-babel-transformer': peer('>=0.87.0 <0.88.0', '0.87.0', 'fixtures/consumer-metro'),
    oxlint: peer('>=1.81.0 <1.82.0', '1.81.0', 'fixtures/consumer-compiler'),
    typescript: peer('>=7.0.2 <8.0.0', '7.0.2', 'fixtures/consumer-compiler'),
  }),
  jobs: releasePackage('core', 'fixtures/consumer-jobs-providers'),
  'jobs-postgres': releasePackage('integration', 'fixtures/consumer-jobs-providers', ['jobs', 'postgres'], {
    pg: peer('^8.23.0', '8.23.0', 'fixtures/consumer-jobs-providers'),
  }),
  'jobs-sqlite': releasePackage('integration', 'fixtures/consumer-jobs-providers', ['jobs', 'sqlite']),
  mcp: releasePackage('integration', 'fixtures/consumer-mcp', ['ai']),
  migrations: releasePackage('tooling', PUBLISH, ['schema', 'sql']),
  mssql: releasePackage('integration', 'fixtures/database-mssql', ['migrations', 'orm', 'sql'], {
    mssql: peer('^12.7.0', '12.7.0', 'fixtures/database-mssql'),
  }),
  mysql: releasePackage('integration', 'fixtures/database-mysql', ['migrations', 'orm', 'sql'], {
    mysql2: peer('^3.24.3', '3.24.3', 'fixtures/database-mysql'),
  }),
  next: releasePackage('integration', 'fixtures/next-app-router', ['client', 'react'], {
    next: peer('>=16.3.4 <17.0.0', '16.3.4', 'fixtures/next-app-router'),
    react: peer('>=19.2.8 <20.0.0', '19.2.8', 'fixtures/next-app-router'),
    'react-dom': peer('>=19.2.8 <20.0.0', '19.2.8', 'fixtures/next-app-router'),
  }),
  nuxt: releasePackage('integration', 'fixtures/client-adapters/nuxt', ['client', 'vue'], {
    nuxt: peer('>=4.5.2 <5.0.0', '4.5.2', 'fixtures/client-adapters/nuxt'),
    vue: peer('>=3.5.42 <4.0.0', '3.5.42', 'fixtures/client-adapters/nuxt'),
  }),
  otel: releasePackage('integration', 'fixtures/consumer-server-integrations', ['app'], {
    '@opentelemetry/api': peer('^1.9.1', '1.9.1', 'fixtures/consumer-server-integrations'),
  }),
  postgres: releasePackage('integration', 'fixtures/database-postgres', ['migrations', 'orm', 'sql'], {
    pg: peer('^8.23.0', '8.23.0', 'fixtures/database-postgres'),
  }),
  protobuf: releasePackage('integration', PUBLISH),
  sql: releasePackage('core', PUBLISH),
  react: releasePackage('integration', 'fixtures/client-adapters', ['client'], {
    react: peer('>=19.2.8 <20.0.0', '19.2.8', 'fixtures/client-adapters'),
  }),
  'react-native': releasePackage('integration', 'fixtures/client-adapters', ['client', 'react'], {
    react: peer('>=19.2.8 <20.0.0', '19.2.8', 'fixtures/client-adapters'),
    'react-native': peer('>=0.87.1 <0.88.0', '0.87.1', 'fixtures/client-adapters'),
  }),
  orm: releasePackage('core', PUBLISH),
  schema: releasePackage('core', PUBLISH),
  singlestore: releasePackage('integration', 'fixtures/database-singlestore', ['migrations', 'mysql', 'orm', 'sql'], {
    mysql2: peer('^3.24.3', '3.24.3', 'fixtures/database-singlestore'),
  }),
  solid: releasePackage('integration', 'fixtures/client-adapters', ['client'], {
    'solid-js': peer('>=1.9.15 <2.0.0', '1.9.15', 'fixtures/client-adapters'),
  }),
  sqlite: releasePackage('integration', 'fixtures/database-sqlite', ['migrations', 'orm', 'sql']),
  svelte: releasePackage('integration', 'fixtures/client-adapters', ['client'], {
    svelte: peer('>=5.57.0 <6.0.0', '5.57.0', 'fixtures/client-adapters'),
  }),
  sveltekit: releasePackage('integration', 'fixtures/client-adapters/sveltekit-packed', ['client', 'svelte'], {
    '@sveltejs/kit': peer('>=2.70.3 <3.0.0', '2.70.3', 'fixtures/client-adapters/sveltekit-packed'),
    svelte: peer('>=5.57.0 <6.0.0', '5.57.0', 'fixtures/client-adapters/sveltekit-packed'),
  }),
  'transport-grpc': releasePackage('integration', 'fixtures/consumer-server-integrations', ['app', 'protobuf'], {
    '@grpc/grpc-js': peer('^1.14.4', '1.14.4', 'fixtures/consumer-server-integrations'),
  }),
  'transport-kafka': releasePackage('integration', 'fixtures/consumer-transport-kafka', ['app'], {
    kafkajs: peer('>=2.2.4 <3.0.0', '2.2.4', 'fixtures/consumer-transport-kafka'),
  }),
  'transport-nats': releasePackage('integration', 'fixtures/consumer-server-integrations', ['app'], {
    '@nats-io/transport-node': peer('^3.4.0', '3.4.0', 'fixtures/consumer-server-integrations'),
  }),
  'transport-rabbitmq': releasePackage('integration', 'fixtures/consumer-server-integrations', ['app'], {
    amqplib: peer('^2.0.1', '2.0.1', 'fixtures/consumer-server-integrations'),
  }),
  'transport-redis': releasePackage('integration', 'fixtures/consumer-server-integrations', ['app'], {
    redis: peer('^6.2.1', '6.2.1', 'fixtures/consumer-server-integrations'),
  }),
  'transport-sqs': releasePackage('integration', 'fixtures/consumer-transport-sqs', ['app'], {
    '@aws-sdk/client-sqs': peer('>=3.1127.0 <4.0.0', '3.1127.0', 'fixtures/consumer-transport-sqs'),
  }),
  vue: releasePackage('integration', 'fixtures/client-adapters/vue', ['client'], {
    vue: peer('>=3.5.42 <4.0.0', '3.5.42', 'fixtures/client-adapters/vue'),
  }),
  web: releasePackage('core', PUBLISH, ['compiler'], {
    typescript: peer('>=7.0.2 <8.0.0', '7.0.2', PUBLISH),
  }),
  zmdb: releasePackage('core', 'fixtures/consumer-product', [
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
