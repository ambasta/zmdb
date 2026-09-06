import { addPluginTemplate, defineNuxtModule, resolvePath } from 'nuxt/kit';

import { normalizeForwardNames } from './forwarding.js';

export interface ZmdbNuxtModuleOptions {
  /**
   * Application module exporting both the typed bindings and generated-client
   * factory named below.
   */
  readonly integration: string;
  readonly bindingExport?: string;
  readonly clientFactoryExport?: string;
  readonly baseUrl?: string;
  readonly forwardHeaders?: readonly string[];
  readonly forwardCookies?: readonly string[];
}

interface ResolvedModuleOptions {
  readonly integration: string;
  readonly bindingExport: string;
  readonly clientFactoryExport: string;
  readonly baseUrl: string;
  readonly forwardHeaders: readonly string[];
  readonly forwardCookies: readonly string[];
}

const IDENTIFIER = /^[$A-Z_a-z][$\w]*$/;

function requiredText(value: string | undefined, label: string): string {
  const selected = value?.trim();
  if (selected === undefined || selected.length === 0) {
    throw new Error(`@zmdb/nuxt ${label} must be a non-empty string`);
  }
  return selected;
}

function exportName(value: string | undefined, fallback: string, label: string): string {
  const selected = value ?? fallback;
  if (!IDENTIFIER.test(selected)) {
    throw new Error(`@zmdb/nuxt ${label} must be a JavaScript identifier`);
  }
  return selected;
}

async function resolvedOptions(options: ZmdbNuxtModuleOptions): Promise<ResolvedModuleOptions> {
  const integration = await resolvePath(requiredText(options.integration, 'integration module'));
  return Object.freeze({
    integration,
    bindingExport: exportName(options.bindingExport, 'zmdb', 'bindingExport'),
    clientFactoryExport: exportName(options.clientFactoryExport, 'createApiClient', 'clientFactoryExport'),
    baseUrl: requiredText(options.baseUrl ?? '/api', 'baseUrl'),
    forwardHeaders: normalizeForwardNames(options.forwardHeaders, 'header'),
    forwardCookies: normalizeForwardNames(options.forwardCookies, 'cookie'),
  });
}

function integrationImport(options: ResolvedModuleOptions): string {
  return `import { ${options.bindingExport} as zmdbBindings, ${options.clientFactoryExport} as createZmdbClient } from ${JSON.stringify(options.integration)};`;
}

function clientPlugin(options: ResolvedModuleOptions): string {
  return [
    "import { defineNuxtPlugin } from '#app';",
    "import { createZmdbNuxtClientPlugin } from '@zmdb/nuxt/client';",
    integrationImport(options),
    '',
    `export default defineNuxtPlugin(createZmdbNuxtClientPlugin(zmdbBindings, createZmdbClient, ${JSON.stringify({ baseUrl: options.baseUrl })}));`,
    '',
  ].join('\n');
}

function serverPlugin(options: ResolvedModuleOptions): string {
  return [
    "import { defineNuxtPlugin } from '#app';",
    "import { useNitroApp } from 'nitropack/runtime';",
    "import { createZmdbNuxtServerPlugin } from '@zmdb/nuxt/server';",
    integrationImport(options),
    '',
    'export default defineNuxtPlugin(',
    '  createZmdbNuxtServerPlugin(zmdbBindings, createZmdbClient, {',
    `    baseUrl: ${JSON.stringify(options.baseUrl)},`,
    `    forwardHeaders: ${JSON.stringify(options.forwardHeaders)},`,
    `    forwardCookies: ${JSON.stringify(options.forwardCookies)},`,
    '    fetch: useNitroApp().localFetch,',
    '  }),',
    ');',
    '',
  ].join('\n');
}

export const zmdbNuxtModule = defineNuxtModule<ZmdbNuxtModuleOptions>({
  meta: {
    name: '@zmdb/nuxt',
    configKey: 'zmdb',
    compatibility: {
      nuxt: '>=4.5.0 <5.0.0',
    },
  },
  async setup(options) {
    const resolved = await resolvedOptions(options);
    addPluginTemplate({
      filename: 'zmdb.client.mjs',
      getContents: () => clientPlugin(resolved),
    });
    addPluginTemplate({
      filename: 'zmdb.server.mjs',
      getContents: () => serverPlugin(resolved),
    });
  },
});

export default zmdbNuxtModule;
