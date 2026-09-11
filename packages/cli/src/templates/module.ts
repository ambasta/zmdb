// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { TemplateFactory } from './types.js';

export const moduleTemplate: TemplateFactory = ({ name }) => ({
  files: [
    {
      path: `src/${name.fileStem}.module.ts`,
      source: `import { Module } from '@zmdb/core';
import { createToken } from '@zmdb/core/web';

export interface ${name.pascal}Status {
  readonly name: '${name.fileStem}';
  readonly ready: true;
}

export const ${name.constant}_STATUS = createToken<${name.pascal}Status>('${name.pascal}Status');

@Module({
  providers: [{ token: ${name.constant}_STATUS, useValue: { name: '${name.fileStem}', ready: true } }],
  exports: [${name.constant}_STATUS],
})
export class ${name.pascal}Module {}
`,
    },
    {
      path: `src/${name.fileStem}.module.spec.ts`,
      source: `import { createTestApp } from '@zmdb/core/testing';
import { describe, expect, it } from 'vitest';

import { ${name.constant}_STATUS, ${name.pascal}Module } from './${name.fileStem}.module.js';

describe('${name.pascal}Module', () => {
  it('registers its status provider', async () => {
    const app = createTestApp(${name.pascal}Module);
    expect(app.get(${name.constant}_STATUS)).toEqual({ name: '${name.fileStem}', ready: true });
    await app[Symbol.asyncDispose]();
  });
});
`,
    },
  ],
  instructions: [`add to src/app.module.ts, in @Module({ imports: [ … ] }):\n  ${name.pascal}Module,`],
});
