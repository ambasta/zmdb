const compatibility = Object.freeze({
  range: '^1.0.0',
  floor: '1.0.0',
  tested: Object.freeze(['1.0.0']),
  evidence: 'support/peer.ts',
});

export const RELEASE_PACKAGE_POLICY = Object.freeze({
  app: Object.freeze({
    group: 'core',
    internalCompatibility: Object.freeze({}),
    peers: Object.freeze({ 'fixture-peer': compatibility }),
  }),
  core: Object.freeze({
    group: 'core',
    internalCompatibility: Object.freeze({}),
    peers: Object.freeze({}),
  }),
});
