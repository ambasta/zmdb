// @zmdb/web/contract — inert HTTP declarations and the serialisable contract IR.
//
// This runtime entry deliberately imports only types. The compiler-backed collector
// lives at ./compiler so an application that only registers an already-compiled
// contract never reaches TypeScript, the filesystem, or a reflection session.

import type { JsonValue as SchemaJsonValue, TypeIR } from '@zmdb/schema-core/ir';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type JsonValue = SchemaJsonValue;

/** A controller class recorded by a declaration and instantiated by the application. */
export type HttpController = abstract new (...args: never[]) => object;

export interface HttpOperationTypes {
  readonly path?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly cookies?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly responses: Readonly<
    Record<number, { readonly body: unknown; readonly headers?: Readonly<Record<string, unknown>> }>
  >;
}

type PropertiesAt<
  Types extends HttpOperationTypes,
  Location extends 'path' | 'query' | 'headers' | 'cookies',
> = keyof NonNullable<Types[Location]> & string;

export type HttpParameterDeclaration<Types extends HttpOperationTypes = HttpOperationTypes> =
  | {
      readonly in: 'path';
      readonly property: PropertiesAt<Types, 'path'>;
      readonly name: string;
    }
  | {
      readonly in: 'query';
      readonly property: PropertiesAt<Types, 'query'>;
      readonly name: string;
    }
  | {
      readonly in: 'header';
      readonly property: PropertiesAt<Types, 'headers'>;
      readonly name: string;
    }
  | {
      readonly in: 'cookie';
      readonly property: PropertiesAt<Types, 'cookies'>;
      readonly name: string;
    };

export type HttpBodyDeclaration =
  | { readonly kind: 'json'; readonly mediaType: string }
  | { readonly kind: 'text' | 'bytes' | 'stream'; readonly mediaType: string }
  | { readonly kind: 'empty' };

export type HttpRequestBodyDeclaration = Exclude<HttpBodyDeclaration, { readonly kind: 'empty' }> & {
  readonly required: boolean;
};

export interface HttpResponseHeaderDeclaration {
  readonly property: string;
  readonly name: string;
  readonly description?: string;
}

export interface HttpResponseDeclaration {
  readonly description: string;
  readonly headers?: readonly HttpResponseHeaderDeclaration[];
  readonly body: HttpBodyDeclaration;
  /** Per-version response bodies for media-type versioning. */
  readonly versions?: Readonly<Record<string, HttpBodyDeclaration>>;
}

export type HttpVersionDeclaration =
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

export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

export interface OAuthFlow {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}

export interface ImplicitFlow extends OAuthFlow {
  readonly authorizationUrl: string;
}

export interface PasswordFlow extends OAuthFlow {
  readonly tokenUrl: string;
}

export interface ClientCredentialsFlow extends OAuthFlow {
  readonly tokenUrl: string;
}

export interface AuthorizationCodeFlow extends OAuthFlow {
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
}

interface AllOAuthFlows {
  readonly implicit?: ImplicitFlow;
  readonly password?: PasswordFlow;
  readonly clientCredentials?: ClientCredentialsFlow;
  readonly authorizationCode?: AuthorizationCodeFlow;
}

export type OAuthFlows =
  | (AllOAuthFlows & { readonly implicit: ImplicitFlow })
  | (AllOAuthFlows & { readonly password: PasswordFlow })
  | (AllOAuthFlows & { readonly clientCredentials: ClientCredentialsFlow })
  | (AllOAuthFlows & { readonly authorizationCode: AuthorizationCodeFlow });

export type SecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'bearer'; readonly bearerFormat?: string; readonly description?: string }
  | { readonly type: 'http'; readonly scheme: 'basic'; readonly description?: string }
  | {
      readonly type: 'apiKey';
      readonly in: 'header' | 'query' | 'cookie';
      readonly name: string;
      readonly description?: string;
    }
  | { readonly type: 'mutualTLS'; readonly description?: string }
  | { readonly type: 'oauth2'; readonly flows: OAuthFlows; readonly description?: string }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string; readonly description?: string };

export interface HttpOperationDeclaration<
  Types extends HttpOperationTypes = HttpOperationTypes,
  Controller extends HttpController = HttpController,
  Handler extends string = string,
> {
  readonly controller: Controller;
  readonly handler: Handler;
  readonly method: HttpMethod;
  readonly path: string;
  readonly parameters: readonly HttpParameterDeclaration<Types>[];
  readonly requestBody?: HttpRequestBodyDeclaration;
  readonly responses: Readonly<Record<keyof Types['responses'] & number, HttpResponseDeclaration>>;
  readonly security: readonly SecurityRequirement[];
  readonly version: HttpVersionDeclaration;
  readonly deprecated: boolean;
}

export interface HttpContractDeclaration<
  Operations extends Readonly<Record<string, HttpOperationDeclaration>> = Readonly<
    Record<string, HttpOperationDeclaration>
  >,
> {
  readonly operations: Operations;
  readonly securitySchemes: Readonly<Record<string, SecurityScheme>>;
}

/**
 * Record one operation without registering a route or retaining its generic type.
 *
 * The generic argument is recovered only by the build-time compiler subpath.
 */
export function httpOperation<Types extends HttpOperationTypes>(
  declaration: HttpOperationDeclaration<Types>,
): HttpOperationDeclaration<Types> {
  return Object.freeze(declaration);
}

/** Define one inert contract module. The object keys are the public operation IDs. */
export function defineHttpContract<const Operations extends Readonly<Record<string, HttpOperationDeclaration>>>(
  declaration: HttpContractDeclaration<Operations>,
): HttpContractDeclaration<Operations> {
  return Object.freeze({
    operations: Object.freeze({ ...declaration.operations }),
    securitySchemes: Object.freeze({ ...declaration.securitySchemes }),
  });
}

export interface HttpTypeIR {
  readonly type: TypeIR;
  readonly openApi: Readonly<Record<string, JsonValue>>;
}

export interface HttpContractIR {
  readonly format: 1;
  readonly types: Readonly<Record<string, HttpTypeIR>>;
  readonly operations: readonly HttpOperationIR[];
  readonly securitySchemes: Readonly<Record<string, SecurityScheme>>;
}

export interface HttpOperationIR {
  readonly operationId: string;
  readonly controller: string;
  readonly handler: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly parameters: readonly HttpParameterIR[];
  readonly requestBody?: HttpRequestBodyIR;
  readonly responses: readonly HttpResponseIR[];
  readonly security: readonly SecurityRequirement[];
  readonly version: HttpVersionIR;
  readonly deprecated: boolean;
}

export interface HttpParameterIR {
  readonly property: string;
  readonly name: string;
  readonly in: 'path' | 'query' | 'header' | 'cookie';
  readonly required: boolean;
  readonly typeId: string;
}

export type HttpBodyKind = 'json' | 'text' | 'bytes' | 'stream' | 'empty';

export type HttpBodyIR =
  | { readonly kind: 'json'; readonly mediaType: string; readonly typeId: string }
  | { readonly kind: 'text' | 'bytes' | 'stream'; readonly mediaType: string }
  | { readonly kind: 'empty' };

export type HttpRequestBodyIR = Exclude<HttpBodyIR, { readonly kind: 'empty' }> & {
  readonly required: boolean;
};

export interface HttpResponseIR {
  readonly status: number;
  readonly description: string;
  readonly headers: readonly HttpResponseHeaderIR[];
  readonly body: HttpBodyIR;
  readonly versions?: Readonly<Record<string, HttpBodyIR>>;
}

export interface HttpResponseHeaderIR {
  readonly property: string;
  readonly name: string;
  readonly description?: string;
  readonly required: boolean;
  readonly typeId: string;
}

export type HttpVersionIR = HttpVersionDeclaration;

/** Runtime binding kept separate from the serialisable IR. */
export interface CompiledHttpOperation {
  readonly operation: HttpOperationIR;
  readonly controller: HttpController;
  readonly handler: string;
}

/** One compilation result shared by runtime routing and later artifact emitters. */
export interface CompiledHttpContract {
  readonly ir: HttpContractIR;
  readonly operations: readonly CompiledHttpOperation[];
  /** Project-source inputs whose changes can alter this compilation. */
  readonly dependencies: readonly string[];
}
