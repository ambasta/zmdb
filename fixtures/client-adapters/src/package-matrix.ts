export type AdapterLifecycle = 'angular' | 'react' | 'solid' | 'svelte' | 'vue';

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
  readonly qualifyingBehaviour: string;
}

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
  },
  {
    name: '@zmdb/angular',
    directory: 'angular',
    lifecycle: 'angular',
    dependencies: { '@zmdb/client': 'workspace:^' },
    peerDependencies: {
      '@angular/core': '>=22.1.0 <23.0.0',
      rxjs: '>=7.4.0 <8.0.0',
    },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Angular injector hierarchy, signals, DestroyRef cleanup and final RxJS unsubscribe',
  },
  {
    name: '@zmdb/vue',
    directory: 'vue',
    lifecycle: 'vue',
    dependencies: { '@zmdb/client': 'workspace:^' },
    peerDependencies: { vue: '>=3.5.0 <4.0.0' },
    optionalPeers: [],
    exports: ['.'],
    qualifyingBehaviour: 'Vue provide/inject, watcher scopes and per-createSSRApp isolation',
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
      '@types/react': '>=19.2.0 <20.0.0',
      react: '>=19.2.0 <20.0.0',
      'react-native': '>=0.87.0 <0.88.0',
    },
    optionalPeers: ['@types/react'],
    exports: ['.'],
    qualifyingBehaviour: 'React Native AppState, connectivity and injected credential-storage ownership',
  },
  {
    name: '@zmdb/next',
    directory: 'next',
    lifecycle: 'react',
    dependencies: {
      '@zmdb/client': 'workspace:^',
      '@zmdb/react': 'workspace:^',
    },
    peerDependencies: {
      '@types/react': '>=19.2.0 <20.0.0',
      next: '>=16.3.0 <17.0.0',
      react: '>=19.2.0 <20.0.0',
      'react-dom': '>=19.2.0 <20.0.0',
    },
    optionalPeers: ['@types/react'],
    exports: ['./client', './server'],
    qualifyingBehaviour: 'Next request-scoped RSC memoization, explicit cache policy and server/client separation',
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
  },
];
