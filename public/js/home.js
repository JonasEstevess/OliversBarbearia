import { api, session, initNav, initReveal, IMG, money, duration, esc, fmtDay } from './core.js';
import { openBooking } from './booking.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

// imagens
document.querySelectorAll('[data-img]').forEach((img) => (img.src = IMG[img.dataset.img]));
document.querySelector('[data-year]').textContent = new Date().getFullYear();

// rolagem suave
if (!reduce && window.Lenis) {
  const lenis = new window.Lenis({ lerp: 0.1 });
  window.__lenis = lenis;
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  document.querySelectorAll('a[href^="#"]').forEach((a) =>
    a.addEventListener('click', (e) => { const t = document.querySelector(a.getAttribute('href')); if (t) { e.preventDefault(); lenis.scrollTo(t, { offset: -70 }); } })
  );
}

// título em letras
document.querySelectorAll('[data-split]').forEach((el) => {
  el.innerHTML = [...el.textContent].map((c, i) => `<span class="ch" style="transition-delay:${i * 55}ms">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
});
requestAnimationFrame(() => setTimeout(() => document.body.classList.add('is-loaded'), 60));

initNav();
session.load();

// botões de agendar
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-book]');
  if (b) { e.preventDefault(); openBooking({ serviceId: b.dataset.service, barberId: b.dataset.barber }); }
});

const { shop, services, barbers, categories, openingHours, today } = await api('/catalog');

// ---------- status aberto/fechado + horários ----------
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
(function hours() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: shop.timezone }));
  const wd = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const toM = (s) => +s.slice(0, 2) * 60 + +s.slice(3);
  const block = (openingHours[wd] || []).find(([a, b]) => mins >= toM(a) && mins < toM(b));
  const later = (openingHours[wd] || []).find(([a]) => toM(a) > mins);
  const chip = document.querySelector('[data-open-status]');
  chip.innerHTML = block
    ? `<span class="dot"></span> Aberto agora <span class="muted">· até ${block[1]}</span>`
    : `<span class="dot dot--off"></span> Fechado agora <span class="muted">· ${later ? `volta às ${later[0]}` : 'agende online'}</span>`;

  const order = [2, 3, 4, 5, 6, 0, 1];
  document.querySelector('[data-hours]').innerHTML = order
    .map((d) => {
      const h = openingHours[d];
      const txt = h.length ? h.map(([a, b]) => `${a}–${b}`).join(' · ') : 'Fechado';
      return `<tr class="${d === wd ? 'today' : ''}"><td>${DAYS[d]}${d === wd ? ' · hoje' : ''}</td><td>${txt}</td></tr>`;
    })
    .join('');
})();

// ---------- próximo horário livre ----------
(async function nextSlot() {
  const el = document.querySelector('[data-next-slot] .next-slot__time');
  const go = document.querySelector('[data-next-slot] .next-slot__go');
  for (let i = 0; i < 8; i++) {
    const d = new Date(...today.split('-').map((n, k) => (k === 1 ? n - 1 : +n)));
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const { slots } = await api(`/availability?date=${iso}&service=corte&barber=any`);
    if (slots.length) {
      const label = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : fmtDay(iso, { weekday: 'short', day: 'numeric' });
      el.textContent = `${label}, ${slots[0].time}`;
      Object.assign(go.dataset, { service: 'corte' });
      return;
    }
  }
  el.textContent = 'Ver agenda';
})();

// ---------- serviços ----------
const list = document.querySelector('[data-services]');
const filters = document.querySelector('[data-filters]');
const tabs = [{ id: 'popular', name: 'Populares' }, ...categories, { id: 'all', name: 'Todos' }];
filters.innerHTML = tabs.map((t) => `<button role="tab" data-cat="${t.id}">${t.name}</button>`).join('');

function renderServices(cat) {
  filters.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.cat === cat)));
  const items = services.filter((s) => (cat === 'all' ? true : cat === 'popular' ? s.popular : s.cat === cat));
  list.innerHTML = items
    .map(
      (s, i) => `
      <li class="service" tabindex="0" role="button" data-book data-service="${s.id}" style="--i:${i}" data-img-i="${i % IMG.cuts.length}"
          aria-label="Agendar ${esc(s.name)}, ${money(s.price)}, ${duration(s.duration)}">
        <div>
          <div class="service__name">${esc(s.name)}${s.popular ? '<span class="service__tag">TOP</span>' : ''}</div>
          <p class="service__desc muted">${esc(s.desc)}</p>
        </div>
        <span class="service__dur muted">${duration(s.duration)}</span>
        <span class="service__price">${money(s.price)}</span>
        <span class="service__go" aria-hidden="true">→</span>
      </li>`
    )
    .join('');
}
filters.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) renderServices(b.dataset.cat); });
list.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.target.closest('.service')?.click(); } });
renderServices('popular');

// imagem que segue o cursor sobre a lista
if (fine && !reduce) {
  const hov = document.querySelector('.hover-img');
  const himg = hov.querySelector('img');
  let x = 0, y = 0, cx = 0, cy = 0;
  list.addEventListener('mousemove', (e) => {
    x = e.clientX; y = e.clientY;
    const row = e.target.closest('.service');
    if (row) { const src = IMG.cuts[row.dataset.imgI]; if (himg.src !== src) himg.src = src; hov.classList.add('on'); }
  });
  list.addEventListener('mouseleave', () => hov.classList.remove('on'));
  (function loop() { cx += (x - cx) * 0.14; cy += (y - cy) * 0.14; hov.style.left = `${cx + 140}px`; hov.style.top = `${cy}px`; requestAnimationFrame(loop); })();
}

// ---------- equipe ----------
document.querySelector('[data-team]').innerHTML =
  barbers
    .map(
      (b) => `
    <article class="barber" data-reveal>
      ${b.photo ? `<img class="barber__photo" src="${esc(b.photo)}" alt="${esc(b.name)}" loading="lazy">` : `<span class="barber__initials" aria-hidden="true">${esc(b.name.split(' ').map((p) => p[0]).join(''))}</span>`}
      <div><span class="barber__role">${esc(b.specialty)}</span><h3>${esc(b.name)}</h3></div>
      <button class="btn btn--ghost" data-book data-barber="${b.id}">Agendar com ${esc(b.name.split(' ')[0])} <span class="arrow">→</span></button>
    </article>`
    )
    .join('') +
  `<article class="barber" data-reveal>
     <span class="barber__initials" aria-hidden="true">?</span>
     <div><span class="barber__role">Sem preferência</span><h3>Quem estiver livre</h3></div>
     <button class="btn" data-book data-barber="any">Primeiro horário <span class="arrow">→</span></button>
   </article>`;

// ---------- galeria ----------
const track = document.querySelector('[data-gallery]');
track.innerHTML =
  IMG.cuts.map((src, i) => `<figure class="gallery__item" style="margin:0"><img src="${src}" alt="Corte feito na Oliver's Barbearia ${i + 1}" loading="lazy"></figure>`).join('') +
  IMG.space.map((p) => `<figure class="gallery__item gallery__item--space" style="margin:0"><img src="${p.src}" alt="${esc(p.caption)} na Oliver's Barbearia" loading="lazy"><figcaption>${esc(p.caption)}</figcaption></figure>`).join('') +
  `<div class="gallery__item gallery__item--cta" data-book role="button" tabindex="0"><div><strong>Quero<br>o meu</strong><p>Agendar agora →</p></div></div>`;

const gallery = document.querySelector('.gallery');
function galleryScroll() {
  if (innerWidth <= 860) return;
  const r = gallery.getBoundingClientRect();
  const total = gallery.offsetHeight - innerHeight;
  const p = Math.min(1, Math.max(0, -r.top / total));
  track.style.transform = `translateX(${-p * (track.scrollWidth - innerWidth)}px)`;
}

// ---------- manifesto: palavras acendem com a rolagem ----------
const manifesto = document.querySelector('[data-words]');
manifesto.innerHTML = manifesto.textContent.trim().split(/\s+/).map((w) => `<span class="w">${esc(w)}</span>`).join(' ');
const words = [...manifesto.querySelectorAll('.w')];
function wordsScroll() {
  const r = manifesto.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
  const n = Math.round(p * words.length);
  words.forEach((w, i) => w.classList.toggle('on', i < n));
}

// ---------- parallax do hero + CTA móvel ----------
const heroImg = document.querySelector('.hero__media img');
const mobileCta = document.querySelector('.mobile-cta');
function onScroll() {
  const y = scrollY;
  if (!reduce) heroImg.style.setProperty('--py', `${y * -0.08}px`);
  mobileCta.classList.toggle('show', y > innerHeight * 0.7);
  wordsScroll();
  galleryScroll();
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
onScroll();

// ---------- contadores ----------
const counters = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    counters.unobserve(e.target);
    const end = parseFloat(e.target.dataset.count);
    const dec = +(e.target.dataset.decimals || 0);
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / 1400);
      e.target.textContent = (end * (1 - Math.pow(1 - p, 4))).toFixed(dec).replace('.', ',');
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}, { threshold: 0.6 });
document.querySelectorAll('[data-count]').forEach((el) => counters.observe(el));

initReveal();

// ---------- cursor + botões magnéticos ----------
if (fine && !reduce) {
  const cur = document.querySelector('.cursor');
  let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; });
  (function loop() { cx += (x - cx) * 0.2; cy += (y - cy) * 0.2; cur.style.transform = `translate(${cx}px, ${cy}px)`; requestAnimationFrame(loop); })();
  document.addEventListener('mouseover', (e) => cur.classList.toggle('is-hover', !!e.target.closest('a, button, [role=button]')));

  document.querySelectorAll('.magnetic').forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect();
      btn.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
    });
    btn.addEventListener('mouseleave', () => (btn.style.transform = ''));
  });
}

// abre o agendamento direto se a URL pedir (ex.: /#agendar)
if (location.hash === '#agendar') openBooking({});
