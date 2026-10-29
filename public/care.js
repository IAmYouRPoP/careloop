// Phase 2 views: recovery checklist, caregiver sharing, reminders, and staff discharge entry.
import {
  S, api, esc, fmtDT, fmtTime, fmtDate, localDate, badge, visitBadge, itemBadge, toast, busy, pageTitle, empty,
  formData, joinRoom, t,
} from './lib.js';
import { visitHeader } from './patient.js';

const day = (ymd) => new Date(`${ymd}T00:00:00`);
const fmtDay = (ymd) => day(ymd).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtHM = (hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return fmtTime(d); };
const daysUntil = (ymd) => Math.round((day(ymd) - day(localDate())) / 864e5);

// ---------- recovery (patient & caregiver) ----------

function medicationCard(m) {
  const today = localDate();
  const active = m.start_date <= today && today <= m.end_date;
  const now = new Date();
  const doses = m.times_of_day.map((t) => {
    const [h, min] = t.split(':').map(Number);
    const at = new Date(); at.setHours(h, min, 0, 0);
    const passed = at < now;
    return `<span class="badge ${passed ? 'bg-slate-100 text-slate-400 ring-1 ring-slate-200 line-through' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'}">${fmtHM(t)}</span>`;
  }).join(' ');
  return `
    <div class="p-4">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div><div class="font-semibold">${esc(m.name)}</div><div class="text-sm mt-0.5">${esc(m.dose_text)}</div></div>
        ${active ? badge(`${daysUntil(m.end_date) + 1} days left`, 'teal') : m.end_date < today ? badge('Finished', 'gray') : badge(`Starts ${fmtDay(m.start_date)}`, 'blue')}
      </div>
      <div class="flex flex-wrap items-center gap-2 mt-3 text-xs text-slate-500">
        ${active ? `<span>${t('Today:')}</span> ${doses}` : `<span>${m.times_of_day.map(fmtHM).join(', ')}</span>`}
        <span class="ml-auto">${fmtDay(m.start_date)} to ${fmtDay(m.end_date)}</span>
      </div>
    </div>`;
}

export async function recovery(el, { id }) {
  const v = await api(`/visits/${id}`);
  el.innerHTML = `${visitHeader(v, 'recovery')}<div id="body"></div>`;
  const body = el.querySelector('#body');

  async function load() {
    const [{ follow_up: f, medications }, items] = await Promise.all([
      api(`/visits/${id}/follow-up`), api(`/visits/${id}/checklists/post_visit`),
    ]);
    if (!f) {
      body.innerHTML = empty(v.status === 'completed' || v.status === 'in_service'
        ? 'Your care team hasn’t added a recovery plan yet. It will appear here as soon as they do.'
        : 'Your recovery plan will appear here after your visit.');
      return;
    }
    const left = f.follow_up_date ? daysUntil(f.follow_up_date) : null;
    const done = items.filter((i) => i.is_done).length;
    body.innerHTML = `
      <div class="grid md:grid-cols-3 gap-4">
        <div class="card p-5">
          <div class="text-xs text-slate-500">${t('Follow-up visit')}</div>
          ${f.follow_up_date ? `
            <div class="text-2xl font-bold mt-1">${fmtDay(f.follow_up_date)}</div>
            <div class="text-sm text-slate-500">${left === 0 ? t('Today') : left === 1 ? t('Tomorrow') : left > 0 ? t('In {n} days', { n: left }) : 'Date has passed'} · ${esc(t(v.department_name))}</div>
            ${v.access === 'owner' && left >= 0 ? `<a href="#/book?dept=${v.department_id}&reason=${encodeURIComponent('Follow-up visit')}" class="btn btn-ghost btn-sm mt-4">${t('Book follow-up slot')}</a>` : ''}`
            : '<div class="text-lg font-semibold mt-1">Not needed</div><div class="text-sm text-slate-500">Unless you feel worse.</div>'}
        </div>
        <div class="card p-5 md:col-span-2">
          <div class="text-xs text-slate-500">${t('From your care team')}</div>
          <p class="mt-1 whitespace-pre-line">${esc(f.notes || 'No extra notes.')}</p>
          <p class="text-xs text-slate-400 mt-3">Entered by ${esc(f.entered_by_name)} · ${fmtDT(f.updated_at)}</p>
        </div>
      </div>

      <h2 class="font-semibold mt-8 mb-3">${t('Medicines')}</h2>
      ${medications.length ? `<div class="card divide-y divide-slate-100">${medications.map(medicationCard).join('')}</div>
        <p class="text-xs text-slate-500 mt-2">Shown exactly as written by your care team. Reminders are sent at each time${v.access === 'owner' ? ' to you and your caregivers' : ''}. Ask your doctor before changing anything.</p>`
        : '<p class="text-sm text-slate-500">No medicines were prescribed.</p>'}

      <div class="flex items-center justify-between mt-8 mb-3"><h2 class="font-semibold">${t('Recovery checklist')}</h2><span class="text-sm text-slate-500">${t('{a} of {b} done', { a: done, b: items.length })}</span></div>
      <div class="card divide-y divide-slate-100">
        ${items.length ? items.map((it) => `
          <label class="p-4 flex gap-3 ${v.can_tick_post ? 'cursor-pointer' : ''}">
            <input type="checkbox" class="tick mt-1 h-5 w-5 accent-teal-700 shrink-0" data-id="${it.id}" ${it.is_done ? 'checked' : ''} ${v.can_tick_post ? '' : 'disabled'} />
            <div class="flex-1"><p class="${it.is_done ? 'line-through text-slate-400' : ''}">${esc(it.text)}</p>
              ${it.due_at ? `<p class="text-xs text-slate-500 mt-1">Due ${fmtDT(it.due_at)}</p>` : ''}</div>
          </label>`).join('') : '<p class="p-4 text-sm text-slate-500">No tasks.</p>'}
      </div>`;
    body.querySelectorAll('.tick').forEach((cb) => cb.addEventListener('change', () => busy(cb, async () => {
      try {
        await api(`/checklist-items/${cb.dataset.id}`, { method: 'PATCH', body: { is_done: cb.checked } });
      } catch (e) { cb.checked = !cb.checked; throw e; }
      await load();
    })));
  }

  joinRoom(`visit:${id}`, { 'followup:updated': () => { toast('Your recovery plan was updated'); load(); } });
  await load();
}

// ---------- caregivers (patient shares access) ----------

const PERM = { view: 'Can view', view_and_tick: 'Can view and tick tasks' };

export async function caregivers(el) {
  const links = await api('/me/caregivers');
  el.innerHTML = `
    <a href="#/profile" class="text-sm text-slate-500 hover:text-slate-900">← Profile</a>
    ${pageTitle('Caregivers', 'Let a family member follow your visits, recovery plan and medicine times. You can change or remove access at any time.')}
    <div class="grid lg:grid-cols-5 gap-6">
      <section class="lg:col-span-3">
        ${links.length ? `<div class="card divide-y divide-slate-100">${links.map((l) => `
          <div class="p-4" data-id="${l.id}">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div><div class="font-semibold">${esc(l.caregiver_name || l.invite_email)}</div><div class="text-sm text-slate-500">${esc(l.invite_email)}</div></div>
              ${l.status === 'active' ? badge('Active', 'green') : badge('Invite pending', 'amber')}
            </div>
            <div class="flex flex-wrap items-center gap-2 mt-3">
              <select class="perm input w-auto" aria-label="Permission">
                ${Object.entries(PERM).map(([k, label]) => `<option value="${k}" ${k === l.permission ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
              ${l.status === 'pending' ? `<button class="copy btn btn-ghost btn-sm" data-url="${location.origin}/#/invite/${l.invite_token}">Copy invite link</button>` : ''}
              <button class="revoke btn btn-danger btn-sm">Remove access</button>
            </div>
          </div>`).join('')}</div>` : empty('You haven’t shared your visits with anyone.')}
      </section>
      <form id="f" class="card p-5 lg:col-span-2 h-fit space-y-4">
        <div class="font-semibold">Invite a caregiver</div>
        <div><label class="label" for="ce">Their email</label><input class="input" id="ce" name="email" type="email" required /></div>
        <div><label class="label" for="cp">What they can do</label>
          <select class="input" id="cp" name="permission"><option value="view">View visits and recovery plan</option><option value="view_and_tick">View, and tick recovery tasks</option></select></div>
        <button class="btn btn-primary w-full">Send invite</button>
        <p class="text-xs text-slate-500">They’ll get an email with a link. They need a CareLoop account with that email to accept. Caregivers can’t book, cancel or check in for you.</p>
      </form>
    </div>`;
  el.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const l = await api('/me/caregivers', { method: 'POST', body: formData(e.target) });
      await navigator.clipboard?.writeText(l.invite_url).catch(() => {});
      toast('Invite sent. The link is also copied to your clipboard.');
      caregivers(el);
    });
  });
  el.querySelectorAll('[data-id]').forEach((row) => {
    row.querySelector('.perm').addEventListener('change', (e) => busy(e.target, async () => {
      await api(`/me/caregivers/${row.dataset.id}`, { method: 'PATCH', body: { permission: e.target.value } });
      toast('Permission updated');
    }));
    row.querySelector('.copy')?.addEventListener('click', (e) => {
      navigator.clipboard?.writeText(e.currentTarget.dataset.url).then(() => toast('Invite link copied'), () => prompt('Copy this link:', e.currentTarget.dataset.url));
    });
    row.querySelector('.revoke').addEventListener('click', (e) => {
      if (!confirm('Remove this person’s access? They will stop seeing your visits and getting reminders.')) return;
      busy(e.currentTarget, async () => {
        await api(`/me/caregivers/${row.dataset.id}`, { method: 'PATCH', body: { status: 'revoked' } });
        caregivers(el);
      });
    });
  });
}

export async function acceptInvite(el, { token }) {
  const inv = await api(`/caregiver-invites/${token}`);
  const wrong = S.user.email && S.user.email !== inv.invite_email;
  el.innerHTML = `
    <div class="max-w-md mx-auto py-10">
      <div class="card p-8 text-center">
        <div class="text-4xl">🤝</div>
        <h1 class="text-xl font-bold mt-3">${esc(inv.patient_name)} invited you as a caregiver</h1>
        <p class="text-slate-500 mt-2">${inv.permission === 'view_and_tick' ? 'You’ll be able to see their visits and recovery plan, get their medicine reminders, and tick off recovery tasks.' : 'You’ll be able to see their visits and recovery plan and get their medicine reminders.'}</p>
        ${inv.status === 'revoked' ? '<p class="mt-4 text-red-700">This invite has been withdrawn.</p>'
          : inv.status === 'active' ? `<p class="mt-4 text-emerald-700">${inv.mine ? 'You’ve already accepted.' : 'This invite has already been used.'}</p><a href="#/caring" class="btn btn-primary mt-4">People I care for</a>`
          : wrong ? `<p class="mt-4 text-amber-800 text-sm">This invite was sent to ${esc(inv.invite_email)}. Log out and log in or sign up with that email to accept it.</p>`
          : '<button id="accept" class="btn btn-primary mt-5 px-8">Accept</button>'}
      </div>
    </div>`;
  el.querySelector('#accept')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    await api(`/caregiver-invites/${token}/accept`, { method: 'POST' });
    toast(`You’re now a caregiver for ${inv.patient_name}`);
    location.hash = '#/caring';
  }));
}

export async function caring(el) {
  const people = await api('/me/caring');
  el.innerHTML = `
    ${pageTitle('People I care for', 'Visits and recovery plans that others have shared with you.')}
    ${people.length ? people.map((p) => `
      <section class="mb-8">
        <div class="flex items-center gap-3 mb-3"><h2 class="text-lg font-semibold">${esc(p.patient_name)}</h2>${badge(PERM[p.permission], 'blue')}</div>
        ${p.visits.length ? `<div class="grid gap-3">${p.visits.map((v) => `
          <a href="#/visits/${v.id}${v.follow_up_id ? '/recovery' : ''}" class="card p-4 flex flex-wrap items-center justify-between gap-3 hover:shadow-sm">
            <div><div class="font-semibold">${esc(v.department_name)}${v.test_name ? ` · ${esc(v.test_name)}` : ''}</div>
              <div class="text-sm text-slate-500">${fmtDT(v.starts_at)}${v.follow_up_date ? ` · follow-up ${fmtDay(v.follow_up_date)}` : ''}</div></div>
            <div class="flex gap-2">${visitBadge(v.status)} ${v.follow_up_id ? badge('Recovery plan', 'teal') : ''}</div>
          </a>`).join('')}</div>` : empty('No recent visits.')}
      </section>`).join('') : empty('Nobody has shared their visits with you yet. When someone invites you, open the link in their email.')}`;
}

// ---------- reminders ----------

const KIND = { prep: ['Preparation', 'amber'], appointment: ['Appointment', 'blue'], medication: ['Medicine', 'teal'], follow_up: ['Follow-up', 'green'], slot_offer: ['Slot offer', 'gray'] };

export async function reminders(el) {
  const { upcoming, recent } = await api('/me/reminders');
  const row = (r, when) => `
    <a href="${esc(r.payload.link ? r.payload.link.replace(/^\//, '') : '#/home')}" class="p-4 flex gap-3 hover:bg-slate-50">
      <div class="w-24 shrink-0 text-sm"><div class="font-semibold">${fmtTime(when)}</div><div class="text-xs text-slate-500">${new Date(when).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div></div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-2">${badge(...KIND[r.kind])} ${r.patient_id && r.patient_id !== S.user.id ? `<span class="text-xs text-slate-500">for ${esc(r.patient_name)}</span>` : ''}</div>
        <div class="font-medium mt-1">${esc(r.payload.subject)}</div>
        <div class="text-sm text-slate-500">${esc(r.payload.body)}</div>
      </div>
    </a>`;
  el.innerHTML = `
    ${pageTitle('Reminders', 'Sent by email and shown here. Keep this tab open to get them as pop-ups too.',
      'Notification' in window && Notification.permission === 'default' ? '<button id="notify" class="btn btn-ghost">Turn on pop-up alerts</button>' : '')}
    <h2 class="font-semibold mb-3">Coming up</h2>
    ${upcoming.length ? `<div class="card divide-y divide-slate-100">${upcoming.map((r) => row(r, r.send_at)).join('')}</div>` : empty('No reminders scheduled.')}
    <h2 class="font-semibold mt-8 mb-3">Sent in the last 7 days</h2>
    ${recent.length ? `<div class="card divide-y divide-slate-100">${recent.map((r) => row(r, r.sent_at)).join('')}</div>` : empty('Nothing sent yet.')}`;
  el.querySelector('#notify')?.addEventListener('click', () => Notification.requestPermission().then(() => reminders(el)));
}

// ---------- staff: discharge & follow-up ----------

export async function discharge(el, { id }) {
  const [v, fu, items] = await Promise.all([api(`/visits/${id}`), api(`/visits/${id}/follow-up`), api(`/visits/${id}/checklists/post_visit`)]);
  const f = fu.follow_up;
  const auto = `Attend your follow-up visit with ${v.department_name}`;
  const openTasks = items.filter((i) => !i.is_done && i.text !== auto).map((i) => i.text);
  const doneTasks = items.filter((i) => i.is_done);
  const today = localDate();
  el.innerHTML = `
    <a href="#/staff/visits/${id}" class="text-sm text-slate-500 hover:text-slate-900">← Visit console</a>
    ${pageTitle(`Discharge · ${esc(v.patient_name)}`, `${esc(v.department_name)} · seen ${fmtDT(v.starts_at)}`, visitBadge(v.status))}
    <div class="grid lg:grid-cols-2 gap-6">
      <form id="fu" class="card p-5 space-y-4 h-fit">
        <div class="font-semibold">Follow-up and instructions</div>
        <div><label class="label" for="fd">Follow-up date <span class="font-normal text-slate-400">(leave empty if none)</span></label>
          <input class="input" type="date" id="fd" name="follow_up_date" min="${today}" value="${f?.follow_up_date || ''}" /></div>
        <div><label class="label" for="fn">Discharge notes for the patient</label>
          <textarea class="input" id="fn" name="notes" rows="4">${esc(f?.notes || '')}</textarea></div>
        <div><label class="label" for="ft">Recovery tasks <span class="font-normal text-slate-400">(one per line)</span></label>
          <textarea class="input" id="ft" name="tasks" rows="5" placeholder="Rest for 3 days&#10;Drink plenty of fluids">${esc(openTasks.join('\n'))}</textarea>
          ${doneTasks.length ? `<p class="text-xs text-slate-500 mt-1">Already ticked off (kept): ${doneTasks.map((t) => esc(t.text)).join('; ')}</p>` : ''}
          <p class="text-xs text-slate-500 mt-1">A “follow-up visit” task is added automatically when you set a date.</p></div>
        <button class="btn btn-primary">${f ? 'Update recovery plan' : 'Save and send to patient'}</button>
      </form>

      <section>
        <div class="card">
          <div class="p-4 border-b border-slate-100 font-semibold">Medicines</div>
          ${fu.medications.length ? `<div class="divide-y divide-slate-100">${fu.medications.map((m) => `
            <div class="p-4 flex justify-between gap-3" data-id="${m.id}">
              <div><div class="font-medium">${esc(m.name)}</div><div class="text-sm">${esc(m.dose_text)}</div>
                <div class="text-xs text-slate-500 mt-1">${m.times_of_day.map(fmtHM).join(', ')} · ${fmtDay(m.start_date)} to ${fmtDay(m.end_date)}</div></div>
              <button class="delmed btn btn-danger btn-sm h-fit">Remove</button>
            </div>`).join('')}</div>` : '<p class="p-4 text-sm text-slate-500">None added.</p>'}
        </div>
        <form id="med" class="card p-5 mt-4 space-y-3 ${f ? '' : 'opacity-50 pointer-events-none'}">
          <div class="font-semibold text-sm">Add a medicine ${f ? '' : '<span class="font-normal text-slate-500">(save the recovery plan first)</span>'}</div>
          <input class="input" name="name" placeholder="Medicine and strength, e.g. Amoxicillin 500 mg" required />
          <input class="input" name="dose_text" placeholder="Dose instructions, e.g. 1 capsule after food" required />
          <div><label class="label" for="mt">Dose times</label><input class="input" id="mt" name="times_of_day" placeholder="08:00, 20:00" required pattern="\\s*([01]\\d|2[0-3]):[0-5]\\d(\\s*,\\s*([01]\\d|2[0-3]):[0-5]\\d)*\\s*" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label" for="ms">From</label><input class="input" id="ms" type="date" name="start_date" value="${today}" required /></div>
            <div><label class="label" for="me">To</label><input class="input" id="me" type="date" name="end_date" value="${localDate(new Date(Date.now() + 4 * 864e5))}" required /></div>
          </div>
          <button class="btn btn-primary">Add medicine</button>
          <p class="text-xs text-slate-500">Enter it exactly as prescribed. The patient sees this text word for word and gets a reminder at each time.</p>
        </form>
      </section>
    </div>`;

  el.querySelector('#fu').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = formData(e.target);
    busy(e.submitter, async () => {
      await api(`/visits/${id}/follow-up`, { method: 'POST', body: { ...d, follow_up_date: d.follow_up_date || null, tasks: d.tasks.split('\n') } });
      toast(f ? 'Recovery plan updated' : 'Recovery plan sent to the patient');
      discharge(el, { id });
    });
  });
  el.querySelector('#med').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api(`/follow-ups/${f.id}/medications`, { method: 'POST', body: formData(e.target) });
      toast(`Medicine added · ${r.remindersCreated} reminders scheduled`);
      discharge(el, { id });
    });
  });
  el.querySelectorAll('.delmed').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this medicine? Its upcoming reminders will be cancelled.')) return;
    busy(b, async () => { await api(`/medications/${b.closest('[data-id]').dataset.id}`, { method: 'DELETE' }); discharge(el, { id }); });
  }));
}
