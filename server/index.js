import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadUser, seedAdmin } from './auth.js';
import { authRouter } from './routes/auth.js';
import { bookingRouter } from './routes/booking.js';
import { adminRouter } from './routes/admin.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// Bloqueia requisições de escrita vindas de outras origens (CSRF).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origem não permitida.' });
  next();
});

app.use(loadUser);
app.use('/api/auth', authRouter);
app.use('/api', bookingRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

app.use(express.static(resolve('public'), { extensions: ['html'] }));

seedAdmin();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Oliver's Barbearia rodando em http://localhost:${port}`));
