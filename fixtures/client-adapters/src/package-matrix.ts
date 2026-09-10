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

// `name` is the specifier a consumer imports, which for the framework bindings is a
// subpath of `@zmdb/client`. `directory` is the source directory that implements it,
// and `dependencies`/`peerDependencies` are what that entry point needs rather than
// the whole publishing package's manifest.
export interface AdapterPackageExpectation {
  readonly name:
    | '@zmdb/client/angular'
    | '@zmdb/next'
    | '@zmdb/nuxt'
    | '@zmdb/client/react'
    | '@zmdb/client/react-native'
    | '@zmdb/client/solid'
    | '@zmdb/client/svelte'
    | '@zmdb/sveltekit'
    | '@zmdb/client/vue';
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
const CORE_BASELINE = 'workspace:1.0.0-beta.2';

export const ADAPTER_PACKAGES: readonly AdapterPackageExpectation[] = [
  {
    name: '@zmdb/client/react',
    directory: 'packages/client/src/react',
    lifecycle: 'react',
    dependencies: {},
    peerDependencies: { react: '>=19.2.8 <20.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'React context ownership, effect cleanup, dependency changes and StrictMode replay',
    qualification: {
      kind: 'base',
      packedTest: 'packages/client/src/react/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/src/packed-react.ts',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/src/packed-react.ts',
      sourceEvidence: [
        {
          path: 'packages/client/src/react/index.ts',
          markers: ['createContext', 'useEffect', 'AbortController'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/client/angular',
    directory: 'packages/client/src/angular',
    lifecycle: 'angular',
    dependencies: {},
    peerDependencies: {
      '@angular/core': '>=22.1.5 <23.0.0',
      rxjs: '>=7.8.2 <8.0.0',
    },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Angular injector hierarchy, signals, DestroyRef cleanup and final RxJS unsubscribe',
    qualification: {
      kind: 'base',
      packedTest: 'packages/client/src/angular/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/angular',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/angular/conformance-runner.ts',
      sourceEvidence: [
        {
          path: 'packages/client/src/angular/index.ts',
          markers: ['InjectionToken', 'DestroyRef', 'Observable'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/client/vue',
    directory: 'packages/client/src/vue',
    lifecycle: 'vue',
    dependencies: {},
    peerDependencies: { vue: '>=3.5.42 <4.0.0' },
    optionalPeers: [],
    exports: ['.'],
    allowedImportGlobals: ['__VUE_HMR_RUNTIME__', '__VUE_INSTANCE_SETTERS__', '__VUE_SSR_SETTERS__'],
    qualifyingBehaviour: 'Vue provide/inject, watcher scopes and per-createSSRApp isolation',
    qualification: {
      kind: 'base',
      packedTest: 'packages/client/src/vue/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/vue',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/src/packed-vue.ts',
      sourceEvidence: [
        {
          path: 'packages/client/src/vue/index.ts',
          markers: ['InjectionKey', 'watch(', 'onScopeDispose'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/client/svelte',
    directory: 'packages/client/src/svelte',
    lifecycle: 'svelte',
    dependencies: {},
    peerDependencies: { svelte: '>=5.57.0 <6.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Svelte typed context, lazy subscription and final-subscriber teardown',
    qualification: {
      kind: 'base',
      packedTest: 'packages/client/src/svelte/packed.spec.ts',
      fixture: 'fixtures/client-adapters/svelte-packed',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'fixtures/client-adapters/src/packed-svelte.ts',
      sourceEvidence: [
        {
          path: 'packages/client/src/svelte/query.ts',
          markers: ['subscribers', 'subscribe(run, invalidate)', 'if (subscribers === 0)'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/client/solid',
    directory: 'packages/client/src/solid',
    lifecycle: 'solid',
    dependencies: {},
    peerDependencies: { 'solid-js': '>=1.9.15 <2.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Solid owner disposal, resources, Suspense and error-boundary propagation',
    qualification: {
      kind: 'base',
      packedTest: 'packages/client/src/solid/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/src/solid-binding.ts',
      generatedClient: GENERATED_CLIENT,
      commonConformance: 'packages/client/src/solid/packed-consumer.spec.ts',
      sourceEvidence: [
        {
          path: 'packages/client/src/solid/index.ts',
          markers: ['createContext', 'createResource', 'onCleanup'],
        },
      ],
      ssr: true,
    },
  },
  {
    name: '@zmdb/client/react-native',
    directory: 'packages/client/src/react-native',
    lifecycle: 'react',
    dependencies: {},
    peerDependencies: {
      react: '>=19.2.8 <20.0.0',
      'react-native': '>=0.87.1 <0.88.0',
    },
    optionalPeers: [],
    exports: ['.'],
    importProbePeers: ['react'],
    qualifyingBehaviour: 'React Native AppState, connectivity and injected credential-storage ownership',
    qualification: {
      kind: 'native',
      packedTest: 'packages/client/src/react-native/packed-consumer.spec.ts',
      fixture: 'fixtures/client-adapters/src/packed-react-native.ts',
      generatedClient: GENERATED_CLIENT,
      sourceEvidence: [
        {
          path: 'packages/client/src/react-native/index.ts',
          markers: ['addEventListener', 'backgroundPolicy', 'connectivity'],
        },
      ],
      ssr: false,
    },
  },
  {
    name: '@zmdb/next',
    directory: 'packages/next',
    lifecycle: 'react',
    dependencies: {
      '@zmdb/client': CORE_BASELINE,
      'server-only': '0.0.1',
    },
    peerDependencies: {
      next: '>=16.3.4 <17.0.0',
      react: '>=19.2.8 <20.0.0',
      'react-dom': '>=19.2.8 <20.0.0',
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
    directory: 'packages/nuxt',
    lifecycle: 'vue',
    dependencies: { '@zmdb/client': CORE_BASELINE },
    peerDependencies: {
      nuxt: '>=4.5.2 <5.0.0',
      vue: '>=3.5.42 <4.0.0',
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
    directory: 'packages/sveltekit',
    lifecycle: 'svelte',
    dependencies: { '@zmdb/client': CORE_BASELINE },
    peerDependencies: {
      '@sveltejs/kit': '>=2.70.3 <3.0.0',
      svelte: '>=5.57.0 <6.0.0',
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
