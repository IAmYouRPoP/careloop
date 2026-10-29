// Staff dashboard, waiting-room display, and admin pages.
import {
  S, api, esc, fmtDT, fmtTime, fmtDate, localDate, badge, visitBadge, readinessBadge, tokenBadge, urgencyBadge,
  itemBadge, toast, busy, pageTitle, empty, formData, joinRoom, onCleanup,
} from './lib.js';

// Staff work in their own department; admins pick one (remembered).
async function pickDepartment(paramId) {
  const departments = await api('/departments');
  let id = S.user.role === 'staff' ? S.user.department_id : paramId || localStorage.getItem('cl_dept');
  if (!departments.some((d) => d.id === id)) id = departments[0]?.id;
  if (S.user.role === 'admin' && id) localStorage.setItem('cl_dept', id);
  return { departments, dept: departments.find((d) => d.id === id) };
}

function deptSwitcher(departments, dept, base) {
  if (S.user.role !== 'admin') return '';
  return `<select id="deptsw" class="input w-auto" data-base="${base}" aria-label="Department">
    ${departments.map((d) => `<option value="${d.id}" ${d.id === dept.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
  </select>`;
}

function wireSwitcher(el) {
  const sw = el.querySelector('#deptsw');
  sw?.addEventListener('change', () => {
    localStorage.setItem('cl_dept', sw.value);
    location.hash = sw.dataset.base.replace(':id', sw.value);
  });
}

// ---------- today ----------

export async function staffToday(el) {
  const { departments, dept } = await pickDepartment(new URLSearchParams(location.hash.split('?')[1]).get('dept'));
  if (!dept) { el.innerHTML = empty('No departments yet.'); return; }
  const visits = await api(`/visits?department_id=${dept.id}&date=${localDate()}`);
  const count = (s) => visits.filter((v) => v.status === s).length;
  const atRisk = visits.filter((v) => v.readiness === 'at_risk' && v.status === 'booked').length;
  const stat = (label, n, tone = '') => `<div class="card p-4"><div class="text-xs text-slate-500">${label}</div><div class="text-2xl font-bold ${tone}">${n}</div></div>`;
  el.innerHTML = `
    ${pageTitle(`Today · ${esc(dept.name)}`, new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
      `${deptSwitcher(departments, dept, '#/staff?dept=:id')}
       <a href="#/staff/queue/${dept.id}" class="btn btn-primary">Open queue console</a>
       <a href="#/display/${dept.id}" target="_blank" class="btn btn-ghost">Waiting-room display ↗</a>
       <a href="#/qr/${dept.id}" target="_blank" class="btn btn-ghost">Check-in QR ↗</a>`)}
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      ${stat('Booked', visits.filter((v) => v.status !== 'cancelled').length)}
      ${stat('Not arrived', count('booked'))}
      ${stat('In queue', count('checked_in') + count('in_service'))}
      ${stat('Completed', count('completed'), 'text-emerald-700')}
      ${stat('Arriving not ready', atRisk, atRisk ? 'text-red-700' : '')}
    </div>
    ${visits.length ? `
      <div class="card overflow-x-auto">
        <table class="data">
          <thead><tr><th>Time</th><th>Patient</th><th>Test</th><th>Readiness</th><th>Status</th><th>Token</th><th></th></tr></thead>
          <tbody>${visits.map((v) => `
            <tr class="${v.status === 'cancelled' ? 'opacity-50' : ''}">
              <td class="whitespace-nowrap">${fmtTime(v.starts_at)}</td>
              <td class="font-medium">${esc(v.patient_name)}</td>
              <td>${esc(v.test_name || '–')}</td>
              <td>${readinessBadge(v.readiness)}</td>
              <td>${visitBadge(v.status)}</td>
              <td>${v.token_number ? `${esc(v.token_number)}` : '–'}</td>
              <td class="text-right whitespace-nowrap">
                ${v.status === 'booked' ? `<button class="checkin btn btn-ghost btn-sm" data-id="${v.id}">Check in</button>` : ''}
                <a href="#/staff/visits/${v.id}" class="btn btn-ghost btn-sm">Open</a>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : empty('No visits booked for today.')}`;
  wireSwitcher(el);
  el.querySelectorAll('.checkin').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    const s = await api(`/visits/${b.dataset.id}/check-in`, { method: 'POST' });
    toast(`Checked in: token ${s.tokenNumber}`);
    staffToday(el);
  })));
}

// ---------- queue console ----------

export async function staffQueue(el, { id }) {
  const { departments, dept } = await pickDepartment(id);
  if (!dept) { el.innerHTML = empty('No departments yet.'); return; }
  let data = await api(`/queues/${dept.id}`);

  function draw() {
    const { tokens, stats } = data;
    const active = tokens.filter((t) => t.status === 'called' || t.status === 'serving');
    const waiting = tokens.filter((t) => t.status === 'waiting');
    const missed = tokens.filter((t) => t.status === 'skipped' && t.visit_status === 'checked_in');
    const done = tokens.filter((t) => t.status === 'done' || (t.status === 'skipped' && t.visit_status !== 'checked_in'));
    const conf = stats.confidence === 'normal'
      ? `${stats.median.toFixed(1)} min median from ${stats.samples} visits`
      : stats.basis === 'default' ? `${stats.median} min hospital default (low confidence)` : `${stats.median.toFixed(1)} min from only ${stats.samples} visits (low confidence)`;
    el.querySelector('#body').innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div class="card p-4"><div class="text-xs text-slate-500">Waiting</div><div class="text-2xl font-bold">${waiting.length}</div></div>
        <div class="card p-4"><div class="text-xs text-slate-500">With staff</div><div class="text-2xl font-bold">${active.length}</div></div>
        <div class="card p-4"><div class="text-xs text-slate-500">Seen today</div><div class="text-2xl font-bold">${done.filter((t) => t.status === 'done').length}</div></div>
        <div class="card p-4"><div class="text-xs text-slate-500">Time per patient</div><div class="text-sm font-semibold mt-1">${conf}</div></div>
      </div>
      <div class="grid lg:grid-cols-5 gap-6">
        <section class="lg:col-span-2">
          <div class="flex items-center justify-between mb-3"><h2 class="font-semibold">With staff now</h2>
            <button id="next" class="btn btn-primary" ${waiting.length ? '' : 'disabled'}>Call next${waiting[0] ? ` · ${esc(waiting[0].token_number)}` : ''}</button></div>
          ${active.length ? active.map((t) => `
            <div class="card p-5 mb-3 ${t.status === 'called' ? 'ring-2 ring-amber-300' : 'ring-2 ring-brand-500'}">
              <div class="flex items-start justify-between gap-2">
                <div><div class="text-3xl font-bold">${esc(t.token_number)}</div><div class="font-medium mt-1">${esc(t.patient_name)}</div>
                  <div class="text-xs text-slate-500 mt-1">${t.status === 'called' ? `Called ${fmtTime(t.called_at)}` : `Started ${fmtTime(t.service_started_at)}`}</div></div>
                <div class="flex flex-col items-end gap-1">${tokenBadge(t.status)} ${readinessBadge(t.readiness)}</div>
              </div>
              <div class="flex flex-wrap gap-2 mt-4">
                ${t.status === 'called' ? `<button class="act btn btn-primary btn-sm" data-act="start" data-id="${t.id}">Start</button><button class="act btn btn-danger btn-sm" data-act="skip" data-id="${t.id}">Not here: skip</button>` : `<button class="act btn btn-primary btn-sm" data-act="finish" data-id="${t.id}">Finish</button><a href="#/staff/visits/${t.visit_id}/discharge" class="btn btn-ghost btn-sm">Discharge</a>`}
                <a href="#/staff/visits/${t.visit_id}" class="btn btn-ghost btn-sm">Visit</a>
              </div>
            </div>`).join('') : empty('Nobody with staff. Call the next token.')}
        </section>
        <section class="lg:col-span-3">
          <h2 class="font-semibold mb-3">Waiting (${waiting.length})</h2>
          ${waiting.length ? `
            <div class="card overflow-x-auto"><table class="data">
              <thead><tr><th>#</th><th>Token</th><th>Patient</th><th>Checked in</th><th>Readiness</th><th></th></tr></thead>
              <tbody>${waiting.map((t, i) => `
                <tr><td class="text-slate-400">${i + 1}</td><td class="font-semibold">${esc(t.token_number)}</td><td>${esc(t.patient_name)}</td>
                  <td>${fmtTime(t.checked_in_at)}</td><td>${readinessBadge(t.readiness)}</td>
                  <td class="text-right whitespace-nowrap"><button class="act btn btn-ghost btn-sm" data-act="start" data-id="${t.id}">Start</button></td></tr>`).join('')}
              </tbody></table></div>` : empty('The queue is empty.')}
          ${missed.length ? `
            <h2 class="font-semibold mt-6 mb-2">Missed their turn (${missed.length})</h2>
            <div class="card divide-y divide-slate-100">${missed.map((t) => `
              <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><span class="font-semibold">${esc(t.token_number)}</span> · ${esc(t.patient_name)}
                  <span class="text-xs text-amber-700 ml-1">no-show at ${fmtTime(t.grace_until)} unless they return</span></span>
                <button class="act btn btn-ghost btn-sm" data-act="requeue" data-id="${t.id}">Bring back (next in line)</button>
              </div>`).join('')}</div>` : ''}
          ${done.length ? `
            <details class="mt-4"><summary class="cursor-pointer text-sm text-slate-500">Finished today (${done.length})</summary>
              <div class="card mt-2 divide-y divide-slate-100">${done.map((t) => `<div class="px-4 py-2 flex items-center justify-between gap-2 text-sm"><span>${esc(t.token_number)} · ${esc(t.patient_name)}</span><span class="flex items-center gap-2">${t.status === 'done' ? `<a href="#/staff/visits/${t.visit_id}/discharge" class="text-brand-700 font-semibold text-xs">Discharge</a>` : ''}${tokenBadge(t.status)}</span></div>`).join('')}</div>
            </details>` : ''}
        </section>
      </div>`;
    el.querySelector('#next')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      const r = await api(`/queues/${dept.id}/call-next`, { method: 'POST' });
      toast(`Called ${r.called}`);
    }));
    el.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
      if (b.dataset.act === 'skip' && !confirm('Skip this patient? They have a grace period to return before becoming a no-show.')) return;
      await api(`/tokens/${b.dataset.id}/${b.dataset.act}`, { method: 'POST' });
    })));
  }

  el.innerHTML = `
    ${pageTitle(`Queue · ${esc(dept.name)}`, `${esc(dept.location)} · updates live`,
      `${deptSwitcher(departments, dept, '#/staff/queue/:id')}<a href="#/display/${dept.id}" target="_blank" class="btn btn-ghost">Display ↗</a>`)}
    <div id="body"></div>`;
  wireSwitcher(el);
  joinRoom(`dept:${dept.id}`, { 'queue:updated': (d) => { data = d; draw(); } });
  draw();
}

// ---------- staff visit console ----------

export async function staffVisit(el, { id }) {
  const [v, items, r] = await Promise.all([api(`/visits/${id}`), api(`/visits/${id}/checklists/pre_visit`), api(`/visits/${id}/readiness`)]);
  el.innerHTML = `
    <a href="#/staff" class="text-sm text-slate-500 hover:text-slate-900">← Today</a>
    ${pageTitle(esc(v.patient_name), `${esc(v.department_name)}${v.test_name ? ` · ${esc(v.test_name)}` : ''} · ${fmtDT(v.starts_at)}`, `${visitBadge(v.status)} ${readinessBadge(v.readiness)}`)}
    <div class="grid md:grid-cols-3 gap-4">
      <div class="card p-5 space-y-3 text-sm">
        <div><div class="text-slate-500">Reason</div><div class="font-medium">${esc(v.reason || '–')}</div></div>
        <div><div class="text-slate-500">Token</div><div class="font-medium">${v.token_number ? `${esc(v.token_number)} ${tokenBadge(v.token_status)}` : 'Not checked in'}</div></div>
        <div><div class="text-slate-500">Contact</div><div class="font-medium">${esc(v.patient_email)}</div></div>
        <div class="flex flex-wrap gap-2 pt-2">
          ${v.status === 'booked' ? `<button id="ci" class="btn btn-primary btn-sm">Check in</button><button class="st btn btn-danger btn-sm" data-s="no_show">Mark no-show</button><button class="st btn btn-danger btn-sm" data-s="cancelled" data-confirm="Cancel this visit for the patient? The place will be offered to patients waiting for an earlier slot.">Cancel visit</button>` : ''}
          ${v.token_number && ['checked_in', 'in_service'].includes(v.status) ? `<a href="#/staff/queue/${v.department_id}" class="btn btn-ghost btn-sm">Go to queue</a>` : ''}
          ${['in_service', 'completed'].includes(v.status) ? `<a href="#/staff/visits/${v.id}/discharge" class="btn btn-primary btn-sm">Discharge & follow-up</a>` : ''}
        </div>
      </div>
      <div class="card md:col-span-2">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between"><div class="font-semibold">Pre-visit checklist</div>${readinessBadge(r.readiness)}</div>
        ${r.flags.filter((f) => !f.pending).length ? `<div class="mx-4 mt-4 rounded-lg bg-red-50 text-red-800 text-sm p-3">Missing: ${r.flags.filter((f) => !f.pending).map((f) => esc(f.text)).join(' · ')}</div>` : ''}
        <div class="divide-y divide-slate-100">
          ${items.length ? items.map((it) => `
            <div class="p-4 flex gap-3 text-sm">
              <span class="mt-0.5">${it.is_done ? '✅' : it.item_type === 'info' ? 'ℹ️' : '⬜'}</span>
              <div><div>${itemBadge(it.item_type)}</div><p class="mt-1">${esc(it.text)}</p>${it.source_ref ? `<p class="text-xs text-slate-400 mt-1">${esc(it.source_ref)} · v${it.source_version}</p>` : ''}</div>
            </div>`).join('') : '<p class="p-4 text-sm text-slate-500">No checklist for this visit.</p>'}
        </div>
      </div>
    </div>`;
  el.querySelector('#ci')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
    const s = await api(`/visits/${id}/check-in`, { method: 'POST' });
    toast(`Checked in: token ${s.tokenNumber}`);
    staffVisit(el, { id });
  }));
  el.querySelectorAll('.st').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
    await api(`/visits/${id}`, { method: 'PATCH', body: { status: b.dataset.s } });
    staffVisit(el, { id });
  })));
}

// ---------- waiting-room display ----------

export async function display(el, { id }) {
  let d = await api(`/queues/${id}/display`);
  const qr = await api(`/departments/${id}/checkin-qr`).catch(() => null);
  const clock = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  function draw() {
    el.innerHTML = `
      <div class="min-h-screen bg-slate-900 text-white p-6 sm:p-10 flex flex-col">
        <div class="flex items-center justify-between">
          <div><div class="text-brand-500 font-bold tracking-wide">CareLoop</div><div class="text-3xl sm:text-4xl font-bold">${esc(d.department.name)}</div><div class="text-slate-400">${esc(d.department.location)}</div></div>
          <div id="clock" class="text-3xl font-semibold tabular-nums">${clock()}</div>
        </div>
        <div class="grid md:grid-cols-2 gap-6 mt-10 flex-1">
          <div class="rounded-3xl bg-brand-700 p-8 flex flex-col">
            <div class="text-xl uppercase tracking-widest opacity-80">Please come in</div>
            <div class="flex flex-wrap gap-6 mt-6">${d.called.length ? d.called.map((t) => `<div class="text-6xl sm:text-7xl font-bold pulse rounded-2xl px-4">${esc(t)}</div>`).join('') : '<div class="text-3xl opacity-60">–</div>'}</div>
            <div class="mt-auto pt-8 text-lg opacity-80">Now being seen: ${d.nowServing.map(esc).join(', ') || '–'}</div>
          </div>
          <div class="rounded-3xl bg-slate-800 p-8">
            <div class="text-xl uppercase tracking-widest text-slate-400">Up next</div>
            <div class="grid grid-cols-2 gap-4 mt-6">${d.upNext.length ? d.upNext.map((t) => `<div class="text-4xl font-semibold">${esc(t)}</div>`).join('') : '<div class="text-2xl text-slate-500">Nobody waiting</div>'}</div>
          </div>
        </div>
        <div class="flex items-end justify-between gap-6 mt-6">
          <div class="text-slate-400 text-lg">Booked today? Scan to check in on your phone and see your own estimated wait.</div>
          ${qr ? `<div class="shrink-0 bg-white rounded-2xl p-3 w-36 [&>svg]:w-full [&>svg]:h-auto" aria-label="Check-in QR code">${qr.svg}</div>` : ''}
        </div>
      </div>`;
  }
  draw();
  joinRoom(`display:${id}`, { 'queue:updated': (x) => { d = { ...d, ...x }; draw(); } });
  const t = setInterval(() => { const c = el.querySelector('#clock'); if (c) c.textContent = clock(); }, 15000);
  onCleanup(() => clearInterval(t));
}

// ---------- printable check-in QR (for the reception desk) ----------

export async function qrPoster(el, { id }) {
  const qr = await api(`/departments/${id}/checkin-qr`);
  el.innerHTML = `
    <div class="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
      <div class="text-brand-700 font-bold tracking-wide">CareLoop</div>
      <h1 class="text-4xl font-bold mt-2">${esc(qr.department)}</h1>
      <p class="text-xl text-slate-600 mt-2">Booked a visit today? Scan to check in.</p>
      <div class="w-72 sm:w-96 mt-8 [&>svg]:w-full [&>svg]:h-auto">${qr.svg}</div>
      <p class="text-slate-500 mt-6 max-w-md">Open your phone camera and point it at the code. You’ll get your token and see your place in the queue.</p>
      <p class="text-xs text-slate-400 mt-2">This code changes every day. Valid for ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}.</p>
      <button onclick="window.print()" class="btn btn-ghost mt-8 print:hidden">Print</button>
    </div>`;
}

// ---------- admin: departments ----------

export async function adminDepartments(el) {
  const departments = await api('/departments?all=1');
  el.innerHTML = `
    ${pageTitle('Departments', 'What patients can book, and the fallback time per patient used for wait estimates.')}
    <div class="card overflow-x-auto">
      <table class="data">
        <thead><tr><th>Name</th><th>Location</th><th>Default min / patient</th><th>Status</th><th></th></tr></thead>
        <tbody>${departments.map((d) => `
          <tr data-id="${d.id}">
            <td><input class="input" name="name" value="${esc(d.name)}" /></td>
            <td><input class="input" name="location" value="${esc(d.location)}" /></td>
            <td><input class="input w-24" name="default_service_minutes" type="number" min="1" max="120" value="${d.default_service_minutes}" /></td>
            <td>${d.is_active ? badge('Active', 'green') : badge('Hidden', 'gray')}</td>
            <td class="text-right whitespace-nowrap">
              <button class="save btn btn-ghost btn-sm">Save</button>
              <button class="toggle btn ${d.is_active ? 'btn-danger' : 'btn-ghost'} btn-sm" data-active="${d.is_active}">${d.is_active ? 'Hide' : 'Show'}</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <form id="add" class="card p-5 mt-6 grid sm:grid-cols-5 gap-3 items-end">
      <div class="sm:col-span-2"><label class="label" for="dn">New department</label><input class="input" id="dn" name="name" required /></div>
      <div><label class="label" for="dl">Location</label><input class="input" id="dl" name="location" /></div>
      <div><label class="label" for="dm">Min / patient</label><input class="input" id="dm" name="default_service_minutes" type="number" value="10" min="1" /></div>
      <button class="btn btn-primary">Add</button>
    </form>`;
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    const val = (n) => row.querySelector(`[name=${n}]`).value;
    row.querySelector('.save').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api(`/departments/${row.dataset.id}`, { method: 'PATCH', body: { name: val('name'), location: val('location'), default_service_minutes: val('default_service_minutes') } });
      toast('Saved');
    }));
    row.querySelector('.toggle').addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api(`/departments/${row.dataset.id}`, { method: 'PATCH', body: { is_active: e.currentTarget.dataset.active !== 'true' } });
      adminDepartments(el);
    }));
  });
  el.querySelector('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      await api('/departments', { method: 'POST', body: formData(e.target) });
      toast('Department added. Generate slots for it next.');
      adminDepartments(el);
    });
  });
}

// ---------- admin: tests & instructions ----------

export async function adminTests(el) {
  const [tests, departments] = await Promise.all([api('/tests'), api('/departments')]);
  const sel = new URLSearchParams(location.hash.split('?')[1]).get('test') || tests[0]?.id;
  const test = tests.find((t) => t.id === sel);
  const instructions = test ? await api(`/tests/${test.id}/instructions`) : [];
  el.innerHTML = `
    ${pageTitle('Tests and instructions', 'Instructions are copied word for word into patient checklists. Editing creates a new version.')}
    <div class="grid lg:grid-cols-3 gap-6">
      <aside class="space-y-4">
        <div class="card divide-y divide-slate-100">
          ${tests.map((t) => `<a href="#/admin/tests?test=${t.id}" class="block px-4 py-3 hover:bg-slate-50 ${t.id === sel ? 'bg-brand-50' : ''}">
            <div class="font-medium text-sm">${esc(t.name)}</div><div class="text-xs text-slate-500">${esc(t.department_name)}${t.requires_fasting ? ` · fasting ${t.fasting_hours} h` : ''}</div></a>`).join('')}
        </div>
        <form id="addtest" class="card p-4 space-y-3">
          <div class="font-semibold text-sm">Add a test</div>
          <select class="input" name="department_id" required aria-label="Department"><option value="">Department</option>${departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
          <input class="input" name="name" placeholder="Test name" required />
          <input class="input" name="required_documents" placeholder="Documents, comma-separated" />
          <div class="flex gap-2 items-center"><label class="text-sm flex items-center gap-2"><input type="checkbox" name="requires_fasting" class="accent-teal-700" /> Fasting</label>
            <input class="input w-24" name="fasting_hours" type="number" min="1" max="24" placeholder="hours" /></div>
          <button class="btn btn-primary w-full">Add test</button>
        </form>
      </aside>
      <section class="lg:col-span-2">
        ${test ? `
          <div class="card p-5">
            <div class="flex flex-wrap justify-between gap-2"><div><h2 class="text-lg font-semibold">${esc(test.name)}</h2><p class="text-sm text-slate-500">${esc(test.department_name)} · Bring: ${esc(test.required_documents.join(', ') || 'nothing extra')}</p></div>
            ${test.requires_fasting ? badge(`Fasting ${test.fasting_hours} h`, 'amber') : badge('No fasting', 'gray')}</div>
          </div>
          <div class="card mt-4 divide-y divide-slate-100">
            ${instructions.length ? instructions.map((i) => `
              <div class="p-4" data-id="${i.id}">
                <div class="flex flex-wrap items-center gap-2">${itemBadge(i.item_type)} <span class="text-xs text-slate-500">v${i.version} · ${esc(i.source_ref)} · verified by ${esc(i.verified_by_name || '–')} ${fmtDate(i.verified_at)}</span></div>
                <p class="mt-2 text-sm">${esc(i.text)}</p>
                <div class="flex gap-2 mt-2"><button class="edit btn btn-ghost btn-sm">Edit (new version)</button><button class="del btn btn-danger btn-sm">Retire</button></div>
              </div>`).join('') : '<p class="p-4 text-sm text-slate-500">No instructions yet.</p>'}
          </div>
          <form id="addinstr" class="card p-5 mt-4 space-y-3">
            <div class="font-semibold text-sm">Add a verified instruction</div>
            <div class="grid sm:grid-cols-3 gap-3">
              <select class="input" name="item_type" aria-label="Type"><option value="document">Document to bring</option><option value="fasting">Fasting</option><option value="task">Task</option><option value="info">Good to know</option></select>
              <input class="input sm:col-span-2" name="source_ref" placeholder="Source, e.g. Lab instruction sheet v3, p.2" required />
            </div>
            <textarea class="input" name="text" rows="2" placeholder="Exact wording from the hospital’s instruction" required></textarea>
            <button class="btn btn-primary">Add instruction</button>
            <p class="text-xs text-slate-500">New instructions apply to visits booked from now on.</p>
          </form>` : empty('Add a test to get started.')}
      </section>
    </div>`;
  el.querySelector('#addtest').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    busy(e.submitter, async () => {
      const t = await api('/tests', { method: 'POST', body: {
        department_id: f.department_id, name: f.name, requires_fasting: !!f.requires_fasting, fasting_hours: f.fasting_hours,
        required_documents: (f.required_documents || '').split(',').map((s) => s.trim()).filter(Boolean),
      } });
      location.hash = `#/admin/tests?test=${t.id}`;
    });
  });
  el.querySelector('#addinstr')?.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      await api(`/tests/${test.id}/instructions`, { method: 'POST', body: { ...formData(e.target), phase: 'before' } });
      adminTests(el);
    });
  });
  el.querySelectorAll('[data-id] .edit').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-id]');
    const text = prompt('Updated instruction wording:', row.querySelector('p').textContent);
    if (!text) return;
    const source_ref = prompt('Source for this version:', '');
    if (!source_ref) return;
    busy(b, async () => { await api(`/instructions/${row.dataset.id}`, { method: 'PUT', body: { text, source_ref } }); adminTests(el); });
  }));
  el.querySelectorAll('[data-id] .del').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Retire this instruction? Existing checklists keep their copy.')) return;
    busy(b, async () => { await api(`/instructions/${b.closest('[data-id]').dataset.id}`, { method: 'DELETE' }); adminTests(el); });
  }));
}

// ---------- admin: slots ----------

export async function adminSlots(el) {
  const departments = await api('/departments');
  const today = localDate();
  el.innerHTML = `
    ${pageTitle('Slot planner', 'Create bookable time slots. Existing slots are left as they are.')}
    <form id="f" class="card p-6 max-w-2xl grid sm:grid-cols-2 gap-4">
      <div class="sm:col-span-2"><label class="label" for="d">Department</label><select class="input" id="d" name="department_id" required>${departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div><label class="label" for="fr">From</label><input class="input" id="fr" type="date" name="from" value="${today}" required /></div>
      <div><label class="label" for="to">To</label><input class="input" id="to" type="date" name="to" value="${localDate(new Date(Date.now() + 6 * 864e5))}" required /></div>
      <div><label class="label" for="st">Start time</label><input class="input" id="st" type="time" name="start_time" value="09:00" required /></div>
      <div><label class="label" for="et">End time</label><input class="input" id="et" type="time" name="end_time" value="13:00" required /></div>
      <div><label class="label" for="iv">Every (minutes)</label><input class="input" id="iv" type="number" name="interval_min" value="30" min="5" /></div>
      <div><label class="label" for="cap">Patients per slot</label><input class="input" id="cap" type="number" name="capacity" value="4" min="1" /></div>
      <div class="sm:col-span-2"><button class="btn btn-primary">Generate slots</button></div>
    </form>`;
  el.querySelector('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const r = await api('/slots/generate', { method: 'POST', body: formData(e.target) });
      toast(`${r.created} new slots created`);
    });
  });
}

// ---------- admin: staff ----------

export async function adminStaff(el) {
  const [users, departments] = await Promise.all([api('/users'), api('/departments')]);
  const deptOptions = (sel) => `<option value="">No department</option>${departments.map((d) => `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}`;
  el.innerHTML = `
    ${pageTitle('Staff accounts', 'Staff run the queue for their department. Admins manage setup.')}
    <div class="card overflow-x-auto">
      <table class="data">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => `
          <tr data-id="${u.id}">
            <td class="font-medium">${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${badge(u.role, u.role === 'admin' ? 'amber' : 'teal')}</td>
            <td>${u.role === 'staff' ? `<select class="dept input w-auto" aria-label="Department">${deptOptions(u.department_id)}</select>` : '–'}</td>
            <td>${u.is_active ? badge('Active', 'green') : badge('Disabled', 'gray')}</td>
            <td class="text-right">${u.id !== S.user.id ? `<button class="toggle btn ${u.is_active ? 'btn-danger' : 'btn-ghost'} btn-sm" data-active="${u.is_active}">${u.is_active ? 'Disable' : 'Enable'}</button>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <form id="add" class="card p-5 mt-6 grid sm:grid-cols-3 gap-3">
      <div class="sm:col-span-3 font-semibold text-sm">Add a staff account</div>
      <input class="input" name="full_name" placeholder="Full name" required />
      <input class="input" name="email" type="email" placeholder="Email" required />
      <input class="input" name="password" type="password" minlength="8" placeholder="Temporary password" required autocomplete="new-password" />
      <select class="input" name="role" aria-label="Role"><option value="staff">Staff</option><option value="admin">Admin</option></select>
      <select class="input" name="department_id" aria-label="Department">${deptOptions(null)}</select>
      <button class="btn btn-primary">Create account</button>
    </form>`;
  el.querySelectorAll('tr[data-id]').forEach((row) => {
    row.querySelector('.dept')?.addEventListener('change', (e) => busy(e.target, async () => {
      await api(`/users/${row.dataset.id}`, { method: 'PATCH', body: { department_id: e.target.value || null } });
      toast('Department updated. Takes effect at their next login.');
    }));
    row.querySelector('.toggle')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
      await api(`/users/${row.dataset.id}`, { method: 'PATCH', body: { is_active: e.currentTarget.dataset.active !== 'true' } });
      adminStaff(el);
    }));
  });
  el.querySelector('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      await api('/users', { method: 'POST', body: formData(e.target) });
      toast('Account created');
      adminStaff(el);
    });
  });
}

// ---------- admin: symptom rules ----------

export async function adminRules(el) {
  const [rules, departments] = await Promise.all([api('/symptom-rules'), api('/departments')]);
  el.innerHTML = `
    ${pageTitle('Symptom rules', 'Red flags are checked first and always send the patient to emergency. Have a clinician review this table.')}
    <div class="card overflow-x-auto">
      <table class="data">
        <thead><tr><th>Symptom</th><th>Matches</th><th>Department</th><th>Urgency</th><th>Reviewed by</th><th></th></tr></thead>
        <tbody>${rules.map((r) => `
          <tr class="${r.is_red_flag ? 'bg-red-50/50' : ''}">
            <td class="font-medium whitespace-nowrap">${r.is_red_flag ? '🚩 ' : ''}${esc(r.symptom_key.replace(/_/g, ' '))}</td>
            <td class="text-slate-500 text-xs max-w-xs">${r.synonyms.map(esc).join(', ')}</td>
            <td>${r.is_red_flag ? '<span class="text-red-700 font-semibold text-xs">Emergency</span>' : esc(r.department_name || '–')}</td>
            <td>${urgencyBadge(r.urgency)}</td>
            <td class="text-xs text-slate-500">${esc(r.reviewed_by || '–')}</td>
            <td class="text-right"><button class="del btn btn-danger btn-sm" data-id="${r.id}">Delete</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <form id="add" class="card p-5 mt-6 grid sm:grid-cols-3 gap-3">
      <div class="sm:col-span-3 font-semibold text-sm">Add a rule</div>
      <input class="input" name="symptom_key" placeholder="Symptom, e.g. eye pain" required />
      <input class="input sm:col-span-2" name="synonyms" placeholder="Phrases to match, comma-separated" required />
      <select class="input" name="department_id" aria-label="Department">${departments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>
      <select class="input" name="urgency" aria-label="Urgency"><option value="same_day">Today</option><option value="within_week">This week</option><option value="routine">Routine</option></select>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="is_red_flag" class="accent-red-600" /> Red flag (emergency)</label>
      <input class="input sm:col-span-2" name="reviewed_by" placeholder="Reviewed by (clinician name)" />
      <button class="btn btn-primary">Add rule</button>
    </form>`;
  el.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Delete this rule?')) return;
    busy(b, async () => { await api(`/symptom-rules/${b.dataset.id}`, { method: 'DELETE' }); adminRules(el); });
  }));
  el.querySelector('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    busy(e.submitter, async () => {
      await api('/symptom-rules', { method: 'POST', body: { ...f, is_red_flag: !!f.is_red_flag, synonyms: f.synonyms.split(',') } });
      toast('Rule added');
      adminRules(el);
    });
  });
}
