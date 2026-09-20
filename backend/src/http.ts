import type { Request, Response, NextFunction } from 'express';
import { Prisma, type User } from '@prisma/client';
import { ZodError } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma, logger } from './db.js';
import { config } from './config.js';

export const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  mustChangePassword: true,
  employeeId: true,
  createdAt: true,
  updatedAt: true,
} as const;
export type Actor = Pick<
  User,
  'id' | 'name' | 'email' | 'role' | 'active' | 'employeeId' | 'mustChangePassword'
> & { requestIp?: string };
declare global {
  namespace Express {
    interface Request {
      actor: Actor;
    }
  }
}
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
    public details?: unknown,
  ) {
    super(message);
  }
}
export const ok = (res: Response, data: unknown = null, message?: string, status = 200) =>
  res.status(status).json({ success: true, data, ...(message ? { message } : {}) });
export function paging(req: Request) {
  const page = Math.max(1, Math.min(100000, Number(req.query.page) || 1));
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize) || 20));
  return {
    page: Math.floor(page),
    pageSize: Math.floor(pageSize),
    skip: (Math.floor(page) - 1) * Math.floor(pageSize),
    take: Math.floor(pageSize),
  };
}
export function listed(res: Response, data: unknown[], total: number, p: ReturnType<typeof paging>) {
  return res.json({
    success: true,
    data,
    meta: { page: p.page, pageSize: p.pageSize, total, totalPages: Math.ceil(total / p.pageSize) },
  });
}
export const queryString = (value: unknown) => (typeof value === 'string' ? value : undefined);
export const param = (req: Request, name = 'id') => String(req.params[name]);
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new AppError(401, 'Please sign in.', 'UNAUTHENTICATED');
    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'asset-management',
        audience: 'asset-management-app',
      }) as jwt.JwtPayload;
    } catch {
      throw new AppError(401, 'Your session has expired. Please sign in again.', 'INVALID_TOKEN');
    }
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: userSelect });
    if (!user?.active) throw new AppError(401, 'Your account is unavailable.', 'ACCOUNT_DISABLED');
    if (claims.version !== user.updatedAt.getTime())
      throw new AppError(401, 'Your account was updated. Refresh your session.', 'INVALID_TOKEN');
    req.actor = { ...user, requestIp: req.ip };
    if (
      user.mustChangePassword &&
      !['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'].includes(
        req.originalUrl.split('?')[0],
      )
    )
      throw new AppError(403, 'Change your password to continue.', 'PASSWORD_CHANGE_REQUIRED');
    next();
  } catch (error) {
    next(error);
  }
}
export const roles =
  (...allowed: string[]) =>
  (req: Request, _res: Response, next: NextFunction) =>
    allowed.includes(req.actor.role)
      ? next()
      : next(new AppError(403, 'You do not have permission to perform this action.', 'FORBIDDEN'));
export const managers = roles('ADMIN', 'ASSET_MANAGER');
export const admin = roles('ADMIN');
export const employeeScope = (actor: Actor) =>
  actor.role === 'EMPLOYEE' ? (actor.employeeId ?? '00000000-0000-0000-0000-000000000000') : undefined;
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError)
    return res
      .status(422)
      .json({
        success: false,
        message: 'Please check the supplied values.',
        errorCode: 'VALIDATION_ERROR',
        details: error.flatten(),
      });
  if (error instanceof AppError)
    return res
      .status(error.status)
      .json({
        success: false,
        message: error.message,
        errorCode: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      return res
        .status(409)
        .json({
          success: false,
          message: 'A record with this unique value already exists.',
          errorCode: 'DUPLICATE_RECORD',
        });
    if (error.code === 'P2025')
      return res.status(404).json({ success: false, message: 'Record not found.', errorCode: 'NOT_FOUND' });
    if (error.code === 'P2003')
      return res
        .status(422)
        .json({
          success: false,
          message: 'A referenced record does not exist.',
          errorCode: 'INVALID_REFERENCE',
        });
    if (error.code === 'P2034')
      return res
        .status(409)
        .json({
          success: false,
          message: 'This record changed concurrently. Refresh and try again.',
          errorCode: 'CONCURRENT_CHANGE',
        });
    if (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
      return res
        .status(409)
        .json({
          success: false,
          message: 'This record changed concurrently. Refresh and try again.',
          errorCode: 'CONCURRENT_CHANGE',
        });
  }
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 400)
    return res
      .status(400)
      .json({ success: false, message: 'Invalid JSON request.', errorCode: 'INVALID_JSON' });
  logger.error({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Request failed');
  return res
    .status(500)
    .json({
      success: false,
      message: 'An unexpected error occurred. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
}
