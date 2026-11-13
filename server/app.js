import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDb } from './db.js';
import { loadUser, seedAdmin } from './auth.js';
import { authRouter } from './routes/auth.js';
import { bookingRouter } from './routes/booking.js';
import { adminRouter } from './routes/admin.js';

// Garante tabelas e conta admin uma vez por instância (cold start na Vercel).
let boot;
const ensureReady = () => (boot ||= initDb().then(seedAdmin).catch((e) => { boot = null; throw e; }));

export const app = express();
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

app.use('/api', (req, _res, next) => ensureReady().then(() => next(), next));

// Bloqueia requisições de escrita vindas de outras origens (CSRF).
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  const origin = req.get('origin');
  if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Origem não permitida.' });
  next();
});

app.use('/api', loadUser);
app.use('/api/auth', authRouter);
app.use('/api', bookingRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Em desenvolvimento o Express serve o front; na Vercel, a pasta public/ é servida pela CDN.
if (existsSync(resolve('public'))) app.use(express.static(resolve('public'), { extensions: ['html'], dotfiles: 'allow' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente.' });
});
