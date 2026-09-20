import { Router, type Response } from 'express';
import { randomBytes, createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { prisma } from '../db.js';
import { config, durationMilliseconds } from '../config.js';
import { AppError, authenticate, ok, userSelect } from '../http.js';
import { password } from '../validators.js';
import { transaction } from '../services/lifecycle.js';
import { audit, type Tx } from '../services/audit.js';

export const authRouter = Router();
const secure = ['production', 'staging'].includes(config.NODE_ENV);
const cookieName = 'asset_refresh';
const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/api/auth' };
const hashToken = (token: string) =>
  createHmac('sha256', config.JWT_REFRESH_SECRET).update(token).digest('hex');
const limitOptions = {
  windowMs: 15 * 60 * 1000,
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts. Try again in 15 minutes.',
    errorCode: 'RATE_LIMITED',
  },
};
const loginLimit = rateLimit({
  ...limitOptions,
  limit: config.NODE_ENV === 'test' ? 10000 : 30,
  skipSuccessfulRequests: true,
});
const refreshLimit = rateLimit({ ...limitOptions, limit: config.NODE_ENV === 'test' ? 10000 : 300 });
const resetLimit = rateLimit({ ...limitOptions, limit: config.NODE_ENV === 'test' ? 10000 : 15 });
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);
async function createSession(tx: Tx, userId: string, remember = false, expectedVersion?: number) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { ...userSelect, employee: { include: { department: true, location: true } } },
  });
  if (!user.active || (expectedVersion !== undefined && user.updatedAt.getTime() !== expectedVersion))
    throw new AppError(401, 'Your account changed. Please sign in again.', 'INVALID_CREDENTIALS');
  const token = `${remember ? 'r' : 's'}.${randomBytes(48).toString('base64url')}`;
  const duration = durationMilliseconds(
    remember ? config.REMEMBER_TOKEN_EXPIRES_IN : config.REFRESH_TOKEN_EXPIRES_IN,
  );
  await tx.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + duration) },
  });
  const accessToken = jwt.sign({ role: user.role, version: user.updatedAt.getTime() }, config.JWT_SECRET, {
    subject: user.id,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
    issuer: 'asset-management',
    audience: 'asset-management-app',
  });
  return { user, accessToken, token, duration, remember };
}
function respondSession(res: Response, session: Awaited<ReturnType<typeof createSession>>, message?: string) {
  res.cookie(cookieName, session.token, {
    ...cookieOptions,
    ...(session.remember ? { maxAge: session.duration } : {}),
  });
  return ok(res, { user: session.user, accessToken: session.accessToken }, message);
}
authRouter.post('/login', loginLimit, async (req, res) => {
  const data = z
    .object({
      identifier: z.string().trim().min(1).max(250),
      password: z.string().min(1).max(128),
      remember: z.boolean().optional(),
    })
    .strict()
    .parse(req.body);
  // Explicit usernames take precedence if a later employee ID matches one.
  const user =
    (await prisma.user.findUnique({ where: { username: data.identifier.toLowerCase() } })) ??
    (await prisma.user.findFirst({
      where: {
        OR: [{ email: data.identifier.toLowerCase() }, { employee: { employeeId: data.identifier } }],
      },
    }));
  const valid = await bcrypt.compare(data.password, user?.passwordHash ?? dummyHash);
  if (!user?.active || !valid)
    throw new AppError(401, 'Incorrect username, email, employee ID, or password.', 'INVALID_CREDENTIALS');
  const session = await transaction(async (tx) => {
    const session = await createSession(tx, user.id, data.remember, user.updatedAt.getTime());
    await audit(tx, { ...user, requestIp: req.ip }, 'LOGIN', 'User', user.id);
    return session;
  });
  respondSession(res, session);
});
authRouter.post('/refresh', refreshLimit, async (req, res) => {
  const token = req.cookies?.[cookieName];
  if (typeof token !== 'string') throw new AppError(401, 'Please sign in again.', 'INVALID_REFRESH_TOKEN');
  const digest = hashToken(token);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: digest },
    include: { user: { select: userSelect } },
  });
  if (!existing || existing.expiresAt < new Date() || !existing.user.active)
    throw new AppError(401, 'Your session has expired.', 'INVALID_REFRESH_TOKEN');
  const result = await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${existing.userId}::uuid FOR UPDATE`;
    const current = await tx.refreshToken.findUniqueOrThrow({ where: { id: existing.id } });
    if (current.revokedAt) {
      await tx.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }
    if (current.expiresAt < new Date())
      throw new AppError(401, 'Your session has expired.', 'INVALID_REFRESH_TOKEN');
    await tx.refreshToken.update({ where: { id: current.id }, data: { revokedAt: new Date() } });
    return createSession(tx, existing.userId, token.startsWith('r.'), existing.user.updatedAt.getTime());
  });
  if (!result) {
    res.clearCookie(cookieName, cookieOptions);
    throw new AppError(401, 'Please sign in again.', 'REFRESH_TOKEN_REUSED');
  }
  respondSession(res, result);
});
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[cookieName];
  if (typeof token === 'string') {
    const refresh = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: userSelect } },
    });
    if (refresh && !refresh.revokedAt)
      await transaction(async (tx) => {
        await tx.refreshToken.updateMany({
          where: { id: refresh.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit(tx, refresh.user, 'LOGOUT', 'User', refresh.userId);
      });
  }
  res.clearCookie(cookieName, cookieOptions);
  ok(res, null, 'Signed out.');
});
authRouter.get('/me', authenticate, async (req, res) =>
  ok(
    res,
    await prisma.user.findUniqueOrThrow({
      where: { id: req.actor.id },
      select: { ...userSelect, employee: { include: { department: true, location: true } } },
    }),
  ),
);
authRouter.post('/forgot-password', resetLimit, async (req, res) => {
  const { email } = z.object({ email: z.string().trim().email().toLowerCase() }).strict().parse(req.body);
  if (secure && !config.SMTP_HOST)
    throw new AppError(
      503,
      'Password reset email is temporarily unavailable. Contact your administrator.',
      'EMAIL_UNAVAILABLE',
    );
  const user = await prisma.user.findUnique({ where: { email } });
  let resetUrl: string | undefined;
  if (user?.active) {
    const token = randomBytes(32).toString('base64url');
    await transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      await tx.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await tx.passwordReset.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60000) },
      });
    });
    resetUrl = `${(config.APP_URL ?? config.CORS_ORIGIN.split(',')[0]).replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    if (config.SMTP_HOST) {
      const mail = nodemailer.createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        secure: config.SMTP_PORT === 465,
        ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
      });
      await mail.sendMail({
        from: config.SMTP_FROM,
        to: user.email,
        subject: 'Reset your Asset Management password',
        text: `Use this link within 30 minutes to reset your password: ${resetUrl}\nIf you did not request this, you can ignore this email.`,
      });
    }
  }
  ok(
    res,
    config.NODE_ENV === 'development' || config.NODE_ENV === 'test' ? { resetUrl } : null,
    'If an active account matches, a reset link has been sent.',
  );
});
authRouter.post('/reset-password', resetLimit, async (req, res) => {
  const data = z
    .object({ token: z.string().min(20).max(200), password })
    .strict()
    .parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  await transaction(async (tx) => {
    const reset = await tx.passwordReset.findUnique({
      where: { tokenHash: hashToken(data.token) },
      include: { user: { select: userSelect } },
    });
    if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.active)
      throw new AppError(400, 'This reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${reset.userId}::uuid FOR UPDATE`;
    const current = await tx.passwordReset.findUniqueOrThrow({ where: { id: reset.id } });
    if (current.usedAt)
      throw new AppError(400, 'This reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');
    await tx.passwordReset.updateMany({
      where: { userId: reset.userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash, mustChangePassword: false } });
    await tx.refreshToken.updateMany({
      where: { userId: reset.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit(tx, reset.user, 'PASSWORD_RESET', 'User', reset.userId);
  });
  res.clearCookie(cookieName, cookieOptions);
  ok(res, null, 'Your password was reset. Sign in with your new password.');
});
authRouter.post('/change-password', authenticate, async (req, res) => {
  const data = z
    .object({ currentPassword: z.string().min(1).max(128), newPassword: password })
    .strict()
    .parse(req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.actor.id } });
  if (!(await bcrypt.compare(data.currentPassword, user.passwordHash)))
    throw new AppError(422, 'Current password is incorrect.', 'INVALID_PASSWORD');
  const passwordHash = await bcrypt.hash(data.newPassword, 12);
  const session = await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { updatedAt: true } });
    if (current.updatedAt.getTime() !== user.updatedAt.getTime())
      throw new AppError(409, 'Your account changed. Please try again.', 'CONCURRENT_CHANGE');
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await audit(tx, req.actor, 'PASSWORD_CHANGED', 'User', user.id);
    return createSession(tx, user.id);
  });
  respondSession(res, session, 'Password changed.');
});
