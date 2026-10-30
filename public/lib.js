// Shared helpers: session, API, sockets, formatting, small UI pieces.
import { t, locale } from './i18n.js';
export { t, getLang, setLang } from './i18n.js';

export const S = {
  token: localStorage.getItem('cl_token'),
  user: JSON.parse(localStorage.getItem('cl_user') || 'null'),
};

export function setSession(token, user) {
  S.token = token;
  S.user = user;
  if (token) {
    localStorage.setItem('cl_token', token);
    localStorage.setItem('cl_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('cl_token');
    localStorage.removeItem('cl_user');
  }
  if (socket) { socket.disconnect(); socket = null; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token && !path.startsWith('/auth/')) {
    setSession(null, null);
    location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`;
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- per-view cleanup & sockets ----------

let cleanups = [];
export function onCleanup(fn) { cleanups.push(fn); }
export function runCleanups() { cleanups.forEach((f) => { try { f(); } catch {} }); cleanups = []; }

let socket = null;
function sock() {
  if (!socket) socket = window.io({ auth: { token: S.token } });
  return socket;
}

// Live reminders arrive on the signed-in user's own room (joined by the server on connect).
let reminderSocket = null;
export function listenForReminders() {
  if (!S.user) return;
  const s = sock();
  if (reminderSocket === s) return;
  reminderSocket = s;
  s.on('reminder', (r) => {
    toast(`🔔 ${r.subject}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(r.subject, { body: r.body });
    }
  });
}

// Listen to an event on the user's own room for the life of the current view.
export function onUserEvent(event, fn) {
  if (!S.user) return;
  const s = sock();
  s.on(event, fn);
  onCleanup(() => s.off(event, fn));
}

// Join a room for the life of the current view; re-joins after reconnects.
export function joinRoom(room, handlers) {
  const s = sock();
  const join = () => s.emit('join', { room });
  join();
  s.on('connect', join);
  for (const [ev, fn] of Object.entries(handlers)) s.on(ev, fn);
  onCleanup(() => {
    s.emit('leave', { room });
    s.off('connect', join);
    for (const [ev, fn] of Object.entries(handlers)) s.off(ev, fn);
  });
}

// ---------- formatting ----------

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmtDT = (iso) =>
  new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtTime = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' });
export const fmtDate = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const isToday = (iso) => localDate(new Date(iso)) === localDate();

export function qs() {
  const i = location.hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? location.hash.slice(i + 1) : '');
}

// ---------- UI pieces ----------

const TONES = {
  green: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  blue: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  teal: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100',
  gray: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};
export const badge = (text, tone = 'gray') => `<span class="badge ${TONES[tone]}">${esc(t(text))}</span>`;

const VISIT_STATUS = {
  booked: ['Booked', 'blue'], checked_in: ['Checked in', 'teal'], in_service: ['With doctor', 'teal'],
  completed: ['Completed', 'green'], no_show: ['No-show', 'red'], cancelled: ['Cancelled', 'gray'],
};
export const visitBadge = (s) => badge(...(VISIT_STATUS[s] || [s, 'gray']));

const READINESS = { ready: ['Ready', 'green'], at_risk: ['Not ready', 'red'], unknown: ['Nothing pending', 'gray'] };
export const readinessBadge = (r) => badge(...(READINESS[r] || [r, 'gray']));

const TOKEN = { waiting: ['Waiting', 'blue'], called: ['Called', 'amber'], serving: ['Being seen', 'teal'], done: ['Done', 'green'], skipped: ['Skipped', 'red'] };
export const tokenBadge = (s) => badge(...(TOKEN[s] || [s, 'gray']));

export const URGENCY = {
  emergency: ['Emergency', 'red', 'Go to emergency now'],
  same_day: ['Today', 'amber', 'Try to be seen today'],
  within_week: ['This week', 'blue', 'Book within the next few days'],
  routine: ['Routine', 'green', 'Book at a convenient time'],
};
export const urgencyBadge = (u) => badge(URGENCY[u]?.[0] || u, URGENCY[u]?.[1] || 'gray');

const ITEM = { document: ['Document', 'blue'], fasting: ['Fasting', 'amber'], task: ['To do', 'teal'], info: ['Good to know', 'gray'] };
export const itemBadge = (t) => badge(...(ITEM[t] || [t, 'gray']));

export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-xl ring-1 ring-black/5 ${kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// Runs an async action from a button, disabling it and toasting errors.
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}

export const pageTitle = (title, sub = '', actions = '') => `
  <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-7">
    <div class="min-w-0">
      <h1 class="text-[1.65rem] leading-tight font-semibold tracking-tight text-slate-900">${t(title)}</h1>
      ${sub ? `<p class="text-slate-500 mt-1.5 max-w-2xl">${t(sub)}</p>` : ''}
    </div>
    ${actions ? `<div class="flex flex-wrap gap-2">${actions}</div>` : ''}
  </div>`;

export const empty = (text, action = '') =>
  `<div class="card p-10 text-center text-slate-500 border-dashed shadow-none"><p class="max-w-md mx-auto">${t(text)}</p>${action ? `<div class="mt-5">${action}</div>` : ''}</div>`;

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

export const SYNTHETIC_NOTE = 'Demo build with synthetic data. Not for real medical use.';

export const ordinal = (n) => {
  if (locale() === 'hi-IN') return String(n);
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};
