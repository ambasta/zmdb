// oak (Deno) — the-benchmarker contract
import { Application, Router } from 'jsr:@oak/oak@17';
const router = new Router();
router.get('/', (ctx) => { ctx.response.body = ''; });
router.get('/user/:id', (ctx) => { ctx.response.body = ctx.params.id; });
router.post('/user', (ctx) => { ctx.response.body = ''; });
const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: Number(Deno.env.get('PORT') ?? 3000) });
