import {
  api, session, initNav, openAuth, toast, IMG, money, esc, fmtDay, parseDate, isoDate, waLink, maskPhone,
  pushStatus, enablePush, disablePush,
} from './core.js';

document.querySelectorAll('[data-img]').forEach((img) => (img.src = IMG[img.dataset.img]));
initNav();

const main = document.querySelector('main');
const user = await session.load();
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const wa = (phone, text) => waLink(`55${String(phone).replace(/\D/g, '').replace(/^55/, '')}`, text);
const initials = (name) => esc(String(name).split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join(''));
const avatar = (b) => `<span class="avatar">${b.photo ? `<img src="${esc(b.photo)}" alt="">` : initials(b.name)}</span>`;
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

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

// ---------- editor de horário semanal ----------
// hours: { "0": [["09:00","14:00"], ...], ... }  →  linhas com "Aberto" + texto "09:00-14:00, 15:00-20:00"
function hoursEditor(container, hours) {
  container.innerHTML = WEEK.map((d) => {
    const list = hours?.[d] || [];
    const txt = list.map(([a, b]) => `${a}-${b}`).join(', ');
    return `<div class="hours-row" data-day="${d}">
      <strong>${DAYS[d].slice(0, 3)}</strong>
      <label class="check"><input type="checkbox" ${list.length ? 'checked' : ''} data-open> <span>Aberto</span></label>
      <input class="input" value="${esc(txt || '09:00-18:00')}" ${list.length ? '' : 'disabled'} data-ranges aria-label="Horários de ${DAYS[d]}">
    </div>`;
  }).join('');
  $$('[data-open]', container).forEach((c) => c.addEventListener('change', () => { c.closest('.hours-row').querySelector('[data-ranges]').disabled = !c.checked; }));
  return () => {
    const out = {};
    for (const row of $$('.hours-row', container)) {
      const d = row.dataset.day;
      if (!row.querySelector('[data-open]').checked) { out[d] = []; continue; }
      const parts = row.querySelector('[data-ranges]').value.split(',').map((x) => x.trim()).filter(Boolean);
      out[d] = parts.map((p) => {
        const m = /^(\d{1,2}):?(\d{2})\s*[-–a]\s*(\d{1,2}):?(\d{2})$/i.exec(p.replace(/h/gi, ''));
        if (!m) throw new Error(`${DAYS[d]}: não entendi "${p}". Use o formato 09:00-14:00.`);
        const f = (h, mm) => `${String(h).padStart(2, '0')}:${mm}`;
        return [f(m[1], m[2]), f(m[3], m[4])];
      });
    }
    return out;
  };
}

// ---------- foto: corta quadrada e comprime no próprio aparelho ----------
async function pickPhoto() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  const file = await new Promise((resolve) => { input.onchange = () => resolve(input.files[0]); input.click(); });
  if (!file) return null;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) throw new Error('Não consegui abrir essa imagem. Tente outra (JPG ou PNG).');
  const size = 640;
  const side = Math.min(img.width, img.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  // Recorte centralizado, um pouco acima do meio (rostos costumam ficar no terço superior).
  const sx = (img.width - side) / 2;
  const sy = Math.max(0, (img.height - side) * 0.35);
  canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size);
  let data = canvas.toDataURL('image/webp', 0.82);
  if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.82);
  return data;
}

// =====================================================================
async function init() {
  const params = new URLSearchParams(location.search);
  const owner = user.staffRole === 'owner';
  let me = await api('/admin/me');
  const today = (await api('/catalog')).today;

  if (!owner) $$('[data-owner-only]').forEach((el) => el.remove());

  const titles = { agenda: owner ? 'Agenda' : 'Minha agenda', bloqueios: 'Bloqueios', clientes: 'Clientes', perfil: 'Meu perfil', equipe: 'Equipe', barbearia: 'Barbearia' };
  const loaders = { agenda: loadAgenda, bloqueios: loadBlocks, clientes: loadClients, perfil: loadProfile, equipe: loadTeam, barbearia: loadShop };
  function showTab(tab) {
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab));
    $('[data-title]').textContent = titles[tab];
    history.replaceState(null, '', tab === 'agenda' ? '/painel' : `/painel?tab=${tab}`);
    loaders[tab]();
  }
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  initPushSwitch();

  // ===== agenda =====
  const dateEl = $('[data-date]');
  const barberEl = $('[data-barber]');
  const fillBarberSelects = () => {
    const opts = me.barbers.filter((b) => b.active).map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    if (barberEl) barberEl.innerHTML = `<option value="">Todos os barbeiros</option>${opts}`;
    if ($('#b-barber')) $('#b-barber').innerHTML = `<option value="">Barbearia inteira</option>${opts}`;
  };
  fillBarberSelects();
  dateEl.value = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today;

  const shift = (n) => { const d = parseDate(dateEl.value); d.setDate(d.getDate() + n); dateEl.value = isoDate(d); loadAgenda(); };
  $$('[data-shift]').forEach((b) => b.addEventListener('click', () => shift(+b.dataset.shift)));
  $('[data-today]').addEventListener('click', () => { dateEl.value = today; loadAgenda(); });
  dateEl.addEventListener('change', loadAgenda);
  barberEl?.addEventListener('change', loadAgenda);

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
    if (!owner && !user.barberId) {
      $('[data-timeline]').innerHTML = '<div class="empty">Sua conta ainda não está ligada a um perfil de barbeiro. Peça para o dono te enviar um convite.</div>';
      return;
    }
    const date = dateEl.value;
    const filter = barberEl?.value || '';
    const q = `date=${date}${filter ? `&barber=${filter}` : ''}`;
    $('[data-day-label]').textContent = fmtDay(date);
    const [{ appointments }, sum, { blocks }] = await Promise.all([api(`/admin/appointments?${q}`), api(`/admin/summary?${q}`), api('/admin/blocks')]);
    $('[data-k=total]').textContent = sum.total;
    $('[data-k=revenue]').textContent = money(sum.revenue);
    $('[data-k=done]').textContent = sum.done;
    $('[data-k=cancelled]').textContent = sum.cancelled;
    $('[data-day-blocks]').innerHTML = blocks
      .filter((b) => b.date === date && (!filter || !b.barberId || b.barberId === filter))
      .map((b) => `<div class="day-block">⛔ <b>${esc(b.barberName)}</b> bloqueado ${b.allDay ? 'o dia todo' : `das ${b.start} às ${b.end}`}${b.reason ? ` · ${esc(b.reason)}` : ''}</div>`)
      .join('');
    $('[data-timeline]').innerHTML = appointments.length ? appointments.map(apptRow).join('') : '<div class="empty">Nenhum agendamento para este dia.</div>';
  }

  function apptRow(a) {
    const phone = a.client?.phone || '';
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
        <span>${esc(a.service.name)}${owner ? ` · ${esc(a.barber.name)}` : ''} · ${money(a.price)}${phone ? ` · ${esc(maskPhone(phone))}` : ''}</span>
        ${a.notes ? `<em>“${esc(a.notes)}”</em>` : ''}
        ${phone ? `<a class="link" style="margin-top:2px;font-size:13px" target="_blank" rel="noopener" href="${wa(phone, `Olá ${a.client.name.split(' ')[0]}! Aqui é da Oliver's Barbearia sobre seu horário de ${a.start}.`)}">Chamar no WhatsApp</a>` : ''}
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
  if (!owner) $('.block-form__title', bform).textContent = 'Bloquear minha agenda';

  bform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = bform.querySelector('.form-error');
    err.textContent = '';
    const body = {
      barberId: bform.barberId?.value || null,
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
          <div class="tl__actions">${b.canDelete ? `<button class="icon-btn icon-btn--bad" data-unblock="${b.id}">Remover</button>` : '<small class="muted">Definido pelo dono</small>'}</div>
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
      if (phone) window.open(wa(phone, msg), '_blank', 'noopener');
      else { await navigator.clipboard?.writeText(url).catch(() => {}); alert(`Link copiado:\n${url}`); }
      toast('Link gerado.');
    } catch (err) { toast(err.message, 'error'); }
    b.disabled = false;
  });

  async function loadClients() {
    const { clients } = await api(`/admin/clients?q=${encodeURIComponent(qEl.value.trim())}`);
    const tag = (c) => (c.staffRole === 'owner' ? ' · dono' : c.staffRole === 'barber' ? ' · barbeiro' : '');
    $('[data-clients]').innerHTML = clients.length
      ? clients.map((c) => `<article class="tl" style="border-left-color:${c.staffRole ? 'var(--gold)' : 'var(--line-2)'}">
          <div class="tl__time"><strong>${c.visits}</strong><small>${c.visits === 1 ? 'visita' : 'visitas'}</small></div>
          <div class="tl__info"><strong>${esc(c.name)}${tag(c)}</strong>
            <span>${esc(c.email)}${c.phone ? ` · ${esc(maskPhone(c.phone))}` : ''}</span>
            <span class="client__meta">${c.last_visit ? `Último horário: ${c.last_visit.split('-').reverse().join('/')}` : 'Ainda sem agendamentos'}</span></div>
          <div class="tl__actions">
            ${c.phone ? `<a class="icon-btn" target="_blank" rel="noopener" href="${wa(c.phone, `Olá ${c.name.split(' ')[0]}!`)}">WhatsApp</a>` : ''}
            ${!c.staffRole || owner ? `<button class="icon-btn" data-reset="${c.id}">Link de nova senha</button>` : ''}
          </div>
        </article>`).join('')
      : '<div class="empty">Nenhum cliente encontrado.</div>';
  }

  // ===== meu perfil =====
  async function loadProfile() {
    me = await api('/admin/me');
    const box = $('[data-profile]');
    const b = me.barber;
    if (!b) {
      box.innerHTML = `<div class="empty">${owner
        ? 'Sua conta de dono não está ligada a um perfil de barbeiro.<br>Se você também atende, vá em <b>Equipe</b> e toque em <b>"Sou eu"</b> no seu perfil, ou crie um novo.'
        : 'Sua conta ainda não está ligada a um perfil de barbeiro. Peça um convite para o dono.'}</div>`;
      return;
    }
    renderBarberEditor(box, b, { self: true });
  }

  // Editor de perfil (usado em "Meu perfil" e pelo dono na Equipe).
  function renderBarberEditor(box, b, { self = false, onDone } = {}) {
    box.innerHTML = `<div class="profile">
      <div>
        <div class="profile__photo" data-photo>${b.photo ? `<img src="${esc(b.photo)}" alt="">` : initials(b.name)}</div>
        <div class="profile__photo-actions">
          <button class="btn btn--sm" type="button" data-photo-pick>${b.photo ? 'Trocar foto' : 'Adicionar foto'}</button>
          ${b.photo ? '<button class="btn btn--ghost btn--sm" type="button" data-photo-del>Remover foto</button>' : ''}
        </div>
      </div>
      <form class="card" novalidate>
        <div class="grid-2">
          <div class="field"><label>Nome que aparece no site</label><input class="input" name="name" value="${esc(b.name)}" maxlength="60" required></div>
          <div class="field"><label>Especialidade (opcional)</label><input class="input" name="specialty" value="${esc(b.specialty)}" maxlength="60" placeholder="Ex.: Degradê, barba, afro"></div>
        </div>
        <label class="check"><input type="checkbox" data-own-hours ${b.hours ? 'checked' : ''}> <span>${self ? 'Tenho horário próprio' : 'Horário próprio'} (senão, segue o horário da barbearia)</span></label>
        <div data-hours ${b.hours ? '' : 'hidden'}></div>
        <p class="form-error" aria-live="polite"></p>
        <button class="btn" type="submit">Salvar ${self ? 'meu perfil' : 'perfil'}</button>
        <p class="muted" style="font-size:13px;margin:0">As mudanças aparecem no site e no app de todos os clientes na hora.</p>
      </form>
    </div>`;
    const form = $('form', box);
    const hoursBox = $('[data-hours]', box);
    const readHours = hoursEditor(hoursBox, b.hours || me.shopHours);
    $('[data-own-hours]', box).addEventListener('change', (e) => (hoursBox.hidden = !e.target.checked));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      try {
        const body = { name: form.name.value, specialty: form.specialty.value, hours: $('[data-own-hours]', box).checked ? readHours() : null };
        await api(`/admin/barbers/${b.id}`, { method: 'PATCH', body });
        toast('Perfil salvo!');
        onDone ? onDone() : loadProfile();
      } catch (ex) { err.textContent = ex.message; }
    });

    $('[data-photo-pick]', box).addEventListener('click', async (e) => {
      try {
        const image = await pickPhoto();
        if (!image) return;
        e.target.disabled = true;
        e.target.textContent = 'Enviando…';
        await api(`/admin/barbers/${b.id}/photo`, { method: 'POST', body: { image } });
        toast('Foto atualizada!');
        onDone ? onDone() : loadProfile();
      } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
    });
    $('[data-photo-del]', box)?.addEventListener('click', async () => {
      if (!confirm('Remover a foto?')) return;
      try { await api(`/admin/barbers/${b.id}/photo`, { method: 'DELETE' }); toast('Foto removida.'); onDone ? onDone() : loadProfile(); }
      catch (ex) { toast(ex.message, 'error'); }
    });
  }

  // ===== equipe (dono) =====
  async function sendInvite(barber, invite, phone) {
    const msg = `Olá ${barber.name.split(' ')[0]}! Você foi adicionado à equipe da Oliver's Barbearia ✂️ Crie sua conta para ver sua agenda: ${invite.url} (válido por ${invite.days} dias)`;
    if (phone && phone.replace(/\D/g, '').length >= 10) window.open(wa(phone, msg), '_blank', 'noopener');
    else {
      await navigator.clipboard?.writeText(invite.url).catch(() => {});
      prompt('Convite criado! Copie o link e envie para o barbeiro:', invite.url);
    }
  }

  const addForm = $('[data-add-barber]');
  if (addForm) {
    addForm.phone.addEventListener('input', () => (addForm.phone.value = maskPhone(addForm.phone.value)));
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', addForm);
      err.textContent = '';
      try {
        const { barber, invite } = await api('/admin/team', { method: 'POST', body: { name: addForm.name.value } });
        await sendInvite(barber, invite, addForm.phone.value);
        toast(`${barber.name} adicionado!`);
        addForm.reset();
        me = await api('/admin/me');
        fillBarberSelects();
        loadTeam();
      } catch (ex) { err.textContent = ex.message; }
    });

    const promote = $('[data-promote]');
    promote.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', promote);
      err.textContent = '';
      const role = promote.staffRole.value;
      if (role === 'owner' && !confirm('Dar acesso TOTAL de dono? Essa pessoa poderá mudar preços, equipe e tudo mais.')) return;
      try {
        const r = await api('/admin/team/promote', { method: 'POST', body: { email: promote.email.value, staffRole: role } });
        toast(`${r.name} agora é ${r.staffRole === 'owner' ? 'dono' : 'barbeiro'}.`);
        promote.reset();
        me = await api('/admin/me');
        fillBarberSelects();
        loadTeam();
      } catch (ex) { err.textContent = ex.message; }
    });

    $('[data-panel=equipe]').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, id } = b.dataset;
      try {
        if (act === 'invite') {
          const { invite, barber } = await api(`/admin/team/${id}/invite`, { method: 'POST' });
          await sendInvite(barber, invite, prompt('WhatsApp do barbeiro (deixe vazio para só copiar o link):') || '');
        }
        if (act === 'edit') {
          const box = document.createElement('div');
          b.closest('.member').after(box);
          const barber = (await api('/admin/team')).barbers.find((x) => x.id === id);
          renderBarberEditor(box, barber, { onDone: () => { loadTeam(); me = null; api('/admin/me').then((m) => { me = m; fillBarberSelects(); }); } });
          box.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (act === 'off') {
          if (!confirm('Desligar este barbeiro? Ele some do site e perde o acesso ao painel. Agendamentos já marcados continuam na agenda.')) return;
          const { upcoming } = await api(`/admin/team/${id}/active`, { method: 'POST', body: { active: false } });
          if (upcoming) alert(`Atenção: ele ainda tem ${upcoming} agendamento(s) marcados. Veja na Agenda para remarcar ou cancelar.`);
        }
        if (act === 'on') await api(`/admin/team/${id}/active`, { method: 'POST', body: { active: true } });
        if (act === 'me') await api(`/admin/team/${id}/link-me`, { method: 'POST' });
        if (act === 'unlink' && confirm('Remover o acesso desta conta ao painel? O perfil continua no site.')) await api(`/admin/team/${id}/unlink`, { method: 'POST' });
        if (act === 'make-owner' && confirm('Tornar esta pessoa DONA (acesso total)?')) await api(`/admin/users/${b.dataset.user}/role`, { method: 'POST', body: { staffRole: 'owner' } });
        if (act === 'make-barber' && confirm('Tirar o acesso de dono? A pessoa continua como barbeiro.')) await api(`/admin/users/${b.dataset.user}/role`, { method: 'POST', body: { staffRole: 'barber' } });
        toast('Pronto.');
        me = await api('/admin/me');
        fillBarberSelects();
        if (act === 'me') user.barberId = id;
        loadTeam();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  }

  async function loadTeam() {
    if (!owner) return;
    const { barbers, owners } = await api('/admin/team');
    $('[data-team]').innerHTML = barbers.map((b) => {
      const acc = b.account;
      const status = !b.active ? 'Desligado' : acc ? `Conta: ${esc(acc.email)}${acc.staffRole === 'owner' ? ' · dono' : ''}` : b.pendingInvite ? 'Convite enviado, aguardando' : 'Sem conta de acesso';
      return `<article class="member ${b.active ? '' : 'member--off'}">
        <div class="member__head">${avatar(b)}<div><strong>${esc(b.name)}</strong><small>${status}</small>${b.upcoming ? `<small> · ${b.upcoming} horário(s) marcados</small>` : ''}</div></div>
        <div class="member__actions">
          <button class="icon-btn" data-act="edit" data-id="${b.id}">Editar</button>
          ${b.active && !acc ? `<button class="icon-btn" data-act="invite" data-id="${b.id}">${b.pendingInvite ? 'Reenviar convite' : 'Enviar convite'}</button>` : ''}
          ${b.active && !acc ? `<button class="icon-btn" data-act="me" data-id="${b.id}">Sou eu</button>` : ''}
          ${acc && acc.id !== user.id ? `<button class="icon-btn" data-act="unlink" data-id="${b.id}">Tirar acesso</button>` : ''}
          ${acc && acc.staffRole === 'barber' ? `<button class="icon-btn" data-act="make-owner" data-id="${b.id}" data-user="${acc.id}">Tornar dono</button>` : ''}
          ${b.active ? `<button class="icon-btn icon-btn--bad" data-act="off" data-id="${b.id}">Desligar</button>` : `<button class="icon-btn icon-btn--ok" data-act="on" data-id="${b.id}">Reativar</button>`}
        </div>
      </article>`;
    }).join('');
    $('[data-owners]').innerHTML = owners.map((o) => `<article class="tl" style="border-left-color:var(--gold)">
      <div class="tl__time"><strong>👑</strong></div>
      <div class="tl__info"><strong>${esc(o.name)}${o.id === user.id ? ' (você)' : ''}</strong><span>${esc(o.email)}</span></div>
      <div class="tl__actions">${o.id !== user.id && owners.length > 1 ? `<button class="icon-btn" data-act="make-barber" data-user="${o.id}">Tirar cargo de dono</button>` : ''}</div>
    </article>`).join('');
  }

  // ===== barbearia (dono): horário e serviços =====
  let readShopHours;
  $('[data-save-hours]')?.addEventListener('click', async () => {
    try {
      await api('/admin/hours', { method: 'PUT', body: { hours: readShopHours() } });
      toast('Horário da barbearia salvo!');
      me = await api('/admin/me');
    } catch (ex) { toast(ex.message, 'error'); }
  });

  const svcBox = $('[data-services]');
  svcBox?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {
      name: f.name.value, cat: f.cat.value, desc: f.desc.value,
      price: Math.round(parseFloat(f.price.value.replace(',', '.')) * 100),
      duration: Number(f.duration.value), popular: f.popular.checked, active: f.active.checked,
    };
    try {
      if (f.dataset.id) await api(`/admin/services/${f.dataset.id}`, { method: 'PATCH', body });
      else await api('/admin/services', { method: 'POST', body });
      toast('Serviço salvo!');
      loadShop();
    } catch (ex) { toast(ex.message, 'error'); }
  });
  $('[data-new-service]')?.addEventListener('click', () => {
    svcBox.insertAdjacentHTML('afterbegin', svcRow({ name: '', cat: 'cabelo', desc: '', price: 0, duration: 30, active: true }, me.categories));
    svcBox.querySelector('form input').focus();
  });

  function svcRow(s, cats) {
    return `<form class="svc ${s.active ? '' : 'svc--off'}" ${s.id ? `data-id="${s.id}"` : ''} novalidate>
      <div class="field"><label>Serviço</label><input class="input" name="name" value="${esc(s.name)}" maxlength="60" required placeholder="Nome do serviço">
        <input class="input" name="desc" value="${esc(s.desc)}" maxlength="160" placeholder="Descrição (opcional)" style="margin-top:6px"></div>
      <div class="field"><label>Categoria</label><select class="input" name="cat">${cats.map((c) => `<option value="${c.id}" ${c.id === s.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Preço (R$)</label><input class="input" name="price" inputmode="decimal" value="${(s.price / 100).toFixed(2).replace('.', ',')}"></div>
      <div class="field"><label>Minutos</label><input class="input" name="duration" type="number" min="5" max="480" step="5" value="${s.duration}"></div>
      <div class="svc__flags">
        <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> <span>Ativo</span></label>
        <label class="check"><input type="checkbox" name="popular" ${s.popular ? 'checked' : ''}> <span>Destaque</span></label>
        <button class="btn btn--sm" type="submit">Salvar</button>
      </div>
    </form>`;
  }

  async function loadShop() {
    if (!owner) return;
    me = await api('/admin/me');
    readShopHours = hoursEditor($('[data-shop-hours]'), me.shopHours);
    const { services, categories } = await api('/admin/services');
    svcBox.innerHTML = services.map((s) => svcRow(s, categories)).join('');
  }

  const startTab = params.get('tab');
  showTab(Object.keys(loaders).includes(startTab) && $(`[data-tab="${startTab}"]`) ? startTab : 'agenda');
}

// ---------- interruptor de notificações ----------
async function initPushSwitch() {
  const sw = $('[data-push]');
  const hint = $('[data-push-hint]');
  if (user.staffRole === 'barber') hint.textContent = 'Receba uma notificação quando um cliente marcar ou cancelar um horário com você.';
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
