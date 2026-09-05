import { Injector, createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import type { EnvironmentInjector } from '@angular/core';
import { createZmdbAngular } from '@zmdb/angular';

interface Widget {
  readonly id: string;
  readonly name: string;
}

interface BrowserClient {
  getWidget(input: { readonly id: string }, options: { readonly signal: AbortSignal }): Promise<Widget>;
}

interface PendingRequest {
  readonly signal: AbortSignal;
  resolve(value: Widget): void;
}

const bindings = createZmdbAngular<BrowserClient>('packed browser client');
const pending: PendingRequest[] = [];
const client: BrowserClient = {
  getWidget(_input, options) {
    return new Promise<Widget>(resolve => {
      pending.push({ signal: options.signal, resolve });
    });
  },
};
const parent = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector, 'packed-browser-parent');
const owner = createEnvironmentInjector([bindings.provideZmdbClient(client)], parent, 'packed-browser-owner');

try {
  const query = runInInjectionContext(owner, () =>
    bindings.zmdbQuery({ id: 'browser' }, (api, input, signal) => api.getWidget(input, { signal })),
  );
  if (!query.loading() || pending.length !== 1) throw new Error('packed browser query did not activate');
  pending[0]?.resolve({ id: 'browser', name: 'Browser' });
  await Promise.resolve();
  await Promise.resolve();
  if (query.loading() || query.data()?.name !== 'Browser') {
    throw new Error('packed browser signals did not publish success');
  }

  const observable = runInInjectionContext(owner, () =>
    bindings.zmdbObservable({ id: 'observable' }, (api, input, signal) => api.getWidget(input, { signal })),
  );
  const subscription = observable.subscribe();
  const observableRequest = pending[1];
  if (observableRequest === undefined) throw new Error('packed browser Observable did not activate');
  subscription.unsubscribe();
  if (!observableRequest.signal.aborted) throw new Error('packed browser unsubscribe did not abort');

  runInInjectionContext(owner, () =>
    bindings.zmdbQuery({ id: 'destroy' }, (api, input, signal) => api.getWidget(input, { signal })),
  );
  const destroyRequest = pending[2];
  if (destroyRequest === undefined) throw new Error('packed browser destroy query did not activate');
  owner.destroy();
  if (!destroyRequest.signal.aborted) throw new Error('packed browser DestroyRef did not abort');

  console.log('browser Angular lifecycle passed');
} finally {
  if (!owner.destroyed) owner.destroy();
  parent.destroy();
}

export const browserClientToken = bindings.ZMDB_CLIENT;
