import { api, session, openAuth, registerLayer, toast, money, duration, esc, fmtDay, parseDate, isoDate, icsFor, waLink, firstName, enablePush, pushStatus } from './core.js';
import { resolveSelection } from './pricing.js';

let catalog;
let drawer;
const STEPS = ['Serviços', 'Profissional', 'Data e hora', 'Confirmar'];

const state = { step: 0, services: [], barberId: null, date: null, time: null, slotBarber: null, notes: '', done: null };

// Seleção atual com preço de combo aplicado (mesma regra do servidor).
const svc = () => {
  if (!state.services.length) return null;
  const r = resolveSelection(state.services, catalog.services);
  return r.items.length ? { ...r, name: r.label } : null;
};
const barberName = (id) => (id === 'any' ? 'Primeiro disponível' : catalog.barbers.find((b) => b.id === id)?.name || '');

export async function openBooking({ serviceId, serviceIds, barberId } = {}) {
  catalog ||= await api('/catalog');
  drawer ||= build();
  Object.assign(state, { step: 0, services: [], barberId: null, date: null, time: null, slotBarber: null, notes: '', done: null });
  const wanted = serviceIds?.length ? serviceIds : serviceId ? [serviceId] : [];
  state.services = wanted.filter((id) => catalog.services.some((s) => s.id === id));
  if (barberId && (barberId === 'any' || catalog.barbers.some((b) => b.id === barberId))) state.barberId = barberId;
  // Começa pelos serviços (dá para somar barba, sobrancelha...) mesmo vindo de um serviço específico.
  state.step = 0;
  drawer.open();
  render();
}

function build() {
  const el = document.createElement('aside');
  el.className = 'booking';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Agendar horário');
  el.innerHTML = `
    <header class="booking__head">
      <button class="booking__back" data-back aria-label="Voltar">←</button>
      <div class="booking__progress"><span data-progress></span></div>
      <button class="booking__close" data-close aria-label="Fechar">✕</button>
    </header>
    <div class="booking__step-label" data-label></div>
    <div class="booking__body" data-body></div>
    <footer class="booking__foot" data-foot>
      <div class="booking__summary" data-summary></div>
      <button class="btn" data-next>Continuar <span class="arrow">→</span></button>
    </footer>`;
  document.body.append(el);

  const layer = registerLayer({ close });
  function close() { el.classList.remove('is-open'); layer.close(); }

  el.querySelector('[data-close]').addEventListener('click', close);
  el.querySelector('[data-back]').addEventListener('click', back);
  el.querySelector('[data-next]').addEventListener('click', next);
  el.querySelector('[data-body]').addEventListener('click', onBodyClick);

  return { el, open() { layer.open(); el.classList.add('is-open'); }, close };
}

function back() {
  if (state.step === 2 && state.skipBarber) state.skipBarber = false;
  state.step = Math.max(0, state.step - 1);
  render();
}

async function next() {
  if (state.step === 0 && svc()) state.step = state.barberId ? 2 : 1;
  else if (state.step === 1 && state.barberId) state.step = 2;
  else if (state.step === 2 && state.time) state.step = 3;
  else if (state.step === 3) return confirm();
  else return;
  render();
}

function onBodyClick(e) {
  const t = e.target.closest('[data-pick]');
  if (!t) return;
  const { pick, value } = t.dataset;
  if (pick === 'service') {
    // Vários serviços: liga/desliga. Escolher um combo tira os serviços que ele já inclui (e vice-versa).
    const chosen = catalog.services.find((s) => s.id === value);
    const had = state.services.includes(value);
    let list = had ? state.services.filter((x) => x !== value) : [...state.services, value];
    if (!had) {
      if (chosen?.includes) list = list.filter((x) => !chosen.includes.includes(x));
      list = list.filter((x) => !catalog.services.find((y) => y.id === x)?.includes?.includes(value));
    }
    state.services = list;
    state.time = null;
  }
  if (pick === 'barber') { state.barberId = value; state.time = null; setTimeout(next, 180); }
  if (pick === 'date') { state.date = value; state.time = null; loadSlots(); }
  if (pick === 'time') { state.time = value; state.slotBarber = t.dataset.barber; }
  if (pick === 'login') return loginThenConfirm();
  if (pick === 'close') return drawer.close();
  if (pick === 'push') {
    t.disabled = true;
    enablePush()
      .then(() => { t.textContent = '✓ Lembrete ativado'; toast('Pronto! Vamos te lembrar no dia.'); })
      .catch((e) => { t.disabled = false; toast(e.message, 'error'); });
    return;
  }
  render(false);
}

// ---------- render ----------
function render(full = true) {
  const { el } = drawer;
  const done = !!state.done;
  el.classList.toggle('is-done', done);
  el.querySelector('[data-progress]').style.transform = `scaleX(${done ? 1 : (state.step + 1) / STEPS.length})`;
  el.querySelector('[data-label]').innerHTML = done ? '' : `<span>${String(state.step + 1).padStart(2, '0')}</span> / ${String(STEPS.length).padStart(2, '0')} — ${STEPS[state.step]}`;
  el.querySelector('[data-back]').style.visibility = state.step > 0 && !done ? 'visible' : 'hidden';

  const body = el.querySelector('[data-body]');
  if (done) {
    body.innerHTML = viewDone();
    pushStatus().then((st) => { if (st !== 'off') body.querySelector('[data-push-cta]')?.remove(); });
  }
  else if (full || state.step !== 2) body.innerHTML = [viewServices, viewBarbers, viewWhen, viewReview][state.step]();
  else updateWhen(body);

  if (full) { body.scrollTop = 0; body.classList.remove('anim'); void body.offsetWidth; body.classList.add('anim'); }
  if (state.step === 2 && full && !done) {
    state.date ||= firstOpenDate();
    loadSlots();
  }
  renderFoot();
}

function renderFoot() {
  const { el } = drawer;
  const foot = el.querySelector('[data-foot]');
  foot.hidden = !!state.done;
  const s = svc();
  const parts = [];
  if (s) parts.push(`<strong>${esc(s.name)}</strong>`);
  if (state.barberId) parts.push(esc(barberName(state.time && state.barberId === 'any' ? state.slotBarber : state.barberId)));
  if (state.time) parts.push(`${fmtDay(state.date, { day: 'numeric', month: 'short' })} · ${state.time}`);
  el.querySelector('[data-summary]').innerHTML = s
    ? `<div>${parts.join(' <i>•</i> ')}</div><div class="muted">${duration(s.duration)} · <b>${money(s.price)}</b>${s.savings ? ` <s>${money(s.original)}</s> <span class="saving-tag">combo −${money(s.savings)}</span>` : ''}</div>`
    : '<div class="muted">Escolha um ou mais serviços</div>';

  const btn = el.querySelector('[data-next]');
  const ready = [!!s, !!state.barberId, !!state.time, true][state.step];
  btn.disabled = !ready;
  btn.innerHTML = state.step === 3
    ? session.user ? 'Confirmar agendamento <span class="arrow">→</span>' : 'Entrar e confirmar <span class="arrow">→</span>'
    : 'Continuar <span class="arrow">→</span>';
}

function viewServices() {
  return `<h2 class="booking__title">O que vamos <span class="serif">fazer?</span></h2>
    <p class="muted booking__hint">Escolha um ou mais serviços. Se formar um combo, o desconto entra sozinho.</p>` +
    catalog.categories
      .map((c) => {
        const items = catalog.services.filter((s) => s.cat === c.id);
        if (!items.length) return '';
        return `<h3 class="booking__group">${esc(c.name)}</h3><div class="opt-list">${items
          .map(
            (s) => `<button class="opt opt--multi ${state.services.includes(s.id) ? 'is-on' : ''}" data-pick="service" data-value="${s.id}" aria-pressed="${state.services.includes(s.id)}">
              <span class="opt__check" aria-hidden="true">✓</span>
              <span class="opt__main"><strong>${esc(s.name)}${s.includes ? ' <span class="combo-tag">COMBO</span>' : ''}</strong><small class="muted">${esc(s.desc)}</small></span>
              <span class="opt__meta"><b>${money(s.price)}</b><small class="muted">${duration(s.duration)}</small></span>
            </button>`
          )
          .join('')}</div>`;
      })
      .join('');
}

function viewBarbers() {
  const opts = [{ id: 'any', name: 'Primeiro disponível', specialty: 'Mais horários livres' }, ...catalog.barbers];
  return `<h2 class="booking__title">Com <span class="serif">quem?</span></h2>
    <div class="barber-opts">${opts
      .map(
        (b) => `<button class="barber-opt ${state.barberId === b.id ? 'is-on' : ''}" data-pick="barber" data-value="${b.id}" aria-pressed="${state.barberId === b.id}">
          <span class="avatar">${b.photo ? `<img src="${esc(b.photo)}" alt="">` : b.id === 'any' ? '✦' : esc(b.name.split(' ').map((p) => p[0]).join(''))}</span>
          <span><strong>${esc(b.name)}</strong><small class="muted">${esc(b.specialty)}</small></span>
        </button>`
      )
      .join('')}</div>`;
}

function dates() {
  const out = [];
  const start = parseDate(catalog.today);
  for (let i = 0; i <= catalog.bookingWindowDays; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    out.push({ iso: isoDate(d), d, open: (catalog.openingHours[d.getDay()] || []).length > 0, i });
  }
  return out;
}
const firstOpenDate = () => dates().find((x) => x.open).iso;

function viewWhen() {
  const ds = dates();
  return `<h2 class="booking__title">Qual <span class="serif">horário?</span></h2>
    <div class="date-strip" role="listbox" aria-label="Datas">${ds
      .map((x) => {
        const wd = x.i === 0 ? 'Hoje' : x.i === 1 ? 'Amanhã' : x.d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        return `<button class="date ${state.date === x.iso ? 'is-on' : ''}" data-pick="date" data-value="${x.iso}" ${x.open ? '' : 'disabled'} aria-selected="${state.date === x.iso}">
          <small>${wd}</small><strong>${x.d.getDate()}</strong><small>${x.d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small>
        </button>`;
      })
      .join('')}</div>
    <p class="booking__day" data-day></p>
    <div data-slots class="slots"></div>`;
}

function updateWhen(body) {
  body.querySelectorAll('.date').forEach((b) => { const on = b.dataset.value === state.date; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
  body.querySelectorAll('.slot').forEach((b) => b.classList.toggle('is-on', b.dataset.value === state.time));
}

let slotReq = 0;
async function loadSlots() {
  const box = drawer.el.querySelector('[data-slots]');
  if (!box) return;
  drawer.el.querySelector('[data-day]').textContent = fmtDay(state.date);
  drawer.el.querySelector('.date.is-on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  box.innerHTML = '<div class="slots__grid">' + '<span class="slot skeleton"></span>'.repeat(12) + '</div>';
  const id = ++slotReq;
  try {
    const { slots } = await api(`/availability?date=${state.date}&services=${state.services.join(',')}&barber=${state.barberId}`);
    if (id !== slotReq) return;
    if (!slots.length) {
      box.innerHTML = `<div class="slots__empty">Sem horários livres nesse dia.<br><button class="link" data-pick="date" data-value="${nextOpen(state.date)}">Ver próximo dia →</button></div>`;
      return;
    }
    const groups = { Manhã: [], Tarde: [], Noite: [] };
    for (const s of slots) { const h = +s.time.slice(0, 2); (h < 12 ? groups.Manhã : h < 18 ? groups.Tarde : groups.Noite).push(s); }
    box.innerHTML = Object.entries(groups)
      .filter(([, v]) => v.length)
      .map(([k, v]) => `<h3 class="booking__group">${k} <span class="muted">· ${v.length} horários</span></h3><div class="slots__grid">${v
        .map((s, i) => `<button class="slot ${state.time === s.time ? 'is-on' : ''}" style="--i:${i}" data-pick="time" data-value="${s.time}" data-barber="${s.barber}">${s.time}</button>`)
        .join('')}</div>`)
      .join('');
  } catch (e) {
    box.innerHTML = `<div class="slots__empty">${esc(e.message)}</div>`;
  }
}
function nextOpen(iso) { const ds = dates(); const i = ds.findIndex((x) => x.iso === iso); return (ds.slice(i + 1).find((x) => x.open) || ds[i]).iso; }

function viewReview() {
  const s = svc();
  const who = barberName(state.barberId === 'any' ? state.slotBarber : state.barberId);
  return `<h2 class="booking__title">Tudo <span class="serif">certo?</span></h2>
    ${s.savings ? `<p class="booking__saving">🏷️ Combo aplicado — você economiza ${money(s.savings)}</p>` : ''}
    <div class="review">
      <div class="review__row"><span class="muted">Serviço${s.items.length > 1 ? 's' : ''}</span><strong>${s.items.map((i) => esc(i.name)).join('<br>')}</strong></div>
      <div class="review__row"><span class="muted">Profissional</span><strong>${esc(who)}</strong></div>
      <div class="review__row"><span class="muted">Data</span><strong>${esc(fmtDay(state.date))}</strong></div>
      <div class="review__row"><span class="muted">Horário</span><strong>${state.time} · ${duration(s.duration)}</strong></div>
      <div class="review__row review__total"><span>Total</span><strong>${money(s.price)}</strong></div>
    </div>
    <div class="field" style="margin-top:20px"><label for="b-notes">Alguma observação? (opcional)</label>
      <textarea class="input" id="b-notes" maxlength="300" placeholder="Ex.: quero manter o volume em cima">${esc(state.notes)}</textarea></div>
    <p class="muted booking__policy">Pagamento na barbearia. Cancelamento grátis até 2h antes pela sua conta.</p>
    ${session.user ? `<p class="booking__as">Agendando como <strong>${esc(session.user.name)}</strong></p>` : ''}`;
}

async function loginThenConfirm() {
  const user = await openAuth({ mode: 'register', reason: 'Falta pouco — só identificar você' });
  if (user) confirm();
}

async function confirm() {
  const notes = drawer.el.querySelector('#b-notes')?.value || '';
  state.notes = notes;
  if (!session.user) return loginThenConfirm();
  const btn = drawer.el.querySelector('[data-next]');
  btn.disabled = true;
  btn.innerHTML = 'Agendando…';
  try {
    const { appointment } = await api('/appointments', {
      method: 'POST',
      body: { serviceIds: state.services, barberId: state.barberId === 'any' ? state.slotBarber : state.barberId, date: state.date, time: state.time, notes },
    });
    state.done = appointment;
    render();
  } catch (e) {
    toast(e.message, 'error');
    if (e.status === 409) { state.time = null; state.step = 2; render(); }
    else if (e.status === 401) { session.set(null); loginThenConfirm(); }
    else renderFoot();
  }
}

function viewDone() {
  const a = state.done;
  const msg = `Olá! Acabei de agendar pelo site: ${a.service.name} com ${a.barber.name} em ${fmtDay(a.date, { day: '2-digit', month: '2-digit' })} às ${a.start}. — ${session.user?.name || ''}`;
  return `<div class="done">
    <svg class="done__check" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="36"/><path d="M24 41l11 11 21-23"/></svg>
    <p class="eyebrow">Confirmado</p>
    <h2 class="booking__title">Tá marcado, <span class="serif">${esc(firstName(session.user?.name))}!</span></h2>
    <div class="ticket">
      <div><small class="muted">Quando</small><strong>${esc(fmtDay(a.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${a.start}</strong></div>
      <div><small class="muted">Serviço</small><strong>${esc(a.service.name)}</strong></div>
      <div><small class="muted">Com</small><strong>${esc(a.barber.name)}</strong></div>
      <div><small class="muted">Valor</small><strong>${money(a.price)}</strong></div>
    </div>
    <div class="done__actions">
      <button class="btn btn--block" data-pick="push" data-push-cta>🔔 Me lembrar no dia</button>
      <a class="btn btn--ghost btn--block" href="${icsFor(a, catalog.shop)}" download="olivers-${a.date}.ics">Adicionar ao calendário</a>
      <a class="btn btn--ghost btn--block" target="_blank" rel="noopener" href="${waLink(catalog.shop.whatsapp, msg)}">Avisar no WhatsApp</a>
      <a class="link" href="/conta">Ver meus agendamentos →</a>
    </div>
  </div>`;
}
