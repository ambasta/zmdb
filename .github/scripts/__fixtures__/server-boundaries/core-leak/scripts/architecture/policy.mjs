const row = (directory, allowedWorkspaceDependencies = []) =>
  Object.freeze({
    allowedRuntimeDependencies: Object.freeze([]),
    allowedWorkspaceDependencies: Object.freeze(allowedWorkspaceDependencies),
    directory,
    optionalPeerEntries: Object.freeze({}),
    release: 'lockstep',
    ring: 0,
    toolingEntries: Object.freeze([]),
    zone: 'integration',
  });

export const PACKAGE_POLICY = Object.freeze({
  'transport-redis': row('packages/transport-redis'),
  zmdb: row('packages/zmdb', ['transport-redis']),
});
