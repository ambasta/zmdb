// Type-level tests for the chat loop surface frozen in ./SPEC.md (#532, epic #530).
//
// This file is compiled by `node scripts/typecheck.mjs` and never run: `*.type-test.ts` is not
// in vitest's `include`, so a `@ts-expect-error` here is an assertion that the compiler
// *does* report an error, and an unused one is TS2578 — a build failure. That is the whole
// mechanism, and it is the only one that can freeze the two claims ./SPEC.md §3 and §4 make
// which no runtime test can reach: that a tool's argument type is inferred from its own
// validator, and that forgetting `approve` on an effectful registry does not compile.
//
// The real surface is imported below. The registry uses an erased runtime entry while
// `defineTools` applies a key-by-key linked constraint, so each handler is checked against
// its own validator without making the registry uninhabitable.
import type { Equal, Expect, Extends } from '@zmdb/schema-core';

import type { ToolSpec } from '../index.js';
import {
  defineTools,
  run,
  type ChatDriver,
  type ChatMessage,
  type RunOptions,
  type RunResult,
  type ToolCall,
  type ToolRegistry,
} from './index.js';

interface CreateUser {
  readonly email: string;
  readonly admin: boolean;
}

interface ReadUser {
  readonly id: string;
}

declare const anySpec: ToolSpec;
declare const driver: ChatDriver;
declare const approve: (call: ToolCall) => Promise<boolean>;
declare const conversation: readonly ChatMessage[];

// ---------------------------------------------------------------------------
// §3 — the registry is inhabitable, and defineTools links each validator to its handler
// ---------------------------------------------------------------------------

const realEntries = {
  create_user: {
    spec: anySpec,
    validate: (args: unknown): CreateUser => args as CreateUser,
    handler: (input: CreateUser) => input.email,
  },
  read_user: {
    spec: anySpec,
    validate: (args: unknown): ReadUser => args as ReadUser,
    handler: (input: ReadUser) => input.id,
    effectful: false,
  },
} as const;

const registryAdmitsRealTools: ToolRegistry = realEntries;
void registryAdmitsRealTools;

const inferred = defineTools(realEntries);
type Inferred = typeof inferred;

const contextuallyInferred = defineTools({
  create_user: {
    spec: anySpec,
    validate: (args: unknown): CreateUser => args as CreateUser,
    handler: input => input.email,
  },
});
type _UnannotatedHandlerTakesValidatorOutput = Expect<
  Equal<Parameters<typeof contextuallyInferred.create_user.handler>, [CreateUser]>
>;

// §3: `defineTools` is an identity function whose only job is to keep the literal keys and the
// per-entry types the caller wrote, so `run` can read `effectful` off them.
type _DefineToolsIsIdentity = Expect<Equal<Inferred, typeof realEntries>>;
type _KeysSurviveDefineTools = Expect<Equal<keyof Inferred, 'create_user' | 'read_user'>>;

// §3: the handler's parameter type comes from the entry's own validator, with no annotation on
// the handler and no schema-derived type anywhere. That is the property that makes a registry
// worth writing in TypeScript at all, so it is asserted on the inferred object rather than on
// a hand-written entry type.
type CreateUserHandler = Inferred['create_user']['handler'];
type _HandlerTakesValidatorOutput = Expect<Equal<Parameters<CreateUserHandler>, [CreateUser]>>;
type ReadUserHandler = Inferred['read_user']['handler'];
type _SecondHandlerIsIndependent = Expect<Equal<Parameters<ReadUserHandler>, [ReadUser]>>;

// And the two entries do not collapse into one another: an entry's type is its own.
type _EntriesAreNotUnified = Expect<Equal<Equal<CreateUserHandler, ReadUserHandler>, false>>;

const missingValidator = defineTools({
  // @ts-expect-error — chat SPEC §3: a tool cannot be registered without a validator
  create_user: {
    spec: anySpec,
    handler: (_input: CreateUser) => 'created',
  },
});
void missingValidator;

const mismatched = {
  create_user: {
    spec: anySpec,
    validate: (args: unknown): CreateUser => args as CreateUser,
    handler: (input: ReadUser) => input.id,
  },
};
// @ts-expect-error — chat SPEC §3: the handler must accept the validator's CreateUser output
const mismatchedRegistry = defineTools(mismatched);
void mismatchedRegistry;
// @ts-expect-error — bypassing defineTools must not bypass validator/handler correlation
void run(driver, conversation, mismatched, { maxTurns: 4, approve });

// ---------------------------------------------------------------------------
// §4 — approval is required by the type when, and only when, a tool is effectful
// ---------------------------------------------------------------------------

type EffectfulRegistry = typeof realEntries;
type EffectfulInputs = { readonly create_user: CreateUser; readonly read_user: ReadUser };

const pureEntries = {
  read_user: {
    spec: anySpec,
    validate: (args: unknown): ReadUser => args as ReadUser,
    handler: (input: ReadUser) => input.id,
    effectful: false,
  },
} as const;
type PureRegistry = typeof pureEntries;
type PureInputs = { readonly read_user: ReadUser };

// §4's safe-degradation claim, which is the reason the conditional is written against
// `{ readonly effectful: false }` rather than against `true`. Two ways to lose the literal —
// dropping `as const` so `false` widens to `boolean`, and erasing the keys to the registry type
// — and both must land on `true`, because a wrong `false` here would silently make `approve`
// optional on a registry that deletes rows.
const widenedEntries = {
  read_user: {
    spec: anySpec,
    validate: (args: unknown): ReadUser => args as ReadUser,
    handler: (input: ReadUser) => input.id,
    effectful: false,
  },
};
void run(driver, conversation, widenedEntries, { maxTurns: 4, approve });
// @ts-expect-error — a widened `false` degrades safely to effectful
void run(driver, conversation, widenedEntries, { maxTurns: 4 });
declare const dynamicRegistry: ToolRegistry;
void run(driver, conversation, dynamicRegistry, { maxTurns: 4, approve });
// @ts-expect-error — an erased/dynamic registry must still provide approval
void run(driver, conversation, dynamicRegistry, { maxTurns: 4 });

// The two option shapes, observed through the real generic `run` boundary.
type EffectfulOptions = Parameters<typeof run<EffectfulInputs, EffectfulRegistry>>[3];
type _EffectfulOptionsRequireApprove = Expect<Extends<EffectfulOptions, { readonly approve: unknown }>>;
type PureOptions = Parameters<typeof run<PureInputs, PureRegistry>>[3];
type _PureOptionsAreJustRunOptions = Expect<Equal<PureOptions, RunOptions>>;
type _PureOptionsDoNotRequireApprove = Expect<Equal<Extends<PureOptions, { readonly approve: unknown }>, false>>;

const withApprove: EffectfulOptions = { maxTurns: 4, approve };
void withApprove;

// @ts-expect-error — chat SPEC §4: an effectful registry's options must supply `approve`
const withoutApprove: EffectfulOptions = { maxTurns: 4 };
void withoutApprove;

const pureWithoutApprove: PureOptions = { maxTurns: 4 };
void pureWithoutApprove;

// §4: `maxTurns` has no default, so it is required — and the error lands on the declaration,
// not on any property, because the property is the one that is not there.
// @ts-expect-error — chat SPEC §4: `maxTurns` is required and has no default
const noMaxTurns: PureOptions = { maxToolCallsPerTurn: 4 };
void noMaxTurns;

// Under `exactOptionalPropertyTypes`, "I have no opinion about the cap" is written by omitting
// the key, not by passing `undefined` — the distinction that keeps §4's default from being
// overridden by an accidental `undefined` read out of a config object.
// @ts-expect-error — exactOptionalPropertyTypes: an optional cap is omitted, never set to undefined
const explicitUndefinedCap: PureOptions = { maxTurns: 4, maxToolCallsPerTurn: undefined };
void explicitUndefinedCap;

// The `run` call site is where §4's requirement is actually felt, so it is asserted there too:
// the same registry with and without `approve`, at the argument position.
void run(driver, conversation, realEntries, { maxTurns: 4, approve });
// @ts-expect-error — chat SPEC §4: `run` will not accept an effectful registry without `approve`
void run(driver, conversation, realEntries, { maxTurns: 4 });
void run(driver, conversation, pureEntries, { maxTurns: 4 });

// ---------------------------------------------------------------------------
// §5 — the result is a value, and its termination reason is exhaustive
// ---------------------------------------------------------------------------

declare const result: RunResult;

type _StopIsThreeReasons = Expect<Equal<RunResult['stop'], 'complete' | 'max-turns' | 'max-tool-calls'>>;

// A fourth reason is not addable by a caller, and not assertable by a test that forgot one:
// this is what makes a `switch` over `stop` exhaustive at the call site.
// @ts-expect-error — chat SPEC §5 freezes three stop reasons; 'error' is not one of them
const unknownStop: RunResult['stop'] = 'error';
void unknownStop;

// §5's counters are numbers on the result, not something the caller reconstructs from the
// message list — and `budget` is one of them, because §4 calls it "the number that matters".
type _CountersAreOnTheResult = Expect<
  Extends<RunResult, { readonly turns: number; readonly toolCalls: number; readonly budget: number }>
>;

// §6: the caller gets the untouched error, and it is `unknown` — the loop does not claim it is
// an `Error`, because a handler can throw anything.
type ErrorEntry = RunResult['errors'][number];
type _CallerSeesTheRawError = Expect<Equal<ErrorEntry['error'], unknown>>;
type _ErrorIdIsAString = Expect<Equal<ErrorEntry['errorId'], string>>;

// …so reading a message off it is a compile error at the expression, not a runtime surprise.
// @ts-expect-error — chat SPEC §6 keeps the raw error `unknown`: a handler may throw a string
const rawErrorMessage: string = result.errors[0]?.error.message;
void rawErrorMessage;

// The result is deeply read-only: §2.7 says a conversation is a value the caller owns, and a
// caller who can push onto `result.messages` does not own it.
// @ts-expect-error — chat SPEC §5: `messages` is a readonly array on the result
result.messages.push({ role: 'user', content: 'mutating the transcript' });

// ---------------------------------------------------------------------------
// §1 — the message union, and the `unknown` that stays unknown
// ---------------------------------------------------------------------------

type ToolMessage = Extract<ChatMessage, { readonly role: 'tool' }>;
type AssistantMessage = Extract<ChatMessage, { readonly role: 'assistant' }>;
type ProviderPassthrough = NonNullable<AssistantMessage['provider']>[number];

// §1: a tool result is answered against the call it answers, so `callId` is required on the
// tool variant and absent from every other one. Without it there is no way to pair a result
// with its call when a turn made several.
type _ToolMessageCarriesCallId = Expect<Equal<ToolMessage['callId'], string>>;
// @ts-expect-error — chat SPEC §1: a tool message must name the call it answers
const toolWithoutCallId: ToolMessage = { role: 'tool', content: 'ran' };
void toolWithoutCallId;

// `callId` on the tool variant, `id` on the call: the names differ, and the type test pins the
// distinction directly.
type _CallUsesIdNotCallId = Expect<Equal<keyof ToolCall, 'id' | 'name' | 'args'>>;
// @ts-expect-error — chat SPEC §1: `ToolCall` has no `callId`; the tool *message* does
const callHasNoCallId: string = ({} as ToolCall).callId;
void callHasNoCallId;

// §1: only an assistant message can request tools. A user message that carried `toolCalls`
// would let a caller forge a call the model never made.
// @ts-expect-error — chat SPEC §1: only the assistant variant carries `toolCalls`
const userWithToolCalls: ChatMessage = { role: 'user', content: 'hi', toolCalls: [] };
void userWithToolCalls;

// §1: `args` came off a network from a language model, so it is `unknown` and stays `unknown`.
// The single most valuable compile error in the whole surface: it forces the validator call.
declare const call: ToolCall;
type _ArgsStayUnknown = Expect<Equal<ToolCall['args'], unknown>>;
// @ts-expect-error — chat SPEC §1: `args` is unknown until the entry's validator has run
const unvalidatedEmail: string = call.args.email;
void unvalidatedEmail;

// §1.1: the passthrough block is opaque. `raw` is `unknown`, so the loop cannot be written in
// a way that depends on a provider's field names — which is the point of §2.1's vendor rule.
type _PassthroughRawIsOpaque = Expect<Equal<ProviderPassthrough['raw'], unknown>>;
type _PassthroughIsOptionalOnAssistant = Expect<
  Equal<AssistantMessage['provider'], readonly ProviderPassthrough[] | undefined>
>;

// §2: the driver sees `ToolSpec`s — the real, already-shipping type from `../index.js` — and
// never the registry. It cannot reach a handler, a validator or an `effectful` flag.
type DriverTools = Parameters<ChatDriver['next']>[1];
type _DriverSeesOnlyToolSpecs = Expect<Equal<DriverTools, readonly ToolSpec[]>>;
type _DriverCannotSeeHandlers = Expect<Equal<Extends<DriverTools, readonly ToolRegistry[string][]>, false>>;
