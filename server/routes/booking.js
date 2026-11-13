import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { ah, requireAuth } from '../auth.js';
import { shop, services, barbers, categories, openingHours, CANCEL_MIN_HOURS, BOOKING_WINDOW_DAYS } from '../catalog.js';
import { slotsFor, freeSlotsByBarber, isBookableDate } from '../availability.js';
import { isDate, nowLocal, toHHMM } from '../time.js';

export const bookingRouter = Router();

const serviceById = (id) => services.find((s) => s.id === id);
const barberById = (id) => barbers.find((b) => b.id === id);

export function serialize(a) {
  const s = serviceById(a.service_id);
  const b = barberById(a.barber_id);
  return {
    id: a.id,
    date: a.date,
    start: toHHMM(a.start_min),
    end: toHHMM(a.end_min),
    status: a.status,
    price: a.price,
    service: s ? { id: s.id, name: s.name, duration: s.duration } : { id: a.service_id, name: a.service_id },
    barber: b ? { id: b.id, name: b.name } : { id: a.barber_id, name: a.barber_id },
    client: a.client_name ? { name: a.client_name, phone: a.client_phone, email: a.client_email } : undefined,
  };
}

bookingRouter.get('/catalog', (_req, res) => {
  res.json({ shop, services, barbers, categories, openingHours, bookingWindowDays: BOOKING_WINDOW_DAYS, today: nowLocal().date });
});

bookingRouter.get('/availability', ah(async (req, res) => {
  const { date, service, barber = 'any' } = req.query;
  const s = serviceById(service);
  if (!s) return res.status(400).json({ error: 'Serviço inválido.' });
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  if (barber !== 'any' && !barberById(barber)) return res.status(400).json({ error: 'Barbeiro inválido.' });
  const slots = (await slotsFor(barber, date, s.duration)).map((x) => ({ time: toHHMM(x.start), barber: x.barber }));
  res.set('Cache-Control', 'no-store').json({ date, slots });
}));

bookingRouter.get('/appointments', requireAuth, ah(async (req, res) => {
  const rows = await all('SELECT * FROM appointments WHERE user_id = ? ORDER BY date DESC, start_min DESC', [req.user.id]);
  res.json({ appointments: rows.map(serialize) });
}));

bookingRouter.post('/appointments', requireAuth, ah(async (req, res) => {
  const { serviceId, barberId = 'any', date, time, notes } = req.body || {};
  const s = serviceById(serviceId);
  if (!s) return res.status(400).json({ error: 'Escolha um serviço.' });
  if (!isDate(date) || !isBookableDate(date)) return res.status(400).json({ error: 'Data indisponível.' });
  if (!/^\d{2}:\d{2}$/.test(time || '')) return res.status(400).json({ error: 'Horário inválido.' });
  if (barberId !== 'any' && !barberById(barberId)) return res.status(400).json({ error: 'Barbeiro inválido.' });

  const [h, m] = time.split(':').map(Number);
  const start = h * 60 + m;

  try {
    // Verificação e inserção na mesma transação de escrita: evita reserva dupla.
    const created = await tx(async (t) => {
      const candidates = barberId === 'any' ? barbers.map((b) => b.id) : [barberId];
      const free = await freeSlotsByBarber(candidates, date, s.duration, t);
      const chosen = candidates.find((id) => free[id].includes(start));
      if (!chosen) throw Object.assign(new Error('Esse horário acabou de ser reservado. Escolha outro.'), { status: 409 });
      const { lastInsertRowid } = await run(
        'INSERT INTO appointments (user_id, barber_id, service_id, date, start_min, end_min, price, notes) VALUES (?,?,?,?,?,?,?,?)',
        [req.user.id, chosen, s.id, date, start, start + s.duration, s.price, notes ? String(notes).slice(0, 300) : null],
        t
      );
      return get('SELECT * FROM appointments WHERE id = ?', [lastInsertRowid], t);
    });
    res.status(201).json({ appointment: serialize(created) });
  } catch (err) {
    if (!err.status) console.error(err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível agendar.' });
  }
}));

bookingRouter.post('/appointments/:id/cancel', requireAuth, ah(async (req, res) => {
  const a = await get('SELECT * FROM appointments WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!a) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (a.status !== 'booked') return res.status(400).json({ error: 'Este agendamento não pode mais ser cancelado.' });
  const now = nowLocal();
  const minutesUntil = (Date.parse(a.date) - Date.parse(now.date)) / 60000 + a.start_min - now.minute;
  if (minutesUntil < CANCEL_MIN_HOURS * 60)
    return res.status(400).json({ error: `Cancelamentos só com ${CANCEL_MIN_HOURS}h de antecedência. Fale com a gente no WhatsApp.` });
  await run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [a.id]);
  res.json({ appointment: serialize({ ...a, status: 'cancelled' }) });
}));
