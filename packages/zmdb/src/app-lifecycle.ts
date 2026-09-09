// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app/lifecycle — curated lifecycle-hook facade.
export { runInit, runShutdown } from '@zmdb/app/lifecycle';
export type { OnApplicationBootstrap, OnModuleInit, OnShutdown } from '@zmdb/app/lifecycle';
