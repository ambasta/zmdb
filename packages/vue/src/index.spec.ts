import { ClientResponseError } from '@zmdb/client';
import { describe, expect, it } from 'vitest';
import { createSSRApp, effectScope } from 'vue';

import {
  assertDisposalCancellation,
  assertSsrCredentialIsolation,
  assertStaleResultSuppression,
  createAdapterClientFixture,
  rejectionOf,
} from '../../../fixtures/client-adapters/src/index.js';
import type { ApiClient, RenameWidgetInput, Widget } from '../../../fixtures/client-adapters/src/index.js';
import { createVueConformanceBinding } from '../../../fixtures/client-adapters/src/vue-binding.js';
import { createZmdbVue } from './index.js';

describe('@zmdb/vue native plugin and composables (#693)', () => {
  it('isolates clients between Vue applications', () => {
    const bindings = createZmdbVue<{ readonly name: string }>();
    const first = Object.freeze({ name: 'first' });
    const second = Object.freeze({ name: 'second' });
    const firstApp = createSSRApp({ render: () => null });
    const secondApp = createSSRApp({ render: () => null });
    firstApp.use(bindings.createZmdbPlugin(first));
    secondApp.use(bindings.createZmdbPlugin(second));

    expect(firstApp.runWithContext(() => bindings.useZmdbClient())).toBe(first);
    expect(secondApp.runWithContext(() => bindings.useZmdbClient())).toBe(second);
  });

  it('reports how to install a missing Vue plugin', () => {
    const bindings = createZmdbVue<{ readonly name: string }>();
    const app = createSSRApp({ render: () => null });

    expect(() => app.runWithContext(() => bindings.useZmdbClient())).toThrow(
      '@zmdb/vue client is unavailable; install createZmdbPlugin(client) on the current Vue app',
    );
  });

  it('onScopeDispose aborts an active request', async () => {
    await assertDisposalCancellation(createVueConformanceBinding<ApiClient>());
  });

  it('watched inputs suppress stale results', async () => {
    await assertStaleResultSuppression(createVueConformanceBinding<ApiClient>());
  });

  it('mutation errors preserve ClientResponseError identity', async () => {
    const { client, transport } = createAdapterClientFixture();
    const bindings = createZmdbVue<ApiClient>();
    const app = createSSRApp({ render: () => null });
    app.use(bindings.createZmdbPlugin(client));
    const scope = effectScope();
    const mutation = app.runWithContext(() =>
      scope.run(() =>
        bindings.useZmdbMutation<RenameWidgetInput, Widget>((api, input, signal) =>
          api.renameWidget(input, { signal }),
        ),
      ),
    );
    if (mutation === undefined) throw new Error('mutation composable did not activate');

    try {
      const operation = mutation.mutate({ id: 'one', name: 'Renamed' });
      (await transport.nextRequest()).respondJson(409, {
        code: 'conflict',
        message: 'already renamed',
      });
      const error = await rejectionOf(operation);
      expect(error).toBeInstanceOf(ClientResponseError);
      expect(mutation.error.value).toBe(error);
    } finally {
      scope.stop();
      for (const request of transport.heldRequests) {
        if (request.state === 'pending') request.fail(new Error('Vue mutation test cleanup'));
      }
      await transport.whenIdle();
    }
  });

  it('SSR application instances do not share state', async () => {
    await assertSsrCredentialIsolation(createVueConformanceBinding<ApiClient>());
  });

  it('plugin installation performs no request', () => {
    const { client, transport } = createAdapterClientFixture();
    const bindings = createZmdbVue<ApiClient>();
    const app = createSSRApp({ render: () => null });

    app.use(bindings.createZmdbPlugin(client));

    expect(transport.requests).toEqual([]);
    expect(app.runWithContext(() => bindings.useZmdbClient())).toBe(client);
  });
});
