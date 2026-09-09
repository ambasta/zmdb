// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

export { DEFAULT_MAX_ERROR_BODY_BYTES, DEFAULT_MAX_RESPONSE_BYTES, prepareClientBody } from './body/index.js';
export {
  AuthenticationError,
  ClientError,
  ClientRequestError,
  ClientResponseError,
  ClientTimeoutError,
  MissingAuthenticationError,
  ResponseDecodeError,
  ResponseTooLargeError,
  ResponseValidationError,
  TransportError,
  UnexpectedContentTypeError,
  UnexpectedStatusError,
} from './errors/index.js';
export { CLIENT_RUNTIME_ABI, createClientRuntime } from './runtime.js';
export { createFetchTransport } from './transport/index.js';
export { stringifyClientScalar, substituteClientPath } from './url/index.js';
export type {
  AuthenticationContext,
  AuthenticationPatch,
  AuthenticationProvider,
  CallOptions,
  ClientBody,
  ClientBytes,
  ClientHeaders,
  ClientOperationResponse,
  ClientOptions,
  ClientQueryPair,
  ClientRequest,
  ClientResponse,
  ClientResponseBody,
  ClientRuntime,
  ClientSecurityRequirement,
  ClientSecurityScheme,
  ClientTransport,
  ClientVersionPlan,
  DecodeResult,
  GeneratedOperation,
  PreparedClientRequest,
  ValidationIssue,
} from './types.js';
