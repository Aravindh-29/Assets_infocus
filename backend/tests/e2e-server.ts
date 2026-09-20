import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.test'), override: true });
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('Browser tests require a separate _test database.');
process.env.NODE_ENV = 'test';
process.env.PORT = '5001';
process.env.CORS_ORIGIN = 'http://127.0.0.1:5174,http://localhost:5174';
process.env.LOG_LEVEL = 'warn';
await import('../src/server.js');
