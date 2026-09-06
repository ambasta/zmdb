const freezeArray = values => Object.freeze([...values]);

export const PACKAGE_POLICY = Object.freeze({
  core: Object.freeze({
    directory: 'packages/core',
    zone: 'foundation',
    ring: 0,
    allowedWorkspaceDependencies: freezeArray([]),
    allowedRuntimeDependencies: freezeArray([]),
    optionalPeerEntries: Object.freeze({}),
    toolingEntries: freezeArray([]),
  }),
});
