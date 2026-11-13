import { api, session, initNav, openAuth, toast, IMG, money, esc, fmtDay, parseDate, isoDate, waLink, maskPhone } from './core.js';

document.querySelectorAll('[data-img]').forEach((img) => (img.src = IMG[img.dataset.img]));
initNav();

const user = await session.load();
if (!user || user.role !== 'admin') {
  document.querySelector('main').innerHTML = `<div class="gate">
    <p class="eyebrow">Acesso restrito</p>
    <h1 class="display" style="font-size:72px;margin:12px 0">Só a <span class="serif">equipe</span></h1>
    <p class="muted">${user ? 'Sua conta não tem acesso ao painel.' : 'Entre com a conta da barbearia.'}</p>
    ${user ? '<a class="btn" href="/" style="margin-top:16px">Voltar ao site</a>' : '<button class="btn" data-login style="margin-top:16px">Entrar</button>'}</div>`;
  document.querySelector('[data-login]')?.addEventListener('click', async () => { if (await openAuth()) location.reload(); });
} else {
  init();
}

async function init() {
  const { barbers, today } = await api('/catalog');
  const dateEl = document.querySelector('[data-date]');
  const barberEl = document.querySelector('[data-barber]');
  barberEl.innerHTML += barbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  dateEl.value = today;

  const shift = (n) => { const d = parseDate(dateEl.value); d.setDate(d.getDate() + n); dateEl.value = isoDate(d); load(); };
  document.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => shift(+b.dataset.shift)));
  document.querySelector('[data-today]').addEventListener('click', () => { dateEl.value = today; load(); });
  dateEl.addEventListener('change', load);
  barberEl.addEventListener('change', load);

  document.querySelector('[data-timeline]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    if (b.dataset.status === 'cancelled' && !confirm('Cancelar este agendamento?')) return;
    try {
      await api(`/admin/appointments/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.status } });
      toast('Atualizado.');
      load();
    } catch (err) { toast(err.message, 'error'); }
  });

  async function load() {
    const date = dateEl.value;
    const q = `date=${date}${barberEl.value ? `&barber=${barberEl.value}` : ''}`;
    document.querySelector('[data-day-label]').textContent = fmtDay(date);
    const [{ appointments }, sum] = await Promise.all([api(`/admin/appointments?${q}`), api(`/admin/summary?date=${date}`)]);
    document.querySelector('[data-k=total]').textContent = sum.total;
    document.querySelector('[data-k=revenue]').textContent = money(sum.revenue);
    document.querySelector('[data-k=done]').textContent = sum.done;
    document.querySelector('[data-k=cancelled]').textContent = sum.cancelled;

    document.querySelector('[data-timeline]').innerHTML = appointments.length
      ? appointments.map(row).join('')
      : '<div class="empty">Nenhum agendamento para este dia.</div>';
  }

  function row(a) {
    const phone = a.client?.phone || '';
    const wa = phone ? waLink(`55${phone.replace(/^55/, '')}`, `Olá ${a.client.name.split(' ')[0]}! Aqui é da Oliver's Barbearia sobre seu horário de ${a.start}.`) : null;
    const actions = a.status === 'booked'
      ? `<button class="icon-btn icon-btn--ok" data-status="done" data-id="${a.id}">✓ Concluir</button>
         <button class="icon-btn" data-status="no_show" data-id="${a.id}">Faltou</button>
         <button class="icon-btn icon-btn--bad" data-status="cancelled" data-id="${a.id}">Cancelar</button>`
      : `<span class="badge badge--${a.status}">${{ done: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou' }[a.status]}</span>
         <button class="icon-btn" data-status="booked" data-id="${a.id}">Reabrir</button>`;
    return `<article class="tl tl--${a.status}">
      <div class="tl__time"><strong>${a.start}</strong><small>até ${a.end}</small></div>
      <div class="tl__info">
        <strong>${esc(a.client?.name)}</strong>
        <span>${esc(a.service.name)} · ${esc(a.barber.name)} · ${money(a.price)}${phone ? ` · ${esc(maskPhone(phone))}` : ''}</span>
        ${wa ? `<a class="link" style="margin-top:2px;font-size:13px" target="_blank" rel="noopener" href="${wa}">Chamar no WhatsApp</a>` : ''}
      </div>
      <div class="tl__actions">${actions}</div>
    </article>`;
  }

  load();
}
