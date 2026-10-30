import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_DIR } from './paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(BASE_DIR, 'pgdata');
console.log(`Database folder: ${DATA_DIR}`);

fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
// A real PostgreSQL data folder always has PG_VERSION. If the folder exists without it (an
// interrupted first start, or files removed by a sync tool), start it fresh instead of crashing.
if (fs.existsSync(DATA_DIR) && !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
  console.warn(`Database folder ${DATA_DIR} is incomplete; creating a fresh database.`);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}
export const db = new PGlite(DATA_DIR);

export async function q(sql, params = [], conn = db) {
  return (await conn.query(sql, params)).rows;
}

export async function one(sql, params = [], conn = db) {
  return (await q(sql, params, conn))[0] ?? null;
}

export async function initSchema() {
  await db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
}

// Local-day helpers: the queue resets at local midnight.
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayRange(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

export function deptCode(name) {
  return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}
