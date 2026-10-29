// Reminders: creation helpers, the email transport, and the scheduler that sends due reminders.
import nodemailer from 'nodemailer';
import { q, one } from './db.js';

// ---------- email ----------

// Real SMTP when SMTP_HOST is set; otherwise emails are logged to the console (dev mode).
const devMail = !process.env.SMTP_HOST;
const transport = devMail
  ? nodemailer.createTransport({ jsonTransport: true })
  : nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
const FROM = process.env.MAIL_FROM || 'CareLoop <no-reply@careloop.test>';

export async function sendEmail(to, subject, text) {
  await transport.sendMail({ from: FROM, to, subject, text });
  if (devMail) console.log(`[email:dev] to=${to} | ${subject}`);
}

// ---------- SMS ----------

// Twilio when its three settings are present; otherwise texts are logged to the console (dev mode).
const TWILIO = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM
  ? { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM }
  : null;

export const smsStatus = () => ({ enabled: !!TWILIO });

// Accepts "+91 90000 00001" style numbers; Twilio needs E.164 (+ and digits only).
export function toE164(phone) {
  const p = String(phone || '').replace(/[\s()-]/g, '');
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

export async function sendSms(phone, text) {
  const to = toE164(phone);
  if (!to) throw new Error('Phone number must start with + and a country code');
  const body = text.length > 300 ? `${text.slice(0, 297)}...` : text;
  if (!TWILIO) {
    console.log(`[sms:dev] to=${to} | ${body}`);
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO.sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${TWILIO.sid}:${TWILIO.token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: TWILIO.from, Body: body }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Twilio error ${res.status}`);
}

// ---------- formatting ----------

const fmtDT = (d) =>
  new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fmtDay = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

// ---------- creation ----------

// Reminders in the past are never created, so nothing fires in a burst at startup.
export async function addReminder({ userId, visitId = null, medicationId = null, kind, sendAt, subject, body, link = null }, conn) {
  if (new Date(sendAt) <= new Date()) return false;
  await q(
    `INSERT INTO reminders (user_id, visit_id, medication_id, kind, send_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [userId, visitId, medicationId, kind, new Date(sendAt).toISOString(), JSON.stringify({ subject, body, link })],
    conn
  );
  return true;
}

// The patient plus every active caregiver.
export async function recipients(patientId, conn) {
  return q(
    `SELECT id FROM users WHERE id = $1
     UNION SELECT caregiver_id FROM caregiver_links WHERE patient_id = $1 AND status = 'active' AND caregiver_id IS NOT NULL`,
    [patientId], conn
  );
}

// On booking: appointment reminder 24 h before, and prep reminders 24 h and 3 h before
// (prep ones are only sent if the visit is still not ready when they fall due).
export async function scheduleVisitReminders(visitId, conn) {
  const v = await one(
    `SELECT v.id, v.patient_id, s.starts_at, d.name AS dept, d.location FROM visits v
       JOIN slots s ON s.id = v.slot_id JOIN departments d ON d.id = v.department_id WHERE v.id = $1`,
    [visitId], conn
  );
  const at = new Date(v.starts_at).getTime();
  const link = `/#/visits/${v.id}`;
  await addReminder({
    userId: v.patient_id, visitId, kind: 'appointment', sendAt: at - 24 * 3600e3, link: `${link}/queue`,
    subject: `Tomorrow: ${v.dept} at ${fmtTime(v.starts_at)}`,
    body: `Your ${v.dept} visit is on ${fmtDT(v.starts_at)} at ${v.location}. Check in on CareLoop when you arrive.`,
  }, conn);
  for (const hours of [24, 3]) {
    await addReminder({
      userId: v.patient_id, visitId, kind: 'prep', sendAt: at - hours * 3600e3 + 60e3, link: `${link}/prepare`,
      subject: `Your ${v.dept} checklist has missing items`,
      body: `Some preparation for your visit on ${fmtDT(v.starts_at)} is not confirmed yet. Open your checklist before you travel.`,
    }, conn);
  }
}

// Follow-up: the evening before (18:00) and the morning of (08:00), to the patient and caregivers.
export async function scheduleFollowUpReminders(visitId, patientId, followUpDate, deptName, conn) {
  await q(`DELETE FROM reminders WHERE visit_id = $1 AND kind = 'follow_up' AND sent_at IS NULL`, [visitId], conn);
  if (!followUpDate) return;
  const day = new Date(`${followUpDate}T00:00:00`);
  const eve = new Date(day); eve.setDate(eve.getDate() - 1); eve.setHours(18, 0, 0, 0);
  const morn = new Date(day); morn.setHours(8, 0, 0, 0);
  for (const r of await recipients(patientId, conn)) {
    for (const [when, label] of [[eve, 'tomorrow'], [morn, 'today']]) {
      await addReminder({
        userId: r.id, visitId, kind: 'follow_up', sendAt: when, link: `/#/visits/${visitId}/recovery`,
        subject: `Follow-up ${label}: ${deptName}`,
        body: `A follow-up visit with ${deptName} is due ${label} (${fmtDay(followUpDate)}). Book a slot on CareLoop if you haven't yet.`,
      }, conn);
    }
  }
}

// One reminder per dose time per day, capped at 90 days. Re-running replaces unsent ones.
export async function scheduleMedicationReminders(medicationId, conn) {
  const m = await one(
    `SELECT m.id, m.name, m.dose_text, m.times_of_day::text[] AS times,
            to_char(m.start_date, 'YYYY-MM-DD') AS start_s, to_char(m.end_date, 'YYYY-MM-DD') AS end_s,
            v.id AS visit_id, v.patient_id
       FROM medications m JOIN follow_ups f ON f.id = m.follow_up_id JOIN visits v ON v.id = f.visit_id
      WHERE m.id = $1`,
    [medicationId], conn
  );
  await q(`DELETE FROM reminders WHERE medication_id = $1 AND sent_at IS NULL`, [medicationId], conn);
  if (!m) return 0;
  const who = await recipients(m.patient_id, conn);
  const end = new Date(`${m.end_s}T00:00:00`);
  let made = 0;
  for (let d = new Date(`${m.start_s}T00:00:00`), n = 0; d <= end && n < 90; d.setDate(d.getDate() + 1), n++) {
    for (const t of m.times) {
      const [h, min] = t.split(':').map(Number);
      const at = new Date(d);
      at.setHours(h, min, 0, 0);
      for (const r of who) {
        const ok = await addReminder({
          userId: r.id, visitId: m.visit_id, medicationId: m.id, kind: 'medication', sendAt: at,
          link: `/#/visits/${m.visit_id}/recovery`,
          subject: `Medicine time: ${m.name}`,
          body: `${m.name}: ${m.dose_text} (as written by your care team).`,
        }, conn);
        if (ok) made++;
      }
    }
  }
  return made;
}

// ---------- scheduler ----------

let running = false;

async function processDue(io, baseUrl) {
  if (running) return;
  running = true;
  try {
    const due = await q(
      `SELECT r.*, u.email, u.phone, u.sms_opt_in, v.readiness, v.status AS visit_status
         FROM reminders r JOIN users u ON u.id = r.user_id LEFT JOIN visits v ON v.id = r.visit_id
        WHERE r.sent_at IS NULL AND r.send_at <= now() ORDER BY r.send_at LIMIT 50`
    );
    for (const r of due) {
      const p = r.payload || {};
      let status = 'sent', error = null;
      const stale =
        (r.kind === 'prep' && (r.readiness !== 'at_risk' || r.visit_status !== 'booked')) ||
        (r.kind === 'appointment' && r.visit_status !== 'booked');
      if (stale) {
        status = 'skipped';
      } else {
        try {
          await sendEmail(r.email, p.subject, `${p.body}\n\n${p.link ? baseUrl + p.link : ''}\n\nCareLoop (synthetic demo)`);
        } catch (e) {
          status = 'failed';
          error = String(e.message || e).slice(0, 500);
        }
        // A text as well, for patients who opted in. An SMS failure doesn't undo a sent email.
        if (r.sms_opt_in && r.phone) {
          try {
            await sendSms(r.phone, `CareLoop: ${p.subject}. ${p.body}`);
          } catch (e) {
            error = `SMS: ${String(e.message || e)}`.slice(0, 500);
            if (status !== 'sent') status = 'failed';
          }
        }
        io.to(`user:${r.user_id}`).emit('reminder', { kind: r.kind, subject: p.subject, body: p.body, link: p.link });
      }
      await q(`UPDATE reminders SET sent_at = now(), status = $2, error = $3, updated_at = now() WHERE id = $1`, [r.id, status, error]);
    }
  } catch (e) {
    console.error('Reminder scheduler error:', e);
  } finally {
    running = false;
  }
}

export function startScheduler(io, baseUrl) {
  setInterval(() => processDue(io, baseUrl), 15000);
  processDue(io, baseUrl);
}
