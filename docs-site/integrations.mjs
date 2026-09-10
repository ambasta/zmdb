// Release-scoped framework support facts. This is the only authored source for
// the generated framework integration matrix; package membership and manifest
// facts remain owned by scripts/product/catalog.mjs and package.json files.

// `package` is the published npm package that carries the support and `entry` is the
// specifier a consumer imports. The two differ where one package publishes a binding per
// framework, in which case the peers belong to the entry point rather than to every
// consumer of the package, so the package declares them optional.
const integration = ({ capability, package: packageName, entry, status, peers, docs, evidence }) =>
  Object.freeze({
    capability,
    package: packageName,
    ...(entry === undefined ? {} : { entry }),
    status,
    ...(peers === undefined ? {} : { peers: Object.freeze([...peers]) }),
    docs,
    evidence: Object.freeze([...evidence]),
  });

export const INTEGRATIONS = Object.freeze([
  integration({
    capability: 'Angular',
    package: '@zmdb/client',
    entry: '@zmdb/client/angular',
    status: 'optional',
    peers: ['@angular/core', 'rxjs'],
    docs: 'client-angular',
    evidence: [
      'packages/client/src/angular/index.spec.ts',
      'packages/client/src/angular/index.type-test.ts',
      'packages/client/src/angular/packed-consumer.spec.ts',
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
    package: '@zmdb/client',
    entry: '@zmdb/client/react',
    status: 'optional',
    peers: ['react'],
    docs: 'client-react',
    evidence: [
      'packages/client/src/react/react.spec.ts',
      'packages/client/src/react/packed-consumer.spec.ts',
      'fixtures/client-adapters',
    ],
  }),
  integration({
    capability: 'React Native',
    package: '@zmdb/client',
    entry: '@zmdb/client/react-native',
    status: 'optional',
    peers: ['react', 'react-native'],
    docs: 'client-react-native',
    evidence: [
      'packages/compiler/src/metro/metro.spec.ts',
      'packages/client/src/react-native/index.spec.ts',
      'packages/client/src/react-native/metro.spec.ts',
      'packages/client/src/react-native/packed-consumer.spec.ts',
      'fixtures/client-adapters',
      'fixtures/consumer-metro',
    ],
  }),
  integration({
    capability: 'Solid',
    package: '@zmdb/client',
    entry: '@zmdb/client/solid',
    status: 'optional',
    peers: ['solid-js'],
    docs: 'client-solid',
    evidence: [
      'packages/client/src/solid/SPEC.md',
      'packages/client/src/solid/solid.spec.ts',
      'packages/client/src/solid/packed-consumer.spec.ts',
      'fixtures/client-adapters/src/solid-binding.ts',
    ],
  }),
  integration({
    capability: 'Svelte',
    package: '@zmdb/client',
    entry: '@zmdb/client/svelte',
    status: 'optional',
    peers: ['svelte'],
    docs: 'client-svelte',
    evidence: [
      'packages/client/src/svelte/SPEC.md',
      'packages/client/src/svelte/svelte.spec.ts',
      'packages/client/src/svelte/packed.spec.ts',
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
    package: '@zmdb/client',
    entry: '@zmdb/client/vue',
    status: 'optional',
    peers: ['vue'],
    docs: 'client-vue',
    evidence: [
      'packages/client/src/vue/index.spec.ts',
      'packages/client/src/vue/index.type-test.ts',
      'packages/client/src/vue/packed-consumer.spec.ts',
      'fixtures/client-adapters/vue',
    ],
  }),
]);
