const own = (name, options = {}) => ({
  files: {
    [`fixtures/consumer-release-compatibility/programs/${name}.ts`]: `src/${name}.ts`,
    ...(options.schema
      ? { 'fixtures/consumer-release-compatibility/programs/tool-schema.ts': 'src/tool-schema.ts' }
      : {}),
  },
  runtime: `lib/${name}.js`,
  roots: options.roots ?? [],
  peers: options.peers ?? {},
  conditions: options.conditions ?? [],
  evidence: options.evidence ?? 'installed public API operation',
});
const existing = (directory, files, options = {}) => ({
  files: Object.fromEntries(
    files.map(file => [`${directory}/${file}`, file.startsWith('src/') ? file : `src/${file}`]),
  ),
  runtime: options.runtime ?? 'lib/runtime.mjs',
  roots: options.roots ?? [],
  peers: options.peers ?? {},
  conditions: [],
  evidence: options.evidence ?? 'installed public API operation',
  ...(options.service ? { service: options.service } : {}),
});
const foundation = id => {
  const selected = existing(
    `fixtures/consumer-runtime-foundation/${id}`,
    ['src/contracts.ts', 'src/runtime.mjs', ...(id === 'sql' ? ['src/dialect.ts'] : [])],
    { roots: id === 'orm' ? ['schema', 'sql', 'validator'] : [] },
  );
  if (id === 'orm') selected.files['fixtures/consumer-runtime-foundation/sql/src/dialect.ts'] = 'src/dialect.ts';
  return selected;
};
const server = (id, options) =>
  existing(`fixtures/consumer-server-integrations/${id}`, ['src/contracts.ts', 'src/runtime.mjs'], options);

/** Programs are explicit; release groups, versions, ranges and floors come only from release policy. */
export const CONSUMER_CASES = Object.freeze({
  ai: own('ai', { schema: true, roots: ['schema'] }),
  'ai-anthropic': own('ai-anthropic', { evidence: 'real Anthropic SDK against a local HTTP wiremock' }),
  'ai-langchain': own('ai-langchain', { schema: true, roots: ['schema'], evidence: 'real LangChain tool invocation' }),
  'ai-vercel': own('ai-vercel', { schema: true, roots: ['schema'], evidence: 'real AI SDK tool invocation' }),
  angular: own('angular'),
  app: own('app'),
  cli: own('cli'),
  client: own('client'),
  cockroach: own('cockroach', {
    roots: ['sql'],
    peers: { pg: 'postgres' },
    evidence: 'real peer driver binding and dialect SQL; no CockroachDB server claim',
  }),
  compiler: {
    ...own('compiler', { roots: ['schema'] }),
    files: {
      'fixtures/consumer-release-compatibility/programs/compiler.ts': 'src/compiler.ts',
      'fixtures/consumer-release-compatibility/programs/declaration.ts': 'src/declaration.ts',
    },
  },
  jobs: own('jobs'),
  'jobs-postgres': server('jobs-postgres', {
    roots: ['jobs'],
    service: 'ZMDB_PG',
    evidence: 'real PostgreSQL queue workflow',
  }),
  'jobs-sqlite': server('jobs-sqlite', { roots: ['jobs'], evidence: 'real node:sqlite queue workflow' }),
  mcp: existing('fixtures/consumer-mcp', ['contracts.ts', 'runtime.mjs'], {
    roots: ['ai'],
    evidence: 'public MCP JSON-RPC request/response transport',
  }),
  migrations: own('migrations', { schema: true, roots: ['schema'] }),
  mssql: own('mssql', { roots: ['sql'], evidence: 'real peer driver binding and dialect SQL; no SQL Server claim' }),
  mysql: own('mysql', { roots: ['sql'], evidence: 'real peer driver binding and dialect SQL; no MySQL server claim' }),
  next: own('next', { conditions: ['react-server'], evidence: 'request-local Next server client memoization' }),
  nuxt: own('nuxt', { evidence: 'Nuxt request transport forwarding with a fetch wiremock' }),
  orm: foundation('orm'),
  otel: server('otel', {
    peers: { '@opentelemetry/sdk-trace-base': 'fixture' },
    evidence: 'real OpenTelemetry SDK span export',
  }),
  postgres: own('postgres', {
    roots: ['sql'],
    evidence: 'real pg driver binding and structural query-port operation; live server covered by jobs-postgres',
  }),
  protobuf: server('protobuf', { evidence: 'protobuf wire round trip and named compiler-marker refusals' }),
  react: own('react', {
    peers: { 'react-dom': 'next' },
    evidence: 'real React server renderer and request-local context',
  }),
  'react-native': own('react-native', {
    peers: { 'react-dom': 'next' },
    evidence: 'real React renderer with typed native service ports; no device claim',
  }),
  schema: foundation('schema'),
  singlestore: own('singlestore', {
    roots: ['sql'],
    evidence: 'real peer driver binding and dialect SQL; no SingleStore server claim',
  }),
  solid: own('solid'),
  sql: foundation('sql'),
  sqlite: own('sqlite', { roots: ['sql'], evidence: 'real node:sqlite SQL round trip' }),
  svelte: own('svelte'),
  sveltekit: own('sveltekit', { evidence: 'SvelteKit request forwarding with a fetch wiremock' }),
  'transport-grpc': server('grpc', { roots: ['app'], evidence: 'real gRPC TCP unary request/response and lifecycle' }),
  'transport-rabbitmq': existing('fixtures/consumer-release-compatibility/rabbitmq', ['contracts.ts', 'runtime.mjs'], {
    service: 'ZMDB_RABBITMQ_URL',
    evidence: 'real AMQP event and correlated request/response',
  }),
  'transport-nats': server('nats', { service: 'ZMDB_NATS_URL', evidence: 'real NATS event and request/response' }),
  'transport-redis': server('redis', {
    roots: ['app'],
    service: 'ZMDB_REDIS_URL',
    evidence: 'real Redis event and request/response',
  }),
  validator: foundation('validator'),
  vue: existing('fixtures/client-adapters/vue', ['src/ssr.ts'], {
    runtime: 'lib/ssr.js',
    evidence: 'real Vue request-local SSR injection',
  }),
  web: own('web', { roots: ['app'], evidence: 'real application lifecycle and in-process HTTP request' }),
  zmdb: own('zmdb'),
});
