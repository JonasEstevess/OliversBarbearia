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
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.staff_role, b.id AS barber_id, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         LEFT JOIN barbers b ON b.user_id = u.id
        WHERE s.token_hash = ?`,
      [sha(token)]
    );
    if (row && row.expires_at > Date.now()) {
      const { expires_at, staff_role, barber_id, ...user } = row;
      // staffRole: 'owner' (dono, acesso total) | 'barber' (só a própria agenda) | null (cliente)
      user.staffRole = user.role === 'admin' ? staff_role || 'owner' : null;
      user.barberId = barber_id || null;
      req.user = user;
    }
  }
  next();
});

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
  next();
}

// Equipe (dono ou barbeiro).
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito.' });
  next();
}
export const requireStaff = requireAdmin;

// Só o dono.
export function requireOwner(req, res, next) {
  if (!req.user || req.user.staffRole !== 'owner') return res.status(403).json({ error: 'Só o dono da barbearia pode fazer isso.' });
  next();
}

export const isOwner = (user) => user?.staffRole === 'owner';

// Dono pode tudo; barbeiro só o que é do próprio perfil.
export function canManageBarber(user, barberId) {
  return isOwner(user) || (user?.staffRole === 'barber' && !!barberId && user.barberId === barberId);
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
  await run("INSERT INTO users (name, email, phone, password_hash, role, staff_role) VALUES (?, ?, ?, ?, 'admin', 'owner')", [
    'Administrador',
    email,
    '',
    hashPassword(password),
  ]);
  console.log(`Conta admin criada: ${email}`);
}

// ---------- configuração inicial ----------
// Enquanto não existir nenhum administrador, o servidor gera um código de uso único
// e o mostra nos logs (Vercel → Logs). Quem tiver acesso aos logs cria a conta do dono.
export async function adminExists() {
  return !!(await get("SELECT 1 AS x FROM users WHERE role = 'admin' LIMIT 1"));
}

export async function ensureSetupCode() {
  if (await adminExists()) return null;
  let code = (await get("SELECT value FROM settings WHERE key = 'setup_code'"))?.value;
  if (!code) {
    code = randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g).join('-');
    await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_code', ?)", [code]);
  }
  console.log(`[CONFIGURAÇÃO INICIAL] Nenhum administrador cadastrado. Código para criar a conta em /painel: ${code}`);
  return code;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- redefinição de senha ----------
const RESET_HOURS = 24;
export async function createResetToken(userId, hours = RESET_HOURS) {
  const token = randomBytes(24).toString('base64url');
  await run('DELETE FROM reset_tokens WHERE user_id = ? OR expires_at < ?', [userId, Date.now()]);
  await run('INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), userId, Date.now() + hours * 36e5]);
  return { token, hours };
}

export async function consumeResetToken(token) {
  const row = await get('SELECT * FROM reset_tokens WHERE token_hash = ?', [sha(String(token || ''))]);
  if (!row || row.expires_at < Date.now()) return null;
  await run('DELETE FROM reset_tokens WHERE token_hash = ?', [row.token_hash]);
  return row.user_id;
}

// ---------- convites para novos barbeiros ----------
const INVITE_DAYS = 7;
export async function createInvite(barberId) {
  const token = randomBytes(24).toString('base64url');
  await run('DELETE FROM invites WHERE barber_id = ? OR expires_at < ?', [barberId, Date.now()]);
  await run('INSERT INTO invites (token_hash, barber_id, expires_at) VALUES (?, ?, ?)', [sha(token), barberId, Date.now() + INVITE_DAYS * 864e5]);
  return { token, days: INVITE_DAYS };
}

export async function findInvite(token) {
  const row = await get('SELECT * FROM invites WHERE token_hash = ?', [sha(String(token || ''))]);
  return row && row.expires_at > Date.now() ? row : null;
}

export const deleteInvite = (token) => run('DELETE FROM invites WHERE token_hash = ?', [sha(String(token || ''))]);
