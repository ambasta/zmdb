// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app/cqrs — curated command-bus facade.
export { createCommandBus } from '@zmdb/app/cqrs';
export type {
  CommandBus,
  CommandBusOptions,
  CommandHandlers,
  CommandMap,
  CommandOutcome,
  CommandRun,
} from '@zmdb/app/cqrs';
