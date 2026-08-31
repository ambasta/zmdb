// Framework-agnostic endpoint adapter — see ./SPEC.md.

import { ValidationError, type ValidationIssue } from '@zmdb/schema-core';

export interface Handler<In, Out> {
  validate: (raw: unknown) => In;
  handle: (input: In) => Promise<Out>;
  serialize?: (out: Out) => string;
}

export interface EndpointResult {
  status: number;
  body: string;
}

export function makeEndpoint<In, Out>(h: Handler<In, Out>): (raw: unknown) => Promise<EndpointResult> {
  const serialize = h.serialize ?? ((o: Out) => JSON.stringify(o));
  return async (raw: unknown) => {
    let input: In;
    try {
      input = h.validate(raw);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'invalid input';
      const issues =
        err instanceof ValidationError
          ? err.issues
          : err && typeof err === 'object' && 'issues' in err
            ? (err as { issues: readonly ValidationIssue[] }).issues
            : undefined;
      return { status: 400, body: JSON.stringify(issues ? { error, issues } : { error }) };
    }
    try {
      const out = await h.handle(input);
      return { status: 200, body: serialize(out) };
    } catch (err) {
      if (err instanceof ValidationError || (err && typeof err === 'object' && 'issues' in err)) {
        const error = err instanceof Error ? err.message : 'invalid input';
        const issues = (err as { issues: readonly ValidationIssue[] }).issues;
        return { status: 400, body: JSON.stringify(issues ? { error, issues } : { error }) };
      }
      throw err;
    }
  };
}

// --- Thin per-framework adapters (optional; no hard deps) ---
// Hono:    app.post('/x', async (c) => { const r = await ep(await c.req.json()); return c.body(r.body, r.status); })
// Express: app.post('/x', async (req,res) => { const r = await ep(req.body); res.status(r.status).send(r.body); })
// tRPC:    procedure.input(z.unknown()).mutation(({input}) => ep(input))
// NestJS:  @Post() async create(@Body() b){ return ep(b); }
// Each is a 1–2 line wrapper over makeEndpoint — see docs/framework-integrations.
