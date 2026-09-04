// Tests for the chat loop, the tool registry and every bound frozen in ./SPEC.md
// (#532, epic #530). The driver is scripted, so there is no network and no non-determinism.
//
// The public implementation replaces the frozen throwing surface, so every loop assertion is
// now an ordinary test. The two pre-existing runtime facts the loop depends on remain explicit:
// Web Crypto supplies the error id, and `validationIssuesOf` preserves the offending value, so
// redacting it is the loop's responsibility.
import { describe, expect, it, beforeEach } from 'vitest';

import { ValidationError, validationIssuesOf } from '../../index.js';
import type { ToolSpec } from '../index.js';
import {
  defineTools,
  run,
  type ChatDriver,
  type ChatMessage,
  type ProviderPassthrough,
  type RunOptionsFor,
  type RunResult,
  type ToolCall,
  type ToolRegistry,
} from './index.js';

type ErasedToolEntry = ToolRegistry[string];

/** ./SPEC.md §5's frozen content for a call `approve` refused. Matched exactly, not by fragment. */
const DECLINED = 'declined by the operator';

/**
 * Every handler entry, in call order, for the whole file.
 *
 * Module-level and asserted **empty** rather than a returned-error check, because
 * "validated before dispatch" is an ordering claim: an implementation that validates *after*
 * dispatch produces the same tool message and only this array can tell them apart.
 */
const ENTERED: string[] = [];

const spec = (name: string): ToolSpec => ({
  name,
  parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
});

interface Query {
  readonly q: string;
}

/** A validator that accepts `{ q: string }` and reports the path — and never the value — otherwise. */
const validateQuery = (args: unknown): Query => {
  if (typeof args === 'object' && args !== null && 'q' in args && typeof args.q === 'string') {
    return { q: args.q };
  }
  throw new ValidationError('input is not Query', [
    { path: '$input.q', message: 'expected string', expected: 'string', value: args },
  ]);
};

/** An entry that records that it ran. `effectful` omitted, so §3's default applies: effectful. */
const recordingEntry = (name: string): ErasedToolEntry => ({
  spec: spec(name),
  validate: validateQuery,
  handler: (input: never) => {
    const query: Query = input;
    ENTERED.push(`${name}:${query.q}`);
    return `ran ${name}`;
  },
});

/** The same, declared read-only. §3: `effectful: false` is a claim the author makes. */
const readOnlyEntry = (name: string) => ({ ...recordingEntry(name), effectful: false }) as const;

interface ScriptedDriver extends ChatDriver {
  readonly calls: () => number;
  readonly seen: () => readonly (readonly ChatMessage[])[];
  readonly toolsSeen: () => readonly (readonly ToolSpec[])[];
}

/**
 * The scripted fake driver every loop test uses (issue step 1). It returns the queued
 * messages in order and **throws** once the queue is empty, so a loop that asks for one turn
 * more than the script provides fails loudly instead of hanging on a pending promise.
 */
const scriptedDriver = (
  script: readonly ChatMessage[],
  opts: { readonly gate?: (turn: number) => Promise<void> } = {},
): ScriptedDriver => {
  let calls = 0;
  const seen: (readonly ChatMessage[])[] = [];
  const toolsSeen: (readonly ToolSpec[])[] = [];
  return {
    calls: () => calls,
    seen: () => seen,
    toolsSeen: () => toolsSeen,
    next: async (messages, tools) => {
      const turn = calls;
      calls += 1;
      seen.push(messages);
      toolsSeen.push(tools);
      if (opts.gate) await opts.gate(turn);
      const message = script[turn];
      if (message === undefined) {
        throw new Error(`scripted driver exhausted after ${String(script.length)} turn(s)`);
      }
      return message;
    },
  };
};

const assistantWithCalls = (name: string, count: number, marker = 'x'): ChatMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: Array.from({ length: count }, (_unused, index) => ({
    id: `call-${marker}-${String(index)}`,
    name,
    args: { q: `${marker}${String(index)}` },
  })),
});

const done: ChatMessage = { role: 'assistant', content: 'all done' };
const user: readonly ChatMessage[] = [{ role: 'user', content: 'find me a thing' }];
const approveAll = (): Promise<boolean> => Promise.resolve(true);
const toolMessages = (result: RunResult): readonly { readonly content: string; readonly isError?: boolean }[] =>
  result.messages.filter((message): message is Extract<ChatMessage, { role: 'tool' }> => message.role === 'tool');

beforeEach(() => {
  ENTERED.length = 0;
});

describe('chat loop: what already ships that §6 depends on', () => {
  // ./SPEC.md §6 requires `errorId` to be "8 hex characters from
  // `globalThis.crypto.getRandomValues` — the Web Crypto route `.oxlintrc.json` requires, and
  // there is no `node:crypto` here". That is a claim about the runtime this package is allowed
  // to use, and it is the claim the sanitisation test's regex depends on, so it is asserted
  // rather than cited.
  //
  // Measured 2026-09-04 under vitest 4.1.11 / Node v26.8.1:
  //   typeof globalThis.crypto === 'object'
  //   getRandomValues(new Uint8Array(4)) -> 8 hex characters, e.g. 'd95abfe3'
  it('derives an 8-hex errorId from Web Crypto, with no node:crypto import', () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
    expect(bytes).toHaveLength(4);
    expect(hex).toMatch(/^[0-9a-f]{8}$/);
    expect(hex).toHaveLength(8);
  });

  // ./SPEC.md §6 routes a validation failure through `validationIssuesOf`, and the interesting
  // half is what that function does *not* do. Measured 2026-09-04:
  //   validationIssuesOf(new ValidationError('input is not Query', [
  //     { path: '$input.q', message: 'expected string', expected: 'string', value: 'PLAINTEXT-SECRET-90210' },
  //   ]))
  //   -> [{"path":"$input.q","message":"expected string","expected":"string",
  //        "value":"PLAINTEXT-SECRET-90210"}]
  //
  // The value survives. So §6's "never `ValidationIssue.value`" is a redaction the **loop**
  // performs; forwarding `validationIssuesOf`'s output verbatim would exfiltrate it. This
  // test is here to make that visible next to the test that checks the redaction.
  it('gets the issue list from validationIssuesOf with value still attached', () => {
    const error = new ValidationError('input is not Query', [
      { path: '$input.q', message: 'expected string', expected: 'string', value: 'PLAINTEXT-SECRET-90210' },
    ]);
    const issues = validationIssuesOf(error);
    expect(issues).toHaveLength(1);
    expect(issues?.[0]?.path).toBe('$input.q');
    expect(issues?.[0]?.expected).toBe('string');
    expect(issues?.[0]?.value).toBe('PLAINTEXT-SECRET-90210');
    expect(validationIssuesOf(new Error('boom'))).toBeUndefined();
  });
});

describe('chat loop bounds — §5 (stop is a value) and §4 (the caps)', () => {
  // §7.1, first of three. `complete` is the only outcome that means the model considered
  // itself finished, and §5 is explicit that a message list cannot carry that fact.
  it('stops when the driver returns no tool calls', async () => {
    const driver = scriptedDriver([done]);
    const tools = { search: readOnlyEntry('search') };

    const result = await run(driver, user, tools, { maxTurns: 5 });

    expect(result.stop).toBe('complete');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(0);
    expect(driver.calls()).toBe(1);
    expect(ENTERED).toStrictEqual([]);
    expect(result.declined).toStrictEqual([]);
    expect(result.errors).toStrictEqual([]);
    expect(result.messages.at(-1)).toStrictEqual(done);
    // The caller's messages are the head of the result: §2.7 says the conversation is a value
    // the caller owns, so the loop appends rather than replaces.
    expect(result.messages[0]).toStrictEqual(user[0]);
  });

  // §7.1, second. A driver that always requests a call, which is the runaway §4 exists for.
  // The assertion that matters is not "it terminated" — an implementation that terminated
  // because its script ran out would pass that — but that `stop` distinguishes the cap from a
  // natural finish, and that `turns` equals the cap exactly.
  it('stops at maxTurns and reports that it was capped', async () => {
    const script = Array.from({ length: 6 }, (_unused, turn) => assistantWithCalls('search', 1, `t${String(turn)}`));
    const driver = scriptedDriver(script);
    const tools = { search: readOnlyEntry('search') };

    const result = await run(driver, user, tools, { maxTurns: 3, maxToolCallsPerTurn: 4 });

    expect(result.stop).toBe('max-turns');
    expect(result.stop).not.toBe('complete');
    expect(result.turns).toBe(3);
    expect(driver.calls()).toBe(3);
    // Three turns of one call each, all of them read-only, all of them run.
    expect(result.toolCalls).toBe(3);
    expect(ENTERED).toStrictEqual(['search:t00', 'search:t10', 'search:t20']);
    expect(result.budget).toBe(12);
    // §5: the last message still requested tools, which is what makes this `max-turns` rather
    // than a truncated `complete`.
    expect(result.messages.at(-1)).not.toStrictEqual(done);
  });

  // §7.1, third, plus §5's no-partial-execution rule. The bound and one past it, in one test,
  // because a cap asserted only from above passes against an off-by-one that runs the ninth
  // call and then stops.
  it('caps tool calls per turn', async () => {
    const atBound = scriptedDriver([assistantWithCalls('search', 3, 'at'), done]);
    const tools = { search: readOnlyEntry('search') };

    const inside = await run(atBound, user, tools, { maxTurns: 5, maxToolCallsPerTurn: 3 });
    expect(inside.stop).toBe('complete');
    expect(inside.toolCalls).toBe(3);
    expect(ENTERED).toStrictEqual(['search:at0', 'search:at1', 'search:at2']);
    expect(atBound.calls()).toBe(2);

    ENTERED.length = 0;

    const pastBound = scriptedDriver([assistantWithCalls('search', 4, 'past'), done]);
    const outside = await run(pastBound, user, tools, { maxTurns: 5, maxToolCallsPerTurn: 3 });

    expect(outside.stop).toBe('max-tool-calls');
    // §5: "the loop stops before the first one, because 'we ran three of your nine calls' is a
    // state no caller can reason about". Not one handler entry, not three — none.
    expect(ENTERED).toStrictEqual([]);
    expect(outside.toolCalls).toBe(0);
    expect(outside.turns).toBe(1);
    // The driver is not asked for a turn it cannot influence.
    expect(pastBound.calls()).toBe(1);
  });

  // §4's default, asserted as a number rather than trusted. A default nobody froze drifts, and
  // this one is load-bearing twice over: it is the multiplicand in `budget`, which §4 says is
  // "the number that matters".
  it('defaults maxToolCallsPerTurn to 8 and reports budget as the product', async () => {
    const tools = { search: readOnlyEntry('search') };

    const eight = scriptedDriver([assistantWithCalls('search', 8, 'e'), done]);
    const inside = await run(eight, user, tools, { maxTurns: 10 });
    expect(inside.stop).toBe('complete');
    expect(inside.toolCalls).toBe(8);
    expect(ENTERED).toHaveLength(8);
    // 10 * 8, with `maxToolCallsPerTurn` never mentioned by the caller.
    expect(inside.budget).toBe(80);

    ENTERED.length = 0;

    const nine = scriptedDriver([assistantWithCalls('search', 9, 'n'), done]);
    const outside = await run(nine, user, tools, { maxTurns: 10 });
    expect(outside.stop).toBe('max-tool-calls');
    expect(ENTERED).toStrictEqual([]);
    expect(outside.budget).toBe(80);

    // And an explicit value replaces the default in the product rather than adding to it.
    const explicit = scriptedDriver([done]);
    const withOption = await run(explicit, user, tools, { maxTurns: 10, maxToolCallsPerTurn: 2 });
    expect(withOption.budget).toBe(20);
  });

  it('rejects invalid bounds before asking the driver for a turn', async () => {
    const tools = { search: readOnlyEntry('search') };
    const cases = [
      [{ maxTurns: 0 }, 'maxTurns'],
      [{ maxTurns: 1.5 }, 'maxTurns'],
      [{ maxTurns: 1, maxToolCallsPerTurn: 0 }, 'maxToolCallsPerTurn'],
      [{ maxTurns: 1, maxToolCallsPerTurn: Number.MAX_SAFE_INTEGER + 1 }, 'maxToolCallsPerTurn'],
    ] as const;

    for (const [options, field] of cases) {
      const driver = scriptedDriver([done]);
      await expect(run(driver, user, tools, options)).rejects.toThrowError(field);
      expect(driver.calls()).toBe(0);
    }
  });

  // §3 freezes `defineTools` as an identity function whose only job is inference. Asserted by
  // identity, because a version that copied the registry would silently break a caller who
  // compares entries — and because an identity function is the whole claim, so there is
  // nothing else to check.
  it('returns the registry defineTools was given, by identity', () => {
    const tools = { search: readOnlyEntry('search') };
    expect(defineTools(tools)).toBe(tools);
  });
});

describe('validation before dispatch — §3, and epic §2.3 at its most load-bearing', () => {
  // The ordering claim. Asserted by `ENTERED` being empty, not by the tool message: an
  // implementation that calls the handler and validates inside it produces the identical
  // message, and only the log can tell the two apart.
  //
  // §6 additionally fixes what the message may say — the path and the expectation, and
  // **never** `ValidationIssue.value`. The value here is chosen to be unmistakable if it
  // leaked, and the assertion is against the serialized message rather than a field, so a
  // future implementation that tucks the value into a second field fails too.
  it('refuses malformed tool arguments and reports them to the model as a tool error', async () => {
    const bad: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-bad', name: 'search', args: { q: 991_403 } }],
    };
    const driver = scriptedDriver([bad, done]);
    const tools = { search: readOnlyEntry('search') };

    const result = await run(driver, user, tools, { maxTurns: 5 });

    // The handler was never entered. This is the assertion; everything below is the report.
    expect(ENTERED).toStrictEqual([]);

    const [message] = toolMessages(result);
    expect(message?.isError).toBe(true);
    expect(message?.content).toContain('$input.q');
    expect(message?.content).toContain('string');
    expect(JSON.stringify(message)).not.toContain('991403');
    expect(JSON.stringify(message)).not.toContain('991_403');
    // A validation failure is the model's problem, so the loop keeps going and the model gets
    // its second chance.
    expect(driver.calls()).toBe(2);
    expect(result.stop).toBe('complete');
    // §6: a validation failure is not a handler exception, so it is not an `errors` entry —
    // there is no internal error to join an `errorId` to.
    expect(result.errors).toStrictEqual([]);
  });

  // The model hallucinating a tool is the common case, and executing anything for it would be
  // a serious bug — so again the assertion is `ENTERED`, and the registry deliberately holds a
  // tool the model *could* have meant, so an implementation that "helpfully" resolves the
  // nearest name fails.
  //
  // JUDGEMENT CALL, recorded in NOTES.md: ./SPEC.md does not cover an unregistered name for
  // the loop at all (§6 covers a throwing tool and a validation failure; §5 covers a declined
  // one). `../mcp/SPEC.md` §3 answers `-32602` to the *client* for the same event, and states
  // that reporting it as `isError` "tells the model to keep trying a tool that does not exist"
  // — but in the loop there is no client to answer, and throwing would discard the turns
  // already spent, which is the reason §5 gives for not aborting a declined call either. So
  // the behaviour asserted here is an `isError` tool message and a loop that continues.
  it('refuses a tool call for a name that is not registered', async () => {
    const hallucinated: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-ghost', name: 'search_documents', args: { q: 'anything' } }],
    };
    const driver = scriptedDriver([hallucinated, done]);
    const tools = { search: readOnlyEntry('search') };

    const result = await run(driver, user, tools, { maxTurns: 5 });

    expect(ENTERED).toStrictEqual([]);
    const [message] = toolMessages(result);
    expect(message?.isError).toBe(true);
    expect(message?.content).toContain('search_documents');
    expect(result.messages.some(m => m.role === 'tool' && m.callId === 'call-ghost')).toBe(true);
    expect(result.stop).toBe('complete');
    expect(driver.calls()).toBe(2);
  });

  it('treats prototype property names as unknown tools', async () => {
    const requested: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: ['toString', '__proto__', 'constructor'].map((name, index) => ({
        id: `call-prototype-${String(index)}`,
        name,
        args: { q: 'anything' },
      })),
    };
    const driver = scriptedDriver([requested, done]);
    const tools = { search: readOnlyEntry('search') };

    const result = await run(driver, user, tools, { maxTurns: 5 });

    expect(ENTERED).toStrictEqual([]);
    expect(toolMessages(result).map(message => message.content)).toStrictEqual([
      'unknown tool toString',
      'unknown tool __proto__',
      'unknown tool constructor',
    ]);
    expect(result.stop).toBe('complete');
  });
});

describe('approval — §4 (required when it matters) and §5 (declined, and the loop continues)', () => {
  // §7.2, verbatim: "A registry with a default-`effectful` entry and no `approve` throws
  // before the driver is called once — the driver is a spy and its call count is zero."
  //
  // §3's default is the subject: `deleteUser` says nothing about `effectful`, and §3 makes
  // that mean effectful. So the throw is provoked by an *omission*, which is the case a reader
  // reaches by not thinking about the flag.
  //
  // ONE `as unknown as`, DELIBERATELY. `RunOptionsFor<typeof tools>` already makes this a
  // compile error — ./chat.type-test.ts is where that is asserted — so the only way to reach
  // the runtime check is to be the caller §4 describes: "the one place where someone silenced
  // an error with an `as`". The retype is narrowing-incompatible, which is why it is spelled
  // this way and why it is worth grepping for.
  it('requires an approval hook when a tool is effectful', async () => {
    const driver = scriptedDriver([done]);
    const tools = { delete_user: recordingEntry('delete_user'), search: readOnlyEntry('search') };
    const noApprove = { maxTurns: 3 } as unknown as RunOptionsFor<typeof tools>;
    const attempt = async (): Promise<RunResult> => run(driver, user, tools, noApprove);

    await expect(attempt()).rejects.toBeInstanceOf(Error);
    await expect(attempt()).rejects.toThrowError(/approve/);
    await expect(attempt()).rejects.toThrowError('delete_user');
    // Before the first driver call: the whole point is that no money and no side effect is
    // spent discovering the mistake.
    expect(driver.calls()).toBe(0);
    expect(ENTERED).toStrictEqual([]);

    // The same registry with `approve` supplied gets past the check, which is what makes the
    // assertion above about `approve` rather than about the registry.
    const ok = await run(driver, user, tools, { maxTurns: 3, approve: approveAll });
    expect(ok.stop).toBe('complete');
  });

  // §7.7 and §5. Three claims in one place because they are one behaviour: the call is
  // recorded in `declined`, the model is told, and the loop does **not** abort — "aborting the
  // run throws away the turns already spent and gives the model no chance to propose something
  // acceptable".
  //
  // The content is matched exactly. §5 freezes the string, and a fragment match would accept
  // an implementation that appended the arguments to it.
  it('does not call an effectful tool when approval is denied, and tells the model it was denied', async () => {
    const requested: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-del', name: 'delete_user', args: { q: 'u-1' } }],
    };
    const driver = scriptedDriver([requested, done]);
    const tools = { delete_user: recordingEntry('delete_user') };
    const asked: ToolCall[] = [];

    const result = await run(driver, user, tools, {
      maxTurns: 5,
      approve: call => {
        asked.push(call);
        return Promise.resolve(false);
      },
    });

    expect(ENTERED).toStrictEqual([]);
    // `approve` saw the call the model asked for, by identity: the loop does not rebuild it,
    // so an approval UI can key on the id it was shown.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(requested.role === 'assistant' ? requested.toolCalls?.[0] : undefined);

    expect(result.declined).toHaveLength(1);
    expect(result.declined[0]?.id).toBe('call-del');

    const [message] = toolMessages(result);
    expect(message?.isError).toBe(true);
    expect(message?.content).toBe(DECLINED);

    // The loop continued, and the model finished on its own turn.
    expect(driver.calls()).toBe(2);
    expect(result.stop).toBe('complete');
    // A declined call is not a handler failure, so it is not an `errors` entry.
    expect(result.errors).toStrictEqual([]);
  });
});

describe('what the model sees versus what the caller gets — §6', () => {
  // §7.4. The frozen content is exactly `tool <name> failed (<errorId>)` with nothing else:
  // "No message, no class name, no stack." So the assertion is an anchored match on the whole
  // string plus explicit absence of a file path and a stack frame, which is what trap-shaped
  // "assert an internal detail does not appear" asks for.
  //
  // The internal detail is planted rather than hoped for: the thrown error's message carries a
  // table name and a compiled SQL string — the three examples §6 names — and its stack
  // necessarily carries this file's path.
  it('sanitises a handler exception before sending it to the model', async () => {
    const internal = new RangeError(
      'relation "billing_secrets" does not exist: SELECT card_pan FROM billing_secrets WHERE id = $1',
    );
    const requested: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-boom', name: 'boom', args: { q: 'go' } }],
    };
    const driver = scriptedDriver([requested, done]);
    const tools = {
      boom: {
        spec: spec('boom'),
        validate: validateQuery,
        handler: () => {
          throw internal;
        },
        effectful: false,
      } as const,
    };

    const result = await run(driver, user, tools, { maxTurns: 5 });

    const [message] = toolMessages(result);
    expect(message?.isError).toBe(true);
    expect(message?.content).toMatch(/^tool boom failed \([0-9a-f]{8}\)$/);

    const transcript = JSON.stringify(result.messages);
    expect(transcript).not.toContain('billing_secrets');
    expect(transcript).not.toContain('card_pan');
    expect(transcript).not.toContain('RangeError');
    expect(transcript).not.toContain('chat.spec.ts');
    expect(transcript).not.toContain('/packages/');

    // §6's join: the same id, and the untouched error by identity, so an operator reading a
    // transcript can find the real failure without the transcript containing it.
    expect(result.errors).toHaveLength(1);
    const [entry] = result.errors;
    expect(entry?.callId).toBe('call-boom');
    expect(entry?.name).toBe('boom');
    expect(entry?.error).toBe(internal);
    expect(message?.content).toBe(`tool boom failed (${String(entry?.errorId)})`);
    expect(entry?.errorId).toMatch(/^[0-9a-f]{8}$/);
  });

  // §7.6. "A `provider` block on an assistant message is passed to the next `next()` call by
  // identity, unmodified." Identity is the assertion because §1.1's contract is that the loop
  // never inspects the block: a structural copy would satisfy `toStrictEqual` and would still
  // have lost a non-JSON-serialisable field, which is exactly how a reasoning signature gets
  // dropped.
  it('carries a provider passthrough block into the next driver call by identity', async () => {
    const block: ProviderPassthrough = { kind: 'thinking', raw: { signature: new Uint8Array([1, 2, 3]) } };
    const second: ProviderPassthrough = { kind: 'redacted_thinking', raw: 'opaque' };
    const reasoned: ChatMessage = {
      role: 'assistant',
      content: '',
      provider: [block, second],
      toolCalls: [{ id: 'call-p', name: 'search', args: { q: 'ok' } }],
    };
    const driver = scriptedDriver([reasoned, done]);
    const tools = { search: readOnlyEntry('search') };

    await run(driver, user, tools, { maxTurns: 5 });

    expect(driver.calls()).toBe(2);
    const secondTurn = driver.seen()[1] ?? [];
    const carried = secondTurn.find(
      (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
        message.role === 'assistant' && message.provider !== undefined,
    );
    expect(carried?.provider).toHaveLength(2);
    // In order, unmodified, uninspected.
    expect(carried?.provider?.[0]).toBe(block);
    expect(carried?.provider?.[1]).toBe(second);
  });
});

describe('no hidden state — §2.7, the epic’s architecture constraint', () => {
  // The §2.7 assertion. Two conversations are run interleaved on purpose: a loop with a
  // module-level accumulator passes when the runs are sequential and fails only when they
  // overlap, so the gates below force turn 1 of both runs to be in flight before either
  // returns.
  //
  // The cross-talk assertion is on what each *driver* saw, not only on the results: a loop
  // that shared state would show B's user message inside A's `next()` argument even if it then
  // returned two plausible results.
  it('holds no state between two concurrent runs', async () => {
    const openGate = (): { readonly wait: Promise<void>; readonly open: () => void } => {
      let open = (): void => undefined;
      const wait = new Promise<void>(resolve => {
        open = resolve;
      });
      return { wait, open };
    };
    const gateA = openGate();
    const gateB = openGate();

    const driverA = scriptedDriver([assistantWithCalls('search', 1, 'A'), done], {
      gate: turn => (turn === 0 ? gateA.wait : Promise.resolve()),
    });
    const driverB = scriptedDriver([assistantWithCalls('search', 1, 'B'), done], {
      gate: turn => (turn === 0 ? gateB.wait : Promise.resolve()),
    });
    const tools = { search: readOnlyEntry('search') };

    const runA = run(driverA, [{ role: 'user', content: 'conversation A' }], tools, { maxTurns: 4 });
    const runB = run(driverB, [{ role: 'user', content: 'conversation B' }], tools, {
      maxTurns: 9,
      maxToolCallsPerTurn: 2,
    });

    // Both first turns are in flight; release them in the opposite order to the one they
    // started in.
    gateB.open();
    gateA.open();
    const [resultA, resultB] = await Promise.all([runA, runB]);

    for (const seen of driverA.seen()) {
      expect(JSON.stringify(seen)).not.toContain('conversation B');
      expect(JSON.stringify(seen)).not.toContain('A1');
    }
    for (const seen of driverB.seen()) {
      expect(JSON.stringify(seen)).not.toContain('conversation A');
    }

    expect(JSON.stringify(resultA.messages)).not.toContain('conversation B');
    expect(JSON.stringify(resultB.messages)).not.toContain('conversation A');
    // Counts are per-run, not shared: each ran one tool call, and the budgets differ because
    // the options did.
    expect(resultA.toolCalls).toBe(1);
    expect(resultB.toolCalls).toBe(1);
    expect(resultA.budget).toBe(32);
    expect(resultB.budget).toBe(18);
    expect(resultA.turns).toBe(2);
    expect(resultB.turns).toBe(2);
    // Both handlers ran, once each, and the log distinguishes them.
    expect(ENTERED.toSorted()).toStrictEqual(['search:A0', 'search:B0']);
  });
});
