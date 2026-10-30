// Where the database lives. DATA_DIR wins (hosts point it at persistent storage). Otherwise it's
// the project's data/ folder, except inside a OneDrive-synced folder: OneDrive locks and moves
// database files while they're in use, so the database goes to the local app-data folder instead.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveBaseDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (/[\\/]onedrive[^\\/]*[\\/]/i.test(projectRoot + path.sep)) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'CareLoop', 'data');
  }
  return path.join(projectRoot, 'data');
}

export const BASE_DIR = resolveBaseDir();
