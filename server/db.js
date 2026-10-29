import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets a host point the database at persistent storage (e.g. a mounted disk).
const BASE_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(here, '..', 'data');
export const DATA_DIR = path.join(BASE_DIR, 'pgdata');

fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
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
