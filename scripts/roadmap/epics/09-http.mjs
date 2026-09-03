// Browser-facing HTTP. Everything in the first epic is blocked on one line of code:
// `WebResponse.body` is a `string`. The second epic is the OpenAPI document catching up with what a
// real API needs to describe.

export const HTTP_EPICS = [
  {
    key: 'responses',
    title:
      '[EPIC] Streaming responses, and everything that depends on them — compression, static files, uploads, templates, CSRF',
    labels: ['enhancement', 'area:web', 'parity:nestjs'],
    pages: [
      'web-streaming-files',
      'web-compression',
      'web-static-files',
      'web-file-upload',
      'web-templates',
      'web-csrf',
    ],
    packages: ['@zmdb/web'],
    motivation: `
Two of the six page notes name the same root cause, and they are worth reading together: "WebResponse.body
is a string, so a response cannot be a stream" and "depends on streaming responses, which WebResponse does
not model".

They are literally true. \`WebResponse\` is \`{ status: number; body: string; headers }\`
(packages/web/src/pipeline/index.ts:31–35). A response body is a fully materialised string before it
reaches the adapter. So a file download reads the whole file into memory; a large export builds the
whole payload before the first byte ships; and compression has nothing to compress incrementally. For a
sizeable download that is not slow, it is a memory-exhaustion bug reachable by a normal request — and
worse, by a request an attacker can repeat.

Static files add a second hazard of their own: a static handler is where path traversal lives. Any
implementation has to resolve and confine paths rather than concatenate them, and has to consider
symlinks, URL-encoded traversal sequences, Windows separators and null bytes. Similarly file upload —
"multipart/form-data parsing is not shipped" — is where unbounded input arrives: part count, part size,
total size, filename sanitisation and content-type trust are all limits that must exist before the
feature is usable in public.

CSRF and templates are the smaller two, but they belong here because both are about serving browsers
rather than API clients, and CSRF only makes sense once there is a cookie-session-shaped surface to
protect. Templates are the only genuinely optional one, and it is worth asking whether it should ship at
all rather than assuming it should.

The right order is forced: change the response model first, with the existing string case preserved, and
then the other five become tractable. That is what makes this one epic and not six.
`,
    dod: [
      '`WebResponse` models a string, a byte buffer and a stream, with the existing string path unchanged for every current caller.',
      'Streaming works end to end through the Node adapter and the fetch adapter, with backpressure honoured and cleanup on client disconnect.',
      'Compression negotiates an encoding and compresses incrementally, with a documented policy on what is not compressed.',
      'A static file handler serves files with correct caching headers and cannot be made to serve a file outside its root by any traversal technique.',
      'Multipart uploads parse with mandatory limits on part count, part size and total size, and a defined behaviour when a limit is hit.',
      'CSRF protection is available for cookie-authenticated routes, with a documented threat model and no protection theatre.',
      'A view engine integration ships or is explicitly declined with a reason.',
      'All six pages flip to supported, or the templates page carries a documented decision.',
    ],
    invariants: [
      '§1 cost model: streaming must not add per-response allocation for the common small-JSON case. The string path stays the fast path.',
      '§2.5 no `as`: the response body becomes a discriminated union narrowed by its tag, not a value cast at the adapter.',
      '§2.3 validation at the boundary: an uploaded filename, a static path segment and a template variable are all untrusted input.',
      '§2.7 no hidden state: a CSRF token store is app-owned, not module-level.',
      'Bounded by construction: every limit in the upload and streaming paths has a safe default that cannot be removed, only raised.',
      'The existing string-response behaviour is preserved byte for byte. This epic changes what is possible, not what already happens.',
    ],
    nonGoals: [
      'A session implementation. CSRF assumes a session exists; providing one is a separate question.',
      'An image or asset pipeline.',
      'Bundling a template engine. At most, an integration seam.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the response body union, and the limits and threat models for all five consumers',
        labels: ['spec'],
        goal: 'Freeze the new `WebResponse` body model and its adapter contract, then the static-file confinement rules, the upload limits, the compression policy, the CSRF threat model, and a decision on templates. No code.',
        why: 'The response model is a change to a core type used by every adapter, the testing harness and every exception filter, so its shape needs to be settled once. The other five each have a security-relevant decision that belongs in a spec rather than in a code review: confinement, limits, and what CSRF actually defends against.',
        files: [
          '`packages/web/src/pipeline/SPEC.md` — the response model.',
          '`packages/web/src/static/SPEC.md`, `packages/web/src/upload/SPEC.md`, `packages/web/src/csrf/SPEC.md` (new)',
        ],
        api: `
export type ResponseBody =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'bytes'; readonly value: Uint8Array }
  | { readonly kind: 'stream'; readonly value: ReadableStream<Uint8Array>; readonly length?: number };

export interface WebResponse {
  readonly status: number;
  readonly body: ResponseBody;
  readonly headers: Readonly<Record<string, string>>;
}

export declare function stream(body: ReadableStream<Uint8Array>, options?: ResponseOptions): WebResponse;
export declare function file(path: string, options?: FileResponseOptions): Promise<WebResponse>;

export interface UploadLimits {
  readonly maxParts: number;        // defaulted, not optional in effect
  readonly maxPartBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFieldNameBytes: number;
}
`,
        steps: [
          'Specify the body union and how the existing helpers (`json`, `text` at packages/web/src/pipeline/index.ts:129,142) map onto it. The user has said backwards compatibility is not a concern, so prefer the clean union over a `string | ResponseBody` hybrid — but specify that the *behaviour* of existing responses is unchanged, which is a different promise and one worth keeping.',
          'Specify the adapter contract for each kind, for both the Node adapter (`send`, pipeline/index.ts:368) and the fetch adapter (`toFetchHandler`): how a stream is piped, how backpressure is honoured, what happens on client disconnect (the stream must be cancelled, or the handler keeps producing into nothing), and how an error mid-stream is handled once headers are already sent — which is the genuinely hard case, since no error response is possible. Specify what is logged and how the connection ends.',
          'Specify `Content-Length` versus chunked transfer, and when `length` is known.',
          'Specify the compression policy: which encodings (gzip, brotli, deflate), how `Accept-Encoding` is negotiated including quality values and `identity;q=0`, the minimum size below which compression is skipped, which content types are excluded (already-compressed formats), and that a response with a `Content-Encoding` already set is left alone. Also specify that compression is not applied to responses with sensitive content where a compression side channel matters — note BREACH as the reason, and say what the guidance is rather than pretending the framework can decide it.',
          'Specify static file confinement precisely: resolve the requested path against the root and require the resolved path to be inside it; reject URL-encoded and double-encoded traversal, backslashes, null bytes, and absolute paths. Specify symlink policy explicitly (follow within root only, or refuse) — this is the case people forget. Specify that directory listing is off and not configurable on.',
          'Specify static caching: `ETag` (and whether it is strong or weak, and how it is computed), `Last-Modified`, conditional request handling (`If-None-Match`, `If-Modified-Since`), `Cache-Control` defaults, and range request support including a malformed or overlapping range being refused rather than served.',
          'Specify the upload limits with concrete defaults, and make the point explicit: every limit has a default, and the defaults are conservative. Specify the behaviour on exceeding each — refuse with which status, and whether the connection is drained or dropped.',
          'Specify filename handling: the client-supplied filename is untrusted and is never used as a filesystem path. Specify what is stored, and that the declared content type is a hint, never a trust signal.',
          'Specify whether uploads stream to disk or buffer, and how a handler receives a part. A buffering parser with a total-size limit is simpler and safer; a streaming one is necessary for large files. Pick, and say why.',
          "Specify the CSRF threat model plainly: what it defends against (a cross-site form or link causing a state-changing request with the user's cookies), what it does not (XSS — a compromised page can read the token), and what makes it unnecessary (a bearer-token API with no cookie auth). Then specify the token strategy (double-submit cookie or signed synchroniser token), which methods are protected, how `SameSite` interacts, and how a SPA obtains a token. Say explicitly that the middleware must not be presented as useful for a bearer-token API — that would be protection theatre.",
          'Decide on templates. A view engine seam that renders to a string is a few lines; the question is whether it earns a supported page. Either specify the seam, or decline the page with a reason and note what a user should do instead.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Response body union and both adapter contracts specified, including disconnect cancellation and the error-after-headers case.',
          'Compression negotiation, exclusions and the BREACH guidance written.',
          'Static confinement rules enumerated technique by technique, with an explicit symlink policy and directory listing permanently off.',
          'Static caching, conditional requests and range handling specified.',
          'Upload limits with conservative defaults, per-limit refusal behaviour, untrusted-filename rule and the buffer-versus-stream decision.',
          'CSRF threat model stated including what it does not protect and when it should not be used.',
          'Templates decided either way with a reason.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] streaming, traversal, limits and CSRF — the adversarial cases first',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: "Land failing tests: the response union across both adapters, then a traversal suite, an upload-limit suite and CSRF tests, written from the attacker's side.",
        why: 'Three of these features are security features, and the tests that matter are the ones that try to break them. A static handler test that serves `index.html` proves nothing; a test that tries fourteen traversal encodings proves something.',
        files: [
          '`packages/web/src/pipeline/streaming.spec.ts` (new)',
          '`packages/web/src/static/static.spec.ts` (new)',
          '`packages/web/src/upload/upload.spec.ts` (new)',
          '`packages/web/src/csrf/csrf.spec.ts` (new)',
          '`packages/web/src/compression/compression.spec.ts` (new)',
        ],
        tests: [
          '`serves a text response byte-identically to the current implementation` — every existing pipeline test still green, unchanged.',
          '`streams a response through the Node adapter without materialising it` — assert peak retained bytes stay bounded while a large stream is served.',
          '`streams a response through the fetch adapter`.',
          '`cancels the stream when the client disconnects` — assert the source stopped being pulled.',
          '`ends the connection and logs when the stream errors after headers are sent` — the case with no good answer; assert the chosen one.',
          '`refuses to serve a path outside the root` — a table-driven test over every technique in the spec: `../`, `..%2f`, `%2e%2e%2f`, double-encoded, backslash, absolute path, null byte, unicode variants, and a long chain of `../`.',
          '`applies the symlink policy` — a symlink pointing outside the root.',
          '`never lists a directory`.',
          '`answers a conditional request with 304` for both `If-None-Match` and `If-Modified-Since`.',
          '`serves a byte range and refuses a malformed or unsatisfiable range`.',
          '`negotiates gzip and brotli from Accept-Encoding, honouring quality values and identity;q=0`.',
          '`skips compression below the minimum size and for excluded content types`, and `leaves a response with Content-Encoding already set alone`.',
          '`compresses incrementally rather than buffering` — assert the first chunk arrives before the source completes.',
          '`refuses an upload exceeding maxTotalBytes` and the same for `maxPartBytes`, `maxParts` and `maxFieldNameBytes` — four tests, each asserting the handler never ran.',
          '`refuses a multipart body with no boundary or a malformed boundary`.',
          '`does not use the client-supplied filename as a path` — feed `../../etc/passwd` as a filename and assert nothing is written outside the target.',
          '`treats the declared content type as a hint only`.',
          '`rejects a state-changing request without a valid CSRF token`, `accepts one with a valid token`, and `does not accept a token from a different session`.',
          '`compares CSRF tokens in constant time` — a timing-safe comparison is the kind of thing that is silently wrong otherwise.',
          '`does not protect safe methods` and `leaves a bearer-token request alone per the spec`.',
        ],
        steps: [
          'Write the traversal test as a data table so adding a newly learned technique is one line — this suite should be expected to grow.',
          'Write the streaming memory test with a real measurement (retained heap or a counting stream), not a proxy; "it did not crash" is not an assertion about memory.',
          'Write the upload limit tests to assert the handler was never invoked, since a limit that is checked after dispatch has already lost.',
          'Include a constant-time comparison test even though it is awkward; at minimum assert the implementation calls the timing-safe primitive rather than `===`.',
        ],
        dod: [
          'Existing response behaviour proven unchanged.',
          'Streaming proven non-materialising on both adapters, with disconnect cancellation and the post-headers error path asserted.',
          'Traversal suite is table-driven and covers every specified technique plus symlinks.',
          'Every upload limit tested with the handler proven un-invoked; untrusted filename asserted.',
          'CSRF tests cover cross-session tokens, safe methods and constant-time comparison.',
        ],
      },
      {
        key: 'body',
        title: 'The response body union and streaming adapters',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Change `WebResponse` to the body union, update both adapters, the testing harness and every internal caller, with existing behaviour byte-identical and the string path still the fast path.',
        why: 'This is the keystone: five features are blocked on it, and it touches a type used everywhere. Doing it as its own slice, with the whole existing suite as the guard, is what keeps the change auditable.',
        files: [
          '`packages/web/src/pipeline/index.ts` — `WebResponse`, `json`, `text`, `send`, `toFetchHandler`.',
          '`packages/web/src/middleware/index.ts` — `ExceptionFilter.catch` returns a `WebResponse`.',
          '`packages/web/src/testing/index.ts` — the harness must expose a stream sensibly.',
          '`packages/web/src/app/index.ts`',
        ],
        steps: [
          'Introduce the union and narrow at the adapter by tag, never by cast (§2.5).',
          'Keep the text path allocation-free relative to today: a small JSON response must not gain a stream wrapper. Check this with the existing web benchmark, and record the number.',
          "Implement the Node adapter's stream path with real backpressure (respect the write return value / use pipeline), and wire client disconnect to cancel the source stream.",
          "Implement the fetch adapter's stream path, which is more natural, and make sure cancellation propagates there too.",
          'Handle the error-after-headers case as specified, and make sure the failure is logged loudly — this is a case where a silent truncation looks like a client bug for weeks.',
          'Update the testing harness so a test can read a streamed body conveniently, since otherwise every downstream test becomes awkward and people will avoid streaming in tests.',
          'Add a `stream()` helper and a `file()` helper alongside `json` and `text`.',
        ],
        tests: [
          'The entire existing web suite green with no expectation changes.',
          'All streaming tests green including cancellation and the post-headers error.',
          'The web benchmark shows no regression on the small-JSON path.',
        ],
        dod: [
          'Union in place, narrowed by tag with no casts; every caller updated.',
          'Both adapters stream with backpressure and cancellation; post-headers errors handled and logged.',
          'Small-response performance unchanged and measured; the testing harness supports streams.',
        ],
      },
      {
        key: 'static',
        title: 'Static files and compression',
        labels: ['enhancement'],
        blockedBy: ['body'],
        goal: 'Ship a static file handler that cannot escape its root, with caching, conditional requests and ranges, plus incremental compression with the specified negotiation and exclusions.',
        files: ['`packages/web/src/static/index.ts` (new)', '`packages/web/src/compression/index.ts` (new)'],
        steps: [
          'Resolve the path and then verify containment on the *resolved* result — the only reliable order. Decode exactly once and reject anything that still contains a traversal sequence after decoding, rather than looping until clean, since repeated decoding is itself a vulnerability pattern.',
          'Reject null bytes and backslashes before touching the filesystem, and apply the specified symlink policy using a real filesystem check rather than a string test.',
          'Never list directories, and make the index-file behaviour explicit and off by default for anything but a configured index name.',
          'Compute ETags cheaply and deterministically (size plus mtime is acceptable and should be documented as weak; a content hash is strong and costs a read — say which is used).',
          'Implement conditional requests and ranges, refusing malformed, unsatisfiable and multi-range requests rather than half-implementing multipart ranges.',
          'Implement compression as a transform over the stream so it is incremental, and honour the negotiation rules including `identity;q=0` meaning no acceptable encoding rather than "use identity anyway".',
          'Skip small bodies and excluded content types, and never double-compress.',
          'Document the BREACH consideration in code where the compression decision is made, so the next reader does not remove the exclusion list as dead weight.',
        ],
        tests: [
          'The full traversal table green, plus the symlink policy test.',
          'Caching, conditional and range tests green.',
          'All compression negotiation, exclusion and incrementality tests green.',
        ],
        dod: [
          'Containment verified on resolved paths, single-decode rule, null-byte and backslash rejection, symlink policy enforced by filesystem check.',
          'No directory listing; ETag strength documented; ranges refused rather than half-served.',
          'Compression is incremental, negotiation correct including `identity;q=0`, exclusions in place and commented.',
        ],
      },
      {
        key: 'upload',
        title: 'Multipart uploads with mandatory limits',
        labels: ['enhancement'],
        blockedBy: ['body'],
        goal: 'Ship multipart parsing as a `Pipe` at the body boundary, with every limit enforced before dispatch and the client-supplied filename treated as data.',
        why: 'The page note already points at the right seam ("plug a Pipe at the body boundary"), so the design question is settled and the work is about limits. An upload parser without enforced limits is a memory or disk exhaustion vector that any client can reach.',
        files: [
          '`packages/web/src/upload/index.ts` (new)',
          '`packages/web/src/dto-pipes/index.ts` — the pipe registration.',
        ],
        steps: [
          'Implement the parser per the buffer-or-stream decision, enforcing each limit as bytes arrive rather than after the fact — a total-size limit checked after reading the body has already used the memory.',
          'Refuse and stop reading as soon as a limit is exceeded, with the specified status, and handle the connection per the spec (draining a huge body to send a clean 413 versus dropping it is a real trade-off — implement the chosen one and comment why).',
          'Validate boundaries strictly and refuse malformed multipart rather than attempting recovery.',
          'Expose the filename as data only. If a helper writes a part to disk, generate the name and never derive it from client input; if the caller does it, document the hazard at the API.',
          'Treat the declared content type as a hint, and if sniffing is offered, keep it separate and explicit rather than implicitly trusted.',
          "Integrate with the existing validation boundary so a multipart form's fields validate like any other body.",
        ],
        tests: [
          'All four limit tests green, each asserting the handler never ran.',
          '`does not use the client-supplied filename as a path`.',
          '`refuses a multipart body with no boundary or a malformed boundary`.',
        ],
        dod: [
          'Limits enforced incrementally with conservative non-removable defaults; refusal behaviour implemented as specified and commented.',
          'Filenames never become paths; content type is a hint only.',
          'Form fields flow through the normal validation boundary.',
        ],
      },
      {
        key: 'csrf',
        title: 'CSRF protection, and the templates decision',
        labels: ['enhancement'],
        blockedBy: ['body'],
        goal: 'Ship CSRF middleware with an app-owned token store, constant-time comparison, and documentation that is honest about scope — plus implement or decline the view engine seam.',
        files: [
          '`packages/web/src/csrf/index.ts` (new)',
          '`packages/web/src/views/index.ts` (new, if templates proceed)',
        ],
        steps: [
          'Implement the chosen token strategy with a cryptographically random token, an app-owned store (§2.7), and a timing-safe comparison — use the platform primitive, not `===`.',
          'Protect only unsafe methods, and make the protected set explicit rather than inferred.',
          'Provide the token to a client in the documented way, and set cookie attributes correctly (`SameSite`, `Secure`, `HttpOnly` where applicable — noting that a double-submit cookie cannot be `HttpOnly`, which is exactly the sort of detail to get right and document).',
          'Make the middleware refuse to be useful where it is not: if the spec says a bearer-token API needs no CSRF, do not silently protect it in a way that looks meaningful.',
          'For templates: if proceeding, implement a seam that renders to a string or a stream with the engine as a peer dependency, and escape by default — an integration that does not escape is worse than none. If declining, note the decision and what a user should do instead.',
        ],
        tests: [
          'All CSRF tests green including cross-session tokens and constant-time comparison.',
          'If templates proceed: `escapes interpolated values by default` and a rendering test through the response union.',
        ],
        dod: [
          'Random tokens, app-owned store, timing-safe comparison, explicit protected method set, correct cookie attributes.',
          'No protection theatre for bearer-token APIs.',
          'Templates shipped with escape-by-default, or declined with a written reason.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] streaming, compression, static files, uploads, templates, CSRF',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['static', 'upload', 'csrf'],
        goal: 'Flip the pages to supported (or record the templates decision), with limits and threat models documented before the APIs.',
        files: ['`docs-site/pages.mjs`', 'the six content files'],
        steps: [
          'Document the response union and the migration from the string body, since it is a visible change to a core type.',
          'Document streaming with the disconnect and post-headers-error behaviour, because both surprise people.',
          'Lead the static page with confinement: what is rejected and why, the symlink policy, and that directory listing cannot be enabled.',
          'Lead the upload page with the limits table and the defaults, and state the filename rule in the first paragraph — it is the mistake this page can prevent.',
          'Document the compression exclusions and the BREACH consideration, with concrete guidance rather than a vague warning.',
          'Write the CSRF page around the threat model: what it stops, what it does not, and when not to use it. A reader who concludes "I do not need this" from the page has been served well.',
          'Record the templates outcome — supported with the seam, or a `todo` page with a specific reason.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Pages reflect reality; confinement, limits and the CSRF threat model documented before the APIs; templates outcome recorded either way.',
        ],
      },
    ],
  },

  {
    key: 'apisurface',
    title: '[EPIC] OpenAPI security schemes and API versioning',
    labels: ['enhancement', 'area:web', 'parity:nestjs'],
    pages: ['web-openapi-security', 'web-versioning'],
    packages: ['@zmdb/web', '@zmdb/schema-core'],
    motivation: `
"OpenApiOptions carries info + per-route schemas only; no securitySchemes or per-operation security" and
"no built-in version negotiator; use controller/path prefixes today".

Both are about the document and the surface being complete enough to describe a real API rather than a
demo. The security one has a consequence beyond documentation: a generated OpenAPI document with no
security information produces client SDKs that do not know how to authenticate, and — more importantly —
it means the document cannot be used to review what is protected. A document that silently describes
every endpoint as public is misleading in the direction that matters.

There is also an opportunity that follows from how zmdb generates its document. Guards are already
declared on controllers and handlers. If a guard can declare which security scheme it enforces, then the
document's \`security\` blocks can be *derived from the actual guards* rather than written by hand. That
inverts the usual failure mode, where the document claims an endpoint is protected and the code has since
changed. Nothing else in the ecosystem does this well, and it is a natural fit for a project whose whole
premise is deriving artefacts from declarations.

Versioning is smaller but has one real decision in it: where the version lives (path, header, media type,
or query) and whether a handler can serve several versions. Path prefixes work today, which is why the
page note says so; a negotiator earns its place by making header and media-type versioning work and by
putting the version into the generated document correctly.
`,
    dod: [
      'Security schemes can be declared and appear in the generated document, covering HTTP basic/bearer, API key, OAuth2 flows and OpenID Connect.',
      'Per-operation `security` is derived from the guards actually applied, not written separately, with an escape hatch for guards that cannot declare.',
      'An endpoint protected in code but described as public in the document is a build error, or a verifier catches it.',
      'Version negotiation supports path, header and media-type strategies, with a documented default and per-route overrides.',
      'The generated document reflects versions correctly, including a route available in several versions.',
      'Both pages flip to supported, and `yarn verify:api-coverage` figures are refreshed if the surface changed.',
    ],
    invariants: [
      '§2.2 no runtime reflection: the document is generated at build time as it is today.',
      'Derivation over declaration: security in the document comes from guards. A hand-written `security` block that disagrees with the guards is the defect this epic prevents, so the mechanism must make disagreement detectable.',
      '§2.4-in-spirit explicitness: version resolution is explicit and inspectable — a route lists the versions it serves, and there is no implicit fallthrough to an unversioned handler unless declared.',
      '§2.6 no over-abstraction: three version strategies, not a pluggable negotiation framework.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] security scheme declaration, guard-derived security, and version negotiation',
        labels: ['spec'],
        goal: 'Freeze the security scheme types, how a guard declares what it enforces, the derivation and disagreement-detection rule, and the three version strategies with their document representation. No code.',
        why: 'The guard-derived security idea is the interesting part and it needs its edges defined: what a guard that cannot declare does, what happens when two guards on one route declare different schemes, and how an intentionally public endpoint is distinguished from one that simply forgot a guard. Those three cases determine whether the feature is useful or merely clever.',
        files: [
          '`packages/web/src/openapi/SPEC.md` — schemes, derivation, versioning in the document.',
          '`packages/web/src/versioning/SPEC.md` (new)',
        ],
        api: `
export type SecurityScheme =
  | { readonly type: 'http'; readonly scheme: 'basic' | 'bearer'; readonly bearerFormat?: string }
  | { readonly type: 'apiKey'; readonly in: 'header' | 'query' | 'cookie'; readonly name: string }
  | { readonly type: 'oauth2'; readonly flows: OAuthFlows }
  | { readonly type: 'openIdConnect'; readonly openIdConnectUrl: string };

/** A guard says what it enforces, so the document can be derived from the code. */
export interface SecurityAwareGuard extends Guard {
  readonly enforces: { readonly scheme: string; readonly scopes?: readonly string[] };
}

export declare function Public(): MethodDecorator;   // an explicit, auditable opt-out

export type VersionStrategy =
  | { readonly kind: 'path'; readonly prefix: string }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'media-type'; readonly key: string };

export declare function Version(...versions: readonly string[]): MethodDecorator | ClassDecorator;
`,
        steps: [
          'Specify each security scheme type against the OpenAPI version the project targets, including the OAuth2 flow objects, and where `securitySchemes` sits in the document.',
          'Specify guard declaration: a guard exposes `enforces`, and a route\'s `security` is the union of its guards\' declarations. Specify the multi-guard case — several schemes on one route means "all required" in OpenAPI terms when listed in one object and "any" when listed as separate objects; pick the mapping and say which.',
          'Specify the disagreement rule. The valuable one: a route with a guard but no derived security is a build error, and a route with neither a guard nor `@Public()` is a build error too — so a forgotten guard cannot look like a public endpoint. Decide whether that strictness is on by default (recommended, with a way to opt out per project) and say what the opt-out costs.',
          'Specify what a guard that cannot declare does (a legacy or third-party guard), so the strict rule does not become unusable.',
          'Specify `@Public()` as the explicit, greppable opt-out, and that it appears in the document as `security: []`.',
          'Specify the three version strategies, the default, and how a route declares versions. Specify precedence when more than one strategy is configured, and the behaviour when a request names no version (a configured default version, or a refusal — decide) and an unknown version (refuse with which status).',
          'Specify the document representation per strategy: path versioning produces distinct paths; header and media-type versioning produce a parameter or content-type variation. Getting this right is the difference between a usable generated client and a confusing one.',
          'Specify how a route serving several versions is represented, and whether deprecation is expressible (`deprecated: true` is cheap and useful — decide).',
          'Specify interaction with the routing table: version resolution must be part of the startup-built structure, not a per-request scan, consistent with how `MethodBuckets` already works (packages/web/src/pipeline/index.ts:62).',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'All scheme types specified against the targeted OpenAPI version, including OAuth2 flows.',
          'Guard-derived security specified with the multi-guard mapping chosen and the non-declaring-guard case handled.',
          'The strictness rule (guard without security, and route without guard or `@Public()`) decided with its opt-out.',
          'Three version strategies specified with precedence, missing-version and unknown-version behaviour, and per-strategy document representation.',
          'Multi-version routes and deprecation decided; version resolution required to be startup-built.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] derived security, the disagreement error, and version negotiation',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests: golden documents for each scheme, the build errors for undeclared security, and negotiation tests across all three strategies including the document output.',
        why: 'The build-error tests are the point of the epic — they are what turns "the document has security fields" into "the document cannot lie about what is protected".',
        files: [
          '`packages/web/src/openapi/security.spec.ts` (new)',
          '`packages/web/src/versioning/versioning.spec.ts` (new)',
          '`packages/web/src/openapi/__fixtures__/` — golden documents.',
        ],
        tests: [
          '`emits securitySchemes for http bearer, http basic, apiKey and oauth2`.',
          '`derives per-operation security from the guards applied to the route`.',
          '`maps several guards to the specified all-versus-any form`.',
          '`fails the build for a route with a guard that declares nothing` — per the strictness rule.',
          '`fails the build for a route with neither a guard nor @Public()` — the forgotten-guard case, which is the headline test.',
          '`emits security: [] for a @Public() route`.',
          '`allows a non-declaring guard through the specified escape hatch`.',
          '`negotiates a version from the path`, `from a header`, and `from a media type` — three tests.',
          '`applies the configured default when a request names no version` or `refuses` — per the decision.',
          '`refuses an unknown version with the specified status`.',
          '`routes a request to the handler for its version when a route serves several`.',
          '`resolves the version through the startup-built routing structure` — assert no per-request scan.',
          '`emits distinct paths for path versioning and a parameter for header versioning` — golden documents for each.',
          '`marks a deprecated version in the document` — if that is in scope.',
          '`the generated document validates against an OpenAPI validator` — for every fixture, since a document we generate and only we read is not worth much.',
        ],
        steps: [
          'Add an OpenAPI schema validator as a dev dependency and validate every golden document, so structural mistakes are caught by the spec rather than by review.',
          'Write the build-error tests so they assert the diagnostic text and the located route, since a build error nobody can act on is close to useless.',
        ],
        dod: [
          'Golden documents per scheme and per version strategy, all validated by a real OpenAPI validator.',
          'Both strictness build errors tested with diagnostic text and location asserted.',
          'All three negotiation strategies tested, plus defaults, unknown versions, multi-version routes and startup-built resolution.',
        ],
      },
      {
        key: 'security',
        title: 'Security schemes derived from guards',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement scheme declaration, derive per-operation security from guards, and make an undeclared or unguarded route a build error with an explicit `@Public()` opt-out.',
        files: [
          '`packages/web/src/openapi/index.ts` — schemes and per-operation security.',
          '`packages/web/src/middleware/index.ts` — `SecurityAwareGuard`.',
          '`packages/web/src/routing/index.ts` — `@Public()` metadata.',
        ],
        steps: [
          'Add the scheme types and emit `securitySchemes` in the document, validating the emitted shape against the OpenAPI schema in tests rather than by eye.',
          "Let a guard declare `enforces`, and compute each operation's `security` from the guards resolved for that route — including guards applied at the controller and app level, which is where a naive implementation will miss coverage.",
          'Implement the strictness check as a build-time diagnostic with the route located, and the project-level opt-out the spec defined. Make the error message say what to do: add a guard, declare `enforces`, or mark `@Public()`.',
          'Implement `@Public()` so it is greppable and appears in the document, so an audit can list every public endpoint from either the code or the document and get the same answer.',
          'Add a verifier script if the build-time check cannot cover every case, in the style of the existing `verify:*` scripts, so this stays enforced as the surface grows.',
        ],
        tests: [
          'All security tests green including both build errors and the escape hatch.',
          'Every golden document validates against the OpenAPI validator.',
        ],
        dod: [
          'Schemes emitted and validated; per-operation security derived from all guard levels.',
          'Undeclared and unguarded routes are located build errors with actionable messages; `@Public()` is explicit and greppable.',
          'A verifier keeps the invariant enforced if the compiler cannot.',
        ],
      },
      {
        key: 'versioning',
        title: 'Version negotiation across path, header and media type',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement the three strategies with startup-built resolution, multi-version routes, and correct document representation per strategy.',
        files: [
          '`packages/web/src/versioning/index.ts` (new)',
          '`packages/web/src/pipeline/index.ts` — version as part of the routing structure.',
          '`packages/web/src/openapi/index.ts` — version representation.',
        ],
        steps: [
          'Extend the routing structure so version is a key in the startup-built buckets rather than a check inside a handler, keeping the existing first-registered-wins ordering semantics intact.',
          'Implement path, header and media-type parsing, with precedence as specified and a clear refusal for an unknown version.',
          'Support a route serving several versions without duplicating the handler.',
          'Emit the document representation per strategy, and make sure a generated client would actually work for header and media-type versioning — that is the test of whether the representation is right.',
          'Support deprecation marking if in scope.',
          'Re-check the routing benchmark: adding a dimension to the route table is exactly the kind of change that quietly costs matching performance.',
        ],
        tests: [
          'All negotiation tests green, including startup-built resolution and multi-version routes.',
          'Golden documents per strategy, validated.',
          'The routing benchmark shows no regression.',
        ],
        dod: [
          'Three strategies implemented with version in the startup-built route table and ordering preserved.',
          'Unknown versions refused as specified; multi-version routes supported without duplication.',
          'Document representation correct per strategy; routing performance unchanged and measured.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] OpenAPI security and versioning',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['security', 'versioning'],
        goal: 'Flip both pages to supported, leading with the derived-security property since it is the differentiator.',
        files: ['`docs-site/pages.mjs`', 'the two content files', '`docs-site/content/openapi-document.md`'],
        steps: [
          "Lead the security page with the property, not the API: the document's security blocks are derived from the guards, so it cannot claim protection the code does not have — and a route with no guard fails the build rather than appearing public.",
          'Show the `@Public()` opt-out and explain that it exists to be audited, with the grep that lists every public endpoint.',
          'Document all four scheme types with worked examples, including an OAuth2 flow, since that is the one people get wrong.',
          'Document the three version strategies, the default, precedence, and what a client sees for an unknown version.',
          'Show the generated document for each strategy, since a reader needs to know what their client generator will see.',
          'Refresh README counts and re-run `yarn verify:api-coverage`, updating the figures quoted in the docs prose if the public surface moved.',
        ],
        tests: [
          '`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.',
          '`yarn verify:api-coverage` figures refreshed where quoted.',
        ],
        dod: [
          'Both pages supported; derived-security property documented first with the audit workflow; all schemes and strategies shown with generated output; coverage figures refreshed.',
        ],
      },
    ],
  },
];
