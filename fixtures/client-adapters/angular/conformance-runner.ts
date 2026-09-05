import { createAngularConformanceBinding } from './conformance/angular-binding.js';
import {
  assertClientResponseErrorIdentity,
  assertDisposalCancellation,
  assertIndependentMutations,
  assertNoImplicitRetry,
  assertNoRequestBeforeMount,
  assertOpaqueGeneratedClient,
  assertPendingAndSuccess,
  assertProtocolErrorIdentity,
  assertStaleResultSuppression,
  assertValidationErrorIdentity,
} from './conformance/conformance-cases.js';
import type { ApiClient } from './conformance/generated/api.generated.js';
import { ADAPTER_PACKAGES } from './conformance/package-matrix.js';
import { assertSsrCredentialIsolation } from './conformance/ssr.js';

const expectation = ADAPTER_PACKAGES.find(candidate => candidate.name === '@zmdb/angular');
if (expectation === undefined) throw new Error('packed fixture has no @zmdb/angular expectation');
const binding = createAngularConformanceBinding<ApiClient>(expectation);

await assertNoRequestBeforeMount(binding);
await assertPendingAndSuccess(binding);
await assertDisposalCancellation(binding);
await assertStaleResultSuppression(binding);
await assertClientResponseErrorIdentity(binding);
await assertProtocolErrorIdentity(binding);
await assertValidationErrorIdentity(binding);
await assertNoImplicitRetry(binding);
await assertOpaqueGeneratedClient(binding);
await assertIndependentMutations(binding);
await assertSsrCredentialIsolation(binding);

process.stdout.write('11 packed Angular conformance cases passed');
