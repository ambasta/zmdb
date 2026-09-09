// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Equal, type Expect } from '@zmdb/schema';

import type { HttpContractIR, HttpVersionIR } from '../contract/index.js';
import { toOpenApi, type OpenApiRenderOptions } from './index.js';

type FrozenVersion =
  | { readonly kind: 'none' }
  | { readonly kind: 'neutral' }
  | { readonly kind: 'path'; readonly value: string }
  | {
      readonly kind: 'header';
      readonly name: string;
      readonly values: readonly string[];
      readonly default: string;
    }
  | {
      readonly kind: 'media-type';
      readonly key: string;
      readonly values: readonly string[];
      readonly default: string;
    };

export type _VersionShape = Expect<Equal<HttpVersionIR, FrozenVersion>>;
export type _RenderOptionsDoNotCarryVersioning = Expect<Equal<keyof OpenApiRenderOptions, 'info'>>;

declare const contract: HttpContractIR;
toOpenApi(contract);

// @ts-expect-error — versioning belongs to each HttpOperationIR, not renderer options
toOpenApi(contract, { versioning: { kind: 'header', name: 'accept-version', default: '1' } });
