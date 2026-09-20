import { Router } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { admin, AppError, listed, ok, paging, param, queryString, userSelect } from '../http.js';
import { name, optionalId, password, uuid } from '../validators.js';
import { audit } from '../services/audit.js';
import { transaction } from '../services/lifecycle.js';

export const adminRouter = Router();
adminRouter.get('/users', admin, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.UserWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { ...userSelect, employee: { select: { id: true, name: true, employeeId: true } } },
      orderBy: { name: 'asc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.user.count({ where }),
  ]);
  listed(res, rows, total, p);
});
const userSchema = z
  .object({
    name,
    email: z.string().trim().email().toLowerCase(),
    password,
    role: z.enum(['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE']),
    active: z.boolean().default(true),
    employeeId: optionalId,
    mustChangePassword: z.boolean().optional(),
  })
  .strict();
adminRouter.post('/users', admin, async (req, res) => {
  const data = userSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  const row = await transaction(async (tx) => {
    if (data.role === 'EMPLOYEE' && !data.employeeId)
      throw new AppError(422, 'Employee accounts must be linked to an employee.', 'EMPLOYEE_REQUIRED');
    if (
      data.employeeId &&
      !(await tx.employee.findFirst({
        where: { id: data.employeeId, deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
      }))
    )
      throw new AppError(422, 'Select an active employee.', 'EMPLOYEE_UNAVAILABLE');
    const { password: _password, ...safe } = data;
    const user = await tx.user.create({
      data: {
        ...safe,
        passwordHash,
        mustChangePassword: config.NODE_ENV === 'production' || (data.mustChangePassword ?? true),
      },
      select: userSelect,
    });
    await audit(tx, req.actor, 'USER_CREATED', 'User', user.id, { role: user.role });
    return user;
  });
  ok(res, row, 'User created.', 201);
});
adminRouter.put('/users/:id', admin, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = userSchema.partial().parse(req.body);
  const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
  const row = await transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { id } });
    if (id === req.actor.id && (data.active === false || (data.role && data.role !== 'ADMIN')))
      throw new AppError(409, 'You cannot disable or demote your own account.', 'SELF_DISABLE');
    if (
      current.role === 'ADMIN' &&
      current.active &&
      (data.active === false || (data.role && data.role !== 'ADMIN')) &&
      (await tx.user.count({ where: { role: 'ADMIN', active: true } })) <= 1
    )
      throw new AppError(409, 'At least one active administrator is required.', 'LAST_ADMIN');
    if (
      (data.role ?? current.role) === 'EMPLOYEE' &&
      !(data.employeeId === undefined ? current.employeeId : data.employeeId)
    )
      throw new AppError(422, 'Employee accounts must be linked to an employee.', 'EMPLOYEE_REQUIRED');
    if (
      data.employeeId &&
      !(await tx.employee.findFirst({
        where: { id: data.employeeId, deletedAt: null, status: { in: ['ACTIVE', 'ON_LEAVE'] } },
      }))
    )
      throw new AppError(422, 'Select an active employee.', 'EMPLOYEE_UNAVAILABLE');
    const { password: _password, ...safe } = data;
    const user = await tx.user.update({
      where: { id },
      data: { ...safe, ...(passwordHash ? { passwordHash, mustChangePassword: true } : {}) },
      select: userSelect,
    });
    if (passwordHash || data.active === false || data.role) {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordReset.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      });
    }
    await audit(tx, req.actor, 'USER_UPDATED', 'User', id, {
      changedFields: Object.keys(data).filter((k) => k !== 'password'),
    });
    return user;
  });
  ok(res, row, 'User updated.');
});
adminRouter.post('/users/:id/reset-password', admin, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = z.object({ password }).strict().parse(req.body);
  const passwordHash = await bcrypt.hash(data.password, 12);
  await transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.passwordReset.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
    await audit(tx, req.actor, 'ADMIN_PASSWORD_RESET', 'User', id);
  });
  ok(res, null, 'Password reset. The user must change it at next sign-in.');
});
adminRouter.get('/settings', admin, async (_req, res) => {
  const rows = await prisma.setting.findMany({ where: { key: { not: { startsWith: 'internal' } } } });
  ok(res, {
    organizationName: 'Asset Management',
    warrantyAlertDays: 30,
    currency: 'MYR',
    ...Object.fromEntries(rows.map((r) => [r.key, r.value])),
  });
});
adminRouter.put('/settings', admin, async (req, res) => {
  const data = z
    .object({
      organizationName: name.optional(),
      warrantyAlertDays: z.coerce.number().int().min(1).max(365).optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      supportEmail: z.string().email().optional(),
      timezone: z.string().min(1).max(100).optional(),
      dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    })
    .strict()
    .parse(req.body);
  await transaction(async (tx) => {
    for (const [key, value] of Object.entries(data))
      if (value !== undefined)
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await audit(tx, req.actor, 'SETTINGS_UPDATED', 'Setting', undefined, {
      changedFields: Object.keys(data),
    });
  });
  ok(res, data, 'Settings saved.');
});
adminRouter.get('/audit-logs', admin, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AuditLogWhereInput = {
    ...(search
      ? {
          OR: ['action', 'entityType', 'userName'].map((key) => ({
            [key]: { contains: search, mode: 'insensitive' },
          })),
        }
      : {}),
    ...(queryString(req.query.entityId) ? { entityId: String(req.query.entityId) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip: p.skip, take: p.take }),
    prisma.auditLog.count({ where }),
  ]);
  listed(res, rows, total, p);
});
adminRouter.get('/notifications', async (req, res) => {
  const p = paging(req);
  const where = { userId: req.actor.id, ...(req.query.unread === 'true' ? { readAt: null } : {}) };
  const [rows, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.actor.id, readAt: null } }),
  ]);
  res.json({
    success: true,
    data: rows,
    meta: {
      page: p.page,
      pageSize: p.pageSize,
      total,
      totalPages: Math.ceil(total / p.pageSize),
      unreadCount,
    },
  });
});
adminRouter.patch('/notifications/:id/read', async (req, res) => {
  const count = await prisma.notification.updateMany({
    where: { id: uuid.parse(param(req)), userId: req.actor.id },
    data: { readAt: new Date() },
  });
  if (!count.count) throw new AppError(404, 'Notification not found.', 'NOT_FOUND');
  ok(res, null, 'Notification marked as read.');
});
adminRouter.post('/notifications/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.actor.id, readAt: null },
    data: { readAt: new Date() },
  });
  ok(res, null, 'All notifications marked as read.');
});
