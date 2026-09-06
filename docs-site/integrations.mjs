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
    docs: 'client-angular',
    evidence: [
      'packages/angular/src/index.spec.ts',
      'packages/angular/src/index.type-test.ts',
      'packages/angular/src/packed-consumer.spec.ts',
      'fixtures/client-adapters/angular',
    ],
  }),
  integration({
    capability: 'Next.js',
    package: '@zmdb/next',
    status: 'optional',
    peers: ['next', 'react', 'react-dom'],
    docs: 'client-next',
    evidence: [
      'packages/next/src/client.spec.ts',
      'packages/next/src/server.spec.ts',
      'packages/next/src/packed-consumer.spec.ts',
      'fixtures/next-app-router',
    ],
  }),
  integration({
    capability: 'Nuxt',
    package: '@zmdb/nuxt',
    status: 'optional',
    peers: ['nuxt', 'vue'],
    docs: 'client-nuxt',
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
    docs: 'client-react',
    evidence: [
      'packages/react/src/react.spec.ts',
      'packages/react/src/packed-consumer.spec.ts',
      'fixtures/client-adapters',
    ],
  }),
  integration({
    capability: 'React Native',
    package: '@zmdb/react-native',
    status: 'optional',
    peers: ['react', 'react-native'],
    docs: 'client-react-native',
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
    docs: 'client-solid',
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
    docs: 'client-svelte',
    evidence: [
      'packages/svelte/SPEC.md',
      'packages/svelte/src/svelte.spec.ts',
      'packages/svelte/src/packed.spec.ts',
      'fixtures/client-adapters/svelte-packed',
    ],
  }),
  integration({
    capability: 'SvelteKit',
    package: '@zmdb/sveltekit',
    status: 'optional',
    peers: ['@sveltejs/kit', 'svelte'],
    docs: 'client-sveltekit',
    evidence: [
      'packages/sveltekit/SPEC.md',
      'packages/sveltekit/src/server.spec.ts',
      'packages/sveltekit/src/client.spec.ts',
      'fixtures/client-adapters/sveltekit-packed',
    ],
  }),
  integration({
    capability: 'Vue',
    package: '@zmdb/vue',
    status: 'optional',
    peers: ['vue'],
    docs: 'client-vue',
    evidence: [
      'packages/vue/src/index.spec.ts',
      'packages/vue/src/index.type-test.ts',
      'packages/vue/src/packed-consumer.spec.ts',
      'fixtures/client-adapters/vue',
    ],
  }),
]);
