// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/web/contract/compiler — curated build-time re-export.
export { compileHttpContracts, generateHttpClient, HTTP_CLIENT_GENERATOR_VERSION } from '@zmdb/web/contract/compiler';
export type {
  CompileHttpContractsOptions,
  GeneratedHttpClientModule,
  HttpContractSource,
} from '@zmdb/web/contract/compiler';
