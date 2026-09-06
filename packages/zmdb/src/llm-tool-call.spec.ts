// A tool call is a request body a model wrote, and the schema it was told to write against
// has to be the same declaration that checks what came back.
//
// Typia spends 551 assertions on `llm.schema`, `llm.parameters`, `llm.application` and
// `llm.structuredOutput`, and almost all of them are about the shape of the emitted document.
// The shape is only half the claim: a document a model can satisfy and the validator still
// rejects is worse than no document, because the failure arrives after the model has been
// paid for. So this asks both questions of one declaration — what does the tool spec publish,
// and does the validator agree with it — which is why it lives in the umbrella package rather
// than next to either half.

import { lenientParse, toolFromSchema } from '@zmdb/ai';
import { issuesFor } from '@zmdb/aot-validator/utilities';
import { schemaIrsFrom } from '@zmdb/compiler/testing';
import type { PrimaryKey, Sensitive, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { objectTypeFromIR, schemaFromIR } from './ir.js';

export interface Booking extends Table<'bookings'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  guest: string & Sql<'text'>;
  nights: number & Sql<'integer'>;
  at: Date & Sql<'timestamp'>;
  cardToken: string & Sql<'text'> & Sensitive;
}

const { Booking: IR } = schemaIrsFrom(import.meta.url, ['Booking']);
const tool = toolFromSchema('createBooking', schemaFromIR(IR), { description: 'Book a stay' });

// What the model is told to produce is JSON, so the layer the arguments are checked at is the
// wire one — `at` is an ISO string there, and a `Date` only after the boundary decodes it.
const wire = objectTypeFromIR(IR, 'create', 'wire');

/** What the server knows and the model was never shown. */
const SERVER_SIDE = { cardToken: 'tok_live_from_the_session' };

describe('LLM tool calls validate against the schema they were generated from', () => {
  it('produces a schema an LLM tool call can be validated against', () => {
    // Everything a caller needs to construct a call: the name, the object type, the property
    // names and which of them are not optional. Keys are sorted, not in declaration order,
    // because a published document's key order is part of the contract.
    expect(tool.name).toBe('createBooking');
    expect(tool.description).toBe('Book a stay');
    expect(tool.parameters.type).toBe('object');
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual(['at', 'guest', 'nights']);
    expect(tool.parameters.required).toEqual(['at', 'guest', 'nights']);

    const call = '```json\n{"guest":"Ada","nights":2,"at":"2026-01-01T12:30:00.000Z"}\n```';
    const parsed = lenientParse<Record<string, unknown>>(call);
    expect(parsed.success).toBe(true);
    expect(issuesFor({ ...parsed.data, ...SERVER_SIDE }, wire)).toEqual([]);
  });

  it('rejects a hallucinated argument with the path the model got wrong', () => {
    const parsed = lenientParse<Record<string, unknown>>(
      '{"guest":"Ada","nights":"two","at":"2026-01-01T12:30:00.000Z"}',
    );
    const issues = issuesFor({ ...parsed.data, ...SERVER_SIDE }, wire);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('input.nights');
    expect(issues[0]?.value).toBe('two');
  });

  it('reports a required argument the model left out', () => {
    const parsed = lenientParse<Record<string, unknown>>('{"guest":"Ada","at":"2026-01-01T12:30:00.000Z"}');
    const paths = issuesFor({ ...parsed.data, ...SERVER_SIDE }, wire).map(i => i.path);
    expect(paths).toEqual(['input.nights']);
  });

  it('rejects a Date the model sent in the app layer rather than on the wire', () => {
    // The failure this catches is the one that used to pass: a `timestamp` accepted as
    // `Date | string` on both sides, so nobody found out which the boundary produced.
    const issues = issuesFor({ guest: 'Ada', nights: 2, at: new Date(), ...SERVER_SIDE }, wire);
    expect(issues.map(i => i.path)).toEqual(['input.at']);
  });

  it('never publishes a sensitive column as a tool argument, even a required one', () => {
    // A model that can see the property name will eventually invent a value for it, and the
    // one place that must not happen is the field nobody wanted in a prompt.
    //
    // So the document and the validator disagree here on purpose: `cardToken` is required by
    // `CreateDTO<Booking>` — you cannot book without one — and absent from what is published.
    // The seam is the caller's job, and it is a small one: merge what the server already knows
    // into the model's arguments before validating. Publishing the field instead would let a
    // model fill it in, and a validator that dropped it would reject every legitimate create.
    expect(tool.parameters.properties).not.toHaveProperty('cardToken');
    expect(tool.parameters.required).not.toContain('cardToken');
    expect(wire.properties.map(p => p.name)).toContain('cardToken');

    const modelArgumentsAlone = { guest: 'Ada', nights: 2, at: '2026-01-01T12:30:00.000Z' };
    expect(issuesFor(modelArgumentsAlone, wire).map(i => i.path)).toEqual(['input.cardToken']);
  });

  it('never publishes a database-generated key as a tool argument', () => {
    expect(tool.parameters.properties).not.toHaveProperty('id');
    expect(wire.properties.map(p => p.name)).not.toContain('id');
  });
});
