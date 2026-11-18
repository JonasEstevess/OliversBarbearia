// Oliver's Barbearia — app mobile (SPA). Telas: Início, Agendar, Horários, Conta.
import {
  api, session, toast, money, duration, esc, fmtDay, parseDate, isoDate, icsFor, waLink, maskPhone, firstName,
  pushStatus, enablePush, disablePush, SHOP_WHATSAPP,
} from '/js/core.js';
import { resolveSelection } from '/js/pricing.js';

const V = 'v=3'; // versão das imagens (troca quando as fotos mudam)
const IMG = {
  logo: `/img/logo.jpg?${V}`,
  front: `/img/fachada.jpg?${V}`,
  cuts: [1, 2, 3, 4, 5].map((n) => `/img/corte-${n}.jpg?${V}`),
};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const tap = () => navigator.vibrate?.(8);
const ini = (n) => esc(String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join(''));
const photo = (b, cls = '') => `<span class="photo ${cls}">${b.photo ? `<img src="${esc(b.photo)}" alt="" loading="lazy">` : ini(b.name)}</span>`;
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const I = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  wa: '<svg viewBox="0 0 24 24"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.2-1.2 2 .9-.4 1.6c-3.6.4-7.9-3.9-7.5-7.5l1.6-.4.9 2z"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
};

// ---------- estado ----------
let cat; // catálogo
const book = { services: [], barberId: null, date: null, time: null, slotBarber: null, notes: '', done: null, cat: 'popular' };
let myAppts = null;

// ---------- bottom sheet ----------
function sheet(html, bind) {
  return new Promise((resolve) => {
    const el = $('[data-sheet]');
    const bd = $('[data-sheet-backdrop]');
    el.innerHTML = html;
    const close = (val) => {
      el.classList.remove('is-open');
      bd.classList.remove('is-open');
      bd.onclick = null;
      resolve(val);
    };
    bd.onclick = () => close(null);
    el.onclick = (e) => { const b = e.target.closest('[data-close]'); if (b) close(b.dataset.close || null); };
    requestAnimationFrame(() => { el.classList.add('is-open'); bd.classList.add('is-open'); });
    bind?.(el, close);
  });
}
const confirmSheet = (title, text, ok = 'Confirmar', danger = false) =>
  sheet(`<h3>${title}</h3><p>${text}</p><div class="stack">
    <button class="btn btn--block ${danger ? 'btn--danger' : ''}" data-close="ok">${ok}</button>
    <button class="btn btn--block btn--ghost" data-close="">Voltar</button></div>`).then((v) => v === 'ok');

// ---------- roteador ----------
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { tab: parts[0] || 'inicio', sub: parts[1] || null, q: new URLSearchParams(qs || '') };
}
const go = (hash, replace = false) => (replace ? location.replace(hash) : (location.hash = hash));
let lastStep = 0;

async function render() {
  const { tab, sub, q } = parseRoute();
  const name = ['inicio', 'agendar', 'horarios', 'conta'].includes(tab) ? tab : 'inicio';
  $$('[data-screen]').forEach((s) => s.classList.toggle('is-active', s.dataset.screen === name));
  $$('.tabbar a').forEach((a) => a.classList.toggle('is-active', a.dataset.tab === name));
  $('.actionbar')?.remove();
  const screen = $(`[data-screen="${name}"]`);
  screen.classList.remove('has-bar');
  if (name === 'inicio') renderHome(screen);
  if (name === 'agendar') renderBooking(screen, sub, q);
  if (name === 'horarios') renderAppts(screen);
  if (name === 'conta') renderAccount(screen);
  if (name !== 'agendar' || !sub) window.scrollTo(0, 0);
}
addEventListener('hashchange', render);

// =====================================================================
// INÍCIO
// =====================================================================
function openStatus() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: cat.shop.timezone }));
  const m = now.getHours() * 60 + now.getMinutes();
  const toM = (s) => +s.slice(0, 2) * 60 + +s.slice(3);
  const today = cat.openingHours[now.getDay()] || [];
  const cur = today.find(([a, b]) => m >= toM(a) && m < toM(b));
  const next = today.find(([a]) => toM(a) > m);
  return cur ? `<span class="chip"><span class="dot"></span>Aberto · até ${cur[1]}</span>`
    : `<span class="chip"><span class="dot dot--off"></span>Fechado${next ? ` · abre ${next[0]}` : ''}</span>`;
}

async function renderHome(el) {
  const user = session.user;
  const popular = cat.services.filter((s) => s.popular);
  el.innerHTML = `
    <div class="brandbar"><img src="${IMG.logo}" alt=""><strong>Oliver's</strong>${openStatus()}</div>
    <div class="hero">
      <img src="${IMG.front}" alt="Fachada da Oliver's Barbearia">
      <p>${user ? `Fala, ${esc(firstName(user.name))}! 👋` : 'Barbearia desde 2014 · Jardim Amália'}</p>
      <h2>Bora dar um <span class="serif">tapa</span> no visual?</h2>
      <a class="btn btn--block" href="#/agendar">Agendar horário</a>
    </div>
    <div data-next></div>

    <div class="section-title">Mais pedidos <a href="#/agendar">Ver todos</a></div>
    <div class="rail">${popular.map((s) => `
      <button class="svc-card" data-quick="${s.id}"><strong>${esc(s.name)}</strong><small>${duration(s.duration)}</small><b>${money(s.price)}</b></button>`).join('')}
    </div>

    <div class="section-title">Nossa equipe</div>
    <div class="rail">${cat.barbers.map((b) => `
      <button class="barber-card" data-barber-pick="${b.id}">${photo(b)}<strong>${esc(b.name)}</strong><small>${esc(b.specialty)}</small></button>`).join('')}
    </div>

    <div class="section-title">Trabalhos</div>
    <div class="rail">${IMG.cuts.map((src, i) => `<div class="shot"><img src="${src}" alt="Corte ${i + 1}" loading="lazy"></div>`).join('')}</div>

    <div class="section-title">A barbearia</div>
    <div class="list">
      <a class="row" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=Oliver%27s+Barbearia,+R.+Serra+dos+Dois+Irm%C3%A3os,+474,+S%C3%A3o+Paulo">
        <span class="row__icon">${I.pin}</span><span class="row__body"><strong>Como chegar</strong><small>R. Serra dos Dois Irmãos, 474 · Jardim Amália</small></span><span class="row__end">${I.chev}</span></a>
      <button class="row" data-hours><span class="row__icon">${I.clock}</span><span class="row__body"><strong>Horário de funcionamento</strong><small>${hoursToday()}</small></span><span class="row__end">${I.chev}</span></button>
      <a class="row" target="_blank" rel="noopener" href="${waLink(SHOP_WHATSAPP, 'Olá! Vim pelo app da Oliver\'s.')}">
        <span class="row__icon">${I.wa}</span><span class="row__body"><strong>WhatsApp</strong><small>${esc(cat.shop.phone)}</small></span><span class="row__end">${I.chev}</span></a>
      <a class="row" target="_blank" rel="noopener" href="https://www.instagram.com/${esc(cat.shop.instagram)}/">
        <span class="row__icon">${I.ig}</span><span class="row__body"><strong>Instagram</strong><small>@${esc(cat.shop.instagram)}</small></span><span class="row__end">${I.chev}</span></a>
    </div>
    <p class="muted" style="text-align:center;font-size:12px;margin:22px 0 0">★ 4,8 no Google · Especialista em afro</p>`;

  el.onclick = (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) { tap(); resetBooking(); book.services = [q.dataset.quick]; return go('#/agendar/profissional'); }
    const b = e.target.closest('[data-barber-pick]');
    if (b) { tap(); resetBooking(); book.barberId = b.dataset.barberPick; return go('#/agendar'); }
    if (e.target.closest('[data-hours]')) {
      const order = [1, 2, 3, 4, 5, 6, 0];
      const wd = new Date().getDay();
      sheet(`<h3>Horário de funcionamento</h3><div class="list" style="margin:12px 0 18px">${order.map((d) => {
        const h = cat.openingHours[d] || [];
        return `<div class="row"><span class="row__body"><strong style="${d === wd ? 'color:var(--gold-2)' : ''}">${DAYS[d]}${d === wd ? ' · hoje' : ''}</strong></span><span class="row__end">${h.length ? h.map(([a, z]) => `${a}–${z}`).join(' · ') : 'Fechado'}</span></div>`;
      }).join('')}</div><button class="btn btn--block btn--ghost" data-close>Fechar</button>`);
    }
  };

  // próximo horário do cliente
  if (user) {
    const next = (await loadAppts()).upcoming[0];
    if (next) $('[data-next]', el).innerHTML = `<div class="next">
      <small>Seu próximo horário · ${relDay(next.date)}</small>
      <strong>${esc(fmtDay(next.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${next.start}</strong>
      <p>${esc(next.service.name)} com ${esc(next.barber.name)}</p>
      <a class="btn" href="#/horarios">Ver detalhes</a></div>`;
  }
}

function hoursToday() {
  const h = cat.openingHours[new Date().getDay()] || [];
  return h.length ? `Hoje: ${h.map(([a, b]) => `${a}–${b}`).join(' · ')}` : 'Hoje: fechado';
}
function relDay(iso) {
  const diff = Math.round((parseDate(iso) - parseDate(cat.today)) / 864e5);
  return diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `Em ${diff} dias`;
}

// =====================================================================
// AGENDAR
// =====================================================================
const STEPS = ['servicos', 'profissional', 'horario', 'revisar'];
const STEP_TITLES = { servicos: 'O que vamos fazer?', profissional: 'Com quem?', horario: 'Qual horário?', revisar: 'Tudo certo?' };
function resetBooking() { Object.assign(book, { services: [], barberId: null, date: null, dateChosen: false, time: null, slotBarber: null, notes: '', done: null, cat: 'popular' }); }
const quote = () => resolveSelection(book.services, cat.services);
const barberName = (id) => (id === 'any' ? 'Primeiro disponível' : cat.barbers.find((b) => b.id === id)?.name || '');

function renderBooking(el, sub, q) {
  if (book.done && sub !== 'pronto') resetBooking();
  if (q.get('s')) { resetBooking(); book.services = q.get('s').split(',').filter((id) => cat.services.some((s) => s.id === id)); }
  if (q.get('b')) book.barberId = q.get('b');

  let step = sub || 'servicos';
  if (step === 'pronto') return renderDone(el);
  // Não deixa pular etapas (ex.: link direto ou voltar depois de recarregar).
  if (step !== 'servicos' && !book.services.length) step = 'servicos';
  if (['horario', 'revisar'].includes(step) && !book.barberId) step = 'profissional';
  if (step === 'revisar' && !book.time) step = 'horario';
  if (step !== (sub || 'servicos')) return go(`#/agendar/${step}`, true);

  const idx = STEPS.indexOf(step);
  const dir = idx >= lastStep ? 'step-in' : 'step-back';
  lastStep = idx;

  el.innerHTML = `
    <header class="appbar">
      ${idx > 0 ? `<button class="appbar__back" data-back aria-label="Voltar">${I.back}</button>` : ''}
      <div class="appbar__progress"><span style="width:${((idx + 1) / STEPS.length) * 100}%"></span></div>
      <span class="appbar__step">${idx + 1}/${STEPS.length}</span>
    </header>
    <div class="${dir}" data-step></div>`;
  $('[data-back]', el)?.addEventListener('click', () => history.back());
  const box = $('[data-step]', el);
  ({ servicos: stepServices, profissional: stepBarber, horario: stepTime, revisar: stepReview })[step](box, el);
}

function actionbar(html) {
  $('.actionbar')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div class="actionbar">${html}</div>`);
  $('[data-screen="agendar"]').classList.add('has-bar');
  return $('.actionbar');
}

// ----- 1. serviços (vários) -----
function stepServices(box) {
  const cats = [{ id: 'popular', name: 'Populares' }, ...cat.categories.filter((c) => cat.services.some((s) => s.cat === c.id))];
  const draw = () => {
    const sel = new Set(book.services);
    const list = book.cat === 'popular' ? cat.services.filter((s) => s.popular) : cat.services.filter((s) => s.cat === book.cat);
    box.innerHTML = `
      <h1 class="h1">O que vamos <span class="serif">fazer?</span></h1>
      <p class="lead">Pode escolher mais de um. Se formar um combo, o desconto entra sozinho.</p>
      <div class="cats">${cats.map((c) => `<button data-cat="${c.id}" aria-pressed="${book.cat === c.id}">${esc(c.name)}</button>`).join('')}</div>
      <div class="list">${list.map((s) => `
        <button class="pick ${sel.has(s.id) ? 'is-on' : ''}" data-svc="${s.id}" aria-pressed="${sel.has(s.id)}">
          <span class="check">${I.check}</span>
          <span class="pick__body"><strong>${esc(s.name)}${s.includes ? '<span class="tag">COMBO</span>' : ''}</strong>${s.desc ? `<small>${esc(s.desc)}</small>` : ''}</span>
          <span class="pick__meta"><b>${money(s.price)}</b><small>${duration(s.duration)}</small></span>
        </button>`).join('')}
      </div>`;
    drawBar();
  };
  const drawBar = () => {
    const r = quote();
    const bar = actionbar(r.items.length
      ? `<div class="actionbar__info"><small>${esc(r.label)} · ${duration(r.duration)}</small><strong>${money(r.price)}</strong>${r.savings ? `<s>${money(r.original)}</s>` : ''}</div>
         <button class="btn" data-next>Continuar</button>`
      : '<div class="actionbar__info"><small>Nenhum serviço escolhido</small><strong>Escolha um serviço</strong></div><button class="btn" disabled>Continuar</button>');
    $('[data-next]', bar)?.addEventListener('click', () => { tap(); go(`#/agendar/${book.barberId ? 'horario' : 'profissional'}`); });
    if (r.savings && r.combos.length) toastOnce(`Combo aplicado: ${r.combos.join(', ')} — você economiza ${money(r.savings)} 🎉`);
  };
  box.onclick = (e) => {
    const c = e.target.closest('[data-cat]');
    if (c) { book.cat = c.dataset.cat; tap(); draw(); return; }
    const s = e.target.closest('[data-svc]');
    if (s) {
      tap();
      const id = s.dataset.svc;
      const svc = cat.services.find((x) => x.id === id);
      let list = book.services.includes(id) ? book.services.filter((x) => x !== id) : [...book.services, id];
      // Escolheu um combo: tira os serviços que ele já inclui (e vice-versa).
      if (!book.services.includes(id) && svc.includes) list = list.filter((x) => !svc.includes.includes(x));
      if (!book.services.includes(id)) list = list.filter((x) => !cat.services.find((y) => y.id === x)?.includes?.includes(id));
      book.services = list;
      book.time = null;
      const on = list.includes(id);
      s.classList.toggle('is-on', on);
      s.setAttribute('aria-pressed', on);
      $$('[data-svc]', box).forEach((b) => { const v = list.includes(b.dataset.svc); b.classList.toggle('is-on', v); b.setAttribute('aria-pressed', v); });
      drawBar();
    }
  };
  draw();
}
let lastToast = '';
function toastOnce(msg) { if (msg !== lastToast) { lastToast = msg; toast(msg); } }

// ----- 2. profissional -----
function stepBarber(box) {
  const opts = [{ id: 'any', name: 'Primeiro disponível', specialty: 'Mais horários livres' }, ...cat.barbers];
  box.innerHTML = `
    <h1 class="h1">Com <span class="serif">quem?</span></h1>
    <p class="lead">${esc(quote().label)} · ${duration(quote().duration)}</p>
    <div class="list">${opts.map((b) => `
      <button class="opt ${book.barberId === b.id ? 'is-on' : ''}" data-b="${b.id}">
        ${b.id === 'any' ? '<span class="photo photo--sm">✦</span>' : photo(b, 'photo--sm')}
        <div><strong>${esc(b.name)}</strong><small>${esc(b.specialty)}</small></div>
        <span class="check">${I.check}</span>
      </button>`).join('')}
    </div>`;
  box.onclick = (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    tap();
    book.barberId = b.dataset.b;
    book.time = null;
    $$('[data-b]', box).forEach((x) => x.classList.toggle('is-on', x === b));
    setTimeout(() => go('#/agendar/horario'), 160);
  };
}

// ----- 3. dia e horário -----
function dayList() {
  const out = [];
  const start = parseDate(cat.today);
  const withBarber = book.barberId && book.barberId !== 'any' ? cat.barbers.find((b) => b.id === book.barberId) : null;
  for (let i = 0; i <= cat.bookingWindowDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const hours = withBarber?.hours || cat.openingHours;
    out.push({ iso: isoDate(d), d, i, open: (hours[d.getDay()] || []).length > 0 });
  }
  return out;
}

function stepTime(box) {
  const days = dayList();
  book.date ||= days.find((x) => x.open)?.iso || cat.today;
  box.innerHTML = `
    <h1 class="h1">Qual <span class="serif">horário?</span></h1>
    <p class="lead">${esc(barberName(book.barberId))} · ${duration(quote().duration)}</p>
    <div class="days">${days.map((x) => {
      const wd = x.i === 0 ? 'Hoje' : x.i === 1 ? 'Amanhã' : x.d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      return `<button class="day ${book.date === x.iso ? 'is-on' : ''}" data-day="${x.iso}" ${x.open ? '' : 'disabled'}><small>${wd}</small><strong>${x.d.getDate()}</strong><small>${x.d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small></button>`;
    }).join('')}</div>
    <p class="day-label" data-label></p>
    <div data-slots></div>`;
  $('.day.is-on', box)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  box.onclick = (e) => {
    const d = e.target.closest('[data-day]');
    if (d) { tap(); book.dateChosen = true; book.date = d.dataset.day; book.time = null; $$('.day', box).forEach((x) => x.classList.toggle('is-on', x === d)); d.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); loadSlots(box); drawTimeBar(); return; }
    const t = e.target.closest('[data-time]');
    if (t) { tap(); book.time = t.dataset.time; book.slotBarber = t.dataset.barber; $$('.time', box).forEach((x) => x.classList.toggle('is-on', x === t)); drawTimeBar(); }
    const n = e.target.closest('[data-next-day]');
    if (n) { const next = days.find((x) => x.open && x.iso > book.date); if (next) $(`[data-day="${next.iso}"]`, box).click(); }
  };
  loadSlots(box);
  drawTimeBar();
}

function drawTimeBar() {
  const bar = actionbar(book.time
    ? `<div class="actionbar__info"><small>${esc(fmtDay(book.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</small><strong>${book.time}</strong></div><button class="btn" data-next>Continuar</button>`
    : '<div class="actionbar__info"><small>Escolha um horário</small><strong>—</strong></div><button class="btn" disabled>Continuar</button>');
  $('[data-next]', bar)?.addEventListener('click', () => { tap(); go('#/agendar/revisar'); });
}

let slotReq = 0;
async function loadSlots(box) {
  const out = $('[data-slots]', box);
  $('[data-label]', box).textContent = fmtDay(book.date);
  out.innerHTML = `<div class="times">${'<span class="time sk"></span>'.repeat(12)}</div>`;
  const id = ++slotReq;
  try {
    const { slots } = await api(`/availability?date=${book.date}&services=${book.services.join(',')}&barber=${book.barberId}`);
    if (id !== slotReq) return;
    if (!slots.length && !book.dateChosen && book.date === cat.today) {
      // Hoje já não tem vaga: abre direto no próximo dia disponível.
      const next = dayList().find((x) => x.open && x.iso > book.date);
      if (next) {
        book.date = next.iso;
        $$('.day', box).forEach((x) => x.classList.toggle('is-on', x.dataset.day === next.iso));
        $('.day.is-on', box)?.scrollIntoView({ inline: 'center', block: 'nearest' });
        return loadSlots(box);
      }
    }
    if (!slots.length) {
      out.innerHTML = '<div class="empty"><strong>Sem horários nesse dia</strong>Tente outro dia ou outro barbeiro.<br><button class="btn btn--line btn--sm" data-next-day>Ver próximo dia</button></div>';
      return;
    }
    const groups = [['Manhã', (h) => h < 12], ['Tarde', (h) => h >= 12 && h < 18], ['Noite', (h) => h >= 18]];
    out.innerHTML = groups.map(([label, fn]) => {
      const list = slots.filter((s) => fn(+s.time.slice(0, 2)));
      return list.length ? `<div class="group-title">${label}</div><div class="times">${list.map((s) =>
        `<button class="time ${book.time === s.time ? 'is-on' : ''}" data-time="${s.time}" data-barber="${s.barber}">${s.time}</button>`).join('')}</div>` : '';
    }).join('');
  } catch (e) {
    out.innerHTML = `<div class="empty"><strong>Não carregou</strong>${esc(e.message)}</div>`;
  }
}

// ----- 4. revisão + login + confirmação -----
function stepReview(box) {
  const r = quote();
  const who = barberName(book.barberId === 'any' ? book.slotBarber : book.barberId);
  box.innerHTML = `
    <h1 class="h1">Tudo <span class="serif">certo?</span></h1>
    <p class="lead">Confira e confirme seu horário.</p>
    ${r.savings ? `<div class="saving">${I.tag}<span>Combo aplicado — você economiza ${money(r.savings)}</span></div>` : ''}
    <div class="summary">
      <div class="summary__row"><span>Serviço${r.items.length > 1 ? 's' : ''}</span><strong>${r.items.map((i) => esc(i.name)).join('<br>')}</strong></div>
      <div class="summary__row"><span>Com</span><strong>${esc(who)}</strong></div>
      <div class="summary__row"><span>Quando</span><strong>${esc(fmtDay(book.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${book.time}</strong></div>
      <div class="summary__row"><span>Duração</span><strong>${duration(r.duration)}</strong></div>
      <div class="summary__row summary__total"><span>Total</span><strong>${money(r.price)}</strong></div>
    </div>
    <div class="form" style="margin-top:14px"><div class="field"><label for="notes">Observação (opcional)</label>
      <textarea class="input" id="notes" maxlength="300" placeholder="Ex.: quero manter o volume em cima">${esc(book.notes)}</textarea></div></div>
    <p class="note">Pagamento na barbearia. Cancelamento grátis até <b>2h antes</b>, aqui no app.</p>
    <div data-auth></div>`;
  $('#notes', box).addEventListener('input', (e) => (book.notes = e.target.value));

  const drawBar = () => {
    const bar = actionbar(`<div class="actionbar__info"><small>${esc(r.label)}</small><strong>${money(r.price)}</strong></div>
      <button class="btn" data-confirm ${session.user ? '' : 'hidden'}>Confirmar</button>`);
    $('[data-confirm]', bar)?.addEventListener('click', confirmBooking);
  };
  if (!session.user) {
    const auth = $('[data-auth]', box);
    auth.innerHTML = '<div class="section-title" style="margin-top:22px">Pra confirmar, entre na sua conta</div><div data-authform></div>';
    authForm($('[data-authform]', auth), { mode: 'register', onDone: () => renderBooking($('[data-screen="agendar"]'), 'revisar', new URLSearchParams()) });
  }
  drawBar();
}

async function confirmBooking(e) {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Agendando…';
  try {
    const { appointment } = await api('/appointments', {
      method: 'POST',
      body: {
        serviceIds: book.services,
        barberId: book.barberId === 'any' ? book.slotBarber : book.barberId,
        date: book.date, time: book.time, notes: book.notes,
      },
    });
    book.done = appointment;
    myAppts = null;
    navigator.vibrate?.([20, 40, 20]);
    go('#/agendar/pronto', true);
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Confirmar';
    if (err.status === 409) { book.time = null; go('#/agendar/horario', true); }
    if (err.status === 401) { session.set(null); render(); }
  }
}

function renderDone(el) {
  const a = book.done;
  if (!a) return go('#/agendar', true);
  el.innerHTML = `<div class="done">
    <svg class="check-big" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36"/><path d="M24 41l11 11 21-23"/></svg>
    <h2>Tá marcado, <span class="serif">${esc(firstName(session.user?.name))}!</span></h2>
    <div class="summary">
      <div class="summary__row"><span>Quando</span><strong>${esc(fmtDay(a.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${a.start}</strong></div>
      <div class="summary__row"><span>Serviço</span><strong>${esc(a.service.name)}</strong></div>
      <div class="summary__row"><span>Com</span><strong>${esc(a.barber.name)}</strong></div>
      <div class="summary__row summary__total"><span>Total</span><strong>${money(a.price)}</strong></div>
    </div>
    <div class="stack">
      <button class="btn btn--block" data-remind hidden>🔔 Me lembrar no dia</button>
      <a class="btn btn--block btn--ghost" href="${icsFor(a, cat.shop)}" download="olivers-${a.date}.ics">Salvar no calendário</a>
      <a class="btn btn--block btn--line" href="#/horarios">Ver meus horários</a>
    </div>
  </div>`;
  const remind = $('[data-remind]', el);
  pushStatus().then((s) => { remind.hidden = s !== 'off'; });
  remind.onclick = async () => {
    remind.disabled = true;
    try { await enablePush(); remind.textContent = '✓ Lembrete ativado'; toast('Pronto! Vamos te lembrar no dia.'); }
    catch (err) { remind.disabled = false; toast(err.message, 'error'); }
  };
}

// =====================================================================
// MEUS HORÁRIOS
// =====================================================================
const isFuture = (a) => new Date(`${a.date}T${a.start}:00-03:00`) > new Date();
async function loadAppts(force = false) {
  if (!session.user) return { upcoming: [], past: [] };
  if (!myAppts || force) {
    const { appointments } = await api('/appointments');
    myAppts = {
      upcoming: appointments.filter((a) => a.status === 'booked' && isFuture(a)).reverse(),
      past: appointments.filter((a) => !(a.status === 'booked' && isFuture(a))),
    };
  }
  return myAppts;
}

let apptTab = 'upcoming';
async function renderAppts(el) {
  el.innerHTML = `<header class="appbar"><span class="appbar__title">Meus horários</span></header>`;
  if (!session.user) {
    el.insertAdjacentHTML('beforeend', `<div class="empty" style="margin-top:30px"><strong>Entre para ver seus horários</strong>Seus agendamentos aparecem aqui.<br><a class="btn btn--sm" href="#/conta">Entrar ou criar conta</a></div>`);
    return;
  }
  el.insertAdjacentHTML('beforeend', `<div class="seg"><button data-t="upcoming" aria-pressed="${apptTab === 'upcoming'}">Próximos</button><button data-t="past" aria-pressed="${apptTab === 'past'}">Anteriores</button></div><div data-list><div class="empty">Carregando…</div></div>`);
  const STATUS = { booked: 'Agendado', done: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou' };
  const draw = async (force) => {
    const data = await loadAppts(force);
    const list = data[apptTab];
    $('[data-list]', el).innerHTML = list.length ? list.map((a) => {
      const d = parseDate(a.date);
      const status = a.status === 'booked' && !isFuture(a) ? 'done' : a.status;
      return `<article class="appt ${apptTab === 'past' ? 'appt--past' : ''}">
        <div class="appt__date"><strong>${d.getDate()}</strong><small>${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small></div>
        <div class="appt__body">
          <strong>${esc(a.service.name)}</strong>
          <small>${esc(fmtDay(a.date, { weekday: 'long' }))} · ${a.start} · ${esc(a.barber.name)} · ${money(a.price)}</small>
          <span class="badge badge--${status}">${STATUS[status]}</span>
          <div class="appt__actions">${apptTab === 'upcoming'
            ? `<button class="btn btn--sm btn--danger" data-cancel="${a.id}">Cancelar</button>
               <a class="btn btn--sm btn--ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=Oliver%27s+Barbearia,+R.+Serra+dos+Dois+Irm%C3%A3os,+474,+S%C3%A3o+Paulo">Como chegar</a>`
            : `<button class="btn btn--sm btn--ghost" data-again="${a.id}">Agendar de novo</button>`}</div>
        </div></article>`;
    }).join('') : `<div class="empty"><strong>${apptTab === 'upcoming' ? 'Nenhum horário marcado' : 'Nada por aqui ainda'}</strong>${apptTab === 'upcoming' ? '<a class="btn btn--sm" href="#/agendar">Agendar agora</a>' : 'Seu histórico aparece aqui.'}</div>`;
  };
  el.onclick = async (e) => {
    const t = e.target.closest('[data-t]');
    if (t) { apptTab = t.dataset.t; $$('[data-t]', el).forEach((b) => b.setAttribute('aria-pressed', b === t)); tap(); draw(); return; }
    const c = e.target.closest('[data-cancel]');
    if (c) {
      if (!(await confirmSheet('Cancelar horário?', 'O horário será liberado para outra pessoa.', 'Sim, cancelar', true))) return;
      try { await api(`/appointments/${c.dataset.cancel}/cancel`, { method: 'POST' }); toast('Horário cancelado.'); draw(true); }
      catch (err) { toast(err.message, 'error'); }
      return;
    }
    const again = e.target.closest('[data-again]');
    if (again) {
      const a = [...myAppts.past].find((x) => String(x.id) === again.dataset.again);
      resetBooking();
      book.services = (a.items || []).map((i) => i.id).filter((id) => cat.services.some((s) => s.id === id));
      if (cat.barbers.some((b) => b.id === a.barber.id)) book.barberId = a.barber.id;
      go(book.services.length ? `#/agendar/${book.barberId ? 'horario' : 'profissional'}` : '#/agendar');
    }
  };
  draw(true);
}

// =====================================================================
// CONTA
// =====================================================================
function authForm(box, { mode = 'login', onDone } = {}) {
  const draw = () => {
    box.innerHTML = `
      <div class="seg"><button data-m="login" aria-pressed="${mode === 'login'}">Entrar</button><button data-m="register" aria-pressed="${mode === 'register'}">Criar conta</button></div>
      <form class="form" novalidate>
        ${mode === 'register' ? '<div class="field"><label for="f-name">Nome</label><input class="input" id="f-name" name="name" autocomplete="name" placeholder="Seu nome"></div>' : ''}
        <div class="field"><label for="f-email">E-mail</label><input class="input" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="voce@email.com"></div>
        ${mode === 'register' ? '<div class="field"><label for="f-phone">WhatsApp</label><input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 90000-0000"></div>' : ''}
        <div class="field"><label for="f-pass">Senha</label><input class="input" id="f-pass" name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="${mode === 'login' ? 'Sua senha' : 'Mínimo 8 caracteres'}"></div>
        ${mode === 'register' ? '<label class="terms"><input type="checkbox" name="acceptTerms"> <span>Li e aceito a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>' : ''}
        <p class="error" aria-live="polite"></p>
        <button class="btn btn--block" type="submit">${mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        ${mode === 'login' ? '<button class="btn btn--block btn--line" type="button" data-forgot>Esqueci minha senha</button>' : ''}
      </form>`;
    const form = $('form', box);
    form.phone?.addEventListener('input', () => (form.phone.value = maskPhone(form.phone.value)));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('.error', form);
      err.textContent = '';
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      const data = Object.fromEntries(new FormData(form));
      data.acceptTerms = !!form.acceptTerms?.checked;
      try {
        const { user } = await api(`/auth/${mode}`, { method: 'POST', body: data });
        session.set(user);
        myAppts = null;
        toast(mode === 'login' ? `Olá, ${firstName(user.name)}!` : `Conta criada. Bem-vindo, ${firstName(user.name)}!`);
        onDone?.(user);
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
    $('[data-forgot]', form)?.addEventListener('click', () => forgotSheet(form.email.value));
  };
  box.onclick = (e) => { const m = e.target.closest('[data-m]'); if (m && m.dataset.m !== mode) { mode = m.dataset.m; tap(); draw(); } };
  draw();
}

function forgotSheet(email = '') {
  sheet(`<h3>Esqueceu a senha?</h3><p>Digite o e-mail da sua conta. Vamos mandar um link para criar uma senha nova.</p>
    <form class="stack" novalidate>
      <input class="input" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="voce@email.com" value="${esc(email)}">
      <p class="error" aria-live="polite"></p>
      <button class="btn btn--block" type="submit">Enviar link</button>
      <button class="btn btn--block btn--ghost" type="button" data-close>Voltar</button>
    </form>`, (el, close) => {
    const form = $('form', el);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('.error', form);
      err.textContent = '';
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try {
        await api('/auth/forgot', { method: 'POST', body: { email: form.email.value.trim() } });
        el.innerHTML = `<h3>Confira seu e-mail 📬</h3><p>Se existir uma conta com <b>${esc(form.email.value.trim())}</b>, enviamos um link para criar uma senha nova. Ele vale por 1 hora. <b>Olhe também a caixa de spam.</b></p>
          <div class="stack"><button class="btn btn--block" data-close>Ok</button>
          <a class="btn btn--block btn--ghost" target="_blank" rel="noopener" href="${waLink(SHOP_WHATSAPP, 'Olá! Não estou conseguindo entrar no app da Oliver\'s.')}">Não recebeu? Fale com a barbearia</a></div>`;
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
  });
}

async function renderAccount(el) {
  const user = session.user;
  if (!user) {
    el.innerHTML = `<header class="appbar"><span class="appbar__title">Conta</span></header>
      <h1 class="h1">Sua <span class="serif">conta</span></h1><p class="lead">Entre para agendar mais rápido e ver seus horários.</p><div data-auth></div>`;
    authForm($('[data-auth]', el), { onDone: () => render() });
    return;
  }
  const staff = user.role === 'admin';
  el.innerHTML = `<header class="appbar"><span class="appbar__title">Conta</span></header>
    <div class="profile"><span class="photo">${ini(user.name)}</span><div><strong>${esc(user.name)}</strong><small>${esc(user.email)}${user.phone ? ` · ${esc(maskPhone(user.phone))}` : ''}</small></div></div>
    ${staff ? `<div class="list" style="margin-bottom:14px"><a class="row" href="/painel"><span class="row__icon">${I.grid}</span><span class="row__body"><strong>Painel da equipe</strong><small>${user.staffRole === 'owner' ? 'Agenda, equipe, serviços e preços' : 'Sua agenda, bloqueios e perfil'}</small></span><span class="row__end">${I.chev}</span></a></div>` : ''}
    <div class="list">
      <div class="row"><span class="row__icon">${I.bell}</span><span class="row__body"><strong>${staff ? 'Avisos de agendamento' : 'Lembretes'}</strong><small data-push-hint>${staff ? 'Notificação a cada novo agendamento' : 'Aviso no dia do seu horário'}</small></span><button class="switch" role="switch" aria-checked="false" data-push aria-label="Notificações"></button></div>
      <a class="row" target="_blank" rel="noopener" href="${waLink(SHOP_WHATSAPP, 'Olá! Vim pelo app da Oliver\'s.')}"><span class="row__icon">${I.wa}</span><span class="row__body"><strong>Falar com a barbearia</strong><small>WhatsApp</small></span><span class="row__end">${I.chev}</span></a>
      <a class="row" href="/privacidade"><span class="row__icon">${I.shield}</span><span class="row__body"><strong>Privacidade</strong><small>Como cuidamos dos seus dados</small></span><span class="row__end">${I.chev}</span></a>
    </div>
    <div class="list" style="margin-top:14px">
      <button class="row" data-logout><span class="row__icon">${I.out}</span><span class="row__body"><strong>Sair</strong></span></button>
      <button class="row row--danger" data-delete><span class="row__icon">${I.trash}</span><span class="row__body"><strong>Excluir minha conta</strong><small>Apaga cadastro e histórico</small></span></button>
    </div>
    <p class="muted" style="text-align:center;font-size:12px;margin:24px 0 0">Oliver's Barbearia · app v1</p>`;

  const sw = $('[data-push]', el);
  const st = await pushStatus();
  if (st === 'unsupported') { sw.disabled = true; $('[data-push-hint]', el).textContent = /iphone|ipad/i.test(navigator.userAgent) ? 'Adicione à Tela de Início para ativar' : 'Não suportado neste aparelho'; }
  else if (st === 'denied') { sw.disabled = true; $('[data-push-hint]', el).textContent = 'Bloqueado nas configurações do celular'; }
  else sw.setAttribute('aria-checked', String(st === 'on'));
  sw.onclick = async () => {
    sw.disabled = true;
    try {
      if (sw.getAttribute('aria-checked') === 'true') { await disablePush(); sw.setAttribute('aria-checked', 'false'); toast('Notificações desativadas.'); }
      else { await enablePush(); sw.setAttribute('aria-checked', 'true'); toast('Notificações ativadas!'); }
    } catch (e) { toast(e.message, 'error'); }
    sw.disabled = false;
  };

  $('[data-logout]', el).onclick = async () => {
    if (!(await confirmSheet('Sair da conta?', 'Você pode entrar de novo quando quiser.', 'Sair'))) return;
    await disablePush().catch(() => {});
    await session.logout();
    myAppts = null;
    render();
  };
  $('[data-delete]', el).onclick = () => sheet(`<h3>Excluir conta?</h3><p>Seu cadastro e todo o histórico serão apagados para sempre. Digite sua senha para confirmar.</p>
    <form class="stack" novalidate><input class="input" type="password" name="password" autocomplete="current-password" placeholder="Sua senha">
      <p class="error"></p><button class="btn btn--block btn--danger" type="submit">Excluir para sempre</button>
      <button class="btn btn--block btn--ghost" type="button" data-close>Voltar</button></form>`, (sh, close) => {
    const f = $('form', sh);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await disablePush().catch(() => {});
        await api('/auth/delete-account', { method: 'POST', body: { password: f.password.value } });
        session.set(null);
        close();
        toast('Conta excluída.');
        go('#/');
      } catch (ex) { $('.error', f).textContent = ex.message; }
    };
  });
}

// =====================================================================
// INICIALIZAÇÃO
// =====================================================================
(async () => {
  try {
    [cat] = await Promise.all([api('/catalog'), session.load()]);
  } catch {
    document.body.innerHTML = `<div class="empty" style="margin-top:40vh"><strong>Sem conexão</strong>Verifique a internet e tente de novo.<br><button class="btn btn--sm" onclick="location.reload()">Tentar de novo</button></div>`;
    return;
  }
  session.onChange(() => { myAppts = null; });
  render();
  setTimeout(() => $('[data-splash]').classList.add('is-gone'), 150);
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
