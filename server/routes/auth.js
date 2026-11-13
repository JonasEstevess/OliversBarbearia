import { Router } from 'express';
import { get, run } from '../db.js';
import { ah, hashPassword, verifyPassword, createSession, destroySession, rateLimit } from '../auth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s, max = 120) => String(s ?? '').trim().slice(0, max);
const digits = (s) => String(s ?? '').replace(/\D/g, '');

authRouter.post('/register', rateLimit(10), ah(async (req, res) => {
  const name = clean(req.body.name, 80);
  const email = clean(req.body.email).toLowerCase();
  const phone = digits(req.body.phone).slice(0, 13);
  const password = String(req.body.password ?? '');

  if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (phone.length < 10) return res.status(400).json({ error: 'Informe um WhatsApp com DDD.' });
  if (password.length < 8) return res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres.' });
  if (await get('SELECT 1 AS x FROM users WHERE email = ?', [email]))
    return res.status(409).json({ error: 'Este e-mail já tem cadastro. Faça login.' });

  const { lastInsertRowid: id } = await run('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)', [
    name,
    email,
    phone,
    hashPassword(password),
  ]);
  await createSession(res, id);
  res.status(201).json({ user: { id, name, email, phone, role: 'client' } });
}));

authRouter.post('/login', rateLimit(10), ah(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password ?? '');
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  await createSession(res, user.id);
  const { password_hash, created_at, ...safe } = user;
  res.json({ user: safe });
}));

authRouter.post('/logout', ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

authRouter.get('/me', (req, res) => res.json({ user: req.user || null }));
