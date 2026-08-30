// Framework-agnostic endpoint adapter — see ./SPEC.md.

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
      return { status: 400, body: JSON.stringify({ error: err instanceof Error ? err.message : 'invalid input' }) };
    }
    const out = await h.handle(input);
    return { status: 200, body: serialize(out) };
  };
}

// --- Thin per-framework adapters (optional; no hard deps) ---
// Hono:    app.post('/x', async (c) => { const r = await ep(await c.req.json()); return c.body(r.body, r.status); })
// Express: app.post('/x', async (req,res) => { const r = await ep(req.body); res.status(r.status).send(r.body); })
// tRPC:    procedure.input(z.unknown()).mutation(({input}) => ep(input))
// NestJS:  @Post() async create(@Body() b){ return ep(b); }
// Each is a 1–2 line wrapper over makeEndpoint — see docs/framework-integrations.
