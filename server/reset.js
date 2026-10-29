// Deletes the local database; the next `npm start` re-seeds fresh synthetic data.
// Stop the server first: an open database (or a cloud-sync client holding files) blocks deletion.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

try {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch (e) {
  console.error(`Could not delete ${dir}: ${e.message}`);
}
if (fs.existsSync(dir)) {
  console.error('The database folder is still there. Stop the server (and pause OneDrive sync if needed), then try again.');
  process.exit(1);
}
console.log('Database removed. Run `npm start` to re-seed.');
