// Validator and tooling gaps. All three are AOT-emitter work: a depth-limited validator, a wire
// codec generated from the same IR, and a lint plugin that catches the mistakes types cannot.

export const VALIDATOR_EPICS = [
  {
    key: 'shallow',
    title: '[EPIC] Shallow validation — a depth-limited validator variant',
    labels: ['enhancement', 'area:validator', 'perf', 'parity:typia'],
    pages: ['validators-shallow'],
    packages: ['@zmdb/compiler', '@zmdb/aot-validator', '@zmdb/schema-core'],
    motivation: `
\`is()\` and \`assert()\` walk the whole tree. That is the right default — a validator that checks the
top level and trusts the rest is a validator that lets a malformed nested object through — but it is
the wrong cost when the tree is already known good.

The case that matters: a row read back from the database, populated three relations deep, revalidated
on the way out to an HTTP response. The nested objects came from the same validator on the way in.
Walking them again is work with no information gained, and on a list endpoint it is that work times
the page size.

Typia ships \`isShallow\`-shaped variants for exactly this. zmdb can do it better, because depth is a
compile-time property here: the emitter knows the tree, so a depth limit is a decision about which
branches to emit, not a counter checked per node at runtime. A shallow validator should be *smaller
emitted code*, not the same code with a guard.
`,
    dod: [
      '`isShallow`/`assertShallow` (and the `validate` equivalent) are emitted with the nested branches absent, not skipped at runtime — verified by reading the emitted output.',
      'Depth is a compile-time argument, so `depth: 2` emits two levels of checks and nothing for the third.',
      'The default remains full depth. No existing call changes behaviour.',
      'What a shallow check does *not* guarantee is documented in one sentence per variant, next to the API, because a reader who misunderstands this ships a security bug.',
      'A benchmark shows the win on a realistic populated row, and the number goes in the docs rather than a claim.',
      '`validators-shallow` flips to supported.',
    ],
    invariants: [
      '§1 cost model, in its strongest form: this feature exists only if the emitted code is smaller. A runtime depth counter would add cost to every validator, including the full-depth ones, and must be rejected.',
      '§2.2 no runtime reflection: depth is known when the code is emitted.',
      '§2.3 validation at the boundary: shallow validation is a *deliberate* weakening, so it must be impossible to enable by accident — no config flag that makes every validator shallow.',
      'The `verify:instantiations` gate is relevant: a new emitter variant must not blow up type instantiation counts.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] what shallow means, per type constructor',
        labels: ['spec'],
        goal: `
Freeze what "depth" counts and what a shallow check still guarantees, constructor by constructor:
object properties, arrays, tuples, unions, records, optionals, and a recursive type. No code.
`,
        why: `
"Shallow" is ambiguous in exactly the places that matter. Is an array of primitives depth 1 or 2? Is
each element checked at depth 1? Does a union at depth 1 check its discriminant? Is a recursive type
allowed at all? Every one of these has a defensible answer and a plausible wrong one, and the wrong
one produces a validator that says yes to malformed data — which is worse than no validator, because
it comes with a promise.
`,
        files: [
          '`packages/compiler/src/emit/SPEC.md` — a "Depth" section.',
          '`packages/schema-core/SPEC.md` — the public API surface if the entry points live there.',
        ],
        api: `
/** Depth 1 checks the top level only: property presence and primitive types. */
export declare function isShallow<T>(value: unknown, depth?: number): value is T;
export declare function assertShallow<T>(value: unknown, depth?: number): asserts value is T;
export declare function validateShallow<T>(value: unknown, depth?: number): ValidationResult<T>;
`,
        steps: [
          'Define depth by nesting of *type constructors*, and write a worked table: `{ a: number }` at depth 1 checks `a`; `{ a: { b: number } }` at depth 1 checks that `a` is an object and stops; at depth 2 it checks `b`.',
          'Decide arrays: at depth 1, is `string[]` checked as "an array" or "an array of strings"? Checking element primitives is nearly free (a typeof per element) but is O(n), which is exactly the cost being avoided on a large list. Pick one, and state the O() consequence.',
          'Decide unions: a discriminated union must check its discriminant even at depth 1, or the value is unusable — narrowing without a discriminant check is a lie the type system will believe. Say so.',
          'Decide optionals and nullables: presence checks are depth 0 work and always happen.',
          'Decide recursive types: a recursive type at any depth terminates at the limit, which is precisely what makes shallow useful for them. Note that this incidentally gives a bounded validator for a type the full validator must guard with a depth cap anyway.',
          'Decide the API shape: is `depth` a type argument (`isShallow<T, 2>`) or a runtime argument? A runtime argument cannot select emitted branches, so the honest answer is a type-level or literal-only argument that the transformer reads. Specify what happens when a non-literal is passed — a build diagnostic, not a silent fallback to full depth.',
          'Write the one-sentence "does not guarantee" line for each variant, which the docs and the JSDoc will both use verbatim.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Depth defined per constructor with a worked table; array/union/recursive decisions made with their cost consequences; the literal-only `depth` argument and its diagnostic specified.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] shallow validation — emitted-code assertions, not just behaviour',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests that assert the *emitted code* omits nested branches, alongside the behavioural tests. A behaviour-only suite cannot tell a genuinely shallow validator from a full one with an early return.',
        why: 'The whole justification is smaller emitted code. The repo already has emit-snapshot tests (`packages/compiler/src/emit/emit.spec.ts` and the transform tests), so asserting the emitted output is an established pattern here, not a new kind of test.',
        files: [
          '`packages/compiler/src/emit/emit.spec.ts`',
          '`packages/compiler/src/transform-code.spec.ts` — `CALLEES` must learn the new names.',
          '`packages/compiler/src/aot-validator.spec.ts` — behaviour.',
          '`packages/schema-core/src/schema-core.spec.ts` — the public entry points.',
        ],
        tests: [
          '`emits no branch for a nested object beyond the depth limit` — assert the emitted string does not contain the nested property name.',
          '`emits two levels of checks at depth 2`.',
          '`checks a discriminant even at depth 1`.',
          '`checks array-ness at depth 1 and elements per the spec decision`.',
          '`terminates on a recursive type at the depth limit` — a self-referential type that would otherwise recurse.',
          '`accepts a value whose nesting is malformed below the limit` — the honest test: shallow validation says yes to bad nested data, and the suite must state that as intended behaviour rather than leave it undiscovered.',
          '`still rejects a malformed top level`.',
          '`reports a build diagnostic when depth is not a literal`.',
          '`leaves is() and assert() emitting exactly what they emit today` — snapshot regression on the existing emitters.',
          '`recognises the shallow callees in the transformer` — `CALLEES` coverage, since an unrecognised callee silently stays a runtime call.',
        ],
        steps: [
          'Add the new callee names to `CALLEES` in this slice and assert the sorted list, since `transform-code.spec.ts` already pins it.',
          'Write the "accepts malformed nested data" test explicitly and name it that way. It is the test that documents the danger, and a suite that omits it looks like the feature has no downside.',
          'Note the two related gaps carried in the backlog while you are here: `CALLEES` does not currently include `decode`/`assertStringify`/`stringify`, and `EmitDiagnostic.path` carries an emitted-expression fragment rather than a property path. Neither is in scope; do not fix them silently in this slice.',
        ],
        dod: [
          'Emitted-code assertions for every depth claim; the malformed-nested-data behaviour explicitly tested; `CALLEES` updated with its list assertion.',
        ],
      },
      {
        key: 'emit',
        title: 'Depth-limited emission in the validator emitter',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement depth in the emitter: a limit threads through emission and truncates the tree, producing smaller code. No runtime counter anywhere.',
        files: [
          '`packages/compiler/src/emit/index.ts` — the emission walk.',
          '`packages/schema-core/src/ir/validation-shape.ts` — shared shape decisions at the truncation point.',
          '`packages/compiler/src/transform/index.ts` — `CALLEES` and the call-site rewrite that reads the literal `depth`.',
        ],
        api: `
interface EmitOptions {
  /** Absent means full depth, which is the existing behaviour byte for byte. */
  readonly maxDepth?: number;
}
`,
        steps: [
          'Thread `maxDepth` through the emit walk as a decrementing parameter, and at zero emit only the shape check the spec chose for that constructor.',
          'Guarantee byte-identical output when `maxDepth` is absent: snapshot the existing emitters before and after and diff. A one-character change to full-depth output is a regression in a feature nobody asked to change.',
          'Read `depth` from the call site as a literal in the transformer, and emit a diagnostic through the existing channel when it is not one. Do not fall back to full depth silently — a silent fallback makes a performance feature fail invisibly, which is the worst kind.',
          'Handle the recursive-type interaction with whatever depth cap the full validator already applies, so the two limits do not fight.',
          'Check `yarn verify:instantiations` after the change: a new generic entry point can move instantiation counts, and the gate has a budget.',
          'Check `yarn verify:build-budget`: more emitters means more emitted code in the fixture builds, and the budget is there to notice.',
        ],
        tests: [
          'All emit and behaviour tests from the tests-freeze slice go green.',
          '`emits byte-identical code for is() before and after this change` — the regression guard.',
          '`yarn verify:instantiations` and `yarn verify:build-budget` within budget.',
        ],
        dod: [
          'Depth truncates emission; no runtime depth counter exists in the emitted code (grep the snapshots).',
          'Full-depth output byte-identical to before.',
          'Non-literal `depth` is a build diagnostic.',
          'Instantiation and build-budget gates green.',
        ],
      },
      {
        key: 'api',
        title: 'Public shallow entry points, exported and benchmarked',
        labels: ['enhancement'],
        blockedBy: ['emit'],
        goal: 'Export `isShallow`/`assertShallow`/`validateShallow` from `@zmdb/schema-core` and `zmdb`, wire them into the untransformed-build error path, and measure the win.',
        why: 'A performance feature without a number is a guess. The repo already runs the validation benchmark suite, so the measurement is cheap and the claim becomes checkable.',
        files: [
          '`packages/schema-core/src/index.ts`, `packages/zmdb/src/index.ts` — exports.',
          '`packages/aot-validator/src/utilities/index.ts` — the untransformed-build throw must name the new functions too.',
          '`benchmarks/` — a case for a populated row.',
          "`tests/api-coverage/mapping.mjs` — Typia's shallow suites.",
        ],
        steps: [
          'Export the three functions and add them to whatever list `yarn verify:exports` and `yarn verify:api-coverage` read, so the surface is inventoried.',
          "Make an untransformed build throw the same explanatory error these functions' siblings throw — a shallow validator that silently returns `true` in an untransformed build would be a security hole.",
          'Add a benchmark case on a realistically populated row (three relations, a list of 100) comparing full and shallow, and record the numbers in `benchmarks/RESULTS.md` under the existing honesty policy.',
          "Re-point Typia's shallow-validation suites in `tests/api-coverage/mapping.mjs`.",
        ],
        tests: [
          '`throws the untransformed-build error for every shallow entry point`.',
          '`exports the shallow validators from the umbrella package` — via `yarn verify:exports`.',
          'Benchmark case runs and its numbers are recorded.',
        ],
        dod: [
          'Three entry points exported and inventoried; untransformed build throws; benchmark numbers recorded in RESULTS.md.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] shallow validation, including what it does not promise',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['api'],
        goal: 'Flip `validators-shallow` to supported and write the page so a reader cannot come away thinking shallow validation is a free speed-up.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/validators-shallow.md`',
          '`docs-site/content/validators-validate.md` — cross-link from full validation, and say when not to use shallow.',
          '`tests/api-coverage/mapping.mjs`',
        ],
        steps: [
          'Lead with the one legitimate use — revalidating data that was already validated — and name the illegitimate one: an untrusted request body.',
          'Show the emitted code for depth 1 and full depth side by side. That is the clearest possible explanation of why this is cheaper, and it is a fact about the implementation rather than a claim.',
          'Include the measured benchmark numbers, with the caveat that they are for the shape measured.',
          'Repeat the per-variant "does not guarantee" sentence from the spec verbatim.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Page supported; emitted-code comparison shown; measured numbers included; the danger stated as prominently as the benefit.',
        ],
      },
    ],
  },

  {
    key: 'protobuf',
    title: '[EPIC] Protobuf — descriptors, encoder and decoder from the same IR',
    labels: ['enhancement', 'area:validator', 'parity:typia'],
    pages: ['protobuf-message', 'protobuf-encode', 'protobuf-decode'],
    packages: ['@zmdb/compiler', '@zmdb/protobuf', '@zmdb/aot-validator', '@zmdb/schema-core'],
    motivation: `
zmdb derives JSON validators, JSON Schema, OpenAPI and SQL from one declaration. Protobuf is the
obvious missing member of that list, and the one with the strongest argument: a wire format whose
whole premise is a schema shared between producer and consumer is exactly what "define once,
everything derives" is for. Today a team that needs protobuf maintains a \`.proto\` file beside the
TypeScript interface, which is the schema drift this project exists to delete — in the one place where
drift is a decode failure in production rather than a type error.

It is also the epic with the most exacting correctness bar in the roadmap. A validator that is subtly
wrong rejects something it should accept. A wire codec that is subtly wrong writes bytes another
language's runtime will misread, and the failure surfaces in a different service, later, as garbage.
Varint encoding, zigzag for signed types, field ordering, unknown-field preservation and default-value
omission all have to be right, and "right" is defined by a specification outside this repo.

Field numbers are the design crux: protobuf identity is the field number, not the name, and TypeScript
has no syntax for it. The tag vocabulary is how zmdb says things TypeScript cannot, so this becomes a
tag — and getting that tag wrong (or letting it be optional) means renumbering breaks the wire
compatibility protobuf exists to provide.
`,
    dod: [
      'A `Field<N>` tag carries a protobuf field number, and a message type without complete, non-duplicated numbering is a build error naming the offending property.',
      '`toProtoDescriptor<T>()` emits a valid `.proto` (proto3) text for a declared type, including nested messages, enums, repeated and optional fields, and `map`.',
      '`protoEncode<T>(value)` and `protoDecode<T>(bytes)` are AOT-emitted, and round-trip every supported scalar and composite.',
      'Interoperability is proven against a reference implementation — bytes produced here decode in `protobufjs` (or `google-protobuf`) and vice versa, as a test, not an argument.',
      'Unsupported constructs (a union without a `oneof` mapping, `bigint` beyond 64 bits, `Date`) are refused at build time with a message naming the property and the reason.',
      'All three pages flip to supported, and the page says what proto features are out of scope.',
    ],
    invariants: [
      '§1 cost model: encode/decode are emitted, not reflective. No descriptor walked at runtime, no field lookup per value.',
      '§2.9 one front-end: the descriptor, the encoder and the decoder all come from the same `TypeIR`. Three walkers over the same type is the failure mode `yarn verify:one-walker` exists to prevent.',
      '§2.5 no `as`: decoding produces a value the emitted code has checked, so the return type is earned rather than asserted. If a cast is genuinely unavoidable at the byte boundary, it needs a documented `// boundary:` comment and the escape-hatch gate will count it.',
      'Correctness is defined by the protobuf spec, not by our round-trip test. A round trip that is self-consistently wrong is the specific risk here, which is why cross-implementation tests are in the Definition of Done.',
    ],
    nonGoals: [
      'proto2 semantics (required fields, explicit defaults, extensions).',
      'gRPC service definitions — the transport epic owns those; this epic emits messages only.',
      'Runtime `.proto` parsing. The direction is TypeScript → proto, not proto → TypeScript.',
      'Any/Struct/well-known types beyond `Timestamp`, unless the spec slice decides otherwise.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the TypeScript-to-protobuf mapping, field numbering, and the refusals',
        labels: ['spec'],
        goal: `
Freeze the mapping from the type vocabulary to proto3 — scalar by scalar, composite by composite —
plus the field-numbering tag, the wire-compatibility rules, and every construct that is refused. No
code.
`,
        why: `
Protobuf has decisions TypeScript does not: which integer width, signed or unsigned, zigzag or not.
\`number\` could map to \`int32\`, \`int64\`, \`double\` or \`sint32\`, and the choice is not inferable —
it has to be declared, which means more tag vocabulary, which means the spec has to design it before
any emitter exists. And proto3's implicit-presence rules mean a zero value is indistinguishable from
an absent one unless the field is \`optional\`; that interacts with TypeScript's \`?\` in a way that
will produce a subtle bug if it is not written down first.
`,
        files: [
          '`packages/schema-core/src/ir/SPEC.md` — the proto tag vocabulary and IR carriage.',
          '`packages/compiler/src/emit/SPEC.md` — descriptor, encoder and decoder emission.',
        ],
        api: `
/** Protobuf field number. Required on every property of a message type. */
export type Field<N extends number> = { readonly __protoField?: N };
/** Wire type selection where TypeScript is ambiguous. */
export type Proto<K extends ProtoScalar> = { readonly __protoScalar?: K };
export type ProtoScalar =
  | 'int32' | 'int64' | 'uint32' | 'uint64' | 'sint32' | 'sint64'
  | 'fixed32' | 'fixed64' | 'sfixed32' | 'sfixed64'
  | 'float' | 'double' | 'bool' | 'string' | 'bytes';

export declare function toProtoDescriptor<T>(): string;
export declare function protoEncode<T>(value: T): Uint8Array;
export declare function protoDecode<T>(bytes: Uint8Array): T;
`,
        steps: [
          'Write the scalar mapping table: which `ProtoScalar` each TypeScript type defaults to, and which combinations require an explicit `Proto<...>` tag. Default `number` to `double` (lossless for a JS number) and require an explicit tag for every integer type — a silent `int32` default truncates at 2^31 and the truncation is invisible.',
          'Decide `bigint` → `int64`/`uint64`, and state the JS-side representation on decode (a `bigint`, not a `number`, because a `number` cannot hold it). Refuse anything wider.',
          'Decide `Date`: either refuse it or map it to `google.protobuf.Timestamp`. Given the project rule that a timestamp is a `Date` in Node, `TIMESTAMPTZ` in Postgres and an ISO string in OpenAPI, the consistent answer here is `Timestamp`, and the spec should say so and note the well-known-type import that implies.',
          'Decide presence: a TypeScript optional property maps to proto3 `optional` (explicit presence), and a required property with a zero value is emitted per proto3 implicit-presence rules — meaning it is *omitted from the wire*. Write out the consequence: a required `count: 0` and an absent `count` are the same bytes, so a decoder must produce `0`, and a round-trip test must cover exactly this case.',
          'Decide composites: arrays → `repeated` (packed where proto3 packs by default), `Record<string, V>` → `map<string, V>`, nested objects → nested messages, string unions → enums (with the zero value problem: proto3 enums must have a zero member, so specify what happens to a union with no natural zero), discriminated unions → `oneof` with a numbering rule.',
          'Decide unknown-field handling on decode: preserve or discard. Preserving is what makes protobuf forward-compatible across service versions, and discarding silently breaks that guarantee for anyone re-encoding; pick one and write down what a re-encode does.',
          'Specify field-number validation: required on every property, unique within a message, within `1..536870911`, and not in the reserved `19000..19999` range. Each violation is a build diagnostic naming the property.',
          "Specify the wire-compatibility rules a user must follow (never renumber, never change a field's type) and note that zmdb cannot enforce them across versions — but that a snapshot of numbers *could*, and say whether that is in scope (it is not, for this epic; name it as a follow-up).",
          'Write the refusal list with a reason per entry, and the non-goals.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Complete scalar and composite mapping tables, with defaults chosen to avoid silent truncation.',
          'Presence semantics written out including the zero-value case.',
          'Enum zero-value, `oneof` numbering and unknown-field policy decided.',
          'Field-number validation rules and every refusal specified with its message.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] protobuf — round trips, cross-implementation bytes, and the refusals',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land failing tests covering every scalar and composite, the presence edge cases, byte-exact vectors, cross-implementation interop, and every build refusal.',
        why: "A round-trip test proves self-consistency, which is the property a wrong implementation also has. So the suite needs byte-exact expectations for known values (taken from the protobuf specification's own examples, and from a reference encoder) and at least one test that goes through another implementation.",
        files: [
          '`packages/compiler/src/protobuf/protobuf.spec.ts` (new)',
          '`packages/compiler/src/protobuf/interop.spec.ts` (new) — against a reference implementation.',
          '`packages/compiler/src/emit/emit.spec.ts` — descriptor snapshots.',
          '`packages/compiler/src/transform-code.spec.ts` — `CALLEES`.',
        ],
        tests: [
          '`encodes a varint field to the bytes the specification gives` — the canonical `150` → `08 96 01` vector, byte-exact.',
          '`zigzags a negative sint32` — `-1` → `01`, which is the test that fails when zigzag is forgotten.',
          '`omits a required field holding its zero value` — the proto3 implicit-presence rule.',
          '`decodes an absent required field to its zero value` — the other half, and the pair that catches a naive implementation.',
          '`distinguishes an explicit optional zero from an absent optional`.',
          '`round-trips every supported scalar` — table-driven, including `bigint` bounds and `bytes`.',
          '`packs a repeated numeric field` — proto3 packs by default, and an unpacked encoder is still decodable, so this test must assert the bytes rather than the round trip.',
          '`round-trips a nested message, a map and an enum`.',
          '`encodes a discriminated union as a oneof`.',
          '`preserves unknown fields across a decode and re-encode` — or asserts they are dropped, per the spec.',
          '`emits a .proto descriptor that a reference parser accepts` — feed the output to `protobufjs`.',
          '`decodes bytes produced by a reference implementation` and `produces bytes a reference implementation decodes` — the interop pair, which is the real correctness gate.',
          '`refuses a message with a missing field number, naming the property`.',
          '`refuses duplicate field numbers, naming both properties`.',
          '`refuses a reserved field number`.',
          '`refuses an untagged integer where the spec requires an explicit width`.',
          '`recognises the protobuf callees in the transformer` — `CALLEES` list assertion.',
        ],
        steps: [
          'Add the reference implementation as a dev dependency only, and note in the test file why it is a dev dependency: it is the oracle, and shipping it would defeat the purpose of emitting our own codec.',
          'Take byte vectors from the protobuf encoding documentation where it gives them, and cite the source in a comment next to each. A hand-computed expectation is a second implementation with no oracle.',
          'Write the presence pair (omitted zero / absent decodes to zero) as two adjacent tests with a comment explaining that they are a pair, so neither is "simplified" away later.',
          'Add the callee names to `CALLEES` in this slice with its sorted-list assertion.',
        ],
        dod: [
          'Byte-exact vectors with cited sources; interop tests both directions; every refusal tested by message.',
          'Reference implementation is a dev dependency only.',
          '`node scripts/typecheck.mjs` green.',
        ],
      },
      {
        key: 'ir',
        title: 'Field-number tags in the IR, and descriptor emission',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Add the `Field<N>`/`Proto<K>` tags, validate numbering in the reflection, carry both into the IR, and emit a valid `.proto` descriptor. No wire codec yet.',
        why: 'The descriptor is the readable half: a wrong descriptor is visible, and a reference parser can check it. Getting it right first gives the codec slices a checked description of what they must produce.',
        files: [
          '`packages/schema-core/src/tags/index.ts` — the two tags.',
          '`packages/schema-core/src/ir/index.ts` — `ColumnIR`/`TypeIR` carriage, and `vocabulary.type-test.ts`.',
          '`packages/compiler/src/reflect/index.ts` — read the tags, validate numbering.',
          '`packages/compiler/src/protobuf/descriptor.ts` (new) — `.proto` text emission.',
        ],
        steps: [
          'Add the tags as phantom symbol types like the rest of the vocabulary, so they compile to nothing.',
          'Read them in the reflection and validate: complete, unique, in range, not reserved. Report through the existing diagnostic channel, naming the *property* — and note that `EmitDiagnostic.path` currently carries an emitted-expression fragment, so do not route these through it without checking what the message will read like.',
          'Emit proto3 text deterministically: fields ordered by number, nested messages before use, one enum per string union with the zero-member rule the spec chose.',
          'Handle name collisions: two nested types with the same TypeScript name in different scopes need distinct proto message names. Generate deterministically and test two colliding types.',
          'Validate the output by parsing it with the reference parser in the test, rather than by snapshot alone — a snapshot proves stability, not validity.',
        ],
        tests: [
          'The descriptor and refusal tests go green.',
          '`emits a .proto descriptor that a reference parser accepts`.',
          '`names two colliding nested types distinctly and deterministically`.',
          '`orders fields by number in the descriptor`.',
        ],
        dod: [
          'Tags shipped and carried in the IR; numbering validated with per-property diagnostics; descriptor emitted and validated by a reference parser.',
        ],
      },
      {
        key: 'encode',
        title: 'AOT protobuf encoder',
        labels: ['enhancement'],
        blockedBy: ['ir'],
        goal: 'Emit an encoder per type: varint, zigzag, fixed-width, length-delimited, packed repeated, maps, nested messages and proto3 presence rules — writing into a growable buffer with no per-field lookup.',
        files: [
          '`packages/compiler/src/protobuf/encode.ts` (new) — emission.',
          '`packages/protobuf/src/wire.ts` — the varint/zigzag primitives the emitted code calls.',
          '`packages/compiler/src/transform/index.ts` — the `protoEncode` callee.',
        ],
        steps: [
          'Emit straight-line code per field in number order: tag byte, then value. No loop over a descriptor — that is the runtime reflection this project rejects, and it is also slower.',
          'Put the varint/zigzag primitives in a small runtime module the emitted code imports, rather than inlining them per field; that keeps emitted size down and gives one place to test the bit twiddling. Check the result against `yarn verify:build-budget`.',
          "Implement length-delimited nesting correctly: a nested message's length is not known until it is encoded, so either encode into a scratch buffer and prepend the length, or reserve and backfill. Backfilling is faster and fiddlier; whichever is chosen, test a nested message longer than 127 bytes, because that is where a single-byte length reservation breaks.",
          'Implement packed repeated fields for the scalar types proto3 packs, and leave the rest unpacked — with a test asserting bytes, since both are decodable.',
          'Implement presence: omit a required zero, always write an explicit optional that is present.',
          'Implement `bigint` for 64-bit types, and make sure the code does not silently pass through `Number()` anywhere — a `number` cannot represent every `int64`, and the loss would be silent.',
          'Grow the output buffer geometrically and return an exactly-sized `Uint8Array` (a subarray view of a larger buffer that the caller then retains would hold the whole allocation).',
        ],
        tests: [
          'Every encode test from the tests-freeze slice goes green, including the byte-exact vectors.',
          '`encodes a nested message longer than 127 bytes` — the length-prefix boundary.',
          '`does not lose precision encoding a 64-bit integer` — a value above 2^53.',
          '`returns an exactly-sized array` — `byteLength` equals the encoded length.',
          '`produces bytes a reference implementation decodes` — interop.',
        ],
        dod: [
          'Straight-line emission, no descriptor walked at runtime.',
          'Length-prefix boundary, packing, presence and 64-bit precision all tested.',
          'Interop in the produce direction green; build budget within limits.',
        ],
      },
      {
        key: 'decode',
        title: 'AOT protobuf decoder',
        labels: ['enhancement'],
        blockedBy: ['ir', 'encode'],
        goal: 'Emit a decoder per type that reads any valid encoding of the message — including field orders and wire forms our encoder does not produce — and handles unknown fields, truncated input and malicious lengths safely.',
        why: 'The decoder is the security-relevant half: its input is bytes from another process. A decoder that trusts a length prefix can be made to allocate gigabytes by four bytes of input, and a decoder that only handles the bytes our own encoder emits will fail against every other implementation.',
        files: [
          '`packages/compiler/src/protobuf/decode.ts` (new)',
          '`packages/protobuf/src/wire.ts`',
          '`packages/compiler/src/transform/index.ts` — the `protoDecode` callee.',
        ],
        steps: [
          'Emit a tag-dispatch loop with a switch on the field number — a switch over known numbers is the one loop that has to exist, because a decoder cannot know the field order in advance.',
          'Handle every wire type for a known field number, including the ones our encoder never emits: an unpacked repeated scalar, a packed field where a scalar was expected, a field appearing twice (last one wins for a scalar, concatenation for repeated).',
          'Bound every allocation by the remaining input length before allocating. A length prefix claiming 2^31 bytes must produce an error, not an allocation attempt.',
          'Reject truncated input with a clear error naming the offset, and test with every truncation of a valid message (a loop over `bytes.subarray(0, i)`), which is a cheap and very effective fuzz.',
          'Handle unknown fields per the spec decision: skip by wire type, or collect for re-encoding. Skipping still requires correct length handling for each wire type, including the deprecated group types, which must be refused rather than mishandled.',
          "Produce the zero value for an absent required field, matching the encoder's omission.",
          'Return a value the emitted code has actually established the shape of, so no `as` is needed. If the byte boundary forces one, document it with a `// boundary:` comment and expect `yarn verify:escape-hatches` to count it.',
        ],
        tests: [
          'Every decode test from the tests-freeze slice goes green.',
          '`decodes fields presented out of order`.',
          '`decodes an unpacked repeated field that our encoder would pack`.',
          '`takes the last value when a scalar field repeats`.',
          '`rejects a length prefix larger than the remaining input, without allocating`.',
          '`rejects every truncation of a valid message` — loop over prefixes.',
          '`skips an unknown field of every wire type`.',
          '`refuses a deprecated group field with a clear error`.',
          '`decodes bytes produced by a reference implementation` — interop.',
        ],
        dod: [
          'Reads any valid proto3 encoding of the message, not just ours.',
          'Every allocation bounded by input length; truncation fuzz passes for all prefixes.',
          'Interop in the consume direction green.',
          '`yarn verify:escape-hatches` green, with any boundary cast documented.',
        ],
      },
      {
        key: 'docs',
        title: '[Docs] protobuf messages, encode and decode',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['ir', 'encode', 'decode'],
        goal: 'Flip all three pages to supported, document the numbering tags and the wire-compatibility discipline, and state the scope limits.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/protobuf-message.md`, `docs-site/content/protobuf-encode.md`, `docs-site/content/protobuf-decode.md`',
          '`tests/api-coverage/mapping.mjs` — Typia protobuf suites.',
        ],
        steps: [
          'Lead the message page with the numbering tag and the rules that keep the wire compatible, because that is the part a reader can get wrong in a way no test catches.',
          'Document the presence semantics with the zero-value example spelled out — it surprises everyone once.',
          'Document `bigint` for 64-bit types and the explicit-width requirement for integers, including why there is no silent default.',
          'Document the unknown-field policy and what it means for a service in the middle of a version rollout.',
          'List the non-goals (proto2, gRPC services, runtime `.proto` parsing) and point at the transport epic for services.',
          'Show the interop test as evidence rather than claiming compatibility.',
          "Re-point Typia's protobuf suites; refresh README counts.",
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage`, `yarn verify:api-coverage` green.'],
        dod: [
          'Three pages supported; numbering, presence, 64-bit and unknown-field behaviour documented; scope limits stated; suites re-pointed.',
        ],
      },
    ],
  },

  {
    key: 'lint',
    title: '[EPIC] A lint plugin for the mistakes the type system cannot catch',
    labels: ['enhancement', 'area:validator', 'documentation'],
    pages: ['lint-rules'],
    packages: ['@zmdb/compiler'],
    motivation: `
zmdb's central bet is that the type system catches schema mistakes. It does — but there is a residue
it structurally cannot catch, and every item in that residue is currently found in production instead.

The largest is the AOT boundary. \`schemaOf<T>()\` is a compile-time call whose answer depends on a
build transform; an untransformed build throws a runtime error with a good message, which is the right
fallback and still means the developer finds out at runtime. A lint rule can see the call and the
absence of the plugin, and say so while they are typing.

The rest are the same shape: a \`Serial\` column included in a \`CreateDTO\` (harmless but confusing),
an \`update\` with an empty patch (a no-op statement), a \`findById\` on a schema with no primary key
(a guaranteed throw), a raw SQL fragment built by concatenating a variable (an injection), a
\`where\` key that is not a column (a runtime error the typed path prevents but an untyped call site
does not). None of these are type errors, all of them are mechanical to detect, and the repo already
has the AST tooling to detect them — the reflection is a TypeScript AST reader.

There is also a self-serving reason, and it is a good one: the anti-patterns page argues that certain
things are wrong to do with this library. A lint rule is that argument made executable.
`,
    dod: [
      'A shipped plugin with rules that run under oxlint and ESLint, or — if oxlint plugin support cannot host them — a documented, honest choice of one host with the reason.',
      'At least the AOT-boundary rule, the raw-SQL-concatenation rule, the empty-patch rule and the no-primary-key rule, each with tests over fixture code.',
      'Every rule has a documented rationale, a code example of the mistake, and an autofix where the fix is unambiguous.',
      'The plugin is dogfooded: it runs over this repo in CI and the repo passes it.',
      '`lint-rules` flips to supported, listing every rule with its rationale.',
    ],
    invariants: [
      '§2.6 no over-abstraction: rules are small and independent. No rule framework beyond what the host lint API provides.',
      'A rule that produces false positives is worse than no rule — it teaches developers to disable the plugin. Each rule must be provably precise on the fixtures, and a rule that cannot be made precise ships as a warning or not at all.',
      'The plugin is a development dependency of a consumer, never a runtime one.',
    ],
    subs: [
      {
        key: 'spec',
        title: '[Spec Freeze] the rule set, the host, and the false-positive bar',
        labels: ['spec'],
        goal: 'Decide which lint host(s) the plugin targets, enumerate the rules with their exact detection criteria and autofix behaviour, and set the precision bar a rule must clear to ship as an error rather than a warning.',
        why: "The host decision is a real constraint, not a preference: this repo lints with oxlint, whose plugin support differs from ESLint's, and a rule set designed for one may not be expressible in the other. Deciding first avoids writing rules twice or writing them for a host the project does not use. The precision bar matters just as much — a plugin that cries wolf gets added to an ignore list, and then none of the rules run.",
        files: [
          '`packages/compiler/src/lint/SPEC.md`',
          '`docs-site/content/anti-patterns.md` — which arguments become rules.',
        ],
        api: `
// The shipped surface, whichever host wins:
export const rules: Record<string, Rule>;
export const configs: { readonly recommended: unknown; readonly strict: unknown };
`,
        steps: [
          'Establish what the hosts can do: check the oxlint version in this repo (`yarn lint` runs it) and whether its plugin API can express these rules today. Write the finding down — including "it cannot, so we target ESLint and say so" if that is the answer.',
          'Enumerate the rules, each with: the pattern detected, the exact AST shape, whether an autofix is safe, the message text, and the severity in `recommended` versus `strict`.',
          'For `no-untransformed-schema-of`: specify detection precisely. The rule cannot see the build config from the AST alone, so decide whether it reads `tsconfig`/`vite.config`/`zmdb.config` from disk (precise, more machinery) or reports only on a call in a file whose project lacks the plugin (heuristic, risks false positives). Pick one and state the failure mode.',
          'For `no-sql-concatenation`: specify what counts. A template literal with an expression inside a raw fragment is the target; a template literal with no expressions is fine. Note the interaction with the expression-index and filter features, which legitimately take SQL strings — so the rule must target the *dynamic* case only.',
          'For `no-empty-patch`: an `update` call with an object literal that has no properties. Autofixable only by deletion, which changes behaviour if the call was awaited for its error, so specify it as a report without a fix.',
          'For `no-find-by-id-without-key`: requires knowing the schema type, which means type information — an ESLint typed rule or nothing. Say which.',
          "Set the precision bar: a rule ships as an error only if it produces zero findings on this repo's own source except where a finding is a genuine bug. Anything else ships as a warning, and the spec says why.",
          'Keep the rule set behind `@zmdb/compiler/lint`, so a runtime-only validator install cannot reach TypeScript or the lint host.',
        ],
        tests: ['None — spec only.', '`yarn validate:spec` green.'],
        dod: [
          'Host decision recorded with the evidence for it.',
          'Every rule specified with its AST shape, message, autofix decision and severity.',
          'The false-positive bar written down as a shipping criterion.',
          'Packaging decision made.',
        ],
      },
      {
        key: 'tests',
        title: '[Tests Freeze] lint rules — valid and invalid fixtures for every rule',
        labels: ['spec'],
        blockedBy: ['spec'],
        goal: 'Land the rule test suites with valid and invalid cases per rule, weighted toward the valid cases that a sloppy implementation would flag.',
        why: 'Lint rule tests are unusual in that the *negative* cases carry the value: the invalid cases prove the rule fires, and the valid cases prove it does not fire on legitimate code, which is the failure mode that gets a plugin uninstalled.',
        files: [
          '`packages/compiler/src/lint/rules/*.spec.ts`',
          '`packages/compiler/src/lint/__fixtures__/` — realistic code samples.',
        ],
        tests: [
          'Per rule: `reports <the mistake>` with the exact message and location, and `does not report <the legitimate near-miss>` for at least two near-misses.',
          '`no-sql-concatenation` valid cases: a static template literal, a parameterised `where`, an `IndexDef.expr` that is a constant.',
          '`no-sql-concatenation` invalid cases: an interpolated variable, a `+` concatenation, an interpolation inside a filter fragment.',
          '`no-untransformed-schema-of` valid: a project with the plugin configured. Invalid: one without.',
          '`no-empty-patch` valid: a patch built from a variable (unknowable), a patch with one property. Invalid: a literal `{}`.',
          '`no-find-by-id-without-key` valid: a keyed schema. Invalid: a keyless one.',
          '`applies the autofix without changing behaviour` — for each rule that has one, assert the fixed output compiles.',
          "`reports nothing on this repository's own source` — the dogfooding gate, as a test or a CI step.",
        ],
        steps: [
          "Use the host's rule tester so the tests exercise the real integration, not a hand-rolled harness.",
          'Write at least two valid near-misses per rule before writing the invalid cases — that ordering is what keeps a rule precise.',
          'Put the dogfooding check somewhere it runs in CI, and let it fail. It is the test that proves the plugin is worth installing.',
        ],
        dod: [
          'Every rule has invalid and at least two valid near-miss cases; autofix outputs asserted to compile; a dogfooding check exists and runs in CI.',
        ],
      },
      {
        key: 'rules',
        title: 'Implement the rule set',
        labels: ['enhancement'],
        blockedBy: ['tests'],
        goal: 'Implement every specified rule against the chosen host, with the messages and autofixes the spec fixed, precise enough to clear the false-positive bar on this repo.',
        files: [
          '`packages/compiler/src/lint/index.ts` — the plugin entry, `rules` and `configs`.',
          '`packages/compiler/src/lint/rules/*.ts`',
          '`package.json` / a new package manifest per the packaging decision.',
        ],
        steps: [
          'Implement the rules independently — no shared base class, no rule framework. Shared *helpers* for AST predicates are fine and expected.',
          "Reuse the reflection's AST knowledge where it applies rather than re-deriving how a zmdb declaration looks, but do not make the lint plugin depend on the transformer at runtime — a lint rule loading a TypeScript program twice is slow enough that people turn it off.",
          'Implement autofixes only where the spec said they are safe, and make each fix idempotent (running the fixer twice produces the same file).',
          'Ship `recommended` and `strict` configs with the severities the spec assigned.',
          'Run the plugin over this repository and fix what it finds — or, where a finding is a false positive, fix the rule. Record any legitimate findings as separate issues rather than fixing unrelated code in this slice.',
        ],
        tests: [
          'All rule tests go green.',
          "`reports nothing on this repository's own source`.",
          '`applies every autofix idempotently`.',
        ],
        dod: [
          'Every specified rule implemented with its message and severity; configs shipped.',
          'Zero false positives on this repo; genuine findings filed as their own issues.',
          'No runtime dependency on the transformer.',
        ],
      },
      {
        key: 'ci',
        title: "Run the plugin in this repository's CI",
        labels: ['enhancement'],
        blockedBy: ['rules'],
        goal: "Wire the plugin into `yarn lint` (or a sibling script) and into CI, so the repo is the plugin's first user and a regression in either is caught.",
        why: "A lint plugin that its own authors do not run is untested in the only way that counts. This also makes the plugin's cost visible — if it doubles lint time, that is a fact worth knowing before recommending it.",
        files: [
          '`package.json` — the lint script or a new `lint:zmdb`.',
          '`.github/workflows/ci.yml` — the CI step.',
          '`.oxlintrc.json` / the ESLint config, per the host decision.',
        ],
        steps: [
          "Add the plugin to the repo's own lint configuration with the `recommended` config.",
          'Add the CI step next to the existing lint step, and note the added wall-clock time in the PR — the repo has a build-budget culture and lint time belongs to it.',
          'If the host is not oxlint, be explicit in the docs and the CI config about why the repo now runs two linters, and keep the split legible (oxlint for general rules, the plugin for zmdb rules).',
        ],
        tests: [
          '`yarn lint` (and the new script, if separate) green locally and in CI.',
          'The dogfooding check is part of CI rather than only a unit test.',
        ],
        dod: ["Plugin runs in this repo's CI; added time recorded; the two-linter situation documented if it exists."],
      },
      {
        key: 'docs',
        title: '[Docs] lint rules — every rule with its rationale',
        labels: ['documentation'],
        docs: true,
        blockedBy: ['rules', 'ci'],
        goal: 'Flip `lint-rules` to supported with a rule reference: what each rule catches, why it matters, the code that triggers it, and how to disable it responsibly.',
        files: [
          '`docs-site/pages.mjs`, `docs-site/content/lint-rules.md`',
          '`docs-site/content/anti-patterns.md` — link the arguments that are now enforced.',
          '`docs-site/content/aot-setup.md` — the AOT rule is the best possible advertisement for that page.',
        ],
        steps: [
          'Write one section per rule: the mistake, why it is a mistake, the fix, and whether there is a legitimate reason to disable it. A rule with no legitimate exception should say so.',
          "Document installation for the chosen host, and say plainly if the repo's own linter is a different one.",
          'Cross-link from the anti-patterns page: the arguments there that are now machine-checked should say so.',
          'Add the rule to the AOT setup page as the recommended way to avoid the untransformed-build error.',
          'Refresh README counts.',
        ],
        tests: ['`node docs-site/build.mjs`, `yarn verify:docs-coverage` green.'],
        dod: [
          'Page supported with a per-rule reference including rationale and legitimate exceptions; anti-patterns and AOT pages cross-linked.',
        ],
      },
    ],
  },
];
