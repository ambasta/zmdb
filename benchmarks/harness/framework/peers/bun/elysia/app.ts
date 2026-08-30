// elysia (Bun) — the-benchmarker contract
import { Elysia } from 'elysia';
new Elysia()
  .get('/', () => '')
  .get('/user/:id', ({ params: { id } }) => id)
  .post('/user', () => '')
  .listen(Number(process.env.PORT ?? 3000));
