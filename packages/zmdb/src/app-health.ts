// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/app/health — curated protocol-neutral health facade.
export { databaseReadinessCheck } from '@zmdb/app/health';
export type {
  CheckResult,
  DatabaseReadinessOptions,
  DetailedCheck,
  HealthChecks,
  LivenessCheck,
  ReadinessCheck,
} from '@zmdb/app/health';
