// CoParent Hub client. Plain ES modules, no build step.

// ---------- tiny DOM helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'multiple' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const $ = (sel, root = document) => root.querySelector(sel);
const clear = (el) => { el.replaceChildren(); return el; };
/** append, skipping null/false (Element.append would render them as text) */
const mount = (el, ...kids) => { el.append(...kids.flat(Infinity).filter(k => k != null && k !== false)); return el; };

async function api(method, path, body) {
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
  // Session expired mid-use: drop back to the sign-in screen (only if we thought we were signed in, to avoid a loop).
  if (res.status === 401 && S.me && !path.startsWith('/api/login')) { S.me = null; render(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}
const get = (p) => api('GET', p), post = (p, b) => api('POST', p, b || {}), put = (p, b) => api('PUT', p, b);

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message); throw e; }
}

function modal(title, body, { wide } = {}) {
  const root = $('#modal-root');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const box = h('div', { class: 'modal', style: wide ? 'width:min(860px,100%)' : '', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', { style: 'margin:0' }, title), h('button', { class: 'link', onclick: close, 'aria-label': 'Close' }, 'Close')),
    typeof body === 'function' ? body(close) : body);
  root.replaceChildren(h('div', { class: 'modal-back', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, box));
  const first = box.querySelector('input, select, textarea'); if (first) first.focus();
  return close;
}
function confirmBox(title, text, { okLabel = 'Confirm', withNote = false, noteRequired = false } = {}) {
  return new Promise(resolve => {
    const close = modal(title, (done) => {
      const note = withNote ? h('textarea', { placeholder: noteRequired ? 'Required' : 'Optional note (saved to the record)' }) : null;
      return h('div', null, h('p', null, text), note,
        h('div', { class: 'actions' },
          h('button', { class: 'primary', onclick: () => { if (noteRequired && !note.value.trim()) return toast('Add a note'); done(); resolve({ note: note ? note.value : '' }); } }, okLabel),
          h('button', { onclick: () => { done(); resolve(null); } }, 'Cancel')));
    });
    void close;
  });
}

// ---------- forms ----------
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', null, label), input, hint ? h('div', { class: 'small muted' }, hint) : null);
const inp = (name, attrs = {}) => h('input', { name, ...attrs });
function sel(name, options, value, attrs = {}) {
  return h('select', { name, ...attrs }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
}
function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.dataset.multi) { (out[el.name] ||= []); if (el.checked) out[el.name].push(el.value); continue; }
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.type !== 'file') out[el.name] = el.value;
  }
  return out;
}
const fileToPayload = (file) => new Promise((resolve, reject) => {
  if (!file) return resolve(null);
  if (file.size > 8 * 1024 * 1024) return reject(new Error('File must be under 8 MB'));
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', data: String(r.result).split(',')[1] });
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// ---------- state & formatting ----------
const S = { me: null };
const tz = () => S.me?.family?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const member = (id) => S.me?.members?.find(m => m.id === id);
const nameOf = (id) => member(id)?.name || 'Unassigned';
const colorOf = (id) => member(id)?.color || '#9aa4ab';
const parents = () => (S.me?.members || []).filter(m => m.role === 'parent');
const isParent = () => S.me?.role === 'parent';
const other = () => parents().find(p => p.id !== S.me.user.id);
const fmt = (ms, o) => new Intl.DateTimeFormat('en-US', { timeZone: tz(), ...o }).format(ms);
const fmtDT = (ms) => fmt(ms, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtT = (ms) => fmt(ms, { hour: 'numeric', minute: '2-digit' });
const fmtIso = (s) => (s ? fmtDT(Date.parse(s)) : '');
const money = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toFixed(2);
const pad = (n) => String(n).padStart(2, '0');
function todayLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.now()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const nowLocalStamp = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(Date.now()).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const dow = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmtDate = (s) => { const [y, m, d] = s.split('-').map(Number); return `${DAYS[dow(s)]}, ${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`; };
const localOf = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ms).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };

const STATUS = {
  active: ['Approved', 'ok'], unconfirmed: ['Not yet confirmed', 'warn'], pending: ['Awaiting approval', 'warn'], rejected: ['Rejected', 'bad'],
  withdrawn: ['Withdrawn', ''], retired: ['Ended', ''], proposed: ['Needs acknowledgement', 'warn'], accepted: ['Acknowledged', 'ok'], declined: ['Declined', 'bad'],
  cancelled: ['Cancelled', ''], logged: ['Record only', ''], requested: ['Reimbursement requested', 'warn'], approved: ['Approved, unpaid', 'ok'],
  disputed: ['Disputed', 'bad'], reimbursed: ['Reimbursed', 'ok'], sent: ['Sent, awaiting confirmation', 'warn'], confirmed: ['Received', 'ok'],
};
const badge = (s) => { const [t, c] = STATUS[s] || [s, '']; return h('span', { class: `badge ${c}` }, t); };
const parentDot = (id) => h('span', { class: 'dot', style: `background:${colorOf(id)}` });
const childNames = (ids) => (ids || []).map(id => S.me.children.find(c => c.id === id)?.name).filter(Boolean).join(', ');

function shareView(share) {
  if (!share?.byParent?.length) return h('p', { class: 'empty' }, 'No schedule yet.');
  return h('div', null,
    h('div', { class: 'share-bar', role: 'img', 'aria-label': share.byParent.map(p => `${p.name} ${p.pct}%`).join(', ') },
      share.byParent.map(p => h('div', { style: `width:${p.pct}%;background:${colorOf(p.parent)}`, title: `${p.name}: ${p.pct}%` }))),
    h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Parent'), h('th', { class: 'right' }, 'Time'), h('th', { class: 'right' }, 'Overnights'), h('th', { class: 'right' }, 'Hours'))),
      h('tbody', null, share.byParent.map(p => h('tr', null, h('td', null, h('span', { class: 'row', style: 'gap:6px' }, parentDot(p.parent), p.parent === S.me.user.id ? `${p.name} (you)` : p.name)),
        h('td', { class: 'right' }, `${p.pct}%`), h('td', { class: 'right' }, `${p.overnights} (${p.nightPct}%)`), h('td', { class: 'right' }, Math.round(p.hours)))))));
}

// ---------- notes (append-only, any record) ----------
function notesPanel(targetType, targetId) {
  const list = h('div', null, h('p', { class: 'muted small' }, 'Loading notes…'));
  const load = async () => {
    const notes = await get(`/api/notes?target_type=${targetType}&target_id=${encodeURIComponent(targetId)}`);
    mount(clear(list), notes.length ? h('div', null, notes.map(n => h('div', { class: 'note' }, n.body,
      n.attachment_hash ? h('div', null, h('a', { href: `/api/files/${n.attachment_hash}`, target: '_blank', rel: 'noopener' }, `Attachment: ${n.attachment_name}`)) : null,
      h('div', { class: 'meta' }, `${n.author_name} · ${fmtIso(n.created_at)}`)))) : h('p', { class: 'muted small' }, 'No notes yet.'));
  };
  load();
  if (!isParent()) return h('div', null, h('h3', null, 'Notes'), list);
  const ta = h('textarea', { placeholder: 'Stick to facts: what happened, when, who was there. Notes cannot be edited or deleted after saving.' });
  const file = h('input', { type: 'file', accept: 'image/*,application/pdf' });
  return h('div', null, h('h3', null, 'Notes'), list,
    field('Add a note', ta), field('Attachment (optional)', file),
    h('button', { onclick: async () => {
      if (!ta.value.trim()) return toast('Write a note first');
      await attempt(async () => post('/api/notes', { target_type: targetType, target_id: targetId, body: ta.value, attachment: await fileToPayload(file.files[0]) }), 'Note saved');
      ta.value = ''; file.value = ''; load();
    } }, 'Save note'));
}

// ---------- shell & routing ----------
const NAV = [
  ['dashboard', 'Home'], ['calendar', 'Calendar'], ['schedule', 'Custody schedule', 'rules'], ['activities', 'Activities', 'events'],
  ['expenses', 'Expenses', 'expenses+payments'], ['messages', 'Messages', 'messages'], ['calls', 'Calls & video', 'call_rules+calls'],
  ['exchanges', 'Exchanges'], ['sync', 'Calendar sync'], ['records', 'Records & reports'], ['settings', 'Settings'],
];
const VIEWS = {};
let pendingCounts = {};

async function render() {
  const app = $('#app');
  if (!S.me) {
    try { S.me = await get('/api/me'); if (!S.me?.user) S.me = null; } catch { S.me = null; }
  }
  if (!S.me) return renderAuth(app);
  if (!S.me.family) return renderSetup(app);
  const route = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'dashboard';
  const main = h('main');
  const side = h('nav', { class: 'side', 'aria-label': 'Main' },
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), 'CoParent Hub'),
    h('div', { class: 'nav' }, NAV.map(([k, label, countKey]) => {
      const n = countKey ? countKey.split('+').reduce((s, x) => s + (pendingCounts[x] || 0), 0) : 0;
      return h('a', { href: `#/${k}`, class: route === k ? 'on' : '', onclick: () => side.classList.remove('open') }, label, n ? h('span', { class: 'count' }, n) : null);
    })),
    h('div', { class: 'side-foot' }, h('div', null, S.me.user.name), h('div', { class: 'muted' }, S.me.family.name, S.me.role === 'viewer' ? ' · view only' : ''),
      h('button', { class: 'link', style: 'margin-top:6px', onclick: async () => { await post('/api/logout'); S.me = null; render(); } }, 'Sign out')));
  const menu = h('button', { class: 'menu-btn', style: 'margin-bottom:10px', onclick: () => side.classList.toggle('open') }, 'Menu');
  app.replaceChildren(h('div', { class: 'shell' }, side, h('div', null, h('div', { style: 'padding:0 16px' }, menu), main)));
  try { await (VIEWS[route] || VIEWS.dashboard)(main); } catch (e) { if (e.message !== 'Signed out') mount(main, h('div', { class: 'alert bad' }, e.message)); }
}
window.addEventListener('hashchange', () => { $('#modal-root').replaceChildren(); render(); });
async function refreshMe() { S.me = await get('/api/me'); }
const head = (title, sub, ...actions) => h('div', { class: 'page-head' }, h('div', null, h('h1', null, title), sub ? h('div', { class: 'muted' }, sub) : null), h('div', { class: 'row' }, actions));

// ---------- auth & setup ----------
function renderAuth(app) {
  let mode = 'login';
  const draw = () => {
    const form = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault();
      const v = formValues(form);
      await attempt(() => post(mode === 'login' ? '/api/login' : '/api/register', v));
      S.me = null; render();
    } },
      h('h1', null, mode === 'login' ? 'Sign in' : 'Create your account'),
      h('p', { class: 'muted' }, 'A shared, neutral record for co-parents: schedule, costs, messages and calls.'),
      mode === 'register' ? field('Your name', inp('name', { required: true, autocomplete: 'name' })) : null,
      field('Email', inp('email', { type: 'email', required: true, autocomplete: 'email' })),
      field('Password', inp('password', { type: 'password', required: true, minlength: mode === 'register' ? 10 : null, autocomplete: mode === 'login' ? 'current-password' : 'new-password' }), mode === 'register' ? 'At least 10 characters.' : null),
      h('button', { class: 'primary', type: 'submit' }, mode === 'login' ? 'Sign in' : 'Create account'),
      h('p', { class: 'small' }, mode === 'login' ? 'New here? ' : 'Have an account? ',
        h('button', { type: 'button', class: 'link', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; draw(); } }, mode === 'login' ? 'Create an account' : 'Sign in')));
    app.replaceChildren(h('div', { class: 'auth' }, form));
  };
  draw();
}

function renderSetup(app) {
  const kids = h('div');
  const addKid = () => kids.append(h('div', { class: 'fields' }, field('Child name', inp('kid_name')), field('Birthdate', inp('kid_bd', { type: 'date' }))));
  addKid();
  const create = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    const names = [...create.querySelectorAll('[name=kid_name]')].map(x => x.value);
    const bds = [...create.querySelectorAll('[name=kid_bd]')].map(x => x.value);
    const v = formValues(create);
    await attempt(() => post('/api/family', { name: v.name, timezone: v.timezone, children: names.map((n, i) => ({ name: n, birthdate: bds[i] })).filter(c => c.name.trim()) }));
    S.me = null; location.hash = '#/schedule'; render();
  } },
    h('h2', null, 'Start a new family space'),
    h('p', { class: 'muted small' }, 'You will get an invite code for your co-parent. You start as the primary (default) parent; your co-parent confirms or disputes that when they join.'),
    field('Family name', inp('name', { placeholder: 'e.g. The Smith kids' })),
    field('Time zone', inp('timezone', { value: Intl.DateTimeFormat().resolvedOptions().timeZone }), 'All schedule times use this zone.'),
    kids, h('button', { type: 'button', onclick: addKid }, '+ Another child'), ' ',
    h('button', { class: 'primary', type: 'submit' }, 'Create'));
  const join = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    await attempt(() => post('/api/family/join', formValues(join)));
    S.me = null; render();
  } }, h('h2', null, 'Join with an invite code'), h('p', { class: 'muted small' }, 'Co-parents, attorneys, mediators or step-parents (view-only) use a code from the other parent.'),
    field('Invite code', inp('code', { required: true, style: 'text-transform:uppercase' })), h('button', { class: 'primary', type: 'submit' }, 'Join'));
  app.replaceChildren(h('div', { style: 'max-width:760px;margin:6vh auto;padding:0 16px' }, h('h1', null, `Welcome, ${S.me.user.name}`),
    h('p', { class: 'muted' }, 'Set up your family space, or join the one your co-parent created.'), h('div', { class: 'grid' }, create, join),
    h('p', null, h('button', { class: 'link', onclick: async () => { await post('/api/logout'); S.me = null; render(); } }, 'Sign out'))));
}

// ---------- dashboard ----------
VIEWS.dashboard = async (main) => {
  const d = await get('/api/dashboard');
  pendingCounts = d.pending;
  const youOr = (id) => (id === S.me.user.id ? 'You' : nameOf(id));
  const totalPending = Object.entries(d.pending).filter(([k]) => k !== 'messages').reduce((s, [, n]) => s + n, 0);
  const nowP = d.now.parent;
  const items = [
    ['rules', 'schedule', 'custody schedule item(s) need your decision'], ['events', 'activities', 'activity change(s) to acknowledge'],
    ['expenses', 'expenses', 'expense(s) to approve or dispute'], ['payments', 'expenses', 'payment(s) to confirm you received'],
    ['call_rules', 'calls', 'call schedule(s) to approve'], ['calls', 'calls', 'call log(s) to confirm or dispute'], ['messages', 'messages', 'unread message(s)'],
  ].filter(([k]) => d.pending[k]);
  mount(main, 
    head(`Hi, ${S.me.user.name}`, fmtDate(todayLocal())),
    !other() ? h('div', { class: 'alert warn' }, 'Your co-parent has not joined yet. Share your invite code from ', h('a', { href: '#/settings' }, 'Settings'), '. Until they join, schedule items you add are marked "not yet confirmed".') : null,
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Right now the kids are with'),
        h('div', { class: 'big row', style: 'gap:8px' }, parentDot(nowP), nowP ? youOr(nowP) : 'No default set'),
        d.next_exchange ? h('div', null, 'Next exchange: ', h('b', null, fmtDT(d.next_exchange.at)), ` to ${nameOf(d.next_exchange.to)}`, h('div', { class: 'muted small' }, d.next_exchange.src.name)) : h('div', { class: 'muted' }, 'No exchanges in the next 60 days.')),
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Needs your attention'),
        items.length ? h('div', { class: 'list' }, items.map(([k, route, label]) => h('div', { class: 'item' }, h('a', { href: `#/${route}` }, `${d.pending[k]} ${label}`))))
          : h('p', { class: 'empty' }, totalPending ? '' : 'Nothing waiting on you.')),
      d.balance ? h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Reimbursement balance'),
        h('div', { class: 'big' }, d.balance.net_cents === 0 ? 'Even' : d.balance.net_cents > 0 ? `${nameOf(other()?.id)} owes you ${money(d.balance.net_cents)}` : `You owe ${money(-d.balance.net_cents)}`),
        h('div', { class: 'muted small' }, `Pending: ${money(d.balance.pending_to_me)} to you, ${money(d.balance.pending_from_me)} from you`), h('a', { href: '#/expenses' }, 'Expenses')) : null),
    h('div', { class: 'grid', style: 'margin-top:14px' },
      h('div', { class: 'card' }, h('h2', null, `Parenting time ${todayLocal().slice(0, 4)} (scheduled, full year)`), shareView(d.share_year),
        h('div', { class: 'muted small' }, 'Year to date: ', d.share_ytd.byParent.map(p => `${p.name} ${p.pct}%`).join(' · '))),
      h('div', { class: 'card' }, h('h2', null, 'Next 14 days'),
        d.upcoming.length ? h('div', { class: 'list' }, d.upcoming.map(e => h('div', { class: 'item' },
          h('div', { class: 'item-head' }, h('b', null, e.title), e.status === 'proposed' ? badge('proposed') : null),
          h('div', { class: 'small muted' }, fmtDT(e.start), e.location ? ` · ${e.location}` : '', ` · during ${nameOf(e.custody_parent)}'s time`, e.transport_parent ? ` · ${nameOf(e.transport_parent)} driving` : ''))))
          : h('p', { class: 'empty' }, 'No activities. ', h('a', { href: '#/activities' }, 'Add one')))),
    d.compliance.length ? h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', null, 'Calls this week'),
      d.compliance.map(c => h('div', null, h('b', null, c.rule.name), ` for ${c.rule.entitled}: ${c.totals.completed} of ${c.rule.period === 'week' ? c.totals.allowed : c.totals.allowed + ' (this ' + c.rule.period + ')'} completed`,
        c.totals.missed_not_facilitated + c.totals.missed_not_called ? h('span', { class: 'badge bad', style: 'margin-left:6px' }, `${c.totals.missed_not_facilitated + c.totals.missed_not_called} missed`) : null))) : null,
  );
  // re-render nav with counts
  const nav = $('.nav'); if (nav) for (const a of nav.querySelectorAll('a')) {
    const entry = NAV.find(([k]) => a.getAttribute('href') === `#/${k}`);
    const n = entry?.[2] ? entry[2].split('+').reduce((s, x) => s + (pendingCounts[x] || 0), 0) : 0;
    a.querySelector('.count')?.remove(); if (n) a.append(h('span', { class: 'count' }, n));
  }
};

// ---------- calendar ----------
let calMonth = null;
VIEWS.calendar = async (main) => {
  const today = todayLocal();
  calMonth ||= today.slice(0, 7);
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`;
  const gridStart = addDays(first, -dow(first));
  const gridEnd = addDays(gridStart, 42);
  const [tl, ev, rules] = await Promise.all([get(`/api/timeline?start=${gridStart}&end=${gridEnd}`), get(`/api/events?start=${gridStart}&end=${gridEnd}`), get('/api/rules')]);
  const go = (delta) => { const t = new Date(Date.UTC(y, m - 1 + delta, 1)); calMonth = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`; clear(main); VIEWS.calendar(main); };
  const cal = h('div', { class: 'cal' }, DAYS.map(d => h('div', { class: 'dow' }, d)));
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const segs = daySegments(tl.timeline, d);
    const evs = ev.events.filter(e => localOf(e.start).date === d);
    const ext = ev.external.filter(e => localOf(e.start_ms).date === d || (e.all_day && e.start_ms <= dayMs(d) && e.end_ms > dayMs(d)));
    const hol = segs.find(s => s.src.type === 'holiday' || s.src.type === 'override');
    cal.append(h('div', { class: `day${d.slice(0, 7) !== calMonth ? ' out' : ''}${d === today ? ' today' : ''}`, tabindex: '0', role: 'button', 'aria-label': fmtDate(d),
      onclick: () => dayModal(d, tl, ev, rules), onkeydown: (e) => { if (e.key === 'Enter') dayModal(d, tl, ev, rules); } },
      h('div', { class: 'strip' }, segs.map(s => h('div', { style: `flex:${s.frac};background:${colorOf(s.parent)}`, title: `${nameOf(s.parent)} ${s.label}` }))),
      h('span', { class: 'num' }, Number(d.slice(8))),
      hol ? h('div', { class: 'hol' }, hol.src.name) : null,
      evs.slice(0, 3).map(e => h('div', { class: `ev${e.status === 'proposed' ? ' proposed' : ''}`, style: `border-left:3px solid ${colorOf(e.transport_parent || e.custody_parent)}` }, `${fmtT(e.start)} ${e.title}`)),
      ext.slice(0, 2).map(e => h('div', { class: 'ev ext' }, e.all_day ? e.title : `${fmtT(e.start_ms)} ${e.title}`)),
      evs.length + ext.length > 5 ? h('div', { class: 'hol' }, `+${evs.length + ext.length - 5} more`) : null));
  }
  mount(main, head(`${MONTHS[m - 1]} ${y}`, 'Color bar = who has the kids. Click a day for details, notes or a change request.',
    h('button', { onclick: () => go(-1) }, '‹ Prev'), h('button', { onclick: () => { calMonth = today.slice(0, 7); clear(main); VIEWS.calendar(main); } }, 'Today'), h('button', { onclick: () => go(1) }, 'Next ›')),
    h('div', { class: 'legend', style: 'margin-bottom:10px' }, parents().map(p => h('span', null, parentDot(p.id), p.id === S.me.user.id ? `${p.name} (you)` : p.name)),
      h('span', null, h('span', { class: 'dot', style: 'border:1px dashed var(--muted)' }), 'From your synced calendars')),
    cal, h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', null, 'This month'), shareView(monthShare(tl, first, addDays(`${y}-${pad(m)}-01`, daysIn(y, m))))));
};
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function dayMs(d) {
  // local midnight in family tz -> UTC ms (approximate via formatter search)
  const [y, m, dd] = d.split('-').map(Number);
  let t = Date.UTC(y, m - 1, dd);
  for (let i = 0; i < 3; i++) { const l = localOf(t); const [ly, lm, ld] = l.date.split('-').map(Number); const [hh, mm] = l.time.split(':').map(Number); t -= (Date.UTC(ly, lm - 1, ld, hh, mm) - Date.UTC(y, m - 1, dd)); }
  return t;
}
function daySegments(timeline, d) {
  const a = dayMs(d), b = dayMs(addDays(d, 1));
  const out = [];
  for (const iv of timeline) {
    const s = Math.max(a, iv.start), e = Math.min(b, iv.end);
    if (e > s) out.push({ parent: iv.parent, frac: (e - s) / (b - a), src: iv.src, label: `${fmtT(s)}–${fmtT(e)}`, start: s, end: e });
  }
  return out;
}
function monthShare(tl, from, to) {
  const a = dayMs(from), b = dayMs(to); const hours = {};
  for (const iv of tl.timeline) { const s = Math.max(a, iv.start), e = Math.min(b, iv.end); if (e > s) hours[iv.parent] = (hours[iv.parent] || 0) + (e - s) / 3600000; }
  const total = Object.values(hours).reduce((x, y) => x + y, 0);
  const nights = {}; let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) { const t = dayMs(d) + 2 * 3600000; const iv = tl.timeline.find(x => x.start <= t && x.end > t); if (iv) { nights[iv.parent] = (nights[iv.parent] || 0) + 1; n++; } }
  return { byParent: Object.keys(hours).map(k => ({ parent: k === 'null' ? null : +k, name: nameOf(k === 'null' ? null : +k), hours: hours[k], pct: +(100 * hours[k] / total).toFixed(1), overnights: nights[k] || 0, nightPct: n ? +(100 * (nights[k] || 0) / n).toFixed(1) : 0 })) };
}

function dayModal(d, tl, ev, rules) {
  const segs = daySegments(tl.timeline, d);
  const evs = ev.events.filter(e => localOf(e.start).date === d);
  const ext = ev.external.filter(e => localOf(e.start_ms).date === d);
  modal(fmtDate(d), h('div', null,
    h('h3', null, 'Custody'),
    h('div', { class: 'list' }, segs.map(s => h('div', { class: 'item row' }, parentDot(s.parent), h('b', null, nameOf(s.parent)), h('span', null, s.label), h('span', { class: 'muted small' }, `· ${s.src.name}`)))),
    isParent() && other() ? h('button', { style: 'margin-top:8px', onclick: () => overrideForm({ start: `${d}T09:00`, end: `${d}T18:00` }) }, 'Request a change for this day') : null,
    h('h3', null, 'Activities'),
    evs.length ? h('div', { class: 'list' }, evs.map(e => h('div', { class: 'item' }, h('b', null, e.title), ' ', badge(e.status),
      h('div', { class: 'small muted' }, `${fmtT(e.start)}–${fmtT(e.end)}`, e.location ? ` · ${e.location}` : '', e.transport_parent ? ` · ${nameOf(e.transport_parent)} driving` : '')))) : h('p', { class: 'empty' }, 'None.'),
    ext.length ? h('div', null, h('h3', null, 'From synced calendars'), ext.map(e => h('div', { class: 'small' }, e.all_day ? 'All day' : `${fmtT(e.start_ms)}–${fmtT(e.end_ms)}`, ` ${e.title} `, h('span', { class: 'muted' }, `(${e.feed_name})`)))) : null,
    notesPanel('day', d)));
  void rules;
}

// ---------- custody schedule ----------
function ruleSummary(r) {
  const c = r.config;
  if (r.type === 'default') return `${nameOf(c.parent)} has the children by default whenever no other rule applies.`;
  if (r.type === 'pattern') {
    const names = { alternating_weekends: 'Alternating weekends', every_weekend: 'Every weekend', week_on_week_off: 'Week on / week off', '2-2-3': '2-2-3 rotation', '2-2-5-5': '2-2-5-5 rotation', '3-4-4-3': '3-4-4-3 rotation', custom: 'Custom cycle' };
    const segs = c.segments.map(s => `${nameOf(s.parent)}: day ${s.startDay + 1} ${s.startTime} → day ${s.endDay + 1} ${s.endTime}`).join('; ');
    return `${names[c.template] || 'Pattern'}, ${c.cycleDays}-day cycle starting ${fmtDate(c.anchorDate)}. ${segs}${c.effectiveFrom ? `. From ${c.effectiveFrom}` : ''}${c.effectiveTo ? ` until ${c.effectiveTo}` : ''}`;
  }
  if (r.type === 'holiday') {
    const rr = c.rule;
    const when = rr.type === 'fixed' ? `${MONTHS[rr.month - 1]} ${rr.day}` : rr.type === 'nth_weekday' ? `${rr.n === -1 ? 'last' : ['', '1st', '2nd', '3rd', '4th', '5th'][rr.n]} ${DAYS[rr.weekday]} of ${MONTHS[rr.month - 1]}`
      : rr.type === 'easter' ? 'Easter Sunday' : rr.type === 'range' ? `${MONTHS[rr.startMonth - 1]} ${rr.startDay} – ${MONTHS[rr.endMonth - 1]} ${rr.endDay}` : `${rr.startDate} – ${rr.endDate || rr.startDate}`;
    const off = (b) => (b.dayOffset === 0 ? '' : `${Math.abs(b.dayOffset)} day${Math.abs(b.dayOffset) > 1 ? 's' : ''} ${b.dayOffset < 0 ? 'before' : 'after'} `);
    const who = c.assignment.mode === 'fixed' ? nameOf(c.assignment.parent) : `${nameOf(c.assignment.evenYears)} in even years, ${nameOf(c.assignment.oddYears)} in odd years`;
    return `${when}. From ${off(c.start)}${c.start.time} to ${off(c.end)}${c.end.time}. ${who}.`;
  }
  if (r.type === 'override') return c.periods.map(p => `${nameOf(p.parent)}: ${p.start.replace('T', ' ')} → ${p.end.replace('T', ' ')}`).join('; ');
  return '';
}

VIEWS.schedule = async (main) => {
  const [rules, presets] = await Promise.all([get('/api/rules'), get('/api/holiday-presets')]);
  S.presets = presets;
  const me = S.me.user.id;
  const y = todayLocal().slice(0, 4);
  const shareBox = h('div');
  const range = h('div', { class: 'row' }, field('From', inp('s', { type: 'date', value: `${y}-01-01` })), field('To (exclusive)', inp('e', { type: 'date', value: `${+y + 1}-01-01` })));
  const loadShare = async () => { const [s, e] = range.querySelectorAll('input'); const t = await get(`/api/timeline?start=${s.value}&end=${e.value}`); mount(clear(shareBox), shareView(t.share)); };
  range.querySelectorAll('input').forEach(i => i.addEventListener('change', loadShare));
  loadShare();

  const needsMe = rules.filter(r => (['pending', 'unconfirmed'].includes(r.status) && r.requested_by !== me) || (r.retire_requested_by && r.retire_requested_by !== me));
  const mine = rules.filter(r => r.status === 'pending' && r.requested_by === me);
  const groups = [['default', 'Primary (background) parent'], ['pattern', 'Regular schedule'], ['holiday', 'Holidays & vacation periods'], ['override', 'One-time changes & swaps']];

  const ruleItem = (r) => h('div', { class: 'item' },
    h('div', { class: 'item-head' }, h('div', null, h('b', null, r.name), ' ', badge(r.status), r.retire_requested_by ? h('span', { class: 'badge warn', style: 'margin-left:4px' }, 'End requested') : null),
      h('span', { class: 'small muted' }, `Requested by ${r.requested_by_name}, ${fmtIso(r.requested_at)}`)),
    h('div', { class: 'small' }, ruleSummary(r)),
    r.reason ? h('div', { class: 'small muted' }, `Reason: ${r.reason}`) : null,
    r.decided_by ? h('div', { class: 'small muted' }, `${r.status === 'rejected' ? 'Rejected' : 'Approved'} by ${r.decided_by_name}, ${fmtIso(r.decided_at)}${r.decision_note ? ` — "${r.decision_note}"` : ''}`) : null,
    h('div', { class: 'actions' },
      isParent() && ['pending', 'unconfirmed'].includes(r.status) && r.requested_by !== me ? [
        h('button', { class: 'ok', onclick: () => decideRule(r, 'approve') }, r.status === 'unconfirmed' ? 'Confirm' : 'Approve'),
        h('button', { class: 'danger', onclick: () => decideRule(r, 'reject') }, r.status === 'unconfirmed' ? 'Dispute' : 'Reject'),
        h('button', { onclick: () => showImpact(r) }, 'See impact on time share')] : null,
      isParent() && r.status === 'pending' && r.requested_by === me ? h('button', { onclick: async () => { await attempt(() => post(`/api/rules/${r.id}/withdraw`), 'Withdrawn'); rerender(); } }, 'Withdraw') : null,
      isParent() && r.retire_requested_by && r.retire_requested_by !== me ? [
        h('button', { class: 'ok', onclick: async () => { const c = await confirmBox('End this rule?', `${nameOf(r.retire_requested_by)} asked to end "${r.name}".`, { okLabel: 'Approve ending', withNote: true }); if (c) { await attempt(() => post(`/api/rules/${r.id}/retire-decide`, { decision: 'approve', note: c.note })); rerender(); } } }, 'Approve ending'),
        h('button', { onclick: async () => { const c = await confirmBox('Keep this rule?', 'The rule stays in effect.', { okLabel: 'Keep it', withNote: true }); if (c) { await attempt(() => post(`/api/rules/${r.id}/retire-decide`, { decision: 'reject', note: c.note })); rerender(); } } }, 'Keep it')] : null,
      isParent() && ['active', 'unconfirmed'].includes(r.status) && !r.retire_requested_by && r.type !== 'default' ? h('button', { onclick: async () => {
        const c = await confirmBox('Request to end this rule', other() ? 'Your co-parent has to approve before it stops applying.' : 'It will stop applying now.', { okLabel: 'Request', withNote: true });
        if (c) { await attempt(() => post(`/api/rules/${r.id}/retire`, { note: c.note }), 'Requested'); rerender(); } } }, 'Request to end') : null,
      h('button', { onclick: () => modal(r.name, h('div', null, h('p', { class: 'small' }, ruleSummary(r)), notesPanel('rule', r.id))) }, 'Notes')));

  const rerender = () => { clear(main); VIEWS.schedule(main); };
  async function decideRule(r, decision) {
    const c = await confirmBox(decision === 'approve' ? `Approve "${r.name}"?` : `Reject "${r.name}"?`,
      decision === 'approve' ? 'Once approved it becomes part of the schedule. This is recorded with your name and the time.' : 'Your co-parent will see that you rejected it.', { okLabel: decision === 'approve' ? 'Approve' : 'Reject', withNote: true });
    if (!c) return;
    await attempt(() => post(`/api/rules/${r.id}/decide`, { decision, note: c.note }), decision === 'approve' ? 'Approved' : 'Rejected');
    rerender();
  }

  mount(main, 
    head('Custody schedule', 'Layers: primary parent (background) → regular schedule → holidays → one-time changes. Higher layers win.',
      isParent() ? [h('button', { onclick: () => patternForm() }, '+ Regular schedule'), h('button', { onclick: () => holidayForm() }, '+ Holiday / period'),
        h('button', { class: 'primary', onclick: () => overrideForm() }, 'Request a change / swap')] : null),
    needsMe.length ? h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('h2', null, 'Waiting for your decision'), h('div', { class: 'list' }, needsMe.map(ruleItem))) : null,
    mine.length ? h('div', { class: 'card' }, h('h2', null, 'Your requests awaiting the other parent'), h('div', { class: 'list' }, mine.map(ruleItem))) : null,
    h('div', { class: 'card' }, h('h2', null, 'Time share'), range, shareBox, h('p', { class: 'small muted' }, 'Based on approved rules (and not-yet-confirmed ones if your co-parent hasn\'t joined). Overnight = who has the children at 2:00 AM.')),
    groups.map(([type, label]) => {
      const list = rules.filter(r => r.type === type && ['active', 'unconfirmed'].includes(r.status));
      return h('div', { class: 'card' }, h('div', { class: 'item-head' }, h('h2', null, label),
        type === 'default' && isParent() ? h('button', { onclick: () => defaultForm() }, 'Change primary parent') : null),
        list.length ? h('div', { class: 'list' }, list.map(ruleItem)) : h('p', { class: 'empty' }, type === 'pattern' ? 'No regular schedule. The primary parent has the children all the time.' : 'None.'));
    }),
    h('details', { class: 'card' }, h('summary', null, 'History (rejected, withdrawn, ended)'), h('div', { class: 'list' }, rules.filter(r => ['rejected', 'withdrawn', 'retired'].includes(r.status)).map(ruleItem))),
  );
};

async function showImpact(r) {
  const close = modal(`Impact: ${r.name}`, h('p', { class: 'muted' }, 'Calculating next 12 months…'));
  const d = await get(`/api/rules/${r.id}/impact`);
  close();
  modal(`Impact: ${r.name}`, h('div', null, h('p', { class: 'small muted' }, `${d.start} to ${d.end}`),
    h('h3', null, 'Without this rule'), shareView(d.before), h('h3', null, 'With this rule'), shareView(d.after)));
}

const parentOpts = () => parents().map(p => [p.id, p.id === S.me.user.id ? `${p.name} (you)` : p.name]);
const afterSave = () => { $('#modal-root').replaceChildren(); render(); };

function defaultForm() {
  modal('Primary (background) parent', (close) => {
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = formValues(form);
      await attempt(() => post('/api/rules', { type: 'default', name: 'Primary custodial parent', config: { parent: +v.parent }, reason: v.reason }), other() ? 'Sent for approval' : 'Saved'); close(); afterSave(); } },
      h('p', { class: 'small muted' }, 'The primary parent has the children whenever no regular schedule, holiday or change applies.'),
      field('Primary parent', sel('parent', parentOpts(), S.me.primary)), field('Reason', h('textarea', { name: 'reason', placeholder: 'e.g. Per custody order dated…' })),
      h('button', { class: 'primary', type: 'submit' }, other() ? 'Send for approval' : 'Save'));
    return form;
  });
}

function patternForm() {
  modal('Regular schedule', (close) => {
    const ps = parentOpts();
    const primary = S.me.primary || ps[0]?.[0];
    const nonPrimary = ps.find(p => p[0] !== primary)?.[0] ?? primary;
    const today = todayLocal();
    const nextFri = addDays(today, (5 - dow(today) + 7) % 7);
    const nextMon = addDays(today, (1 - dow(today) + 7) % 7);
    const customBox = h('div');
    const preview = h('div');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault();
      await attempt(() => post('/api/rules', { type: 'pattern', name: form.elements.name.value || undefined, reason: form.elements.reason.value, template: buildTemplate() }), other() ? 'Sent for approval' : 'Saved');
      close(); afterSave(); } });
    const tpl = sel('template', [['alternating_weekends', 'Alternating weekends'], ['every_weekend', 'Every weekend'], ['week_on_week_off', 'Week on / week off'], ['2-2-3', '2-2-3 rotation (50/50)'], ['2-2-5-5', '2-2-5-5 rotation (50/50)'], ['3-4-4-3', '3-4-4-3 rotation (50/50)'], ['custom', 'Custom cycle (pick each day)']], 'alternating_weekends');
    const anchor = inp('anchorDate', { type: 'date', value: nextFri, required: true });
    const hint = h('div', { class: 'small muted' });
    const labelA = h('label'), labelB = h('label');
    const pA = sel('parentA', ps, primary), pB = sel('parentB', ps, nonPrimary);
    const midweek = h('div', { class: 'fields' }, h('label', { class: 'check' }, inp('midweek', { type: 'checkbox' }), 'Add a weekly Wednesday visit'), field('Visit from', inp('midweekStart', { type: 'time', value: '17:00' })), field('Visit until', inp('midweekEnd', { type: 'time', value: '20:00' })));
    const weekendTimes = h('div', { class: 'fields' }, field('Weekend starts (Fri)', inp('weekendStart', { type: 'time', value: '18:00' })), field('Weekend ends (Sun)', inp('weekendEnd', { type: 'time', value: '18:00' })));
    const exch = field('Exchange time', inp('exchangeTime', { type: 'time', value: '18:00' }), 'Hand-offs happen at this time on changeover days.');
    const cycleLen = inp('cycleDays', { type: 'number', min: 1, max: 56, value: 14 });
    function drawCustom() {
      const n = Math.max(1, Math.min(56, +cycleLen.value || 14));
      const start = anchor.value || today;
      mount(clear(customBox), field('Cycle length (days)', cycleLen), h('div', { class: 'custom-days' }, Array.from({ length: n }, (_, i) => h('div', null, h('div', { class: 'small muted' }, `${DAYS[dow(addDays(start, i))]} ${i + 1}`),
        sel(`day${i}`, [['', 'Default'], ...ps], customBox.dataset[`d${i}`] ?? '', { onchange: (e) => { customBox.dataset[`d${i}`] = e.target.value; } })))));
    }
    cycleLen.addEventListener('change', drawCustom);
    function buildTemplate() {
      const v = formValues(form);
      const t = { template: v.template, anchorDate: v.anchorDate, parentA: +v.parentA, parentB: +v.parentB, exchangeTime: v.exchangeTime, effectiveFrom: v.effectiveFrom || null, effectiveTo: v.effectiveTo || null, options: {} };
      if (['alternating_weekends', 'every_weekend'].includes(v.template)) Object.assign(t.options, { weekendStart: v.weekendStart, weekendEnd: v.weekendEnd, midweek: v.midweek, midweekStart: v.midweekStart, midweekEnd: v.midweekEnd });
      if (v.template === 'custom') { const n = +cycleLen.value; t.options.days = Array.from({ length: n }, (_, i) => (v[`day${i}`] ? +v[`day${i}`] : null)); }
      return t;
    }
    function sync() {
      const t = tpl.value;
      const weekend = ['alternating_weekends', 'every_weekend'].includes(t);
      labelA.textContent = weekend ? 'Weekday parent (usually the primary)' : 'Parent A (starts the cycle)';
      labelB.textContent = weekend ? 'Weekend parent' : 'Parent B';
      pA.parentElement.style.display = t === 'custom' ? 'none' : '';
      pB.parentElement.style.display = t === 'custom' ? 'none' : '';
      weekendTimes.style.display = weekend ? '' : 'none';
      midweek.style.display = t === 'alternating_weekends' ? '' : 'none';
      exch.style.display = weekend ? 'none' : '';
      customBox.style.display = t === 'custom' ? '' : 'none';
      hint.textContent = weekend ? 'Pick the Friday that starts the first weekend parent\'s weekend.' : t === 'custom' ? 'Day 1 of the cycle.' : 'Pick the Monday the cycle starts (Parent A\'s first day).';
      if (weekend && dow(anchor.value) !== 5) anchor.value = nextFri;
      if (!weekend && t !== 'custom' && dow(anchor.value) !== 1) anchor.value = nextMon;
      if (t === 'custom') drawCustom();
    }
    tpl.addEventListener('change', sync);
    form.append(
      field('Name', inp('name', { placeholder: 'e.g. School-year schedule' })),
      field('Pattern', tpl),
      h('div', { class: 'field' }, h('label', null, 'Cycle starts on'), anchor, hint),
      h('div', { class: 'fields' }, h('div', { class: 'field' }, labelA, pA), h('div', { class: 'field' }, labelB, pB)),
      weekendTimes, midweek, exch, customBox,
      h('div', { class: 'fields' }, field('Effective from (optional)', inp('effectiveFrom', { type: 'date' })), field('Effective until (optional)', inp('effectiveTo', { type: 'date' }), 'e.g. end of school year')),
      field('Reason / order reference', h('textarea', { name: 'reason', placeholder: 'e.g. Per stipulated order, section 3' })),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async () => {
        const start = anchor.value;
        const r = await attempt(() => post('/api/schedule/preview', { type: 'pattern', template: buildTemplate(), start, end: addDays(start, 28) }));
        mount(clear(preview), h('h3', null, 'Next 4 weeks'), h('div', { class: 'seg-preview' }, r.timeline.map(iv => h('div', { style: `flex:${iv.end - iv.start};background:${colorOf(iv.parent)}`, title: `${nameOf(iv.parent)}: ${fmtDT(iv.start)} → ${fmtDT(iv.end)}` }))), shareView(r.share));
      } }, 'Preview'), h('button', { class: 'primary', type: 'submit' }, other() ? 'Send for approval' : 'Save')),
      preview);
    sync();
    return form;
  }, { wide: true });
}

function holidayForm() {
  modal('Holiday or vacation period', (close) => {
    const ps = parentOpts();
    const ruleBox = h('div');
    const assignBox = h('div');
    const form = h('form', { onsubmit: async (e) => { e.preventDefault();
      const v = formValues(form);
      const rule = { type: v.rtype };
      if (v.rtype === 'fixed') Object.assign(rule, { month: +v.month, day: +v.day });
      if (v.rtype === 'nth_weekday') Object.assign(rule, { month: +v.month, weekday: +v.weekday, n: +v.n });
      if (v.rtype === 'range') Object.assign(rule, { startMonth: +v.startMonth, startDay: +v.startDay, endMonth: +v.endMonth, endDay: +v.endDay });
      if (v.rtype === 'once') Object.assign(rule, { startDate: v.startDate, endDate: v.endDate || v.startDate });
      const assignment = v.mode === 'fixed' ? { mode: 'fixed', parent: +v.parent } : { mode: 'alternate', evenYears: +v.evenYears, oddYears: +v.oddYears };
      await attempt(() => post('/api/rules', { type: 'holiday', name: v.name, reason: v.reason, priority: +v.priority || 0,
        config: { rule, start: { dayOffset: -(+v.startBefore || 0), time: v.startTime }, end: { dayOffset: +v.endAfter || 0, time: v.endTime }, assignment } }), other() ? 'Sent for approval' : 'Saved');
      close(); afterSave(); } });
    const preset = sel('preset', [['', 'Custom…'], ...S.presets.map(p => [p.key, p.name])], '');
    const rtype = sel('rtype', [['fixed', 'Same date every year'], ['nth_weekday', 'Nth weekday of a month'], ['easter', 'Easter'], ['range', 'Date range every year (e.g. summer)'], ['once', 'One-time dates (e.g. this year\'s spring break)']], 'fixed');
    const monthOpts = MONTHS.map((m, i) => [i + 1, m]);
    const drawRule = (r = {}) => {
      const t = rtype.value;
      clear(ruleBox);
      if (t === 'fixed') ruleBox.append(h('div', { class: 'fields' }, field('Month', sel('month', monthOpts, r.month || 1)), field('Day', inp('day', { type: 'number', min: 1, max: 31, value: r.day || 1 }))));
      if (t === 'nth_weekday') ruleBox.append(h('div', { class: 'fields' }, field('Which', sel('n', [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [-1, 'Last']], r.n || 1)), field('Weekday', sel('weekday', DAYS.map((d, i) => [i, d]), r.weekday ?? 1)), field('Month', sel('month', monthOpts, r.month || 1))));
      if (t === 'range') ruleBox.append(h('div', { class: 'fields' }, field('Start month', sel('startMonth', monthOpts, r.startMonth || 6)), field('Start day', inp('startDay', { type: 'number', min: 1, max: 31, value: r.startDay || 15 })), field('End month', sel('endMonth', monthOpts, r.endMonth || 8)), field('End day', inp('endDay', { type: 'number', min: 1, max: 31, value: r.endDay || 15 }))));
      if (t === 'once') ruleBox.append(h('div', { class: 'fields' }, field('Start date', inp('startDate', { type: 'date', required: true })), field('End date', inp('endDate', { type: 'date' }))));
    };
    rtype.addEventListener('change', () => drawRule());
    preset.addEventListener('change', () => {
      const p = S.presets.find(x => x.key === preset.value); if (!p) return;
      form.elements.name.value = p.name; rtype.value = p.rule.type; drawRule(p.rule);
      const isRange = p.rule.type === 'range';
      form.elements.startTime.value = isRange ? '18:00' : p.key === 'thanksgiving' ? '18:00' : '09:00';
      form.elements.endTime.value = isRange ? '18:00' : p.key === 'thanksgiving' ? '18:00' : '19:00';
      form.elements.startBefore.value = p.key === 'thanksgiving' ? 1 : 0;
      form.elements.endAfter.value = p.key === 'thanksgiving' ? 3 : 0;
      form.elements.priority.value = isRange ? -10 : 0;
    });
    const mode = sel('mode', [['alternate', 'Alternate by year'], ['fixed', 'Always the same parent']], 'alternate');
    const drawAssign = () => mount(clear(assignBox), mode.value === 'fixed' ? field('Parent', sel('parent', ps, ps[0]?.[0]))
      : h('div', { class: 'fields' }, field('Even years (2026, 2028…)', sel('evenYears', ps, ps[0]?.[0])), field('Odd years (2027, 2029…)', sel('oddYears', ps, ps[1]?.[0] ?? ps[0]?.[0]))));
    mode.addEventListener('change', drawAssign);
    form.append(
      field('Start from a common holiday', preset),
      field('Name', inp('name', { required: true })),
      field('Date rule', rtype), ruleBox,
      h('div', { class: 'fields' }, field('Starts (days before)', inp('startBefore', { type: 'number', min: 0, max: 30, value: 0 })), field('at', inp('startTime', { type: 'time', value: '09:00' })),
        field('Ends (days after)', inp('endAfter', { type: 'number', min: 0, max: 30, value: 0 })), field('at', inp('endTime', { type: 'time', value: '19:00' }))),
      h('p', { class: 'small muted', style: 'margin-top:-6px' }, 'Example: Thanksgiving Wed 6pm to Sun 6pm = starts 1 day before at 18:00, ends 3 days after at 18:00.'),
      field('Who has the children', mode), assignBox,
      field('Priority', inp('priority', { type: 'number', value: 0 }), 'When two holidays overlap (Christmas Day inside Winter Break), higher wins. Periods default to -10.'),
      field('Reason / order reference', h('textarea', { name: 'reason' })),
      h('button', { class: 'primary', type: 'submit' }, other() ? 'Send for approval' : 'Save'));
    drawRule(); drawAssign();
    return form;
  }, { wide: true });
}

function overrideForm(prefill = {}) {
  modal('Request a schedule change', (close) => {
    const ps = parentOpts();
    const periods = h('div');
    const addPeriod = (p = {}) => periods.append(h('div', { class: 'fields card', style: 'padding:10px;margin-bottom:8px' },
      field('Children with', sel('p_parent', ps, p.parent ?? S.me.user.id)), field('From', inp('p_start', { type: 'datetime-local', value: p.start || '', required: true })), field('Until', inp('p_end', { type: 'datetime-local', value: p.end || '', required: true }))));
    addPeriod(prefill);
    const form = h('form', { onsubmit: async (e) => { e.preventDefault();
      const ps2 = [...periods.children].map(row => ({ parent: +row.querySelector('[name=p_parent]').value, start: row.querySelector('[name=p_start]').value, end: row.querySelector('[name=p_end]').value }));
      await attempt(() => post('/api/rules', { type: 'override', name: form.elements.name.value || 'Schedule change', reason: form.elements.reason.value, config: { periods: ps2 } }), other() ? 'Sent to your co-parent for approval' : 'Saved');
      close(); afterSave(); } },
      h('p', { class: 'small muted' }, 'Nothing changes until your co-parent approves. Add a second period to offer make-up time for a swap.'),
      field('Title', inp('name', { placeholder: 'e.g. Swap weekend of the 12th' })), periods,
      h('button', { type: 'button', onclick: () => addPeriod({ parent: other()?.id }) }, '+ Add make-up / swap period'),
      field('Reason', h('textarea', { name: 'reason', required: true, placeholder: 'Brief and specific: e.g. "Work trip Dec 11–13. Offering Dec 18–20 in exchange."' })),
      h('button', { class: 'primary', type: 'submit' }, other() ? 'Send request' : 'Save'));
    return form;
  }, { wide: true });
}

// ---------- activities ----------
VIEWS.activities = async (main) => {
  const today = todayLocal();
  const { events } = await get(`/api/events?start=${today}&end=${addDays(today, 90)}`);
  const me = S.me.user.id;
  const series = new Map();
  for (const e of events) if (!series.has(e.id)) series.set(e.id, e);
  const pending = [...series.values()].filter(e => e.status === 'proposed' && e.created_by !== me);
  const byDate = new Map();
  for (const e of events) { const d = localOf(e.start).date; if (!byDate.has(d)) byDate.set(d, []); byDate.get(d).push(e); }
  const rerender = () => { clear(main); VIEWS.activities(main); };
  const item = (e, showDate) => h('div', { class: 'item' },
    h('div', { class: 'item-head' }, h('div', null, h('b', null, e.title), ' ', badge(e.status), e.recurrence ? h('span', { class: 'badge', style: 'margin-left:4px' }, 'Repeats') : null),
      h('span', { class: 'small' }, showDate ? fmtDT(e.start) : `${fmtT(e.start)}–${fmtT(e.end)}`)),
    h('div', { class: 'small muted' }, [childNames(e.child_ids), e.location, `during ${nameOf(e.custody_parent)}'s time`, e.transport_parent ? `${nameOf(e.transport_parent)} driving` : 'No driver set', e.cost_cents ? money(e.cost_cents) : null].filter(Boolean).join(' · ')),
    e.custody_parent && e.transport_parent && e.custody_parent !== e.transport_parent ? h('div', { class: 'small', style: 'color:var(--warn)' }, `Note: driver differs from the parent with custody.`) : null,
    e.response_note ? h('div', { class: 'small muted' }, `Response: "${e.response_note}"`) : null,
    h('div', { class: 'actions' },
      isParent() && e.status === 'proposed' && e.created_by !== me ? [
        h('button', { class: 'ok', onclick: async () => { const c = await confirmBox('Acknowledge activity', `"${e.title}"${e.recurrence ? ' (all repeats)' : ''}`, { okLabel: 'Acknowledge', withNote: true }); if (c) { await attempt(() => post(`/api/events/${e.id}/respond`, { response: 'accepted', note: c.note })); rerender(); } } }, 'Acknowledge'),
        h('button', { class: 'danger', onclick: async () => { const c = await confirmBox('Decline activity', 'Say why, briefly.', { okLabel: 'Decline', withNote: true, noteRequired: true }); if (c) { await attempt(() => post(`/api/events/${e.id}/respond`, { response: 'declined', note: c.note })); rerender(); } } }, 'Decline')] : null,
      isParent() ? h('button', { onclick: () => eventForm(e) }, 'Edit') : null,
      isParent() && e.recurrence ? h('button', { onclick: async () => { if (await confirmBox('Cancel this date only?', fmtDT(e.start))) { await attempt(() => post(`/api/events/${e.id}/cancel`, { date: e.instance_date })); rerender(); } } }, 'Skip this date') : null,
      isParent() ? h('button', { class: 'danger', onclick: async () => { if (await confirmBox('Cancel activity?', e.recurrence ? 'All future dates will be cancelled.' : '')) { await attempt(() => post(`/api/events/${e.id}/cancel`, {})); rerender(); } } }, e.recurrence ? 'Cancel series' : 'Cancel') : null,
      isParent() ? h('button', { onclick: () => expenseForm({ description: e.title, event_id: e.id, amount: e.cost_cents ? e.cost_cents / 100 : '', child_ids: e.child_ids }) }, 'Log a cost') : null,
      h('button', { onclick: () => modal(e.title, notesPanel('event', e.id)) }, `Notes${e.note_count ? ` (${e.note_count})` : ''}`)));
  mount(main, head('Activities & appointments', 'Sports, lessons, school events, doctor visits. Each one shows whose custody time it falls in and who is driving.', isParent() ? h('button', { class: 'primary', onclick: () => eventForm() }, '+ Add activity') : null),
    pending.length ? h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('h2', null, 'Needs your acknowledgement'), h('div', { class: 'list' }, pending.map(e => item(e, true)))) : null,
    h('div', { class: 'card' }, h('h2', null, 'Next 90 days'), byDate.size ? [...byDate.entries()].map(([d, list]) => h('div', null, h('h3', null, fmtDate(d)), h('div', { class: 'list' }, list.map(e => item(e))))) : h('p', { class: 'empty' }, 'Nothing scheduled.')));
};

function eventForm(ex) {
  modal(ex ? 'Edit activity' : 'Add activity', (close) => {
    const [sd, st] = ex ? [ex.start_local.split('T')[0], ex.start_local.split('T')[1]] : [todayLocal(), '16:00'];
    const et = ex ? ex.end_local.split('T')[1] : '17:00';
    const rec = ex?.recurrence || {};
    const form = h('form', { onsubmit: async (e) => { e.preventDefault();
      const v = formValues(form);
      const body = { title: v.title, category: v.category, child_ids: (v.kids || []).map(Number), start: `${v.date}T${v.startTime}`, end: `${v.date}T${v.endTime}`, location: v.location,
        transport_parent: v.transport_parent ? +v.transport_parent : null, details: v.details, cost: v.cost || null,
        recurrence: v.freq ? { freq: v.freq, interval: +v.interval || 1, byday: (v.byday || []).map(Number), until: v.until || null, exdates: rec.exdates || [] } : null };
      await attempt(() => (ex ? put(`/api/events/${ex.id}`, body) : post('/api/events', body)), other() ? 'Saved, sent to co-parent to acknowledge' : 'Saved');
      close(); afterSave(); } },
      field('Title', inp('title', { required: true, value: ex?.title || '', placeholder: 'e.g. Soccer practice' })),
      h('div', { class: 'fields' }, field('Type', sel('category', [['activity', 'Activity / sport'], ['school', 'School'], ['medical', 'Medical / dental'], ['therapy', 'Therapy / counseling'], ['social', 'Party / social'], ['travel', 'Travel'], ['other', 'Other']], ex?.category)),
        field('Who is driving', sel('transport_parent', [['', 'Not decided'], ...parentOpts()], ex?.transport_parent ?? ''))),
      h('div', { class: 'field' }, h('label', null, 'Children'), h('div', { class: 'row' }, S.me.children.map(c => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'kids', 'data-multi': '1', value: c.id, checked: ex ? ex.child_ids.includes(c.id) : true }), c.name)))),
      h('div', { class: 'fields' }, field('Date', inp('date', { type: 'date', value: sd, required: true })), field('Start', inp('startTime', { type: 'time', value: st, required: true })), field('End', inp('endTime', { type: 'time', value: et, required: true }))),
      h('div', { class: 'fields' }, field('Repeats', sel('freq', [['', 'Does not repeat'], ['weekly', 'Weekly'], ['daily', 'Daily'], ['monthly', 'Monthly (same date)']], rec.freq || '')), field('Every N', inp('interval', { type: 'number', min: 1, max: 8, value: rec.interval || 1 })), field('Until', inp('until', { type: 'date', value: rec.until || '' }))),
      h('div', { class: 'field' }, h('label', null, 'Weekly on'), h('div', { class: 'row' }, DAYS.map((d, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'byday', 'data-multi': '1', value: i, checked: (rec.byday || []).includes(i) }), d)))),
      h('div', { class: 'fields' }, field('Location', inp('location', { value: ex?.location || '' })), field('Cost (optional)', inp('cost', { type: 'number', step: '0.01', min: 0, value: ex?.cost_cents ? ex.cost_cents / 100 : '' }))),
      field('Details', h('textarea', { name: 'details', value: ex?.details || '', placeholder: 'What to bring, coach contact, uniform…' })),
      h('button', { class: 'primary', type: 'submit' }, 'Save'));
    return form;
  }, { wide: true });
}

// ---------- expenses ----------
VIEWS.expenses = async (main) => {
  const [exps, pays, bal] = await Promise.all([get('/api/expenses'), get('/api/payments'), get('/api/balance')]);
  const me = S.me.user.id, co = other();
  const rerender = () => { clear(main); VIEWS.expenses(main); };
  const needMe = exps.filter(e => e.status === 'requested' && e.paid_by !== me);
  const payToConfirm = pays.filter(p => p.status === 'sent' && p.to_user === me);
  const row = (e) => h('div', { class: 'item' },
    h('div', { class: 'item-head' }, h('div', null, h('b', null, e.description), ' ', badge(e.status)), h('b', null, money(e.amount_cents))),
    h('div', { class: 'small muted' }, [e.date, e.category, childNames(e.child_ids), `paid by ${nameOf(e.paid_by)}`, `${e.paid_by === me ? nameOf(co?.id) : 'your'} share ${e.other_share_pct}% = ${money(e.owed_cents)}`].filter(Boolean).join(' · ')),
    e.decision_note ? h('div', { class: 'small muted' }, `Response: "${e.decision_note}"`) : null,
    h('div', { class: 'actions' },
      e.receipt_hash ? h('a', { class: 'btn', href: `/api/files/${e.receipt_hash}`, target: '_blank', rel: 'noopener' }, 'Receipt') : h('span', { class: 'badge' }, 'No receipt'),
      isParent() && e.paid_by !== me && ['requested', 'disputed'].includes(e.status) ? [
        h('button', { class: 'ok', onclick: async () => { const c = await confirmBox('Approve reimbursement', `You agree to pay ${money(e.owed_cents)} for "${e.description}".`, { okLabel: 'Approve', withNote: true }); if (c) { await attempt(() => post(`/api/expenses/${e.id}/decide`, { decision: 'approve', note: c.note })); rerender(); } } }, 'Approve'),
        e.status !== 'disputed' ? h('button', { class: 'danger', onclick: async () => { const c = await confirmBox('Dispute expense', 'Explain specifically what you disagree with (amount, necessity, prior agreement).', { okLabel: 'Dispute', withNote: true, noteRequired: true }); if (c) { await attempt(() => post(`/api/expenses/${e.id}/decide`, { decision: 'dispute', note: c.note })); rerender(); } } }, 'Dispute') : null] : null,
      isParent() && e.paid_by === me && e.status === 'logged' && co ? h('button', { onclick: async () => { await attempt(() => post(`/api/expenses/${e.id}/request`), 'Requested'); rerender(); } }, 'Request reimbursement') : null,
      h('button', { onclick: () => modal(e.description, notesPanel('expense', e.id)) }, `Notes${e.note_count ? ` (${e.note_count})` : ''}`)));

  mount(main, head('Expenses & reimbursement', 'Log shared costs with receipts. The other parent approves or disputes; payments are confirmed by the recipient.',
    isParent() ? [co ? h('button', { onclick: () => paymentForm(exps.filter(e => e.status === 'approved' && e.paid_by !== me)) }, 'Record a payment I sent') : null, h('button', { class: 'primary', onclick: () => expenseForm() }, '+ Add expense')] : null),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Approved balance'), h('div', { class: 'big' }, bal.net_cents === 0 ? 'Even' : bal.net_cents > 0 ? `${nameOf(co?.id)} owes you ${money(bal.net_cents)}` : `You owe ${money(-bal.net_cents)}`)),
      h('div', { class: 'card' }, h('div', { class: 'muted small' }, 'Awaiting approval'), h('div', null, `To you: ${money(bal.pending_to_me)}`), h('div', null, `From you: ${money(bal.pending_from_me)}`), bal.disputed_cents ? h('div', { style: 'color:var(--bad)' }, `Disputed: ${money(bal.disputed_cents)}`) : null)),
    payToConfirm.length ? h('div', { class: 'card', style: 'border-color:var(--warn);margin-top:14px' }, h('h2', null, 'Did you receive these payments?'), h('div', { class: 'list' }, payToConfirm.map(p => h('div', { class: 'item' },
      h('div', { class: 'item-head' }, h('b', null, `${money(p.amount_cents)} from ${nameOf(p.from_user)}`), h('span', { class: 'small muted' }, `${p.date} · ${p.method || 'method not given'}`)), p.note ? h('div', { class: 'small' }, p.note) : null,
      h('div', { class: 'actions' }, h('button', { class: 'ok', onclick: async () => { await attempt(() => post(`/api/payments/${p.id}/confirm`, { received: true }), 'Confirmed'); rerender(); } }, 'Yes, received'),
        h('button', { class: 'danger', onclick: async () => { const c = await confirmBox('Not received?', 'This is recorded as disputed.', { withNote: true }); if (c) { await attempt(() => post(`/api/payments/${p.id}/confirm`, { received: false, note: c.note })); rerender(); } } }, 'Not received')))))) : null,
    needMe.length ? h('div', { class: 'card', style: 'border-color:var(--warn);margin-top:14px' }, h('h2', null, 'Waiting for your approval'), h('div', { class: 'list' }, needMe.map(row))) : null,
    h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', null, 'All expenses'), exps.length ? h('div', { class: 'list' }, exps.map(row)) : h('p', { class: 'empty' }, 'No expenses yet.')),
    h('div', { class: 'card' }, h('h2', null, 'Payments'), pays.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Date', 'From', 'To', 'Amount', 'Method', 'Status'].map(x => h('th', null, x)))),
      h('tbody', null, pays.map(p => h('tr', null, h('td', null, p.date), h('td', null, nameOf(p.from_user)), h('td', null, nameOf(p.to_user)), h('td', null, money(p.amount_cents)), h('td', null, p.method), h('td', null, badge(p.status))))))) : h('p', { class: 'empty' }, 'No payments recorded.')));
};

function expenseForm(pre = {}) {
  modal('Add expense', (close) => {
    const file = h('input', { type: 'file', name: 'receipt', accept: 'image/*,application/pdf' });
    const form = h('form', { onsubmit: async (e) => { e.preventDefault();
      const v = formValues(form);
      await attempt(async () => post('/api/expenses', { description: v.description, category: v.category, amount: v.amount, date: v.date, child_ids: (v.kids || []).map(Number), other_share_pct: +v.share,
        request_reimbursement: v.request, event_id: pre.event_id || null, receipt: await fileToPayload(file.files[0]) }), 'Expense saved');
      close(); afterSave(); } },
      field('What was it for', inp('description', { required: true, value: pre.description || '' })),
      h('div', { class: 'fields' }, field('Amount ($)', inp('amount', { type: 'number', step: '0.01', min: '0.01', required: true, value: pre.amount || '' })), field('Date', inp('date', { type: 'date', value: todayLocal() })),
        field('Category', sel('category', [['medical', 'Medical / dental'], ['school', 'School / tuition'], ['childcare', 'Childcare'], ['activities', 'Activities / sports'], ['clothing', 'Clothing'], ['travel', 'Travel'], ['other', 'Other']], pre.event_id ? 'activities' : 'other'))),
      h('div', { class: 'field' }, h('label', null, 'For'), h('div', { class: 'row' }, S.me.children.map(c => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'kids', 'data-multi': '1', value: c.id, checked: pre.child_ids ? pre.child_ids.includes(c.id) : true }), c.name)))),
      field(`${other() ? other().name + "'s" : "Other parent's"} share (%)`, inp('share', { type: 'number', min: 0, max: 100, value: 100 - S.me.family.default_split }), 'Use the split in your order. Default is set in Settings.'),
      field('Receipt (image or PDF)', file, 'The file is fingerprinted (SHA-256) so it can be shown to be unchanged.'),
      h('label', { class: 'check field' }, inp('request', { type: 'checkbox', checked: true }), 'Ask for reimbursement now'),
      h('button', { class: 'primary', type: 'submit' }, 'Save'));
    return form;
  });
}

function paymentForm(approved) {
  modal('Record a payment you sent', (close) => {
    const total = approved.reduce((s, e) => s + e.owed_cents, 0);
    const form = h('form', { onsubmit: async (e) => { e.preventDefault();
      const v = formValues(form);
      await attempt(() => post('/api/payments', { amount: v.amount, date: v.date, method: v.method, note: v.note, expense_ids: (v.exp || []).map(Number) }), 'Recorded. Your co-parent will be asked to confirm.');
      close(); afterSave(); } },
      approved.length ? h('div', { class: 'field' }, h('label', null, 'Covers these approved expenses'), approved.map(x => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'exp', 'data-multi': '1', value: x.id, checked: true }), `${x.description} (${money(x.owed_cents)})`))) : null,
      h('div', { class: 'fields' }, field('Amount ($)', inp('amount', { type: 'number', step: '0.01', min: '0.01', required: true, value: total ? (total / 100).toFixed(2) : '' })), field('Date', inp('date', { type: 'date', value: todayLocal() })),
        field('Method', inp('method', { placeholder: 'Zelle, Venmo, check #…' }))),
      field('Note', h('textarea', { name: 'note' })), h('button', { class: 'primary', type: 'submit' }, 'Record payment'));
    return form;
  });
}

// ---------- messages ----------
let openThread = null;
VIEWS.messages = async (main) => {
  const threads = await get('/api/threads');
  const listBox = h('div', { class: 'card' });
  const viewBox = h('div', { class: 'card' });
  const drawList = () => mount(clear(listBox), h('div', { class: 'item-head' }, h('h2', null, 'Conversations'), isParent() ? h('button', { class: 'primary', onclick: newThread }, 'New') : null),
    threads.length ? threads.map(t => h('a', { href: '#/messages', class: `thread-link${openThread === t.id ? ' on' : ''}`, onclick: (e) => { e.preventDefault(); openThread = t.id; drawList(); drawThread(); } },
      h('div', { class: 'item-head' }, h('b', null, t.subject), t.unread ? h('span', { class: 'badge bad' }, `${t.unread} new`) : null), h('div', { class: 'small muted' }, `${t.topic} · ${t.count} message${t.count === 1 ? '' : 's'} · ${fmtIso(t.last_at)}`)))
      : h('p', { class: 'empty' }, 'No conversations yet.'));
  async function drawThread() {
    if (!openThread) return mount(clear(viewBox), h('p', { class: 'muted' }, 'Pick a conversation, or start a new one. One topic per conversation keeps things clear.'));
    const { thread, messages } = await get(`/api/threads/${openThread}`);
    const t = threads.find(x => x.id === openThread); if (t) t.unread = 0;
    const ta = h('textarea', { placeholder: 'Brief, informative, friendly, firm.' });
    mount(clear(viewBox), h('h2', null, thread.subject),
      h('div', null, messages.map(m => h('div', { class: `msg${m.author === S.me.user.id ? ' mine' : ''}` }, m.body,
        h('div', { class: 'meta' }, `${m.author_name} · ${fmtIso(m.created_at)}`, m.author === S.me.user.id ? (m.reads.length ? ` · Read ${fmtIso(m.reads[0].at)}` : ' · Not yet read') : '')))),
      isParent() ? h('div', { style: 'margin-top:12px' }, ta, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary', onclick: async () => {
        if (await toneGate(ta.value)) { await attempt(() => post(`/api/threads/${openThread}/messages`, { body: ta.value })); drawThread(); }
      } }, 'Send'), h('span', { class: 'small muted' }, 'Messages are permanent: they cannot be edited or deleted, and read times are recorded.'))) : null);
  }
  function newThread() {
    modal('New conversation', (close) => {
      const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = formValues(form);
        if (!(await toneGate(v.body))) return;
        const { id } = await attempt(() => post('/api/threads', v)); close(); openThread = id; clear(main); VIEWS.messages(main); } },
        field('Subject', inp('subject', { required: true, placeholder: 'e.g. Spring break dates' })),
        field('Topic', sel('topic', [['general', 'General'], ['schedule', 'Schedule'], ['expenses', 'Expenses'], ['school', 'School'], ['medical', 'Medical'], ['activities', 'Activities']], 'general')),
        field('Message', h('textarea', { name: 'body', required: true })), h('button', { class: 'primary', type: 'submit' }, 'Send'));
      return form;
    });
  }
  mount(main, head('Messages', 'A neutral, permanent record. Each message gets a tone check before it is sent.'), h('div', { class: 'threads' }, listBox, viewBox));
  drawList(); drawThread();
};

async function toneGate(text) {
  if (!text.trim()) { toast('Write a message'); return false; }
  const r = await post('/api/tone-check', { text });
  if (r.ok) return true;
  return new Promise(resolve => {
    modal('Before you send', (close) => h('div', null,
      h('p', null, 'Parts of this message may come across as hostile. A judge, mediator or your children may read it someday.'),
      h('div', { class: 'list' }, r.issues.map(i => h('div', { class: 'item' }, h('b', null, i.label), i.matches?.length ? h('span', { class: 'muted' }, ` — "${i.matches.join('", "')}"`) : null, h('div', { class: 'small' }, i.tip)))),
      h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => { close(); resolve(false); } }, 'Edit message'), h('button', { onclick: () => { close(); resolve(true); } }, 'Send anyway'))));
  });
}

// ---------- calls & video ----------
const CALL_STATUS = [['completed', 'Completed'], ['short', 'Cut short'], ['missed_not_facilitated', 'Missed: child not made available'], ['missed_not_called', 'Missed: parent did not call'], ['declined_by_child', 'Child declined'], ['rescheduled', 'Rescheduled by agreement'], ['cancelled', 'Cancelled by agreement']];
VIEWS.calls = async (main) => {
  const today = todayLocal();
  const [rules, calls, comp] = await Promise.all([get('/api/call-rules'), get('/api/calls'), get(`/api/calls/compliance?start=${addDays(today, -27)}&end=${addDays(today, 1)}`)]);
  const me = S.me.user.id;
  const rerender = () => { clear(main); VIEWS.calls(main); };
  const activeRules = rules.filter(r => ['active', 'unconfirmed'].includes(r.status));
  const ruleItem = (r) => h('div', { class: 'item' }, h('div', { class: 'item-head' }, h('div', null, h('b', null, r.name), ' ', badge(r.status), r.retire_requested_by ? h('span', { class: 'badge warn' }, 'End requested') : null), h('span', { class: 'small muted' }, `for ${r.entitled_name}`)),
    h('div', { class: 'small muted' }, `${r.count} ${r.method} call(s) per ${r.period}, ${r.duration_min} min${r.window.days?.length ? ` · ${r.window.days.map(d => DAYS[d]).join(', ')}` : ''}${r.window.start ? ` · ${r.window.start}–${r.window.end}` : ''}`),
    r.reason ? h('div', { class: 'small muted' }, `Reason: ${r.reason}`) : null,
    h('div', { class: 'actions' },
      isParent() && ['pending', 'unconfirmed'].includes(r.status) && r.requested_by !== me ? [
        h('button', { class: 'ok', onclick: async () => { const c = await confirmBox('Approve call schedule', r.name, { okLabel: 'Approve', withNote: true }); if (c) { await attempt(() => post(`/api/call-rules/${r.id}/decide`, { decision: 'approve', note: c.note })); rerender(); } } }, 'Approve'),
        h('button', { class: 'danger', onclick: async () => { const c = await confirmBox('Reject call schedule', r.name, { okLabel: 'Reject', withNote: true }); if (c) { await attempt(() => post(`/api/call-rules/${r.id}/decide`, { decision: 'reject', note: c.note })); rerender(); } } }, 'Reject')] : null,
      isParent() && r.retire_requested_by && r.retire_requested_by !== me ? [h('button', { onclick: async () => { await attempt(() => post(`/api/call-rules/${r.id}/retire-decide`, { decision: 'approve' })); rerender(); } }, 'Approve ending'), h('button', { onclick: async () => { await attempt(() => post(`/api/call-rules/${r.id}/retire-decide`, { decision: 'reject' })); rerender(); } }, 'Keep it')] : null,
      isParent() && ['active', 'unconfirmed'].includes(r.status) && !r.retire_requested_by ? h('button', { onclick: async () => { const c = await confirmBox('Request to end', r.name, { withNote: true }); if (c) { await attempt(() => post(`/api/call-rules/${r.id}/retire`, { note: c.note })); rerender(); } } }, 'Request to end') : null));
  mount(main, head('Phone & video calls', 'Track court-ordered contact: what was allowed, what happened, and whether the other parent agrees.',
    isParent() ? [h('button', { onclick: () => callRuleForm() }, '+ Call schedule'), h('button', { class: 'primary', onclick: () => callForm(activeRules) }, 'Log a call')] : null),
    h('div', { class: 'card' }, h('h2', null, 'Last 4 weeks'), comp.length ? comp.map(c => h('div', { style: 'margin-bottom:12px' }, h('b', null, c.rule.name), ` — for ${c.rule.entitled}`,
      h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Period', 'Allowed', 'Done', 'Missed (not available)', 'Missed (no call)', 'Short', 'Disputed', 'Outside window'].map(x => h('th', null, x)))),
        h('tbody', null, c.periods.map(p => h('tr', null, h('td', { class: 'nowrap' }, `${p.start} →`), h('td', null, p.allowed), h('td', null, p.completed), h('td', null, p.missed_not_facilitated), h('td', null, p.missed_not_called), h('td', null, p.short), h('td', null, p.disputed), h('td', null, p.outside_window)))))))) : h('p', { class: 'empty' }, 'Add a call schedule to track compliance.')),
    h('div', { class: 'card' }, h('h2', null, 'Call schedules'), rules.filter(r => !['rejected', 'withdrawn', 'retired'].includes(r.status)).length ? h('div', { class: 'list' }, rules.filter(r => !['rejected', 'withdrawn', 'retired'].includes(r.status)).map(ruleItem)) : h('p', { class: 'empty' }, 'None.')),
    h('div', { class: 'card' }, h('h2', null, 'Call log'), calls.length ? h('div', { class: 'list' }, calls.map(c => h('div', { class: 'item' },
      h('div', { class: 'item-head' }, h('div', null, h('b', null, CALL_STATUS.find(s => s[0] === c.status)?.[1] || c.status), ` · ${c.method}${c.duration_min ? ` · ${c.duration_min} min` : ''}`), h('span', { class: 'small' }, c.started_local.replace('T', ' '))),
      h('div', { class: 'small muted' }, `Logged by ${c.logged_by_name}`, c.confirm_result ? ` · other parent ${c.confirm_result}` : ' · not yet confirmed by other parent'), c.details ? h('div', { class: 'small' }, c.details) : null,
      h('div', { class: 'actions' }, isParent() && !c.confirm_result && c.logged_by !== me ? [
        h('button', { class: 'ok', onclick: async () => { await attempt(() => post(`/api/calls/${c.id}/confirm`, { agree: true }), 'Confirmed'); rerender(); } }, 'Agree'),
        h('button', { class: 'danger', onclick: async () => { const r = await confirmBox('Dispute this log', 'Say what actually happened. Your note is saved to the record.', { withNote: true, noteRequired: true, okLabel: 'Dispute' }); if (r) { await attempt(() => post(`/api/calls/${c.id}/confirm`, { agree: false })); await post('/api/notes', { target_type: 'call', target_id: c.id, body: r.note }); rerender(); } } }, 'Dispute')] : null,
        h('button', { onclick: () => modal('Call notes', notesPanel('call', c.id)) }, 'Notes'))))) : h('p', { class: 'empty' }, 'No calls logged.')));
};
function callRuleForm() {
  modal('Call / video schedule', (close) => {
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = formValues(form);
      await attempt(() => post('/api/call-rules', { name: v.name || undefined, entitled_parent: +v.entitled_parent, method: v.method, count: +v.count, period: v.period, duration_min: +v.duration_min, reason: v.reason,
        window: { days: (v.days || []).map(Number), start: v.start || null, end: v.end || null } }), other() ? 'Sent for approval' : 'Saved'); close(); afterSave(); } },
      h('p', { class: 'small muted' }, 'Usually the parent without custody at that moment gets calls with the children. Enter what your order says.'),
      field('Name (optional)', inp('name')),
      h('div', { class: 'fields' }, field('Calls are for', sel('entitled_parent', parentOpts(), S.me.user.id)), field('Type', sel('method', [['either', 'Phone or video'], ['phone', 'Phone'], ['video', 'Video']], 'either'))),
      h('div', { class: 'fields' }, field('How many', inp('count', { type: 'number', min: 1, max: 50, value: 2 })), field('Per', sel('period', [['week', 'Week'], ['day', 'Day'], ['month', 'Month']], 'week')), field('Minimum minutes', inp('duration_min', { type: 'number', min: 0, value: 15 }))),
      h('div', { class: 'field' }, h('label', null, 'Allowed days (none = any day)'), h('div', { class: 'row' }, DAYS.map((d, i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'days', 'data-multi': '1', value: i }), d)))),
      h('div', { class: 'fields' }, field('Window from', inp('start', { type: 'time', value: '18:00' })), field('Window until', inp('end', { type: 'time', value: '20:00' }))),
      field('Order reference', h('textarea', { name: 'reason' })), h('button', { class: 'primary', type: 'submit' }, other() ? 'Send for approval' : 'Save'));
    return form;
  });
}
function callForm(rules) {
  modal('Log a call', (close) => {
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = formValues(form);
      await attempt(() => post('/api/calls', { rule_id: v.rule_id ? +v.rule_id : null, started: v.started, duration_min: +v.duration_min || 0, status: v.status, method: v.method, details: v.details, child_ids: (v.kids || []).map(Number) }), 'Logged'); close(); afterSave(); } },
      field('Call schedule', sel('rule_id', [['', 'Not under a schedule'], ...rules.map(r => [r.id, r.name])], rules[0]?.id ?? '')),
      h('div', { class: 'fields' }, field('When (scheduled or actual)', inp('started', { type: 'datetime-local', value: nowLocalStamp(), required: true })), field('Minutes', inp('duration_min', { type: 'number', min: 0, value: 0 })), field('Type', sel('method', [['phone', 'Phone'], ['video', 'Video']], 'video'))),
      field('What happened', sel('status', CALL_STATUS, 'completed')),
      h('div', { class: 'field' }, h('label', null, 'Children'), h('div', { class: 'row' }, S.me.children.map(c => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'kids', 'data-multi': '1', value: c.id, checked: true }), c.name)))),
      field('Details', h('textarea', { name: 'details', placeholder: 'Facts only: e.g. "Called 6:30pm, no answer. Texted at 6:35. Call back at 7:10, 12 minutes."' })),
      h('button', { class: 'primary', type: 'submit' }, 'Save'));
    return form;
  });
}

// ---------- exchanges ----------
VIEWS.exchanges = async (main) => {
  const list = await get('/api/exchanges');
  const rerender = () => { clear(main); VIEWS.exchanges(main); };
  mount(main, head('Exchanges', 'Check in at hand-offs. The server timestamps each check-in and compares it with the scheduled exchange.', isParent() ? h('button', { class: 'primary', onclick: () => exchangeForm(rerender) }, 'Check in now') : null),
    h('div', { class: 'card' }, list.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['When', 'What', 'By', 'Scheduled', 'Late', 'Where', ''].map(x => h('th', null, x)))),
      h('tbody', null, list.map(x => h('tr', null, h('td', { class: 'nowrap' }, fmtDT(x.at_ms)), h('td', null, { dropoff: 'Drop-off', pickup: 'Pick-up', no_show_other: 'Other parent no-show', late_other: 'Other parent late' }[x.kind]),
        h('td', null, x.logged_by_name), h('td', null, x.scheduled_ms ? fmtT(x.scheduled_ms) : '—'), h('td', null, x.minutes_late == null ? '—' : x.minutes_late > 5 ? h('span', { class: 'badge warn' }, `${x.minutes_late} min`) : x.minutes_late < -5 ? `${-x.minutes_late} min early` : 'On time'),
        h('td', null, x.location, x.lat != null ? h('div', null, h('a', { href: `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lng}#map=17/${x.lat}/${x.lng}`, target: '_blank', rel: 'noopener' }, `GPS ±${Math.round(x.accuracy || 0)}m`)) : null),
        h('td', null, h('button', { onclick: () => modal('Exchange notes', h('div', null, x.details ? h('p', null, x.details) : null, notesPanel('exchange', x.id))) }, 'Notes'))))))) : h('p', { class: 'empty' }, 'No check-ins yet.')));
};
function exchangeForm(done) {
  modal('Exchange check-in', (close) => {
    const status = h('div', { class: 'small muted' }, 'Location not attached.');
    let geo = null;
    const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = formValues(form);
      const r = await attempt(() => post('/api/exchanges', { kind: v.kind, location: v.location, details: v.details, child_ids: (v.kids || []).map(Number), ...(geo || {}) }));
      toast(r.scheduled_ms ? `Checked in. Scheduled exchange was ${fmtT(r.scheduled_ms)}.` : 'Checked in. No scheduled exchange near this time.'); close(); done(); } },
      field('What is happening', sel('kind', [['dropoff', 'I am dropping off'], ['pickup', 'I am picking up'], ['late_other', 'Other parent is late'], ['no_show_other', 'Other parent did not show']], 'pickup')),
      h('div', { class: 'field' }, h('label', null, 'Children'), h('div', { class: 'row' }, S.me.children.map(c => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'kids', 'data-multi': '1', value: c.id, checked: true }), c.name)))),
      field('Place', inp('location', { placeholder: 'e.g. School front office' })),
      h('div', { class: 'field' }, h('button', { type: 'button', onclick: () => {
        if (!navigator.geolocation) return toast('Location not available on this device');
        status.textContent = 'Getting location…';
        navigator.geolocation.getCurrentPosition(p => { geo = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; status.textContent = `Location attached (±${Math.round(p.coords.accuracy)} m).`; },
          err => { status.textContent = `Could not get location: ${err.message}`; }, { enableHighAccuracy: true, timeout: 15000 });
      } }, 'Attach my GPS location'), status),
      field('Notes', h('textarea', { name: 'details', placeholder: 'Facts only.' })), h('button', { class: 'primary', type: 'submit' }, 'Check in'));
    return form;
  });
}

// ---------- calendar sync ----------
VIEWS.sync = async (main) => {
  const feeds = await get('/api/feeds');
  const base = location.origin + S.me.icsBase;
  const rerender = () => { clear(main); VIEWS.sync(main); };
  const urlRow = (label, url) => h('div', { class: 'field' }, h('label', null, label), h('div', { class: 'row' }, h('code', { class: 'url grow' }, url),
    h('button', { onclick: () => navigator.clipboard.writeText(url).then(() => toast('Copied'), () => toast('Copy failed: select and copy the text')) }, 'Copy')));
  const webcal = base.replace(/^https?:/, 'webcal:');
  mount(main, head('Calendar sync', 'Works with Google Calendar, Apple Calendar (iPhone/Mac) and Outlook through standard calendar subscriptions.'),
    h('div', { class: 'card' }, h('h2', null, '1. Show the custody schedule and activities in your calendar'),
      h('p', { class: 'small muted' }, 'This is your personal private address. Anyone with it can see your schedule, so don\'t share it. Your co-parent has their own.'),
      urlRow('Everything (custody blocks + activities)', base), urlRow('Custody blocks only', `${base}?include=custody`), urlRow('Activities only', `${base}?include=events`),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: webcal }, 'Open in Apple Calendar'), h('a', { class: 'btn', href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`, target: '_blank', rel: 'noopener' }, 'Add to Google Calendar'),
        h('a', { class: 'btn', href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(base)}&name=${encodeURIComponent('Co-parenting')}`, target: '_blank', rel: 'noopener' }, 'Add to Outlook')),
      h('details', { style: 'margin-top:10px' }, h('summary', null, 'Step-by-step instructions'), h('ul', { class: 'small' },
        h('li', null, h('b', null, 'Google: '), 'calendar.google.com → Other calendars + → From URL → paste the address. Google refreshes every few hours (Google controls this).'),
        h('li', null, h('b', null, 'iPhone: '), 'Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste. ', h('b', null, 'Mac: '), 'Calendar → File → New Calendar Subscription.'),
        h('li', null, h('b', null, 'Outlook: '), 'Outlook.com or new Outlook → Add calendar → Subscribe from web → paste.'))),
      h('button', { class: 'danger', style: 'margin-top:10px', onclick: async () => { if (await confirmBox('Reset your private address?', 'Old subscriptions stop updating. You will need to re-add the new address.')) { await attempt(() => post('/api/ics-token/rotate'), 'Reset'); await refreshMe(); rerender(); } } }, 'Reset private address')),
    h('div', { class: 'card' }, h('h2', null, '2. Bring your other calendars in (work, kids\' school, team apps)'),
      h('p', { class: 'small muted' }, 'Shows those events on the calendar here (read-only) so you can spot conflicts. Paste the calendar\'s secret iCal address:'),
      h('ul', { class: 'small' },
        h('li', null, h('b', null, 'Google: '), 'Settings → pick the calendar → Integrate calendar → "Secret address in iCal format".'),
        h('li', null, h('b', null, 'Apple iCloud: '), 'Calendar app → share the calendar → Public Calendar → copy link.'),
        h('li', null, h('b', null, 'Outlook: '), 'Settings → Calendar → Shared calendars → Publish a calendar → copy the ICS link.'),
        h('li', null, h('b', null, 'TeamSnap, school sites, etc.: '), 'look for "Subscribe" or "iCal/ICS".')),
      (() => {
        const form = h('form', { onsubmit: async (e) => { e.preventDefault(); const v = formValues(form);
          const r = await attempt(() => post('/api/feeds', v)); toast(r.ok ? `Added, ${r.count} events` : `Added, but sync failed: ${r.error}`); rerender(); } },
          h('div', { class: 'fields' }, field('Name', inp('name', { placeholder: 'e.g. My work calendar' })), field('Provider', sel('provider', [['google', 'Google'], ['apple', 'Apple iCloud'], ['outlook', 'Outlook / Microsoft 365'], ['other', 'Other']], 'google')),
            field('Who can see it', sel('visibility', [['me', 'Only me'], ['family', 'Me and co-parent']], 'me'))),
          field('Secret iCal (.ics) address', inp('url', { required: true, placeholder: 'https://… or webcal://…' })), h('button', { class: 'primary', type: 'submit' }, 'Add calendar'));
        return form;
      })()),
    h('div', { class: 'card' }, h('h2', null, 'Connected calendars'), feeds.length ? h('div', { class: 'list' }, feeds.map(f => h('div', { class: 'item' },
      h('div', { class: 'item-head' }, h('b', null, f.name), h('span', { class: 'badge' }, f.provider)),
      h('div', { class: 'small muted' }, `${f.events} events · ${f.visibility === 'family' ? 'shared with co-parent' : 'only you'} · last sync ${f.last_sync ? fmtIso(f.last_sync) : 'never'}`),
      f.last_error ? h('div', { class: 'small', style: 'color:var(--bad)' }, f.last_error) : null,
      f.user_id === S.me.user.id ? h('div', { class: 'actions' }, h('button', { onclick: async () => { const r = await attempt(() => post(`/api/feeds/${f.id}/sync`)); toast(r.ok ? `Synced ${r.count} events` : r.error); rerender(); } }, 'Sync now'),
        h('button', { class: 'danger', onclick: async () => { if (await confirmBox('Remove calendar?', f.name)) { await attempt(() => api('DELETE', `/api/feeds/${f.id}`)); rerender(); } } }, 'Remove')) : null))) : h('p', { class: 'empty' }, 'None yet.')));
};

// ---------- records ----------
VIEWS.records = async (main) => {
  const [v, log, notes] = await Promise.all([get('/api/audit/verify'), get('/api/audit?limit=150'), get('/api/notes')]);
  const y = todayLocal().slice(0, 4);
  const from = inp('from', { type: 'date', value: `${y}-01-01` }), to = inp('to', { type: 'date', value: todayLocal() });
  const journal = h('textarea', { placeholder: 'Journal entry: something you want on the record that is not tied to a specific item. Facts, dates, names.' });
  mount(main, head('Records & reports', 'Everything here is append-only and timestamped by the server.'),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h2', null, 'Court / attorney report'), h('p', { class: 'small muted' }, 'Opens a printable report: time share, schedule approvals, exchanges, calls, expenses, messages, notes and the integrity check. Use your browser\'s Print → Save as PDF.'),
        h('div', { class: 'fields' }, field('From', from), field('To', to)), h('button', { class: 'primary', onclick: () => window.open(`/report?start=${from.value}&end=${to.value}`, '_blank', 'noopener') }, 'Open report')),
      h('div', { class: 'card' }, h('h2', null, 'Integrity check'), h('div', { class: 'big', style: `color:var(--${v.ok ? 'ok' : 'bad'})` }, v.ok ? 'Passed' : 'FAILED'),
        h('div', { class: 'small' }, `${v.entries} entries in the hash chain.`), v.problems.map(p => h('div', { class: 'small', style: 'color:var(--bad)' }, p)),
        h('div', { class: 'small muted', style: 'margin-top:6px' }, 'Current fingerprint (chain head):'), h('code', { class: 'url' }, v.head),
        h('p', { class: 'small muted' }, 'Tip: email this fingerprint to yourself or your attorney now and then. It proves the records up to that point have not been changed since, even by whoever runs the server.'))),
    isParent() ? h('div', { class: 'card', style: 'margin-top:14px' }, h('h2', null, 'Journal'), journal, h('button', { style: 'margin-top:8px', onclick: async () => { if (!journal.value.trim()) return; await attempt(() => post('/api/notes', { target_type: 'general', target_id: '', body: journal.value }), 'Saved'); clear(main); VIEWS.records(main); } }, 'Save entry')) : null,
    h('div', { class: 'card' }, h('h2', null, 'All notes'), notes.length ? notes.slice(0, 100).map(n => h('div', { class: 'note' }, n.body, h('div', { class: 'meta' }, `${n.author_name} · ${fmtIso(n.created_at)} · on ${n.target_type}${n.target_id ? ' ' + n.target_id : ''}`))) : h('p', { class: 'empty' }, 'No notes yet.')),
    h('div', { class: 'card' }, h('h2', null, 'Activity log'), h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['#', 'When', 'Who', 'Action', 'Item'].map(x => h('th', null, x)))),
      h('tbody', null, log.map(a => h('tr', null, h('td', null, a.seq), h('td', { class: 'nowrap' }, fmtIso(a.ts)), h('td', null, a.user_name || ''), h('td', null, a.action.replace(/_/g, ' ')), h('td', null, `${a.entity.replace(/_/g, ' ')} ${a.entity_id ?? ''}`))))))));
};

// ---------- settings ----------
VIEWS.settings = async (main) => {
  await refreshMe();
  const f = S.me.family;
  const rerender = () => { clear(main); VIEWS.settings(main); };
  const famForm = h('form', { onsubmit: async (e) => { e.preventDefault(); await attempt(() => put('/api/family', formValues(famForm)), 'Saved'); await refreshMe(); } },
    field('Family name', inp('name', { value: f.name })), field('Time zone', inp('timezone', { value: f.timezone })),
    field('Default expense split: your share (%)', inp('default_split', { type: 'number', min: 0, max: 100, value: f.default_split }), 'Used to pre-fill the other parent\'s share on new expenses.'),
    isParent() ? h('button', { class: 'primary', type: 'submit' }, 'Save') : null);
  const INFO = ['School', 'Teacher', 'Doctor', 'Dentist', 'Allergies', 'Medications', 'Insurance', 'Clothing / shoe size', 'Emergency contact', 'Other'];
  mount(main, head('Settings'),
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h2', null, 'Family'), famForm),
      h('div', { class: 'card' }, h('h2', null, 'People'), h('div', { class: 'list' }, S.me.members.map(m => h('div', { class: 'item row' }, parentDot(m.id), h('b', null, m.name), h('span', { class: 'muted small' }, `${m.role === 'viewer' ? 'View only' : 'Parent'} · ${m.email}`)))),
        isParent() ? h('div', null,
          f.invite_code ? h('div', { class: 'alert' }, 'Co-parent invite code: ', h('b', null, f.invite_code), h('div', { class: 'small muted' }, 'They create an account, then enter this code. It works once.')) : null,
          h('div', { class: 'alert' }, 'View-only code (attorney, mediator, GAL, step-parent): ', h('b', null, f.viewer_code),
            h('div', null, h('button', { class: 'link', onclick: async () => { await attempt(() => post('/api/family/viewer-code'), 'New code created; the old one no longer works'); rerender(); } }, 'Make a new code')))) : null)),
    h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'item-head' }, h('h2', null, 'Children & info'), isParent() ? h('button', { onclick: () => {
      modal('Add child', (close) => { const fm = h('form', { onsubmit: async (e) => { e.preventDefault(); await attempt(() => post('/api/children', formValues(fm)), 'Added'); close(); rerender(); } },
        field('Name', inp('name', { required: true })), field('Birthdate', inp('birthdate', { type: 'date' })), h('button', { class: 'primary', type: 'submit' }, 'Add')); return fm; });
    } }, '+ Child') : null),
      h('p', { class: 'small muted' }, 'Shared info both parents can see: school, doctors, allergies, sizes. Changes are logged.'),
      S.me.children.map(c => {
        const fm = h('form', { class: 'card', onsubmit: async (e) => { e.preventDefault(); const v = formValues(fm);
          const info = Object.fromEntries(INFO.map(k => [k, v[`i_${k}`] || '']).filter(([, x]) => x));
          await attempt(() => put(`/api/children/${c.id}`, { name: v.name, birthdate: v.birthdate, info }), 'Saved'); await refreshMe(); } },
          h('div', { class: 'fields' }, field('Name', inp('name', { value: c.name })), field('Birthdate', inp('birthdate', { type: 'date', value: c.birthdate || '' }))),
          h('div', { class: 'fields' }, INFO.map(k => field(k, inp(`i_${k}`, { value: c.info[k] || '' })))),
          isParent() ? h('button', { type: 'submit' }, 'Save') : null);
        return fm;
      })));
};

render();
