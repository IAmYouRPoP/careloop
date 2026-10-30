// Deletes the local database; the next `npm start` re-seeds fresh data.
// Stop the server first: an open database (or a cloud-sync client holding files) blocks deletion.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { BASE_DIR as dir } from './paths.js';

try {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch (e) {
  console.error(`Could not delete ${dir}: ${e.message}`);
}
// Folders synced by OneDrive sometimes resist Node's delete; Windows' own command copes.
if (fs.existsSync(dir) && process.platform === 'win32') {
  spawnSync('cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' });
}
if (fs.existsSync(dir)) {
  console.error(`The database folder ${dir} is still there. Stop the server, then try again.`);
  process.exit(1);
}
console.log(`Database removed (${dir}). Run \`npm start\` to re-seed.`);
