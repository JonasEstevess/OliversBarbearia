// Dados editáveis pelo painel (barbeiros, serviços, horários), guardados no banco.
// Na primeira execução, são copiados de catalog.js para que nada mude para o cliente.
import { all, get, run, getSetting, setSetting } from './db.js';
import {
  shop, categories, barbers as defaultBarbers, services as defaultServices,
  openingHours as defaultHours, BOOKING_WINDOW_DAYS,
} from './catalog.js';
import { nowLocal } from './time.js';

export async function seedCatalog() {
  if (!(await get('SELECT 1 AS x FROM barbers LIMIT 1'))) {
    for (const [i, b] of defaultBarbers.entries())
      await run('INSERT INTO barbers (id, name, specialty, sort) VALUES (?, ?, ?, ?)', [b.id, b.name, b.specialty || 'Barbeiro', i]);
  }
  if (!(await get('SELECT 1 AS x FROM services LIMIT 1'))) {
    for (const [i, s] of defaultServices.entries())
      await run(
        'INSERT INTO services (id, cat, name, description, price, duration, popular, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [s.id, s.cat, s.name, s.desc || '', s.price, s.duration, s.popular ? 1 : 0, i]
      );
  }
  if (!(await getSetting('opening_hours'))) await setSetting('opening_hours', JSON.stringify(defaultHours));
}

// ---------- horários ----------
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Valida { "0": [["09:00","14:00"]], ... } e devolve normalizado (ou lança erro com mensagem amigável).
export function normalizeHours(input) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const list = Array.isArray(input?.[d]) ? input[d] : [];
    const clean = list
      .filter((r) => Array.isArray(r) && HHMM.test(r[0]) && HHMM.test(r[1]))
      .map(([a, b]) => [a, b])
      .sort((x, y) => toMin(x[0]) - toMin(y[0]));
    for (const [i, [a, b]] of clean.entries()) {
      if (toMin(b) <= toMin(a)) throw Object.assign(new Error(`Horário inválido: ${a}–${b}.`), { status: 400 });
      if (i && toMin(a) < toMin(clean[i - 1][1])) throw Object.assign(new Error('Há intervalos sobrepostos no mesmo dia.'), { status: 400 });
    }
    if (clean.length > 4) throw Object.assign(new Error('No máximo 4 intervalos por dia.'), { status: 400 });
    out[d] = clean;
  }
  return out;
}

export async function getOpeningHours() {
  const raw = await getSetting('opening_hours');
  return raw ? JSON.parse(raw) : defaultHours;
}

// ---------- leitura ----------
const photoUrl = (id) => (id ? `/api/media/${id}` : null);

export function mapBarber(b) {
  return {
    id: b.id,
    name: b.name,
    specialty: b.specialty || 'Barbeiro',
    photo: photoUrl(b.photo_id),
    hours: b.hours ? JSON.parse(b.hours) : null, // null = segue o horário da barbearia
    active: !!b.active,
    userId: b.user_id ?? null,
  };
}

export function mapService(s) {
  return {
    id: s.id, cat: s.cat, name: s.name, desc: s.description || '', price: s.price,
    duration: s.duration, popular: !!s.popular, active: !!s.active,
  };
}

export async function listBarbers({ includeInactive = false } = {}, ex) {
  const rows = await all(`SELECT * FROM barbers ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, created_at`, [], ex);
  return rows.map(mapBarber);
}

export async function listServices({ includeInactive = false } = {}) {
  const rows = await all(`SELECT * FROM services ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort, name`);
  return rows.map(mapService);
}

export async function getBarber(id, ex) {
  const row = await get('SELECT * FROM barbers WHERE id = ?', [String(id || '')], ex);
  return row ? mapBarber(row) : null;
}

export async function getService(id) {
  const row = await get('SELECT * FROM services WHERE id = ?', [String(id || '')]);
  return row ? mapService(row) : null;
}

// Catálogo público (site e app). Sem cache: mudanças do painel aparecem na hora para todos.
export async function publicCatalog() {
  const [barbers, services, openingHours] = await Promise.all([listBarbers(), listServices(), getOpeningHours()]);
  return {
    shop, categories, services,
    barbers: barbers.map(({ userId, active, ...b }) => b),
    openingHours,
    bookingWindowDays: BOOKING_WINDOW_DAYS,
    today: nowLocal().date,
  };
}

// Nomes para exibir agendamentos antigos, inclusive de barbeiros/serviços desativados.
export async function nameMaps() {
  const [b, s] = await Promise.all([all('SELECT id, name FROM barbers'), all('SELECT id, name, duration FROM services')]);
  return { barbers: new Map(b.map((x) => [x.id, x])), services: new Map(s.map((x) => [x.id, x])) };
}

export function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
}
