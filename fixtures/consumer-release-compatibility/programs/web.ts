import assert from 'node:assert/strict';

import { Module } from '@zmdb/app';
import { Controller, Get } from '@zmdb/web';
import { createTestApp } from '@zmdb/web/testing';

@Controller('/release')
class ReleaseController {
  @Get('/') get() {
    return { value: 'wire-π' };
  }
}
@Module({ controllers: [ReleaseController] })
class RootModule {}
const app = createTestApp(RootModule);
try {
  await app.init();
  const response = await app.request({ method: 'GET', path: '/release/', headers: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { kind: 'text', value: '{"value":"wire-π"}' });
} finally {
  await app[Symbol.asyncDispose]();
}
