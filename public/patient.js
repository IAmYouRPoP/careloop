// Public and patient views.
import {
  S, api, setSession, esc, fmtDT, fmtTime, fmtDate, localDate, isToday, qs, badge, visitBadge, readinessBadge,
  tokenBadge, urgencyBadge, itemBadge, URGENCY, toast, busy, pageTitle, empty, formData, joinRoom, SYNTHETIC_NOTE,
  t, setLang, ordinal,
} from './lib.js';
import { offerBanner } from './insights.js';

// Oldest date of birth the forms accept (120 years ago); the server enforces the same range.
const dobMin = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 120); return localDate(d); };

export const homeFor =(u) => (!u ? '#/' : u.role === 'patient' ? '#/home' : u.role === 'admin' ? '#/admin/analytics' : '#/staff');

// ---------- landing ----------

// Simple line icons (24×24, drawn with the current text colour).
const ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.5V3.5h6v1"/><path d="m9 13 2 2 4-4"/>',
  ticket: '<path d="M4 8a2 2 0 0 0 2-2h12a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H6a2 2 0 0 0-2-2z"/><path d="M12 6v12" stroke-dasharray="2 2"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  bell: '<path d="M6 10a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7 15 4-4 3 3 5-6"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  pill: '<rect x="3.5" y="9" width="17" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="m9.5 8.5 5 7"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<path d="M12 4 3 19h18z"/><path d="M12 10v4M12 17h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
};
const icon = (name, cls = 'h-5 w-5') =>
  `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

export async function landing(el) {
  const signedIn = !!S.user;
  const patient = S.user?.role === 'patient';
  const bookHref = patient ? '#/book' : signedIn ? homeFor(S.user) : '#/signup';

  // The patient journey: four steps, each linking to the part of the app that does it.
  const steps = [
    ['search', 'Find care', 'Describe how you feel. Get the right department and how soon to go.', '#/symptoms'],
    ['clipboard', 'Prepare', 'A checklist from the hospital’s own instructions, so nothing is forgotten.', patient ? '#/visits' : '#/login'],
    ['ticket', 'Check in', 'Scan the QR code at reception and follow your place in the queue live.', patient ? '#/visits' : '#/login'],
    ['heart', 'Recover', 'Medicine times, follow-up dates and reminders from your care team.', patient ? '#/home' : '#/login'],
  ];
  const journey = `
    <div class="card p-6 sm:p-7 lg:ml-6 shadow-xl ring-1 ring-slate-900/5">
      <div class="text-xs font-semibold uppercase tracking-wider text-brand-700">${t('Your visit, step by step')}</div>
      <ol class="mt-5 relative">
        ${steps.map(([ic, title, body, href], i) => `
          <li class="relative pl-14 ${i < steps.length - 1 ? 'pb-6' : ''}">
            ${i < steps.length - 1 ? '<span class="absolute left-[1.15rem] top-10 bottom-0 w-px bg-gradient-to-b from-brand-500/40 to-slate-200" aria-hidden="true"></span>' : ''}
            <span class="absolute left-0 top-0 h-9 w-9 rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 grid place-items-center">${icon(ic)}</span>
            <a href="${href}" class="group block">
              <div class="flex items-center gap-2"><span class="text-xs font-semibold text-slate-400">0${i + 1}</span>
                <span class="font-semibold text-slate-900 group-hover:text-brand-700">${t(title)}</span></div>
              <p class="text-sm text-slate-500 mt-0.5">${t(body)}</p>
            </a>
          </li>`).join('')}
      </ol>
    </div>`;

  const feature = (ic, title, body) => `
    <div class="card p-6">
      <span class="h-10 w-10 rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 grid place-items-center">${icon(ic)}</span>
      <h3 class="font-semibold mt-4">${t(title)}</h3>
      <p class="text-sm text-slate-500 mt-1.5 leading-relaxed">${t(body)}</p>
    </div>`;
  const point = (ic, title, body, dark = false) => `
    <div class="flex gap-4">
      <span class="shrink-0 h-10 w-10 rounded-xl grid place-items-center ${dark ? 'bg-white/10 text-teal-200 ring-1 ring-white/15' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'}">${icon(ic)}</span>
      <div><h3 class="font-semibold ${dark ? 'text-white' : ''}">${t(title)}</h3>
        <p class="text-sm mt-1 leading-relaxed ${dark ? 'text-slate-300' : 'text-slate-500'}">${t(body)}</p></div>
    </div>`;

  el.innerHTML = `
    <section class="hero-glow -mx-4 -mt-8 px-4 pt-14 pb-16 sm:pt-20 sm:pb-24 grid lg:grid-cols-2 gap-12 items-center">
      <div>
        <span class="eyebrow inline-flex items-center gap-2 rounded-full ring-1 ring-slate-200 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
          <span class="h-1.5 w-1.5 rounded-full bg-brand-500"></span>${t('Hospital visits, without the guesswork')}</span>
        <h1 class="text-4xl sm:text-[3.25rem] font-semibold tracking-tight mt-5 leading-[1.08] text-slate-900">${t('From “what’s wrong?” to “what do I do next?”')}</h1>
        <p class="text-lg text-slate-600 mt-5 max-w-xl leading-relaxed">${t('CareLoop guides you before, during and after a hospital visit: the right department, a checklist so you arrive ready, and a live queue so you know your turn.')}</p>
        <div class="flex flex-wrap gap-3 mt-8">
          <a href="#/symptoms" class="btn btn-primary">${icon('search', 'h-4 w-4')} ${t('Check your symptoms')}</a>
          <a href="${bookHref}" class="btn btn-ghost">${t(patient ? 'Book a visit' : signedIn ? 'Go to my dashboard' : 'Create a free account')}</a>
        </div>
        <p class="mt-6 text-sm text-slate-500 flex items-center gap-2">
          <span class="h-2 w-2 rounded-full bg-red-500"></span>${t('Emergency?')} <a href="tel:112" class="font-semibold text-red-700">112</a> · <a href="tel:108" class="font-semibold text-red-700">108</a>
        </p>
      </div>
      ${journey}
    </section>

    <section class="py-16">
      <div class="max-w-2xl">
        <h2 class="text-2xl sm:text-3xl font-semibold tracking-tight">${t('Everything for your visit, in one place')}</h2>
        <p class="text-slate-500 mt-3">${t('No more guessing which counter to go to, what to bring, or how long you’ll wait.')}</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
        ${feature('search', 'Symptom guide', 'Plain-language guidance to the right department, with emergency signs checked first.')}
        ${feature('clipboard', 'Readiness check', 'Know what to bring and when to start fasting. Every item shows the hospital instruction it came from.')}
        ${feature('clock', 'Honest wait times', 'Estimates based on how long visits really take, labelled clearly when there isn’t much data yet.')}
        ${feature('bell', 'Reminders that help', 'Appointment, preparation and medicine reminders by email or text, only when they’re needed.')}
        ${feature('users', 'Family caregivers', 'Share your visits and recovery plan with someone you trust, and remove access any time.')}
        ${feature('globe', 'हिन्दी and English', 'Switch language in one tap. Hospital instructions always show exactly as written.')}
      </div>
    </section>

    <section class="-mx-4 px-4 sm:mx-0 sm:px-0">
      <div class="rounded-none sm:rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950 px-6 sm:px-12 py-14 grid lg:grid-cols-5 gap-10 items-center">
        <div class="lg:col-span-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-teal-300">${t('For hospital teams')}</div>
          <h2 class="text-2xl sm:text-3xl font-semibold tracking-tight text-white mt-3">${t('Run a calmer front desk')}</h2>
          <p class="text-slate-300 mt-3">${t('Fewer “how long will it be?” questions, fewer unprepared arrivals, and empty slots that fill themselves.')}</p>
          <a href="#/login" class="btn mt-6 bg-white text-slate-900 hover:bg-slate-100">${t('Staff log in')}</a>
        </div>
        <div class="lg:col-span-3 grid sm:grid-cols-2 gap-8">
          ${point('monitor', 'Live queue console', 'Call, start and finish visits; the waiting-room screen and patients’ phones update instantly.', true)}
          ${point('pill', 'Discharge in minutes', 'Follow-up dates, tasks and medicine schedules, with reminders sent automatically.', true)}
          ${point('link', 'Slot rescue', 'Cancelled places are offered to patients waiting for an earlier time. First to accept moves up.', true)}
          ${point('chart', 'Clear analytics', 'Waiting times, no-shows and unprepared arrivals by department, exportable to CSV or PDF.', true)}
        </div>
      </div>
    </section>

    <section class="py-16 grid lg:grid-cols-5 gap-10">
      <div class="lg:col-span-2">
        <h2 class="text-2xl sm:text-3xl font-semibold tracking-tight">${t('Safe by design')}</h2>
        <p class="text-slate-500 mt-3">${t('CareLoop helps you find care and prepare. Medical decisions stay with your doctors.')}</p>
      </div>
      <div class="lg:col-span-3 grid sm:grid-cols-2 gap-8">
        ${point('alert', 'Emergencies first', 'Warning signs like chest pain or stroke symptoms go straight to 112 / 108, before anything else.')}
        ${point('shield', 'Never diagnoses', 'It suggests a department and how soon to go. No diagnoses, no medicine advice.')}
        ${point('clipboard', 'Hospital-verified', 'Preparation steps and medicines come from your care team, shown word for word.')}
        ${point('lock', 'Your data, your choice', 'Visits are shared with family only when you invite them, and you can stop at any time.')}
      </div>
    </section>

    <section class="card cta-band px-6 sm:px-10 py-10 mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
      <div>
        <h2 class="text-xl sm:text-2xl font-semibold tracking-tight">${t('Not sure where to go?')}</h2>
        <p class="text-slate-600 mt-1">${t('Start with the symptom guide. It takes about a minute.')}</p>
      </div>
      <div class="flex flex-wrap gap-3">
        <a href="#/symptoms" class="btn btn-primary">${t('Check your symptoms')}</a>
        <a href="#/conditions" class="btn btn-ghost">${t('Look up a condition')}</a>
      </div>
    </section>`;
}

// ---------- auth ----------

export async function login(el) {
  const demo = await api('/demo-accounts').catch(() => null);
  el.innerHTML = `
    <div class="max-w-md mx-auto py-10">
      <div class="card p-6 sm:p-8">
        <h1 class="text-2xl font-bold">${t('Log in')}</h1>
        <p class="text-slate-500 text-sm mt-1">${t('Patients, staff and admins all log in here.')}</p>
        <form id="f" class="mt-6 space-y-4">
          <div><label class="label" for="email">${t('Email')}</label><input class="input" id="email" name="email" type="email" required autocomplete="email" /></div>
          <div><label class="label" for="password">${t('Password')}</label><input class="input" id="password" name="password" type="password" required autocomplete="current-password" /></div>
          <button class="btn btn-primary w-full">${t('Log in')}</button>
        </form>
        <p class="text-sm text-slate-500 mt-4">${t('New patient?')} <a href="#/signup" class="text-brand-700 font-semibold">${t('Create an account')}</a></p>
      </div>
      ${demo ? `
      <div class="card p-5 mt-4">
        <div class="text-sm font-semibold">Demo accounts</div>
        <p class="text-xs text-slate-500 mt-1">Synthetic users from the seed data. Click one to fill the form.</p>
        <div class="mt-3 grid gap-2">
          ${demo.accounts.map((a) => `
            <button type="button" class="demo flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50" data-email="${esc(a.email)}">
              <span><span class="font-medium">${esc(a.full_name)}</span> <span class="text-slate-500">${esc(a.email)}</span></span>
              ${badge(a.role + (a.dept || a.note ? ` · ${a.dept || a.note}` : ''), a.role === 'patient' ? 'blue' : a.role === 'admin' ? 'amber' : 'teal')}
            </button>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  el.querySelectorAll('.demo').forEach((b) => b.addEventListener('click', () => {
    el.querySelector('#email').value = b.dataset.email;
    el.querySelector('#password').value = demo.password;
  }));
  el.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api('/auth/login', { method: 'POST', body: formData(e.target) });
      setSession(r.token, r.user);
      if (r.user.role === 'patient' && r.user.language === 'hi') setLang('hi');
      location.hash = qs().get('next') ? `#${qs().get('next')}` : homeFor(r.user);
    });
  });
}

export async function signup(el) {
  const { demo } = await api('/features').catch(() => ({ demo: true }));
  el.innerHTML = `
    <div class="max-w-md mx-auto py-10">
      <div class="card p-6 sm:p-8">
        <h1 class="text-2xl font-bold">Create a patient account</h1>
        <p class="text-slate-500 text-sm mt-1">Staff accounts are created by the hospital admin.</p>
        <form id="f" class="mt-6 space-y-4">
          <div><label class="label" for="n">${t('Full name')}</label><input class="input" id="n" name="full_name" required maxlength="100" autocomplete="name" /></div>
          <div><label class="label" for="e">Email</label><input class="input" id="e" name="email" type="email" required autocomplete="email" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label" for="ph">Phone <span class="font-normal text-slate-400">(optional)</span></label><input class="input" id="ph" name="phone" autocomplete="tel" /></div>
            <div><label class="label" for="dob">${t('Date of birth')}</label><input class="input" id="dob" name="date_of_birth" type="date" min="${dobMin()}" max="${localDate()}" /></div>
          </div>
          <div><label class="label" for="p">${t('Password')}</label><input class="input" id="p" name="password" type="password" minlength="8" maxlength="72" required autocomplete="new-password" /><p class="text-xs text-slate-500 mt-1">At least 8 characters.</p></div>
          <button class="btn btn-primary w-full">Create account</button>
        </form>
        <p class="text-sm text-slate-500 mt-4">Already registered? <a href="#/login" class="text-brand-700 font-semibold">Log in</a></p>
      </div>
      <p class="text-xs text-slate-400 text-center mt-4">${demo
        ? `${t(SYNTHETIC_NOTE)} Please don’t enter real health information.`
        : 'We only ask for what’s needed to book and manage your visits. Your details are shared with family only if you invite them.'}</p>
    </div>`;
  el.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api('/auth/signup', { method: 'POST', body: formData(e.target) });
      setSession(r.token, r.user);
      toast('Welcome to CareLoop');
      location.hash = '#/home';
    });
  });
}

export async function profile(el) {
  const [me, features] = await Promise.all([api('/me'), api('/features').catch(() => ({}))]);
  el.innerHTML = `
    ${pageTitle('Profile', esc(me.email))}
    <form id="f" class="card p-6 max-w-xl space-y-4">
      <div><label class="label" for="n">${t('Full name')}</label><input class="input" id="n" name="full_name" value="${esc(me.full_name)}" required maxlength="100" autocomplete="name" /></div>
      <div class="grid sm:grid-cols-2 gap-3">
        <div><label class="label" for="ph">Phone</label><input class="input" id="ph" name="phone" value="${esc(me.phone || '')}" placeholder="+91 98765 43210" autocomplete="tel" /></div>
        <div><label class="label" for="dob">${t('Date of birth')}</label><input class="input" id="dob" name="date_of_birth" type="date" min="${dobMin()}" max="${localDate()}" value="${esc(me.dob_ymd || '')}" /></div>
      </div>
      <div class="text-sm text-slate-500">Role: ${badge(me.role, 'teal')} ${me.department_name ? `· ${esc(me.department_name)}` : ''}</div>
      <button class="btn btn-primary">Save changes</button>
    </form>
    ${me.role === 'patient' ? `
      <label class="card p-5 max-w-xl mt-4 flex items-start gap-3 cursor-pointer">
        <input id="sms" type="checkbox" class="mt-1 h-5 w-5 accent-teal-700" ${me.sms_opt_in ? 'checked' : ''} />
        <span><span class="font-semibold">Text me reminders (SMS)</span>
          <span class="block text-sm text-slate-500">Medicine, appointment and follow-up reminders, and a text when it’s your turn in the queue. Uses the phone number above.${features.sms ? '' : ' <em>SMS isn’t connected on this server yet, so texts are only logged.</em>'}</span></span>
      </label>
      <label class="card p-5 max-w-xl mt-4 flex items-start gap-3 cursor-pointer">
        <input id="optin" type="checkbox" class="mt-1 h-5 w-5 accent-teal-700" ${me.slot_rescue_opt_in ? 'checked' : ''} />
        <span><span class="font-semibold">Offer me earlier slots</span>
          <span class="block text-sm text-slate-500">If someone cancels a slot before one of your bookings in the same department, we’ll offer it to you. The first person to accept gets it; your current booking stays until you accept.</span></span>
      </label>
      <a href="#/profile/caregivers" class="card p-5 max-w-xl mt-4 flex items-center justify-between hover:shadow-sm">
        <div><div class="font-semibold">Caregivers</div><div class="text-sm text-slate-500">Share your visits and recovery plan with family</div></div><span>→</span>
      </a>` : ''}`;
  el.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const u = await api('/me', { method: 'PATCH', body: formData(e.target) });
      setSession(S.token, { ...S.user, full_name: u.full_name });
      toast('Profile saved');
    });
  });
  el.querySelector('#sms')?.addEventListener('change', (e) => busy(e.target, async () => {
    try {
      await api('/me', { method: 'PATCH', body: { sms_opt_in: e.target.checked } });
    } catch (err) { e.target.checked = !e.target.checked; throw err; }
    toast(e.target.checked ? 'Text reminders turned on' : 'Text reminders turned off');
  }));
  el.querySelector('#optin')?.addEventListener('change', (e) => busy(e.target, async () => {
    try {
      await api('/me', { method: 'PATCH', body: { slot_rescue_opt_in: e.target.checked } });
    } catch (err) { e.target.checked = !e.target.checked; throw err; }
    toast(e.target.checked ? 'We’ll offer you earlier slots when they open up' : 'Earlier-slot offers turned off');
  }));
}

// ---------- symptom guide ----------

export async function symptoms(el) {
  const examples = ['Fever and body ache for 3 days', 'Itchy rash on my arms', 'Knee pain when climbing stairs', 'Sudden chest pain and sweating'];
  const ai = await api('/symptoms/ai-status').catch(() => ({ enabled: false }));
  el.innerHTML = `
    <div class="max-w-2xl mx-auto py-6">
      ${pageTitle('Symptom guide', 'Tell us how you feel. We suggest a department and how soon to be seen. We never diagnose.')}
      <div class="rounded-xl bg-red-50 ring-1 ring-red-200 text-red-800 text-sm p-4 mb-4">
        <strong>${t('In an emergency, don’t use this.')}</strong> ${t('Call {a} or {b} for an ambulance.', { a: '<a class="underline font-semibold" href="tel:112">112</a>', b: '<a class="underline font-semibold" href="tel:108">108</a>' })}
      </div>
      <form id="f" class="card p-5">
        <label class="label" for="t">${t('Describe your symptoms')}</label>
        <textarea class="input" id="t" name="text" rows="4" maxlength="1000" placeholder="${esc(t('e.g. I’ve had a sore throat and fever since yesterday'))}" required></textarea>
        <div class="flex flex-wrap gap-2 mt-3">
          ${examples.map((x) => `<button type="button" class="ex badge bg-slate-100 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200">${esc(x)}</button>`).join('')}
        </div>
        <button class="btn btn-primary mt-4">${t('Get guidance')}</button>
        ${ai.enabled ? '<p class="text-xs text-slate-500 mt-3">AI-assisted: your words are sent to Claude (Anthropic) only to recognise symptoms. The hospital’s own rules decide the department and urgency. Don’t include your name or other personal details.</p>' : ''}
      </form>
      <div id="result" class="mt-6"></div>
    </div>`;
  el.querySelectorAll('.ex').forEach((b) => b.addEventListener('click', () => { el.querySelector('#t').value = b.textContent; }));
  el.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = el.querySelector('#t').value.trim();
    busy(e.submitter, async () => {
      const r = await api('/symptoms/assess', { method: 'POST', body: { text } });
      el.querySelector('#result').innerHTML = renderAssessment(r, text);
      el.querySelector('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderAssessment(r, text) {
  const matched = r.matched.length
    ? `<p class="text-xs text-slate-500 mt-3">${t('Recognised:')} ${r.matched.map((m) => esc(m.replace(/_/g, ' '))).join(', ')}${r.aiFound?.length ? ` <span class="text-brand-700">(AI helped with: ${r.aiFound.map((m) => esc(m.replace(/_/g, ' '))).join(', ')})</span>` : ''}</p>` : '';
  if (r.emergency) {
    return `
      <div class="rounded-2xl bg-red-600 text-white p-6 shadow-lg">
        <div class="text-sm font-bold uppercase tracking-wide opacity-90">${t('Possible emergency')}</div>
        <p class="text-xl font-semibold mt-2">${esc(t('EMERGENCY_MESSAGE') === 'EMERGENCY_MESSAGE' ? r.message : t('EMERGENCY_MESSAGE'))}</p>
        <div class="flex flex-wrap gap-3 mt-5">
          <a href="tel:112" class="btn bg-white text-red-700 hover:bg-red-50">${t('Call 112')}</a>
          <a href="tel:108" class="btn bg-white/10 text-white ring-1 ring-white/60 hover:bg-white/20">${t('Call 108 (ambulance)')}</a>
        </div>
        <p class="text-xs mt-4 opacity-90">${r.matched.map((m) => esc(m.replace(/_/g, ' '))).join(', ')}</p>
      </div>`;
  }
  const u = URGENCY[r.urgency];
  const book = `#/book?dept=${r.department.id}&session=${r.sessionId}&reason=${encodeURIComponent(text.slice(0, 200))}`;
  return `
    <div class="card p-6">
      <div class="flex flex-wrap items-center gap-2">${urgencyBadge(r.urgency)} <span class="text-sm text-slate-500">${esc(t(u?.[2] || ''))}</span></div>
      <div class="text-sm text-slate-500 mt-4">${t('Suggested department')}</div>
      <div class="text-2xl font-bold">${esc(t(r.department.name))}</div>
      ${r.note ? `<p class="text-sm text-slate-600 mt-2">${esc(t(r.note))}</p>` : ''}
      ${matched}
      <div class="flex flex-wrap gap-3 mt-5">
        <a href="${S.user ? book : `#/login?next=${encodeURIComponent(book.slice(1))}`}" class="btn btn-primary">${t('Book a visit in {dept}', { dept: esc(t(r.department.name)) })}</a>
      </div>
      <p class="text-xs text-slate-500 mt-5 border-t border-slate-100 pt-4">${esc(t('DISCLAIMER') === 'DISCLAIMER' ? r.disclaimer : t('DISCLAIMER'))}</p>
    </div>`;
}

// ---------- QR check-in (opened by scanning the code at reception) ----------

export async function qrCheckin(el, { dept }) {
  el.innerHTML = '<div class="py-16 text-center text-slate-500">Checking you in…</div>';
  try {
    const r = await api('/checkin/qr', { method: 'POST', body: { department_id: dept, code: qs().get('code') } });
    toast(`Checked in. Your token is ${r.tokenNumber}`);
    location.replace(`#/visits/${r.visitId}/queue`);
  } catch (e) {
    el.innerHTML = `
      <div class="card p-8 text-center max-w-lg mx-auto mt-8">
        <div class="text-4xl">⚠️</div>
        <h1 class="text-xl font-bold mt-3">Couldn’t check you in</h1>
        <p class="text-slate-600 mt-2">${esc(e.message)}</p>
        <a href="#/home" class="btn btn-ghost mt-5">Go to my visits</a>
      </div>`;
  }
}

// ---------- condition lookup ----------

export async function conditions(el) {
  el.innerHTML = `
    <div class="max-w-4xl mx-auto py-6">
      ${pageTitle('Condition lookup', 'Search a condition to see its common symptoms, which department treats it, and trusted sources.')}
      <input id="q" class="input text-base" type="search" placeholder="e.g. dengue, asthma, UTI, back pain" autocomplete="off" aria-label="Search conditions" value="${esc(qs().get('q') || '')}" />
      <p class="text-xs text-slate-500 mt-2">General information only, not a diagnosis. If you have symptoms, use the <a href="#/symptoms" class="text-brand-700 font-semibold">symptom guide</a> or speak to a doctor.</p>
      <div id="list" class="grid sm:grid-cols-2 gap-4 mt-6"></div>
    </div>`;
  const list = el.querySelector('#list');
  let timer;
  async function load() {
    const rows = await api(`/conditions?q=${encodeURIComponent(el.querySelector('#q').value)}`);
    list.innerHTML = rows.length ? rows.map((c) => `
      <article class="card p-5 ${c.urgent ? 'ring-2 ring-red-300' : ''}">
        <div class="flex items-start justify-between gap-2">
          <h2 class="font-semibold text-lg">${esc(c.name)}</h2>
          ${c.urgent ? badge('Emergency', 'red') : badge(c.department, 'teal')}
        </div>
        <p class="text-sm text-slate-600 mt-1">${esc(c.summary)}</p>
        <div class="text-xs font-semibold text-slate-500 mt-3">Common symptoms</div>
        <ul class="text-sm mt-1 space-y-0.5 list-disc ml-5">${c.symptoms.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        ${c.urgent ? '<div class="mt-3 rounded-lg bg-red-50 text-red-800 text-sm p-2">If you notice these signs, call <a class="font-semibold underline" href="tel:112">112</a> or <a class="font-semibold underline" href="tel:108">108</a> now.</div>' : ''}
        <div class="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-slate-100 text-sm">
          ${c.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" class="text-brand-700 font-semibold">${esc(s.name)} ↗</a>`).join('')}
          ${!c.urgent && c.department_id ? `<a href="${S.user ? `#/book?dept=${c.department_id}` : '#/login'}" class="ml-auto btn btn-ghost btn-sm">Book ${esc(c.department)}</a>` : ''}
        </div>
      </article>`).join('') : `<div class="sm:col-span-2">${empty('No matching condition. Try another word, or use the symptom guide.')}</div>`;
  }
  el.querySelector('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 200); });
  await load();
}

// ---------- patient home & visits ----------

const upcoming = (v) => ['booked', 'checked_in', 'in_service'].includes(v.status) && new Date(v.starts_at) >= new Date(new Date().setHours(0, 0, 0, 0));

export async function home(el) {
  const [visits, banner] = await Promise.all([api('/visits'), offerBanner()]);
  const next = visits.filter(upcoming).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const first = next[0];
  const recovering = visits.filter((v) => v.status === 'completed' && v.follow_up_id && (!v.follow_up_date || v.follow_up_date >= localDate()));
  el.innerHTML = `
    ${pageTitle(t('Hello, {name}', { name: esc(S.user.full_name.split(' ')[0]) }), 'Here’s what’s coming up.', `<a href="#/book" class="btn btn-primary">${t('Book a visit')}</a><a href="#/symptoms" class="btn btn-ghost">${t('Symptom guide')}</a>`)}
    ${banner}
    ${first ? `
      <div class="card p-6 border-brand-500 ring-1 ring-brand-100">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-xs font-bold uppercase tracking-wide text-brand-700">${t(isToday(first.starts_at) ? 'Today' : 'Next visit')}</div>
            <div class="text-xl font-bold mt-1">${esc(t(first.department_name))}${first.test_name ? ` · ${esc(first.test_name)}` : ''}</div>
            <div class="text-slate-500 mt-1">${fmtDT(first.starts_at)} · ${esc(first.department_location)}</div>
          </div>
          <div class="flex gap-2">${visitBadge(first.status)} ${readinessBadge(first.readiness)}</div>
        </div>
        <div class="flex flex-wrap gap-2 mt-5">
          <a href="#/visits/${first.id}/prepare" class="btn ${first.readiness === 'at_risk' ? 'btn-primary' : 'btn-ghost'}">${t('Prepare')}</a>
          <a href="#/visits/${first.id}/queue" class="btn ${isToday(first.starts_at) && first.readiness !== 'at_risk' ? 'btn-primary' : 'btn-ghost'}">${first.token_number ? t('Token {n}', { n: esc(first.token_number) }) : t('Check in & queue')}</a>
          <a href="#/visits/${first.id}" class="btn btn-ghost">${t('Details')}</a>
        </div>
      </div>` : empty('No upcoming visits.', `<a href="#/book" class="btn btn-primary">${t('Book a visit')}</a>`)}
    ${recovering.length ? `
      <h2 class="font-semibold mt-8 mb-3">${t('Recovering')}</h2>
      <div class="grid gap-3">${recovering.map((v) => `
        <a href="#/visits/${v.id}/recovery" class="card p-4 flex flex-wrap items-center justify-between gap-3 hover:shadow-sm">
          <div>
            <div class="font-semibold">${t('Recovery plan · {dept}', { dept: esc(t(v.department_name)) })}</div>
            <div class="text-sm text-slate-500">Seen ${fmtDate(v.starts_at)}${v.follow_up_date ? ` · follow-up ${fmtDate(`${v.follow_up_date}T00:00:00`)}` : ''}</div>
          </div>
          <span class="text-sm font-semibold text-brand-700">${t('Tasks & medicine times →')}</span>
        </a>`).join('')}</div>` : ''}
    ${next.length > 1 ? `
      <h2 class="font-semibold mt-8 mb-3">${t('Also coming up')}</h2>
      <div class="grid gap-3">${next.slice(1).map(visitRow).join('')}</div>` : ''}`;
}

const visitRow = (v) => `
  <a href="#/visits/${v.id}" class="card p-4 flex flex-wrap items-center justify-between gap-3 hover:shadow-sm">
    <div>
      <div class="font-semibold">${esc(v.department_name)}${v.test_name ? ` · ${esc(v.test_name)}` : ''}</div>
      <div class="text-sm text-slate-500">${fmtDT(v.starts_at)}</div>
    </div>
    <div class="flex gap-2">${visitBadge(v.status)} ${upcoming(v) ? readinessBadge(v.readiness) : ''}</div>
  </a>`;

export async function visitsList(el) {
  const visits = await api('/visits');
  const up = visits.filter(upcoming).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = visits.filter((v) => !upcoming(v));
  el.innerHTML = `
    ${pageTitle('My visits', '', '<a href="#/book" class="btn btn-primary">Book a visit</a>')}
    <h2 class="font-semibold mb-3">Upcoming</h2>
    ${up.length ? `<div class="grid gap-3">${up.map(visitRow).join('')}</div>` : empty('Nothing booked.')}
    <h2 class="font-semibold mt-8 mb-3">Past and cancelled</h2>
    ${past.length ? `<div class="grid gap-3">${past.map(visitRow).join('')}</div>` : empty('No past visits yet.')}`;
}

// ---------- booking ----------

export async function book(el) {
  const p = qs();
  const departments = await api('/departments');
  const today = localDate();
  const maxDate = localDate(new Date(Date.now() + 7 * 864e5));
  el.innerHTML = `
    ${pageTitle('Book a visit', 'Pick a department, an optional test, and a time.')}
    <form id="f" class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 space-y-5">
        <div class="card p-5 space-y-4">
          <div><label class="label" for="dept">Department</label>
            <select class="input" id="dept" required>
              <option value="">Choose a department</option>
              ${departments.map((d) => `<option value="${d.id}" ${d.id === p.get('dept') ? 'selected' : ''}>${esc(d.name)} · ${esc(d.location)}</option>`).join('')}
            </select>
            <p id="deptdesc" class="text-xs text-slate-500 mt-1"></p>
          </div>
          <div><label class="label" for="test">Test <span class="font-normal text-slate-400">(optional)</span></label>
            <select class="input" id="test" disabled><option value="">Consultation only</option></select>
            <p id="testinfo" class="text-xs text-slate-500 mt-1"></p>
          </div>
          <div><label class="label" for="reason">Reason for visit <span class="font-normal text-slate-400">(optional)</span></label>
            <textarea class="input" id="reason" rows="2" maxlength="500">${esc(p.get('reason') || '')}</textarea>
          </div>
        </div>
        <div class="card p-5">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div><label class="label" for="date">Date</label><input class="input" type="date" id="date" value="${today}" min="${today}" max="${maxDate}" /></div>
            <span class="text-xs text-slate-500">Slots open up to 7 days ahead.</span>
          </div>
          <div id="slots" class="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-4"><p class="col-span-full text-sm text-slate-500">Choose a department to see times.</p></div>
        </div>
      </div>
      <aside class="card p-5 h-fit lg:sticky lg:top-20">
        <div class="font-semibold">Summary</div>
        <dl id="summary" class="text-sm mt-3 space-y-2 text-slate-600"></dl>
        <button id="confirm" class="btn btn-primary w-full mt-5" disabled>Confirm booking</button>
        ${p.get('session') ? `<p class="text-xs text-slate-500 mt-3">Linked to your symptom guide result.</p>` : ''}
      </aside>
    </form>`;

  const $ = (s) => el.querySelector(s);
  let tests = [];
  let slot = null;

  function summary() {
    const d = departments.find((x) => x.id === $('#dept').value);
    const t = tests.find((x) => x.id === $('#test').value);
    $('#summary').innerHTML = `
      <div class="flex justify-between gap-3"><dt>Department</dt><dd class="font-medium text-slate-900 text-right">${d ? esc(d.name) : '–'}</dd></div>
      <div class="flex justify-between gap-3"><dt>Test</dt><dd class="font-medium text-slate-900 text-right">${t ? esc(t.name) : 'None'}</dd></div>
      <div class="flex justify-between gap-3"><dt>Time</dt><dd class="font-medium text-slate-900 text-right">${slot ? fmtDT(slot.starts_at) : '–'}</dd></div>
      ${t?.requires_fasting ? `<div class="rounded-lg bg-amber-50 text-amber-800 p-2 text-xs">Needs ${t.fasting_hours} hours of fasting. Morning slots are easier.</div>` : ''}`;
    $('#confirm').disabled = !slot;
  }

  async function loadSlots() {
    slot = null;
    summary();
    const d = $('#dept').value;
    if (!d) return;
    $('#slots').innerHTML = '<p class="col-span-full text-sm text-slate-500">Loading…</p>';
    const slots = await api(`/departments/${d}/slots?date=${$('#date').value}`);
    $('#slots').innerHTML = slots.length
      ? slots.map((s) => `<button type="button" class="slot rounded-lg border border-slate-200 py-2 text-sm font-medium hover:border-brand-500" data-id="${s.id}">${fmtTime(s.starts_at)}<span class="block text-[11px] font-normal text-slate-500">${s.capacity - s.booked_count} left</span></button>`).join('')
      : '<p class="col-span-full text-sm text-slate-500">No open slots on this day. Try another date.</p>';
    $('#slots').querySelectorAll('.slot').forEach((b) => b.addEventListener('click', () => {
      $('#slots').querySelectorAll('.slot').forEach((x) => x.classList.remove('bg-brand-700', 'text-white', 'border-brand-700'));
      b.classList.add('bg-brand-700', 'text-white', 'border-brand-700');
      slot = slots.find((s) => s.id === b.dataset.id);
      summary();
    }));
  }

  async function loadDept() {
    const d = departments.find((x) => x.id === $('#dept').value);
    $('#deptdesc').textContent = d?.description || '';
    tests = d ? await api(`/departments/${d.id}/tests`) : [];
    $('#test').innerHTML = `<option value="">Consultation only</option>${tests.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}`;
    $('#test').disabled = !tests.length;
    $('#testinfo').textContent = '';
    await loadSlots();
  }

  $('#dept').addEventListener('change', loadDept);
  $('#date').addEventListener('change', loadSlots);
  $('#test').addEventListener('change', () => {
    const t = tests.find((x) => x.id === $('#test').value);
    $('#testinfo').textContent = t ? `Bring: ${t.required_documents.join(', ') || 'nothing extra'}${t.requires_fasting ? ` · Fasting ${t.fasting_hours} h` : ''}` : '';
    summary();
  });
  $('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('#confirm'), async () => {
      const v = await api('/visits', {
        method: 'POST',
        body: { slot_id: slot.id, test_id: $('#test').value || null, reason: $('#reason').value || null, symptom_session_id: p.get('session') || null },
      });
      toast('Visit booked');
      location.hash = `#/visits/${v.id}/prepare`;
    });
  });
  if ($('#dept').value) await loadDept(); else summary();
}

// ---------- visit pages ----------

export function visitHeader(v, active) {
  const tab = (key, label, href) =>
    `<a href="${href}" class="px-3 py-2 text-sm font-semibold border-b-2 whitespace-nowrap ${active === key ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-900'}">${t(label)}</a>`;
  const caregiver = v.access === 'caregiver';
  return `
    <a href="${caregiver ? '#/caring' : '#/visits'}" class="text-sm text-slate-500 hover:text-slate-900">← ${t(caregiver ? 'People I care for' : 'My visits')}</a>
    ${caregiver ? `<div class="mt-3 rounded-lg bg-sky-50 text-sky-800 ring-1 ring-sky-200 px-3 py-2 text-sm">You’re viewing <strong>${esc(v.patient_name)}</strong>’s visit as a caregiver${v.can_tick_post ? '. You can tick their recovery tasks.' : ' (view only).'}</div>` : ''}
    <div class="flex flex-wrap items-start justify-between gap-3 mt-2">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">${esc(v.department_name)}${v.test_name ? ` · ${esc(v.test_name)}` : ''}</h1>
        <p class="text-slate-500 mt-1">${fmtDT(v.starts_at)} · ${esc(v.department_location)}</p>
      </div>
      <div id="vbadges" class="flex gap-2">${visitBadge(v.status)} ${readinessBadge(v.readiness)}</div>
    </div>
    <nav class="flex gap-2 border-b border-slate-200 mt-5 mb-6 overflow-x-auto">
      ${tab('overview', 'Overview', `#/visits/${v.id}`)}
      ${tab('prepare', 'Prepare', `#/visits/${v.id}/prepare`)}
      ${tab('queue', 'Queue', `#/visits/${v.id}/queue`)}
      ${tab('recovery', 'Recovery', `#/visits/${v.id}/recovery`)}
    </nav>`;
}

export async function visitDetail(el, { id }) {
  const v = await api(`/visits/${id}`);
  el.innerHTML = `
    ${visitHeader(v, 'overview')}
    <div class="grid md:grid-cols-2 gap-4">
      <div class="card p-5">
        <dl class="text-sm space-y-3">
          <div><dt class="text-slate-500">When</dt><dd class="font-medium">${fmtDT(v.starts_at)}</dd></div>
          <div><dt class="text-slate-500">Where</dt><dd class="font-medium">${esc(v.department_name)}, ${esc(v.department_location)}</dd></div>
          <div><dt class="text-slate-500">Test</dt><dd class="font-medium">${esc(v.test_name || 'Consultation only')}</dd></div>
          <div><dt class="text-slate-500">Reason</dt><dd class="font-medium">${esc(v.reason || '–')}</dd></div>
          ${v.token_number ? `<div><dt class="text-slate-500">Token</dt><dd class="font-medium">${esc(v.token_number)} ${tokenBadge(v.token_status)}</dd></div>` : ''}
        </dl>
      </div>
      <div class="card p-5 space-y-3">
        <div class="font-semibold">Next steps</div>
        <a href="#/visits/${v.id}/prepare" class="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm hover:bg-slate-100"><span>Check what to bring and do</span>${readinessBadge(v.readiness)}</a>
        <a href="#/visits/${v.id}/queue" class="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm hover:bg-slate-100"><span>${v.token_number ? 'Track your place in the queue' : 'Check in on the day'}</span><span>→</span></a>
        <a href="#/visits/${v.id}/recovery" class="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm hover:bg-slate-100"><span>Recovery plan and medicine times</span><span>→</span></a>
        ${v.status === 'booked' && v.access === 'owner' ? `<button id="cancel" class="btn btn-danger w-full">Cancel this visit</button>` : ''}
      </div>
    </div>`;
  el.querySelector('#cancel')?.addEventListener('click', (e) => {
    if (!confirm('Cancel this visit? The slot will be released for someone else.')) return;
    busy(e.currentTarget, async () => {
      await api(`/visits/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      toast('Visit cancelled');
      location.hash = '#/visits';
    });
  });
}

function readinessBanner(r, v) {
  if (r.readiness === 'ready') return `<div class="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800 p-4"><strong>${t('You’re ready.')}</strong> ${t('All documents and fasting steps are confirmed.')}</div>`;
  if (r.readiness === 'at_risk') {
    return `<div class="rounded-xl bg-red-50 ring-1 ring-red-200 text-red-800 p-4">
      <strong>${t('Not ready yet.')}</strong> ${t('Sort these out before you travel:')}
      <ul class="list-disc ml-5 mt-2 text-sm space-y-1">${r.flags.filter((f) => !f.pending).map((f) => `<li>${esc(f.text)} <span class="opacity-75">(${esc(f.reason)})</span></li>`).join('')}</ul>
    </div>`;
  }
  const pending = r.flags.filter((f) => f.pending);
  if (pending.length) {
    return `<div class="rounded-xl bg-amber-50 ring-1 ring-amber-200 text-amber-900 p-4">
      <strong>Coming up:</strong> ${pending.map((f) => `fasting starts ${f.fastingStartsAt ? fmtDT(f.fastingStartsAt) : 'before your slot'}`).join('; ')}. Tick it once you’ve started.
    </div>`;
  }
  return `<div class="rounded-xl bg-slate-100 text-slate-700 p-4">No special preparation for this visit${v.test_name ? '' : '. Bring any previous prescriptions or reports you have'}.</div>`;
}

export async function prepare(el, { id }) {
  const [v, items, r] = await Promise.all([api(`/visits/${id}`), api(`/visits/${id}/checklists/pre_visit`), api(`/visits/${id}/readiness`)]);
  const editable = v.access === 'owner' && ['booked', 'checked_in'].includes(v.status);
  el.innerHTML = `
    ${visitHeader(v, 'prepare')}
    <div id="banner">${readinessBanner(r, v)}</div>
    <div class="card mt-5 divide-y divide-slate-100">
      ${items.length ? items.map((it) => `
        <div class="p-4 flex gap-3">
          <input type="checkbox" class="tick mt-1 h-5 w-5 accent-teal-700 shrink-0" data-id="${it.id}" ${it.is_done ? 'checked' : ''} ${editable && it.item_type !== 'info' ? '' : 'disabled'} aria-label="Mark done" />
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">${itemBadge(it.item_type)} ${it.item_type === 'fasting' && it.due_at ? `<span class="text-xs text-slate-500">from ${fmtDT(it.due_at)}</span>` : ''}</div>
            <p class="mt-1 ${it.is_done ? 'line-through text-slate-400' : ''}">${esc(it.text)}</p>
            ${it.source_ref ? `
              <details class="mt-2 text-xs text-slate-500">
                <summary class="cursor-pointer hover:text-slate-700">Source: ${esc(it.source_ref)} · v${it.source_version}</summary>
                <div class="mt-2 rounded-lg bg-slate-50 p-3">
                  <div class="italic">“${esc(it.source_text)}”</div>
                  <div class="mt-1">Verified by ${esc(it.verified_by_name || 'hospital staff')} on ${fmtDate(it.source_verified_at)}</div>
                </div>
              </details>` : ''}
          </div>
        </div>`).join('') : `<div class="p-6 text-slate-500 text-sm">This visit has no test-specific checklist. Bring a photo ID and any previous prescriptions or reports.</div>`}
    </div>
    <p class="text-xs text-slate-500 mt-3">Every item comes word for word from the hospital’s verified instructions. CareLoop never writes or changes medical advice.</p>`;
  el.querySelectorAll('.tick').forEach((cb) => cb.addEventListener('change', () => {
    busy(cb, async () => {
      let res;
      try {
        res = await api(`/checklist-items/${cb.dataset.id}`, { method: 'PATCH', body: { is_done: cb.checked } });
      } catch (e) {
        cb.checked = !cb.checked;
        throw e;
      }
      const text = cb.closest('.flex').querySelector('p');
      text.classList.toggle('line-through', cb.checked);
      text.classList.toggle('text-slate-400', cb.checked);
      v.readiness = res.readiness;
      el.querySelector('#banner').innerHTML = readinessBanner(res, v);
      el.querySelector('#vbadges').innerHTML = `${visitBadge(v.status)} ${readinessBadge(v.readiness)}`;
    });
  }));
}

// ---------- live queue ----------

function waitText(s) {
  if (s.status === 'called') return '';
  if (!s.estimatedWaitMin) return t('You’re next');
  const range = s.rangeMin ? `${s.rangeMin[0]} to ${s.rangeMin[1]} min` : '';
  return `~${s.estimatedWaitMin} min${range ? `<div class="text-xs font-normal text-slate-500">${range}</div>` : ''}`;
}

function confidenceText(s) {
  if (s.confidence === 'normal') return t('Based on {n} recent visits in this department.', { n: s.samples });
  if (s.basis === 'default') return `<strong>${t('Low confidence:')}</strong> not enough recent visits, so this uses the hospital’s standard time per patient.`;
  return `<strong>${t('Low confidence:')}</strong> based on only ${s.samples} recent visits.`;
}


export async function queuePage(el, { id }) {
  const v = await api(`/visits/${id}`);
  el.innerHTML = `${visitHeader(v, 'queue')}<div id="q"></div>`;
  const box = el.querySelector('#q');
  let status = v.token_number ? await api(`/visits/${id}/queue-status`) : null;
  let alertMsg = null;
  const setStatus = (s) => {
    v.status = s;
    el.querySelector('#vbadges').innerHTML = `${visitBadge(v.status)} ${readinessBadge(v.readiness)}`;
  };

  function draw() {
    if (['completed', 'no_show', 'cancelled'].includes(v.status) && !alertMsg) {
      box.innerHTML = v.status === 'completed'
        ? empty('This visit is complete.', `<a href="#/visits/${id}/recovery" class="btn btn-primary">See recovery plan</a>`)
        : empty(`This visit is ${v.status.replace('_', ' ')}.`);
      return;
    }
    if (!status) {
      const today = isToday(v.starts_at) && v.access === 'owner';
      box.innerHTML = `
        <div class="card p-8 text-center max-w-lg mx-auto">
          <div class="text-4xl">📍</div>
          <h2 class="text-xl font-bold mt-3">${t(today ? 'Arrived at the hospital?' : 'Check-in opens on the day')}</h2>
          <p class="text-slate-500 mt-2">${today ? t('Check in to get your token and see your place in the queue.') : `${fmtDT(v.starts_at)}`}</p>
          ${v.readiness === 'at_risk' ? `<p class="mt-3 text-sm text-red-700">Your checklist still has missing items. <a class="underline" href="#/visits/${id}/prepare">Review it</a> before checking in.</p>` : ''}
          ${today ? `<button id="checkin" class="btn btn-primary mt-5 px-8">${t('Check in')}</button>` : ''}
        </div>`;
      box.querySelector('#checkin')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        status = await api(`/visits/${id}/check-in`, { method: 'POST' });
        setStatus('checked_in');
        toast(`Checked in. Your token is ${status.tokenNumber}`);
        draw();
      }));
      return;
    }
    if (status.status === 'skipped') {
      box.innerHTML = status.noShow
        ? empty('Your token was skipped and the grace period has ended, so this visit is marked as missed. Please speak to reception or book again.', '<a href="#/book" class="btn btn-primary">Book again</a>')
        : `<div class="card p-8 text-center max-w-lg mx-auto ring-2 ring-amber-300">
            <div class="text-sm text-slate-500">${t('Your token')}</div>
            <div class="text-5xl font-bold tracking-tight mt-1">${esc(status.tokenNumber)}</div>
            <h2 class="text-xl font-bold mt-4 text-amber-800">${t('You missed your turn')}</h2>
            <p class="text-slate-600 mt-2">Go to ${esc(v.department_name)} (${esc(v.department_location)})${status.graceUntil ? ` by <strong>${fmtTime(status.graceUntil)}</strong>` : ''} and staff can put you back next in line.</p>
          </div>`;
      return;
    }
    const called = status.status === 'called' || status.status === 'serving';
    box.innerHTML = `
      ${alertMsg ? `<div class="rounded-xl ${alertMsg.tone} p-4 mb-4 font-semibold">${alertMsg.text}</div>` : ''}
      <div class="grid md:grid-cols-3 gap-4">
        <div class="card p-6 md:col-span-1 text-center ${called ? 'ring-2 ring-brand-500' : ''}">
          <div class="text-sm text-slate-500">${t('Your token')}</div>
          <div class="text-5xl font-bold tracking-tight mt-1 ${called ? 'text-brand-700' : ''}">${esc(status.tokenNumber)}</div>
          <div class="mt-3">${tokenBadge(status.status)}</div>
        </div>
        <div class="card p-6 md:col-span-2">
          ${called ? `
            <div class="flex items-center gap-4">
              <div class="h-4 w-4 rounded-full bg-brand-500 pulse"></div>
              <div><div class="text-2xl font-bold">${t(status.status === 'serving' ? 'You’re being seen' : 'It’s your turn')}</div>
              <div class="text-slate-500">${t('Please go to {place}.', { place: `${esc(t(v.department_name))}, ${esc(v.department_location)}` })}</div></div>
            </div>` : `
            <div class="grid grid-cols-2 gap-4">
              <div class="rounded-xl bg-slate-50 p-4"><div class="text-xs text-slate-500">${t('Position')}</div><div class="text-3xl font-bold">${ordinal(status.position)}</div><div class="text-xs text-slate-500">${t('{n} ahead of you', { n: status.ahead })}</div></div>
              <div class="rounded-xl bg-slate-50 p-4"><div class="text-xs text-slate-500">${t('Estimated wait')}</div><div class="text-3xl font-bold">${waitText(status)}</div></div>
            </div>
            <p class="text-xs text-slate-500 mt-3">${confidenceText(status)}</p>`}
          <div class="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-slate-100">
            <span class="text-xs text-slate-500 flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-emerald-500"></span> ${t('Live: updates automatically')}</span>
            ${'Notification' in window && Notification.permission === 'default' ? `<button id="notify" class="btn btn-ghost btn-sm">${t('Alert me when it’s my turn')}</button>` : ''}
          </div>
        </div>
      </div>`;
    box.querySelector('#notify')?.addEventListener('click', () => Notification.requestPermission().then(draw));
  }

  joinRoom(`visit:${id}`, {
    'token:position': (s) => {
      status = s;
      if (s.status === 'serving' && v.status !== 'in_service') setStatus('in_service');
      draw();
    },
    'token:called': (d) => {
      alertMsg = { tone: 'bg-brand-700 text-white', text: `Token ${esc(d.tokenNumber)} called. Please go to ${esc(d.location || v.department_location)}.` };
      if ('Notification' in window && Notification.permission === 'granted') new Notification('CareLoop: it’s your turn', { body: `Token ${d.tokenNumber}: go to ${d.location || v.department_location}` });
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      draw();
    },
    'token:skipped': (d) => {
      status = { ...status, status: 'skipped', graceUntil: d.until, noShow: false };
      if ('Notification' in window && Notification.permission === 'granted') new Notification('CareLoop: you missed your turn', { body: `Go to ${v.department_location} within ${d.graceMinutes} minutes to keep your place.` });
      draw();
    },
    'visit:no_show': () => { status = { ...(status || {}), status: 'skipped', noShow: true }; setStatus('no_show'); draw(); },
    'visit:completed': () => { alertMsg = { tone: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200', text: `Your visit is complete. Your <a class="underline" href="#/visits/${id}/recovery">recovery plan</a> will appear once staff add it.` }; setStatus('completed'); draw(); },
  });
  draw();
}
