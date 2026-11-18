// Painel da equipe no app (mobile). Dono: tudo. Barbeiro: só a própria agenda, bloqueios e perfil.
import { api, session, toast, money, duration, esc, fmtDay, parseDate, isoDate, waLink, maskPhone, firstName } from '/js/core.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const STATUS = { booked: 'Agendado', done: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou' };
const wa = (phone, text) => waLink(`55${String(phone).replace(/\D/g, '').replace(/^55/, '')}`, text);
const shortDay = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

let ctx; // utilidades do app (sheet, ícones, navegação...)
let me = null; // /admin/me
const st = { date: null, barber: '', q: '' };

const SECTIONS = [
  { id: 'agenda', name: 'Agenda' },
  { id: 'bloqueios', name: 'Bloqueios' },
  { id: 'clientes', name: 'Clientes' },
  { id: 'perfil', name: 'Meu perfil' },
  { id: 'equipe', name: 'Equipe', owner: true },
  { id: 'barbearia', name: 'Barbearia', owner: true },
];

const isOwner = () => session.user?.staffRole === 'owner';

export async function renderPanel(el, sub, q, context) {
  ctx = context;
  const sections = SECTIONS.filter((s) => !s.owner || isOwner());
  const sec = sections.some((s) => s.id === sub) ? sub : 'agenda';
  if (q.get('date')) st.date = q.get('date');

  el.innerHTML = `
    <header class="appbar"><span class="appbar__title">Painel <small class="muted" style="font-weight:500">· ${isOwner() ? 'Dono' : 'Barbeiro'}</small></span></header>
    <div class="cats panel-tabs">${sections.map((s) => `<a href="#/painel/${s.id}" class="${s.id === sec ? 'is-on' : ''}" aria-current="${s.id === sec}">${s.name}</a>`).join('')}</div>
    <div data-pbody><div class="empty">Carregando…</div></div>`;
  $('.panel-tabs a.is-on', el)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  window.scrollTo(0, 0);

  try {
    me = await api('/admin/me');
  } catch (e) {
    $('[data-pbody]', el).innerHTML = `<div class="empty"><strong>Sem acesso</strong>${esc(e.message)}</div>`;
    return;
  }
  const body = $('[data-pbody]', el);
  ({ agenda, bloqueios, clientes, perfil, equipe, barbearia })[sec](body);
}

// ---------- utilidades de UI ----------
function fab(label, onClick) {
  $('.fab')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<button class="fab">${label}</button>`);
  $('.fab').onclick = onClick;
}

function hoursEditor(box, hours) {
  const draw = (data) => {
    box.innerHTML = WEEK.map((d) => {
      const list = data[d] || [];
      return `<div class="hday" data-day="${d}">
        <div class="hday__head"><strong>${DAYS[d]}</strong>
          <button type="button" class="switch" role="switch" aria-checked="${list.length > 0}" data-open aria-label="${DAYS[d]} aberto"></button></div>
        <div class="hday__ranges" ${list.length ? '' : 'hidden'}>
          ${list.map(([a, b], i) => `<div class="hrange"><input class="input" type="time" step="900" value="${a}" data-a><span>até</span><input class="input" type="time" step="900" value="${b}" data-b>
            ${list.length > 1 ? `<button type="button" class="hrange__x" data-rm="${i}" aria-label="Remover intervalo">✕</button>` : ''}</div>`).join('')}
          ${list.length < 3 ? '<button type="button" class="link hday__add" data-add>+ Intervalo (ex.: almoço)</button>' : ''}
        </div></div>`;
    }).join('');
  };
  const read = () => {
    const out = {};
    for (const row of $$('.hday', box)) {
      const d = row.dataset.day;
      if (row.querySelector('[data-open]').getAttribute('aria-checked') !== 'true') { out[d] = []; continue; }
      out[d] = $$('.hrange', row).map((r) => [r.querySelector('[data-a]').value, r.querySelector('[data-b]').value]).filter(([a, b]) => a && b);
    }
    return out;
  };
  draw(hours || {});
  box.onclick = (e) => {
    const row = e.target.closest('.hday');
    if (!row) return;
    const data = read();
    const d = row.dataset.day;
    if (e.target.closest('[data-open]')) data[d] = data[d]?.length ? [] : [['09:00', '18:00']];
    else if (e.target.closest('[data-add]')) { const last = data[d].at(-1)?.[1] || '13:00'; data[d].push([last, '20:00']); }
    else if (e.target.closest('[data-rm]')) data[d].splice(+e.target.closest('[data-rm]').dataset.rm, 1);
    else return;
    ctx.tap();
    draw(data);
  };
  return read;
}

async function pickPhoto() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  const file = await new Promise((resolve) => { input.onchange = () => resolve(input.files[0]); input.click(); });
  if (!file) return null;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) throw new Error('Não consegui abrir essa imagem. Tente outra.');
  const size = 640;
  const side = Math.min(img.width, img.height);
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  canvas.getContext('2d').drawImage(img, (img.width - side) / 2, Math.max(0, (img.height - side) * 0.35), side, side, 0, 0, size, size);
  let data = canvas.toDataURL('image/webp', 0.82);
  if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', 0.82);
  return data;
}

// =====================================================================
// AGENDA
// =====================================================================
async function agenda(body) {
  const today = ctx.cat.today;
  st.date ||= today;
  const start = parseDate(today);
  start.setDate(start.getDate() - 7);
  const days = Array.from({ length: 45 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return d; });
  const barbers = me.barbers.filter((b) => b.active);

  body.innerHTML = `
    <div class="days" data-days>${days.map((d) => {
      const iso = isoDate(d);
      const wd = iso === today ? 'Hoje' : d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
      return `<button class="day ${iso === st.date ? 'is-on' : ''}" data-day="${iso}"><small>${wd}</small><strong>${d.getDate()}</strong><small>${d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small></button>`;
    }).join('')}</div>
    ${isOwner() && barbers.length > 1 ? `<div class="cats cats--flat" data-bf>${[{ id: '', name: 'Todos' }, ...barbers].map((b) => `<button data-b="${b.id}" aria-pressed="${st.barber === b.id}">${esc(b.name.split(' ')[0])}</button>`).join('')}</div>` : ''}
    <p class="day-label" data-label></p>
    <div class="kpis-m" data-kpis></div>
    <div data-blocks></div>
    <div data-list><div class="empty">Carregando…</div></div>`;
  $('.day.is-on', body)?.scrollIntoView({ inline: 'center', block: 'nearest' });

  const load = async () => {
    $('[data-label]', body).textContent = fmtDay(st.date);
    if (!isOwner() && !session.user.barberId) {
      $('[data-list]', body).innerHTML = '<div class="empty"><strong>Perfil não ligado</strong>Peça um convite para o dono da barbearia.</div>';
      return;
    }
    const qs = `date=${st.date}${isOwner() && st.barber ? `&barber=${st.barber}` : ''}`;
    const [{ appointments }, sum, { blocks }] = await Promise.all([api(`/admin/appointments?${qs}`), api(`/admin/summary?${qs}`), api('/admin/blocks')]);
    $('[data-kpis]', body).innerHTML = `
      <div><small>Horários</small><strong>${sum.total}</strong></div>
      <div class="gold"><small>Previsto</small><strong>${money(sum.revenue)}</strong></div>
      <div><small>Feitos</small><strong>${sum.done}</strong></div>
      <div><small>Cancel.</small><strong>${sum.cancelled}</strong></div>`;
    const dayBlocks = blocks.filter((b) => b.date === st.date && (!st.barber || !b.barberId || b.barberId === st.barber));
    $('[data-blocks]', body).innerHTML = dayBlocks.map((b) => `<div class="pblock">⛔ <b>${esc(b.barberName)}</b> · ${b.allDay ? 'dia todo' : `${b.start}–${b.end}`}${b.reason ? ` · ${esc(b.reason)}` : ''}</div>`).join('');
    const list = $('[data-list]', body);
    list.innerHTML = appointments.length ? appointments.map((a) => `
      <button class="ap ap--${a.status}" data-ap="${a.id}">
        <span class="ap__time"><strong>${a.start}</strong><small>${a.end}</small></span>
        <span class="ap__body">
          <strong>${esc(a.client?.name || 'Cliente')}</strong>
          <small>${esc(a.service.name)}</small>
          <small>${isOwner() ? `${esc(a.barber.name)} · ` : ''}${money(a.price)}</small>
          ${a.notes ? `<em>“${esc(a.notes)}”</em>` : ''}
        </span>
        <span class="badge badge--${a.status}">${STATUS[a.status]}</span>
      </button>`).join('') : '<div class="empty"><strong>Dia livre</strong>Nenhum agendamento.</div>';
    list.onclick = (e) => {
      const b = e.target.closest('[data-ap]');
      if (b) apptSheet(appointments.find((a) => String(a.id) === b.dataset.ap), load);
    };
  };

  body.onclick = (e) => {
    const d = e.target.closest('[data-day]');
    if (d) { ctx.tap(); st.date = d.dataset.day; $$('.day', body).forEach((x) => x.classList.toggle('is-on', x === d)); d.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); load(); return; }
    const b = e.target.closest('[data-b]');
    if (b) { ctx.tap(); st.barber = b.dataset.b; $$('[data-b]', body).forEach((x) => x.setAttribute('aria-pressed', x === b)); load(); }
  };
  load();
}

function apptSheet(a, reload) {
  const phone = a.client?.phone;
  const set = async (status, msg) => {
    try {
      await api(`/admin/appointments/${a.id}`, { method: 'PATCH', body: { status } });
      toast(msg);
      reload();
    } catch (err) { toast(err.message, 'error'); }
  };
  ctx.sheet(`
    <h3>${esc(a.client?.name || 'Cliente')}</h3>
    <p>${esc(fmtDay(a.date, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${a.start}–${a.end}<br>${esc(a.service.name)} · ${esc(a.barber.name)} · ${money(a.price)}${a.notes ? `<br><em>“${esc(a.notes)}”</em>` : ''}</p>
    <div class="stack">
      ${a.status === 'booked' ? `
        <button class="btn btn--block" data-close="done">✓ Concluir atendimento</button>
        <button class="btn btn--block btn--ghost" data-close="no_show">Cliente faltou</button>` : `
        <button class="btn btn--block btn--ghost" data-close="booked">Reabrir horário</button>`}
      ${phone ? `<a class="btn btn--block btn--ghost" target="_blank" rel="noopener" href="${wa(phone, `Olá ${firstName(a.client.name)}! Aqui é da Oliver's Barbearia sobre seu horário de ${a.start}.`)}">WhatsApp · ${esc(maskPhone(phone))}</a>
        <a class="btn btn--block btn--ghost" href="tel:+55${String(phone).replace(/\D/g, '').replace(/^55/, '')}">Ligar</a>` : ''}
      ${a.status === 'booked' ? '<button class="btn btn--block btn--danger" data-close="cancel">Cancelar horário</button>' : ''}
      <button class="btn btn--block btn--line" data-close="">Fechar</button>
    </div>`).then(async (v) => {
    if (v === 'done') set('done', 'Atendimento concluído.');
    if (v === 'no_show') set('no_show', 'Marcado como falta.');
    if (v === 'booked') set('booked', 'Horário reaberto.');
    if (v === 'cancel' && (await ctx.confirmSheet('Cancelar este horário?', 'O cliente recebe um aviso, se tiver notificações ativas, e o horário fica livre.', 'Sim, cancelar', true)))
      set('cancelled', 'Horário cancelado.');
  });
}

// =====================================================================
// BLOQUEIOS
// =====================================================================
async function bloqueios(body) {
  body.innerHTML = `<p class="lead" style="margin-top:4px">Folga, feriado, médico… Horários bloqueados somem da agenda online.</p><div data-list><div class="empty">Carregando…</div></div>`;
  const load = async () => {
    const { blocks } = await api('/admin/blocks');
    const list = $('[data-list]', body);
    list.innerHTML = blocks.length ? `<div class="list">${blocks.map((b) => `
      <div class="row">
        <span class="row__icon" style="font-size:13px;font-weight:700">${shortDay(b.date)}</span>
        <span class="row__body"><strong>${esc(b.barberName)}</strong><small>${esc(fmtDay(b.date, { weekday: 'short' }))} · ${b.allDay ? 'Dia inteiro' : `${b.start}–${b.end}`}${b.reason ? ` · ${esc(b.reason)}` : ''}</small></span>
        ${b.canDelete ? `<button class="btn btn--sm btn--danger" data-del="${b.id}">Remover</button>` : '<small class="muted">pelo dono</small>'}
      </div>`).join('')}</div>` : '<div class="empty"><strong>Nenhum bloqueio</strong>Toque em “Bloquear” para adicionar.</div>';
    list.onclick = async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d || !(await ctx.confirmSheet('Remover bloqueio?', 'Os horários voltam a ficar disponíveis para agendamento.', 'Remover', true))) return;
      try { await api(`/admin/blocks/${d.dataset.del}`, { method: 'DELETE' }); toast('Bloqueio removido.'); load(); }
      catch (err) { toast(err.message, 'error'); }
    };
  };
  fab('+ Bloquear', () => blockSheet(load));
  load();
}

function blockSheet(reload) {
  const today = ctx.cat.today;
  const barbers = me.barbers.filter((b) => b.active);
  ctx.sheet(`
    <h3>${isOwner() ? 'Bloquear horário' : 'Bloquear minha agenda'}</h3>
    <form class="stack" novalidate>
      ${isOwner() ? `<div class="field"><label>Quem</label><div class="cats cats--flat cats--wrap" data-who>${[{ id: '', name: 'Barbearia inteira' }, ...barbers].map((b, i) => `<button type="button" data-w="${b.id}" aria-pressed="${i === 0}">${esc(b.name)}</button>`).join('')}</div></div>` : ''}
      <div class="grid2">
        <div class="field"><label>De</label><input class="input" type="date" name="date" value="${today}" min="${today}"></div>
        <div class="field"><label>Até (opcional)</label><input class="input" type="date" name="endDate" min="${today}"></div>
      </div>
      <div class="row" style="padding:6px 0"><span class="row__body"><strong>Dia inteiro</strong></span><button type="button" class="switch" role="switch" aria-checked="true" data-allday></button></div>
      <div class="grid2" data-times hidden>
        <div class="field"><label>Das</label><input class="input" type="time" name="start" value="09:00" step="900"></div>
        <div class="field"><label>Até</label><input class="input" type="time" name="end" value="12:00" step="900"></div>
      </div>
      <div class="field"><label>Motivo (opcional)</label><input class="input" name="reason" maxlength="120" placeholder="Ex.: Feriado, folga, médico"></div>
      <p class="error"></p>
      <button class="btn btn--block" type="submit">Bloquear</button>
      <button class="btn btn--block btn--ghost" type="button" data-close>Cancelar</button>
    </form>`, (sh, close) => {
    const f = $('form', sh);
    let who = '';
    const ad = $('[data-allday]', sh);
    sh.addEventListener('click', (e) => {
      const w = e.target.closest('[data-w]');
      if (w) { who = w.dataset.w; $$('[data-w]', sh).forEach((x) => x.setAttribute('aria-pressed', x === w)); }
      if (e.target.closest('[data-allday]')) { const on = ad.getAttribute('aria-checked') !== 'true'; ad.setAttribute('aria-checked', on); $('[data-times]', sh).hidden = on; }
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('.error', f);
      err.textContent = '';
      try {
        const { created, conflicts } = await api('/admin/blocks', {
          method: 'POST',
          body: { barberId: who || null, date: f.date.value, endDate: f.endDate.value || null, allDay: ad.getAttribute('aria-checked') === 'true', start: f.start.value, end: f.end.value, reason: f.reason.value.trim() },
        });
        close();
        toast(created > 1 ? `${created} dias bloqueados.` : 'Horário bloqueado.');
        reload();
        if (conflicts.length) {
          ctx.sheet(`<h3>Atenção: clientes marcados</h3><p>${conflicts.length} cliente(s) já tinham horário nesse período e <b>não foram cancelados</b>:</p>
            <div class="list" style="margin:0 0 16px">${conflicts.map((c) => `<div class="row"><span class="row__body"><strong>${esc(c.client?.name)}</strong><small>${shortDay(c.date)} ${c.start} · ${esc(c.service.name)}</small></span></div>`).join('')}</div>
            <div class="stack"><a class="btn btn--block" href="#/painel/agenda?date=${conflicts[0].date}" data-close>Ver na agenda</a><button class="btn btn--block btn--ghost" data-close>Ok</button></div>`);
        }
      } catch (ex) { err.textContent = ex.message; }
    };
  });
}

// =====================================================================
// CLIENTES
// =====================================================================
async function clientes(body) {
  body.innerHTML = `<div class="form" style="margin-bottom:12px"><input class="input" type="search" placeholder="Buscar nome, e-mail ou WhatsApp" value="${esc(st.q)}" data-q></div><div data-list></div>`;
  let timer;
  const load = async () => {
    const { clients } = await api(`/admin/clients?q=${encodeURIComponent(st.q)}`);
    const list = $('[data-list]', body);
    const tag = (c) => (c.staffRole === 'owner' ? ' · dono' : c.staffRole === 'barber' ? ' · barbeiro' : '');
    list.innerHTML = clients.length ? `<div class="list">${clients.map((c) => `
      <button class="row" data-c="${c.id}">
        <span class="photo photo--sm">${ctx.ini(c.name)}</span>
        <span class="row__body"><strong>${esc(c.name)}${tag(c)}</strong><small>${c.phone ? esc(maskPhone(c.phone)) : esc(c.email)}</small></span>
        <span class="row__end">${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'}</span>
      </button>`).join('')}</div>` : '<div class="empty">Nenhum cliente encontrado.</div>';
    list.onclick = (e) => {
      const r = e.target.closest('[data-c]');
      if (r) clientSheet(clients.find((c) => String(c.id) === r.dataset.c));
    };
  };
  $('[data-q]', body).addEventListener('input', (e) => { st.q = e.target.value.trim(); clearTimeout(timer); timer = setTimeout(load, 250); });
  load();
}

function clientSheet(c) {
  const canReset = !c.staffRole || isOwner();
  ctx.sheet(`
    <h3>${esc(c.name)}</h3>
    <p>${esc(c.email)}${c.phone ? `<br>${esc(maskPhone(c.phone))}` : ''}<br>${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'}${c.last_visit ? ` · último horário ${shortDay(c.last_visit)}` : ''}</p>
    <div class="stack">
      ${c.phone ? `<a class="btn btn--block" target="_blank" rel="noopener" href="${wa(c.phone, `Olá ${firstName(c.name)}!`)}">WhatsApp</a>` : ''}
      ${canReset ? '<button class="btn btn--block btn--ghost" data-close="reset">Enviar link de nova senha</button>' : ''}
      <button class="btn btn--block btn--line" data-close>Fechar</button>
    </div>`).then(async (v) => {
    if (v !== 'reset') return;
    try {
      const { url, hours } = await api(`/admin/clients/${c.id}/reset-link`, { method: 'POST' });
      const msg = `Olá ${firstName(c.name)}! Aqui é da Oliver's Barbearia. Para criar uma nova senha, acesse: ${url} (válido por ${hours}h).`;
      if (c.phone) window.open(wa(c.phone, msg), '_blank', 'noopener');
      else { await navigator.clipboard?.writeText(url).catch(() => {}); toast('Link copiado.'); }
    } catch (err) { toast(err.message, 'error'); }
  });
}

// =====================================================================
// PERFIL (próprio, ou de um barbeiro pelo dono)
// =====================================================================
async function perfil(body) {
  if (!me.barber) {
    body.innerHTML = `<div class="empty"><strong>Sem perfil de barbeiro</strong>${isOwner()
      ? 'Se você também atende, vá em <b>Equipe</b> e toque em <b>“Sou eu”</b> no seu perfil.<br><a class="btn btn--sm" href="#/painel/equipe">Abrir Equipe</a>'
      : 'Peça um convite para o dono da barbearia.'}</div>`;
    return;
  }
  profileEditor(body, me.barber, { onSaved: async () => { me = await api('/admin/me'); perfil(body); } });
}

function profileEditor(box, b, { onSaved, inSheet = false } = {}) {
  box.innerHTML = `
    <div class="pphoto">
      <span class="photo photo--xl">${b.photo ? `<img src="${esc(b.photo)}" alt="">` : ctx.ini(b.name)}</span>
      <div class="pphoto__btns">
        <button type="button" class="btn btn--sm" data-pick>${b.photo ? 'Trocar foto' : 'Adicionar foto'}</button>
        ${b.photo ? '<button type="button" class="btn btn--sm btn--ghost" data-rmphoto>Remover</button>' : ''}
      </div>
    </div>
    <form class="form" novalidate>
      <div class="field"><label>Nome no app e no site</label><input class="input" name="name" value="${esc(b.name)}" maxlength="60"></div>
      <div class="field"><label>Especialidade (opcional)</label><input class="input" name="specialty" value="${esc(b.specialty)}" maxlength="60" placeholder="Ex.: Degradê, barba, afro"></div>
      <div class="row" style="padding:8px 0"><span class="row__body"><strong>Horário próprio</strong><small>Desligado = segue o horário da barbearia</small></span>
        <button type="button" class="switch" role="switch" aria-checked="${!!b.hours}" data-own></button></div>
      <div data-hours ${b.hours ? '' : 'hidden'}></div>
      <p class="error"></p>
      <button class="btn btn--block" type="submit">Salvar</button>
      ${inSheet ? '<button class="btn btn--block btn--ghost" type="button" data-close>Fechar</button>' : ''}
      <p class="muted" style="font-size:13px;text-align:center;margin:0">As mudanças aparecem para todos os clientes na hora.</p>
    </form>`;
  const f = $('form', box);
  const own = $('[data-own]', box);
  const readHours = hoursEditor($('[data-hours]', box), b.hours || me.shopHours);
  own.onclick = () => { const on = own.getAttribute('aria-checked') !== 'true'; own.setAttribute('aria-checked', on); $('[data-hours]', box).hidden = !on; ctx.tap(); };

  const done = async (msg) => { toast(msg); await ctx.refreshCatalog(); onSaved?.(); };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = $('.error', f);
    err.textContent = '';
    try {
      await api(`/admin/barbers/${b.id}`, { method: 'PATCH', body: { name: f.name.value, specialty: f.specialty.value, hours: own.getAttribute('aria-checked') === 'true' ? readHours() : null } });
      done('Perfil salvo!');
    } catch (ex) { err.textContent = ex.message; }
  };
  $('[data-pick]', box).onclick = async (e) => {
    try {
      const image = await pickPhoto();
      if (!image) return;
      e.target.disabled = true;
      e.target.textContent = 'Enviando…';
      await api(`/admin/barbers/${b.id}/photo`, { method: 'POST', body: { image } });
      done('Foto atualizada!');
    } catch (ex) { toast(ex.message, 'error'); e.target.disabled = false; }
  };
  $('[data-rmphoto]', box)?.addEventListener('click', async () => {
    if (!(await ctx.confirmSheet('Remover foto?', 'Vai aparecer só as iniciais.', 'Remover', true))) return;
    try { await api(`/admin/barbers/${b.id}/photo`, { method: 'DELETE' }); done('Foto removida.'); }
    catch (ex) { toast(ex.message, 'error'); }
  });
}

// =====================================================================
// EQUIPE (dono)
// =====================================================================
async function equipe(body) {
  body.innerHTML = '<div data-team><div class="empty">Carregando…</div></div>';
  const load = async () => {
    const { barbers, owners } = await api('/admin/team');
    $('[data-team]', body).innerHTML = `
      <div class="section-title" style="margin-top:4px">Barbeiros</div>
      <div class="list">${barbers.map((b) => {
        const acc = b.account;
        const status = !b.active ? 'Desligado' : acc ? `${esc(acc.email)}${acc.staffRole === 'owner' ? ' · dono' : ''}` : b.pendingInvite ? 'Convite enviado' : 'Sem acesso ao app';
        return `<button class="row ${b.active ? '' : 'row--off'}" data-m="${b.id}">${ctx.photo(b, 'photo--sm')}
          <span class="row__body"><strong>${esc(b.name)}</strong><small>${status}${b.upcoming ? ` · ${b.upcoming} marcados` : ''}</small></span>
          <span class="row__end">${ctx.I.chev}</span></button>`;
      }).join('')}</div>
      <div class="section-title">Donos</div>
      <div class="list">${owners.map((o) => `<button class="row" data-o="${o.id}"><span class="photo photo--sm">👑</span>
        <span class="row__body"><strong>${esc(o.name)}${o.id === session.user.id ? ' (você)' : ''}</strong><small>${esc(o.email)}</small></span></button>`).join('')}</div>
      <div class="pad" style="margin-top:14px"><button class="btn btn--block btn--line" data-promote>Dar acesso a uma conta existente</button></div>`;

    const box = $('[data-team]', body);
    box.onclick = (e) => {
      const m = e.target.closest('[data-m]');
      if (m) return memberSheet(barbers.find((b) => b.id === m.dataset.m), load);
      const o = e.target.closest('[data-o]');
      if (o && Number(o.dataset.o) !== session.user.id && owners.length > 1) {
        const ow = owners.find((x) => String(x.id) === o.dataset.o);
        ctx.confirmSheet(`Tirar cargo de dono de ${esc(ow.name)}?`, 'A pessoa continua com acesso como barbeiro.', 'Tirar cargo', true).then(async (ok) => {
          if (!ok) return;
          try { await api(`/admin/users/${ow.id}/role`, { method: 'POST', body: { staffRole: 'barber' } }); toast('Pronto.'); load(); } catch (err) { toast(err.message, 'error'); }
        });
      }
      if (e.target.closest('[data-promote]')) promoteSheet(load);
    };
  };
  fab('+ Barbeiro', () => addBarberSheet(load));
  load();
}

async function sendInvite(barber, invite, phone) {
  const msg = `Olá ${firstName(barber.name)}! Você foi adicionado à equipe da Oliver's Barbearia ✂️ Crie sua conta para ver sua agenda: ${invite.url} (válido por ${invite.days} dias)`;
  if (String(phone || '').replace(/\D/g, '').length >= 10) window.open(wa(phone, msg), '_blank', 'noopener');
  else if (navigator.share) await navigator.share({ title: 'Convite Oliver\'s', text: msg }).catch(() => {});
  else { await navigator.clipboard?.writeText(invite.url).catch(() => {}); toast('Link do convite copiado.'); }
}

function addBarberSheet(reload) {
  ctx.sheet(`<h3>Adicionar barbeiro</h3><p>Ele recebe um convite no WhatsApp, cria a senha e já vê a própria agenda.</p>
    <form class="stack" novalidate>
      <div class="field"><label>Nome</label><input class="input" name="name" maxlength="60" placeholder="Ex.: Marcos Lima"></div>
      <div class="field"><label>WhatsApp (para o convite)</label><input class="input" name="phone" type="tel" inputmode="tel" placeholder="(11) 90000-0000"></div>
      <p class="error"></p>
      <button class="btn btn--block" type="submit">Criar e enviar convite</button>
      <button class="btn btn--block btn--ghost" type="button" data-close>Cancelar</button>
    </form>`, (sh, close) => {
    const f = $('form', sh);
    f.phone.oninput = () => (f.phone.value = maskPhone(f.phone.value));
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const { barber, invite } = await api('/admin/team', { method: 'POST', body: { name: f.name.value } });
        close();
        await sendInvite(barber, invite, f.phone.value);
        toast(`${barber.name} adicionado!`);
        await ctx.refreshCatalog();
        reload();
      } catch (ex) { $('.error', f).textContent = ex.message; }
    };
  });
}

function promoteSheet(reload) {
  ctx.sheet(`<h3>Dar acesso</h3><p>A pessoa já tem conta no app? Digite o e-mail dela.</p>
    <form class="stack" novalidate>
      <input class="input" name="email" type="email" inputmode="email" autocapitalize="off" placeholder="email@exemplo.com">
      <div class="cats cats--flat cats--wrap" data-role><button type="button" data-r="barber" aria-pressed="true">Barbeiro</button><button type="button" data-r="owner" aria-pressed="false">Dono (acesso total)</button></div>
      <p class="error"></p>
      <button class="btn btn--block" type="submit">Dar acesso</button>
      <button class="btn btn--block btn--ghost" type="button" data-close>Cancelar</button>
    </form>`, (sh, close) => {
    let role = 'barber';
    sh.addEventListener('click', (e) => { const r = e.target.closest('[data-r]'); if (r) { role = r.dataset.r; $$('[data-r]', sh).forEach((x) => x.setAttribute('aria-pressed', x === r)); } });
    $('form', sh).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/admin/team/promote', { method: 'POST', body: { email: e.target.email.value, staffRole: role } });
        close();
        toast(`${r.name} agora é ${r.staffRole === 'owner' ? 'dono' : 'barbeiro'}.`);
        await ctx.refreshCatalog();
        reload();
      } catch (ex) { $('.error', e.target).textContent = ex.message; }
    };
  });
}

function memberSheet(b, reload) {
  const acc = b.account;
  const opts = [
    ['edit', 'Editar perfil (nome, foto, horário)', ''],
    b.active && !acc ? ['invite', b.pendingInvite ? 'Reenviar convite' : 'Enviar convite', 'btn--ghost'] : null,
    b.active && !acc ? ['me', 'Sou eu (ligar à minha conta)', 'btn--ghost'] : null,
    acc && acc.staffRole === 'barber' ? ['owner', 'Tornar dono', 'btn--ghost'] : null,
    acc && acc.id !== session.user.id ? ['unlink', 'Tirar acesso ao app', 'btn--ghost'] : null,
    b.active ? ['off', 'Desligar da equipe', 'btn--danger'] : ['on', 'Reativar', ''],
  ].filter(Boolean);
  ctx.sheet(`<h3>${esc(b.name)}</h3><p>${acc ? esc(acc.email) : 'Sem conta de acesso'}${b.upcoming ? ` · ${b.upcoming} horário(s) marcados` : ''}</p>
    <div class="stack">${opts.map(([v, label, cls]) => `<button class="btn btn--block ${cls}" data-close="${v}">${label}</button>`).join('')}
    <button class="btn btn--block btn--line" data-close>Fechar</button></div>`).then(async (v) => {
    try {
      if (v === 'edit') {
        await ctx.sheet('<div data-ed></div>', (sh, close) => profileEditor($('[data-ed]', sh), b, { inSheet: true, onSaved: () => { close(); reload(); } }));
        return;
      }
      if (v === 'invite') { const { invite, barber } = await api(`/admin/team/${b.id}/invite`, { method: 'POST' }); await sendInvite(barber, invite, ''); }
      if (v === 'me') await api(`/admin/team/${b.id}/link-me`, { method: 'POST' });
      if (v === 'owner' && (await ctx.confirmSheet(`Tornar ${esc(b.name)} dono?`, 'Terá acesso total: equipe, preços e tudo mais.', 'Tornar dono'))) await api(`/admin/users/${acc.id}/role`, { method: 'POST', body: { staffRole: 'owner' } });
      if (v === 'unlink' && (await ctx.confirmSheet('Tirar acesso?', 'O perfil continua no app, mas a conta perde o acesso ao painel.', 'Tirar acesso', true))) await api(`/admin/team/${b.id}/unlink`, { method: 'POST' });
      if (v === 'off' && (await ctx.confirmSheet(`Desligar ${esc(b.name)}?`, 'Some do app e perde o acesso. Horários já marcados continuam na agenda.', 'Desligar', true))) {
        const { upcoming } = await api(`/admin/team/${b.id}/active`, { method: 'POST', body: { active: false } });
        if (upcoming) toast(`Ainda há ${upcoming} horário(s) marcados com ele. Veja na Agenda.`, 'error');
      }
      if (v === 'on') await api(`/admin/team/${b.id}/active`, { method: 'POST', body: { active: true } });
      if (v) {
        if (v === 'me') await session.load();
        await ctx.refreshCatalog();
        reload();
      }
    } catch (err) { toast(err.message, 'error'); }
  });
}

// =====================================================================
// BARBEARIA (dono): horário de funcionamento e serviços
// =====================================================================
async function barbearia(body) {
  body.innerHTML = `
    <div class="list"><button class="row" data-hours><span class="row__icon">${ctx.I.clock}</span>
      <span class="row__body"><strong>Horário de funcionamento</strong><small>${esc(hoursSummary(me.shopHours))}</small></span><span class="row__end">${ctx.I.chev}</span></button></div>
    <div data-svcs><div class="empty">Carregando…</div></div>`;
  $('[data-hours]', body).onclick = () => ctx.sheet(`<h3>Horário de funcionamento</h3><p>Vale para quem não tem horário próprio.</p><form class="stack" novalidate><div data-ed></div><p class="error"></p>
      <button class="btn btn--block" type="submit">Salvar</button><button class="btn btn--block btn--ghost" type="button" data-close>Cancelar</button></form>`, (sh, close) => {
    const read = hoursEditor($('[data-ed]', sh), me.shopHours);
    $('form', sh).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/admin/hours', { method: 'PUT', body: { hours: read() } });
        close();
        toast('Horário salvo!');
        await ctx.refreshCatalog();
        me = await api('/admin/me');
        barbearia(body);
      }
      catch (ex) { $('.error', sh).textContent = ex.message; }
    };
  });

  const load = async () => {
    const { services, categories } = await api('/admin/services');
    $('[data-svcs]', body).innerHTML = categories.map((c) => {
      const items = services.filter((s) => s.cat === c.id);
      return items.length ? `<div class="section-title">${esc(c.name)}</div><div class="list">${items.map((s) => `
        <button class="row ${s.active ? '' : 'row--off'}" data-s="${s.id}"><span class="row__body"><strong>${esc(s.name)}${s.popular ? ' <span class="tag">TOP</span>' : ''}${s.active ? '' : ' <span class="tag">OFF</span>'}</strong><small>${duration(s.duration)}</small></span>
        <span class="row__end"><b style="color:var(--cream)">${money(s.price)}</b>${ctx.I.chev}</span></button>`).join('')}</div>` : '';
    }).join('');
    $('[data-svcs]', body).onclick = (e) => { const r = e.target.closest('[data-s]'); if (r) serviceSheet(services.find((s) => s.id === r.dataset.s), categories, load); };
    fab('+ Serviço', () => serviceSheet(null, categories, load));
  };
  load();
}

function hoursSummary(h) {
  const open = WEEK.filter((d) => h?.[d]?.length);
  if (!open.length) return 'Fechado todos os dias';
  const closed = WEEK.filter((d) => !h?.[d]?.length).map((d) => DAYS[d].slice(0, 3));
  return `${open.length} dias abertos${closed.length ? ` · fecha ${closed.join(', ')}` : ''}`;
}

// "40", "40,50", "40.50" e "1.040,50" → centavos.
function parsePrice(v) {
  let t = String(v).trim().replace(/[^\d.,]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return Math.round(parseFloat(t || '0') * 100);
}

function serviceSheet(s, categories, reload) {
  const isNew = !s;
  s ||= { name: '', desc: '', cat: categories[0].id, price: 0, duration: 30, active: true, popular: false };
  ctx.sheet(`<h3>${isNew ? 'Novo serviço' : 'Editar serviço'}</h3>
    <form class="stack" novalidate>
      <div class="field"><label>Nome</label><input class="input" name="name" value="${esc(s.name)}" maxlength="60"></div>
      <div class="field"><label>Descrição (opcional)</label><input class="input" name="desc" value="${esc(s.desc)}" maxlength="160"></div>
      <div class="field"><label>Categoria</label><select class="input" name="cat">${categories.map((c) => `<option value="${c.id}" ${c.id === s.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="grid2">
        <div class="field"><label>Preço (R$)</label><input class="input" name="price" inputmode="decimal" value="${(s.price / 100).toFixed(2).replace('.', ',')}"></div>
        <div class="field"><label>Duração</label><div class="stepper"><button type="button" data-step="-5">−</button><span><b data-dur>${s.duration}</b> min</span><button type="button" data-step="5">+</button></div></div>
      </div>
      <div class="row" style="padding:6px 0"><span class="row__body"><strong>Ativo</strong><small>Aparece para os clientes</small></span><button type="button" class="switch" role="switch" aria-checked="${s.active}" data-active></button></div>
      <div class="row" style="padding:6px 0"><span class="row__body"><strong>Destaque</strong><small>Aparece em “Mais pedidos”</small></span><button type="button" class="switch" role="switch" aria-checked="${!!s.popular}" data-pop></button></div>
      <p class="error"></p>
      <button class="btn btn--block" type="submit">Salvar</button>
      <button class="btn btn--block btn--ghost" type="button" data-close>Cancelar</button>
    </form>`, (sh, close) => {
    let dur = s.duration;
    sh.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]');
      if (step) { dur = Math.min(480, Math.max(5, dur + Number(step.dataset.step))); $('[data-dur]', sh).textContent = dur; ctx.tap(); }
      const sw = e.target.closest('[data-active], [data-pop]');
      if (sw) sw.setAttribute('aria-checked', sw.getAttribute('aria-checked') !== 'true');
    });
    $('form', sh).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = {
        name: f.name.value, desc: f.desc.value, cat: f.cat.value, duration: dur,
        price: parsePrice(f.price.value),
        active: $('[data-active]', sh).getAttribute('aria-checked') === 'true',
        popular: $('[data-pop]', sh).getAttribute('aria-checked') === 'true',
      };
      try {
        await api(isNew ? '/admin/services' : `/admin/services/${s.id}`, { method: isNew ? 'POST' : 'PATCH', body });
        close();
        toast('Serviço salvo!');
        await ctx.refreshCatalog();
        reload();
      } catch (ex) { $('.error', f).textContent = ex.message; }
    };
  });
}
