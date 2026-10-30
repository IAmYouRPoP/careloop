// Phase 2 routes: caregiver sharing, discharge and follow-up, medications, reminders.
import { db, q, one, localDate } from './db.js';
import {
  sendEmail, addReminder, scheduleFollowUpReminders, scheduleMedicationReminders,
} from './reminders.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
// A real calendar date: rejects 2026-02-30.
const realDate = (s) => YMD.test(s || '') && localDate(new Date(`${s}T00:00:00`)) === s;

export function registerCareRoutes(app, { auth, fail, visitFor, io }) {
  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

  // ---------- caregivers ----------

  app.get('/api/v1/me/caregivers', auth('patient'), async (req, res) => {
    res.json(await q(
      `SELECT l.*, u.full_name AS caregiver_name FROM caregiver_links l LEFT JOIN users u ON u.id = l.caregiver_id
        WHERE l.patient_id = $1 AND l.status <> 'revoked' ORDER BY l.created_at`,
      [req.user.id]
    ));
  });

  app.post('/api/v1/me/caregivers', auth('patient'), async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const permission = req.body?.permission === 'view_and_tick' ? 'view_and_tick' : 'view';
    if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Enter a valid email address.');
    const me = await one('SELECT email, full_name FROM users WHERE id = $1', [req.user.id]);
    if (me.email === email) fail(400, 'You can’t invite yourself.');
    const existing = await one('SELECT role FROM users WHERE email = $1', [email]);
    if (existing && existing.role !== 'patient') fail(400, 'That email belongs to a hospital staff account, which can’t be a caregiver.');
    if (await one(`SELECT 1 FROM caregiver_links WHERE patient_id = $1 AND invite_email = $2 AND status <> 'revoked'`, [req.user.id, email])) {
      fail(409, 'You’ve already invited this person.');
    }
    const link = await one(
      `INSERT INTO caregiver_links (patient_id, invite_email, permission) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, email, permission]
    );
    const url = `${baseUrl(req)}/#/invite/${link.invite_token}`;
    await sendEmail(email, `${me.full_name} invited you as a caregiver on CareLoop`,
      `${me.full_name} would like you to follow their hospital visits on CareLoop` +
      `${permission === 'view_and_tick' ? ' and help tick off their recovery tasks' : ''}.\n\nAccept: ${url}`
    ).catch((e) => console.error('Invite email failed:', e.message));
    res.status(201).json({ ...link, invite_url: url });
  });

  app.patch('/api/v1/me/caregivers/:id', auth('patient'), async (req, res) => {
    const { permission, status } = req.body || {};
    if (permission && !['view', 'view_and_tick'].includes(permission)) fail(400, 'Unknown permission.');
    if (status && status !== 'revoked') fail(400, 'You can only revoke access.');
    const link = await one(
      `UPDATE caregiver_links SET permission = COALESCE($3, permission), status = COALESCE($4, status), updated_at = now()
        WHERE id = $1 AND patient_id = $2 AND status <> 'revoked' RETURNING *`,
      [req.params.id, req.user.id, permission || null, status || null]
    );
    if (!link) fail(404, 'Caregiver not found, or access was already removed.');
    if (status === 'revoked' && link.caregiver_id) {
      // Stop future reminders going to someone who no longer has access.
      await q(
        `DELETE FROM reminders WHERE user_id = $1 AND sent_at IS NULL
           AND visit_id IN (SELECT id FROM visits WHERE patient_id = $2)`,
        [link.caregiver_id, req.user.id]
      );
    }
    res.json(link);
  });

  async function findInvite(token) {
    if (!/^[0-9a-f-]{36}$/i.test(token)) fail(404, 'This invite link is not valid.');
    const link = await one(
      `SELECT l.*, u.full_name AS patient_name FROM caregiver_links l JOIN users u ON u.id = l.patient_id WHERE l.invite_token = $1`,
      [token]
    );
    if (!link) fail(404, 'This invite link is not valid.');
    return link;
  }

  app.get('/api/v1/caregiver-invites/:token', auth(), async (req, res) => {
    const l = await findInvite(req.params.token);
    res.json({ patient_name: l.patient_name, permission: l.permission, status: l.status, invite_email: l.invite_email, mine: l.caregiver_id === req.user.id });
  });

  app.post('/api/v1/caregiver-invites/:token/accept', auth('patient'), async (req, res) => {
    const l = await findInvite(req.params.token);
    if (l.status === 'revoked') fail(410, 'This invite has been withdrawn.');
    if (l.status === 'active') {
      if (l.caregiver_id === req.user.id) return res.json({ ok: true });
      fail(409, 'This invite has already been used.');
    }
    if (l.patient_id === req.user.id) fail(400, 'You can’t accept your own invite.');
    const me = await one('SELECT email FROM users WHERE id = $1', [req.user.id]);
    if (me.email !== l.invite_email) fail(403, `This invite was sent to ${l.invite_email}. Log in with that email to accept it.`);
    await q(`UPDATE caregiver_links SET caregiver_id = $2, status = 'active', updated_at = now() WHERE id = $1`, [l.id, req.user.id]);
    res.json({ ok: true });
  });

  app.get('/api/v1/me/caring', auth('patient'), async (req, res) => {
    const links = await q(
      `SELECT l.id, l.permission, l.patient_id, u.full_name AS patient_name FROM caregiver_links l
         JOIN users u ON u.id = l.patient_id WHERE l.caregiver_id = $1 AND l.status = 'active' ORDER BY u.full_name`,
      [req.user.id]
    );
    for (const l of links) {
      l.visits = await q(
        `SELECT v.id, v.status, v.readiness, s.starts_at, d.name AS department_name, t.name AS test_name,
                to_char(f.follow_up_date, 'YYYY-MM-DD') AS follow_up_date, f.id AS follow_up_id
           FROM visits v JOIN slots s ON s.id = v.slot_id JOIN departments d ON d.id = v.department_id
           LEFT JOIN tests t ON t.id = v.test_id LEFT JOIN follow_ups f ON f.visit_id = v.id
          WHERE v.patient_id = $1 AND v.status <> 'cancelled' AND s.starts_at > now() - interval '45 days'
          ORDER BY s.starts_at DESC`,
        [l.patient_id]
      );
    }
    res.json(links);
  });

  // ---------- discharge & follow-up ----------

  async function followUpFor(visitId) {
    const f = await one(
      `SELECT f.*, to_char(f.follow_up_date, 'YYYY-MM-DD') AS follow_up_date, u.full_name AS entered_by_name
         FROM follow_ups f JOIN users u ON u.id = f.entered_by WHERE f.visit_id = $1`,
      [visitId]
    );
    if (!f) return { follow_up: null, medications: [] };
    const medications = await q(
      `SELECT id, name, dose_text, times_of_day::text[] AS times_of_day,
              to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
         FROM medications WHERE follow_up_id = $1 ORDER BY created_at`,
      [f.id]
    );
    for (const m of medications) m.times_of_day = m.times_of_day.map((t) => t.slice(0, 5));
    return { follow_up: f, medications };
  }

  app.get('/api/v1/visits/:id/follow-up', auth(), async (req, res) => {
    const v = await visitFor(req);
    res.json(await followUpFor(v.id));
  });

  // Saves discharge notes, the follow-up date and the task list. Re-saving replaces
  // unfinished items; items the patient already ticked are kept.
  app.post('/api/v1/visits/:id/follow-up', auth('staff', 'admin'), async (req, res) => {
    const v = await visitFor(req);
    if (!['in_service', 'completed'].includes(v.status)) fail(400, 'Discharge details can be added once the patient has been seen.');
    const notes = String(req.body?.notes || '').trim();
    if (notes.length > 2000) fail(400, 'Notes must be 2000 characters or fewer.');
    const date = req.body?.follow_up_date || null;
    const tasks = [...new Set((Array.isArray(req.body?.tasks) ? req.body.tasks : []).map((t) => String(t).trim()).filter(Boolean))];
    if (tasks.length > 30) fail(400, 'Add at most 30 tasks.');
    if (tasks.some((t) => t.length > 200)) fail(400, 'Each task must be 200 characters or fewer.');
    if (date && !realDate(date)) fail(400, 'Follow-up date is not valid.');
    if (date && date <= localDate()) fail(400, 'Follow-up date must be after today.');
    if (date && date > localDate(new Date(Date.now() + 366 * 864e5))) fail(400, 'Follow-up date must be within a year.');

    await db.transaction(async (tx) => {
      const existing = await one('SELECT id FROM follow_ups WHERE visit_id = $1', [v.id], tx);
      if (existing) {
        await q(`UPDATE follow_ups SET notes = $2, follow_up_date = $3, entered_by = $4, updated_at = now() WHERE id = $1`,
          [existing.id, notes, date, req.user.id], tx);
      } else {
        await q(`INSERT INTO follow_ups (visit_id, entered_by, notes, follow_up_date) VALUES ($1, $2, $3, $4)`,
          [v.id, req.user.id, notes, date], tx);
      }
      await q(`INSERT INTO checklists (visit_id, kind) VALUES ($1, 'post_visit') ON CONFLICT (visit_id, kind) DO NOTHING`, [v.id], tx);
      const cl = await one(`SELECT id FROM checklists WHERE visit_id = $1 AND kind = 'post_visit'`, [v.id], tx);
      await q(`DELETE FROM checklist_items WHERE checklist_id = $1 AND NOT is_done`, [cl.id], tx);
      const done = new Set((await q(`SELECT text FROM checklist_items WHERE checklist_id = $1`, [cl.id], tx)).map((r) => r.text));
      const items = [...tasks.map((t) => [t, null])];
      if (date) items.push([`Attend your follow-up visit with ${v.department_name}`, new Date(`${date}T09:00:00`).toISOString()]);
      for (const [text, due] of items) {
        if (done.has(text)) continue;
        await q(`INSERT INTO checklist_items (checklist_id, text, item_type, due_at) VALUES ($1, $2, 'task', $3)`, [cl.id, text, due], tx);
      }
      await scheduleFollowUpReminders(v.id, v.patient_id, date, v.department_name, tx);
      if (!existing) {
        await addReminder({
          userId: v.patient_id, visitId: v.id, kind: 'follow_up', sendAt: Date.now() + 5000,
          link: `/#/visits/${v.id}/recovery`,
          subject: `Your recovery plan from ${v.department_name} is ready`,
          body: 'Your care team has added follow-up instructions. Open CareLoop to see your checklist and medicine times.',
        }, tx);
      }
    });
    io.to(`visit:${v.id}`).emit('followup:updated', { visitId: v.id });
    res.json(await followUpFor(v.id));
  });

  function readMedication(body) {
    const name = String(body?.name || '').trim();
    const dose_text = String(body?.dose_text || '').trim();
    const times = (Array.isArray(body?.times_of_day) ? body.times_of_day : String(body?.times_of_day || '').split(','))
      .map((t) => String(t).trim()).filter(Boolean);
    const { start_date, end_date } = body || {};
    if (!name || !dose_text) fail(400, 'Medicine name and dose instructions are required.');
    if (name.length > 100 || dose_text.length > 200) fail(400, 'Keep the name under 100 and the dose under 200 characters.');
    if (!times.length || !times.every((t) => HM.test(t))) fail(400, 'Enter dose times as HH:MM, for example 08:00, 20:00.');
    if (times.length > 8) fail(400, 'Use at most 8 dose times a day.');
    if (!start_date || !end_date) fail(400, 'Start and end dates are required.');
    if (!realDate(start_date) || !realDate(end_date)) fail(400, 'Enter real calendar dates for the start and end.');
    if (end_date < start_date) fail(400, 'End date is before the start date.');
    if (end_date < localDate()) fail(400, 'This schedule has already ended. Check the end date.');
    if (start_date < localDate(new Date(Date.now() - 30 * 864e5))) fail(400, 'The start date is more than 30 days ago.');
    if ((new Date(end_date) - new Date(start_date)) / 864e5 > 90) fail(400, 'Schedules longer than 90 days aren’t supported yet.');
    return { name, dose_text, times: [...new Set(times)].sort(), start_date, end_date };
  }

  async function medicationAccess(req, medicationId) {
    const m = await one(
      `SELECT m.id, f.visit_id FROM medications m JOIN follow_ups f ON f.id = m.follow_up_id WHERE m.id = $1`,
      [medicationId]
    );
    if (!m) fail(404, 'Medicine not found.');
    req.params.id = m.visit_id;
    await visitFor(req);
    return m;
  }

  app.post('/api/v1/follow-ups/:id/medications', auth('staff', 'admin'), async (req, res) => {
    const f = await one('SELECT * FROM follow_ups WHERE id = $1', [req.params.id]);
    if (!f) fail(404, 'Save the discharge details first.');
    const m = readMedication(req.body);
    let made = 0;
    await db.transaction(async (tx) => {
      const row = await one(
        `INSERT INTO medications (follow_up_id, name, dose_text, times_of_day, start_date, end_date)
         VALUES ($1, $2, $3, $4::time[], $5, $6) RETURNING id`,
        [f.id, m.name, m.dose_text, m.times, m.start_date, m.end_date], tx
      );
      made = await scheduleMedicationReminders(row.id, tx);
    });
    io.to(`visit:${f.visit_id}`).emit('followup:updated', { visitId: f.visit_id });
    res.status(201).json({ ...(await followUpFor(f.visit_id)), remindersCreated: made });
  });

  app.patch('/api/v1/medications/:id', auth('staff', 'admin'), async (req, res) => {
    const medId = req.params.id;
    const { visit_id } = await medicationAccess(req, medId);
    const m = readMedication(req.body);
    await db.transaction(async (tx) => {
      await q(
        `UPDATE medications SET name = $2, dose_text = $3, times_of_day = $4::time[], start_date = $5, end_date = $6, updated_at = now()
          WHERE id = $1`,
        [medId, m.name, m.dose_text, m.times, m.start_date, m.end_date], tx
      );
      await scheduleMedicationReminders(medId, tx);
    });
    io.to(`visit:${visit_id}`).emit('followup:updated', { visitId: visit_id });
    res.json(await followUpFor(visit_id));
  });

  app.delete('/api/v1/medications/:id', auth('staff', 'admin'), async (req, res) => {
    const medId = req.params.id;
    const { visit_id } = await medicationAccess(req, medId);
    await db.transaction(async (tx) => {
      await q(`DELETE FROM reminders WHERE medication_id = $1 AND sent_at IS NULL`, [medId], tx);
      await q(`DELETE FROM medications WHERE id = $1`, [medId], tx);
    });
    io.to(`visit:${visit_id}`).emit('followup:updated', { visitId: visit_id });
    res.status(204).end();
  });

  // ---------- reminders ----------

  app.get('/api/v1/me/reminders', auth(), async (req, res) => {
    const cols = `r.id, r.kind, r.send_at, r.sent_at, r.status, r.payload, r.visit_id, pu.full_name AS patient_name, v.patient_id`;
    const from = `FROM reminders r LEFT JOIN visits v ON v.id = r.visit_id LEFT JOIN users pu ON pu.id = v.patient_id`;
    res.json({
      upcoming: await q(`SELECT ${cols} ${from} WHERE r.user_id = $1 AND r.sent_at IS NULL ORDER BY r.send_at LIMIT 40`, [req.user.id]),
      recent: await q(
        `SELECT ${cols} ${from} WHERE r.user_id = $1 AND r.sent_at IS NOT NULL AND r.status = 'sent'
           AND r.sent_at > now() - interval '7 days' ORDER BY r.sent_at DESC LIMIT 30`,
        [req.user.id]
      ),
    });
  });
}
