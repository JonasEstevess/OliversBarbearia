import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { isDate } from '../time.js';
import { serialize } from './booking.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const SELECT = `SELECT a.*, u.name AS client_name, u.phone AS client_phone, u.email AS client_email
                  FROM appointments a JOIN users u ON u.id = a.user_id`;

adminRouter.get('/appointments', (req, res) => {
  const { date, barber } = req.query;
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const rows = barber
    ? db.prepare(`${SELECT} WHERE a.date = ? AND a.barber_id = ? ORDER BY a.start_min`).all(date, barber)
    : db.prepare(`${SELECT} WHERE a.date = ? ORDER BY a.start_min`).all(date);
  res.json({ appointments: rows.map(serialize) });
});

adminRouter.get('/summary', (req, res) => {
  const { date } = req.query;
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status IN ('booked','done') THEN price ELSE 0 END) AS revenue,
              SUM(status = 'done') AS done,
              SUM(status = 'cancelled') AS cancelled
         FROM appointments WHERE date = ?`
    )
    .get(date);
  res.json({ total: row.total || 0, revenue: row.revenue || 0, done: row.done || 0, cancelled: row.cancelled || 0 });
});

adminRouter.patch('/appointments/:id', (req, res) => {
  const { status } = req.body || {};
  if (!['booked', 'done', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  const info = db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(Number(req.params.id));
  res.json({ appointment: serialize(row) });
});
