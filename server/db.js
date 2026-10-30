// Database connection. Two backends behind one small interface (query / exec / transaction / close):
//   - DATABASE_URL set: a hosted PostgreSQL server such as Neon (data survives redeploys and restarts).
//   - otherwise: PGlite, PostgreSQL running inside this process, stored in a local folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const USING_SERVER_DB = !!process.env.DATABASE_URL;

async function openPostgres(url) {
  const { default: pg } = await import('pg');
  // Return DATE columns as 'YYYY-MM-DD' text, so no time zone shifts a birthday or follow-up date.
  pg.types.setTypeParser(1082, (v) => v);
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 5, idleTimeoutMillis: 30_000 });
  pool.on('error', (e) => console.error('Database connection error:', e.message));
  const wrap = (r) => ({ rows: r.rows, affectedRows: r.rowCount });
  console.log(`Database: PostgreSQL server (${new URL(url).hostname})`);
  return {
    query: async (sql, params = []) => wrap(await pool.query(sql, params)),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: async (sql, params = []) => wrap(await client.query(sql, params)) });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { BASE_DIR } = await import('./paths.js');
  const dir = path.join(BASE_DIR, 'pgdata');
  fs.mkdirSync(BASE_DIR, { recursive: true });
  // A real PostgreSQL data folder always has PG_VERSION. If the folder exists without it (an
  // interrupted first start, or files removed by a sync tool), start it fresh instead of crashing.
  if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, 'PG_VERSION'))) {
    console.warn(`Database folder ${dir} is incomplete; creating a fresh database.`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`Database folder: ${dir}`);
  return new PGlite(dir);
}

export const db = USING_SERVER_DB ? await openPostgres(process.env.DATABASE_URL) : await openPglite();

export async function q(sql, params = [], conn = db) {
  return (await conn.query(sql, params)).rows;
}

export async function one(sql, params = [], conn = db) {
  return (await q(sql, params, conn))[0] ?? null;
}

export async function initSchema() {
  await db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
}

// Local-day helpers: the queue resets at local midnight (set TZ on the host, e.g. Asia/Kolkata).
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
