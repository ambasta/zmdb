// hono (Deno) — the-benchmarker contract
import { Hono } from 'npm:hono@4';
const app = new Hono();
app.get('/', (c) => c.body(''));
app.get('/user/:id', (c) => c.text(c.req.param('id')));
app.post('/user', (c) => c.body(''));
Deno.serve({ port: Number(Deno.env.get('PORT') ?? 3000) }, app.fetch);
