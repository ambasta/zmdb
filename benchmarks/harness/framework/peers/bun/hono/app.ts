// hono (Bun native server) — the-benchmarker contract
import { Hono } from 'hono';
const app = new Hono();
app.get('/', (c) => c.body(''));
app.get('/user/:id', (c) => c.text(c.req.param('id')));
app.post('/user', (c) => c.body(''));
export default { port: Number(process.env.PORT ?? 3000), fetch: app.fetch };
