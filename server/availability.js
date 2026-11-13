import { db } from './db.js';
import { openingHours, barbers, SLOT_STEP_MIN, BOOKING_WINDOW_DAYS } from './catalog.js';
import { nowLocal, toMin, weekday, addDays } from './time.js';

const LEAD_MIN = 30; // antecedência mínima para agendar no mesmo dia

export function isBookableDate(date) {
  const today = nowLocal().date;
  return date >= today && date <= addDays(today, BOOKING_WINDOW_DAYS);
}

function busyRanges(barberId, date) {
  return db
    .prepare("SELECT start_min, end_min FROM appointments WHERE barber_id = ? AND date = ? AND status IN ('booked','done')")
    .all(barberId, date);
}

// Horários livres (em minutos) para um barbeiro, data e duração.
export function freeSlots(barberId, date, duration) {
  if (!isBookableDate(date)) return [];
  const blocks = openingHours[weekday(date)] || [];
  const busy = busyRanges(barberId, date);
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

// Para "qualquer barbeiro": união dos horários, com o barbeiro livre de cada horário.
export function slotsFor(barberId, date, duration) {
  const ids = barberId === 'any' ? barbers.map((b) => b.id) : [barberId];
  const map = new Map();
  for (const id of ids) {
    for (const s of freeSlots(id, date, duration)) if (!map.has(s)) map.set(s, id);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([start, barber]) => ({ start, barber }));
}
