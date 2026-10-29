import { q, one, localDate } from './db.js';

// ---------- Honest wait estimate ----------

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

// Typical service time from the last 20 completed tokens in 14 days.
export async function serviceStats(departmentId) {
  const rows = await q(
    `SELECT EXTRACT(EPOCH FROM (service_ended_at - service_started_at)) / 60 AS minutes
       FROM queue_tokens
      WHERE department_id = $1 AND status = 'done'
        AND service_started_at IS NOT NULL AND service_ended_at IS NOT NULL
        AND service_ended_at > now() - interval '14 days'
      ORDER BY service_ended_at DESC
      LIMIT 20`,
    [departmentId]
  );
  const mins = rows.map((r) => Number(r.minutes)).filter((m) => m > 0).sort((a, b) => a - b);
  if (mins.length < 5) {
    const dept = await one('SELECT default_service_minutes FROM departments WHERE id = $1', [departmentId]);
    const m = dept?.default_service_minutes ?? 10;
    return { samples: mins.length, median: m, p25: m, p75: m, confidence: 'low', basis: 'default' };
  }
  return {
    samples: mins.length,
    median: percentile(mins, 0.5),
    p25: percentile(mins, 0.25),
    p75: percentile(mins, 0.75),
    confidence: mins.length >= 20 ? 'normal' : 'low',
    basis: 'history',
  };
}

export function estimateFor(ahead, stats) {
  const r = (x) => Math.round(x);
  const est = {
    ahead,
    estimatedWaitMin: r(ahead * stats.median),
    confidence: stats.confidence,
    basis: stats.basis,
    samples: stats.samples,
  };
  if (stats.confidence === 'normal' && ahead > 0) {
    est.rangeMin = [r(ahead * stats.p25), r(ahead * stats.p75)];
  }
  return est;
}

// Today's tokens for a department, in queue order.
const GRACE_MINUTES = Number(process.env.GRACE_MINUTES) || 15;

export async function todaysQueue(departmentId) {
  return q(
    `SELECT t.*, u.full_name AS patient_name, v.readiness, v.id AS visit_id, v.status AS visit_status,
            t.skipped_at + make_interval(mins => $3) AS grace_until
       FROM queue_tokens t
       JOIN visits v ON v.id = t.visit_id
       JOIN users u ON u.id = v.patient_id
      WHERE t.department_id = $1 AND t.service_date = $2
      ORDER BY t.checked_in_at`,
    [departmentId, localDate(), GRACE_MINUTES]
  );
}

// Position for one token given the whole queue. Called/serving tokens still count as ahead.
export function positionIn(tokens, token, stats) {
  if (token.status !== 'waiting') {
    return {
      status: token.status, tokenNumber: token.token_number, position: 0, ...estimateFor(0, stats),
      ...(token.status === 'skipped' ? { graceUntil: token.grace_until, noShow: token.visit_status === 'no_show' } : {}),
    };
  }
  const active = tokens.filter((t) => t.status === 'called' || t.status === 'serving').length;
  const waitingAhead = tokens.filter(
    (t) => t.status === 'waiting' && new Date(t.checked_in_at) < new Date(token.checked_in_at)
  ).length;
  return {
    status: 'waiting',
    tokenNumber: token.token_number,
    position: waitingAhead + 1,
    ...estimateFor(waitingAhead + active, stats),
  };
}

// ---------- Readiness check ----------

export async function readinessFor(visitId, conn) {
  const visit = await one(
    `SELECT v.id, s.starts_at, t.fasting_hours
       FROM visits v JOIN slots s ON s.id = v.slot_id LEFT JOIN tests t ON t.id = v.test_id
      WHERE v.id = $1`,
    [visitId], conn
  );
  const items = await q(
    `SELECT ci.id, ci.text, ci.item_type, ci.is_done
       FROM checklist_items ci JOIN checklists c ON c.id = ci.checklist_id
      WHERE c.visit_id = $1 AND c.kind = 'pre_visit' AND ci.item_type IN ('document', 'fasting')`,
    [visitId], conn
  );
  if (!items.length) return { readiness: 'unknown', flags: [] };

  const flags = [];
  const fastingStarts = visit.fasting_hours
    ? new Date(new Date(visit.starts_at).getTime() - visit.fasting_hours * 3600e3)
    : null;
  for (const it of items) {
    if (it.is_done) continue;
    if (it.item_type === 'document') {
      flags.push({ itemId: it.id, text: it.text, reason: 'Document not confirmed' });
    } else if (it.item_type === 'fasting') {
      const due = fastingStarts && new Date() >= fastingStarts;
      flags.push({
        itemId: it.id,
        text: it.text,
        reason: due ? 'Fasting window has started' : 'Fasting starts before the visit',
        fastingStartsAt: fastingStarts?.toISOString() ?? null,
        pending: !due,
      });
    }
  }
  let readiness = 'ready';
  if (flags.some((f) => !f.pending)) readiness = 'at_risk';
  else if (flags.length) readiness = 'unknown';
  return { readiness, flags };
}

export async function recomputeReadiness(visitId, conn) {
  const r = await readinessFor(visitId, conn);
  await q('UPDATE visits SET readiness = $2, updated_at = now() WHERE id = $1', [visitId, r.readiness], conn);
  return r;
}

// ---------- Symptom guide (rule-based) ----------

const URGENCY_ORDER = ['emergency', 'same_day', 'within_week', 'routine'];

// Crude stemmer so "drooping", "droops" and "droop" compare equal.
// Keeps at least 3 letters ("ending" -> "end") and leaves "-eed" words alone, so "bleed"
// stays "bleed" and still matches "bleeding".
function stem(word) {
  const w = word.replace(/'/g, '');
  const m = w.match(/(ing|ed|es|s|ly)$/);
  if (!m || w.length - m[0].length < 3 || (m[0] === 'ed' && w.endsWith('eed'))) return w;
  return w.slice(0, -m[0].length);
}

const FILLER = new Set(['a', 'an', 'the', 'in', 'on', 'of', 'my', 'to', 'at', 'is', 'are', 'and', 'i', 'me']);

function stems(text) {
  return new Set(text.toLowerCase().split(/[^a-z']+/).filter((w) => w && !FILLER.has(w)).map(stem));
}

// A phrase matches when every word in it appears somewhere in the text, in any order.
// "face drooping" matches "my face is drooping". This errs toward over-triage, which is the safe side.
function mentions(textStems, phrase) {
  return [...stems(phrase)].every((w) => textStems.has(w));
}

export const DISCLAIMER =
  'CareLoop suggests a department and how soon to be seen. It does not diagnose and does not give medication advice. ' +
  'If you feel worse or are worried, contact a doctor or go to the nearest emergency department.';

export const EMERGENCY_MESSAGE =
  'Your description includes a possible emergency sign. Call 112 (or 108 for an ambulance) or go to the nearest emergency department now. Do not wait for a booking.';

export function loadRules() {
  return q(`SELECT r.*, d.name AS department_name FROM symptom_rules r LEFT JOIN departments d ON d.id = r.department_id`);
}

// Which rules the text mentions. `specificity` is the word count of the best matching phrase,
// so "son fever" (Paediatrics) beats plain "fever" (General Medicine) at the same urgency.
// `aiKeys` are symptom keys an AI extractor found; they can only name rules that already exist.
export function matchRules(text, rules, aiKeys = []) {
  const words = stems(text);
  const out = [];
  for (const rule of rules) {
    const hits = [rule.symptom_key.replace(/_/g, ' '), ...rule.synonyms].filter((p) => mentions(words, p));
    if (hits.length) {
      out.push({ rule, specificity: Math.max(...hits.map((p) => stems(p).size)), source: 'rules' });
    } else if (aiKeys.includes(rule.symptom_key)) {
      out.push({ rule, specificity: 1, source: 'ai' });
    }
  }
  return out;
}

// Red flags first; otherwise the most urgent, then most specific, match wins.
export function decide(matches, fallbackDept) {
  const red = matches.filter((m) => m.rule.is_red_flag);
  if (red.length) {
    return { emergency: true, message: EMERGENCY_MESSAGE, urgency: 'emergency', matched: red.map((m) => m.rule.symptom_key), ruleIds: red.map((m) => m.rule.id) };
  }
  if (matches.length) {
    const best = [...matches].sort((a, b) =>
      URGENCY_ORDER.indexOf(a.rule.urgency) - URGENCY_ORDER.indexOf(b.rule.urgency) || b.specificity - a.specificity
    )[0];
    return {
      emergency: false,
      urgency: best.rule.urgency,
      department: { id: best.rule.department_id, name: best.rule.department_name },
      matched: matches.map((m) => m.rule.symptom_key),
      ruleIds: matches.map((m) => m.rule.id),
    };
  }
  return {
    emergency: false, urgency: 'routine', department: fallbackDept, matched: [], ruleIds: [],
    note: 'No listed symptom matched. General Medicine can assess you and refer you on.',
  };
}

// `extract`, when given, is an AI extractor: (text, allowedKeys) => { ok, keys }. It is only called
// when the raw words show no red flag, so emergencies never wait on a network call.
export async function assessSymptoms(text, userId, { log = true, extract = null, rules = null, fallback = null } = {}) {
  rules ??= await loadRules();
  fallback ??= await one(`SELECT id, name FROM departments WHERE name = 'General Medicine'`);
  let matches = matchRules(text, rules);
  let ai = { used: false };
  if (extract && !matches.some((m) => m.rule.is_red_flag)) {
    const r = await extract(text, rules.map((x) => x.symptom_key));
    ai = { used: true, ok: r.ok, keys: r.keys || [], error: r.error };
    if (r.ok && r.keys.length) matches = matchRules(text, rules, r.keys);
  }
  const { ruleIds, ...result } = decide(matches, fallback);
  result.ai = ai;
  result.aiFound = matches.filter((m) => m.source === 'ai').map((m) => m.rule.symptom_key);

  if (!log) return { ...result, disclaimer: DISCLAIMER };
  const session = await one(
    `INSERT INTO symptom_sessions (user_id, input_text, extracted_symptoms, matched_rule_ids, result_department_id, result_urgency, red_flag_triggered)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId ?? null, text, matches.map((m) => m.rule.symptom_key), ruleIds, result.department?.id ?? null, result.urgency, result.emergency]
  );
  return { ...result, sessionId: session.id, disclaimer: DISCLAIMER };
}
