import type { Equal, Expect } from '@zmdb/schema-core';

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
