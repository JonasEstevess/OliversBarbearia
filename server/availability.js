import { all } from './db.js';
import { openingHours, barbers, SLOT_STEP_MIN, BOOKING_WINDOW_DAYS } from './catalog.js';
import { nowLocal, toMin, weekday, addDays } from './time.js';

const LEAD_MIN = 30; // antecedência mínima para agendar no mesmo dia

export function isBookableDate(date) {
  const today = nowLocal().date;
  return date >= today && date <= addDays(today, BOOKING_WINDOW_DAYS);
}

async function busyByBarber(date, ex) {
  const rows = await all(
    "SELECT barber_id, start_min, end_min FROM appointments WHERE date = ? AND status IN ('booked','done')",
    [date],
    ex
  );
  const map = {};
  for (const r of rows) (map[r.barber_id] ||= []).push(r);
  return map;
}

function computeFree(date, duration, busy) {
  const blocks = openingHours[weekday(date)] || [];
  const now = nowLocal();
  const minStart = date === now.date ? now.minute + LEAD_MIN : 0;
  const out = [];
  for (const [open, close] of blocks) {
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

// Horários livres (em minutos) de cada barbeiro pedido, numa única consulta.
export async function freeSlotsByBarber(ids, date, duration, ex) {
  if (!isBookableDate(date)) return Object.fromEntries(ids.map((id) => [id, []]));
  const busy = await busyByBarber(date, ex);
  return Object.fromEntries(ids.map((id) => [id, computeFree(date, duration, busy[id] || [])]));
}

// Para "qualquer barbeiro": união dos horários, com o barbeiro livre de cada horário.
export async function slotsFor(barberId, date, duration) {
  const ids = barberId === 'any' ? barbers.map((b) => b.id) : [barberId];
  const free = await freeSlotsByBarber(ids, date, duration);
  const map = new Map();
  for (const id of ids) for (const s of free[id]) if (!map.has(s)) map.set(s, id);
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([start, barber]) => ({ start, barber }));
}
