import type { TransactionContext } from '@zmdb/repository/transactions';
import type { Equal, Expect, Mutual } from '@zmdb/schema-core';

import {
  createCommandBus,
  type CommandBus,
  type CommandBusOptions,
  type CommandHandlers,
  type CommandOutcome,
  type CommandRun,
} from './index.js';

// Compile-time contract for packages/web/src/cqrs/SPEC.md §7: items 1, 2, 3
// and 5. All four are closure properties of the mapped types in §2 — "Adding a key to `M` without
// adding a handler is a missing-property error, and adding a handler for a command the map does not
// declare is an excess-property error — which is the closure property a registry keyed on strings
// cannot have." A runtime test can see none of that, which is why §7 sends four of its twelve items
// here.
//
// No runtime code. Compiled by `node scripts/typecheck.mjs`, not run by vitest.
//
// ON `@ts-expect-error` PLACEMENT, because it is the one thing that makes this file fragile and the
// rule is not what it looks like. Verified 2026-09-04 with the repo's own tsc:
//
//   * a MISSING map entry is TS2741 and is reported on the DECLARATION line;
//   * an EXCESS property is TS2353, a wrong RESULT type is TS2322 and a bad FIELD ACCESS is TS2339,
//     and all three are reported on the offending PROPERTY or EXPRESSION line.
//
// So every negative below is written as a `const` with an explicit annotation and the directive
// sits wherever the compiler actually reports — a directive on the wrong line fails the build with
// TS2578, "Unused '@ts-expect-error' directive", which is a confusing way to learn this. Where an
// `Expect<Equal<…>>` can make the same claim it is given as well, because that form has no
// placement question at all.

// A TYPE ALIAS, not an interface — see the block at the end of this file.
type Commands = {
  readonly publishPost: {
    readonly input: { readonly postId: number };
    readonly result: { readonly url: string };
  };
  readonly deleteUser: {
    readonly input: { readonly userId: string };
    readonly result: void;
  };
};

const validate: CommandBusOptions<Commands>['validate'] = {
  publishPost: raw => raw as { readonly postId: number },
  deleteUser: raw => raw as { readonly userId: string },
};

// ===========================================================================
// the positive baseline, first — so the negatives below cannot all be passing
// for one shared wrong reason
// ===========================================================================
const handlers: CommandHandlers<Commands> = {
  publishPost: async input => ({ url: `/p/${input.postId}` }),
  deleteUser: async () => undefined,
};
const bus = createCommandBus<Commands>(handlers, { validate });

// §2: "`bus.publishPost(input)` is checked against the map by name; there is no
// `dispatch(command: string, input: unknown)` whose `unknown` every handler has to re-narrow."
type _BusIsAMappedType = Expect<
  Equal<CommandBus<Commands>['publishPost'], (input: { readonly postId: number }) => Promise<{ readonly url: string }>>
>;
type _BusKeysAreTheMapKeys = Expect<Mutual<keyof CommandBus<Commands>, 'publishPost' | 'deleteUser'>>;

// §2 non-goal, "No `dispatch(command, payload)`", asserted as an absence rather than as prose.
type _NoDispatchMethod = Expect<Equal<'dispatch' extends keyof CommandBus<Commands> ? true : false, false>>;

// ===========================================================================
// §7 item 1 — a command missing from handlers is a compile error
// ===========================================================================
// TS2741, on the declaration line: "Property 'deleteUser' is missing in type … but required in type
// 'CommandHandlers<Commands>'". This is §2's "Adding a key to `M` without adding a handler is a
// missing-property error", which is the half a string-keyed registry cannot check at all.
// @ts-expect-error - deleteUser has no handler, so the map is not covered.
const handlersMissingOne: CommandHandlers<Commands> = {
  publishPost: async input => ({ url: `/p/${input.postId}` }),
};
void handlersMissingOne;

// And through the factory, which is where a caller actually hits it.
// @ts-expect-error - deleteUser has no handler, so createCommandBus refuses the literal.
const busMissingOne = createCommandBus<Commands>({ publishPost: async () => ({ url: '/p/1' }) }, { validate });
void busMissingOne;

// ===========================================================================
// §7 item 2 — a handler for a command not in the map is a compile error
// ===========================================================================
// TS2353, reported on the offending PROPERTY line, not on the declaration — hence the directive's
// position. §2: "adding a handler for a command the map does not declare is an excess-property
// error". The failure this prevents is a handler that is quietly never reachable, which reads as
// working code and is only found when someone wonders why a feature does nothing.
const handlersWithAnExtra: CommandHandlers<Commands> = {
  publishPost: async input => ({ url: `/p/${input.postId}` }),
  deleteUser: async () => undefined,
  // @ts-expect-error - archivePost is not a key of Commands: the map is closed.
  archivePost: async () => undefined,
};
void handlersWithAnExtra;

// ===========================================================================
// §7 item 3 — a handler's return type is checked against M[K]['result']
// ===========================================================================
// TS2322 on the property line: the handler resolves `{ slug: string }` where the map declares
// `{ url: string }`. This is the assertion that makes the result half of the map load-bearing —
// without it `M[K]['result']` is documentation and the controller's `await bus.publishPost(…)` is
// typed from a promise nobody checked.
const handlersWrongResult: CommandHandlers<Commands> = {
  // @ts-expect-error - publishPost must resolve { url: string }, not { slug: string }.
  publishPost: async input => ({ slug: `/p/${input.postId}` }),
  deleteUser: async () => undefined,
};
void handlersWrongResult;

// The input half of the same claim: the handler's parameter is `M[K]['input']`, so reading a field
// that input does not have is TS2339, on the expression.
const handlersWrongInput: CommandHandlers<Commands> = {
  publishPost: async input => ({
    // @ts-expect-error - 'userId' is not on { postId: number }.
    url: `/p/${input.userId}`,
  }),
  deleteUser: async () => undefined,
};
void handlersWrongInput;

// And from the caller's side, which is the line an application author writes.
// @ts-expect-error - publishPost takes { postId: number }, not { postId: string }.
void bus.publishPost({ postId: 'nine' });

// The result type as an equality too, so item 3 does not rest on directive placement alone.
type _HandlerResultIsTheMapResult = Expect<
  Equal<Awaited<ReturnType<CommandHandlers<Commands>['publishPost']>>, { readonly url: string }>
>;
type _BusResultIsTheMapResult = Expect<
  Equal<Awaited<ReturnType<CommandBus<Commands>['publishPost']>>, { readonly url: string }>
>;
// A void-result command still resolves a promise, so `await bus.deleteUser(…)` is legal and the
// mapped type does not need a special case for commands that return nothing.
type _VoidResultIsStillAPromise = Expect<Equal<ReturnType<CommandBus<Commands>['deleteUser']>, Promise<void>>>;

// §2: the bus takes ONE argument. The `ctx: CommandRun` second parameter belongs to the handler and
// is not part of the caller's surface — a caller who could pass a `CommandRun` could forge a
// transaction context.
type _BusTakesOneArgument = Expect<Equal<Parameters<CommandBus<Commands>['publishPost']>['length'], 1>>;
type _HandlerTakesTwo = Expect<Equal<Parameters<CommandHandlers<Commands>['publishPost']>['length'], 2>>;

// ===========================================================================
// §7 item 5 — validate must be total
// ===========================================================================
// TS2741 on the declaration line, for the same reason item 1 is. SPEC §2: "`Partial` would let the
// one command that skips validation be the one that needed it, which is §1's whole point aimed at
// itself. A command whose input needs no narrowing supplies the identity function, and writing that
// deliberately is the intended friction."
// @ts-expect-error - validate has no deleteUser entry, and validate is total.
const validateMissingOne: CommandBusOptions<Commands>['validate'] = {
  publishPost: raw => raw as { readonly postId: number },
};
void validateMissingOne;

// And through the factory. Note the directive is on the `validate:` PROPERTY here and on the
// declaration in the case above: the missing entry is inside a nested literal, so TS2741 is reported
// against the property that supplies it. Verified 2026-09-04 — a directive on the `const` line here
// fails with TS2578.
const busPartialValidate = createCommandBus<Commands>(handlers, {
  // @ts-expect-error - validate must cover every command.
  validate: { publishPost: raw => raw as { readonly postId: number } },
});
void busPartialValidate;

// `validate` itself is required, not merely total: `createCommandBus(handlers, {})` does not compile.
// @ts-expect-error - validate is a required option (§2).
const busNoValidate = createCommandBus<Commands>(handlers, {});
void busNoValidate;

// A validator must produce the declared input type, so `validate` cannot be satisfied by a function
// that returns the raw value untouched under a wider type.
const validateWrongOutput: CommandBusOptions<Commands>['validate'] = {
  // @ts-expect-error - a validator for publishPost must return { postId: number }.
  publishPost: () => ({ postId: 'nine' }),
  deleteUser: raw => raw as { readonly userId: string },
};
void validateWrongOutput;

// The totality of `validate` against the optionality of everything else, stated as a set — this is
// what §2's asymmetry with ../events/SPEC.md §2's per-event `validate` comes down to.
type RequiredBusOptions = {
  [K in keyof CommandBusOptions<Commands>]-?: {} extends Pick<CommandBusOptions<Commands>, K> ? never : K;
}[keyof CommandBusOptions<Commands>];
type _OnlyValidateIsRequired = Expect<Mutual<RequiredBusOptions, 'validate'>>;
type _ValidateIsTotal = Expect<Mutual<keyof CommandBusOptions<Commands>['validate'], 'publishPost' | 'deleteUser'>>;

// ===========================================================================
// §4 and §5 — the outcome and the run context
// ===========================================================================

// §4: the outcome is a DISCRIMINATED union, not `{ ok: boolean; error?: unknown }`. So a consumer
// that reads `error` has to narrow on `ok` first, and `error` is unreachable on the success arm —
// which is what makes a logger that prints `outcome.error` unconditionally a compile error rather
// than a line of `undefined` in production.
declare const outcome: CommandOutcome;
// @ts-expect-error - 'error' does not exist on the ok: true arm; narrow on `ok` first.
void outcome.error;
if (outcome.ok) {
  // @ts-expect-error - still no 'error' after narrowing to the success arm.
  void outcome.error;
} else {
  const err: unknown = outcome.error;
  void err;
}
type _OutcomeAlwaysHasMs = Expect<Equal<CommandOutcome['ms'], number>>;
type _OutcomeCommandIsAString = Expect<Equal<CommandOutcome['command'], string>>;

// §4: `onCommand` returns `void`, which is the type-level half of "observation, not handling" — it
// has no way to return a replacement result and no promise the bus could await and then reinterpret.
type _OnCommandReturnsVoid = Expect<Equal<ReturnType<NonNullable<CommandBusOptions<Commands>['onCommand']>>, void>>;

// §5: `CommandRun.tx` is `TransactionContext | undefined` — present in the type in BOTH cases, so a
// handler cannot forget the undefined one. `exactOptionalPropertyTypes` is on, so this is
// deliberately a union and not an optional property: `tx?: TransactionContext` would let a
// `CommandRun` be constructed with the key absent, and `'tx' in ctx` would then be a third state.
type _TxIsAUnionNotOptional = Expect<Equal<CommandRun['tx'], TransactionContext | undefined>>;
const runWithoutATx: CommandRun = { command: 'publishPost', tx: undefined };
void runWithoutATx;
// @ts-expect-error - `tx` is required as a key: the union carries the absence, not the optionality.
const runMissingTx: CommandRun = { command: 'publishPost' };
void runMissingTx;

// §5: the supplied `transaction` hands the handler a real `TransactionContext`, which is structural,
// so `withTransaction` (../../../repository/src/index.ts:135) takes it with no new type. The
// repository-side form of this assertion is ../../../repository/src/outbox/outbox.type-test.ts.
type _TransactionWrapperGivesATx = Expect<
  Equal<
    Parameters<NonNullable<CommandBusOptions<Commands>['transaction']>>[0],
    (tx: TransactionContext) => Promise<unknown>
  >
>;

// ===========================================================================
// §3 — the refusals, asserted as absences
// ===========================================================================
// "Commands are not classes." There is no constructor-taking overload and no decorator, so a
// `CommandMap` entry is a type and nothing more. Asserted by construction: an entry needs exactly
// `input` and `result`, and a class-based marker would need a third key.
type _EntryShape = Expect<Mutual<keyof Commands['publishPost'], 'input' | 'result'>>;
// `readonly _result?: Result` is a leaky phantom field. Verified 2026-09-04 against the repo's tsc:
//
//   * the TYPES are not mutually assignable — `PhantomCommand<string> extends
//     PhantomCommand<number>` is `false`, because under `exactOptionalPropertyTypes`
//     `string | undefined` is not `number | undefined`. Asserting `true` there is TS2344.
//   * a CLASS with unrelated fields is refused too — `const c: PhantomCommand<string> = new
//     PublishPost(1)` is TS2559, "Type 'PublishPost' has no properties in common with type
//     'PhantomCommand<string>'". TypeScript's weak-type check catches the exact case §3 is about,
//     since a command class is precisely a value with other fields and no `_result`.
//   * what DOES slip through is a value with no properties at all, which is the pair below.
//
// The empty value and widening cases below are the narrower claim the spec now makes. Its other two
// arguments still hold: `new (...a: never[]) => C` makes a runtime class mandatory, and
// `ClassDecorator` is the legacy shape.
interface PhantomCommand<Result> {
  readonly _result?: Result;
}
const noFieldsAtAll = {};
const asAStringCommand: PhantomCommand<string> = noFieldsAtAll;
const asANumberCommand: PhantomCommand<number> = noFieldsAtAll;
void asAStringCommand;
void asANumberCommand;
type _PhantomTypesDoNotInterchange = Expect<
  Equal<PhantomCommand<string> extends PhantomCommand<number> ? true : false, false>
>;
// And the widening direction that does hold, which is how `C extends Command<unknown>` in §3's
// rejected signature would have accepted every command: a `PhantomCommand<string>` IS a
// `PhantomCommand<unknown>`, so the constraint checks nothing.
declare const stringCommand: PhantomCommand<string>;
const asUnknownCommand: PhantomCommand<unknown> = stringCommand;
void asUnknownCommand;
// Whereas the map form is not interchangeable at all.
type _MapEntriesAreNotInterchangeable = Expect<
  Equal<Commands['publishPost'] extends Commands['deleteUser'] ? true : false, false>
>;

// ===========================================================================
// regression guard: the interface form does not compile
// ===========================================================================
//
// An interface declaration has no implicit index signature, so it does not satisfy `CommandMap`.
// Verified 2026-09-04: TS2344, "Index signature for type 'string' is missing in type
// 'InterfaceCommands'". Only object-literal type aliases get one, because an interface is open to
// declaration merging and the compiler cannot treat its key set as closed. The spec and docs use
// the alias form, and this assertion protects that correction.
interface InterfaceCommands {
  readonly publishPost: {
    readonly input: { readonly postId: number };
    readonly result: { readonly url: string };
  };
}
// @ts-expect-error - an interface has no implicit index signature, so it does not satisfy CommandMap.
declare const busFromAnInterface: CommandBus<InterfaceCommands>;
void busFromAnInterface;

type AliasCommands = {
  readonly publishPost: {
    readonly input: { readonly postId: number };
    readonly result: { readonly url: string };
  };
};
declare const busFromAnAlias: CommandBus<AliasCommands>;
void busFromAnAlias;
