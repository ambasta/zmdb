import type { TemplateFactory } from './types.js';

export const controllerTemplate: TemplateFactory = ({ name }) => ({
  files: [
    {
      path: `src/${name.fileStem}.controller.ts`,
      source: `import { Controller, Get } from 'zmdb';

@Controller('/${name.fileStem}')
export class ${name.pascal}Controller {
  @Get()
  list(): { readonly resource: string; readonly items: readonly unknown[] } {
    return { resource: '${name.fileStem}', items: [] };
  }
}
`,
    },
    {
      path: `src/${name.fileStem}.controller.spec.ts`,
      source: `import { Module } from 'zmdb';
import { createTestApp } from 'zmdb/testing';
import { bodyText } from 'zmdb/web';
import { describe, expect, it } from 'vitest';

import { ${name.pascal}Controller } from './${name.fileStem}.controller.js';

@Module({ controllers: [${name.pascal}Controller] })
class ${name.pascal}ControllerTestModule {}

describe('${name.pascal}Controller', () => {
  it('serves its collection route', async () => {
    const app = createTestApp(${name.pascal}ControllerTestModule);
    try {
      const response = await app.request({ method: 'GET', path: '/${name.fileStem}', headers: {} });
      expect(response.status).toBe(200);
      expect(JSON.parse(await bodyText(response))).toEqual({ resource: '${name.fileStem}', items: [] });
    } finally {
      await app.close();
    }
  });
});
`,
    },
  ],
  instructions: [`add to src/app.module.ts, in @Module({ controllers: [ … ] }):\n  ${name.pascal}Controller,`],
});
