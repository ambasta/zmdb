import assert from 'node:assert/strict';

import { createEnvironmentInjector, runInInjectionContext, Injector, type EnvironmentInjector } from '@angular/core';
import { createZmdbAngular } from '@zmdb/angular';
import { firstValueFrom } from 'rxjs';

const bindings = createZmdbAngular<{ readonly value: string }>();
const parent = createEnvironmentInjector([], Injector.NULL as EnvironmentInjector);
const injector = createEnvironmentInjector([bindings.provideZmdbClient({ value: 'wire-π' })], parent);
try {
  const result = runInInjectionContext(injector, () =>
    firstValueFrom(
      bindings.zmdbObservable(2, (client, count, signal) => {
        assert.equal(signal.aborted, false);
        return Promise.resolve(client.value.repeat(count));
      }),
    ),
  );
  assert.equal(await result, 'wire-πwire-π');
} finally {
  injector.destroy();
  parent.destroy();
}
