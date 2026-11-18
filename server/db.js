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
];

// Colunas adicionadas depois da primeira versão (ignora se já existirem).
const MIGRATIONS = [
  'ALTER TABLE appointments ADD COLUMN reminded_at INTEGER',
  'ALTER TABLE users ADD COLUMN accepted_terms_at TEXT',
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
