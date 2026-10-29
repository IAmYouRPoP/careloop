// Phase 4 views: slot rescue offers (patient) and the analytics dashboard (admin).
import {
  api, esc, fmtDT, fmtTime, localDate, badge, toast, busy, pageTitle, empty, onUserEvent, onCleanup, t,
} from './lib.js';

// ---------- slot offers ----------

const minutesLeft = (iso) => Math.max(0, Math.round((new Date(iso) - Date.now()) / 60e3));

export async function offers(el) {
  async function load() {
    const list = await api('/me/slot-offers');
    const open = list.filter((o) => o.status === 'offered' && new Date(o.expires_at) > new Date());
    const past = list.filter((o) => !open.includes(o));
    const STATUS = { accepted: ['Moved', 'green'], declined: ['Declined', 'gray'], expired: ['Closed', 'gray'], offered: ['Closed', 'gray'] };
    el.innerHTML = `
      ${pageTitle('Earlier slots', 'When someone cancels, you may be offered their place. The first person to accept gets it.',
        '<a href="#/profile" class="btn btn-ghost">Offer settings</a>')}
      ${open.length ? `<div class="grid gap-4">${open.map((o) => `
        <div class="card p-5 ring-2 ring-brand-500" data-id="${o.id}">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="text-xs font-bold uppercase tracking-wide text-brand-700">${t('Earlier slot available')}</div>
              <div class="text-lg font-bold mt-1">${esc(t(o.department_name))}${o.test_name ? ` · ${esc(o.test_name)}` : ''}</div>
              <div class="text-sm text-slate-500">${esc(o.department_location)}</div>
            </div>
            ${badge(`Closes in ${minutesLeft(o.expires_at)} min`, 'amber')}
          </div>
          <div class="grid sm:grid-cols-[1fr_auto_1fr] items-center gap-3 mt-4">
            <div class="rounded-xl bg-slate-50 p-3"><div class="text-xs text-slate-500">${t('Your current time')}</div><div class="font-semibold line-through text-slate-400">${fmtDT(o.current_at)}</div></div>
            <div class="text-center text-slate-400 text-xl" aria-hidden="true">→</div>
            <div class="rounded-xl bg-brand-50 p-3"><div class="text-xs text-brand-700">${t('New time')}</div><div class="font-semibold">${fmtDT(o.offered_at)}</div></div>
          </div>
          ${o.test_name ? '<p class="text-xs text-slate-500 mt-3">Your preparation checklist moves with you; fasting and other times update automatically.</p>' : ''}
          <div class="flex flex-wrap gap-2 mt-4">
            <button class="accept btn btn-primary">${t('Move to the earlier slot')}</button>
            <button class="decline btn btn-ghost">${t('Keep my current time')}</button>
          </div>
        </div>`).join('')}</div>` : empty('No open offers right now. We’ll let you know if an earlier slot opens up.')}
      ${past.length ? `
        <h2 class="font-semibold mt-8 mb-3">Recent offers</h2>
        <div class="card divide-y divide-slate-100">${past.map((o) => `
          <div class="p-4 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>${esc(o.department_name)} · ${fmtDT(o.offered_at)}</span>${badge(...(STATUS[o.status] || STATUS.expired))}
          </div>`).join('')}</div>` : ''}`;
    el.querySelectorAll('[data-id]').forEach((card) => {
      card.querySelector('.accept').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const r = await api(`/slot-offers/${card.dataset.id}/accept`, { method: 'POST' });
        toast('Done. Your visit has moved to the earlier slot.');
        location.hash = `#/visits/${r.visitId}`;
      }).then(() => { if (location.hash.startsWith('#/offers')) load(); }));
      card.querySelector('.decline').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        await api(`/slot-offers/${card.dataset.id}/decline`, { method: 'POST' });
        toast('Kept your current time');
        await load();
      }));
    });
  }
  onUserEvent('offer:new', () => load());
  const t = setInterval(() => { if (el.isConnected) load(); }, 60000);
  onCleanup(() => clearInterval(t));
  await load();
}

// Small banner for the patient home page.
export async function offerBanner() {
  const list = await api('/me/slot-offers').catch(() => []);
  const open = list.filter((o) => o.status === 'offered' && new Date(o.expires_at) > new Date());
  if (!open.length) return '';
  const o = open[0];
  return `
    <a href="#/offers" class="block rounded-2xl bg-brand-700 text-white p-5 mb-6 hover:bg-brand-800">
      <div class="text-xs font-bold uppercase tracking-wide opacity-80">Earlier slot available</div>
      <div class="font-semibold text-lg mt-1">${esc(o.department_name)}: ${fmtDT(o.offered_at)} instead of ${fmtDT(o.current_at)}</div>
      <div class="text-sm opacity-90 mt-1">Closes in ${minutesLeft(o.expires_at)} min · first to accept gets it →</div>
    </a>`;
}

// ---------- symptom guide evaluation (admin) ----------

export async function symptomTest(el) {
  const ai = await api('/symptoms/ai-status');
  el.innerHTML = `
    ${pageTitle('Symptom guide test', 'Runs the stored test cases (server/symptom-cases.json) and reports routing and red-flag accuracy. Test runs are not saved as patient sessions.', `
      <button class="run btn btn-primary" data-ai="0">Run with rules only</button>
      <button class="run btn btn-ghost" data-ai="1" ${ai.enabled ? '' : 'disabled title="Set ANTHROPIC_API_KEY to enable"'}>Run with AI extraction</button>`)}
    ${ai.enabled ? `<p class="text-sm text-slate-500 -mt-3 mb-4">AI extraction is on (${esc(ai.model)}). Each AI run makes one API call per case.</p>`
      : '<p class="text-sm text-slate-500 -mt-3 mb-4">AI extraction is off. Set <code>ANTHROPIC_API_KEY</code> before starting the server to compare.</p>'}
    <div id="out">${empty('Choose a run to start.')}</div>`;
  el.querySelectorAll('.run').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
    el.querySelector('#out').innerHTML = '<div class="py-12 text-center text-slate-400">Running cases…</div>';
    const r = await api('/symptoms/evaluate', { method: 'POST', body: { use_ai: b.dataset.ai === '1' } });
    const fails = r.results.filter((x) => !x.pass);
    el.querySelector('#out').innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        ${tile('Overall accuracy', `${r.accuracy}%`, `${r.total - fails.length} of ${r.total} cases · ${r.use_ai ? 'rules + AI' : 'rules only'}`)}
        ${tile('Red flags caught', `${r.red_flag_sensitivity}%`, `of ${r.emergencies} emergency cases`, r.red_flag_sensitivity < 100 ? 'text-red-700' : 'text-emerald-700')}
        ${tile('False alarms', r.false_alarms, `routine cases sent to emergency (of ${r.routine})`)}
        ${tile('Department routing', `${r.routing_accuracy}%`, `of ${r.routine} non-emergency cases`)}
      </div>
      ${fails.length ? `<h2 class="font-semibold mb-2">Cases it got wrong (${fails.length})</h2>` : ''}
      <div class="card overflow-x-auto">
        <table class="data">
          <thead><tr><th>Patient wrote</th><th>Expected</th><th>Got</th><th>Matched</th><th></th></tr></thead>
          <tbody>${[...fails, ...r.results.filter((x) => x.pass)].map((x) => `
            <tr class="${x.pass ? '' : 'bg-red-50/60'}">
              <td class="max-w-sm">${esc(x.text)}</td>
              <td>${x.expect === 'emergency' ? badge('Emergency', 'red') : esc(x.expect)}</td>
              <td>${x.got === 'emergency' ? badge('Emergency', 'red') : esc(x.got)}</td>
              <td class="text-xs text-slate-500">${x.matched.map((m) => esc(m.replace(/_/g, ' '))).join(', ') || '–'}${x.aiFound?.length ? `<div class="text-brand-700">AI: ${x.aiFound.map(esc).join(', ')}</div>` : ''}${x.aiError ? `<div class="text-amber-700">${esc(x.aiError)}</div>` : ''}</td>
              <td>${x.pass ? badge('Pass', 'green') : badge('Fail', 'red')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-slate-500 mt-3">Synthetic cases written for this demo. Have a clinician review the cases and the rule table before reporting results.</p>`;
  })));
}

// ---------- analytics ----------

const TEAL = '#0d9488';
const fmtMin = (x) => (x == null ? '–' : `${Math.round(x)} min`);
const fmtPct = (x) => (x == null ? '–' : `${x}%`);
const shortDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Round an axis maximum up to 1, 2 or 5 × a power of ten.
function niceMax(v) {
  if (v <= 0) return 10;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((n) => n >= v);
}

// Single-series line with a crosshair tooltip. No legend: the title names the series.
function lineChart(points, { unit = 'min' } = {}) {
  if (points.length < 2) return '<p class="text-sm text-slate-500 py-8 text-center">Not enough days with data in this range.</p>';
  const W = 640, H = 220, L = 40, R = 16, T = 12, B = 28;
  const max = niceMax(Math.max(...points.map((p) => p.y)));
  const x = (i) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const ticks = [0, max / 2, max];
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join('');
  const every = Math.ceil(points.length / 7);
  return `
    <div class="chart relative" data-points='${esc(JSON.stringify(points.map((p, i) => ({ ...p, cx: x(i), cy: y(p.y) }))))}' data-unit="${unit}">
      <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto" role="img" aria-label="Line chart of daily average wait">
        ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#e2e8f0" stroke-width="1"/>
          <text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#64748b">${Math.round(t)}</text>`).join('')}
        ${points.map((p, i) => (i % every === 0 || i === points.length - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#64748b">${shortDay(p.x)}</text>` : '').join('')}
        <path d="${path}" fill="none" stroke="${TEAL}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="4" fill="${TEAL}" stroke="#fff" stroke-width="2"/>`).join('')}
        <line class="xhair" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
        <circle class="xdot" r="6" fill="${TEAL}" stroke="#fff" stroke-width="2" visibility="hidden"/>
        <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
      </svg>
      <div class="tip pointer-events-none absolute hidden rounded-lg bg-slate-900 text-white text-xs px-2.5 py-1.5 shadow-lg whitespace-nowrap"></div>
    </div>`;
}

function wireLineChart(root) {
  root.querySelectorAll('.chart').forEach((c) => {
    const pts = JSON.parse(c.dataset.points);
    const svg = c.querySelector('svg');
    const tip = c.querySelector('.tip');
    const xh = c.querySelector('.xhair');
    const xd = c.querySelector('.xdot');
    const hide = () => { tip.classList.add('hidden'); xh.setAttribute('visibility', 'hidden'); xd.setAttribute('visibility', 'hidden'); };
    c.querySelector('.hit').addEventListener('mousemove', (e) => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
      const p = pts.reduce((a, b) => (Math.abs(b.cx - vx) < Math.abs(a.cx - vx) ? b : a));
      xh.setAttribute('x1', p.cx); xh.setAttribute('x2', p.cx); xh.setAttribute('visibility', 'visible');
      xd.setAttribute('cx', p.cx); xd.setAttribute('cy', p.cy); xd.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div class="font-semibold">${shortDay(p.x)}</div><div>Avg wait ${Math.round(p.y)} min · ${p.n} patients</div>`;
      tip.classList.remove('hidden');
      const scale = box.width / svg.viewBox.baseVal.width;
      const left = Math.min(Math.max(p.cx * scale - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(p.cy * scale - tip.offsetHeight - 12, 0)}px`;
    });
    c.querySelector('.hit').addEventListener('mouseleave', hide);
  });
}

// Horizontal bars, single series, sorted, with values labelled at the bar ends.
function barList(rows, { label, value, fmt, detail }) {
  if (!rows.length) return '<p class="text-sm text-slate-500 py-8 text-center">No data in this range.</p>';
  const max = niceMax(Math.max(...rows.map(value), 1));
  return `<div class="space-y-1.5">${rows.map((r) => {
    const v = value(r);
    const w = Math.max((v / max) * 100, v > 0 ? 1.5 : 0);
    return `
      <div class="bar group grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3 rounded-md px-1 py-1 hover:bg-slate-50" title="${esc(`${label(r)}: ${fmt(v)} (${detail(r)})`)}">
        <div class="text-sm truncate">${esc(label(r))}</div>
        <div class="h-3.5 bg-slate-100 rounded-r"><div class="h-full rounded-r" style="width:${w}%;background:${TEAL}"></div></div>
        <div class="text-sm tabular-nums text-right text-slate-700">${fmt(v)}</div>
      </div>`;
  }).join('')}</div>`;
}

// CSV with quoting for commas, quotes and newlines; BOM so Excel reads UTF-8 correctly.
function downloadCsv(filename, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const tile = (label, value, sub, tone = '') => `
  <div class="card p-4">
    <div class="text-xs text-slate-500">${label}</div>
    <div class="text-3xl font-bold tracking-tight mt-1 ${tone}">${value}</div>
    <div class="text-xs text-slate-500 mt-1">${sub}</div>
  </div>`;

export async function analytics(el) {
  let days = Number(sessionStorage.getItem('cl_range') || 14);

  async function load() {
    const to = localDate();
    const from = localDate(new Date(Date.now() - (days - 1) * 864e5));
    const qs = `?from=${from}&to=${to}`;
    const [wait, ns, rd, sr] = await Promise.all([
      api(`/analytics/wait-times${qs}`), api(`/analytics/no-shows${qs}`), api(`/analytics/readiness${qs}`), api(`/analytics/slot-rescue${qs}`),
    ]);
    const daily = wait.daily.map((d) => ({ x: d.day, y: d.avg_wait, n: d.n }));
    el.innerHTML = `
      ${pageTitle('Analytics', `${shortDay(from)} to ${shortDay(to)} · synthetic demo data`, `
        <div class="inline-flex rounded-lg ring-1 ring-slate-300 bg-white p-0.5 print:hidden" role="group" aria-label="Date range">
          ${[7, 14, 30].map((d) => `<button class="range px-3 py-1.5 text-sm font-medium rounded-md ${d === days ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-50'}" data-d="${d}">${d} days</button>`).join('')}
        </div>
        <button id="csv" class="btn btn-ghost">Download CSV</button>
        <button id="pdf" class="btn btn-ghost">Print / Save as PDF</button>`)}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        ${tile('Average wait', fmtMin(wait.overall.avg_wait), `median ${fmtMin(wait.overall.median_wait)} · 90% under ${fmtMin(wait.overall.p90_wait)}`)}
        ${tile('No-show rate', fmtPct(ns.overall.rate), `${ns.overall.no_shows} of ${ns.overall.expected} visits · ${ns.overall.cancelled} cancelled`, ns.overall.rate > 10 ? 'text-red-700' : '')}
        ${tile('Arrived not ready', fmtPct(rd.overall.rate), `${rd.overall.at_risk} of ${rd.overall.checked_in} test visits`, rd.overall.rate > 20 ? 'text-red-700' : '')}
        ${tile('Slots rescued', sr.slots_refilled, `${sr.accepted} accepted of ${sr.offers} offers`)}
      </div>

      <div class="grid lg:grid-cols-5 gap-6">
        <section class="card p-5 lg:col-span-3">
          <h2 class="font-semibold">Average wait per day</h2>
          <p class="text-xs text-slate-500 mb-3">Minutes from check-in to being called, all departments</p>
          ${lineChart(daily)}
          <details class="mt-3 text-sm"><summary class="cursor-pointer text-slate-500">Show data</summary>
            <table class="data mt-2"><thead><tr><th>Day</th><th>Patients</th><th>Avg wait</th></tr></thead>
              <tbody>${daily.map((d) => `<tr><td>${shortDay(d.x)}</td><td>${d.n}</td><td>${fmtMin(d.y)}</td></tr>`).join('')}</tbody></table>
          </details>
        </section>
        <section class="card p-5 lg:col-span-2">
          <h2 class="font-semibold">No-show rate by department</h2>
          <p class="text-xs text-slate-500 mb-3">Share of past, non-cancelled visits where the patient didn’t come</p>
          ${barList(ns.by_department.filter((x) => x.expected), { label: (r) => r.department, value: (r) => r.rate ?? 0, fmt: (v) => `${v}%`, detail: (r) => `${r.no_shows} of ${r.expected}` })}
        </section>
      </div>

      <div class="grid lg:grid-cols-2 gap-6 mt-6">
        <section class="card overflow-x-auto">
          <div class="p-4 pb-0"><h2 class="font-semibold">Waits by department</h2><p class="text-xs text-slate-500">Longest average wait first</p></div>
          ${wait.by_department.length ? `<table class="data mt-2"><thead><tr><th>Department</th><th class="text-right">Patients</th><th class="text-right">Avg wait</th><th class="text-right">Median wait</th><th class="text-right">Median service</th></tr></thead>
            <tbody>${wait.by_department.map((d) => `<tr><td class="font-medium">${esc(d.department)}</td><td class="text-right tabular-nums">${d.n}</td><td class="text-right tabular-nums">${fmtMin(d.avg_wait)}</td><td class="text-right tabular-nums">${fmtMin(d.median_wait)}</td><td class="text-right tabular-nums">${fmtMin(d.median_service)}</td></tr>`).join('')}</tbody></table>`
            : '<p class="p-4 text-sm text-slate-500">No queue data in this range.</p>'}
        </section>
        <section class="card overflow-x-auto">
          <div class="p-4 pb-0"><h2 class="font-semibold">Incomplete preparation by test</h2><p class="text-xs text-slate-500">Readiness at the moment of check-in</p></div>
          ${rd.by_test.length ? `<table class="data mt-2"><thead><tr><th>Test</th><th class="text-right">Checked in</th><th class="text-right">Not ready</th><th class="text-right">Rate</th></tr></thead>
            <tbody>${rd.by_test.map((t) => `<tr><td><div class="font-medium">${esc(t.test)}</div><div class="text-xs text-slate-500">${esc(t.department)}</div></td><td class="text-right tabular-nums">${t.checked_in}</td><td class="text-right tabular-nums">${t.at_risk}</td><td class="text-right">${t.rate >= 30 ? badge(`${t.rate}%`, 'red') : t.rate > 0 ? badge(`${t.rate}%`, 'amber') : badge('0%', 'green')}</td></tr>`).join('')}</tbody></table>`
            : '<p class="p-4 text-sm text-slate-500">No test visits checked in during this range.</p>'}
        </section>
      </div>

      <section class="card p-5 mt-6">
        <h2 class="font-semibold">Slot rescue</h2>
        <p class="text-xs text-slate-500 mb-3">Cancelled places offered to opted-in patients with later bookings</p>
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
          ${[['Offers sent', sr.offers], ['Accepted', sr.accepted], ['Declined', sr.declined], ['Closed unanswered', sr.expired], ['Open now', sr.open]]
            .map(([k, v]) => `<div class="rounded-xl bg-slate-50 p-3"><div class="text-xs text-slate-500">${k}</div><div class="text-xl font-bold">${v}</div></div>`).join('')}
        </div>
      </section>`;
    wireLineChart(el);
    el.querySelector('#csv').addEventListener('click', () => downloadCsv(`careloop-analytics-${from}-to-${to}.csv`, [
      ['CareLoop analytics (synthetic demo data)', `${from} to ${to}`],
      [],
      ['Summary', 'Value', 'Detail'],
      ['Average wait (min)', wait.overall.avg_wait, `median ${wait.overall.median_wait}, 90th percentile ${wait.overall.p90_wait}, ${wait.overall.n} patients`],
      ['No-show rate (%)', ns.overall.rate, `${ns.overall.no_shows} of ${ns.overall.expected} visits; ${ns.overall.cancelled} cancelled`],
      ['Arrived not ready (%)', rd.overall.rate, `${rd.overall.at_risk} of ${rd.overall.checked_in} test visits`],
      ['Slots rescued', sr.slots_refilled, `${sr.accepted} accepted of ${sr.offers} offers; ${sr.declined} declined; ${sr.expired} expired`],
      [],
      ['Daily wait', 'Patients', 'Average wait (min)'],
      ...wait.daily.map((d) => [d.day, d.n, d.avg_wait]),
      [],
      ['Department', 'Patients', 'Average wait (min)', 'Median wait (min)', 'Median service (min)'],
      ...wait.by_department.map((d) => [d.department, d.n, d.avg_wait, d.median_wait, d.median_service]),
      [],
      ['Department', 'Expected visits', 'No-shows', 'Cancelled', 'No-show rate (%)'],
      ...ns.by_department.map((d) => [d.department, d.expected, d.no_shows, d.cancelled, d.rate]),
      [],
      ['Test', 'Department', 'Checked in', 'Not ready', 'Rate (%)'],
      ...rd.by_test.map((x) => [x.test, x.department, x.checked_in, x.at_risk, x.rate]),
    ]));
    el.querySelector('#pdf').addEventListener('click', () => {
      el.querySelectorAll('details').forEach((d) => { d.open = true; });
      window.print();
    });
    el.querySelectorAll('.range').forEach((b) => b.addEventListener('click', () => {
      days = Number(b.dataset.d);
      try { sessionStorage.setItem('cl_range', days); } catch {}
      busy(b, load);
    }));
  }
  await load();
}
