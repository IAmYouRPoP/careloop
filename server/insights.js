// Phase 4 routes: slot rescue offers and the analytics dashboard.
import { q, one } from './db.js';
import { acceptOffer, declineOffer } from './rescue.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Local-date range [from, to] inclusive, defaulting to the last 14 days up to today.
function range(req, fail) {
  const p = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const today = new Date();
  const to = req.query.to || ymd(today);
  const from = req.query.from || ymd(new Date(today.getTime() - 13 * 864e5));
  if (!YMD.test(from) || !YMD.test(to) || from > to) fail(400, 'Use from and to as YYYY-MM-DD, with from before to.');
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { from, to, fromTs: new Date(`${from}T00:00:00`).toISOString(), toTs: end.toISOString() };
}

const num = (x, d = 1) => (x == null ? null : Number(Number(x).toFixed(d)));

export function registerInsightRoutes(app, { auth, fail }) {
  // ---------- slot rescue (patient) ----------

  app.get('/api/v1/me/slot-offers', auth('patient'), async (req, res) => {
    res.json(await q(
      `SELECT o.id, o.status, o.expires_at, o.visit_id, s.starts_at AS offered_at, cur.starts_at AS current_at,
              d.name AS department_name, d.location AS department_location, t.name AS test_name
         FROM slot_offers o
         JOIN slots s ON s.id = o.slot_id
         JOIN visits v ON v.id = o.visit_id
         JOIN slots cur ON cur.id = v.slot_id
         JOIN departments d ON d.id = s.department_id
         LEFT JOIN tests t ON t.id = v.test_id
        WHERE o.offered_to = $1 AND (o.status = 'offered' OR o.updated_at > now() - interval '2 days')
        ORDER BY (o.status = 'offered') DESC, o.created_at DESC`,
      [req.user.id]
    ));
  });

  app.post('/api/v1/slot-offers/:id/accept', auth('patient'), async (req, res) => {
    const visitId = await acceptOffer(req.params.id, req.user.id);
    res.json({ ok: true, visitId });
  });

  app.post('/api/v1/slot-offers/:id/decline', auth('patient'), async (req, res) => {
    if (!(await declineOffer(req.params.id, req.user.id))) fail(404, 'This offer is no longer open.');
    res.json({ ok: true });
  });

  // ---------- analytics (admin) ----------

  // Wait = check-in to being called; service = start to finish. Per department plus a daily trend.
  app.get('/api/v1/analytics/wait-times', auth('admin'), async (req, res) => {
    const r = range(req, fail);
    const waitExpr = `EXTRACT(EPOCH FROM (t.called_at - t.checked_in_at)) / 60`;
    const svcExpr = `EXTRACT(EPOCH FROM (t.service_ended_at - t.service_started_at)) / 60`;
    const where = `t.service_date BETWEEN $1::date AND $2::date AND t.called_at IS NOT NULL`;
    const overall = await one(
      `SELECT count(*)::int AS n, avg(${waitExpr}) AS avg_wait,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${waitExpr}) AS median_wait,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY ${waitExpr}) AS p90_wait
         FROM queue_tokens t WHERE ${where}`,
      [r.from, r.to]
    );
    const byDept = await q(
      `SELECT d.name AS department, count(*)::int AS n, avg(${waitExpr}) AS avg_wait,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${waitExpr}) AS median_wait,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${svcExpr}) FILTER (WHERE t.service_ended_at IS NOT NULL) AS median_service
         FROM queue_tokens t JOIN departments d ON d.id = t.department_id
        WHERE ${where} GROUP BY d.name ORDER BY avg(${waitExpr}) DESC`,
      [r.from, r.to]
    );
    const daily = await q(
      `SELECT to_char(t.service_date, 'YYYY-MM-DD') AS day, count(*)::int AS n, avg(${waitExpr}) AS avg_wait
         FROM queue_tokens t WHERE ${where} GROUP BY t.service_date ORDER BY t.service_date`,
      [r.from, r.to]
    );
    res.json({
      range: { from: r.from, to: r.to },
      overall: { n: overall.n, avg_wait: num(overall.avg_wait), median_wait: num(overall.median_wait), p90_wait: num(overall.p90_wait) },
      by_department: byDept.map((d) => ({ ...d, avg_wait: num(d.avg_wait), median_wait: num(d.median_wait), median_service: num(d.median_service) })),
      daily: daily.map((d) => ({ ...d, avg_wait: num(d.avg_wait) })),
    });
  });

  // No-show rate = no-shows / visits that should have happened (past, not cancelled).
  app.get('/api/v1/analytics/no-shows', auth('admin'), async (req, res) => {
    const r = range(req, fail);
    const rows = await q(
      `SELECT d.name AS department,
              count(*) FILTER (WHERE v.status <> 'cancelled')::int AS expected,
              count(*) FILTER (WHERE v.status = 'no_show')::int AS no_shows,
              count(*) FILTER (WHERE v.status = 'cancelled')::int AS cancelled
         FROM visits v JOIN slots s ON s.id = v.slot_id JOIN departments d ON d.id = v.department_id
        WHERE s.starts_at >= $1 AND s.starts_at < $2 AND s.starts_at < now()
        GROUP BY d.name ORDER BY d.name`,
      [r.fromTs, r.toTs]
    );
    const tot = rows.reduce((a, x) => ({ expected: a.expected + x.expected, no_shows: a.no_shows + x.no_shows, cancelled: a.cancelled + x.cancelled }), { expected: 0, no_shows: 0, cancelled: 0 });
    const rate = (x) => (x.expected ? num((100 * x.no_shows) / x.expected) : null);
    res.json({
      range: { from: r.from, to: r.to },
      overall: { ...tot, rate: rate(tot) },
      by_department: rows.filter((x) => x.expected || x.cancelled).map((x) => ({ ...x, rate: rate(x) })).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1)),
    });
  });

  // Incomplete preparation = visits whose readiness was "at risk" at the moment of check-in.
  app.get('/api/v1/analytics/readiness', auth('admin'), async (req, res) => {
    const r = range(req, fail);
    const rows = await q(
      `SELECT COALESCE(t.name, 'Consultation (no test)') AS test, d.name AS department,
              count(*)::int AS checked_in,
              count(*) FILTER (WHERE v.readiness_at_checkin = 'at_risk')::int AS at_risk
         FROM visits v JOIN slots s ON s.id = v.slot_id JOIN departments d ON d.id = v.department_id
         LEFT JOIN tests t ON t.id = v.test_id
        WHERE s.starts_at >= $1 AND s.starts_at < $2 AND v.readiness_at_checkin IS NOT NULL AND v.test_id IS NOT NULL
        GROUP BY t.name, d.name ORDER BY count(*) FILTER (WHERE v.readiness_at_checkin = 'at_risk') DESC, t.name`,
      [r.fromTs, r.toTs]
    );
    const tot = rows.reduce((a, x) => ({ checked_in: a.checked_in + x.checked_in, at_risk: a.at_risk + x.at_risk }), { checked_in: 0, at_risk: 0 });
    const pct = (x) => (x.checked_in ? num((100 * x.at_risk) / x.checked_in) : null);
    res.json({
      range: { from: r.from, to: r.to },
      overall: { ...tot, rate: pct(tot) },
      by_test: rows.map((x) => ({ ...x, rate: pct(x) })),
    });
  });

  app.get('/api/v1/analytics/slot-rescue', auth('admin'), async (req, res) => {
    const r = range(req, fail);
    const s = await one(
      `SELECT count(*)::int AS offers,
              count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
              count(*) FILTER (WHERE status = 'declined')::int AS declined,
              count(*) FILTER (WHERE status = 'expired')::int AS expired,
              count(*) FILTER (WHERE status = 'offered')::int AS open,
              count(DISTINCT slot_id) FILTER (WHERE status = 'accepted')::int AS slots_refilled
         FROM slot_offers WHERE created_at >= $1 AND created_at < $2`,
      [r.fromTs, r.toTs]
    );
    res.json({ range: { from: r.from, to: r.to }, ...s });
  });
}
