const row = (directory, allowedWorkspaceDependencies = []) =>
  Object.freeze({
    allowedRuntimeDependencies: Object.freeze([]),
    allowedWorkspaceDependencies: Object.freeze(allowedWorkspaceDependencies),
    directory,
    optionalPeerEntries: Object.freeze({}),
    release: 'lockstep',
    ring: 0,
    toolingEntries: Object.freeze([]),
    zone: 'runtime',
  });

export const PACKAGE_POLICY = Object.freeze({
  app: row('packages/app'),
  jobs: row('packages/jobs', ['app']),
  'jobs-postgres': row('packages/jobs-postgres', ['jobs']),
  otel: row('packages/otel', ['app']),
  protobuf: row('packages/protobuf'),
  'transport-grpc': row('packages/transport-grpc', ['app', 'protobuf']),
  'transport-nats': row('packages/transport-nats', ['app']),
  'transport-rabbitmq': row('packages/transport-rabbitmq', ['app']),
  'transport-redis': row('packages/transport-redis', ['app']),
  web: row('packages/web', ['app']),
  zmdb: row('packages/zmdb', ['app', 'jobs', 'web']),
});
