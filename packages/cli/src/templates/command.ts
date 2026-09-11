// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { TemplateFactory } from './types.js';

export const commandTemplate: TemplateFactory = ({ name }) => ({
  files: [
    {
      path: `src/${name.fileStem}.command.ts`,
      source: `import { assert } from '@zmdb/core';
import { Command } from '@zmdb/app/commands';

export interface ${name.pascal}Args {
  readonly dryRun?: boolean;
}

export let ${name.camel}Runs = 0;

@Command<${name.pascal}Args>({
  name: '${name.fileStem}',
  description: 'Run the ${name.fileStem} command',
  args: {
    type: 'object',
    properties: {
      dryRun: { type: 'boolean' },
    },
    required: [],
  },
  validate: raw => assert<${name.pascal}Args>(raw),
})
export class ${name.pascal}Command {
  run(_args: ${name.pascal}Args): number {
    ${name.camel}Runs += 1;
    return 0;
  }
}
`,
    },
    {
      path: `src/${name.fileStem}.command.spec.ts`,
      source: `import { createCommandApp } from '@zmdb/app/commands';
import { createTestApp } from '@zmdb/core/testing';
import { Module } from '@zmdb/core';
import { describe, expect, it } from 'vitest';

import {
  ${name.pascal}Command,
  ${name.camel}Runs,
} from './${name.fileStem}.command.js';

@Module({ commands: [${name.pascal}Command] })
class ${name.pascal}CommandTestModule {}

describe('${name.pascal}Command', () => {
  it('runs through the command application', async () => {
    const testApp = createTestApp(${name.pascal}CommandTestModule);
    try {
      await testApp.init();

      const commandApp = createCommandApp(${name.pascal}CommandTestModule);
      try {
        await commandApp.init();
        expect(await commandApp.run(['${name.fileStem}', '--dry-run'])).toBe(0);
        expect(${name.camel}Runs).toBe(1);
      } finally {
        await commandApp[Symbol.asyncDispose]();
      }
    } finally {
      await testApp[Symbol.asyncDispose]();
    }
  });
});
`,
    },
  ],
  instructions: [`add to src/app.module.ts, in @Module({ commands: [ … ] }):\n  ${name.pascal}Command,`],
});
