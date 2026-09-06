export type AdapterLifecycle = 'angular' | 'react' | 'solid' | 'svelte' | 'vue';

export interface AdapterQualificationSourceEvidence {
  readonly path: string;
  readonly markers: readonly string[];
}

export interface AdapterBrowserBoundaryEvidence {
  readonly clientEntry: string;
  readonly serverEntry: string;
  readonly packedVerifier: string;
  readonly forbiddenBrowserTokens: readonly string[];
}

export interface AdapterQualificationEvidence {
  readonly kind: 'base' | 'meta-framework' | 'native';
  readonly packedTest: string;
  readonly fixture: string;
  readonly generatedClient: string;
  readonly generatedClientCopies?: readonly string[];
  readonly commonConformance?: string;
  readonly sourceEvidence: readonly AdapterQualificationSourceEvidence[];
  readonly ssr: boolean;
  readonly browserBoundary?: AdapterBrowserBoundaryEvidence;
}

export interface AdapterPackageExpectation {
  readonly name:
    | '@zmdb/angular'
    | '@zmdb/next'
    | '@zmdb/nuxt'
    | '@zmdb/react'
    | '@zmdb/react-native'
    | '@zmdb/solid'
    | '@zmdb/svelte'
    | '@zmdb/sveltekit'
    | '@zmdb/vue';
  readonly directory: string;
  readonly lifecycle: AdapterLifecycle;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly optionalPeers: readonly string[];
  readonly exports: readonly string[];
  readonly importProbePeers?: readonly string[];
  readonly allowedImportGlobals?: readonly string[];
  readonly qualifyingBehaviour: string;
  readonly qualification: AdapterQualificationEvidence;
}

const GENERATED_CLIENT = 'fixtures/client-adapters/src/generated/api.generated.ts';

export const ADAPTER_PACKAGES: readonly AdapterPackageExpectation[] = [
  {
    name: '@zmdb/react',
    directory: 'react',
    lifecycle: 'react',
    dependencies: { '@zmdb/client': 'workspace:^' },
    peerDependencies: { react: '>=19.2.0 <20.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'React context ownership, effect cleanup, dependency changes and StrictMode replay',
    qualification: {
      kind: 'base',
      packedTest: 'packages/react/src/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/src/packed-react.ts',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/src/packed-react.ts',
      sourceEvidence: [
        {
          path: 'packages/react/src/index.ts',
          markers: ['createContext', 'useEffect', 'AbortController'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/angular',
    directory: 'angular',
    lifecycle: 'angular',
    dependencies: {},
    peerDependencies: {
      '@angular/core': '>=22.1.0 <23.0.0',
      rxjs: '>=7.4.0 <8.0.0',
    },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Angular injector hierarchy, signals, DestroyRef cleanup and final RxJS unsubscribe',
    qualification: {
      kind: 'base',
      packedTest: 'packages/angular/src/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/angular',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/angular/conformance-runner.ts',
      sourceEvidence: [
        {
          path: 'packages/angular/src/index.ts',
          markers: ['InjectionToken', 'DestroyRef', 'Observable'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/vue',
    directory: 'vue',
    lifecycle: 'vue',
    dependencies: { '@zmdb/client': 'workspace:^' },
    peerDependencies: { vue: '>=3.5.0 <4.0.0' },
    optionalPeers: [],
    exports: ['.'],
    allowedImportGlobals: ['__VUE_HMR_RUNTIME__', '__VUE_INSTANCE_SETTERS__', '__VUE_SSR_SETTERS__'],
    qualifyingBehaviour: 'Vue provide/inject, watcher scopes and per-createSSRApp isolation',
    qualification: {
      kind: 'base',
      packedTest: 'packages/vue/src/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/vue',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/src/packed-vue.ts',
      sourceEvidence: [
        {
          path: 'packages/vue/src/index.ts',
          markers: ['InjectionKey', 'watch(', 'onScopeDispose'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/svelte',
    directory: 'svelte',
    lifecycle: 'svelte',
    dependencies: { '@zmdb/client': 'workspace:^' },
    peerDependencies: { svelte: '>=5.0.0 <6.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Svelte typed context, lazy subscription and final-subscriber teardown',
    qualification: {
      kind: 'base',
      packedTest: 'packages/svelte/src/packed.spec.ts',
      fixture: 'fixtures/client-adapters/svelte-packed',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/src/packed-svelte.ts',
      sourceEvidence: [
        {
          path: 'packages/svelte/src/query.ts',
          markers: ['subscribers', 'subscribe(run, invalidate)', 'if (subscribers === 0)'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/solid',
    directory: 'solid',
    lifecycle: 'solid',
    dependencies: { '@zmdb/client': 'workspace:^' },
    peerDependencies: { 'solid-js': '>=1.9.0 <2.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Solid owner disposal, resources, Suspense and error-boundary propagation',
    qualification: {
      kind: 'base',
      packedTest: 'packages/solid/src/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/src/solid-binding.ts',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'packages/solid/src/packed-consumer.spec.ts',
      sourceEvidence: [
        {
          path: 'packages/solid/src/index.ts',
          markers: ['createContext', 'createResource', 'onCleanup'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/react-native',
    directory: 'react-native',
    lifecycle: 'react',
    dependencies: {
      '@zmdb/client': 'workspace:^',
      '@zmdb/react': 'workspace:^',
    },
    peerDependencies: {
      react: '>=19.2.0 <20.0.0',
      'react-native': '>=0.87.0 <0.88.0',
    },
    optionalPeers: [],
    exports: ['.'],
    importProbePeers: ['react'],
    qualifyingBehaviour: 'React Native AppState, connectivity and injected credential-storage ownership',
    qualification: {
      kind: 'native',
      packedTest: 'packages/react-native/src/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/src/packed-react-native.ts',
      generatedClient: GENERATED_CLIENT,
      sourceEvidence: [
        {
          path: 'packages/react-native/src/index.ts',
          markers: ['addEventListener', 'backgroundPolicy', 'connectivity'],
        },
      ],
      ssr: false,
    },
  },
  {
    name: '@zmdb/next',
    directory: 'next',
    lifecycle: 'react',
    dependencies: {
      '@zmdb/client': 'workspace:^',
      '@zmdb/react': 'workspace:^',
      'server-only': '0.0.1',
    },
    peerDependencies: {
      next: '>=16.3.0 <17.0.0',
      react: '>=19.2.0 <20.0.0',
      'react-dom': '>=19.2.0 <20.0.0',
    },
    optionalPeers: [],
    exports: ['./client', './server'],
    qualifyingBehaviour: 'Next request-scoped RSC memoization, explicit cache policy and server/client separation',
    qualification: {
      kind: 'meta-framework',
      packedTest: 'packages/next/src/packed-consumer.spec.ts',
      fixture: 'fixtures/next-app-router',
      generatedClient: GENERATED_CLIENT,
      generatedClientCopies: ['fixtures/next-app-router/lib/api.generated.ts'],
      sourceEvidence: [
        {
          path: 'packages/next/src/server-runtime.ts',
          markers: ['memoize<', 'requestFetch(', 'forwardedHeaders('],
        },
      ],
      ssr: true,
      browserBoundary: {
        clientEntry: 'packages/next/src/client.ts',
        serverEntry: 'packages/next/src/server.ts',
        packedVerifier: 'fixtures/next-app-router/verify-runtime.mjs',
        forbiddenBrowserTokens: ['@zmdb/next/server', 'createNextServerClient'],
      },
    },
  },
  {
    name: '@zmdb/nuxt',
    directory: 'nuxt',
    lifecycle: 'vue',
    dependencies: {
      '@zmdb/client': 'workspace:^',
      '@zmdb/vue': 'workspace:^',
    },
    peerDependencies: {
      nuxt: '>=4.5.0 <5.0.0',
      vue: '>=3.5.0 <4.0.0',
    },
    optionalPeers: [],
    exports: ['.', './client', './server'],
    qualifyingBehaviour: 'Nuxt Nitro request transport, plugin injection and useAsyncData hydration',
    qualification: {
      kind: 'meta-framework',
      packedTest: 'packages/nuxt/src/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/nuxt',
      generatedClient: GENERATED_CLIENT,
      sourceEvidence: [
        {
          path: 'packages/nuxt/src/client/index.ts',
          markers: ['useAsyncData', 'createNuxtDataKey', "dedupe: 'cancel'"],
        },
        {
          path: 'packages/nuxt/src/server/index.ts',
          markers: ['createNuxtServerTransport', 'forwardedHeaders(', 'requestFetch'],
        },
      ],
      ssr: true,
      browserBoundary: {
        clientEntry: 'packages/nuxt/src/client/index.ts',
        serverEntry: 'packages/nuxt/src/server/index.ts',
        packedVerifier: 'fixtures/client-adapters/nuxt/verify-built.mjs',
        forbiddenBrowserTokens: ['@zmdb/nuxt/server', 'createNuxtServerTransport', 'createZmdbNuxtServerPlugin'],
      },
    },
  },
  {
    name: '@zmdb/sveltekit',
    directory: 'sveltekit',
    lifecycle: 'svelte',
    dependencies: {
      '@zmdb/client': 'workspace:^',
      '@zmdb/svelte': 'workspace:^',
    },
    peerDependencies: {
      '@sveltejs/kit': '>=2.70.0 <3.0.0',
      svelte: '>=5.0.0 <6.0.0',
    },
    optionalPeers: [],
    exports: ['./client', './server'],
    qualifyingBehaviour: 'SvelteKit RequestEvent.fetch, request-local load and navigation cancellation',
    qualification: {
      kind: 'meta-framework',
      packedTest: 'packages/sveltekit/src/packed.spec.ts',
      fixture: 'fixtures/client-adapters/sveltekit-packed',
      generatedClient: GENERATED_CLIENT,
      sourceEvidence: [
        {
          path: 'packages/sveltekit/src/client.ts',
          markers: ['createSvelteKitNavigationScope', 'navigation.complete', 'createSvelteKitClientLoad'],
        },
        {
          path: 'packages/sveltekit/src/server.ts',
          markers: ['event.fetch', 'createSvelteKitServerClient', 'createSvelteKitServerLoad'],
        },
      ],
      ssr: true,
      browserBoundary: {
        clientEntry: 'packages/sveltekit/src/client.ts',
        serverEntry: 'packages/sveltekit/src/server.ts',
        packedVerifier: 'fixtures/client-adapters/sveltekit-packed/verify-boundary.mjs',
        forbiddenBrowserTokens: ['@zmdb/sveltekit/server', 'createSvelteKitServerClient', 'createSvelteKitServerLoad'],
      },
    },
  },
];
