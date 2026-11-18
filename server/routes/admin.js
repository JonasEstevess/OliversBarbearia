import { Router } from 'express';
import { all, get, run } from '../db.js';
import { ah, requireAdmin, createResetToken } from '../auth.js';
import { barbers } from '../catalog.js';
import { isDate, nowLocal, toHHMM } from '../time.js';
import { notifyUser } from '../push.js';
import { serialize } from './booking.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const SELECT = `SELECT a.*, u.name AS client_name, u.phone AS client_phone, u.email AS client_email
                  FROM appointments a JOIN users u ON u.id = a.user_id`;
const toMinutes = (hhmm) => (/^\d{2}:\d{2}$/.test(hhmm || '') ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);

// ---------- agenda ----------
adminRouter.get('/appointments', ah(async (req, res) => {
  const { date, barber } = req.query;
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const rows = barber
    ? await all(`${SELECT} WHERE a.date = ? AND a.barber_id = ? ORDER BY a.start_min`, [date, barber])
    : await all(`${SELECT} WHERE a.date = ? ORDER BY a.start_min`, [date]);
  res.json({ appointments: rows.map(serialize) });
}));

adminRouter.get('/summary', ah(async (req, res) => {
  const { date } = req.query;
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const row = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('booked','done') THEN price ELSE 0 END) AS revenue,
            SUM(status = 'done') AS done,
            SUM(status = 'cancelled') AS cancelled
       FROM appointments WHERE date = ?`,
    [date]
  );
  res.json({ total: row.total || 0, revenue: row.revenue || 0, done: row.done || 0, cancelled: row.cancelled || 0 });
}));

adminRouter.patch('/appointments/:id', ah(async (req, res) => {
  const { status } = req.body || {};
  if (!['booked', 'done', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  const id = Number(req.params.id);
  const before = await get('SELECT status FROM appointments WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  await run('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);
  const row = await get(`${SELECT} WHERE a.id = ?`, [id]);
  const appt = serialize(row);
  if (status === 'cancelled' && before.status !== 'cancelled') {
    await notifyUser(row.user_id, {
      title: 'Seu horário foi cancelado',
      body: `A barbearia cancelou ${appt.service.name} de ${appt.date.split('-').reverse().slice(0, 2).join('/')} às ${appt.start}. Toque para remarcar.`,
      url: '/#agendar',
      tag: `appt-${appt.id}`,
    });
  }
  res.json({ appointment: appt });
}));

// ---------- bloqueios (folgas, feriados, compromissos) ----------
const serializeBlock = (b) => ({
  id: b.id,
  barberId: b.barber_id,
  barberName: b.barber_id ? barbers.find((x) => x.id === b.barber_id)?.name || b.barber_id : 'Barbearia inteira',
  date: b.date,
  allDay: b.start_min === 0 && b.end_min >= 1440,
  start: toHHMM(b.start_min),
  end: toHHMM(Math.min(b.end_min, 1439)),
  reason: b.reason,
});

adminRouter.get('/blocks', ah(async (_req, res) => {
  const rows = await all('SELECT * FROM blocks WHERE date >= ? ORDER BY date, start_min', [nowLocal().date]);
  res.json({ blocks: rows.map(serializeBlock) });
}));

adminRouter.post('/blocks', ah(async (req, res) => {
  const { barberId = null, date, endDate, allDay, start, end, reason } = req.body || {};
  if (barberId && !barbers.some((b) => b.id === barberId)) return res.status(400).json({ error: 'Barbeiro inválido.' });
  if (!isDate(date)) return res.status(400).json({ error: 'Escolha a data.' });
  const last = endDate && isDate(endDate) ? endDate : date;
  if (last < date) return res.status(400).json({ error: 'A data final deve ser depois da inicial.' });

  let s = 0;
  let e = 1440;
  if (!allDay) {
    s = toMinutes(start);
    e = toMinutes(end);
    if (s === null || e === null || e <= s) return res.status(400).json({ error: 'Informe o horário de início e fim.' });
  }

  // Um registro por dia do período (máx. 60 dias).
  const days = [];
  for (let d = new Date(`${date}T12:00:00Z`); d.toISOString().slice(0, 10) <= last && days.length < 60; d.setUTCDate(d.getUTCDate() + 1))
    days.push(d.toISOString().slice(0, 10));
  for (const day of days)
    await run('INSERT INTO blocks (barber_id, date, start_min, end_min, reason) VALUES (?, ?, ?, ?, ?)', [
      barberId || null, day, s, e, reason ? String(reason).slice(0, 120) : null,
    ]);

  // Avisa se já existem clientes marcados no período bloqueado.
  const conflicts = await all(
    `${SELECT} WHERE a.status = 'booked' AND a.date BETWEEN ? AND ? AND a.start_min < ? AND a.end_min > ? ${barberId ? 'AND a.barber_id = ?' : ''} ORDER BY a.date, a.start_min`,
    barberId ? [date, last, e, s, barberId] : [date, last, e, s]
  );
  res.status(201).json({ created: days.length, conflicts: conflicts.map(serialize) });
}));

adminRouter.delete('/blocks/:id', ah(async (req, res) => {
  const { changes } = await run('DELETE FROM blocks WHERE id = ?', [Number(req.params.id)]);
  if (!changes) return res.status(404).json({ error: 'Bloqueio não encontrado.' });
  res.json({ ok: true });
}));

// ---------- clientes ----------
adminRouter.get('/clients', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const rows = await all(
    `SELECT u.id, u.name, u.email, u.phone, u.role,
            (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id AND a.status IN ('booked','done')) AS visits,
            (SELECT MAX(date) FROM appointments a WHERE a.user_id = u.id AND a.status IN ('booked','done')) AS last_visit
       FROM users u
      WHERE ? = '' OR u.name LIKE ? OR u.email LIKE ? ${digits ? 'OR u.phone LIKE ?' : ''}
      ORDER BY u.created_at DESC LIMIT 50`,
    digits ? [q, like, like, `%${digits}%`] : [q, like, like]
  );
  res.json({ clients: rows });
}));

adminRouter.post('/clients/:id/reset-link', ah(async (req, res) => {
  const user = await get('SELECT id, name, phone FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const { token, hours } = await createResetToken(user.id);
  const origin = `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${origin}/redefinir-senha?token=${token}`, hours, name: user.name, phone: user.phone });
}));
