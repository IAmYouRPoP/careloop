-- CareLoop schema (Phase 1 + rule-based symptom guide).
-- Enums are text + CHECK so the file can be re-run safely.

CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  default_service_minutes int NOT NULL DEFAULT 10,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('patient', 'staff', 'admin')),
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  password_hash text NOT NULL,
  date_of_birth date,
  department_id uuid REFERENCES departments(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  name text NOT NULL,
  requires_fasting boolean NOT NULL DEFAULT false,
  fasting_hours int,
  required_documents text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The verified source text every checklist item traces back to.
-- item_type tells the readiness check which items matter; is_current marks the live version.
CREATE TABLE IF NOT EXISTS test_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES tests(id),
  phase text NOT NULL DEFAULT 'before' CHECK (phase IN ('before', 'during', 'after')),
  item_type text NOT NULL DEFAULT 'info' CHECK (item_type IN ('document', 'fasting', 'task', 'info')),
  text text NOT NULL,
  source_ref text NOT NULL,
  verified_by uuid REFERENCES users(id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id),
  starts_at timestamptz NOT NULL,
  capacity int NOT NULL DEFAULT 4,
  booked_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, starts_at)
);

CREATE TABLE IF NOT EXISTS symptom_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symptom_key text NOT NULL UNIQUE,
  synonyms text[] NOT NULL DEFAULT '{}',
  is_red_flag boolean NOT NULL DEFAULT false,
  department_id uuid REFERENCES departments(id),
  urgency text NOT NULL CHECK (urgency IN ('emergency', 'same_day', 'within_week', 'routine')),
  reviewed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS symptom_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  input_text text NOT NULL,
  extracted_symptoms text[] NOT NULL DEFAULT '{}',
  matched_rule_ids uuid[] NOT NULL DEFAULT '{}',
  result_department_id uuid REFERENCES departments(id),
  result_urgency text,
  red_flag_triggered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES users(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  slot_id uuid NOT NULL REFERENCES slots(id),
  test_id uuid REFERENCES tests(id),
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'checked_in', 'in_service', 'completed', 'no_show', 'cancelled')),
  readiness text NOT NULL DEFAULT 'unknown' CHECK (readiness IN ('unknown', 'ready', 'at_risk')),
  reason text,
  symptom_session_id uuid REFERENCES symptom_sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS queue_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES visits(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  token_number text NOT NULL,
  service_date date NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'called', 'serving', 'done', 'skipped')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  service_started_at timestamptz,
  service_ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES visits(id),
  kind text NOT NULL CHECK (kind IN ('pre_visit', 'post_visit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visit_id, kind)
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid NOT NULL REFERENCES checklists(id),
  instruction_id uuid REFERENCES test_instructions(id),
  text text NOT NULL,
  item_type text NOT NULL DEFAULT 'info' CHECK (item_type IN ('document', 'fasting', 'task', 'info')),
  due_at timestamptz,
  is_done boolean NOT NULL DEFAULT false,
  done_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Phase 2: after the visit ----------

-- A patient shares their visits with a caregiver by email invite.
CREATE TABLE IF NOT EXISTS caregiver_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES users(id),
  caregiver_id uuid REFERENCES users(id),
  invite_email text NOT NULL,
  invite_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  permission text NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'view_and_tick')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL UNIQUE REFERENCES visits(id),
  entered_by uuid NOT NULL REFERENCES users(id),
  follow_up_date date,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Entered by staff only; shown to the patient word for word.
CREATE TABLE IF NOT EXISTS medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follow_up_id uuid NOT NULL REFERENCES follow_ups(id),
  name text NOT NULL,
  dose_text text NOT NULL,
  times_of_day time[] NOT NULL DEFAULT '{}',
  start_date date NOT NULL,
  end_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- status and medication_id are additions so the scheduler can skip stale prep reminders
-- and regenerate a medication's reminders when staff edit it.
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  visit_id uuid REFERENCES visits(id),
  medication_id uuid REFERENCES medications(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('prep', 'appointment', 'medication', 'follow_up', 'slot_offer')),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'in_app')),
  send_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  error text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Phase 4: slot rescue & analytics ----------

ALTER TABLE users ADD COLUMN IF NOT EXISTS slot_rescue_opt_in boolean NOT NULL DEFAULT false;
-- When a called patient was skipped; they can be brought back until the grace period ends.
ALTER TABLE queue_tokens ADD COLUMN IF NOT EXISTS skipped_at timestamptz;
-- Patient opted in to SMS reminders (sent only when Twilio is configured).
ALTER TABLE users ADD COLUMN IF NOT EXISTS sms_opt_in boolean NOT NULL DEFAULT false;
-- Patient's language for the interface ('en' or 'hi').
ALTER TABLE users ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
-- Readiness frozen at check-in, so analytics can count "arrived not ready".
ALTER TABLE visits ADD COLUMN IF NOT EXISTS readiness_at_checkin text;

-- A freed slot offered to an opted-in patient whose visit (visit_id) would move earlier.
-- First to accept wins; the rest expire.
CREATE TABLE IF NOT EXISTS slot_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id uuid NOT NULL REFERENCES slots(id),
  offered_to uuid NOT NULL REFERENCES users(id),
  visit_id uuid NOT NULL REFERENCES visits(id),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'accepted', 'declined', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slot_offers_open ON slot_offers (slot_id, status);
CREATE INDEX IF NOT EXISTS slot_offers_user ON slot_offers (offered_to, status);

CREATE INDEX IF NOT EXISTS reminders_due ON reminders (send_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS caregiver_links_caregiver ON caregiver_links (caregiver_id, status);

CREATE INDEX IF NOT EXISTS queue_tokens_live ON queue_tokens (department_id, service_date, status);
CREATE INDEX IF NOT EXISTS visits_patient ON visits (patient_id, status);
CREATE INDEX IF NOT EXISTS visits_dept_slot ON visits (department_id, slot_id);
CREATE INDEX IF NOT EXISTS symptom_rules_synonyms ON symptom_rules USING gin (synonyms);
