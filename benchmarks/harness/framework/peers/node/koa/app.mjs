// koa (+ @koa/router) — the-benchmarker contract
import Koa from 'koa';
import Router from '@koa/router';
const app = new Koa();
const r = new Router();
r.get('/', (ctx) => { ctx.body = ''; });
r.get('/user/:id', (ctx) => { ctx.body = String(ctx.params.id); });
r.post('/user', (ctx) => { ctx.body = ''; });
app.use(r.routes());
app.listen(Number(process.env.PORT ?? 3000));
