// Hash router and app shell.
import { S, api, setSession, esc, runCleanups, toast, listenForReminders, SYNTHETIC_NOTE, t, getLang, setLang } from './lib.js';
import { recovery, caregivers, acceptInvite, caring, reminders, discharge } from './care.js';
import { offers, analytics, symptomTest } from './insights.js';
import {
  homeFor, landing, login, signup, profile, symptoms, home, visitsList, book, visitDetail, prepare, queuePage, conditions, qrCheckin,
} from './patient.js';
import {
  staffToday, staffQueue, staffVisit, display, qrPoster, adminDepartments, adminTests, adminSlots, adminStaff, adminRules,
} from './staff.js';

// Which mode the server runs in (demo shows sample-data notices). Fetched once at start-up.
const FEATURES = await fetch('/api/v1/features').then((r) => r.json()).catch(() => ({ demo: true }));

const ALL = ['patient', 'staff', 'admin'];
const STAFF = ['staff', 'admin'];

// [pattern, view, roles (null = public), bare (no app shell)]
const ROUTES = [
  ['/', landing, null],
  ['/login', login, null],
  ['/signup', signup, null],
  ['/symptoms', symptoms, null],
  ['/conditions', conditions, null],
  ['/display/:id', display, null, true],
  ['/qr/:id', qrPoster, STAFF, true],
  ['/checkin/:dept', qrCheckin, ['patient']],
  ['/home', home, ['patient']],
  ['/book', book, ['patient']],
  ['/visits', visitsList, ['patient']],
  ['/visits/:id', visitDetail, ['patient']],
  ['/visits/:id/prepare', prepare, ['patient']],
  ['/visits/:id/queue', queuePage, ['patient']],
  ['/visits/:id/recovery', recovery, ['patient']],
  ['/profile', profile, ALL],
  ['/profile/caregivers', caregivers, ['patient']],
  ['/invite/:token', acceptInvite, ['patient']],
  ['/caring', caring, ['patient']],
  ['/reminders', reminders, ['patient']],
  ['/offers', offers, ['patient']],
  ['/admin/analytics', analytics, ['admin']],
  ['/admin/symptom-test', symptomTest, ['admin']],
  ['/staff/visits/:id/discharge', discharge, STAFF],
  ['/staff', staffToday, STAFF],
  ['/staff/queue', staffQueue, STAFF],
  ['/staff/queue/:id', staffQueue, STAFF],
  ['/staff/visits/:id', staffVisit, STAFF],
  ['/admin/departments', adminDepartments, ['admin']],
  ['/admin/tests', adminTests, ['admin']],
  ['/admin/slots', adminSlots, ['admin']],
  ['/admin/staff', adminStaff, ['admin']],
  ['/admin/symptom-rules', adminRules, ['admin']],
].map(([pattern, view, roles, bare]) => ({
  view, roles, bare,
  keys: [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]),
  re: new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`),
}));

const NAV = {
  public: [['#/symptoms', 'Symptom guide'], ['#/conditions', 'Conditions'], ['#/login', 'Log in'], ['#/signup', 'Sign up']],
  patient: [['#/home', 'Home'], ['#/book', 'Book'], ['#/visits', 'My visits'], ['#/offers', 'Offers'], ['#/reminders', 'Reminders'],
    ['#/caring', 'Caring'], ['#/symptoms', 'Symptom guide'], ['#/conditions', 'Conditions'], ['#/profile', 'Profile']],
  staff: [['#/staff', 'Today'], ['#/staff/queue', 'Queue'], ['#/profile', 'Profile']],
  admin: [['#/admin/analytics', 'Analytics'], ['#/staff', 'Today'], ['#/staff/queue', 'Queue'], ['#/admin/departments', 'Departments'], ['#/admin/tests', 'Tests'],
    ['#/admin/slots', 'Slots'], ['#/admin/staff', 'Staff'], ['#/admin/symptom-rules', 'Symptom rules'], ['#/admin/symptom-test', 'Symptom test']],
};

function shell(path) {
  const links = NAV[S.user?.role || 'public'];
  // The longest nav link that prefixes the path is the active one.
  const matches = links.map(([h]) => h.slice(1)).filter((p) => path === p || path.startsWith(`${p}/`));
  const best = matches.sort((a, b) => b.length - a.length)[0];
  const active = (href) => href.slice(1) === best;
  return `
    ${FEATURES.demo ? `<div class="bg-slate-900 text-slate-200 text-xs text-center px-4 py-2">${t('Demo site with sample data.')} ${S.user ? '' : `<a href="#/login" class="font-semibold text-white underline underline-offset-2">${t('Try the demo accounts')}</a>`}</div>` : ''}
    <header class="site-header sticky top-0 z-40 border-b backdrop-blur-md">
      <div class="max-w-6xl mx-auto px-4 py-2 lg:py-0 lg:h-16 flex flex-wrap lg:flex-nowrap items-center gap-x-4 gap-y-1">
        <a href="${homeFor(S.user)}" class="flex items-center gap-2.5 font-semibold text-[1.05rem] tracking-tight shrink-0">
          <svg viewBox="0 0 32 32" class="h-8 w-8 drop-shadow-sm" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14b8a6"/><stop offset="1" stop-color="#0f766e"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="9" fill="url(#lg)"/><path d="M8.5 16h4l2.2-5.2 3.2 10.4 2.2-5.2h3.4" stroke="white" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          CareLoop
        </a>
        <nav class="no-scrollbar order-last w-full lg:order-none lg:w-auto lg:flex-1 min-w-0 flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 lg:pb-0" aria-label="Main">
          ${links.map(([href, label]) => `<a href="${href}" class="nav-link ${active(href) ? 'active' : ''}">${t(label)}</a>`).join('')}
        </nav>
        <div class="flex items-center gap-2 shrink-0 ml-auto lg:ml-0">
          ${S.user?.role && S.user.role !== 'patient' ? '' : `<button id="lang" class="btn btn-ghost btn-sm" title="Language / भाषा">${getLang() === 'hi' ? 'English' : 'हिन्दी'}</button>`}
          <button id="theme" class="btn btn-ghost btn-sm" aria-label="Switch light or dark mode" title="Light / dark">◐</button>
          ${S.user ? `
            <span class="hidden lg:block text-sm text-slate-500">${esc(S.user.full_name)}</span>
            <button id="logout" class="btn btn-ghost btn-sm">${t('Log out')}</button>` : ''}
        </div>
      </div>
    </header>
    <main id="view" class="max-w-6xl mx-auto px-4 py-8"></main>
    <footer class="max-w-6xl mx-auto px-4 pb-10 pt-6 mt-4 border-t border-slate-200/70 text-xs text-slate-400 flex flex-wrap justify-between gap-2">
      <span>${t(FEATURES.demo ? SYNTHETIC_NOTE : 'CareLoop helps you find care and prepare for visits. It doesn’t replace advice from a doctor.')}</span>
      <span>${t('In an emergency call 112 or 108.')}</span>
    </footer>`;
}

async function render() {
  runCleanups();
  const raw = location.hash.slice(1) || '/';
  const path = raw.split('?')[0] || '/';
  const app = document.getElementById('app');

  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) { location.hash = homeFor(S.user); return; }
  if (route.roles && !S.user) { location.hash = `#/login?next=${encodeURIComponent(raw)}`; return; }
  if (route.roles && !route.roles.includes(S.user.role)) { location.hash = homeFor(S.user); return; }
  if ((path === '/login' || path === '/signup') && S.user) { location.hash = homeFor(S.user); return; }

  listenForReminders();
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(path.match(route.re)[i + 1])]));
  let el;
  if (route.bare) {
    app.innerHTML = '<div id="view"></div>';
    el = app.querySelector('#view');
  } else {
    app.innerHTML = shell(path);
    el = app.querySelector('#view');
    app.querySelector('#logout')?.addEventListener('click', () => {
      setSession(null, null);
      location.hash = '#/';
    });
    app.querySelector('#lang')?.addEventListener('click', () => {
      setLang(getLang() === 'hi' ? 'en' : 'hi');
      if (S.user?.role === 'patient') api('/me', { method: 'PATCH', body: { language: getLang() } }).catch(() => {});
      render();
    });
    app.querySelector('#theme')?.addEventListener('click', toggleTheme);
  }
  el.innerHTML = `<div class="py-16 text-center text-slate-400">${t('Loading…')}</div>`;
  window.scrollTo(0, 0);
  try {
    await route.view(el, params);
  } catch (e) {
    el.innerHTML = `<div class="card p-8 text-center"><p class="font-semibold">Couldn’t load this page</p><p class="text-slate-500 text-sm mt-1">${esc(e.message)}</p><a href="${homeFor(S.user)}" class="btn btn-ghost mt-4">Go home</a></div>`;
    if (!/sign in/i.test(e.message)) toast(e.message, 'error');
  }
}

// Light/dark: follows the device until the user picks one; the choice is remembered on this device.
function applyTheme() {
  let pick = null;
  try { pick = localStorage.getItem('cl_theme'); } catch {}
  const dark = pick ? pick === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}
function toggleTheme() {
  const dark = !document.documentElement.classList.contains('dark');
  try { localStorage.setItem('cl_theme', dark ? 'dark' : 'light'); } catch {}
  applyTheme();
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

window.addEventListener('hashchange', render);
render();
