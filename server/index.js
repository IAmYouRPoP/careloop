import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { db, q, one, initSchema, localDate, dayRange, deptCode } from './db.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  serviceStats, todaysQueue, positionIn, readinessFor, recomputeReadiness, assessSymptoms, loadRules,
} from './logic.js';
import { aiStatus, extractSymptoms } from './llm.js';
import { searchConditions } from './conditions.js';
import { seedIfEmpty, DEMO_ACCOUNTS, DEMO_PASSWORD } from './seed.js';
import { registerCareRoutes } from './care.js';
import { scheduleVisitReminders, startScheduler, sendSms, smsStatus, toE164 } from './reminders.js';
import { registerInsightRoutes } from './insights.js';
import { initRescue, offerSlot, startRescueSweeper } from './rescue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Signs login tokens (and the daily QR codes). Required in production; the fallback is for local dev only.
const SECRET = process.env.JWT_SECRET || 'careloop-dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters when NODE_ENV=production.');
  process.exit(1);
}
// Demo mode shows one-click demo sign-ins on the login page. On unless DEMO_MODE=off.
const DEMO_MODE = process.env.DEMO_MODE !== 'off';

await initSchema();
await seedIfEmpty();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(here, '..', 'public')));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

function signToken(u) {
  return jwt.sign({ id: u.id, role: u.role, name: u.full_name, departmentId: u.department_id }, SECRET, { expiresIn: '8h' });
}

function readUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), SECRET); } catch { return null; }
}

function auth(...roles) {
  return (req, res, next) => {
    req.user = readUser(req);
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role.' });
    next();
  };
}
const isStaff = (u) => u.role === 'staff' || u.role === 'admin';

function publicUser(u) {
  const { password_hash, ...rest } = u;
  return rest;
}

async function loadVisit(id) {
  return one(
    `SELECT v.*, s.starts_at, d.name AS department_name, d.location AS department_location,
            t.name AS test_name, t.fasting_hours, t.required_documents,
            u.full_name AS patient_name, u.email AS patient_email,
            qt.id AS token_id, qt.token_number, qt.status AS token_status
       FROM visits v
       JOIN slots s ON s.id = v.slot_id
       JOIN departments d ON d.id = v.department_id
       JOIN users u ON u.id = v.patient_id
       LEFT JOIN tests t ON t.id = v.test_id
       LEFT JOIN queue_tokens qt ON qt.visit_id = v.id
      WHERE v.id = $1`,
    [id]
  );
}

// Who is asking about this visit: staff, the patient, or a caregiver the patient shared it with.
async function accessTo(user, patientId) {
  if (isStaff(user)) return { access: 'staff', permission: null };
  if (patientId === user.id) return { access: 'owner', permission: null };
  const link = await one(
    `SELECT permission FROM caregiver_links WHERE patient_id = $1 AND caregiver_id = $2 AND status = 'active'`,
    [patientId, user.id]
  );
  return link ? { access: 'caregiver', permission: link.permission } : { access: null, permission: null };
}

async function visitFor(req) {
  const v = await loadVisit(req.params.id);
  if (!v) fail(404, 'Visit not found.');
  const { access, permission } = await accessTo(req.user, v.patient_id);
  if (!access) fail(403, 'Not your visit.');
  v.access = access;
  v.can_tick_post = access === 'owner' || permission === 'view_and_tick';
  return v;
}

// ---------- real-time ----------

async function queueStatusForVisit(visitId) {
  const token = await one('SELECT * FROM queue_tokens WHERE visit_id = $1', [visitId]);
  if (!token) return null;
  const tokens = await todaysQueue(token.department_id);
  const stats = await serviceStats(token.department_id);
  return positionIn(tokens, tokens.find((t) => t.visit_id === visitId) || token, stats);
}

async function broadcastQueue(departmentId) {
  const tokens = await todaysQueue(departmentId);
  const stats = await serviceStats(departmentId);
  io.to(`dept:${departmentId}`).emit('queue:updated', { tokens, stats });
  io.to(`display:${departmentId}`).emit('queue:updated', displayData(tokens));
  for (const t of tokens) {
    io.to(`visit:${t.visit_id}`).emit('token:position', positionIn(tokens, t, stats));
  }
}

function displayData(tokens) {
  return {
    nowServing: tokens.filter((t) => t.status === 'serving').map((t) => t.token_number),
    called: tokens.filter((t) => t.status === 'called').map((t) => t.token_number),
    upNext: tokens.filter((t) => t.status === 'waiting').slice(0, 6).map((t) => t.token_number),
  };
}

io.on('connection', (socket) => {
  let user = null;
  try { user = jwt.verify(socket.handshake.auth?.token, SECRET); } catch { /* public display */ }
  if (user) socket.join(`user:${user.id}`); // personal room for live reminders

  socket.on('join', async ({ room } = {}, ack = () => {}) => {
    try {
      const [kind, id] = String(room).split(':');
      if (kind === 'display') {
        socket.join(room);
      } else if (kind === 'dept' && user && isStaff(user)) {
        socket.join(room);
      } else if (kind === 'visit' && user) {
        const v = await one('SELECT patient_id FROM visits WHERE id = $1', [id]);
        if (!v || !(await accessTo(user, v.patient_id)).access) return ack({ ok: false });
        socket.join(room);
      } else {
        return ack({ ok: false });
      }
      ack({ ok: true });
    } catch {
      ack({ ok: false });
    }
  });
  socket.on('leave', ({ room } = {}) => socket.leave(String(room)));
});

// ---------- auth & profile ----------

// Lets the login page offer one-click demo sign-ins. Turned off with DEMO_MODE=off.
app.get('/api/v1/demo-accounts', (req, res) => {
  if (!DEMO_MODE) return res.status(404).json({ error: 'Not found.' });
  res.json({ password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS });
});

app.post('/api/v1/auth/signup', async (req, res) => {
  const { full_name, email, password, phone, date_of_birth } = req.body || {};
  if (!full_name || !email || !password) fail(400, 'Name, email and password are required.');
  if (String(password).length < 8) fail(400, 'Password must be at least 8 characters.');
  if (phone && !toE164(phone)) fail(400, 'Enter the phone number with country code, for example +91 98765 43210.');
  const exists = await one('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (exists) fail(409, 'An account with that email already exists.');
  const u = await one(
    `INSERT INTO users (role, full_name, email, phone, date_of_birth, password_hash)
     VALUES ('patient', $1, lower($2), $3, $4, $5) RETURNING *`,
    [full_name, email, phone || null, date_of_birth || null, await bcrypt.hash(password, 10)]
  );
  res.status(201).json({ token: signToken(u), user: publicUser(u) });
});

app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE lower(email) = lower($1)', [email || '']);
  if (!u || !u.is_active || !(await bcrypt.compare(password || '', u.password_hash))) {
    fail(401, 'Email or password is incorrect.');
  }
  res.json({ token: signToken(u), user: publicUser(u) });
});

app.get('/api/v1/me', auth(), async (req, res) => {
  const u = await one(
    `SELECT u.*, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
    [req.user.id]
  );
  if (!u) fail(401, 'Account not found.');
  res.json(publicUser(u));
});

app.patch('/api/v1/me', auth(), async (req, res) => {
  const { full_name, phone, date_of_birth, slot_rescue_opt_in, sms_opt_in, language } = req.body || {};
  if (phone && !toE164(phone)) fail(400, 'Enter the phone number with country code, for example +91 98765 43210.');
  if (language && !['en', 'hi'].includes(language)) fail(400, 'Unsupported language.');
  const current = await one('SELECT phone FROM users WHERE id = $1', [req.user.id]);
  if (sms_opt_in === true && !(phone || current?.phone)) fail(400, 'Add a phone number first to get text reminders.');
  const bool = (x) => (typeof x === 'boolean' ? x : null);
  const u = await one(
    `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone),
            date_of_birth = COALESCE($4, date_of_birth),
            slot_rescue_opt_in = CASE WHEN role = 'patient' THEN COALESCE($5, slot_rescue_opt_in) ELSE false END,
            sms_opt_in = COALESCE($6, sms_opt_in), language = COALESCE($7, language),
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.user.id, full_name || null, phone || null, date_of_birth || null,
     bool(slot_rescue_opt_in), bool(sms_opt_in), language || null]
  );
  res.json(publicUser(u));
});

// ---------- departments, tests, instructions, slots ----------

app.get('/api/v1/departments', async (req, res) => {
  const all = req.query.all === '1' && readUser(req)?.role === 'admin';
  res.json(await q(`SELECT * FROM departments ${all ? '' : 'WHERE is_active'} ORDER BY name`));
});

app.post('/api/v1/departments', auth('admin'), async (req, res) => {
  const { name, description = '', location = '', default_service_minutes = 10 } = req.body || {};
  if (!name) fail(400, 'Name is required.');
  res.status(201).json(await one(
    `INSERT INTO departments (name, description, location, default_service_minutes) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, description, location, Number(default_service_minutes) || 10]
  ));
});

app.patch('/api/v1/departments/:id', auth('admin'), async (req, res) => {
  const { name, description, location, default_service_minutes, is_active } = req.body || {};
  const d = await one(
    `UPDATE departments SET name = COALESCE($2, name), description = COALESCE($3, description),
            location = COALESCE($4, location), default_service_minutes = COALESCE($5, default_service_minutes),
            is_active = COALESCE($6, is_active), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, description ?? null, location ?? null,
     default_service_minutes != null ? Number(default_service_minutes) : null, is_active ?? null]
  );
  if (!d) fail(404, 'Department not found.');
  res.json(d);
});

app.get('/api/v1/departments/:id/tests', async (req, res) => {
  res.json(await q('SELECT * FROM tests WHERE department_id = $1 AND is_active ORDER BY name', [req.params.id]));
});

app.get('/api/v1/tests', auth('admin', 'staff'), async (req, res) => {
  res.json(await q(
    `SELECT t.*, d.name AS department_name FROM tests t JOIN departments d ON d.id = t.department_id ORDER BY d.name, t.name`
  ));
});

app.post('/api/v1/tests', auth('admin'), async (req, res) => {
  const { department_id, name, requires_fasting = false, fasting_hours = null, required_documents = [] } = req.body || {};
  if (!department_id || !name) fail(400, 'Department and name are required.');
  res.status(201).json(await one(
    `INSERT INTO tests (department_id, name, requires_fasting, fasting_hours, required_documents)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [department_id, name, !!requires_fasting, requires_fasting ? Number(fasting_hours) || null : null, required_documents]
  ));
});

app.patch('/api/v1/tests/:id', auth('admin'), async (req, res) => {
  const { name, requires_fasting, fasting_hours, required_documents, is_active } = req.body || {};
  const t = await one(
    `UPDATE tests SET name = COALESCE($2, name), requires_fasting = COALESCE($3, requires_fasting),
            fasting_hours = CASE WHEN $3::boolean IS FALSE THEN NULL ELSE COALESCE($4, fasting_hours) END,
            required_documents = COALESCE($5, required_documents), is_active = COALESCE($6, is_active), updated_at = now()
      WHERE id = $1 RETURNING *`,
    [req.params.id, name ?? null, requires_fasting ?? null,
     fasting_hours != null ? Number(fasting_hours) : null, required_documents ?? null, is_active ?? null]
  );
  if (!t) fail(404, 'Test not found.');
  res.json(t);
});

app.get('/api/v1/tests/:id/instructions', auth(), async (req, res) => {
  res.json(await q(
    `SELECT i.*, u.full_name AS verified_by_name FROM test_instructions i LEFT JOIN users u ON u.id = i.verified_by
      WHERE i.test_id = $1 AND i.is_current ORDER BY i.phase, i.created_at`,
    [req.params.id]
  ));
});

app.post('/api/v1/tests/:id/instructions', auth('admin', 'staff'), async (req, res) => {
  const { phase = 'before', item_type = 'info', text, source_ref } = req.body || {};
  if (!text || !source_ref) fail(400, 'Instruction text and its source are required.');
  res.status(201).json(await one(
    `INSERT INTO test_instructions (test_id, phase, item_type, text, source_ref, verified_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.params.id, phase, item_type, text, source_ref, req.user.id]
  ));
});

// Editing makes a new version; the old row stays for traceability.
app.put('/api/v1/instructions/:id', auth('admin', 'staff'), async (req, res) => {
  const old = await one('SELECT * FROM test_instructions WHERE id = $1 AND is_current', [req.params.id]);
  if (!old) fail(404, 'Instruction not found.');
  const { text = old.text, source_ref = old.source_ref, item_type = old.item_type, phase = old.phase } = req.body || {};
  const created = await db.transaction(async (tx) => {
    await tx.query('UPDATE test_instructions SET is_current = false, updated_at = now() WHERE id = $1', [old.id]);
    return (await tx.query(
      `INSERT INTO test_instructions (test_id, phase, item_type, text, source_ref, verified_by, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [old.test_id, phase, item_type, text, source_ref, req.user.id, old.version + 1]
    )).rows[0];
  });
  res.json(created);
});

app.delete('/api/v1/instructions/:id', auth('admin'), async (req, res) => {
  await q('UPDATE test_instructions SET is_current = false, updated_at = now() WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

app.get('/api/v1/departments/:id/slots', auth(), async (req, res) => {
  const date = req.query.date ? new Date(`${req.query.date}T00:00:00`) : new Date();
  const [from, to] = dayRange(date);
  res.json(await q(
    `SELECT * FROM slots WHERE department_id = $1 AND starts_at >= $2 AND starts_at < $3
        AND starts_at > now() AND booked_count < capacity ORDER BY starts_at`,
    [req.params.id, from, to]
  ));
});

app.post('/api/v1/slots/generate', auth('admin'), async (req, res) => {
  const { department_id, from, to, start_time = '09:00', end_time = '13:00', interval_min = 30, capacity = 4 } = req.body || {};
  if (!department_id || !from || !to) fail(400, 'Department and date range are required.');
  const step = Math.max(5, Number(interval_min) || 30);
  let created = 0;
  await db.transaction(async (tx) => {
    for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
      const [sh, sm] = start_time.split(':').map(Number);
      const [eh, em] = end_time.split(':').map(Number);
      for (let m = sh * 60 + sm; m < eh * 60 + em; m += step) {
        const at = new Date(d);
        at.setHours(Math.floor(m / 60), m % 60, 0, 0);
        const r = await tx.query(
          `INSERT INTO slots (department_id, starts_at, capacity) VALUES ($1, $2, $3)
           ON CONFLICT (department_id, starts_at) DO NOTHING`,
          [department_id, at.toISOString(), Number(capacity) || 4]
        );
        created += r.affectedRows ?? 0;
      }
    }
  });
  res.status(201).json({ created });
});

// ---------- staff accounts ----------

app.get('/api/v1/users', auth('admin'), async (req, res) => {
  const role = req.query.role;
  const rows = await q(
    `SELECT u.*, d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id
      ${role ? 'WHERE u.role = $1' : "WHERE u.role IN ('staff', 'admin')"} ORDER BY u.role, u.full_name`,
    role ? [role] : []
  );
  res.json(rows.map(publicUser));
});

app.post('/api/v1/users', auth('admin'), async (req, res) => {
  const { full_name, email, password, role = 'staff', department_id = null } = req.body || {};
  if (!full_name || !email || !password) fail(400, 'Name, email and a temporary password are required.');
  if (!['staff', 'admin'].includes(role)) fail(400, 'Role must be staff or admin.');
  if (await one('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])) fail(409, 'Email already in use.');
  const u = await one(
    `INSERT INTO users (role, full_name, email, password_hash, department_id) VALUES ($1, $2, lower($3), $4, $5) RETURNING *`,
    [role, full_name, email, await bcrypt.hash(password, 10), department_id || null]
  );
  res.status(201).json(publicUser(u));
});

app.patch('/api/v1/users/:id', auth('admin'), async (req, res) => {
  const { is_active, department_id } = req.body || {};
  if (req.params.id === req.user.id && is_active === false) fail(400, 'You cannot disable your own account.');
  const u = await one(
    `UPDATE users SET is_active = COALESCE($2, is_active),
            department_id = CASE WHEN $3::boolean THEN $4::uuid ELSE department_id END, updated_at = now()
      WHERE id = $1 AND role IN ('staff', 'admin') RETURNING *`,
    [req.params.id, is_active ?? null, department_id !== undefined, department_id || null]
  );
  if (!u) fail(404, 'Staff account not found.');
  res.json(publicUser(u));
});

// ---------- visits & readiness ----------

app.post('/api/v1/visits', auth('patient'), async (req, res) => {
  const { slot_id, test_id = null, reason = null, symptom_session_id = null } = req.body || {};
  if (!slot_id) fail(400, 'Choose a time slot.');
  const visitId = await db.transaction(async (tx) => {
    const slot = await one('SELECT * FROM slots WHERE id = $1', [slot_id], tx);
    if (!slot) fail(404, 'Slot not found.');
    if (new Date(slot.starts_at) <= new Date()) fail(400, 'That slot has already started.');
    if (slot.booked_count >= slot.capacity) fail(409, 'That slot is full. Please pick another.');
    let test = null;
    if (test_id) {
      test = await one('SELECT * FROM tests WHERE id = $1 AND is_active', [test_id], tx);
      if (!test || test.department_id !== slot.department_id) fail(400, 'That test is not offered by this department.');
    }
    const clash = await one(
      `SELECT 1 FROM visits WHERE patient_id = $1 AND slot_id = $2 AND status NOT IN ('cancelled')`,
      [req.user.id, slot_id], tx
    );
    if (clash) fail(409, 'You already have a visit in that slot.');

    const v = await one(
      `INSERT INTO visits (patient_id, department_id, slot_id, test_id, reason, symptom_session_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, slot.department_id, slot_id, test_id, reason, symptom_session_id], tx
    );
    await q('UPDATE slots SET booked_count = booked_count + 1, updated_at = now() WHERE id = $1', [slot_id], tx);

    // Pre-visit checklist: one item per current verified instruction, linked to its source.
    const cl = await one(`INSERT INTO checklists (visit_id, kind) VALUES ($1, 'pre_visit') RETURNING id`, [v.id], tx);
    if (test) {
      const instr = await q(
        `SELECT * FROM test_instructions WHERE test_id = $1 AND is_current AND phase = 'before' ORDER BY created_at`,
        [test.id], tx
      );
      for (const i of instr) {
        const due = i.item_type === 'fasting' && test.fasting_hours
          ? new Date(new Date(slot.starts_at).getTime() - test.fasting_hours * 3600e3).toISOString()
          : slot.starts_at;
        await q(
          `INSERT INTO checklist_items (checklist_id, instruction_id, text, item_type, due_at) VALUES ($1, $2, $3, $4, $5)`,
          [cl.id, i.id, i.text, i.item_type, due], tx
        );
      }
    }
    await recomputeReadiness(v.id, tx);
    await scheduleVisitReminders(v.id, tx);
    return v.id;
  });
  res.status(201).json(await loadVisit(visitId));
});

app.get('/api/v1/visits', auth(), async (req, res) => {
  if (isStaff(req.user)) {
    const departmentId = req.query.department_id || req.user.departmentId;
    if (!departmentId) fail(400, 'Choose a department.');
    const [from, to] = dayRange(req.query.date ? new Date(`${req.query.date}T00:00:00`) : new Date());
    return res.json(await q(
      `SELECT v.*, s.starts_at, u.full_name AS patient_name, t.name AS test_name,
              qt.token_number, qt.status AS token_status
         FROM visits v JOIN slots s ON s.id = v.slot_id JOIN users u ON u.id = v.patient_id
         LEFT JOIN tests t ON t.id = v.test_id LEFT JOIN queue_tokens qt ON qt.visit_id = v.id
        WHERE v.department_id = $1 AND s.starts_at >= $2 AND s.starts_at < $3
        ORDER BY s.starts_at, u.full_name`,
      [departmentId, from, to]
    ));
  }
  res.json(await q(
    `SELECT v.*, s.starts_at, d.name AS department_name, d.location AS department_location, t.name AS test_name,
            qt.token_number, qt.status AS token_status,
            f.id AS follow_up_id, to_char(f.follow_up_date, 'YYYY-MM-DD') AS follow_up_date
       FROM visits v JOIN slots s ON s.id = v.slot_id JOIN departments d ON d.id = v.department_id
       LEFT JOIN tests t ON t.id = v.test_id LEFT JOIN queue_tokens qt ON qt.visit_id = v.id
       LEFT JOIN follow_ups f ON f.visit_id = v.id
      WHERE v.patient_id = $1 ORDER BY s.starts_at DESC`,
    [req.user.id]
  ));
});

app.get('/api/v1/visits/:id', auth(), async (req, res) => {
  res.json(await visitFor(req));
});

app.patch('/api/v1/visits/:id', auth(), async (req, res) => {
  const v = await visitFor(req);
  const { status } = req.body || {};
  if (!isStaff(req.user)) {
    if (v.access !== 'owner') fail(403, 'Only the patient can change this visit.');
    if (status !== 'cancelled') fail(403, 'Patients can only cancel a visit.');
    if (v.status !== 'booked') fail(400, 'Only a booked visit that has not checked in can be cancelled.');
  }
  const allowed = ['booked', 'checked_in', 'in_service', 'completed', 'no_show', 'cancelled'];
  if (!allowed.includes(status)) fail(400, 'Unknown status.');
  await db.transaction(async (tx) => {
    await q('UPDATE visits SET status = $2, updated_at = now() WHERE id = $1', [v.id, status], tx);
    if (status === 'cancelled' && v.status !== 'cancelled') {
      await q('UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = $1', [v.slot_id], tx);
    }
  });
  if (v.token_id) await broadcastQueue(v.department_id);
  if (status === 'cancelled' && v.status !== 'cancelled') {
    await q(`UPDATE slot_offers SET status = 'expired', updated_at = now() WHERE visit_id = $1 AND status = 'offered'`, [v.id]);
    await offerSlot(v.slot_id);
  }
  res.json(await loadVisit(v.id));
});

app.get('/api/v1/visits/:id/checklists/:kind', auth(), async (req, res) => {
  const v = await visitFor(req);
  res.json(await q(
    `SELECT ci.*, i.source_ref, i.version AS source_version, i.verified_at AS source_verified_at,
            i.text AS source_text, vu.full_name AS verified_by_name
       FROM checklist_items ci
       JOIN checklists c ON c.id = ci.checklist_id
       LEFT JOIN test_instructions i ON i.id = ci.instruction_id
       LEFT JOIN users vu ON vu.id = i.verified_by
      WHERE c.visit_id = $1 AND c.kind = $2
      ORDER BY CASE ci.item_type WHEN 'document' THEN 0 WHEN 'fasting' THEN 1 WHEN 'task' THEN 2 ELSE 3 END, ci.created_at`,
    [v.id, req.params.kind === 'post_visit' ? 'post_visit' : 'pre_visit']
  ));
});

app.patch('/api/v1/checklist-items/:id', auth(), async (req, res) => {
  const item = await one(
    `SELECT ci.*, c.visit_id, c.kind, v.patient_id FROM checklist_items ci
       JOIN checklists c ON c.id = ci.checklist_id JOIN visits v ON v.id = c.visit_id WHERE ci.id = $1`,
    [req.params.id]
  );
  if (!item) fail(404, 'Item not found.');
  // Patients tick everything; caregivers with "view and tick" may tick recovery tasks only.
  const { access, permission } = await accessTo(req.user, item.patient_id);
  const allowed = access === 'owner' || (access === 'caregiver' && permission === 'view_and_tick' && item.kind === 'post_visit');
  if (!allowed) fail(403, 'You can’t tick items on this checklist.');
  const done = !!req.body?.is_done;
  await q(
    `UPDATE checklist_items SET is_done = $2, done_by = $3, updated_at = now() WHERE id = $1`,
    [item.id, done, done ? req.user.id : null]
  );
  const readiness = await recomputeReadiness(item.visit_id);
  res.json({ id: item.id, is_done: done, ...readiness });
});

app.get('/api/v1/visits/:id/readiness', auth(), async (req, res) => {
  const v = await visitFor(req);
  res.json(await readinessFor(v.id));
});

// ---------- live queue ----------

app.post('/api/v1/visits/:id/check-in', auth(), async (req, res) => {
  const v = await visitFor(req);
  if (v.access === 'caregiver') fail(403, 'Only the patient or staff can check in.');
  const created = await checkIn(v);
  res.status(created ? 201 : 200).json(await queueStatusForVisit(v.id));
});

// Issues a token for a booked visit today. Returns false if it already had one.
async function checkIn(v) {
  if (v.token_id) return false;
  if (v.status !== 'booked') fail(400, `This visit is ${v.status.replace('_', ' ')}.`);
  if (localDate(new Date(v.starts_at)) !== localDate()) fail(400, 'Check-in opens on the day of your visit.');
  await db.transaction(async (tx) => {
    const today = localDate();
    const n = await one(
      'SELECT count(*)::int AS n FROM queue_tokens WHERE department_id = $1 AND service_date = $2',
      [v.department_id, today], tx
    );
    const tokenNumber = `${deptCode(v.department_name)}-${String(n.n + 1).padStart(3, '0')}`;
    await q(
      `INSERT INTO queue_tokens (visit_id, department_id, token_number, service_date) VALUES ($1, $2, $3, $4)`,
      [v.id, v.department_id, tokenNumber, today], tx
    );
    const { readiness } = await recomputeReadiness(v.id, tx);
    await q(
      `UPDATE visits SET status = 'checked_in', readiness_at_checkin = $2, updated_at = now() WHERE id = $1`,
      [v.id, readiness], tx
    );
    await q(`UPDATE slot_offers SET status = 'expired', updated_at = now() WHERE visit_id = $1 AND status = 'offered'`, [v.id], tx);
  });
  await broadcastQueue(v.department_id);
  return true;
}

// ---------- QR check-in ----------
// Reception shows a QR code per department. It carries a code that changes daily, so a
// screenshot from yesterday won't work. Scanning opens CareLoop and checks the patient in.

function checkinCode(departmentId, day = localDate()) {
  return crypto.createHmac('sha256', SECRET).update(`${departmentId}:${day}`).digest('hex').slice(0, 10);
}

app.get('/api/v1/departments/:id/checkin-qr', async (req, res) => {
  const d = await one('SELECT id, name FROM departments WHERE id = $1 AND is_active', [req.params.id]);
  if (!d) fail(404, 'Department not found.');
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${base}/#/checkin/${d.id}?code=${checkinCode(d.id)}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.json({ department: d.name, url, svg });
});

app.post('/api/v1/checkin/qr', auth('patient'), async (req, res) => {
  const { department_id, code } = req.body || {};
  if (!department_id || code !== checkinCode(department_id)) fail(400, 'This check-in code has expired. Scan the QR code at reception again.');
  const [from, to] = dayRange();
  const row = await one(
    `SELECT v.id FROM visits v JOIN slots s ON s.id = v.slot_id
      WHERE v.patient_id = $1 AND v.department_id = $2 AND v.status IN ('booked', 'checked_in', 'in_service')
        AND s.starts_at >= $3 AND s.starts_at < $4 ORDER BY s.starts_at LIMIT 1`,
    [req.user.id, department_id, from, to]
  );
  if (!row) fail(404, 'You have no visit booked in this department today. Please speak to reception.');
  const v = await loadVisit(row.id);
  await checkIn(v);
  res.json({ visitId: v.id, ...(await queueStatusForVisit(v.id)) });
});

app.get('/api/v1/visits/:id/queue-status', auth(), async (req, res) => {
  const v = await visitFor(req);
  res.json(await queueStatusForVisit(v.id));
});

function canRunQueue(user, departmentId) {
  if (user.role === 'admin') return;
  if (user.role !== 'staff' || user.departmentId !== departmentId) fail(403, 'You can only run your own department’s queue.');
}

app.get('/api/v1/queues/:departmentId', auth('staff', 'admin'), async (req, res) => {
  canRunQueue(req.user, req.params.departmentId);
  res.json({ tokens: await todaysQueue(req.params.departmentId), stats: await serviceStats(req.params.departmentId) });
});

app.get('/api/v1/queues/:departmentId/display', async (req, res) => {
  const d = await one('SELECT id, name, location FROM departments WHERE id = $1', [req.params.departmentId]);
  if (!d) fail(404, 'Department not found.');
  res.json({ department: d, ...displayData(await todaysQueue(d.id)) });
});

app.post('/api/v1/queues/:departmentId/call-next', auth('staff', 'admin'), async (req, res) => {
  canRunQueue(req.user, req.params.departmentId);
  const next = await one(
    `SELECT t.*, d.location FROM queue_tokens t JOIN departments d ON d.id = t.department_id
      WHERE t.department_id = $1 AND t.service_date = $2 AND t.status = 'waiting'
      ORDER BY t.checked_in_at LIMIT 1`,
    [req.params.departmentId, localDate()]
  );
  if (!next) fail(404, 'Nobody is waiting.');
  await q(`UPDATE queue_tokens SET status = 'called', called_at = now(), updated_at = now() WHERE id = $1`, [next.id]);
  io.to(`visit:${next.visit_id}`).emit('token:called', { tokenNumber: next.token_number, location: next.location });
  const p = await one(`SELECT u.phone, u.sms_opt_in FROM visits v JOIN users u ON u.id = v.patient_id WHERE v.id = $1`, [next.visit_id]);
  if (p?.sms_opt_in && p.phone) {
    sendSms(p.phone, `CareLoop: token ${next.token_number}, it's your turn. Please go to ${next.location}.`)
      .catch((e) => console.error('Turn SMS failed:', e.message));
  }
  await broadcastQueue(next.department_id);
  res.json({ called: next.token_number });
});

async function tokenAction(req, from, to, visitStatus, stamp) {
  const t = await one('SELECT * FROM queue_tokens WHERE id = $1', [req.params.id]);
  if (!t) fail(404, 'Token not found.');
  canRunQueue(req.user, t.department_id);
  if (!from.includes(t.status)) fail(400, `Token is ${t.status}.`);
  await db.transaction(async (tx) => {
    await q(
      `UPDATE queue_tokens SET status = $2, ${stamp ? `${stamp} = now(),` : ''} updated_at = now() WHERE id = $1`,
      [t.id, to], tx
    );
    await q('UPDATE visits SET status = $2, updated_at = now() WHERE id = $1', [t.visit_id, visitStatus], tx);
  });
  return t;
}

app.post('/api/v1/tokens/:id/start', auth('staff', 'admin'), async (req, res) => {
  const t = await tokenAction(req, ['called', 'waiting'], 'serving', 'in_service', 'service_started_at');
  await broadcastQueue(t.department_id);
  res.json({ ok: true });
});

app.post('/api/v1/tokens/:id/finish', auth('staff', 'admin'), async (req, res) => {
  const t = await tokenAction(req, ['serving'], 'done', 'completed', 'service_ended_at');
  io.to(`visit:${t.visit_id}`).emit('visit:completed', { visitId: t.visit_id });
  await broadcastQueue(t.department_id);
  res.json({ ok: true });
});

// Skipping starts a grace period: the patient can still come to the counter and be brought
// back to the front. Only when it runs out does the visit become a no-show.
const GRACE_MINUTES = Number(process.env.GRACE_MINUTES) || 15;

app.post('/api/v1/tokens/:id/skip', auth('staff', 'admin'), async (req, res) => {
  const t = await tokenAction(req, ['called', 'waiting'], 'skipped', 'checked_in', 'skipped_at');
  io.to(`visit:${t.visit_id}`).emit('token:skipped', {
    tokenNumber: t.token_number, graceMinutes: GRACE_MINUTES, until: new Date(Date.now() + GRACE_MINUTES * 60e3).toISOString(),
  });
  await broadcastQueue(t.department_id);
  res.json({ ok: true });
});

// Bring a skipped patient back: they keep their original check-in time, so they're next.
app.post('/api/v1/tokens/:id/requeue', auth('staff', 'admin'), async (req, res) => {
  const t = await one('SELECT t.*, v.status AS visit_status FROM queue_tokens t JOIN visits v ON v.id = t.visit_id WHERE t.id = $1', [req.params.id]);
  if (!t) fail(404, 'Token not found.');
  canRunQueue(req.user, t.department_id);
  if (t.status !== 'skipped' || t.visit_status !== 'checked_in') fail(400, 'Only a skipped patient within the grace period can be brought back.');
  await q(`UPDATE queue_tokens SET status = 'waiting', skipped_at = NULL, called_at = NULL, updated_at = now() WHERE id = $1`, [t.id]);
  await broadcastQueue(t.department_id);
  res.json({ ok: true });
});

async function expireSkipped() {
  const gone = await q(
    `UPDATE visits v SET status = 'no_show', updated_at = now()
       FROM queue_tokens t
      WHERE t.visit_id = v.id AND t.status = 'skipped' AND v.status = 'checked_in'
        AND t.skipped_at < now() - make_interval(mins => $1)
      RETURNING v.id, t.department_id`,
    [GRACE_MINUTES]
  );
  for (const g of gone) io.to(`visit:${g.id}`).emit('visit:no_show', {});
  for (const d of new Set(gone.map((g) => g.department_id))) await broadcastQueue(d);
}
setInterval(() => expireSkipped().catch((e) => console.error('Grace sweep error:', e)), 30000);

// ---------- symptom guide ----------

app.post('/api/v1/symptoms/assess', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (text.length < 3) fail(400, 'Describe how you feel in a few words.');
  if (text.length > 1000) fail(400, 'Please keep it under 1000 characters.');
  res.json(await assessSymptoms(text, readUser(req)?.id, { extract: aiStatus().enabled ? extractSymptoms : null }));
});

app.get('/api/v1/symptoms/ai-status', (req, res) => res.json(aiStatus()));

// Which optional integrations this server has configured.
app.get('/api/v1/features', (req, res) => res.json({ ai: aiStatus().enabled, sms: smsStatus().enabled }));

app.get('/api/v1/conditions', async (req, res) => {
  const depts = await q('SELECT id, name FROM departments WHERE is_active');
  const byName = Object.fromEntries(depts.map((d) => [d.name, d.id]));
  res.json(searchConditions(req.query.q).map((c) => ({ ...c, department_id: byName[c.department] || null })));
});

// Runs the stored test cases (server/symptom-cases.json) without logging them as patient sessions.
app.post('/api/v1/symptoms/evaluate', auth('admin'), async (req, res) => {
  const useAi = !!req.body?.use_ai && aiStatus().enabled;
  const cases = JSON.parse(fs.readFileSync(path.join(here, 'symptom-cases.json'), 'utf8'));
  const rules = await loadRules();
  const fallback = await one(`SELECT id, name FROM departments WHERE name = 'General Medicine'`);
  const results = [];
  for (const c of cases) {
    const r = await assessSymptoms(c.text, null, { log: false, rules, fallback, extract: useAi ? extractSymptoms : null });
    const got = r.emergency ? 'emergency' : r.department?.name;
    results.push({ text: c.text, expect: c.expect, got, pass: got === c.expect, matched: r.matched, aiFound: r.aiFound, aiError: r.ai?.error || null });
  }
  const em = results.filter((x) => x.expect === 'emergency');
  const routine = results.filter((x) => x.expect !== 'emergency');
  const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
  res.json({
    use_ai: useAi,
    total: results.length,
    accuracy: pct(results.filter((x) => x.pass).length, results.length),
    red_flag_sensitivity: pct(em.filter((x) => x.got === 'emergency').length, em.length),
    false_alarms: routine.filter((x) => x.got === 'emergency').length,
    routing_accuracy: pct(routine.filter((x) => x.pass).length, routine.length),
    emergencies: em.length,
    routine: routine.length,
    results,
  });
});

app.get('/api/v1/symptom-rules', auth('admin'), async (req, res) => {
  res.json(await q(
    `SELECT r.*, d.name AS department_name FROM symptom_rules r LEFT JOIN departments d ON d.id = r.department_id
      ORDER BY r.is_red_flag DESC, r.symptom_key`
  ));
});

app.post('/api/v1/symptom-rules', auth('admin'), async (req, res) => {
  const { symptom_key, synonyms = [], is_red_flag = false, department_id = null, urgency, reviewed_by = null } = req.body || {};
  if (!symptom_key || !urgency) fail(400, 'Symptom key and urgency are required.');
  const key = symptom_key.trim().toLowerCase().replace(/\s+/g, '_');
  if (await one('SELECT 1 FROM symptom_rules WHERE symptom_key = $1', [key])) fail(409, 'That symptom key already exists.');
  res.status(201).json(await one(
    `INSERT INTO symptom_rules (symptom_key, synonyms, is_red_flag, department_id, urgency, reviewed_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [key, synonyms.map((s) => s.trim().toLowerCase()).filter(Boolean), !!is_red_flag,
     is_red_flag ? null : department_id, is_red_flag ? 'emergency' : urgency, reviewed_by || null]
  ));
});

app.delete('/api/v1/symptom-rules/:id', auth('admin'), async (req, res) => {
  await q('DELETE FROM symptom_rules WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

registerCareRoutes(app, { auth, fail, visitFor, io });
registerInsightRoutes(app, { auth, fail });

// ---------- errors & SPA fallback ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError || Number.isInteger(err?.status)) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

server.listen(PORT, () => {
  console.log(`CareLoop running at http://localhost:${PORT}`);
  const publicUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
  startScheduler(io, publicUrl);
  initRescue(io, publicUrl);
  startRescueSweeper();
});
