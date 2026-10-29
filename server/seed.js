// Synthetic demo data. Every person, instruction and rule here is made up for the demo.
import bcrypt from 'bcryptjs';
import { db, q, one, localDate, deptCode } from './db.js';
import { scheduleVisitReminders, scheduleFollowUpReminders, scheduleMedicationReminders } from './reminders.js';

// Demo sign-ins (all share one password). Shown on the login page as demo accounts.
export const DEMO_PASSWORD = 'CareLoop#2026';
export const DEMO_ACCOUNTS = [
  { role: 'patient', email: 'patient@careloop.test', full_name: 'Priya Sharma' },
  { role: 'patient', email: 'caregiver@careloop.test', full_name: 'Rahul Sharma', note: 'caregiver for Priya' },
  { role: 'patient', email: 'arjun@careloop.test', full_name: 'Arjun Rao', note: 'cancel to trigger slot rescue' },
  { role: 'staff', email: 'staff@careloop.test', full_name: 'Ravi Menon', dept: 'General Medicine' },
  { role: 'staff', email: 'lab@careloop.test', full_name: 'Neha Iyer', dept: 'Pathology Lab' },
  { role: 'admin', email: 'admin@careloop.test', full_name: 'Anil Kapoor' },
];

const DEPARTMENTS = [
  ['General Medicine', 'First stop for most adult illnesses; refers on when needed.', 'Block A, Ground floor', 10],
  ['Cardiology', 'Heart and blood pressure.', 'Block B, 2nd floor', 15],
  ['Pathology Lab', 'Blood, urine and other sample tests.', 'Block A, 1st floor', 5],
  ['Radiology', 'X-ray, ultrasound, CT and MRI.', 'Block C, Ground floor', 12],
  ['Orthopaedics', 'Bones, joints and muscles.', 'Block B, 1st floor', 12],
  ['ENT', 'Ear, nose and throat.', 'Block B, Ground floor', 10],
  ['Dermatology', 'Skin, hair and nails.', 'Block D, 1st floor', 10],
  ['Neurology', 'Brain, nerves, headaches and dizziness.', 'Block C, 2nd floor', 15],
  ['Gastroenterology', 'Stomach, intestines and liver.', 'Block D, 2nd floor', 12],
  ['Pulmonology', 'Lungs and breathing.', 'Block C, 1st floor', 12],
  ['Ophthalmology', 'Eyes and vision.', 'Block E, Ground floor', 10],
  ['Urology', 'Kidneys, bladder and urinary problems.', 'Block E, 1st floor', 12],
  ['Gynaecology', 'Women’s health, periods and pregnancy care.', 'Block F, 1st floor', 15],
  ['Paediatrics', 'Children up to 14 years.', 'Block F, Ground floor', 12],
  ['Psychiatry', 'Mental health: anxiety, mood and sleep.', 'Block E, 2nd floor', 20],
  ['Dentistry', 'Teeth and gums.', 'Block D, Ground floor', 15],
];

const SRC = (code) => `Demo instruction sheet ${code} (synthetic)`;

// [dept, name, fastingHours|null, documents, instructions[[item_type, text]]]
const TESTS = [
  ['Pathology Lab', 'Fasting blood sugar', 10, ["Doctor's prescription", 'Photo ID'], [
    ['document', "Bring your doctor's prescription for the test."],
    ['document', 'Bring a photo ID (Aadhaar, PAN or driving licence).'],
    ['fasting', 'Do not eat or drink anything except plain water for 10 hours before your slot.'],
    ['task', 'Take your usual morning medicines only if your doctor has told you to.'],
    ['info', 'The sample takes about 5 minutes. Results are usually ready the same evening.'],
  ]],
  ['Pathology Lab', 'Lipid profile', 12, ["Doctor's prescription"], [
    ['document', "Bring your doctor's prescription for the test."],
    ['fasting', 'Do not eat for 12 hours before your slot. Plain water is allowed.'],
    ['task', 'Avoid alcohol for 24 hours before the test.'],
  ]],
  ['Pathology Lab', 'Complete blood count', null, ["Doctor's prescription"], [
    ['document', "Bring your doctor's prescription for the test."],
    ['info', 'No fasting is needed for this test.'],
  ]],
  ['Radiology', 'Ultrasound abdomen', 6, ["Doctor's prescription", 'Previous scan reports'], [
    ['document', "Bring your doctor's prescription for the scan."],
    ['document', 'Bring any previous scan reports of the abdomen.'],
    ['fasting', 'Do not eat for 6 hours before your slot.'],
    ['task', 'Drink 4 to 5 glasses of water 1 hour before and do not empty your bladder.'],
  ]],
  ['Radiology', 'Chest X-ray', null, ["Doctor's prescription"], [
    ['document', "Bring your doctor's prescription for the X-ray."],
    ['task', 'Wear clothing without metal buttons or zips, and leave jewellery at home.'],
    ['info', 'Tell the staff if you are or might be pregnant.'],
  ]],
  ['Cardiology', 'ECG', null, ["Doctor's prescription"], [
    ['document', "Bring your doctor's prescription."],
    ['task', 'Avoid applying oil or lotion on your chest on the day of the test.'],
  ]],
  ['Cardiology', 'Treadmill test (TMT)', 3, ["Doctor's prescription", 'Previous ECG reports'], [
    ['document', "Bring your doctor's prescription."],
    ['document', 'Bring your previous ECG reports.'],
    ['fasting', 'Have only a light meal, at least 3 hours before your slot.'],
    ['task', 'Wear comfortable shoes and loose clothing.'],
  ]],
];

// [key, synonyms, redFlag, dept|null, urgency]
const RULES = [
  ['chest_pain', ['chest pain', 'chest pressure', 'chest tightness', 'pain in my chest', 'heart attack'], true],
  ['breathing_difficulty', ['difficulty breathing', 'trouble breathing', 'shortness of breath', "can't breathe", 'cannot breathe', 'breathless', 'gasping'], true],
  ['stroke_signs', ['face drooping', 'slurred speech', 'sudden weakness', 'one side weak', 'numb on one side', 'sudden confusion', 'stroke'], true],
  ['severe_bleeding', ['severe bleeding', 'heavy bleeding', "bleeding won't stop", 'bleeding a lot'], true],
  ['unconscious', ['unconscious', 'passed out', 'fainted', 'not responding', 'collapsed'], true],
  ['seizure', ['seizure', 'having a fit', 'convulsion', 'convulsions'], true],
  ['severe_allergic_reaction', ['throat swelling', 'swollen throat', 'swollen tongue', 'anaphylaxis', 'lips swelling'], true],
  ['coughing_blood', ['coughing blood', 'coughing up blood', 'blood in cough', 'vomiting blood'], true],
  ['head_injury', ['head injury', 'hit my head', 'head trauma'], true],
  ['suicidal_thoughts', ['suicidal', 'want to die', 'kill myself', 'end my life', 'self harm'], true],
  ['fever', ['fever', 'high temperature', 'feverish', 'chills'], false, 'General Medicine', 'same_day'],
  ['fatigue', ['tired all the time', 'fatigue', 'weakness', 'low energy'], false, 'General Medicine', 'routine'],
  ['cold', ['cold', 'runny nose', 'sneezing'], false, 'General Medicine', 'routine'],
  ['body_ache', ['body ache', 'body pain', 'muscle ache'], false, 'General Medicine', 'within_week'],
  ['palpitations', ['palpitations', 'heart racing', 'fast heartbeat', 'irregular heartbeat'], false, 'Cardiology', 'same_day'],
  ['high_blood_pressure', ['high blood pressure', 'high bp', 'hypertension'], false, 'Cardiology', 'within_week'],
  ['joint_pain', ['joint pain', 'knee pain', 'shoulder pain', 'swollen joint', 'hip pain'], false, 'Orthopaedics', 'within_week'],
  ['back_pain', ['back pain', 'lower back pain', 'neck pain'], false, 'Orthopaedics', 'within_week'],
  ['sprain', ['sprain', 'twisted ankle', 'twisted my ankle', 'injured my wrist'], false, 'Orthopaedics', 'same_day'],
  ['ear_pain', ['ear pain', 'earache', 'ear discharge', 'hearing loss', 'ringing in ears'], false, 'ENT', 'within_week'],
  ['sore_throat', ['sore throat', 'throat pain', 'difficulty swallowing', 'hoarse voice'], false, 'ENT', 'within_week'],
  ['sinus', ['blocked nose', 'sinus', 'nose bleed', 'nosebleed'], false, 'ENT', 'within_week'],
  ['skin_rash', ['rash', 'itching', 'itchy skin', 'hives', 'skin spots'], false, 'Dermatology', 'within_week'],
  ['acne', ['acne', 'pimples', 'hair fall', 'hair loss', 'dandruff'], false, 'Dermatology', 'routine'],
  ['headache', ['headache', 'migraine', 'head pain'], false, 'Neurology', 'within_week'],
  ['dizziness', ['dizziness', 'dizzy', 'vertigo', 'spinning'], false, 'Neurology', 'same_day'],
  ['numbness', ['numbness', 'tingling', 'pins and needles'], false, 'Neurology', 'within_week'],
  ['abdominal_pain', ['stomach pain', 'abdominal pain', 'tummy pain', 'belly pain', 'stomach ache'], false, 'Gastroenterology', 'same_day'],
  ['vomiting', ['vomiting', 'throwing up', 'nausea'], false, 'Gastroenterology', 'same_day'],
  ['diarrhoea', ['diarrhoea', 'diarrhea', 'loose motions', 'loose stools'], false, 'Gastroenterology', 'same_day'],
  ['acidity', ['acidity', 'heartburn', 'acid reflux', 'indigestion', 'gas'], false, 'Gastroenterology', 'routine'],
  ['cough', ['cough', 'coughing', 'persistent cough', 'phlegm'], false, 'Pulmonology', 'within_week'],
  ['wheezing', ['wheezing', 'wheeze', 'asthma'], false, 'Pulmonology', 'same_day'],
];

// Broader coverage: more red flags, the newer departments, and common reasons for a visit.
// Synthetic and unreviewed: have a clinician check this table before any real use.
const MORE_RULES = [
  ['severe_burn', ['severe burn', 'bad burn', 'burnt badly', 'burn on face', 'large burn'], true],
  ['poisoning', ['poisoning', 'poison', 'overdose', 'swallowed chemical', 'took too many tablets'], true],
  ['pregnancy_bleeding', ['pregnant bleeding', 'bleeding during pregnancy', 'pregnancy bleeding'], true],
  ['infant_fever', ['baby fever', 'infant fever', 'newborn fever', 'baby high temperature'], true],
  ['meningitis_signs', ['stiff neck fever', 'fever stiff neck', 'rash that does not fade'], true],
  ['severe_abdominal_pain', ['severe stomach pain', 'severe abdominal pain', 'unbearable stomach pain'], true],
  ['sudden_vision_loss', ['sudden vision loss', 'suddenly can\'t see', 'lost my vision', 'sudden blindness'], true],
  ['choking', ['choking', 'can\'t swallow anything', 'something stuck in throat'], true],
  ['snake_bite', ['snake bite', 'bitten by a snake', 'scorpion sting'], true],
  ['electric_shock', ['electric shock', 'electrocuted'], true],

  ['eye_pain', ['eye pain', 'red eye', 'itchy eyes', 'watery eyes', 'eye infection', 'conjunctivitis'], false, 'Ophthalmology', 'within_week'],
  ['blurred_vision', ['blurred vision', 'blurry vision', 'can\'t see clearly', 'weak eyesight', 'need glasses'], false, 'Ophthalmology', 'within_week'],
  ['eye_injury', ['eye injury', 'something in my eye', 'hit in the eye'], false, 'Ophthalmology', 'same_day'],
  ['urinary_burning', ['burning urine', 'burning when urinating', 'painful urination', 'pain while peeing', 'urine infection'], false, 'Urology', 'same_day'],
  ['frequent_urination', ['frequent urination', 'urinating often', 'peeing a lot'], false, 'Urology', 'within_week'],
  ['blood_in_urine', ['blood in urine', 'red urine'], false, 'Urology', 'same_day'],
  ['kidney_stone', ['kidney stone', 'flank pain', 'pain in my side radiating'], false, 'Urology', 'same_day'],
  ['period_pain', ['period pain', 'menstrual cramps', 'painful periods'], false, 'Gynaecology', 'routine'],
  ['irregular_periods', ['irregular periods', 'heavy periods', 'missed period'], false, 'Gynaecology', 'within_week'],
  ['pregnancy_care', ['pregnancy checkup', 'pregnant', 'pregnancy test', 'antenatal'], false, 'Gynaecology', 'routine'],
  ['vaginal_discharge', ['vaginal discharge', 'vaginal itching'], false, 'Gynaecology', 'within_week'],
  ['child_fever', ['child fever', 'kid fever', 'son fever', 'daughter fever'], false, 'Paediatrics', 'same_day'],
  ['child_cough', ['child cough', 'kid cough', 'son cough', 'daughter cough'], false, 'Paediatrics', 'within_week'],
  ['child_rash', ['child rash', 'baby rash', 'kid rash'], false, 'Paediatrics', 'within_week'],
  ['vaccination', ['vaccination', 'vaccine', 'immunisation', 'immunization'], false, 'Paediatrics', 'routine'],
  ['anxiety', ['anxiety', 'anxious', 'panic attack', 'worried all the time'], false, 'Psychiatry', 'within_week'],
  ['low_mood', ['depressed', 'depression', 'low mood', 'sad all the time', 'no interest in anything'], false, 'Psychiatry', 'within_week'],
  ['insomnia', ['insomnia', 'can\'t sleep', 'trouble sleeping', 'not sleeping'], false, 'Psychiatry', 'routine'],
  ['stress', ['stress', 'stressed', 'burnout'], false, 'Psychiatry', 'routine'],
  ['toothache', ['toothache', 'tooth pain', 'tooth ache', 'sensitive teeth'], false, 'Dentistry', 'within_week'],
  ['gum_problem', ['bleeding gums', 'swollen gums', 'gum pain'], false, 'Dentistry', 'within_week'],
  ['diabetes_check', ['diabetes', 'high sugar', 'sugar check', 'blood sugar'], false, 'General Medicine', 'routine'],
  ['weight_loss', ['weight loss', 'losing weight'], false, 'General Medicine', 'within_week'],
  ['dehydration', ['dehydration', 'dehydrated', 'very thirsty'], false, 'General Medicine', 'same_day'],
  ['animal_bite', ['dog bite', 'bitten by a dog', 'cat bite', 'monkey bite', 'animal bite'], false, 'General Medicine', 'same_day'],
  ['fracture', ['fracture', 'broken bone', 'broken arm', 'broken leg', 'can\'t move my arm'], false, 'Orthopaedics', 'same_day'],
  ['muscle_cramp', ['muscle cramp', 'leg cramps'], false, 'Orthopaedics', 'routine'],
  ['minor_burn', ['minor burn', 'small burn', 'burn blister'], false, 'Dermatology', 'same_day'],
  ['constipation', ['constipation', 'constipated', 'hard stools'], false, 'Gastroenterology', 'routine'],
  ['jaundice', ['jaundice', 'yellow eyes', 'yellow skin'], false, 'Gastroenterology', 'same_day'],
  ['blood_in_stool', ['blood in stool', 'black stools', 'rectal bleeding'], false, 'Gastroenterology', 'same_day'],
  ['memory_problem', ['memory loss', 'forgetful', 'forgetting things'], false, 'Neurology', 'routine'],
  ['tremor', ['tremor', 'shaking hands', 'trembling'], false, 'Neurology', 'within_week'],
  ['leg_swelling', ['swollen legs', 'swollen feet', 'swelling in feet', 'ankle swelling'], false, 'Cardiology', 'within_week'],
  ['tonsils', ['tonsils', 'tonsillitis', 'swollen tonsils'], false, 'ENT', 'within_week'],
];

// Arjun Rao (a demo account) is prepended to this list at seed time.
const SYNTHETIC_PATIENTS = ['Meera Pillai', 'Kabir Singh', 'Fatima Khan', 'Rohan Das', 'Ananya Bose', 'Vikram Joshi', 'Sara Thomas'];

function at(dayOffset, h, m) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d;
}

export async function seedIfEmpty() {
  const has = await one('SELECT 1 FROM departments LIMIT 1');
  if (has) return false;
  console.log('Seeding synthetic demo data...');
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await db.transaction(async (tx) => {
    const dept = {};
    for (const [name, description, location, mins] of DEPARTMENTS) {
      dept[name] = (await one(
        `INSERT INTO departments (name, description, location, default_service_minutes) VALUES ($1, $2, $3, $4) RETURNING id`,
        [name, description, location, mins], tx
      )).id;
    }

    const user = {};
    for (const a of DEMO_ACCOUNTS) {
      user[a.email] = (await one(
        `INSERT INTO users (role, full_name, email, password_hash, department_id, phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [a.role, a.full_name, a.email, hash, a.dept ? dept[a.dept] : null, a.role === 'patient' ? '+91 90000 00001' : null], tx
      )).id;
    }
    const admin = user['admin@careloop.test'];

    const test = {};
    for (const [d, name, fast, docs, instr] of TESTS) {
      const id = (await one(
        `INSERT INTO tests (department_id, name, requires_fasting, fasting_hours, required_documents)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [dept[d], name, !!fast, fast, docs], tx
      )).id;
      test[name] = { id, fast, dept: d };
      const code = `${deptCode(d)}-${String(Object.keys(test).length).padStart(2, '0')}`;
      for (const [type, text] of instr) {
        await q(
          `INSERT INTO test_instructions (test_id, phase, item_type, text, source_ref, verified_by)
           VALUES ($1, 'before', $2, $3, $4, $5)`,
          [id, type, text, SRC(code), admin], tx
        );
      }
    }

    for (const [key, syn, red, d, urgency] of [...RULES, ...MORE_RULES]) {
      await q(
        `INSERT INTO symptom_rules (symptom_key, synonyms, is_red_flag, department_id, urgency, reviewed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [key, syn, red, red ? null : dept[d], red ? 'emergency' : urgency, 'Pending clinical review'], tx
      );
    }

    // Bookable slots: today through 7 days ahead, 09:00-13:00 and 14:00-17:00 every 30 min.
    for (const name of Object.keys(dept)) {
      for (let day = 0; day <= 7; day++) {
        const times = [];
        for (let m = 9 * 60; m < 17 * 60; m += 30) if (m < 13 * 60 || m >= 14 * 60) times.push(m);
        for (const m of times) {
          await q(
            `INSERT INTO slots (department_id, starts_at, capacity) VALUES ($1, $2, 4) ON CONFLICT DO NOTHING`,
            [dept[name], at(day, Math.floor(m / 60), m % 60).toISOString()], tx
          );
        }
      }
    }

    const patients = [user['arjun@careloop.test']];
    for (const [i, name] of SYNTHETIC_PATIENTS.entries()) {
      patients.push((await one(
        `INSERT INTO users (role, full_name, email, password_hash) VALUES ('patient', $1, $2, $3) RETURNING id`,
        [`${name}`, `synthetic${i + 1}@careloop.test`, hash], tx
      )).id);
    }

    async function slotAt(deptId, when) {
      return (await one(
        `INSERT INTO slots (department_id, starts_at, capacity) VALUES ($1, $2, 4)
         ON CONFLICT (department_id, starts_at) DO UPDATE SET capacity = slots.capacity RETURNING id`,
        [deptId, when.toISOString()], tx
      )).id;
    }

    // Past visits feed the wait estimate and the analytics dashboard. Completed tokens:
    // General Medicine 24 (normal confidence), Pathology Lab 8 (low), Cardiology/Radiology/Orthopaedics
    // some; ENT, Dermatology, Neurology, Gastroenterology and Pulmonology none (hospital default).
    // Values are deterministic so every reset looks the same.
    const jitter = (i, k, lo, hi) => lo + ((i * k) % (hi - lo + 1));
    async function history(deptName, count, [svcLo, svcHi], [waitLo, waitHi], { tests = [], atRiskEvery = 0, noShows = 0, cancels = 0 } = {}) {
      const deptId = dept[deptName];
      const made = [];
      for (let i = 0; i < count; i++) {
        const day = -1 - (i % 13);
        const start = at(day, 9 + (Math.floor(i / 13) % 7), (i * 7) % 60);
        const svc = jitter(i, 37, svcLo, svcHi);
        const wait = jitter(i, 23, waitLo, waitHi);
        const testName = tests.length ? tests[i % tests.length] : null;
        const testId = testName ? test[testName].id : null;
        const readyAtCheckin = testId ? (atRiskEvery && i % atRiskEvery === 0 ? 'at_risk' : 'ready') : 'unknown';
        const slotId = await slotAt(deptId, at(day, start.getHours(), 0));
        const v = await one(
          `INSERT INTO visits (patient_id, department_id, slot_id, test_id, status, readiness, readiness_at_checkin)
           VALUES ($1, $2, $3, $4, 'completed', $5, $5) RETURNING id, slot_id`,
          [patients[i % patients.length], deptId, slotId, testId, readyAtCheckin], tx
        );
        made.push(v);
        await q(
          `INSERT INTO queue_tokens (visit_id, department_id, token_number, service_date, status, checked_in_at, called_at, service_started_at, service_ended_at)
           VALUES ($1, $2, $3, $4, 'done', $5, $6, $6, $7)`,
          [v.id, deptId, `${deptCode(deptName)}-${String(i + 1).padStart(3, '0')}`, localDate(start),
           new Date(start.getTime() - wait * 60e3).toISOString(), start.toISOString(),
           new Date(start.getTime() + svc * 60e3).toISOString()], tx
        );
      }
      for (let j = 0; j < noShows + cancels; j++) {
        const slotId = await slotAt(deptId, at(-1 - ((j * 3) % 13), 11, 30));
        await q(
          `INSERT INTO visits (patient_id, department_id, slot_id, status) VALUES ($1, $2, $3, $4)`,
          [patients[(j + 3) % patients.length], deptId, slotId, j < noShows ? 'no_show' : 'cancelled'], tx
        );
      }
      return made;
    }
    const gmHistory = await history('General Medicine', 24, [6, 14], [8, 42], { noShows: 3, cancels: 2 });
    await history('Pathology Lab', 8, [3, 7], [4, 18], { tests: ['Fasting blood sugar', 'Lipid profile', 'Complete blood count'], atRiskEvery: 3, noShows: 1 });
    await history('Cardiology', 14, [10, 20], [15, 55], { tests: ['ECG', 'Treadmill test (TMT)'], atRiskEvery: 4, noShows: 3, cancels: 1 });
    await history('Radiology', 16, [8, 16], [10, 35], { tests: ['Ultrasound abdomen', 'Chest X-ray'], atRiskEvery: 3, noShows: 2, cancels: 1 });
    await history('Orthopaedics', 10, [8, 15], [20, 48], { noShows: 2 });

    // Past slot-rescue outcomes for the analytics dashboard.
    for (const [i, status] of ['accepted', 'accepted', 'accepted', 'declined', 'declined', 'expired'].entries()) {
      const v = gmHistory[i];
      const created = at(-2 - i, 8, 0);
      await q(
        `INSERT INTO slot_offers (slot_id, offered_to, visit_id, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [v.slot_id, patients[i % patients.length], v.id, status, new Date(created.getTime() + 30 * 60e3).toISOString(), created.toISOString()], tx
      );
    }

    // Today's live queue in General Medicine: one being seen, four waiting.
    const gm = dept['General Medicine'];
    const today = localDate();
    const morning = await slotAt(gm, at(0, 9, 0));
    const live = [['serving', 0], ['waiting', 1], ['waiting', 2], ['waiting', 3], ['waiting', 4]];
    for (const [i, [status, p]] of live.entries()) {
      const v = await one(
        `INSERT INTO visits (patient_id, department_id, slot_id, status) VALUES ($1, $2, $3, $4) RETURNING id`,
        [patients[p], gm, morning, status === 'serving' ? 'in_service' : 'checked_in'], tx
      );
      const checkedIn = new Date(Date.now() - (40 - i * 6) * 60e3);
      await q(
        `INSERT INTO queue_tokens (visit_id, department_id, token_number, service_date, status, checked_in_at, called_at, service_started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [v.id, gm, `GEN-${String(i + 1).padStart(3, '0')}`, today, status, checkedIn.toISOString(),
         status === 'serving' ? new Date(Date.now() - 4 * 60e3).toISOString() : null], tx
      );
    }

    // Demo patient: a General Medicine visit today (ready to check in) and a fasting test tomorrow (at risk).
    const me = user['patient@careloop.test'];
    // An hour from now, but never past today so check-in stays open.
    const soon = new Date(Math.min(Date.now() + 60 * 60e3, at(0, 23, 59).getTime()));
    soon.setSeconds(0, 0);
    const todaySlot = await slotAt(gm, soon);
    await q(
      `INSERT INTO visits (patient_id, department_id, slot_id, reason, readiness) VALUES ($1, $2, $3, $4, 'unknown')`,
      [me, gm, todaySlot, 'Fever and body ache for 3 days'], tx
    );
    await q(`INSERT INTO checklists (visit_id, kind) SELECT id, 'pre_visit' FROM visits WHERE patient_id = $1`, [me], tx);

    const fbs = test['Fasting blood sugar'];
    const labSlot = await slotAt(dept['Pathology Lab'], at(1, 9, 0));
    const lab = await one(
      `INSERT INTO visits (patient_id, department_id, slot_id, test_id, reason, readiness) VALUES ($1, $2, $3, $4, $5, 'at_risk') RETURNING id`,
      [me, dept['Pathology Lab'], labSlot, fbs.id, 'Routine sugar check'], tx
    );
    const cl = await one(`INSERT INTO checklists (visit_id, kind) VALUES ($1, 'pre_visit') RETURNING id`, [lab.id], tx);
    const instr = await q(`SELECT * FROM test_instructions WHERE test_id = $1 ORDER BY created_at`, [fbs.id], tx);
    for (const [n, i] of instr.entries()) {
      await q(
        `INSERT INTO checklist_items (checklist_id, instruction_id, text, item_type, due_at, is_done, done_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cl.id, i.id, i.text, i.item_type,
         new Date(at(1, 9, 0).getTime() - (i.item_type === 'fasting' ? fbs.fast * 3600e3 : 0)).toISOString(),
         n === 1, n === 1 ? me : null], tx
      );
    }
    await scheduleVisitReminders(lab.id, tx);

    // Phase 2: Rahul is Priya's caregiver (may tick recovery tasks).
    await q(
      `INSERT INTO caregiver_links (patient_id, caregiver_id, invite_email, permission, status)
       VALUES ($1, $2, 'caregiver@careloop.test', 'view_and_tick', 'active')`,
      [me, user['caregiver@careloop.test']], tx
    );

    // A completed General Medicine visit 5 days ago with a recovery plan entered by staff.
    const staffId = user['staff@careloop.test'];
    const pastSlot = await slotAt(gm, at(-5, 10, 0));
    const past = await one(
      `INSERT INTO visits (patient_id, department_id, slot_id, status, reason) VALUES ($1, $2, $3, 'completed', $4) RETURNING id`,
      [me, gm, pastSlot, 'High fever for 2 days'], tx
    );
    const followDate = localDate(at(9, 0, 0));
    const fu = await one(
      `INSERT INTO follow_ups (visit_id, entered_by, follow_up_date, notes) VALUES ($1, $2, $3, $4) RETURNING id`,
      [past.id, staffId, followDate,
       'Viral fever (synthetic example). Rest at home and take fluids. Return to the hospital sooner if the fever lasts more than 5 days or you feel worse.'], tx
    );
    const pcl = await one(`INSERT INTO checklists (visit_id, kind) VALUES ($1, 'post_visit') RETURNING id`, [past.id], tx);
    const tasks = [
      ['Rest at home for 3 days', null, true],
      ['Drink at least 2 to 3 litres of fluids a day', null, false],
      ['Note your temperature morning and evening', null, false],
      ['Attend your follow-up visit with General Medicine', at(9, 9, 0).toISOString(), false],
    ];
    for (const [text, due, done] of tasks) {
      await q(
        `INSERT INTO checklist_items (checklist_id, text, item_type, due_at, is_done, done_by) VALUES ($1, $2, 'task', $3, $4, $5)`,
        [pcl.id, text, due, done, done ? me : null], tx
      );
    }
    const meds = [
      ['Paracetamol 500 mg (synthetic)', '1 tablet after food', ['08:00', '14:00', '20:00'], -5, 2],
      ['ORS sachet (synthetic)', '1 sachet mixed in 1 litre of water, sipped through the day', ['10:00'], -5, 4],
    ];
    for (const [name, dose, times, from, to] of meds) {
      const m = await one(
        `INSERT INTO medications (follow_up_id, name, dose_text, times_of_day, start_date, end_date)
         VALUES ($1, $2, $3, $4::time[], $5, $6) RETURNING id`,
        [fu.id, name, dose, times, localDate(at(from, 0, 0)), localDate(at(to, 0, 0))], tx
      );
      await scheduleMedicationReminders(m.id, tx);
    }
    await scheduleFollowUpReminders(past.id, me, followDate, 'General Medicine', tx);

    // Phase 4 slot rescue demo. Arjun holds the only place in a Dermatology slot in 2 days.
    // Priya and Meera have opted in and are booked later; when Arjun cancels, both get an offer.
    const derm = dept['Dermatology'];
    await q(`UPDATE users SET slot_rescue_opt_in = true WHERE id = ANY($1::uuid[])`, [[me, patients[1]]], tx);
    const earlySlot = await slotAt(derm, at(2, 10, 0));
    await q(`UPDATE slots SET capacity = 1 WHERE id = $1`, [earlySlot], tx);
    const rescueVisits = [
      [patients[0], earlySlot, 'Skin allergy review'],
      [me, await slotAt(derm, at(4, 15, 0)), 'Itchy rash on both arms'],
      [patients[1], await slotAt(derm, at(5, 11, 0)), 'Acne follow-up'],
    ];
    for (const [pid, slotId, reason] of rescueVisits) {
      const rv = await one(
        `INSERT INTO visits (patient_id, department_id, slot_id, reason) VALUES ($1, $2, $3, $4) RETURNING id`,
        [pid, derm, slotId, reason], tx
      );
      await q(`INSERT INTO checklists (visit_id, kind) VALUES ($1, 'pre_visit')`, [rv.id], tx);
      await scheduleVisitReminders(rv.id, tx);
    }

    await q(
      `UPDATE slots s SET booked_count = (SELECT count(*) FROM visits v WHERE v.slot_id = s.id AND v.status <> 'cancelled')`,
      [], tx
    );
  });
  console.log('Seed complete.');
  return true;
}
