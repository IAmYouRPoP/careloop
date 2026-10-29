# CareLoop

Guides a patient before, during and after a hospital visit, with a simple dashboard for hospital staff.
This build covers every phase of the project document: **Phase 1 (MVP)**, **Phase 2 (after the visit)**, **Phase 3 (symptom guide, rule-based with optional Claude extraction)** and **Phase 4 (analytics and slot rescue)**.

> Demo build with synthetic data. Not for real medical use.

## Run it

Needs Node 20 or newer. No database install: PostgreSQL runs inside Node via [PGlite](https://pglite.dev).

```bash
npm install
npm start
```

Open http://localhost:3000. The first start creates `data/` and seeds synthetic data (takes a few seconds).

- `npm run dev`: restart automatically on server changes
- `npm run reset`: delete the database (stop the server first); the next start re-seeds it

Every setting is optional for local use; see [.env.example](.env.example) for the full list.

## Demo accounts

All share the password `CareLoop#2026` (defined in `server/seed.js`). The login page has one-click buttons for them.

| Role | Email | Notes |
| --- | --- | --- |
| Patient | patient@careloop.test | Visit today, fasting blood test tomorrow, a recovery plan from 5 days ago, opted in to earlier slots |
| Caregiver | caregiver@careloop.test | Patient account that Priya shares her visits with (can tick recovery tasks) |
| Patient | arjun@careloop.test | Holds the only place in a Dermatology slot in 2 days; cancel it to trigger slot rescue |
| Staff | staff@careloop.test | General Medicine; today's queue already has 5 people |
| Staff | lab@careloop.test | Pathology Lab |
| Admin | admin@careloop.test | All setup pages, analytics and the symptom test |

## Demo walkthrough

**Find care**
1. **Symptom guide** (no login): try "sudden chest pain" (emergency) and "itchy rash" (Dermatology, this week).
2. **Conditions**: search "dengue" or "UTI" for common symptoms, the department, and MedlinePlus / NHS / WHO links.

**Before and during**
3. Log in as the **patient**. Open the lab test's **Prepare** tab: a missing document flags it *Not ready*. Tick it and readiness updates. Expand "Source" to see the original instruction.
4. Open today's visit → **Queue** → **Check in** (or scan the QR code from **Staff → Today → Check-in QR**). You get a token, position and an estimate based on real past service times.
5. In another browser, log in as **staff** → **Queue**. **Call next** until the patient's token: their page shows "It's your turn". **Skip** a patient: they see a countdown, and staff can **Bring back** them as next in line until the grace period ends.
6. **Waiting-room display** shows called tokens and the check-in QR.

**After**
7. As **staff**, click **Discharge** on a finished patient: follow-up date, notes, tasks, medicines with dose times. The patient's **Recovery** page updates live and reminders are scheduled.
8. As the **caregiver**, open **Caring**; tick a recovery task. Caregivers can't check in, cancel, or tick preparation items.
9. **Profile**: invite caregivers, turn on text reminders, opt in to earlier slots.

**Run the hospital**
10. As **admin**, **Analytics**: average wait, no-show rate, arrived-not-ready rate, slots rescued; 7/14/30 days; **Download CSV** or **Print / Save as PDF**.
11. **Symptom test**: runs 50 test cases and reports routing accuracy and red flags caught.
12. **Slot rescue**: Priya on **Offers** in one browser; Arjun cancels his Dermatology visit in another. Priya and Meera get the offer live; the first to accept moves up and the slot they leave is offered on.

**Anywhere**: switch **हिन्दी / English** and **light / dark** (◐) in the header.

## Symptom guide

Pipeline, in [server/logic.js](server/logic.js):

1. **Red flags first**: the patient's words are matched against red-flag rules (chest pain, stroke signs, severe bleeding, poisoning, pregnancy bleeding, infant fever and more). Any hit shows the 112 / 108 emergency message straight away; no AI call is made.
2. **Optional AI extraction** ([server/llm.js](server/llm.js)): if `ANTHROPIC_API_KEY` is set, Claude reads the description and returns symptom keys, constrained by a JSON schema to the rule table's own vocabulary. It never picks a department, urgency, diagnosis or medicine. Any error, timeout or refusal falls back to rules only.
3. **Rule table**: 78 rules across 16 departments decide department and urgency (most urgent wins, then the most specific phrase).
4. A fixed disclaimer, a **Book** button, and every attempt logged in `symptom_sessions`.

Matching is word-based (any order, simple word endings), which errs toward over-triage: "no chest pain" still shows the emergency message.

**Evaluation** ([server/symptom-cases.json](server/symptom-cases.json), admin → Symptom test): 50 synthetic cases, 15 of them emergencies. Rules only, the current result is **92% overall, 14 of 15 emergencies caught (93.3%), 0 false alarms, 91.4% department routing**. The misses are unusual wording ("my chest feels heavy", "I broke my arm"), which is what the AI step is for; run the comparison with a key set. Have a clinician review both the cases and the rules before reporting results.

## Reminders, email and SMS

A scheduler checks every 15 seconds for due reminders. Each goes by email, as a live pop-up on any open CareLoop page, and by SMS for patients who opted in. Without settings, emails and texts are printed to the server console (`[email:dev]`, `[sms:dev]`), which works for a demo.

| When | Kind | Sent to |
| --- | --- | --- |
| Booking: 24 h before the slot | Appointment | Patient (skipped if cancelled) |
| Booking: 24 h and 3 h before | Preparation | Patient, only if the checklist is still not ready |
| Discharge saved | Recovery plan ready | Patient |
| Every dose time | Medicine | Patient and active caregivers |
| Evening before and morning of a follow-up | Follow-up | Patient and active caregivers |
| Token called | Your turn (SMS only) | Patient |

## Queue details

- **Wait estimate**: median of the last 20 completed visits in 14 days × people ahead, with a range. "Low confidence" under 20 visits; the department's standard time under 5.
- **QR check-in**: each department's code changes daily (signed with `JWT_SECRET`); scanning finds the patient's booking today and issues a token.
- **Grace period**: a skipped patient stays in the queue for `GRACE_MINUTES` (default 15). Staff can bring them back as next in line; after that the visit becomes a no-show.

## Slot rescue

- Triggered when a booked visit is cancelled (by the patient or staff), and again for the slot a patient leaves when they accept an earlier one.
- Eligible: opted-in patients with a later booked visit in the same department within 14 days. Slots starting within 2 hours aren't offered; fasting tests need enough time left to fast.
- Up to 3 offers open per slot, 30 minutes each. First to accept wins; declined or expired offers pass to the next patients.
- Accepting moves the visit: checklist items keep their source, fasting and due times shift, reminders are rescheduled.

## Analytics definitions

| Metric | Definition |
| --- | --- |
| Wait | Check-in to being called |
| Service time | Start to finish with staff |
| No-show rate | No-shows ÷ past visits that were not cancelled |
| Arrived not ready | Test visits whose readiness was "not ready" at check-in |
| Slots rescued | Distinct slots where an offer was accepted |

## Deploy

CareLoop needs a host that keeps a server running (for live updates and the reminder scheduler). Serverless hosts like Vercel or Netlify won't work.

**Render (free, good for a demo link)**
1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com): **New + → Blueprint**, pick the repository. [render.yaml](render.yaml) sets the build, start command, `NODE_ENV=production` and a generated `JWT_SECRET`.
3. After the first deploy, set `PUBLIC_URL` to the site's address (used in QR codes and email links).

The free plan sleeps after 15 minutes idle; the first visit after that takes 30 to 60 seconds and starts with fresh demo data. Open the link once before presenting. Reminders don't fire while it sleeps. For data that survives restarts, use a paid plan with a disk and set `DATA_DIR` (see the comments in `render.yaml`).

Optional settings on the host: `ANTHROPIC_API_KEY` (AI extraction), SMTP (email), Twilio (SMS), `DEMO_MODE=off` (hide demo sign-ins).

**Before any real use**: this demo has no encryption at rest, audit log, backups, rate limiting or refresh tokens, and its clinical content is unreviewed. Don't enter real patient data.

## Structure

```
server/
  index.js      Express API (/api/v1), Socket.IO rooms, auth, queue, QR check-in
  logic.js      wait estimate, readiness check, symptom matching
  llm.js        optional Claude symptom extraction
  conditions.js condition lookup data (sources checked 2026-10-29)
  care.js       Phase 2 routes: caregivers, discharge/follow-up, medications, reminders
  reminders.js  reminders, email (Nodemailer), SMS (Twilio), scheduler
  rescue.js     slot rescue: offers, accept/decline, expiry and cascade
  insights.js   Phase 4 routes: slot offers and analytics
  schema.sql    PostgreSQL schema (runs on every start; idempotent)
  seed.js       synthetic departments, tests, instructions, rules, users, history
  symptom-cases.json  symptom guide test set
public/
  index.html    shell (Tailwind via CDN), dark-mode and print styles
  app.js        hash router, navigation, language and theme switches
  i18n.js       Hindi translations for the patient screens
  patient.js    public and patient pages
  staff.js      staff dashboard, display, QR poster, admin pages
  care.js       recovery, caregivers, invites, reminders, staff discharge
  insights.js   offers, analytics, symptom test
  lib.js        API client, sockets, formatting, UI helpers
```

## Differences from the project document

- **Frontend** is a dependency-free single-page app (vanilla JS + Tailwind CDN) rather than Next.js: one `npm start`, no build step. Routes match the document's page list.
- **Database** is PGlite (embedded PostgreSQL). For a real PostgreSQL server, swap `server/db.js` for `pg`; the SQL stays the same.
- Extra columns: `test_instructions.item_type` and `is_current`; `caregiver_links.invite_token`; `reminders.status`, `error`, `medication_id`; `slot_offers.visit_id`; `visits.readiness_at_checkin`; `queue_tokens.skipped_at`; `users.slot_rescue_opt_in`, `sms_opt_in`, `language`.
- Caregivers are ordinary patient accounts; an invite can only be accepted with the invited email.
- Hindi covers the patient screens; staff and admin pages are English, and hospital instructions and medicine names always show as entered.
- Auth uses an 8-hour JWT (no refresh tokens). Medicine schedules are capped at 90 days.
