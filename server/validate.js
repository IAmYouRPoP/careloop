// Input checks shared by the routes. Each returns a cleaned value or throws a 400 HttpError via `fail`.
import { localDate } from './db.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function makeValidators(fail) {
  // Trimmed text with a length limit. `required: false` turns '' into null.
  function text(value, label, { max = 200, required = true } = {}) {
    const s = value == null ? '' : String(value).trim();
    if (!s) {
      if (required) fail(400, `${label} is required.`);
      return null;
    }
    if (s.length > max) fail(400, `${label} must be ${max} characters or fewer.`);
    return s;
  }

  function email(value) {
    const s = text(value, 'Email', { max: 254 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail(400, 'Enter a valid email address.');
    return s;
  }

  function password(value) {
    const s = value == null ? '' : String(value);
    if (s.length < 8) fail(400, 'Password must be at least 8 characters.');
    if (s.length > 72) fail(400, 'Password must be 72 characters or fewer.');
    return s;
  }

  // A real calendar date (rejects 2026-02-30) as YYYY-MM-DD.
  function date(value, label) {
    const s = String(value || '');
    const d = new Date(`${s}T00:00:00`);
    if (!YMD.test(s) || Number.isNaN(d.getTime()) || localDate(d) !== s) fail(400, `${label} is not a valid date.`);
    return s;
  }

  // Not in the future and not more than 120 years ago.
  function dateOfBirth(value) {
    if (value == null || value === '') return null;
    const s = date(value, 'Date of birth');
    const today = localDate();
    if (s > today) fail(400, 'Date of birth can’t be in the future.');
    const oldest = new Date();
    oldest.setFullYear(oldest.getFullYear() - 120);
    if (s < localDate(oldest)) fail(400, 'Please check the date of birth.');
    return s;
  }

  function time(value, label) {
    const s = String(value || '');
    if (!HM.test(s)) fail(400, `${label} must be a time like 09:00.`);
    return s;
  }

  function int(value, label, { min, max, fallback } = {}) {
    if ((value == null || value === '') && fallback !== undefined) return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) fail(400, `${label} must be a whole number from ${min} to ${max}.`);
    return n;
  }

  function oneOf(value, label, options) {
    if (!options.includes(value)) fail(400, `${label} must be one of: ${options.join(', ')}.`);
    return value;
  }

  return { text, email, password, date, dateOfBirth, time, int, oneOf };
}
