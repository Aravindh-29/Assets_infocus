import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(root, 'backend/.env.test'), override: true });
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) {
  throw new Error('Set a separate DATABASE_URL ending in _test in backend/.env.test.');
}
process.env.NODE_ENV = 'test';
execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
  cwd: path.join(root, 'backend'),
  stdio: 'inherit',
  env: process.env,
});
execFileSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'], {
  cwd: path.join(root, 'backend'),
  stdio: 'inherit',
  env: process.env,
});
