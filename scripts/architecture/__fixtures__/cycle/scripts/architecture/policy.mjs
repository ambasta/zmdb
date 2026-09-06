const freezeArray = values => Object.freeze([...values]);

export const PACKAGE_POLICY = Object.freeze({
  core: Object.freeze({
    directory: 'packages/core',
    zone: 'application',
    ring: 0,
    allowedWorkspaceDependencies: freezeArray(['app']),
    allowedRuntimeDependencies: freezeArray([]),
    optionalPeerEntries: Object.freeze({}),
    toolingEntries: freezeArray([]),
  }),
  app: Object.freeze({
    directory: 'packages/app',
    zone: 'application',
    ring: 1,
    allowedWorkspaceDependencies: freezeArray(['core']),
    allowedRuntimeDependencies: freezeArray(['fixture-runtime']),
    optionalPeerEntries: Object.freeze({
      'fixture-peer': freezeArray(['./peer']),
    }),
    toolingEntries: freezeArray(['./cli']),
  }),
});
