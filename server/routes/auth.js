import { Router } from 'express';
import { get, run, getSetting } from '../db.js';
import {
  ah, hashPassword, verifyPassword, createSession, destroySession, rateLimit, requireAuth,
  adminExists, safeEqual, consumeResetToken,
} from '../auth.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s, max = 120) => String(s ?? '').trim().slice(0, max);
const digits = (s) => String(s ?? '').replace(/\D/g, '');
const publicUser = ({ password_hash, created_at, accepted_terms_at, ...u }) => u;

function validate({ name, email, phone, password }, { needPhone = true } = {}) {
  if (name.length < 2) return 'Informe seu nome.';
  if (!EMAIL_RE.test(email)) return 'E-mail inválido.';
  if (needPhone && phone.length < 10) return 'Informe um WhatsApp com DDD.';
  if (password.length < 8) return 'A senha precisa ter ao menos 8 caracteres.';
  return null;
}

authRouter.post('/register', rateLimit(10), ah(async (req, res) => {
  const data = {
    name: clean(req.body.name, 80),
    email: clean(req.body.email).toLowerCase(),
    phone: digits(req.body.phone).slice(0, 13),
    password: String(req.body.password ?? ''),
  };
  const error = validate(data);
  if (error) return res.status(400).json({ error });
  if (req.body.acceptTerms !== true && req.body.acceptTerms !== 'on')
    return res.status(400).json({ error: 'Para criar a conta, aceite a Política de Privacidade.' });
  if (await get('SELECT 1 AS x FROM users WHERE email = ?', [data.email]))
    return res.status(409).json({ error: 'Este e-mail já tem cadastro. Faça login.' });

  const { lastInsertRowid: id } = await run(
    "INSERT INTO users (name, email, phone, password_hash, accepted_terms_at) VALUES (?, ?, ?, ?, datetime('now'))",
    [data.name, data.email, data.phone, hashPassword(data.password)]
  );
  await createSession(res, id);
  res.status(201).json({ user: { id, name: data.name, email: data.email, phone: data.phone, role: 'client' } });
}));

authRouter.post('/login', rateLimit(10), ah(async (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password ?? '');
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  await createSession(res, user.id);
  res.json({ user: publicUser(user) });
}));

authRouter.post('/logout', ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

authRouter.get('/me', (req, res) => res.json({ user: req.user || null }));

// ---------- configuração inicial do administrador ----------
authRouter.get('/setup', ah(async (_req, res) => res.json({ needsSetup: !(await adminExists()) })));

authRouter.post('/setup', rateLimit(5), ah(async (req, res) => {
  if (await adminExists()) return res.status(409).json({ error: 'A barbearia já tem um administrador. Faça login.' });
  const expected = await getSetting('setup_code');
  const code = clean(req.body.code, 40).toUpperCase();
  if (!expected || !safeEqual(code, expected)) return res.status(403).json({ error: 'Código de configuração inválido.' });

  const data = {
    name: clean(req.body.name, 80),
    email: clean(req.body.email).toLowerCase(),
    phone: digits(req.body.phone).slice(0, 13),
    password: String(req.body.password ?? ''),
  };
  const error = validate(data, { needPhone: false });
  if (error) return res.status(400).json({ error });

  const existing = await get('SELECT id FROM users WHERE email = ?', [data.email]);
  let id = existing?.id;
  if (existing) {
    await run("UPDATE users SET role = 'admin', name = ?, password_hash = ? WHERE id = ?", [data.name, hashPassword(data.password), id]);
  } else {
    ({ lastInsertRowid: id } = await run(
      "INSERT INTO users (name, email, phone, password_hash, role, accepted_terms_at) VALUES (?, ?, ?, ?, 'admin', datetime('now'))",
      [data.name, data.email, data.phone, hashPassword(data.password)]
    ));
  }
  await run("DELETE FROM settings WHERE key = 'setup_code'");
  await createSession(res, id);
  res.status(201).json({ user: { id, name: data.name, email: data.email, phone: data.phone, role: 'admin' } });
}));

// ---------- redefinir senha (link gerado pela barbearia) ----------
authRouter.post('/reset', rateLimit(10), ah(async (req, res) => {
  const password = String(req.body.password ?? '');
  if (password.length < 8) return res.status(400).json({ error: 'A senha precisa ter ao menos 8 caracteres.' });
  const userId = await consumeResetToken(req.body.token);
  if (!userId) return res.status(400).json({ error: 'Este link expirou ou já foi usado. Peça um novo para a barbearia.' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), userId]);
  await run('DELETE FROM sessions WHERE user_id = ?', [userId]); // desconecta aparelhos antigos
  await createSession(res, userId);
  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  res.json({ user: publicUser(user) });
}));

// ---------- LGPD: excluir conta e todos os dados ----------
authRouter.post('/delete-account', requireAuth, rateLimit(5), ah(async (req, res) => {
  const user = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!verifyPassword(String(req.body.password ?? ''), user.password_hash))
    return res.status(401).json({ error: 'Senha incorreta.' });
  if (user.role === 'admin' && (await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n <= 1)
    return res.status(400).json({ error: 'Esta é a única conta de administrador e não pode ser excluída.' });
  for (const sql of [
    'DELETE FROM push_subscriptions WHERE user_id = ?',
    'DELETE FROM reset_tokens WHERE user_id = ?',
    'DELETE FROM appointments WHERE user_id = ?',
    'DELETE FROM sessions WHERE user_id = ?',
    'DELETE FROM users WHERE id = ?',
  ]) await run(sql, [user.id]);
  res.clearCookie('ob_session', { path: '/' });
  res.json({ ok: true });
}));
