// Release-scoped framework support facts. This is the only authored source for
// the generated framework integration matrix; package membership and manifest
// facts remain owned by scripts/product/catalog.mjs and package.json files.

const integration = ({ capability, package: packageName, status, peer, docs, evidence }) =>
  Object.freeze({
    capability,
    package: packageName,
    status,
    ...(peer === undefined ? {} : { peer }),
    docs,
    evidence: Object.freeze([...evidence]),
  });

export const INTEGRATIONS = Object.freeze([
  integration({
    capability: 'Angular',
    package: null,
    status: 'not-planned',
    docs: 'framework-integrations',
    evidence: ['packages/zmdb/src/client-integrations/SPEC.md'],
  }),
  integration({
    capability: 'Next.js',
    package: '@zmdb/repository',
    status: 'documented',
    docs: 'deploy-nextjs',
    evidence: ['packages/repository/src/repository.spec.ts', 'packages/zmdb/src/client-integrations/SPEC.md'],
  }),
  integration({
    capability: 'Nuxt',
    package: null,
    status: 'not-planned',
    docs: 'framework-integrations',
    evidence: ['packages/zmdb/src/client-integrations/SPEC.md'],
  }),
  integration({
    capability: 'React',
    package: '@zmdb/react',
    status: 'optional',
    peer: 'react',
    docs: 'framework-integrations',
    evidence: ['packages/react/src/react.spec.ts', 'fixtures/client-adapters'],
  }),
  integration({
    capability: 'React Native',
    package: '@zmdb/aot-validator',
    status: 'documented',
    docs: 'connect-react-native',
    evidence: ['packages/aot-validator/src/plugin/metro.spec.ts', 'fixtures/consumer-metro'],
  }),
  integration({
    capability: 'Solid',
    package: null,
    status: 'not-planned',
    docs: 'framework-integrations',
    evidence: ['packages/zmdb/src/client-integrations/SPEC.md'],
  }),
  integration({
    capability: 'Svelte',
    package: null,
    status: 'not-planned',
    docs: 'framework-integrations',
    evidence: ['packages/zmdb/src/client-integrations/SPEC.md'],
  }),
  integration({
    capability: 'SvelteKit',
    package: null,
    status: 'not-planned',
    docs: 'framework-integrations',
    evidence: ['packages/zmdb/src/client-integrations/SPEC.md'],
  }),
  integration({
    capability: 'Vue',
    package: null,
    status: 'not-planned',
    docs: 'framework-integrations',
    evidence: ['packages/zmdb/src/client-integrations/SPEC.md'],
  }),
]);
