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
import { assertSsrCredentialIsolation } from './ssr.js';
import { createSvelteAdapterConformanceBinding } from './svelte-binding.js';

const binding = createSvelteAdapterConformanceBinding();
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
