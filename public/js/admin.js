import {
  api, session, initNav, openAuth, toast, IMG, money, esc, fmtDay, parseDate, isoDate, waLink, maskPhone,
  pushStatus, enablePush, disablePush,
} from './core.js';

document.querySelectorAll('[data-img]').forEach((img) => (img.src = IMG[img.dataset.img]));
initNav();

const main = document.querySelector('main');
const user = await session.load();

if (!user || user.role !== 'admin') {
  const { needsSetup } = await api('/auth/setup').catch(() => ({ needsSetup: false }));
  if (needsSetup && !user) renderSetup();
  else renderGate();
} else {
  init();
}

// ---------- acesso restrito ----------
function renderGate() {
  main.innerHTML = `<div class="gate">
    <p class="eyebrow">Acesso restrito</p>
    <h1 class="display" style="font-size:72px;margin:12px 0">Só a <span class="serif">equipe</span></h1>
    <p class="muted">${user ? 'Sua conta não tem acesso ao painel.' : 'Entre com a conta da barbearia.'}</p>
    ${user ? '<a class="btn" href="/" style="margin-top:16px">Voltar ao site</a>' : '<button class="btn" data-login style="margin-top:16px">Entrar</button>'}</div>`;
  main.querySelector('[data-login]')?.addEventListener('click', async () => { if (await openAuth()) location.reload(); });
}

// ---------- primeira configuração: cria a conta do dono ----------
function renderSetup() {
  main.innerHTML = `<div class="setup">
    <p class="eyebrow">Primeiro acesso</p>
    <h1 class="display" style="font-size:64px;margin:12px 0">Criar conta da <span class="serif">barbearia</span></h1>
    <p class="muted">Ainda não existe nenhum administrador. Para criar, você precisa do <b style="color:var(--cream)">código de configuração</b>:</p>
    <ol>
      <li>Abra o projeto na <b>Vercel</b> → <b>Logs</b>.</li>
      <li>Procure a linha <code>[CONFIGURAÇÃO INICIAL]</code> e copie o código (ex.: <code>AB12C-3D45E</code>).</li>
    </ol>
    <form class="card" novalidate>
      <div class="field"><label for="s-code">Código de configuração</label><input class="input" id="s-code" name="code" autocomplete="off" autocapitalize="characters" required></div>
      <div class="field"><label for="s-name">Seu nome</label><input class="input" id="s-name" name="name" autocomplete="name" required></div>
      <div class="field"><label for="s-email">E-mail de acesso</label><input class="input" id="s-email" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="s-pass">Senha</label><input class="input" id="s-pass" name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Mínimo 8 caracteres" required></div>
      <p class="form-error" aria-live="polite"></p>
      <button class="btn btn--block" type="submit">Criar conta e abrir o painel <span class="arrow">→</span></button>
    </form></div>`;
  const form = main.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.textContent = '';
    try {
      await api('/auth/setup', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      toast('Conta criada! Bem-vindo ao painel.');
      setTimeout(() => location.reload(), 700);
    } catch (ex) { err.textContent = ex.message; }
  });
}

// ---------- painel ----------
async function init() {
  const { barbers, today } = await api('/catalog');
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);

  // abas
  const titles = { agenda: 'Agenda', bloqueios: 'Bloqueios', clientes: 'Clientes' };
  const loaders = { agenda: loadAgenda, bloqueios: loadBlocks, clientes: loadClients };
  function showTab(tab) {
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    $('[data-title]').textContent = titles[tab];
    loaders[tab]();
  }
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  initPushSwitch();

  // ===== agenda =====
  const dateEl = $('[data-date]');
  const barberEl = $('[data-barber]');
  const barberOpts = barbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  barberEl.innerHTML += barberOpts;
  $('#b-barber').innerHTML += barberOpts;
  dateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today;

  const shift = (n) => { const d = parseDate(dateEl.value); d.setDate(d.getDate() + n); dateEl.value = isoDate(d); loadAgenda(); };
  document.querySelectorAll('[data-shift]').forEach((b) => b.addEventListener('click', () => shift(+b.dataset.shift)));
  $('[data-today]').addEventListener('click', () => { dateEl.value = today; loadAgenda(); });
  dateEl.addEventListener('change', loadAgenda);
  barberEl.addEventListener('change', loadAgenda);

  $('[data-timeline]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    if (b.dataset.status === 'cancelled' && !confirm('Cancelar este agendamento? O cliente será avisado se tiver notificações ativas.')) return;
    try {
      await api(`/admin/appointments/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.status } });
      toast('Atualizado.');
      loadAgenda();
    } catch (err) { toast(err.message, 'error'); }
  });

  async function loadAgenda() {
    const date = dateEl.value;
    const q = `date=${date}${barberEl.value ? `&barber=${barberEl.value}` : ''}`;
    $('[data-day-label]').textContent = fmtDay(date);
    const [{ appointments }, sum, { blocks }] = await Promise.all([
      api(`/admin/appointments?${q}`), api(`/admin/summary?date=${date}`), api('/admin/blocks'),
    ]);
    $('[data-k=total]').textContent = sum.total;
    $('[data-k=revenue]').textContent = money(sum.revenue);
    $('[data-k=done]').textContent = sum.done;
    $('[data-k=cancelled]').textContent = sum.cancelled;
    $('[data-day-blocks]').innerHTML = blocks
      .filter((b) => b.date === date && (!barberEl.value || !b.barberId || b.barberId === barberEl.value))
      .map((b) => `<div class="day-block">⛔ <b>${esc(b.barberName)}</b> bloqueado ${b.allDay ? 'o dia todo' : `das ${b.start} às ${b.end}`}${b.reason ? ` · ${esc(b.reason)}` : ''}</div>`)
      .join('');
    $('[data-timeline]').innerHTML = appointments.length ? appointments.map(apptRow).join('') : '<div class="empty">Nenhum agendamento para este dia.</div>';
  }

  function apptRow(a) {
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

  // ===== bloqueios =====
  const bform = $('[data-block-form]');
  const allDay = bform.querySelector('[data-allday]');
  allDay.addEventListener('change', () => (bform.querySelector('[data-times]').hidden = allDay.checked));
  bform.date.value = today;
  bform.date.min = today;
  bform.endDate.min = today;

  bform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = bform.querySelector('.form-error');
    err.textContent = '';
    const body = {
      barberId: bform.barberId.value || null,
      date: bform.date.value,
      endDate: bform.endDate.value || null,
      allDay: allDay.checked,
      start: bform.start.value,
      end: bform.end.value,
      reason: bform.reason.value.trim(),
    };
    try {
      const { created, conflicts } = await api('/admin/blocks', { method: 'POST', body });
      toast(created > 1 ? `${created} dias bloqueados.` : 'Horário bloqueado.');
      bform.reason.value = '';
      bform.endDate.value = '';
      if (conflicts.length) {
        alert(`Atenção: ${conflicts.length} cliente(s) já estavam marcados nesse período e NÃO foram cancelados automaticamente:\n\n` +
          conflicts.map((c) => `• ${c.date.split('-').reverse().join('/')} ${c.start} — ${c.client?.name} (${c.service.name})`).join('\n') +
          '\n\nVeja na Agenda e avise ou cancele se precisar.');
      }
      loadBlocks();
    } catch (ex) { err.textContent = ex.message; }
  });

  $('[data-blocks]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unblock]');
    if (!b || !confirm('Remover este bloqueio? Os horários voltam a ficar disponíveis.')) return;
    try { await api(`/admin/blocks/${b.dataset.unblock}`, { method: 'DELETE' }); toast('Bloqueio removido.'); loadBlocks(); }
    catch (err) { toast(err.message, 'error'); }
  });

  async function loadBlocks() {
    const { blocks } = await api('/admin/blocks');
    $('[data-blocks]').innerHTML = blocks.length
      ? blocks.map((b) => `<article class="tl tl--block">
          <div class="tl__time"><strong>${b.date.slice(8)}/${b.date.slice(5, 7)}</strong><small>${esc(fmtDay(b.date, { weekday: 'short' }))}</small></div>
          <div class="tl__info"><strong>${esc(b.barberName)}</strong><span>${b.allDay ? 'Dia inteiro' : `${b.start} – ${b.end}`}${b.reason ? ` · ${esc(b.reason)}` : ''}</span></div>
          <div class="tl__actions"><button class="icon-btn icon-btn--bad" data-unblock="${b.id}">Remover</button></div>
        </article>`).join('')
      : '<div class="empty">Nenhum bloqueio agendado.</div>';
  }

  // ===== clientes =====
  const qEl = $('[data-client-q]');
  let timer;
  qEl.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(loadClients, 250); });

  $('[data-clients]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-reset]');
    if (!b) return;
    b.disabled = true;
    try {
      const { url, hours, name, phone } = await api(`/admin/clients/${b.dataset.reset}/reset-link`, { method: 'POST' });
      const msg = `Olá ${name.split(' ')[0]}! Aqui é da Oliver's Barbearia. Para criar uma nova senha, acesse: ${url} (válido por ${hours}h).`;
      if (phone) window.open(waLink(`55${phone.replace(/^55/, '')}`, msg), '_blank', 'noopener');
      else { await navigator.clipboard?.writeText(url).catch(() => {}); alert(`Link copiado:\n${url}`); }
      toast('Link gerado.');
    } catch (err) { toast(err.message, 'error'); }
    b.disabled = false;
  });

  async function loadClients() {
    const { clients } = await api(`/admin/clients?q=${encodeURIComponent(qEl.value.trim())}`);
    $('[data-clients]').innerHTML = clients.length
      ? clients.map((c) => `<article class="tl" style="border-left-color:${c.role === 'admin' ? 'var(--gold)' : 'var(--line-2)'}">
          <div class="tl__time"><strong>${c.visits}</strong><small>${c.visits === 1 ? 'visita' : 'visitas'}</small></div>
          <div class="tl__info"><strong>${esc(c.name)}${c.role === 'admin' ? ' · admin' : ''}</strong>
            <span>${esc(c.email)}${c.phone ? ` · ${esc(maskPhone(c.phone))}` : ''}</span>
            <span class="client__meta">${c.last_visit ? `Último horário: ${c.last_visit.split('-').reverse().join('/')}` : 'Ainda sem agendamentos'}</span></div>
          <div class="tl__actions">
            ${c.phone ? `<a class="icon-btn" target="_blank" rel="noopener" href="${waLink(`55${c.phone.replace(/^55/, '')}`, `Olá ${c.name.split(' ')[0]}!`)}">WhatsApp</a>` : ''}
            <button class="icon-btn" data-reset="${c.id}">Link de nova senha</button>
          </div>
        </article>`).join('')
      : '<div class="empty">Nenhum cliente encontrado.</div>';
  }

  showTab(['bloqueios', 'clientes'].includes(params.get('tab')) ? params.get('tab') : 'agenda');
}

// ---------- interruptor de notificações ----------
async function initPushSwitch() {
  const sw = document.querySelector('[data-push]');
  const hint = document.querySelector('[data-push-hint]');
  const set = (on) => sw.setAttribute('aria-checked', String(on));
  const status = await pushStatus();
  if (status === 'unsupported') {
    sw.disabled = true;
    hint.textContent = 'Este navegador não suporta notificações. No iPhone, instale o app pela Tela de Início.';
  } else if (status === 'denied') {
    sw.disabled = true;
    hint.textContent = 'Notificações bloqueadas. Libere nas configurações do navegador.';
  } else set(status === 'on');
  sw.addEventListener('click', async () => {
    sw.disabled = true;
    try {
      if (sw.getAttribute('aria-checked') === 'true') { await disablePush(); set(false); toast('Avisos desativados neste aparelho.'); }
      else { await enablePush(); set(true); toast('Avisos ativados! Mandamos uma notificação de teste.'); }
    } catch (e) { toast(e.message, 'error'); }
    sw.disabled = false;
  });
}
