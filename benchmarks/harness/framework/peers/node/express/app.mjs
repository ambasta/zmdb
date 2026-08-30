// express — the-benchmarker contract
import express from 'express';
const app = express();
app.get('/', (_req, res) => res.send(''));
app.get('/user/:id', (req, res) => res.send(String(req.params.id)));
app.post('/user', (_req, res) => res.send(''));
app.listen(Number(process.env.PORT ?? 3000));
