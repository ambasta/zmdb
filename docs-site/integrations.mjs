// Release-scoped framework support facts. This is the only authored source for
// the generated framework integration matrix; package membership and manifest
// facts remain owned by scripts/product/catalog.mjs and package.json files.

const integration = ({ capability, package: packageName, status, peers, docs, evidence }) =>
  Object.freeze({
    capability,
    package: packageName,
    status,
    ...(peers === undefined ? {} : { peers: Object.freeze([...peers]) }),
    docs,
    evidence: Object.freeze([...evidence]),
  });

export const INTEGRATIONS = Object.freeze([
  integration({
    capability: 'Angular',
    package: '@zmdb/angular',
    status: 'optional',
    peers: ['@angular/core', 'rxjs'],
    docs: 'framework-integrations',
    evidence: [
      'packages/angular/src/index.spec.ts',
      'packages/angular/src/index.type-test.ts',
      'fixtures/client-adapters/angular',
    ],
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
    peers: ['react'],
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
    package: '@zmdb/svelte',
    status: 'optional',
    peers: ['svelte'],
    docs: 'framework-integrations',
    evidence: [
      'packages/svelte/SPEC.md',
      'packages/svelte/src/svelte.spec.ts',
      'fixtures/client-adapters/svelte-packed',
    ],
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
    package: '@zmdb/vue',
    status: 'optional',
    peers: ['vue'],
    docs: 'framework-integrations',
    evidence: ['packages/vue/src/index.spec.ts', 'packages/vue/src/index.type-test.ts', 'fixtures/client-adapters/vue'],
  }),
]);
