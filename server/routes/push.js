import { Router } from 'express';
import { all, run } from '../db.js';
import { ah, requireAuth } from '../auth.js';
import { vapidKeys, saveSubscription, removeSubscription, notifyUser } from '../push.js';
import { serializeAll } from './booking.js';
import { nowLocal } from '../time.js';

export const pushRouter = Router();

pushRouter.get('/push/key', ah(async (_req, res) => res.json(await vapidKeys())));

pushRouter.post('/push/subscribe', requireAuth, ah(async (req, res) => {
  await saveSubscription(req.user.id, req.body?.subscription);
  res.status(201).json({ ok: true });
}));

pushRouter.post('/push/unsubscribe', requireAuth, ah(async (req, res) => {
  await removeSubscription(req.body?.endpoint);
  res.json({ ok: true });
}));

pushRouter.post('/push/test', requireAuth, ah(async (req, res) => {
  const sent = await notifyUser(req.user.id, {
    title: 'Notificações ativadas ✓',
    body: req.user.role === 'admin' ? 'Você vai receber cada novo agendamento aqui.' : 'Vamos te lembrar no dia do seu horário.',
    url: req.user.role === 'admin' ? '/painel' : '/conta',
  });
  res.json({ sent });
}));

// ---------- lembretes do dia (executado pelo Cron da Vercel, 1x por dia) ----------
// Na Vercel, defina CRON_SECRET para proteger a rota; a Vercel envia o segredo automaticamente.
pushRouter.get('/cron/reminders', ah(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret ? req.get('authorization') !== `Bearer ${secret}` : !/vercel-cron/i.test(req.get('user-agent') || ''))
    return res.status(401).json({ error: 'Não autorizado.' });

  const today = nowLocal().date;
  const rows = await all(
    "SELECT * FROM appointments WHERE date = ? AND status = 'booked' AND reminded_at IS NULL ORDER BY start_min",
    [today]
  );
  let sent = 0;
  const list = await serializeAll(rows);
  for (const [i, row] of rows.entries()) {
    const a = list[i];
    sent += await notifyUser(row.user_id, {
      title: `Hoje é dia! ${a.start} na Oliver's`,
      body: `${a.service.name} com ${a.barber.name}. Até mais tarde! ✂️`,
      url: '/conta',
      tag: `lembrete-${a.id}`,
    });
    await run('UPDATE appointments SET reminded_at = ? WHERE id = ?', [Date.now(), row.id]);
  }
  res.json({ date: today, appointments: rows.length, sent });
}));
