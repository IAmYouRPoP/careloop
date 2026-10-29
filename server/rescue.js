// Slot rescue: when a booking is cancelled, offer the freed place to opted-in patients
// who already have a later visit in the same department. First to accept moves up; the
// slot they leave is offered on in turn.
import { db, q, one } from './db.js';
import { sendEmail, scheduleVisitReminders } from './reminders.js';
import { recomputeReadiness } from './logic.js';

const BATCH = 3;              // offers open at once per slot
const OFFER_MINUTES = 30;     // how long an offer stays open
const MIN_LEAD_MINUTES = 120; // don't offer slots starting sooner than this
const LOOKAHEAD_DAYS = 14;    // only move visits booked within this window

const fmtDT = (d) =>
  new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

let io = null;
let baseUrl = '';
export function initRescue(socketServer, url) { io = socketServer; baseUrl = url; }

// Offer a slot with free space to the next batch of eligible patients.
export async function offerSlot(slotId) {
  const slot = await one(
    `SELECT s.*, d.name AS dept FROM slots s JOIN departments d ON d.id = s.department_id WHERE s.id = $1`,
    [slotId]
  );
  if (!slot || slot.booked_count >= slot.capacity) return 0;
  if (new Date(slot.starts_at) < new Date(Date.now() + MIN_LEAD_MINUTES * 60e3)) return 0;
  const open = await one(`SELECT count(*)::int AS n FROM slot_offers WHERE slot_id = $1 AND status = 'offered'`, [slotId]);
  // Offer to a small batch at once even for one free place: first to accept wins.
  const room = BATCH - open.n;
  if (room <= 0) return 0;

  // Eligible: opted in, a later booked visit in this department, never offered this slot,
  // not already in this slot, and (for fasting tests) enough time left to fast.
  const candidates = await q(
    `SELECT v.id AS visit_id, v.patient_id, s.starts_at AS current_at, u.email, u.full_name, t.fasting_hours
       FROM visits v
       JOIN slots s ON s.id = v.slot_id
       JOIN users u ON u.id = v.patient_id
       LEFT JOIN tests t ON t.id = v.test_id
      WHERE v.department_id = $1 AND v.status = 'booked' AND u.slot_rescue_opt_in AND u.is_active
        AND s.starts_at > $2 AND s.starts_at < $2::timestamptz + make_interval(days => $3)
        AND NOT EXISTS (SELECT 1 FROM slot_offers o WHERE o.slot_id = $4 AND o.offered_to = v.patient_id)
        AND NOT EXISTS (SELECT 1 FROM visits v2 WHERE v2.slot_id = $4 AND v2.patient_id = v.patient_id AND v2.status <> 'cancelled')
        AND (t.fasting_hours IS NULL OR $2::timestamptz - make_interval(hours => t.fasting_hours) > now() + interval '30 minutes')
      ORDER BY v.created_at
      LIMIT $5`,
    [slot.department_id, slot.starts_at, LOOKAHEAD_DAYS, slotId, room]
  );

  const expires = new Date(Math.min(Date.now() + OFFER_MINUTES * 60e3, new Date(slot.starts_at).getTime() - 60 * 60e3));
  for (const c of candidates) {
    await q(
      `INSERT INTO slot_offers (slot_id, offered_to, visit_id, expires_at) VALUES ($1, $2, $3, $4)`,
      [slotId, c.patient_id, c.visit_id, expires.toISOString()]
    );
    const subject = `Earlier slot available: ${slot.dept} on ${fmtDT(slot.starts_at)}`;
    const body = `A place opened up. You can move your ${slot.dept} visit from ${fmtDT(c.current_at)} to ${fmtDT(slot.starts_at)}. ` +
      `The first person to accept gets it; the offer closes at ${fmtDT(expires)}.`;
    io?.to(`user:${c.patient_id}`).emit('reminder', { kind: 'slot_offer', subject, body, link: '/#/offers' });
    io?.to(`user:${c.patient_id}`).emit('offer:new', {});
    sendEmail(c.email, subject, `${body}\n\n${baseUrl}/#/offers`).catch((e) => console.error('Offer email failed:', e.message));
  }
  return candidates.length;
}

// Expire stale offers and pass each slot on to the next patients.
export async function sweepOffers() {
  const expired = await q(
    `UPDATE slot_offers SET status = 'expired', updated_at = now()
      WHERE status = 'offered' AND expires_at <= now() RETURNING slot_id, offered_to`
  );
  for (const e of expired) io?.to(`user:${e.offered_to}`).emit('offer:new', {});
  for (const slotId of new Set(expired.map((e) => e.slot_id))) await offerSlot(slotId);
}

export async function declineOffer(offerId, userId) {
  const o = await one(
    `UPDATE slot_offers SET status = 'declined', updated_at = now()
      WHERE id = $1 AND offered_to = $2 AND status = 'offered' RETURNING slot_id`,
    [offerId, userId]
  );
  if (!o) return false;
  await offerSlot(o.slot_id);
  return true;
}

// Move the patient's visit into the offered slot. Returns the moved visit id.
export async function acceptOffer(offerId, userId) {
  const moved = await db.transaction(async (tx) => {
    const o = await one(`SELECT * FROM slot_offers WHERE id = $1 AND offered_to = $2`, [offerId, userId], tx);
    if (!o) throw Object.assign(new Error('Offer not found.'), { status: 404 });
    if (o.status !== 'offered') {
      const why = { accepted: 'You already accepted this offer.', declined: 'You declined this offer.', expired: 'Sorry, this slot is no longer available.' };
      throw Object.assign(new Error(why[o.status] || 'This offer is closed.'), { status: 409 });
    }
    if (new Date(o.expires_at) <= new Date()) throw Object.assign(new Error('This offer has expired.'), { status: 410 });
    const slot = await one('SELECT * FROM slots WHERE id = $1', [o.slot_id], tx);
    if (slot.booked_count >= slot.capacity) {
      await q(`UPDATE slot_offers SET status = 'expired', updated_at = now() WHERE id = $1`, [o.id], tx);
      throw Object.assign(new Error('Sorry, someone else took this slot first.'), { status: 409 });
    }
    const v = await one(
      `SELECT v.*, t.fasting_hours FROM visits v LEFT JOIN tests t ON t.id = v.test_id WHERE v.id = $1`,
      [o.visit_id], tx
    );
    if (!v || v.status !== 'booked') throw Object.assign(new Error('Your original visit is no longer booked.'), { status: 409 });

    await q(`UPDATE slots SET booked_count = GREATEST(booked_count - 1, 0), updated_at = now() WHERE id = $1`, [v.slot_id], tx);
    await q(`UPDATE slots SET booked_count = booked_count + 1, updated_at = now() WHERE id = $1`, [slot.id], tx);
    await q(`UPDATE visits SET slot_id = $2, updated_at = now() WHERE id = $1`, [v.id, slot.id], tx);

    // Prep items keep their source; only their due times move with the visit.
    const start = new Date(slot.starts_at).getTime();
    await q(
      `UPDATE checklist_items ci SET due_at = CASE WHEN ci.item_type = 'fasting' AND $3::int IS NOT NULL
                                                   THEN $2::timestamptz - make_interval(hours => $3::int) ELSE $2::timestamptz END,
              updated_at = now()
         FROM checklists c WHERE c.id = ci.checklist_id AND c.visit_id = $1 AND c.kind = 'pre_visit'`,
      [v.id, new Date(start).toISOString(), v.fasting_hours], tx
    );
    await q(`DELETE FROM reminders WHERE visit_id = $1 AND kind IN ('appointment', 'prep') AND sent_at IS NULL`, [v.id], tx);
    await scheduleVisitReminders(v.id, tx);
    await recomputeReadiness(v.id, tx);

    await q(`UPDATE slot_offers SET status = 'accepted', updated_at = now() WHERE id = $1`, [o.id], tx);
    // Any of this patient's other open offers for the same visit are now moot.
    await q(
      `UPDATE slot_offers SET status = 'expired', updated_at = now() WHERE visit_id = $1 AND status = 'offered' AND id <> $2`,
      [v.id, o.id], tx
    );
    // If the slot is now full, close everyone else's offers on it.
    if (slot.booked_count + 1 >= slot.capacity) {
      await q(`UPDATE slot_offers SET status = 'expired', updated_at = now() WHERE slot_id = $1 AND status = 'offered'`, [slot.id], tx);
    }
    return { visitId: v.id, freedSlotId: v.slot_id, slotId: slot.id };
  });
  io?.to(`user:${userId}`).emit('offer:new', {});
  // The place the patient left is now free: offer it on.
  await offerSlot(moved.freedSlotId);
  return moved.visitId;
}

export function startRescueSweeper() {
  setInterval(() => sweepOffers().catch((e) => console.error('Offer sweep error:', e)), 30000);
}
