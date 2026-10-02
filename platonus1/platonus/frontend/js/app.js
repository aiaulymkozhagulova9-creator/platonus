'use strict';

/* ═══════════ Көмекші функциялар ═══════════ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DAYS = ['Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма', 'Сенбі', 'Жексенбі'];
const LESSON_TYPES = ['Дәріс', 'Практика', 'Зертхана'];
const ROLE_NAMES = { student: 'Студент', teacher: 'Оқытушы', admin: 'Әкімші' };
const MAX_FILE = 15 * 1024 * 1024;

const ICON = {
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9"/></svg>',
  journal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 21v-1a6 6 0 0112 0v1M17 4.5a3.5 3.5 0 010 7M22 21v-1a6 6 0 00-4-5.6"/></svg>',
  groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5A2.5 2.5 0 016.5 2H20v17H6.5A2.5 2.5 0 004 21.5z"/><path d="M4 21.5V4.5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0116 0v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg>',
};

const state = { token: localStorage.getItem('pl_token'), user: null };

async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: payload }); }
  catch { throw new Error('Серверге қосылу мүмкін емес'); }
  if (res.ok && res.headers.get('Content-Disposition')) return res; // файл жүктеу
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(true); throw new Error(data.error || 'Сессия аяқталды'); }
  if (!res.ok) throw new Error(data.error || 'Белгісіз қате');
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4200);
}

const pad2 = (n) => String(n).padStart(2, '0');
function fmtDate(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : '—';
}
function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const fmtScore = (v) => (v == null ? '—' : Number.isInteger(v) ? v : v.toFixed(1));
const fmtSize = (b) => (b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' КБ' : (b / 1024 / 1024).toFixed(1) + ' МБ');
const opts = (items, val, label, selected) => items.map((i) =>
  `<option value="${esc(i[val])}"${String(i[val]) === String(selected) ? ' selected' : ''}>${esc(label(i))}</option>`).join('');
const field = (label, inner) => `<label class="field"><span>${esc(label)}</span>${inner}</label>`;
const loading = () => '<div class="loading"><div class="spinner"></div>Жүктелуде…</div>';
const empty = (title, hint = '') => `<div class="empty"><strong>${esc(title)}</strong>${esc(hint)}</div>`;

/* ═══════════ Модальды терезелер ═══════════ */
function openModal(title, bodyHtml, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Жабу">×</button></div><div class="modal-body">${bodyHtml}</div>`;
  $$('[data-close]', m).forEach((b) => (b.onclick = closeModal));
  m.showModal();
  if (onMount) onMount($('.modal-body', m));
}
const closeModal = () => { const m = $('#modal'); if (m.open) m.close(); };
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function formModal(title, fields, submitLabel, onSubmit, onMount) {
  const html = `<form novalidate>${fields}<div class="form-error" role="alert"></div>
    <div class="modal-foot"><button type="button" class="btn ghost" data-close>Бас тарту</button>
    <button type="submit" class="btn">${esc(submitLabel)}</button></div></form>`;
  openModal(title, html, (body) => {
    const form = $('form', body);
    $('[data-close]', body).onclick = closeModal;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try { await onSubmit(form); closeModal(); }
      catch (err) { $('.form-error', form).textContent = err.message; btn.disabled = false; }
    });
    if (onMount) onMount(form);
    const first = $('input:not([type=hidden]),select,textarea', form);
    if (first) first.focus();
  });
}

/* ═══════════ Авторизация ═══════════ */
function logout(expired = false) {
  state.token = null; state.user = null;
  localStorage.removeItem('pl_token');
  closeModal();
  renderLogin(expired ? 'Сессия аяқталды. Қайта кіріңіз.' : '');
}

function authLayout(inner) {
  return `<div class="login">
    <aside class="login-side">
      <div class="wordmark">Platonus<i>.</i></div>
      <p class="lead">Кесте, тапсырма және бағалар бір жерде</p>
    </aside>
    <main class="login-main"><div class="login-card">${inner}</div></main>
  </div>`;
}

function renderLogin(notice = '', noticeKind = 'error') {
  $('#app').innerHTML = authLayout(`
    <h1>Жүйеге кіру</h1>
    <p class="muted" style="margin-bottom:22px">Студент, оқытушы немесе әкімші аккаунтымен кіріңіз.</p>
    <form id="login-form" novalidate>
      ${field('Логин', '<input type="text" name="username" autocomplete="username" autocapitalize="off" required>')}
      ${field('Құпиясөз', '<input type="password" name="password" autocomplete="current-password" required>')}
      <div class="form-error ${noticeKind === 'ok' ? 'ok' : ''}" role="alert">${esc(notice)}</div>
      <button class="btn" style="width:100%" type="submit">Кіру</button>
    </form>
    <p class="auth-switch">Аккаунтыңыз жоқ па? <a href="#" id="to-register">Тіркелу</a></p>
    <div class="demo">
      <p class="small muted">Демо-аккаунттар (басып толтырыңыз):</p>
      <div class="chips">
        <button type="button" class="chip" data-u="student1" data-p="student123">Студент</button>
        <button type="button" class="chip" data-u="teacher1" data-p="teacher123">Оқытушы</button>
        <button type="button" class="chip" data-u="admin" data-p="admin123">Әкімші</button>
      </div>
    </div>`);
  const form = $('#login-form');
  $('#to-register').onclick = (e) => { e.preventDefault(); renderRegister(); };
  $$('.chip').forEach((c) => c.onclick = () => {
    form.username.value = c.dataset.u; form.password.value = c.dataset.p; form.password.focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form), btn = $('button[type=submit]', form);
    err.textContent = ''; err.classList.remove('ok'); btn.disabled = true;
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
      state.token = data.token; state.user = data.user;
      localStorage.setItem('pl_token', data.token);
      location.hash = '';
      renderShell();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  form.username.focus();
}

async function renderRegister() {
  let groups = [];
  try { groups = (await api('/public/groups')).items; } catch { /* топтарсыз да ашылады */ }
  $('#app').innerHTML = authLayout(`
    <h1>Тіркелу</h1>
    <p class="muted" style="margin-bottom:18px">Студент аккаунты бірден ашылады. Оқытушы аккаунтын әкімші растайды.</p>
    <form id="reg-form" novalidate>
      ${field('Мен', `<select name="role"><option value="student">Студентпін</option><option value="teacher">Оқытушымын</option></select>`)}
      ${field('Аты-жөні', '<input type="text" name="full_name" autocomplete="name" maxlength="120">')}
      ${field('Логин (латын әріптері, сандар)', '<input type="text" name="username" autocomplete="username" autocapitalize="off" maxlength="32">')}
      ${field('Email (міндетті емес)', '<input type="text" name="email" autocomplete="email" inputmode="email" maxlength="120">')}
      <div id="r-group">${field('Топ', `<select name="group_id"><option value="">Топты таңдаңыз</option>${opts(groups, 'id', (g) => `${g.name} · ${g.specialty}`)}</select>`)}</div>
      <div id="r-dept" class="hidden">${field('Кафедра (міндетті емес)', '<input type="text" name="department" maxlength="120">')}</div>
      <div class="row">
        ${field('Құпиясөз (кемінде 6)', '<input type="password" name="password" autocomplete="new-password">')}
        ${field('Қайталаңыз', '<input type="password" name="confirm" autocomplete="new-password">')}
      </div>
      <div class="form-error" role="alert"></div>
      <button class="btn" style="width:100%" type="submit">Тіркелу</button>
    </form>
    <p class="auth-switch">Аккаунтыңыз бар ма? <a href="#" id="to-login">Кіру</a></p>`);
  const f = $('#reg-form');
  $('#to-login').onclick = (e) => { e.preventDefault(); renderLogin(); };
  f.role.onchange = () => {
    $('#r-group').classList.toggle('hidden', f.role.value !== 'student');
    $('#r-dept').classList.toggle('hidden', f.role.value !== 'teacher');
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', f), btn = $('button[type=submit]', f);
    err.textContent = '';
    const role = f.role.value;
    if (f.password.value !== f.confirm.value) { err.textContent = 'Құпиясөздер сәйкес келмейді'; return; }
    if (role === 'student' && !f.group_id.value) { err.textContent = 'Топты таңдаңыз'; return; }
    btn.disabled = true;
    try {
      const data = await api('/auth/register', { method: 'POST', body: {
        role, full_name: f.full_name.value, username: f.username.value, email: f.email.value,
        password: f.password.value, group_id: role === 'student' ? f.group_id.value : null,
        department: role === 'teacher' ? f.department.value : '' } });
      if (data.token) {
        state.token = data.token; state.user = data.user;
        localStorage.setItem('pl_token', data.token);
        location.hash = ''; toast('Тіркелу сәтті аяқталды. Қош келдіңіз!', 'ok');
        renderShell();
      } else {
        renderLogin('Өтініш жіберілді. Әкімші растағаннан кейін жүйеге кіре аласыз.', 'ok');
      }
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  f.full_name.focus();
}

function changePasswordModal() {
  formModal('Құпиясөзді өзгерту',
    field('Ағымдағы құпиясөз', '<input type="password" name="old" autocomplete="current-password">') +
    field('Жаңа құпиясөз (кемінде 6 таңба)', '<input type="password" name="new" autocomplete="new-password">'),
    'Сақтау',
    async (f) => {
      await api('/auth/password', { method: 'POST', body: { old_password: f.old.value, new_password: f.new.value } });
      toast('Құпиясөз өзгертілді', 'ok');
    });
}

/* ═══════════ Каркас және маршрутизация ═══════════ */
const NAV = {
  student: [['schedule', 'Кесте', 'calendar'], ['assignments', 'Тапсырмалар', 'tasks'], ['journal', 'Журнал', 'journal'], ['profile', 'Профиль', 'user']],
  teacher: [['profile', 'Профиль', 'user'], ['schedule', 'Кесте', 'calendar'], ['assignments', 'Тапсырмалар', 'tasks'], ['journal', 'Журнал', 'journal']],
  admin: [['profile', 'Профиль', 'user'], ['users', 'Қолданушылар', 'users'], ['groups', 'Топтар', 'groups'],
    ['subjects', 'Пәндер', 'book'], ['offerings', 'Жүктеме', 'link'], ['schedule', 'Кесте', 'calendar']],
};

const TITLES = {
  schedule: 'Сабақ кестесі', assignments: 'Тапсырмалар', journal: 'Ағымдағы журнал', overview: 'Шолу',
  profile: 'Жеке профиль', users: 'Қолданушылар', groups: 'Топтар', subjects: 'Пәндер', offerings: 'Оқу жүктемесі',
};

function renderShell() {
  const u = state.user;
  const nav = NAV[u.role].map(([key, label, icon]) =>
    `<a href="#/${key}" data-route="${key}">${ICON[icon]}<span>${label}</span></a>`).join('');
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="wordmark">Platonus<i style="font-style:normal;color:var(--sun)">.</i></div>
      <nav class="nav" aria-label="Негізгі мәзір">${nav}</nav>
      <div class="me">
        <strong>${esc(u.full_name)}</strong>
        <span class="role">${ROLE_NAMES[u.role]}${u.group_name ? ' · ' + esc(u.group_name) : ''}</span>
        <div class="actions">
          <button class="btn ghost sm" id="btn-pass" type="button">Құпиясөз</button>
          <button class="btn ghost sm" id="btn-out" type="button">Шығу</button>
        </div>
      </div>
    </aside>
    <main class="main" id="main" tabindex="-1"></main>
  </div>`;
  $('#btn-out').onclick = () => logout();
  $('#btn-pass').onclick = changePasswordModal;
  route();
}

async function route() {
  if (!state.user) return;
  const keys = NAV[state.user.role].map((n) => n[0]);
  let name = (location.hash.replace(/^#\//, '') || keys[0]);
  if (!keys.includes(name)) name = keys[0];
  $$('.nav a').forEach((a) => { if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = TITLES[name] + ' — Platonus';
  const main = $('#main');
  main.innerHTML = loading();
  try {
    await VIEWS[state.user.role][name](main);
  } catch (e) {
    if (state.user) main.innerHTML = `<div class="panel">${empty('Деректерді жүктеу мүмкін болмады', e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

const pageHead = (title, sub = '', actions = '') =>
  `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="muted">${esc(sub)}</p>` : ''}</div>${actions}</div>`;

/* ═══════════ Сабақ кестесі ═══════════ */
function todayWeekday() { return (new Date().getDay() + 6) % 7 + 1; }

function lessonHtml(l, role) {
  const who = role === 'student' ? l.teacher : role === 'teacher' ? l.group_name : `${l.group_name} · ${l.teacher}`;
  return `<div class="lesson" style="--h:${(l.subject_id * 47) % 360}">
    ${role === 'admin' ? `<button class="btn danger sm del" data-del="${l.id}" aria-label="Сабақты жою">Жою</button>` : ''}
    <div class="time">${esc(l.start_time)}–${esc(l.end_time)}</div>
    <div class="subj">${esc(l.subject)}</div>
    <div class="meta">${esc(l.lesson_type)} · ауд. ${esc(l.room)}</div>
    <div class="meta">${esc(who)}</div>
  </div>`;
}

function weekBoard(items, role) {
  const showSun = items.some((i) => i.weekday === 7);
  const days = showSun ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5, 6];
  const today = todayWeekday();
  return `<div class="week">${days.map((d) => {
    const list = items.filter((i) => i.weekday === d);
    return `<section class="day${d === today ? ' today' : ''}" aria-label="${DAYS[d - 1]}">
      <header><span>${DAYS[d - 1]}</span>${d === today ? '<span class="badge warn">Бүгін</span>' : ''}</header>
      <div class="list">${list.length ? list.map((l) => lessonHtml(l, role)).join('') : '<p class="none">Сабақ жоқ</p>'}</div>
    </section>`;
  }).join('')}</div>`;
}

async function viewSchedule(root) {
  const role = state.user.role;
  let groups = [], groupId = '';
  if (role === 'admin') groups = (await api('/admin/groups')).items;

  async function draw() {
    const { items } = await api('/schedule' + (groupId ? `?group_id=${groupId}` : ''));
    const sub = role === 'student' ? `Топ: ${state.user.group_name}` : role === 'teacher' ? 'Сіздің сабақтарыңыз' : 'Барлық сабақтар';
    const actions = role === 'admin'
      ? `<div class="toolbar"><select id="grp" aria-label="Топ бойынша сүзу"><option value="">Барлық топтар</option>${opts(groups, 'id', (g) => g.name, groupId)}</select>
         <button class="btn" id="add" type="button">Сабақ қосу</button></div>` : '';
    root.innerHTML = pageHead('Сабақ кестесі', sub, actions) +
      (items.length || role === 'admin' ? weekBoard(items, role) : `<div class="panel">${empty('Кесте әзірге бос', 'Сабақтар қосылғанда осында көрінеді')}</div>`);
    if (role !== 'admin') return;
    $('#grp').onchange = (e) => { groupId = e.target.value; draw(); };
    $('#add').onclick = () => addLessonModal(draw);
    $$('[data-del]', root).forEach((b) => b.onclick = async () => {
      if (!confirm('Бұл сабақты кестеден жою керек пе?')) return;
      try { await api(`/admin/schedule/${b.dataset.del}`, { method: 'DELETE' }); toast('Сабақ жойылды', 'ok'); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }
  await draw();
}

async function addLessonModal(done) {
  const { items: offs } = await api('/admin/offerings');
  if (!offs.length) return toast('Алдымен «Жүктеме» бөлімінде пән мен оқытушыны топқа бекітіңіз', 'error');
  formModal('Сабақ қосу',
    field('Пән жүктемесі', `<select name="offering_id">${opts(offs, 'id', (o) => `${o.group_name} · ${o.subject} · ${o.teacher}`)}</select>`) +
    `<div class="row">${field('Апта күні', `<select name="weekday">${DAYS.map((d, i) => `<option value="${i + 1}">${d}</option>`).join('')}</select>`)}
     ${field('Түрі', `<select name="lesson_type">${LESSON_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>`)}</div>` +
    `<div class="row">${field('Басталуы', '<input type="time" name="start_time" value="09:00">')}${field('Аяқталуы', '<input type="time" name="end_time" value="10:30">')}</div>` +
    field('Аудитория', '<input type="text" name="room" maxlength="20">'),
    'Қосу',
    async (f) => {
      await api('/admin/schedule', { method: 'POST', body: {
        offering_id: f.offering_id.value, weekday: f.weekday.value, lesson_type: f.lesson_type.value,
        start_time: f.start_time.value, end_time: f.end_time.value, room: f.room.value } });
      toast('Сабақ қосылды', 'ok'); done();
    });
}

/* ═══════════ Тапсырмалар ═══════════ */
function deadlineBadge(a) {
  if (a.submitted) return a.late ? '<span class="badge warn">Кеш тапсырылды</span>' : '<span class="badge ok">Тапсырылды</span>';
  return a.deadline < nowLocal() ? '<span class="badge bad">Мерзімі өтті</span>' : '<span class="badge blue">Күтілуде</span>';
}

async function downloadFile(submissionId) {
  try {
    const res = await api(`/submissions/${submissionId}/file`);
    const cd = res.headers.get('Content-Disposition') || '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
    const name = m ? decodeURIComponent(m[1]) : 'file';
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast(e.message, 'error'); }
}

async function viewAssignments(root) {
  const role = state.user.role;
  async function draw() {
    const { items } = await api('/assignments');
    if (role === 'student') {
      root.innerHTML = pageHead('Тапсырмалар', 'PDF, ZIP немесе DOCX, 15 МБ-қа дейін') +
        (items.length ? `<div class="cards">${items.map((a) => `
        <article class="panel task ${a.submitted ? 'done' : a.deadline < nowLocal() ? 'overdue' : ''}">
          <div class="top"><div><h3>${esc(a.title)}</h3><p class="small muted">${esc(a.subject)} · ${esc(a.teacher)}</p></div>${deadlineBadge(a)}</div>
          <p class="desc">${esc(a.description) || '<span class="muted">Сипаттама жоқ</span>'}</p>
          ${a.submitted ? `<p class="small">Файл: <a href="#" data-dl="${a.submission_id}">${esc(a.file_name)}</a><br><span class="muted">${fmtDate(a.submitted_at)}</span></p>` : ''}
          <div class="foot"><span class="small muted">Мерзімі: ${fmtDate(a.deadline)}</span>
            <button class="btn sm ${a.submitted ? 'ghost' : ''}" data-up="${a.id}" type="button">${a.submitted ? 'Қайта жүктеу' : 'Файл жүктеу'}</button></div>
        </article>`).join('')}</div>` : `<div class="panel">${empty('Тапсырмалар жоқ', 'Оқытушы тапсырма қосқанда осында көрінеді')}</div>`);
      $$('[data-up]', root).forEach((b) => b.onclick = () => uploadModal(items.find((a) => a.id == b.dataset.up), draw));
      $$('[data-dl]', root).forEach((a) => a.onclick = (e) => { e.preventDefault(); downloadFile(a.dataset.dl); });
    } else {
      root.innerHTML = pageHead('Тапсырмалар', 'Сіз берген тапсырмалар', '<button class="btn" id="new" type="button">Жаңа тапсырма</button>') +
        (items.length ? `<div class="cards">${items.map((a) => `
        <article class="panel task">
          <div class="top"><div><h3>${esc(a.title)}</h3><p class="small muted">${esc(a.subject)} · ${esc(a.group_name)}</p></div>
            <span class="badge ${a.submitted_count === a.student_count && a.student_count ? 'ok' : 'blue'}">${a.submitted_count} / ${a.student_count}</span></div>
          <p class="desc">${esc(a.description) || '<span class="muted">Сипаттама жоқ</span>'}</p>
          <div class="foot"><span class="small muted">Мерзімі: ${fmtDate(a.deadline)}</span>
            <span class="cell-actions"><button class="btn sm ghost" data-subs="${a.id}" type="button">Жұмыстар</button>
            <button class="btn sm danger" data-rm="${a.id}" type="button">Жою</button></span></div>
        </article>`).join('')}</div>` : `<div class="panel">${empty('Әзірге тапсырма жоқ', '«Жаңа тапсырма» түймесін басыңыз')}</div>`);
      $('#new').onclick = () => newAssignmentModal(draw);
      $$('[data-subs]', root).forEach((b) => b.onclick = () => submissionsModal(b.dataset.subs));
      $$('[data-rm]', root).forEach((b) => b.onclick = async () => {
        if (!confirm('Тапсырма мен барлық жүктелген жұмыстар жойылады. Жалғастыру керек пе?')) return;
        try { await api(`/assignments/${b.dataset.rm}`, { method: 'DELETE' }); toast('Тапсырма жойылды', 'ok'); draw(); }
        catch (e) { toast(e.message, 'error'); }
      });
    }
  }
  await draw();
}

function uploadModal(a, done) {
  formModal(`Жұмысты тапсыру: ${a.title}`,
    field('Файл (PDF, ZIP, DOCX)', '<input type="file" name="file" accept=".pdf,.zip,.docx" required>') +
    field('Пікір (міндетті емес)', '<textarea name="comment" maxlength="500"></textarea>'),
    a.submitted ? 'Ауыстыру' : 'Жіберу',
    async (f) => {
      const file = f.file.files[0];
      if (!file) throw new Error('Файл таңдаңыз');
      if (!/\.(pdf|zip|docx)$/i.test(file.name)) throw new Error('Тек PDF, ZIP немесе DOCX файлдарына рұқсат етіледі');
      if (file.size > MAX_FILE) throw new Error('Файл тым үлкен (ең көбі 15 МБ)');
      const fd = new FormData();
      fd.append('file', file); fd.append('comment', f.comment.value);
      await api(`/assignments/${a.id}/submit`, { method: 'POST', form: fd });
      toast('Жұмыс тапсырылды', 'ok'); done();
    });
}

async function newAssignmentModal(done) {
  const { items: offs } = await api('/offerings');
  if (!offs.length) return toast('Сізге бекітілген пән жоқ. Әкімшіге хабарласыңыз', 'error');
  const d = new Date(Date.now() + 7 * 864e5);
  const dl = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T23:59`;
  formModal('Жаңа тапсырма',
    field('Пән және топ', `<select name="offering_id">${opts(offs, 'id', (o) => `${o.subject} · ${o.group_name}`)}</select>`) +
    field('Атауы', '<input type="text" name="title" maxlength="150">') +
    field('Сипаттама', '<textarea name="description" maxlength="2000"></textarea>') +
    field('Тапсыру мерзімі', `<input type="datetime-local" name="deadline" value="${dl}">`),
    'Қосу',
    async (f) => {
      await api('/assignments', { method: 'POST', body: {
        offering_id: f.offering_id.value, title: f.title.value, description: f.description.value, deadline: f.deadline.value } });
      toast('Тапсырма қосылды', 'ok'); done();
    });
}

async function submissionsModal(id) {
  try {
    const { assignment, items } = await api(`/assignments/${id}/submissions`);
    const rows = items.map((s) => `<tr>
      <td data-label="Студент">${esc(s.full_name)}</td>
      <td data-label="Күйі">${s.submission_id ? (s.late ? '<span class="badge warn">Кеш</span>' : '<span class="badge ok">Тапсырды</span>') : '<span class="badge bad">Тапсырмады</span>'}</td>
      <td data-label="Файл">${s.submission_id ? `<a href="#" data-dl="${s.submission_id}">${esc(s.file_name)}</a><br><span class="small muted">${fmtSize(s.file_size)} · ${fmtDate(s.submitted_at)}</span>${s.comment ? `<br><span class="small">${esc(s.comment)}</span>` : ''}` : '—'}</td>
    </tr>`).join('');
    openModal(assignment.title, `<div class="table-wrap"><table class="data stack"><thead><tr><th>Студент</th><th>Күйі</th><th>Файл</th></tr></thead><tbody>${rows}</tbody></table></div>`, (body) => {
      $$('[data-dl]', body).forEach((a) => a.onclick = (e) => { e.preventDefault(); downloadFile(a.dataset.dl); });
    });
  } catch (e) { toast(e.message, 'error'); }
}

/* ═══════════ Журнал ═══════════ */
const gradeClass = (t) => (t == null ? '' : t >= 90 ? 'grade-a' : t < 50 ? 'grade-f' : '');

async function viewJournal(root) {
  if (state.user.role === 'student') {
    const { items, weights } = await api('/journal');
    const done = items.filter((i) => i.total != null);
    const avg = done.length ? (done.reduce((s, i) => s + i.total, 0) / done.length).toFixed(1) : '—';
    root.innerHTML = pageHead('Ағымдағы журнал', `Жиынтық баға = 1-аралық ${weights.rk1 * 100}% + 2-аралық ${weights.rk2 * 100}% + қорытынды ${weights.final * 100}%`) +
      (items.length ? `<div class="stats">
        <div class="panel stat gold"><b>${avg}</b><span>Орташа жиынтық баға</span></div>
        <div class="panel stat"><b>${done.length} / ${items.length}</b><span>Бағасы шыққан пән</span></div></div>
      <div class="panel table-wrap"><table class="data stack"><thead><tr><th>Пән</th><th>Оқытушы</th><th class="num">1-аралық</th><th class="num">2-аралық</th><th class="num">Қорытынды</th><th class="num">Жиынтық</th><th class="num">Әріптік</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td data-label="Пән"><strong>${esc(i.subject)}</strong><br><span class="small muted">${i.credits} кредит</span></td>
        <td data-label="Оқытушы">${esc(i.teacher)}</td>
        <td class="num" data-label="1-аралық">${fmtScore(i.rk1)}</td><td class="num" data-label="2-аралық">${fmtScore(i.rk2)}</td>
        <td class="num" data-label="Қорытынды">${fmtScore(i.final)}</td>
        <td class="num ${gradeClass(i.total)}" data-label="Жиынтық">${fmtScore(i.total)}</td>
        <td class="num ${gradeClass(i.total)}" data-label="Әріптік">${i.letter || '—'}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="panel">${empty('Пәндер табылмады')}</div>`);
    return;
  }

  // Оқытушы: баға қою
  const { items: offs } = await api('/offerings');
  if (!offs.length) { root.innerHTML = pageHead('Ағымдағы журнал') + `<div class="panel">${empty('Сізге бекітілген пән жоқ')}</div>`; return; }
  let current = offs[0].id;
  async function draw() {
    const { items, weights } = await api(`/offerings/${current}/grades`);
    root.innerHTML = pageHead('Ағымдағы журнал', 'Бағалар 0–100 аралығында',
      `<div class="toolbar"><select id="off" aria-label="Пән таңдау">${opts(offs, 'id', (o) => `${o.subject} · ${o.group_name}`, current)}</select></div>`) +
      `<div class="panel"><div class="table-wrap"><table class="data stack" id="gt"><thead><tr><th>Студент</th><th class="num">1-аралық</th><th class="num">2-аралық</th><th class="num">Қорытынды</th><th class="num">Жиынтық</th><th class="num">Әріптік</th></tr></thead><tbody>
      ${items.map((s) => `<tr data-sid="${s.student_id}"><td data-label="Студент">${esc(s.full_name)}</td>
        ${['rk1', 'rk2', 'final'].map((k) => `<td class="num" data-label="${{ rk1: '1-аралық', rk2: '2-аралық', final: 'Қорытынды' }[k]}"><input class="score" type="number" min="0" max="100" step="0.5" inputmode="decimal" data-k="${k}" value="${s[k] ?? ''}" aria-label="${esc(s.full_name)}: ${k}"></td>`).join('')}
        <td class="num" data-label="Жиынтық" data-total>—</td><td class="num" data-label="Әріптік" data-letter>—</td></tr>`).join('')}
      </tbody></table></div>
      <div class="panel-pad" style="display:flex;justify-content:flex-end;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="muted small">Жиынтық = ${weights.rk1 * 100}% + ${weights.rk2 * 100}% + ${weights.final * 100}%</span>
        <button class="btn" id="save" type="button">Бағаларды сақтау</button></div></div>`;
    const letterOf = (t) => [[95, 'A'], [90, 'A-'], [85, 'B+'], [80, 'B'], [75, 'B-'], [70, 'C+'], [65, 'C'], [60, 'C-'], [55, 'D+'], [50, 'D']].find(([l]) => t >= l)?.[1] || 'F';
    const recalc = (tr) => {
      const v = $$('input', tr).map((i) => (i.value === '' ? null : parseFloat(i.value)));
      const ok = v.every((x) => x != null && !isNaN(x));
      const t = ok ? Math.round((v[0] * weights.rk1 + v[1] * weights.rk2 + v[2] * weights.final) * 10) / 10 : null;
      const cell = $('[data-total]', tr), lt = $('[data-letter]', tr);
      cell.textContent = fmtScore(t); lt.textContent = t == null ? '—' : letterOf(t);
      cell.className = lt.className = 'num ' + gradeClass(t);
    };
    $$('#gt tbody tr').forEach((tr) => { recalc(tr); $$('input', tr).forEach((i) => i.addEventListener('input', () => recalc(tr))); });
    $('#off').onchange = (e) => { current = e.target.value; draw(); };
    $('#save').onclick = async () => {
      const grades = $$('#gt tbody tr').map((tr) => {
        const row = { student_id: Number(tr.dataset.sid) };
        $$('input', tr).forEach((i) => (row[i.dataset.k] = i.value));
        return row;
      });
      const btn = $('#save'); btn.disabled = true;
      try { await api(`/offerings/${current}/grades`, { method: 'PUT', body: { grades } }); toast('Бағалар сақталды', 'ok'); }
      catch (e) { toast(e.message, 'error'); }
      btn.disabled = false;
    };
  }
  await draw();
}

/* ═══════════ Жеке профиль ═══════════ */
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

async function viewProfile(root) {
  const role = state.user.role;
  const data = await api('/profile');
  const p = data.profile;
  const kv = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
  const isStaff = role !== 'student';

  const card = `<aside class="panel panel-pad profile-card">
    <div class="avatar" aria-hidden="true">${esc(initials(p.full_name))}</div>
    <h2>${esc(p.full_name)}</h2>
    <span class="badge blue">${ROLE_NAMES[role]}</span>
    <dl class="kv">
      ${kv('Логин', p.username)}
      ${role === 'student' ? kv('Топ', p.group_name) + kv('Мамандық', p.specialty) + kv('Курс', p.course) : ''}
      ${kv('Кафедра', p.department)}${kv('Лауазым', p.position)}
      ${kv('Email', p.email)}${kv('Телефон', p.phone)}
      ${kv('Тіркелген', fmtDate(p.created_at).split(' ')[0])}
    </dl>
    ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
    <button class="btn ghost" id="pw" type="button">Құпиясөзді өзгерту</button>
  </aside>`;

  let extra = '';
  if (role === 'teacher') {
    const t = data.teacher;
    const stat = (n, l, cls = '') => `<div class="panel stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
    extra = `<div class="stats">${stat(t.groups, 'Топ', 'gold')}${stat(t.students, 'Студент')}${stat(t.assignments, 'Тапсырма')}${stat(t.submissions, 'Түскен жұмыс')}</div>
      <section class="panel panel-pad"><h2>Бүгінгі сабақтар</h2>
        ${t.today.length ? `<div class="today-list">${t.today.map((l) => lessonHtml(l, 'teacher')).join('')}</div>` : '<p class="muted" style="margin-top:8px">Бүгін сабақ жоқ</p>'}
      </section>
      <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>Менің пәндерім</h2></div>
        ${t.offerings.length ? `<div class="table-wrap"><table class="data stack"><thead><tr><th>Пән</th><th>Топ</th><th class="num">Студент</th></tr></thead><tbody>
        ${t.offerings.map((o) => `<tr><td data-label="Пән">${esc(o.subject)}</td><td data-label="Топ">${esc(o.group_name)}</td><td class="num" data-label="Студент">${o.students}</td></tr>`).join('')}</tbody></table></div>`
          : empty('Сізге пән бекітілмеген', 'Әкімші пәнді бекіткен соң осында көрінеді')}
      </section>`;
  } else if (role === 'admin') {
    const a = data.admin, s = a.stats;
    const stat = (n, l, cls = '') => `<div class="panel stat ${cls}"><b>${n}</b><span>${l}</span></div>`;
    extra = `<div class="stats">${stat(s.students, 'Студент', 'gold')}${stat(s.teachers, 'Оқытушы')}${stat(s.groups, 'Топ')}${stat(s.subjects, 'Пән')}${stat(s.lessons, 'Сабақ')}</div>
      <section class="panel"><div class="panel-pad" style="padding-bottom:6px"><h2>Тіркелу сұраулары ${a.pending.length ? `<span class="badge warn">${a.pending.length}</span>` : ''}</h2>
        <p class="muted small" style="margin-top:4px">Өздігінен тіркелген оқытушылар растауды күтеді</p></div>
        ${a.pending.length ? `<div class="table-wrap"><table class="data stack"><thead><tr><th>Аты-жөні</th><th>Логин</th><th>Кафедра</th><th>Email</th><th></th></tr></thead><tbody>
        ${a.pending.map((u) => `<tr><td data-label="Аты-жөні"><strong>${esc(u.full_name)}</strong></td><td data-label="Логин">${esc(u.username)}</td><td data-label="Кафедра">${esc(u.department || '—')}</td><td data-label="Email">${esc(u.email || '—')}</td>
          <td><div class="cell-actions"><button class="btn sm" data-ok="${u.id}" type="button">Растау</button><button class="btn sm danger" data-no="${u.id}" type="button">Қабылдамау</button></div></td></tr>`).join('')}</tbody></table></div>`
          : empty('Жаңа сұрау жоқ', 'Оқытушы тіркелсе, осында көрінеді')}
      </section>`;
  } else {
    extra = `<div class="stats"><div class="panel stat gold"><b>${data.student.subjects}</b><span>Пән осы семестрде</span></div></div>`;
  }

  const form = `<section class="panel panel-pad"><h2 style="margin-bottom:14px">Жеке деректерді өзгерту</h2>
    <form id="pf" novalidate>
      ${field('Аты-жөні', `<input type="text" name="full_name" maxlength="120" value="${esc(p.full_name)}">`)}
      <div class="row">${field('Email', `<input type="text" name="email" inputmode="email" maxlength="120" value="${esc(p.email)}">`)}
      ${field('Телефон', `<input type="text" name="phone" inputmode="tel" maxlength="30" value="${esc(p.phone)}">`)}</div>
      ${isStaff ? `<div class="row">${role === 'teacher' ? field('Кафедра', `<input type="text" name="department" maxlength="120" value="${esc(p.department)}">`) : ''}
        ${field('Лауазым / дәреже', `<input type="text" name="position" maxlength="120" value="${esc(p.position)}">`)}</div>
        ${field('Өзім туралы', `<textarea name="bio" maxlength="1000">${esc(p.bio)}</textarea>`)}` : ''}
      <div class="form-error" role="alert"></div>
      <button class="btn" type="submit">Сақтау</button>
    </form></section>`;

  root.innerHTML = pageHead(role === 'admin' ? 'Әкімші профилі' : role === 'teacher' ? 'Оқытушы профилі' : 'Менің профилім', 'Жеке деректер және жұмыс қорытындысы') +
    `<div class="profile-grid">${card}<div class="profile-main">${extra}${form}</div></div>`;

  $('#pw').onclick = changePasswordModal;
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('.form-error', f), btn = $('button[type=submit]', f);
    err.textContent = ''; btn.disabled = true;
    try {
      const body = Object.fromEntries([...new FormData(f).entries()]);
      const res = await api('/profile', { method: 'PUT', body });
      state.user = { ...state.user, ...res.user };
      const nm = $('.me strong'); if (nm) nm.textContent = state.user.full_name;
      toast('Профиль сақталды', 'ok');
      viewProfile(root);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  });
  const decide = (attr, fn, okMsg) => $$(`[${attr}]`, root).forEach((b) => b.onclick = async () => {
    try { await fn(b.getAttribute(attr)); toast(okMsg, 'ok'); viewProfile(root); }
    catch (e) { toast(e.message, 'error'); }
  });
  decide('data-ok', (id) => api(`/admin/users/${id}/approve`, { method: 'POST' }), 'Аккаунт расталды');
  decide('data-no', async (id) => {
    if (!confirm('Өтінішті қабылдамасаңыз, аккаунт жойылады. Жалғастыру керек пе?')) throw new Error('Бас тартылды');
    await api(`/admin/users/${id}`, { method: 'DELETE' });
  }, 'Өтініш қабылданбады');
}

/* ═══════════ Админ панелі ═══════════ */
const ROLE_TABS = [['', 'Барлығы'], ['student', 'Студенттер'], ['teacher', 'Оқытушылар'], ['admin', 'Әкімшілер']];

async function viewUsers(root) {
  let role = '';
  const groups = (await api('/admin/groups')).items;
  async function draw() {
    const { items } = await api('/admin/users' + (role ? `?role=${role}` : ''));
    root.innerHTML = pageHead('Қолданушылар', '', '<button class="btn" id="add" type="button">Қолданушы қосу</button>') +
      `<div class="tabs" role="group" aria-label="Рөл бойынша сүзу">${ROLE_TABS.map(([k, l]) => `<button type="button" data-role="${k}" aria-pressed="${k === role}">${l}</button>`).join('')}</div>
      <div class="panel table-wrap"><table class="data stack"><thead><tr><th>Аты-жөні</th><th>Логин</th><th>Рөлі</th><th>Топ</th><th>Күйі</th><th></th></tr></thead><tbody>
      ${items.map((u) => `<tr><td data-label="Аты-жөні"><strong>${esc(u.full_name)}</strong></td><td data-label="Логин">${esc(u.username)}</td>
        <td data-label="Рөлі"><span class="badge">${ROLE_NAMES[u.role]}</span></td><td data-label="Топ">${esc(u.group_name || '—')}</td>
        <td data-label="Күйі">${!u.approved ? '<span class="badge warn">Растау күтуде</span>' : u.is_active ? '<span class="badge ok">Белсенді</span>' : '<span class="badge bad">Бұғатталған</span>'}</td>
        <td><div class="cell-actions">${!u.approved ? `<button class="btn sm" data-approve="${u.id}" type="button">Растау</button>` : ''}<button class="btn sm ghost" data-edit="${u.id}" type="button">Өңдеу</button>
        <button class="btn sm danger" data-rm="${u.id}" type="button">Жою</button></div></td></tr>`).join('')}
      </tbody></table></div>`;
    $$('[data-role]', root).forEach((b) => b.onclick = () => { role = b.dataset.role; draw(); });
    $('#add').onclick = () => userModal(null, groups, draw);
    $$('[data-approve]', root).forEach((b) => b.onclick = async () => {
      try { await api(`/admin/users/${b.dataset.approve}/approve`, { method: 'POST' }); toast('Аккаунт расталды', 'ok'); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });
    $$('[data-edit]', root).forEach((b) => b.onclick = () => userModal(items.find((u) => u.id == b.dataset.edit), groups, draw));
    $$('[data-rm]', root).forEach((b) => b.onclick = async () => {
      const u = items.find((x) => x.id == b.dataset.rm);
      if (!confirm(`«${u.full_name}» қолданушысын жою керек пе? Оның барлық жұмыстары мен бағалары да жойылады.`)) return;
      try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); toast('Қолданушы жойылды', 'ok'); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }
  await draw();
}

function userModal(u, groups, done) {
  const isNew = !u;
  const groupSel = (val) => field('Топ', `<select name="group_id">${opts(groups, 'id', (g) => g.name, val)}</select>`);
  formModal(isNew ? 'Жаңа қолданушы' : 'Қолданушыны өңдеу',
    (isNew ? field('Логин (латын әріптері, сандар)', '<input type="text" name="username" autocapitalize="off" maxlength="32">') : '') +
    field('Аты-жөні', `<input type="text" name="full_name" maxlength="120" value="${esc(u?.full_name || '')}">`) +
    (isNew ? field('Рөлі', `<select name="role">${Object.entries(ROLE_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`) : '') +
    `<div id="grp-wrap" class="${isNew || u.role === 'student' ? '' : 'hidden'}">${groupSel(u?.group_id)}</div>` +
    field(isNew ? 'Құпиясөз (кемінде 6 таңба)' : 'Жаңа құпиясөз (өзгертпесеңіз бос қалдырыңыз)', '<input type="password" name="password" autocomplete="new-password">') +
    (isNew ? '' : `<label class="field"><span><input type="checkbox" name="is_active" ${u.is_active ? 'checked' : ''}> Аккаунт белсенді</span></label>`),
    isNew ? 'Қосу' : 'Сақтау',
    async (f) => {
      if (isNew) {
        const role = f.role.value;
        if (role === 'student' && !f.group_id.value) throw new Error('Топты таңдаңыз');
        await api('/admin/users', { method: 'POST', body: { username: f.username.value, full_name: f.full_name.value, role,
          password: f.password.value, group_id: role === 'student' ? f.group_id.value : null } });
        toast('Қолданушы қосылды', 'ok');
      } else {
        const body = { full_name: f.full_name.value, is_active: f.is_active.checked };
        if (f.password.value) body.password = f.password.value;
        if (u.role === 'student') body.group_id = f.group_id.value;
        await api(`/admin/users/${u.id}`, { method: 'PUT', body });
        toast('Өзгерістер сақталды', 'ok');
      }
      done();
    },
    (form) => {
      if (isNew) form.role.onchange = () => $('#grp-wrap').classList.toggle('hidden', form.role.value !== 'student');
    });
}

/* groups / subjects үшін ортақ CRUD көрінісі */
function crudView({ title, endpoint, columns, fields, noun, sub }) {
  return async (root) => {
    async function draw() {
      const { items } = await api(endpoint);
      root.innerHTML = pageHead(title, sub, `<button class="btn" id="add" type="button">${noun} қосу</button>`) +
        `<div class="panel table-wrap">${items.length ? `<table class="data stack"><thead><tr>${columns.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr></thead><tbody>
        ${items.map((r) => `<tr>${columns.map((c) => `<td data-label="${c[1]}">${esc(r[c[0]])}</td>`).join('')}
          <td><div class="cell-actions"><button class="btn sm ghost" data-edit="${r.id}" type="button">Өңдеу</button>
          <button class="btn sm danger" data-rm="${r.id}" type="button">Жою</button></div></td></tr>`).join('')}</tbody></table>` : empty('Әзірге ештеңе жоқ', `«${noun} қосу» түймесін басыңыз`)}</div>`;
      $('#add').onclick = () => edit(null);
      $$('[data-edit]', root).forEach((b) => b.onclick = () => edit(items.find((r) => r.id == b.dataset.edit)));
      $$('[data-rm]', root).forEach((b) => b.onclick = async () => {
        if (!confirm('Жазбаны жою керек пе?')) return;
        try { await api(`${endpoint}/${b.dataset.rm}`, { method: 'DELETE' }); toast('Жойылды', 'ok'); draw(); }
        catch (e) { toast(e.message, 'error'); }
      });
    }
    function edit(row) {
      formModal(row ? `${noun}: өңдеу` : `${noun} қосу`,
        fields.map((f) => field(f.label, `<input type="${f.type}" name="${f.key}" ${f.min != null ? `min="${f.min}" max="${f.max}"` : ''} value="${esc(row?.[f.key] ?? '')}">`)).join(''),
        row ? 'Сақтау' : 'Қосу',
        async (form) => {
          const body = Object.fromEntries(fields.map((f) => [f.key, form[f.key].value]));
          await api(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? 'PUT' : 'POST', body });
          toast('Сақталды', 'ok'); draw();
        });
    }
    await draw();
  };
}

const viewGroups = crudView({
  title: 'Топтар', sub: 'Студенттер топтары', endpoint: '/admin/groups', noun: 'Топ',
  columns: [['name', 'Атауы'], ['specialty', 'Мамандық'], ['course', 'Курс']],
  fields: [{ key: 'name', label: 'Топ атауы', type: 'text' }, { key: 'specialty', label: 'Мамандық', type: 'text' }, { key: 'course', label: 'Курс (1–6)', type: 'number', min: 1, max: 6 }],
});

const viewSubjects = crudView({
  title: 'Пәндер', sub: 'Оқу пәндерінің тізімі', endpoint: '/admin/subjects', noun: 'Пән',
  columns: [['code', 'Коды'], ['name', 'Атауы'], ['credits', 'Кредит']],
  fields: [{ key: 'code', label: 'Пән коды', type: 'text' }, { key: 'name', label: 'Пән атауы', type: 'text' }, { key: 'credits', label: 'Кредит саны', type: 'number', min: 1, max: 20 }],
});

async function viewOfferings(root) {
  async function draw() {
    const { items } = await api('/admin/offerings');
    root.innerHTML = pageHead('Оқу жүктемесі', 'Қай оқытушы қай топқа қай пәнді жүргізеді', '<button class="btn" id="add" type="button">Жүктеме қосу</button>') +
      `<div class="panel table-wrap">${items.length ? `<table class="data stack"><thead><tr><th>Топ</th><th>Пән</th><th>Оқытушы</th><th>Семестр</th><th></th></tr></thead><tbody>
      ${items.map((o) => `<tr><td data-label="Топ">${esc(o.group_name)}</td><td data-label="Пән">${esc(o.subject)}</td><td data-label="Оқытушы">${esc(o.teacher)}</td><td data-label="Семестр">${esc(o.semester)}</td>
        <td><button class="btn sm danger" data-rm="${o.id}" type="button">Жою</button></td></tr>`).join('')}</tbody></table>` : empty('Жүктеме әзірге жоқ')}</div>`;
    $('#add').onclick = addModal;
    $$('[data-rm]', root).forEach((b) => b.onclick = async () => {
      if (!confirm('Жүктемені жойсаңыз, оның кестесі, тапсырмалары мен бағалары да жойылады. Жалғастыру керек пе?')) return;
      try { await api(`/admin/offerings/${b.dataset.rm}`, { method: 'DELETE' }); toast('Жойылды', 'ok'); draw(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }
  async function addModal() {
    const [subjects, groups, users] = await Promise.all([api('/admin/subjects'), api('/admin/groups'), api('/admin/users?role=teacher')]);
    if (!subjects.items.length || !groups.items.length || !users.items.length) return toast('Алдымен пән, топ және оқытушыны қосыңыз', 'error');
    formModal('Жүктеме қосу',
      field('Пән', `<select name="subject_id">${opts(subjects.items, 'id', (s) => s.name)}</select>`) +
      field('Оқытушы', `<select name="teacher_id">${opts(users.items, 'id', (t) => t.full_name)}</select>`) +
      field('Топ', `<select name="group_id">${opts(groups.items, 'id', (g) => g.name)}</select>`) +
      field('Семестр', '<input type="text" name="semester" value="2026-күз" maxlength="20">'),
      'Қосу',
      async (f) => {
        await api('/admin/offerings', { method: 'POST', body: { subject_id: f.subject_id.value, teacher_id: f.teacher_id.value, group_id: f.group_id.value, semester: f.semester.value } });
        toast('Жүктеме қосылды', 'ok'); draw();
      });
  }
  await draw();
}

const VIEWS = {
  student: { schedule: viewSchedule, assignments: viewAssignments, journal: viewJournal, profile: viewProfile },
  teacher: { profile: viewProfile, schedule: viewSchedule, assignments: viewAssignments, journal: viewJournal },
  admin: { profile: viewProfile, users: viewUsers, groups: viewGroups, subjects: viewSubjects, offerings: viewOfferings, schedule: viewSchedule },
};

/* ═══════════ Іске қосу ═══════════ */
(async function init() {
  if (!state.token) return renderLogin();
  try {
    state.user = (await api('/auth/me')).user;
    renderShell();
  } catch { renderLogin(); }
})();
