import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { config } from './config.js';
export const prisma = new PrismaClient();
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: [
    'password',
    'passwordHash',
    'token',
    'accessToken',
    'refreshToken',
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
  ],
});
