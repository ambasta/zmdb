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
    package: '@zmdb/next',
    status: 'optional',
    peers: ['next', 'react', 'react-dom'],
    docs: 'framework-integrations',
    evidence: ['packages/next/src/client.spec.ts', 'packages/next/src/server.spec.ts', 'fixtures/next-app-router'],
  }),
  integration({
    capability: 'Nuxt',
    package: '@zmdb/nuxt',
    status: 'optional',
    peers: ['nuxt', 'vue'],
    docs: 'framework-integrations',
    evidence: [
      'packages/nuxt/src/client/client.spec.ts',
      'packages/nuxt/src/server/server.spec.ts',
      'packages/nuxt/src/packed-consumer.spec.ts',
      'fixtures/client-adapters/nuxt',
    ],
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
    package: '@zmdb/react-native',
    status: 'optional',
    peers: ['react', 'react-native'],
    docs: 'connect-react-native',
    evidence: [
      'packages/react-native/src/index.spec.ts',
      'packages/react-native/src/metro.spec.ts',
      'packages/react-native/src/packed-consumer.spec.ts',
      'fixtures/client-adapters',
    ],
  }),
  integration({
    capability: 'Solid',
    package: '@zmdb/solid',
    status: 'optional',
    peers: ['solid-js'],
    docs: 'framework-integrations',
    evidence: [
      'packages/solid/SPEC.md',
      'packages/solid/src/solid.spec.ts',
      'packages/solid/src/packed-consumer.spec.ts',
      'fixtures/client-adapters/src/solid-binding.ts',
    ],
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
