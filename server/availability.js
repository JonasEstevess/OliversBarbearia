import { all } from './db.js';
import { SLOT_STEP_MIN, BOOKING_WINDOW_DAYS } from './catalog.js';
import { listBarbers, getOpeningHours } from './store.js';
import { nowLocal, toMin, weekday, addDays } from './time.js';

const LEAD_MIN = 30; // antecedência mínima para agendar no mesmo dia

export function isBookableDate(date) {
  const today = nowLocal().date;
  return date >= today && date <= addDays(today, BOOKING_WINDOW_DAYS);
}

// Intervalos ocupados por barbeiro: agendamentos + bloqueios (folgas, feriados...).
async function busyByBarber(date, ids, ex) {
  const [appts, blocks] = await Promise.all([
    all("SELECT barber_id, start_min, end_min FROM appointments WHERE date = ? AND status IN ('booked','done')", [date], ex),
    all('SELECT barber_id, start_min, end_min FROM blocks WHERE date = ?', [date], ex),
  ]);
  const map = Object.fromEntries(ids.map((id) => [id, []]));
  for (const a of appts) map[a.barber_id]?.push(a);
  for (const b of blocks) {
    if (b.barber_id) map[b.barber_id]?.push(b);
    else for (const id of ids) map[id].push(b); // bloqueio da barbearia inteira
  }
  return map;
}

function computeFree(date, duration, busy, intervals) {
  const now = nowLocal();
  const minStart = date === now.date ? now.minute + LEAD_MIN : 0;
  const out = [];
  for (const [open, close] of intervals) {
    const end = toMin(close);
    for (let s = toMin(open); s + duration <= end; s += SLOT_STEP_MIN) {
      if (s < minStart) continue;
      const e = s + duration;
      if (busy.some((b) => s < b.end_min && e > b.start_min)) continue;
      out.push(s);
    }
  }
  return out;
}

// Horário de trabalho do barbeiro naquele dia: o próprio, ou o da barbearia.
const workIntervals = (barber, shopHours, wd) => (barber.hours ? barber.hours[wd] : shopHours[wd]) || [];

// Horários livres (em minutos) de cada barbeiro ativo pedido.
export async function freeSlotsByBarber(ids, date, duration, ex) {
  const empty = Object.fromEntries(ids.map((id) => [id, []]));
  if (!isBookableDate(date)) return empty;
  const [barbers, shopHours] = await Promise.all([listBarbers({}, ex), getOpeningHours()]);
  const active = new Map(barbers.map((b) => [b.id, b]));
  const valid = ids.filter((id) => active.has(id));
  const busy = await busyByBarber(date, valid, ex);
  const wd = weekday(date);
  for (const id of valid) empty[id] = computeFree(date, duration, busy[id], workIntervals(active.get(id), shopHours, wd));
  return empty;
}

export async function activeBarberIds(ex) {
  return (await listBarbers({}, ex)).map((b) => b.id);
}

// Para "qualquer barbeiro": união dos horários, com o barbeiro livre de cada horário.
export async function slotsFor(barberId, date, duration) {
  const ids = barberId === 'any' ? await activeBarberIds() : [barberId];
  const free = await freeSlotsByBarber(ids, date, duration);
  const map = new Map();
  for (const id of ids) for (const s of free[id]) if (!map.has(s)) map.set(s, id);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([start, barber]) => ({ start, barber }));
}
