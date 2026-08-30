// hono (node adapter) — the-benchmarker contract
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
const app = new Hono();
app.get('/', (c) => c.body(''));
app.get('/user/:id', (c) => c.text(c.req.param('id')));
app.post('/user', (c) => c.body(''));
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
