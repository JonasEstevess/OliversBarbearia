// Utilitários compartilhados: API, sessão, formatação, toasts, nav e modal de login.

export const IMG = {
  logo: '/img/logo.jpg',
  front: '/img/fachada.jpg',
  cuts: ['/img/corte-1.jpg', '/img/corte-2.jpg', '/img/corte-3.jpg', '/img/corte-4.jpg', '/img/corte-5.jpg'],
  space: [
    { src: '/img/ambiente-cafe.jpg', caption: 'Cafezinho' },
    { src: '/img/ambiente-petiscos.jpg', caption: 'Petiscos' },
  ],
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Algo deu errado.'), { status: res.status });
  return data;
}

// ---------- sessão ----------
const listeners = new Set();
export const session = {
  user: null,
  async load() {
    try { this.user = (await api('/auth/me')).user; } catch { this.user = null; }
    listeners.forEach((fn) => fn(this.user));
    return this.user;
  },
  set(user) { this.user = user; listeners.forEach((fn) => fn(user)); },
  onChange(fn) { listeners.add(fn); },
  async logout() { await api('/auth/logout', { method: 'POST' }); this.set(null); },
};

// ---------- formatação ----------
export const money = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ''}` : `${min}min`);
export function parseDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export const fmtDay = (iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => { const s = parseDate(iso).toLocaleDateString('pt-BR', opts); return s.charAt(0).toUpperCase() + s.slice(1); };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const firstName = (n) => String(n || '').split(' ')[0];

// ---------- toasts ----------
export function toast(msg, type = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast--error' : ''}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => { el.style.transition = 'opacity .4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 3600);
}

// ---------- overlay compartilhado ----------
let overlayEl;
const openStack = [];
export function overlay() {
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.className = 'overlay';
    overlayEl.addEventListener('click', () => openStack.at(-1)?.close());
    document.body.append(overlayEl);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') openStack.at(-1)?.close(); });
  }
  return overlayEl;
}
export function registerLayer(layer) {
  return {
    open() { openStack.push(layer); overlay().classList.add('is-open'); document.documentElement.style.overflow = 'hidden'; window.__lenis?.stop(); },
    close() {
      const i = openStack.indexOf(layer); if (i > -1) openStack.splice(i, 1);
      if (!openStack.length) { overlay().classList.remove('is-open'); document.documentElement.style.overflow = ''; window.__lenis?.start(); }
    },
  };
}

// ---------- modal de login/cadastro ----------
let authModal;
export function openAuth({ mode = 'login', reason } = {}) {
  return new Promise((resolve) => {
    if (!authModal) authModal = buildAuthModal();
    authModal.show(mode, reason, resolve);
  });
}

function buildAuthModal() {
  const el = document.createElement('div');
  el.className = 'modal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'auth-title');
  el.innerHTML = `
    <button class="modal__close" aria-label="Fechar">✕</button>
    <p class="eyebrow" data-reason>Sua conta</p>
    <h2 id="auth-title">Bem-vindo<br><span class="serif">de volta</span></h2>
    <div class="tabs" role="tablist">
      <button role="tab" data-mode="login">Entrar</button>
      <button role="tab" data-mode="register">Criar conta</button>
    </div>
    <form novalidate>
      <div class="field" data-only="register"><label for="a-name">Nome</label><input class="input" id="a-name" name="name" autocomplete="name" placeholder="Seu nome"></div>
      <div class="field"><label for="a-email">E-mail</label><input class="input" id="a-email" name="email" type="email" autocomplete="email" placeholder="voce@email.com" required></div>
      <div class="field" data-only="register"><label for="a-phone">WhatsApp</label><input class="input" id="a-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(11) 90000-0000"></div>
      <div class="field"><label for="a-pass">Senha</label><input class="input" id="a-pass" name="password" type="password" minlength="8" required placeholder="Mínimo 8 caracteres"></div>
      <p class="form-error" aria-live="polite"></p>
      <button class="btn btn--block" type="submit"><span data-submit>Entrar</span> <span class="arrow">→</span></button>
    </form>`;
  document.body.append(el);

  const form = el.querySelector('form');
  const err = el.querySelector('.form-error');
  const title = el.querySelector('#auth-title');
  const phone = el.querySelector('#a-phone');
  let mode = 'login';
  let done = null;
  const layer = registerLayer({ close: () => close(null) });

  phone.addEventListener('input', () => { phone.value = maskPhone(phone.value); });

  function setMode(m) {
    mode = m;
    el.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    el.querySelectorAll('[data-only=register]').forEach((f) => (f.hidden = m !== 'register'));
    title.innerHTML = m === 'login' ? 'Bem-vindo<br><span class="serif">de volta</span>' : 'Crie sua<br><span class="serif">conta</span>';
    el.querySelector('[data-submit]').textContent = m === 'login' ? 'Entrar' : 'Criar conta';
    el.querySelector('#a-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    err.textContent = '';
  }

  function close(user) {
    el.classList.remove('is-open');
    layer.close();
    const fn = done; done = null;
    fn?.(user);
  }

  el.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  el.querySelector('.modal__close').addEventListener('click', () => close(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const { user } = await api(`/auth/${mode}`, { method: 'POST', body: data });
      session.set(user);
      toast(mode === 'login' ? `Olá, ${firstName(user.name)}!` : `Conta criada. Bem-vindo, ${firstName(user.name)}!`);
      form.reset();
      close(user);
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  return {
    show(m, reason, resolve) {
      done = resolve;
      setMode(m);
      el.querySelector('[data-reason]').textContent = reason || 'Sua conta';
      layer.open();
      el.classList.add('is-open');
      setTimeout(() => el.querySelector(m === 'login' ? '#a-email' : '#a-name').focus(), 80);
    },
  };
}

export function maskPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

// ---------- nav ----------
export function initNav() {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  let last = 0;
  addEventListener('scroll', () => {
    const y = scrollY;
    nav.classList.toggle('is-scrolled', y > 40);
    nav.classList.toggle('is-hidden', y > 400 && y > last && !document.documentElement.style.overflow);
    last = y;
  }, { passive: true });

  const slot = nav.querySelector('[data-user-slot]');
  const render = (user) => {
    if (!slot) return;
    if (!user) {
      slot.innerHTML = '<button class="nav__user" data-login>Entrar</button>';
      slot.querySelector('[data-login]').addEventListener('click', () => openAuth());
    } else {
      const panel = user.role === 'admin' ? '<a class="nav__user" href="/painel">Painel</a>' : '';
      slot.innerHTML = `${panel}<a class="nav__user" href="/conta">👤 <span>${esc(firstName(user.name))}</span></a>`;
    }
  };
  session.onChange(render);
  render(session.user);
}

// ---------- reveal on scroll ----------
export function initReveal(root = document) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -10% 0px' });
  root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
}

// ---------- calendário (.ics) e WhatsApp ----------
export function icsFor(appt, shop) {
  const [y, mo, d] = appt.date.split('-');
  const t = (hhmm) => hhmm.replace(':', '') + '00';
  const body = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Olivers Barbearia//PT-BR', 'BEGIN:VEVENT',
    `UID:olivers-${appt.id}@oliversbarbearia`,
    `DTSTART;TZID=America/Sao_Paulo:${y}${mo}${d}T${t(appt.start)}`,
    `DTEND;TZID=America/Sao_Paulo:${y}${mo}${d}T${t(appt.end)}`,
    `SUMMARY:${appt.service.name} — ${shop.name}`,
    `DESCRIPTION:Com ${appt.barber.name}`,
    `LOCATION:${shop.address}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
}

export function waLink(phone, text) { return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`; }
