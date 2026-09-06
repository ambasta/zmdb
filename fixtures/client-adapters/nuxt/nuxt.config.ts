import zmdbNuxt from '@zmdb/nuxt';
import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  compatibilityDate: '2026-09-06',
  devtools: { enabled: false },
  modules: [
    [
      zmdbNuxt,
      {
        integration: './app/zmdb.ts',
        baseUrl: '/api',
        forwardHeaders: ['authorization'],
        forwardCookies: ['session'],
      },
    ],
  ],
  nitro: {
    preset: 'node-server',
  },
});
