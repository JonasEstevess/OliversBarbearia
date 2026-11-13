import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { get, run } from './db.js';

const COOKIE = 'ob_session';
const SESSION_DAYS = 30;

// Envolve handlers async para que erros cheguem ao middleware de erro do Express.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

export async function createSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), userId, expires]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  });
}

export async function destroySession(req, res) {
  const token = readCookie(req);
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', [sha(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Anexa req.user quando há sessão válida.
export const loadUser = ah(async (req, _res, next) => {
  const token = readCookie(req);
  if (token) {
    const row = await get(
      `SELECT u.id, u.name, u.email, u.phone, u.role, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
      [sha(token)]
    );
    if (row && row.expires_at > Date.now()) {
      const { expires_at, ...user } = row;
      req.user = user;
    }
  }
  next();
});

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito.' });
  next();
}

// Limite simples de tentativas por IP (por instância do servidor).
const attempts = new Map();
export function rateLimit(max = 10, windowMs = 10 * 60e3) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = attempts.get(key) || { n: 0, reset: now + windowMs };
    if (now > entry.reset) Object.assign(entry, { n: 0, reset: now + windowMs });
    entry.n += 1;
    attempts.set(key, entry);
    if (entry.n > max) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
    next();
  };
}

export async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  if (await get('SELECT id FROM users WHERE email = ?', [email])) return;
  await run("INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'admin')", [
    'Administrador',
    email,
    '',
    hashPassword(password),
  ]);
  console.log(`Conta admin criada: ${email}`);
}
