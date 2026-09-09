// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/web/app — curated HTTP application-composition facade.
export { createApp } from '@zmdb/web/app';
export type {
  OnApplicationBootstrap,
  OnModuleInit,
  OnShutdown,
  WebApplication,
  WebApplicationOptions,
} from '@zmdb/web/app';
