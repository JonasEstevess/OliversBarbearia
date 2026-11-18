import { api, session, initNav, openAuth, toast, IMG, money, esc, fmtDay, parseDate, firstName, waLink, pushStatus, enablePush, disablePush } from './core.js';
import { openBooking } from './booking.js';

document.querySelectorAll('[data-img]').forEach((img) => (img.src = IMG[img.dataset.img]));
initNav();
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-book]');
  if (b) openBooking({ serviceId: b.dataset.service, barberId: b.dataset.barber });
});

const user = await session.load();
if (!user) {
  document.querySelector('main').innerHTML = `<div class="gate">
    <p class="eyebrow">Minha conta</p>
    <h1 class="display" style="font-size:72px;margin:12px 0">Entre <span class="serif">primeiro</span></h1>
    <p class="muted">Faça login para ver e gerenciar seus agendamentos.</p>
    <button class="btn" data-login style="margin-top:16px">Entrar <span class="arrow">→</span></button></div>`;
  const go = async () => { if (await openAuth()) location.reload(); };
  document.querySelector('[data-login]').addEventListener('click', go);
  go();
} else {
  document.querySelector('[data-hello]').innerHTML = `Olá, <span class="serif">${esc(firstName(user.name))}</span>`;
  document.querySelector('[data-logout]').addEventListener('click', async () => { await session.logout(); location.href = '/'; });
  load();
  initSettings();
}

// O servidor já envia os horários de São Paulo; comparamos com o relógio local como aproximação.
const isFuture = (a) => new Date(`${a.date}T${a.start}:00-03:00`) > new Date();

async function load() {
  const { appointments } = await api('/appointments');
  const upcoming = appointments.filter((a) => a.status === 'booked' && isFuture(a)).reverse();
  const history = appointments.filter((a) => !upcoming.includes(a));

  const next = upcoming[0];
  const nextEl = document.querySelector('[data-next]');
  if (next) {
    const days = Math.round((parseDate(next.date) - parseDate(new Date().toLocaleDateString('en-CA'))) / 864e5);
    const when = days === 0 ? 'Hoje' : days === 1 ? 'Amanhã' : `Em ${days} dias`;
    nextEl.innerHTML = `<div>
        <p class="eyebrow">Seu próximo horário · ${when}</p>
        <h2>${esc(fmtDay(next.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${next.start}</h2>
        <p>${esc(next.service.name)} com ${esc(next.barber.name)} · ${money(next.price)}</p>
      </div>
      <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=Oliver%27s+Barbearia,+R.+Serra+dos+Dois+Irm%C3%A3os,+474,+S%C3%A3o+Paulo">Como chegar <span class="arrow">→</span></a>`;
  } else {
    nextEl.innerHTML = `<div><p class="eyebrow">Nenhum horário marcado</p><h2>Bora marcar?</h2><p>Leva menos de 30 segundos.</p></div>
      <button class="btn" data-book>Agendar agora <span class="arrow">→</span></button>`;
  }

  document.querySelector('[data-upcoming]').innerHTML = upcoming.length ? upcoming.map((a, i) => row(a, i, true)).join('') : '<div class="empty">Nada por aqui ainda.</div>';
  document.querySelector('[data-history]').innerHTML = history.length ? history.map((a, i) => row(a, i, false)).join('') : '<div class="empty">Seu histórico aparece aqui depois do primeiro corte.</div>';
}

const STATUS = { booked: 'Agendado', done: 'Concluído', cancelled: 'Cancelado', no_show: 'Não compareceu' };

function row(a, i, upcoming) {
  const d = parseDate(a.date);
  const status = a.status === 'booked' && !upcoming ? 'done' : a.status;
  return `<article class="appt ${upcoming ? '' : 'appt--past'}" style="--i:${i}">
    <div class="appt__date"><strong>${d.getDate()}</strong><small>${d.toLocaleDateString('pt-BR', { month: 'short', weekday: 'short' }).replace(/\./g, '')}</small></div>
    <div class="appt__info"><strong>${esc(a.service.name)}</strong><span>${a.start} · ${esc(a.barber.name)} · ${money(a.price)}</span></div>
    <div class="appt__actions">
      <span class="badge badge--${status}">${STATUS[status]}</span>
      ${upcoming
        ? `<button class="btn btn--ghost btn--sm" data-cancel="${a.id}">Cancelar</button>`
        : `<button class="btn btn--ghost btn--sm" data-book data-service="${a.service.id}" data-barber="${a.barber.id}">Repetir</button>`}
    </div>
  </article>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cancel]');
  if (!b) return;
  if (!confirm('Cancelar este agendamento?')) return;
  b.disabled = true;
  try {
    await api(`/appointments/${b.dataset.cancel}/cancel`, { method: 'POST' });
    toast('Agendamento cancelado.');
    load();
  } catch (err) {
    toast(err.message, 'error');
    b.disabled = false;
    if (err.message.includes('WhatsApp')) window.open(waLink('5511951217241', 'Olá! Preciso remarcar meu horário.'), '_blank', 'noopener');
  }
});

// ---------- configurações: notificações e exclusão de conta ----------
async function initSettings() {
  const sw = document.querySelector('[data-push]');
  const hint = document.querySelector('[data-push-hint]');
  const set = (on) => sw.setAttribute('aria-checked', String(on));
  const status = await pushStatus();
  if (status === 'unsupported') {
    sw.disabled = true;
    hint.textContent = /iphone|ipad/i.test(navigator.userAgent)
      ? 'No iPhone, instale o app (Compartilhar → Adicionar à Tela de Início) para receber lembretes.'
      : 'Seu navegador não suporta notificações.';
  } else if (status === 'denied') {
    sw.disabled = true;
    hint.textContent = 'Notificações bloqueadas. Libere nas configurações do navegador.';
  } else set(status === 'on');

  sw.addEventListener('click', async () => {
    sw.disabled = true;
    try {
      if (sw.getAttribute('aria-checked') === 'true') { await disablePush(); set(false); toast('Lembretes desativados.'); }
      else { await enablePush(); set(true); toast('Lembretes ativados!'); }
    } catch (e) { toast(e.message, 'error'); }
    sw.disabled = false;
  });

  const form = document.querySelector('[data-delete]');
  const openBtn = document.querySelector('[data-delete-open]');
  openBtn.addEventListener('click', () => { form.hidden = false; openBtn.hidden = true; form.querySelector('input').focus(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Tem certeza? Sua conta e todo o histórico serão apagados para sempre.')) return;
    try {
      await disablePush().catch(() => {});
      await api('/auth/delete-account', { method: 'POST', body: { password: form.querySelector('input').value } });
      toast('Conta excluída. Até a próxima!');
      setTimeout(() => (location.href = '/'), 1000);
    } catch (err) { toast(err.message, 'error'); }
  });
}
