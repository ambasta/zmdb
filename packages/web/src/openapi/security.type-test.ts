import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { HttpContractIR, OAuthFlows, SecurityRequirement, SecurityScheme } from '../contract/index.js';
import { toOpenApi, type OpenApiDocument, type OpenApiRenderOptions } from './index.js';

type FrozenOAuthFlow = {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
};
type FrozenImplicitFlow = FrozenOAuthFlow & { readonly authorizationUrl: string };
type FrozenPasswordFlow = FrozenOAuthFlow & { readonly tokenUrl: string };
type FrozenClientCredentialsFlow = FrozenOAuthFlow & { readonly tokenUrl: string };
type FrozenAuthorizationCodeFlow = FrozenOAuthFlow & {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
};
type FrozenAllFlows = {
  readonly implicit?: FrozenImplicitFlow;
  readonly password?: FrozenPasswordFlow;
  readonly clientCredentials?: FrozenClientCredentialsFlow;
  readonly authorizationCode?: FrozenAuthorizationCodeFlow;
};
type FrozenOAuthFlows =
  | (FrozenAllFlows & { readonly implicit: FrozenImplicitFlow })
  | (FrozenAllFlows & { readonly password: FrozenPasswordFlow })
  | (FrozenAllFlows & { readonly clientCredentials: FrozenClientCredentialsFlow })
  | (FrozenAllFlows & { readonly authorizationCode: FrozenAuthorizationCodeFlow });
type FrozenSecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer'; readonly bearerFormat?: string; readonly description?: string }
  | { readonly type: 'http'; readonly scheme: 'basic'; readonly description?: string }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | { readonly type: 'mutualTLS'; readonly description?: string }
  | { readonly type: 'oauth2'; readonly flows: FrozenOAuthFlows; readonly description?: string }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string; readonly description?: string };

export type _SecuritySchemeKinds = Expect<
  Equal<SecurityScheme['type'], 'http' | 'apiKey' | 'mutualTLS' | 'oauth2' | 'openIdConnect'>
>;
export type _BasicArm = Expect<
  Equal<keyof Extract<SecurityScheme, { readonly scheme: 'basic' }>, 'type' | 'scheme' | 'description'>
>;
export type _FrozenSecuritySchemeFits = Expect<Extends<FrozenSecurityScheme, SecurityScheme>>;
export type _FrozenOAuthFlowsFit = Expect<Extends<FrozenOAuthFlows, OAuthFlows>>;
export type _Requirement = Expect<Equal<SecurityRequirement, Readonly<Record<string, readonly string[]>>>>;
export type _OAuthNeedsOneFlow = Expect<
  Extends<
    OAuthFlows,
    | { readonly implicit: object }
    | { readonly password: object }
    | { readonly clientCredentials: object }
    | { readonly authorizationCode: object }
  >
>;

type ParametersOfRenderer = Parameters<typeof toOpenApi>;
export type _ContractInput = Expect<Equal<ParametersOfRenderer[0], HttpContractIR>>;
export type _OptionsInput = Expect<Equal<ParametersOfRenderer[1], OpenApiRenderOptions | undefined>>;
export type _OptionsKeys = Expect<Equal<keyof OpenApiRenderOptions, 'info'>>;
export type _Document = Expect<Equal<ReturnType<typeof toOpenApi>, OpenApiDocument>>;
export type _DocumentKeys = Expect<Equal<keyof OpenApiDocument, 'openapi' | 'info' | 'paths' | 'components'>>;

declare const contract: HttpContractIR;
toOpenApi(contract);
toOpenApi(contract, { info: { title: 'API', version: '1.0.0' } });

// @ts-expect-error — controller arrays are no longer an OpenAPI input
toOpenApi([]);

// @ts-expect-error — route/path schema collection was deleted with the legacy renderer
toOpenApi(contract, { schemas: {} });
