import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Produção (Vercel): Turso via TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
// Desenvolvimento: arquivo SQLite local em data/olivers.db.
const remote = process.env.TURSO_DATABASE_URL;
let url = remote;
if (!remote) {
  // Na Vercel sem Turso só /tmp é gravável (dados temporários, apenas para testes).
  const fallback = process.env.VERCEL ? '/tmp/olivers.db' : 'data/olivers.db';
  if (process.env.VERCEL) console.warn('TURSO_DATABASE_URL não definido: usando banco temporário em /tmp.');
  const file = resolve(process.env.DB_FILE || fallback);
  mkdirSync(dirname(file), { recursive: true });
  url = `file:${file}`;
}

export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('client','admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    barber_id   TEXT NOT NULL,
    service_id  TEXT NOT NULL,
    date        TEXT NOT NULL,
    start_min   INTEGER NOT NULL,
    end_min     INTEGER NOT NULL,
    price       INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','done','cancelled','no_show')),
    notes       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_appt_barber_date ON appointments(barber_id, date)',
  'CREATE INDEX IF NOT EXISTS idx_appt_user ON appointments(user_id)',
  // Configurações internas (chaves de notificação, código de configuração inicial).
  `CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  // Horários bloqueados: folgas, feriados, compromissos. barber_id NULL = barbearia inteira.
  `CREATE TABLE IF NOT EXISTS blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    barber_id  TEXT,
    date       TEXT NOT NULL,
    start_min  INTEGER NOT NULL,
    end_min    INTEGER NOT NULL,
    reason     TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_blocks_date ON blocks(date)',
  // Links de redefinição de senha gerados pela barbearia.
  `CREATE TABLE IF NOT EXISTS reset_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // Inscrições de notificação push (um registro por aparelho).
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)',
  // Barbeiros editáveis pelo painel. user_id liga o perfil à conta de acesso do barbeiro.
  `CREATE TABLE IF NOT EXISTS barbers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    specialty  TEXT,
    photo_id   INTEGER,
    user_id    INTEGER UNIQUE,
    hours      TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Serviços e preços editáveis pelo dono (preço em centavos, duração em minutos).
  `CREATE TABLE IF NOT EXISTS services (
    id          TEXT PRIMARY KEY,
    cat         TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    price       INTEGER NOT NULL,
    duration    INTEGER NOT NULL,
    popular     INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0
  )`,
  // Fotos enviadas pelo painel (já comprimidas no aparelho).
  `CREATE TABLE IF NOT EXISTS media (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mime       TEXT NOT NULL,
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Convites para novos barbeiros criarem a conta.
  `CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    barber_id  TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

// Colunas adicionadas depois da primeira versão (ignora se já existirem).
const MIGRATIONS = [
  'ALTER TABLE appointments ADD COLUMN reminded_at INTEGER',
  'ALTER TABLE users ADD COLUMN accepted_terms_at TEXT',
  // role = 'admin' significa "equipe"; staff_role diz se é dono (tudo) ou barbeiro (só o próprio).
  'ALTER TABLE users ADD COLUMN staff_role TEXT',
  // Combos: lista dos serviços que o combo substitui (preço de combo automático).
  'ALTER TABLE services ADD COLUMN includes TEXT',
  // Agendamento com vários serviços: retrato dos itens no momento da reserva.
  'ALTER TABLE appointments ADD COLUMN items TEXT',
];

// Ajustes de dados idempotentes, rodados a cada inicialização.
const DATA_FIXES = [
  "UPDATE users SET staff_role = 'owner' WHERE role = 'admin' AND staff_role IS NULL",
  `UPDATE services SET includes = '["corte", "barba"]' WHERE id = 'corte-barba' AND includes IS NULL`,
  `UPDATE services SET includes = '["corte", "sobrancelha"]' WHERE id = 'corte-sobrancelha' AND includes IS NULL`,
  `UPDATE services SET includes = '["corte", "barba", "sobrancelha"]' WHERE id = 'corte-barba-sobrancelha' AND includes IS NULL`,
  `UPDATE services SET includes = '["corte", "barba-toalha"]' WHERE id = 'corte-barba-toalha' AND includes IS NULL`,
  `UPDATE services SET includes = '["corte", "barba-toalha", "sobrancelha"]' WHERE id = 'combo-premium' AND includes IS NULL`,
];

let ready;
export function initDb() {
  ready ||= (async () => {
    await db.batch(SCHEMA, 'write');
    for (const sql of MIGRATIONS) {
      try {
        await db.execute(sql);
      } catch (err) {
        if (!/duplicate column/i.test(String(err.message))) throw err;
      }
    }
    for (const sql of DATA_FIXES) await db.execute(sql);
    await (await import('./store.js')).seedCatalog();
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export async function getSetting(key) {
  return (await get('SELECT value FROM settings WHERE key = ?', [key]))?.value ?? null;
}
export async function setSetting(key, value) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

const toObjects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

// `ex` pode ser o cliente ou uma transação aberta.
export async function all(sql, args = [], ex = db) {
  return toObjects(await ex.execute({ sql, args }));
}
export async function get(sql, args = [], ex = db) {
  return (await all(sql, args, ex))[0];
}
export async function run(sql, args = [], ex = db) {
  const rs = await ex.execute({ sql, args });
  return { lastInsertRowid: Number(rs.lastInsertRowid), changes: rs.rowsAffected };
}

export async function tx(fn) {
  const t = await db.transaction('write');
  try {
    const out = await fn(t);
    await t.commit();
    return out;
  } catch (err) {
    await t.rollback().catch(() => {});
    throw err;
  } finally {
    t.close();
  }
}
