import { Router } from 'express';
import { all, get, run } from '../db.js';
import {
  ah, requireStaff, requireOwner, isOwner, canManageBarber, createResetToken, createInvite,
} from '../auth.js';
import { categories } from '../catalog.js';
import {
  listBarbers, getBarber, listServices, getService, getOpeningHours, normalizeHours, mapBarber, slugify,
} from '../store.js';
import { setSetting } from '../db.js';
import { isDate, nowLocal, toHHMM } from '../time.js';
import { notifyUser } from '../push.js';
import { serializeAll, serializeOne, dayLabel } from './booking.js';

export const adminRouter = Router();
adminRouter.use(requireStaff);

const fail = (status, error) => Object.assign(new Error(error), { status });
const SELECT = `SELECT a.*, u.name AS client_name, u.phone AS client_phone, u.email AS client_email
                  FROM appointments a JOIN users u ON u.id = a.user_id`;
const toMinutes = (hhmm) => (/^\d{2}:\d{2}$/.test(hhmm || '') ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) : null);
const origin = (req) => `${req.protocol}://${req.get('host')}`;

// Barbeiro só enxerga a própria agenda; dono escolhe (ou vê todos).
function scopeBarber(req, requested) {
  if (isOwner(req.user)) return requested || null;
  if (!req.user.barberId) throw fail(403, 'Sua conta ainda não está ligada a um perfil de barbeiro. Fale com o dono.');
  return req.user.barberId;
}

// ---------- quem sou eu ----------
adminRouter.get('/me', ah(async (req, res) => {
  const [barber, shopHours, barbers] = await Promise.all([
    req.user.barberId ? getBarber(req.user.barberId) : null,
    getOpeningHours(),
    listBarbers({ includeInactive: isOwner(req.user) }),
  ]);
  res.json({
    user: req.user,
    barber,
    shopHours,
    barbers: barbers.map(({ id, name, active }) => ({ id, name, active })),
    categories,
  });
}));

// ---------- agenda ----------
adminRouter.get('/appointments', ah(async (req, res) => {
  const { date } = req.query;
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const barber = scopeBarber(req, req.query.barber);
  const rows = barber
    ? await all(`${SELECT} WHERE a.date = ? AND a.barber_id = ? ORDER BY a.start_min`, [date, barber])
    : await all(`${SELECT} WHERE a.date = ? ORDER BY a.start_min`, [date]);
  res.json({ appointments: await serializeAll(rows) });
}));

adminRouter.get('/summary', ah(async (req, res) => {
  const { date } = req.query;
  if (!isDate(date)) return res.status(400).json({ error: 'Data inválida.' });
  const barber = scopeBarber(req, req.query.barber);
  const row = await get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status IN ('booked','done') THEN price ELSE 0 END) AS revenue,
            SUM(status = 'done') AS done,
            SUM(status = 'cancelled') AS cancelled
       FROM appointments WHERE date = ? ${barber ? 'AND barber_id = ?' : ''}`,
    barber ? [date, barber] : [date]
  );
  res.json({ total: row.total || 0, revenue: row.revenue || 0, done: row.done || 0, cancelled: row.cancelled || 0 });
}));

adminRouter.patch('/appointments/:id', ah(async (req, res) => {
  const { status } = req.body || {};
  if (!['booked', 'done', 'cancelled', 'no_show'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  const id = Number(req.params.id);
  const before = await get('SELECT status, barber_id FROM appointments WHERE id = ?', [id]);
  if (!before) return res.status(404).json({ error: 'Agendamento não encontrado.' });
  if (!canManageBarber(req.user, before.barber_id)) return res.status(403).json({ error: 'Esse horário é de outro barbeiro.' });
  await run('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);
  const row = await get(`${SELECT} WHERE a.id = ?`, [id]);
  const appt = await serializeOne(row);
  if (status === 'cancelled' && before.status !== 'cancelled') {
    await notifyUser(row.user_id, {
      title: 'Seu horário foi cancelado',
      body: `A barbearia cancelou ${appt.service.name} de ${dayLabel(appt.date)} às ${appt.start}. Toque para remarcar.`,
      url: '/#agendar',
      tag: `appt-${appt.id}`,
    });
  }
  res.json({ appointment: appt });
}));

// ---------- bloqueios (folgas, feriados, compromissos) ----------
async function serializeBlocks(rows) {
  const names = new Map((await listBarbers({ includeInactive: true })).map((b) => [b.id, b.name]));
  return rows.map((b) => ({
    id: b.id,
    barberId: b.barber_id,
    barberName: b.barber_id ? names.get(b.barber_id) || b.barber_id : 'Barbearia inteira',
    date: b.date,
    allDay: b.start_min === 0 && b.end_min >= 1440,
    start: toHHMM(b.start_min),
    end: toHHMM(Math.min(b.end_min, 1439)),
    reason: b.reason,
  }));
}

adminRouter.get('/blocks', ah(async (req, res) => {
  const today = nowLocal().date;
  const rows = isOwner(req.user)
    ? await all('SELECT * FROM blocks WHERE date >= ? ORDER BY date, start_min', [today])
    : await all('SELECT * FROM blocks WHERE date >= ? AND (barber_id IS NULL OR barber_id = ?) ORDER BY date, start_min', [today, req.user.barberId || '']);
  const blocks = await serializeBlocks(rows);
  res.json({ blocks: blocks.map((b) => ({ ...b, canDelete: canManageBarber(req.user, b.barberId) || isOwner(req.user) })) });
}));

adminRouter.post('/blocks', ah(async (req, res) => {
  const { date, endDate, allDay, start, end, reason } = req.body || {};
  // Barbeiro só bloqueia a própria agenda; "barbearia inteira" é só para o dono.
  const barberId = isOwner(req.user) ? req.body?.barberId || null : scopeBarber(req);
  if (barberId && !(await getBarber(barberId))) return res.status(400).json({ error: 'Barbeiro inválido.' });
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

  const days = [];
  for (let d = new Date(`${date}T12:00:00Z`); d.toISOString().slice(0, 10) <= last && days.length < 60; d.setUTCDate(d.getUTCDate() + 1))
    days.push(d.toISOString().slice(0, 10));
  for (const day of days)
    await run('INSERT INTO blocks (barber_id, date, start_min, end_min, reason) VALUES (?, ?, ?, ?, ?)', [
      barberId, day, s, e, reason ? String(reason).slice(0, 120) : null,
    ]);

  const conflicts = await all(
    `${SELECT} WHERE a.status = 'booked' AND a.date BETWEEN ? AND ? AND a.start_min < ? AND a.end_min > ? ${barberId ? 'AND a.barber_id = ?' : ''} ORDER BY a.date, a.start_min`,
    barberId ? [date, last, e, s, barberId] : [date, last, e, s]
  );
  res.status(201).json({ created: days.length, conflicts: await serializeAll(conflicts) });
}));

adminRouter.delete('/blocks/:id', ah(async (req, res) => {
  const block = await get('SELECT * FROM blocks WHERE id = ?', [Number(req.params.id)]);
  if (!block) return res.status(404).json({ error: 'Bloqueio não encontrado.' });
  if (!isOwner(req.user) && (!block.barber_id || block.barber_id !== req.user.barberId))
    return res.status(403).json({ error: 'Só o dono pode remover esse bloqueio.' });
  await run('DELETE FROM blocks WHERE id = ?', [block.id]);
  res.json({ ok: true });
}));

// ---------- clientes ----------
adminRouter.get('/clients', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, '');
  const rows = await all(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.staff_role,
            (SELECT COUNT(*) FROM appointments a WHERE a.user_id = u.id AND a.status IN ('booked','done')) AS visits,
            (SELECT MAX(date) FROM appointments a WHERE a.user_id = u.id AND a.status IN ('booked','done')) AS last_visit
       FROM users u
      WHERE ? = '' OR u.name LIKE ? OR u.email LIKE ? ${digits ? 'OR u.phone LIKE ?' : ''}
      ORDER BY u.created_at DESC LIMIT 50`,
    digits ? [q, like, like, `%${digits}%`] : [q, like, like]
  );
  res.json({ clients: rows.map(({ staff_role, ...c }) => ({ ...c, staffRole: c.role === 'admin' ? staff_role || 'owner' : null })) });
}));

adminRouter.post('/clients/:id/reset-link', ah(async (req, res) => {
  const user = await get('SELECT id, name, phone, role FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!user) return res.status(404).json({ error: 'Cliente não encontrado.' });
  if (user.role === 'admin' && !isOwner(req.user)) return res.status(403).json({ error: 'Só o dono pode gerar link para contas da equipe.' });
  const { token, hours } = await createResetToken(user.id);
  res.json({ url: `${origin(req)}/redefinir-senha?token=${token}`, hours, name: user.name, phone: user.phone });
}));

// ---------- perfil do barbeiro: nome, especialidade, horário de trabalho, foto ----------
adminRouter.patch('/barbers/:id', ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (!canManageBarber(req.user, barber.id)) return res.status(403).json({ error: 'Você só pode editar o seu próprio perfil.' });
  const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 60) : barber.name;
  const specialty = req.body.specialty !== undefined ? String(req.body.specialty).trim().slice(0, 60) : barber.specialty;
  if (name.length < 2) return res.status(400).json({ error: 'Informe o nome.' });
  let hours = barber.hours;
  if (req.body.hours !== undefined) hours = req.body.hours === null ? null : normalizeHours(req.body.hours);
  await run('UPDATE barbers SET name = ?, specialty = ?, hours = ? WHERE id = ?', [name, specialty || 'Barbeiro', hours ? JSON.stringify(hours) : null, barber.id]);
  res.json({ barber: await getBarber(barber.id) });
}));

const IMAGE_RE = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;
adminRouter.post('/barbers/:id/photo', ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (!canManageBarber(req.user, barber.id)) return res.status(403).json({ error: 'Você só pode trocar a sua própria foto.' });
  const m = IMAGE_RE.exec(String(req.body.image || ''));
  if (!m) return res.status(400).json({ error: 'Imagem inválida.' });
  if (m[2].length > 700_000) return res.status(413).json({ error: 'Imagem muito grande.' });
  const old = await get('SELECT photo_id FROM barbers WHERE id = ?', [barber.id]);
  const { lastInsertRowid } = await run('INSERT INTO media (mime, data) VALUES (?, ?)', [m[1], m[2]]);
  await run('UPDATE barbers SET photo_id = ? WHERE id = ?', [lastInsertRowid, barber.id]);
  if (old?.photo_id) await run('DELETE FROM media WHERE id = ?', [old.photo_id]);
  res.json({ barber: await getBarber(barber.id) });
}));

adminRouter.delete('/barbers/:id/photo', ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (!canManageBarber(req.user, barber.id)) return res.status(403).json({ error: 'Você só pode trocar a sua própria foto.' });
  const old = await get('SELECT photo_id FROM barbers WHERE id = ?', [barber.id]);
  await run('UPDATE barbers SET photo_id = NULL WHERE id = ?', [barber.id]);
  if (old?.photo_id) await run('DELETE FROM media WHERE id = ?', [old.photo_id]);
  res.json({ barber: await getBarber(barber.id) });
}));

// ================= SÓ O DONO =================

// ---------- equipe ----------
adminRouter.get('/team', requireOwner, ah(async (_req, res) => {
  const rows = await all(
    `SELECT b.*, u.name AS user_name, u.email AS user_email, u.staff_role AS user_staff_role,
            (SELECT COUNT(*) FROM appointments a WHERE a.barber_id = b.id AND a.status = 'booked' AND a.date >= ?) AS upcoming,
            (SELECT COUNT(*) FROM invites i WHERE i.barber_id = b.id AND i.expires_at > ?) AS pending_invite
       FROM barbers b LEFT JOIN users u ON u.id = b.user_id
      ORDER BY b.active DESC, b.sort, b.created_at`,
    [nowLocal().date, Date.now()]
  );
  const owners = await all(
    `SELECT u.id, u.name, u.email FROM users u
      WHERE u.role = 'admin' AND COALESCE(u.staff_role, 'owner') = 'owner' ORDER BY u.created_at`
  );
  res.json({
    barbers: rows.map((r) => ({
      ...mapBarber(r),
      account: r.user_id ? { id: r.user_id, name: r.user_name, email: r.user_email, staffRole: r.user_staff_role || 'owner' } : null,
      upcoming: r.upcoming,
      pendingInvite: !!r.pending_invite,
    })),
    owners,
  });
}));

adminRouter.post('/team', requireOwner, ah(async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 60);
  if (name.length < 2) return res.status(400).json({ error: 'Informe o nome do barbeiro.' });
  let id = slugify(name.split(' ')[0]);
  for (let n = 2; await get('SELECT 1 AS x FROM barbers WHERE id = ?', [id]); n++) id = `${slugify(name.split(' ')[0])}-${n}`;
  const sort = ((await get('SELECT MAX(sort) AS m FROM barbers'))?.m ?? 0) + 1;
  await run('INSERT INTO barbers (id, name, specialty, sort) VALUES (?, ?, ?, ?)', [id, name, String(req.body?.specialty || 'Barbeiro').slice(0, 60), sort]);
  const { token, days } = await createInvite(id);
  res.status(201).json({ barber: await getBarber(id), invite: { url: `${origin(req)}/convite?token=${token}`, days } });
}));

adminRouter.post('/team/:id/invite', requireOwner, ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  const { token, days } = await createInvite(barber.id);
  res.json({ invite: { url: `${origin(req)}/convite?token=${token}`, days }, barber });
}));

adminRouter.post('/team/:id/active', requireOwner, ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  const active = !!req.body?.active;
  if (!active && (await listBarbers()).length <= 1 && barber.active)
    return res.status(400).json({ error: 'A barbearia precisa de pelo menos um barbeiro ativo.' });
  await run('UPDATE barbers SET active = ? WHERE id = ?', [active ? 1 : 0, barber.id]);
  // Desligado: perde o acesso ao painel (a menos que seja dono).
  if (!active && barber.userId) await run("UPDATE users SET role = 'client', staff_role = NULL WHERE id = ? AND COALESCE(staff_role, 'owner') = 'barber'", [barber.userId]);
  if (active && barber.userId) await run("UPDATE users SET role = 'admin', staff_role = COALESCE(staff_role, 'barber') WHERE id = ? AND role = 'client'", [barber.userId]);
  const upcoming = (await get("SELECT COUNT(*) AS n FROM appointments WHERE barber_id = ? AND status = 'booked' AND date >= ?", [barber.id, nowLocal().date])).n;
  res.json({ barber: await getBarber(barber.id), upcoming });
}));

// O dono também corta? Liga a própria conta a um perfil de barbeiro.
adminRouter.post('/team/:id/link-me', requireOwner, ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber) return res.status(404).json({ error: 'Barbeiro não encontrado.' });
  if (barber.userId && barber.userId !== req.user.id) return res.status(409).json({ error: 'Este perfil já está ligado a outra conta.' });
  await run('UPDATE barbers SET user_id = NULL WHERE user_id = ?', [req.user.id]);
  await run('UPDATE barbers SET user_id = ? WHERE id = ?', [req.user.id, barber.id]);
  res.json({ barber: await getBarber(barber.id) });
}));

adminRouter.post('/team/:id/unlink', requireOwner, ah(async (req, res) => {
  const barber = await getBarber(req.params.id);
  if (!barber?.userId) return res.status(400).json({ error: 'Este perfil não tem conta ligada.' });
  await run('UPDATE barbers SET user_id = NULL WHERE id = ?', [barber.id]);
  await run("UPDATE users SET role = 'client', staff_role = NULL WHERE id = ? AND COALESCE(staff_role, 'owner') = 'barber'", [barber.userId]);
  res.json({ barber: await getBarber(barber.id) });
}));

// Promove uma conta existente (pelo e-mail) a barbeiro ou dono.
adminRouter.post('/team/promote', requireOwner, ah(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const staffRole = req.body?.staffRole === 'owner' ? 'owner' : 'barber';
  const user = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) return res.status(404).json({ error: 'Nenhuma conta com esse e-mail. Peça para a pessoa se cadastrar no site primeiro, ou use "Adicionar barbeiro" para mandar um convite.' });
  await run("UPDATE users SET role = 'admin', staff_role = ? WHERE id = ?", [staffRole, user.id]);
  let barberId = req.body?.barberId || null;
  if (staffRole === 'barber' && !barberId && !(await get('SELECT 1 AS x FROM barbers WHERE user_id = ?', [user.id]))) {
    // Cria o perfil de barbeiro com o nome da conta.
    barberId = slugify(user.name.split(' ')[0]);
    for (let n = 2; await get('SELECT 1 AS x FROM barbers WHERE id = ?', [barberId]); n++) barberId = `${slugify(user.name.split(' ')[0])}-${n}`;
    const sort = ((await get('SELECT MAX(sort) AS m FROM barbers'))?.m ?? 0) + 1;
    await run('INSERT INTO barbers (id, name, specialty, sort) VALUES (?, ?, ?, ?)', [barberId, user.name, 'Barbeiro', sort]);
  }
  if (barberId) {
    const b = await getBarber(barberId);
    if (!b) return res.status(400).json({ error: 'Perfil de barbeiro inválido.' });
    if (b.userId && b.userId !== user.id) return res.status(409).json({ error: 'Esse perfil já está ligado a outra conta.' });
    await run('UPDATE barbers SET user_id = NULL WHERE user_id = ?', [user.id]);
    await run('UPDATE barbers SET user_id = ? WHERE id = ?', [user.id, barberId]);
  }
  res.json({ ok: true, name: user.name, staffRole });
}));

// Muda o cargo de alguém da equipe (dono <-> barbeiro).
adminRouter.post('/users/:id/role', requireOwner, ah(async (req, res) => {
  const id = Number(req.params.id);
  const staffRole = req.body?.staffRole;
  if (!['owner', 'barber'].includes(staffRole)) return res.status(400).json({ error: 'Cargo inválido.' });
  const user = await get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [id]);
  if (!user) return res.status(404).json({ error: 'Conta da equipe não encontrada.' });
  if (staffRole === 'barber' && (user.staff_role || 'owner') === 'owner') {
    const owners = (await get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND COALESCE(staff_role, 'owner') = 'owner'")).n;
    if (owners <= 1) return res.status(400).json({ error: 'A barbearia precisa de pelo menos um dono.' });
  }
  await run('UPDATE users SET staff_role = ? WHERE id = ?', [staffRole, id]);
  res.json({ ok: true });
}));

// ---------- serviços e preços ----------
function readService(body, current = {}) {
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 60) : current.name;
  const cat = body.cat !== undefined ? String(body.cat) : current.cat;
  const price = body.price !== undefined ? Math.round(Number(body.price)) : current.price;
  const duration = body.duration !== undefined ? Math.round(Number(body.duration)) : current.duration;
  if (!name || name.length < 2) throw fail(400, 'Informe o nome do serviço.');
  if (!categories.some((c) => c.id === cat)) throw fail(400, 'Categoria inválida.');
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw fail(400, 'Preço inválido.');
  if (!Number.isFinite(duration) || duration < 5 || duration > 480 || duration % 5) throw fail(400, 'Duração deve ser de 5 em 5 minutos.');
  return {
    name, cat, price, duration,
    description: body.desc !== undefined ? String(body.desc).trim().slice(0, 160) : current.desc || '',
    popular: body.popular !== undefined ? !!body.popular : !!current.popular,
    active: body.active !== undefined ? !!body.active : current.active ?? true,
  };
}

adminRouter.get('/services', requireOwner, ah(async (_req, res) => res.json({ services: await listServices({ includeInactive: true }), categories })));

adminRouter.post('/services', requireOwner, ah(async (req, res) => {
  const s = readService(req.body || {});
  let id = slugify(s.name);
  for (let n = 2; await get('SELECT 1 AS x FROM services WHERE id = ?', [id]); n++) id = `${slugify(s.name)}-${n}`;
  const sort = ((await get('SELECT MAX(sort) AS m FROM services'))?.m ?? 0) + 1;
  await run(
    'INSERT INTO services (id, cat, name, description, price, duration, popular, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, s.cat, s.name, s.description, s.price, s.duration, s.popular ? 1 : 0, s.active ? 1 : 0, sort]
  );
  res.status(201).json({ service: await getService(id) });
}));

adminRouter.patch('/services/:id', requireOwner, ah(async (req, res) => {
  const current = await getService(req.params.id);
  if (!current) return res.status(404).json({ error: 'Serviço não encontrado.' });
  const s = readService(req.body || {}, current);
  if (!s.active && current.active && (await listServices()).length <= 1)
    return res.status(400).json({ error: 'Deixe pelo menos um serviço ativo.' });
  await run(
    'UPDATE services SET cat = ?, name = ?, description = ?, price = ?, duration = ?, popular = ?, active = ? WHERE id = ?',
    [s.cat, s.name, s.description, s.price, s.duration, s.popular ? 1 : 0, s.active ? 1 : 0, current.id]
  );
  res.json({ service: await getService(current.id) });
}));

// ---------- horário de funcionamento da barbearia ----------
adminRouter.put('/hours', requireOwner, ah(async (req, res) => {
  const hours = normalizeHours(req.body?.hours);
  await setSetting('opening_hours', JSON.stringify(hours));
  res.json({ hours });
}));

// Erros com status (fail) viram resposta amigável.
adminRouter.use((err, _req, res, next) => (err.status ? res.status(err.status).json({ error: err.message }) : next(err)));

// ---------- fotos (público, com cache longo: o endereço muda quando a foto muda) ----------
export const mediaRouter = Router();
mediaRouter.get('/media/:id', ah(async (req, res) => {
  const row = await get('SELECT mime, data FROM media WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).end();
  res.set({ 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(Buffer.from(row.data, 'base64'));
}));
