// Phone number field with a separate country-code picker. The default country comes from the
// visitor's device (time zone, then language), so no location service is contacted.
import { esc } from './lib.js';

// [ISO code, country, dialling code]
export const COUNTRIES = [
  ['IN', 'India', '91'], ['AE', 'United Arab Emirates', '971'], ['AU', 'Australia', '61'], ['BD', 'Bangladesh', '880'],
  ['BH', 'Bahrain', '973'], ['BT', 'Bhutan', '975'], ['CA', 'Canada', '1'], ['CN', 'China', '86'], ['DE', 'Germany', '49'],
  ['EG', 'Egypt', '20'], ['ES', 'Spain', '34'], ['FR', 'France', '33'], ['GB', 'United Kingdom', '44'], ['HK', 'Hong Kong', '852'],
  ['ID', 'Indonesia', '62'], ['IE', 'Ireland', '353'], ['IT', 'Italy', '39'], ['JP', 'Japan', '81'], ['KE', 'Kenya', '254'],
  ['KR', 'South Korea', '82'], ['KW', 'Kuwait', '965'], ['LK', 'Sri Lanka', '94'], ['MV', 'Maldives', '960'], ['MY', 'Malaysia', '60'],
  ['NG', 'Nigeria', '234'], ['NL', 'Netherlands', '31'], ['NP', 'Nepal', '977'], ['NZ', 'New Zealand', '64'], ['OM', 'Oman', '968'],
  ['PH', 'Philippines', '63'], ['PK', 'Pakistan', '92'], ['QA', 'Qatar', '974'], ['RU', 'Russia', '7'], ['SA', 'Saudi Arabia', '966'],
  ['SE', 'Sweden', '46'], ['SG', 'Singapore', '65'], ['TH', 'Thailand', '66'], ['TR', 'Türkiye', '90'], ['US', 'United States', '1'],
  ['VN', 'Vietnam', '84'], ['ZA', 'South Africa', '27'],
];
const byIso = Object.fromEntries(COUNTRIES.map((c) => [c[0], c]));

// Flag emoji from the two-letter code (regional indicator letters).
const flag = (iso) => String.fromCodePoint(...[...iso].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));

const ZONES = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Dhaka': 'BD', 'Asia/Bahrain': 'BH', 'Asia/Thimphu': 'BT',
  'Asia/Shanghai': 'CN', 'Europe/Berlin': 'DE', 'Africa/Cairo': 'EG', 'Europe/Madrid': 'ES', 'Europe/Paris': 'FR', 'Europe/London': 'GB',
  'Asia/Hong_Kong': 'HK', 'Asia/Jakarta': 'ID', 'Europe/Dublin': 'IE', 'Europe/Rome': 'IT', 'Asia/Tokyo': 'JP', 'Africa/Nairobi': 'KE',
  'Asia/Seoul': 'KR', 'Asia/Kuwait': 'KW', 'Asia/Colombo': 'LK', 'Indian/Maldives': 'MV', 'Asia/Kuala_Lumpur': 'MY', 'Africa/Lagos': 'NG',
  'Europe/Amsterdam': 'NL', 'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP', 'Pacific/Auckland': 'NZ', 'Asia/Muscat': 'OM', 'Asia/Manila': 'PH',
  'Asia/Karachi': 'PK', 'Asia/Qatar': 'QA', 'Europe/Moscow': 'RU', 'Asia/Riyadh': 'SA', 'Europe/Stockholm': 'SE', 'Asia/Singapore': 'SG',
  'Asia/Bangkok': 'TH', 'Europe/Istanbul': 'TR', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Africa/Johannesburg': 'ZA',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA',
};

export function guessCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (ZONES[tz]) return ZONES[tz];
    if (tz.startsWith('Australia/')) return 'AU';
    if (tz.startsWith('America/')) return 'US';
  } catch {}
  for (const lang of navigator.languages || [navigator.language || '']) {
    const region = String(lang).split('-')[1]?.toUpperCase();
    if (region && byIso[region]) return region;
  }
  return 'IN';
}

// Split a stored "+91 98765 43210" into country and local number (longest matching code wins).
export function parsePhone(stored) {
  const digits = String(stored || '').replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) return { iso: guessCountry(), local: String(stored || '').trim() };
  const rest = digits.slice(1);
  const guess = guessCountry();
  const matches = COUNTRIES.filter((c) => rest.startsWith(c[2])).sort((a, b) => b[2].length - a[2].length);
  if (!matches.length) return { iso: guess, local: rest };
  const longest = matches.filter((c) => c[2] === matches[0][2]);
  const pick = longest.find((c) => c[0] === guess) || longest[0]; // +1 is shared by US and Canada
  return { iso: pick[0], local: rest.slice(pick[2].length) };
}

// Markup: a country picker and a number box side by side, under one label.
export function phoneField({ id = 'phone', value = '', optional = true, label = 'Phone' } = {}) {
  const { iso, local } = parsePhone(value);
  return `
    <div>
      <label class="label" for="${id}-local">${esc(label)}${optional ? ' <span class="font-normal text-slate-400">(optional)</span>' : ''}</label>
      <div class="flex flex-wrap gap-2">
        <select class="input !w-[6.75rem] shrink-0 pl-2.5 pr-6" id="${id}-cc" name="phone_cc" aria-label="Country code" autocomplete="tel-country-code">
          ${COUNTRIES.map(([code, name, dial]) => `<option value="${code}" ${code === iso ? 'selected' : ''} title="${esc(name)}">${flag(code)} +${dial}</option>`).join('')}
        </select>
        <input class="input min-w-[9rem] flex-1" id="${id}-local" name="phone_local" type="tel" inputmode="tel" autocomplete="tel-national"
               value="${esc(local)}" placeholder="98765 43210" maxlength="18" pattern="[0-9 \\-]{6,18}" title="Digits only, without the country code" />
      </div>
    </div>`;
}

// Combine the two parts into "+<code> <number>", or '' if the number box is empty.
export function readPhone(data) {
  const local = String(data.phone_local || '').replace(/[\s-]/g, '').replace(/^0+/, '');
  delete data.phone_local;
  const country = byIso[data.phone_cc] || byIso.IN;
  delete data.phone_cc;
  return local ? `+${country[2]} ${local}` : '';
}
