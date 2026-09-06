import { INTEGRATIONS } from './integrations.mjs';

function integration(name) {
  const record = INTEGRATIONS.find(candidate => candidate.capability === name);
  if (record === undefined || record.package === null) {
    throw new Error(`missing packaged client application integration ${name}`);
  }
  return record;
}

const support = ({ name, kind, ssr, example, packedTest }) => {
  const record = integration(name);
  return Object.freeze({
    name,
    package: record.package,
    slug: record.docs,
    kind,
    support: Object.freeze({
      csr: name === 'React Native' ? 'native' : 'yes',
      ssr: ssr ? 'yes' : 'no',
      hydration: kind === 'meta-framework' ? 'yes' : name === 'React Native' ? 'n/a' : 'framework-owned',
      cancellation: 'yes',
      nativeLifecycle: name === 'React Native' ? 'yes' : 'no',
    }),
    example,
    packedTest,
  });
};

export const CLIENT_APPLICATIONS = Object.freeze([
  support({
    name: 'React',
    kind: 'base',
    ssr: true,
    example: 'fixtures/client-adapters/docs/react.ts',
    packedTest: 'packages/react/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'Angular',
    kind: 'base',
    ssr: true,
    example: 'fixtures/client-adapters/docs/angular.ts',
    packedTest: 'packages/angular/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'Vue',
    kind: 'base',
    ssr: true,
    example: 'fixtures/client-adapters/docs/vue.ts',
    packedTest: 'packages/vue/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'Svelte',
    kind: 'base',
    ssr: true,
    example: 'fixtures/client-adapters/docs/svelte.ts',
    packedTest: 'packages/svelte/src/packed.spec.ts',
  }),
  support({
    name: 'Solid',
    kind: 'base',
    ssr: true,
    example: 'fixtures/client-adapters/docs/solid.ts',
    packedTest: 'packages/solid/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'React Native',
    kind: 'native',
    ssr: false,
    example: 'fixtures/client-adapters/docs/react-native.ts',
    packedTest: 'packages/react-native/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'Next.js',
    kind: 'meta-framework',
    ssr: true,
    example: 'fixtures/client-adapters/docs/next.ts',
    packedTest: 'packages/next/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'Nuxt',
    kind: 'meta-framework',
    ssr: true,
    example: 'fixtures/client-adapters/docs/nuxt.ts',
    packedTest: 'packages/nuxt/src/packed-consumer.spec.ts',
  }),
  support({
    name: 'SvelteKit',
    kind: 'meta-framework',
    ssr: true,
    example: 'fixtures/client-adapters/docs/sveltekit.ts',
    packedTest: 'packages/sveltekit/src/packed.spec.ts',
  }),
]);

export const RECIPE_ONLY_CLIENTS = Object.freeze(['Astro', 'Electron', 'Ember', 'Lit', 'Qwik', 'Remix']);

export const CLIENT_GUIDE_SECTIONS = Object.freeze([
  'Install',
  'Provide',
  'Query',
  'Mutate',
  'Cancellation',
  'Errors',
  'SSR',
  'Testing',
]);
