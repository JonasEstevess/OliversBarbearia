// Utilitários compartilhados: API, sessão, formatação, toasts, nav e modal de login.

export const IMG = {
  // ?v= força os celulares a baixarem a versão nova quando uma foto muda.
  logo: '/img/logo.jpg?v=3',
  front: '/img/fachada.jpg?v=3',
  cuts: [1, 2, 3, 4, 5].map((n) => `/img/corte-${n}.jpg?v=3`),
  space: [
    { src: '/img/ambiente-cafe.jpg?v=3', caption: 'Cafezinho' },
    { src: '/img/ambiente-petiscos.jpg?v=3', caption: 'Petiscos' },
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
      <label class="check" data-only="register"><input type="checkbox" name="acceptTerms"> <span>Li e aceito a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>
      <p class="form-error" aria-live="polite"></p>
      <button class="btn btn--block" type="submit"><span data-submit>Entrar</span> <span class="arrow">→</span></button>
      <button class="link forgot" type="button" data-only="login" data-forgot>Esqueci minha senha</button>
      <div class="forgot-box" hidden data-forgot-box>
        <p data-forgot-msg>Digite seu e-mail acima e toque no botão. Vamos mandar um <b>link para criar uma senha nova</b>.</p>
        <button class="btn btn--block" type="button" data-forgot-send>Enviar link para meu e-mail</button>
        <a class="link" target="_blank" rel="noopener" data-forgot-wa hidden style="text-align:center;font-size:13px">Não recebeu? Fale com a barbearia</a>
      </div>
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
    el.querySelectorAll('[data-only=login]').forEach((f) => (f.hidden = m !== 'login'));
    el.querySelector('[data-forgot-box]').hidden = true;
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
  el.querySelector('[data-forgot]').addEventListener('click', () => {
    el.querySelector('[data-forgot-box]').hidden = false;
    el.querySelector('[data-forgot-msg]').innerHTML = 'Confira seu e-mail acima e toque no botão. Vamos mandar um <b>link para criar uma senha nova</b>.';
    el.querySelector('[data-forgot-send]').hidden = false;
    el.querySelector('[data-forgot-wa]').hidden = true;
    el.querySelector('#a-email').focus();
  });
  el.querySelector('[data-forgot-send]').addEventListener('click', async (e) => {
    const email = el.querySelector('#a-email').value.trim();
    const msg = el.querySelector('[data-forgot-msg]');
    const wa = el.querySelector('[data-forgot-wa]');
    wa.href = waLink(SHOP_WHATSAPP, `Olá! Não estou conseguindo entrar no site da Oliver's.${email ? ` Meu e-mail é ${email}.` : ''}`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = 'Digite o e-mail da sua conta.'; el.querySelector('#a-email').focus(); return; }
    err.textContent = '';
    e.target.disabled = true;
    e.target.textContent = 'Enviando…';
    try {
      await api('/auth/forgot', { method: 'POST', body: { email } });
      msg.innerHTML = `Pronto! Se existir uma conta com <b>${esc(email)}</b>, enviamos um link para criar uma senha nova. Ele vale por 1 hora. <b>Confira também a caixa de spam.</b>`;
      e.target.hidden = true;
      wa.hidden = false;
    } catch (ex) {
      msg.textContent = ex.message;
      wa.hidden = false;
    } finally {
      e.target.disabled = false;
      e.target.textContent = 'Enviar link para meu e-mail';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    data.acceptTerms = form.acceptTerms.checked;
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

export const SHOP_WHATSAPP = '5511951217241';

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

// ---------- PWA ----------
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---------- notificações push ----------
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function swRegistration() {
  return (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.register('/sw.js');
}

export async function pushStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub ? 'on' : 'off';
}

// Pede permissão, inscreve o aparelho e envia uma notificação de teste.
export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações. No iPhone, instale o app pela Tela de Início primeiro.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações nas configurações do navegador.');
  const reg = await swRegistration();
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(publicKey) });
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  await api('/push/test', { method: 'POST' });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
