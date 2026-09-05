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
} from './conformance-cases.js';
import type { ApiClient } from './generated/api.generated.js';
import { createReactConformanceBinding } from './react-binding.js';
import { assertSsrCredentialIsolation } from './ssr.js';

const binding = createReactConformanceBinding<ApiClient>();
const cases = [
  () => assertNoRequestBeforeMount(binding),
  () => assertPendingAndSuccess(binding),
  () => assertDisposalCancellation(binding),
  () => assertStaleResultSuppression(binding),
  () => assertClientResponseErrorIdentity(binding),
  () => assertProtocolErrorIdentity(binding),
  () => assertValidationErrorIdentity(binding),
  () => assertNoImplicitRetry(binding),
  () => assertOpaqueGeneratedClient(binding),
  () => assertIndependentMutations(binding),
  () => assertSsrCredentialIsolation(binding),
];

for (const run of cases) await run();

process.stdout.write(
  JSON.stringify({
    package: binding.package.name,
    cases: cases.length,
    source: 'packed-tarballs',
  }),
);
