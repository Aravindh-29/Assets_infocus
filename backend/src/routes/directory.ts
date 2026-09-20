import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  admin,
  AppError,
  employeeScope,
  listed,
  managers,
  ok,
  paging,
  param,
  queryString,
  userSelect,
} from '../http.js';
import { employeeSchema, name, text, uuid } from '../validators.js';
import { audit, type Tx } from '../services/audit.js';
import { transaction } from '../services/lifecycle.js';

export const directoryRouter = Router();
const employeeInclude = {
  department: true,
  location: true,
  manager: { select: { id: true, name: true, employeeId: true } },
  user: { select: userSelect },
} satisfies Prisma.EmployeeInclude;
async function employeeReferences(tx: Tx, data: Partial<z.infer<typeof employeeSchema>>, id?: string) {
  if (
    data.departmentId &&
    !(await tx.department.findFirst({ where: { id: data.departmentId, active: true } }))
  )
    throw new AppError(422, 'Choose an active department.', 'INVALID_DEPARTMENT');
  if (data.locationId && !(await tx.location.findFirst({ where: { id: data.locationId, active: true } })))
    throw new AppError(422, 'Choose an active location.', 'INVALID_LOCATION');
  if (
    data.managerId &&
    (data.managerId === id ||
      !(await tx.employee.findFirst({ where: { id: data.managerId, deletedAt: null, status: 'ACTIVE' } })))
  )
    throw new AppError(422, 'Choose another active employee as manager.', 'INVALID_MANAGER');
}
directoryRouter.get('/lookups', async (req, res) => {
  const scope = employeeScope(req.actor);
  const [categories, departments, locations, employees] = await Promise.all([
    prisma.assetCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.department.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.location.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: { deletedAt: null, ...(scope ? { id: scope } : { status: 'ACTIVE' }) },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        departmentId: true,
        locationId: true,
        department: true,
        location: true,
      },
      orderBy: { name: 'asc' },
    }),
  ]);
  ok(res, { categories, departments, locations, employees });
});
directoryRouter.get('/employees', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const scope = employeeScope(req.actor);
  const where: Prisma.EmployeeWhereInput = {
    deletedAt: null,
    ...(scope ? { id: scope } : {}),
    ...(search
      ? {
          OR: ['name', 'email', 'employeeId', 'designation'].map((key) => ({
            [key]: { contains: search, mode: 'insensitive' },
          })),
        }
      : {}),
    ...(queryString(req.query.departmentId) ? { departmentId: uuid.parse(req.query.departmentId) } : {}),
    ...(queryString(req.query.status) ? { status: String(req.query.status) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: { ...employeeInclude, _count: { select: { assignments: { where: { returnedAt: null } } } } },
      orderBy: { name: 'asc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.employee.count({ where }),
  ]);
  listed(res, rows, total, p);
});
directoryRouter.post('/employees', managers, async (req, res) => {
  const data = employeeSchema.parse(req.body);
  if (data.status !== 'ACTIVE') throw new AppError(422, 'New employees must start active.', 'INVALID_STATUS');
  const employee = await transaction(async (tx) => {
    await employeeReferences(tx, data);
    const row = await tx.employee.create({ data, include: employeeInclude });
    await audit(tx, req.actor, 'EMPLOYEE_CREATED', 'Employee', row.id);
    return row;
  });
  ok(res, employee, 'Employee created.', 201);
});
directoryRouter.get('/employees/:id', async (req, res) => {
  const id = uuid.parse(param(req));
  const scope = employeeScope(req.actor);
  if (scope && scope !== id) throw new AppError(404, 'Employee not found.', 'NOT_FOUND');
  const employee = await prisma.employee.findFirst({
    where: { id, deletedAt: null },
    include: {
      ...employeeInclude,
      assignments: {
        include: { asset: { include: { category: true, location: true } } },
        orderBy: { assignedAt: 'desc' },
      },
    },
  });
  if (!employee) throw new AppError(404, 'Employee not found.', 'NOT_FOUND');
  ok(res, employee);
});
directoryRouter.get('/employees/:id/assets', async (req, res) => {
  const id = uuid.parse(param(req));
  const scope = employeeScope(req.actor);
  if (scope && scope !== id) throw new AppError(404, 'Employee not found.', 'NOT_FOUND');
  ok(
    res,
    await prisma.assetAssignment.findMany({
      where: { employeeId: id, returnedAt: null },
      include: { asset: { include: { category: true, location: true } } },
      orderBy: { assignedAt: 'desc' },
    }),
  );
});
directoryRouter.get('/employees/:id/history', async (req, res) => {
  const id = uuid.parse(param(req));
  const scope = employeeScope(req.actor);
  if (scope && scope !== id) throw new AppError(404, 'Employee not found.', 'NOT_FOUND');
  ok(
    res,
    await prisma.assetHistory.findMany({
      where: { OR: [{ previousEmployeeId: id }, { newEmployeeId: id }] },
      include: { asset: { select: { id: true, assetTag: true, model: true } } },
      orderBy: { timestamp: 'desc' },
    }),
  );
});
directoryRouter.put('/employees/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = employeeSchema.partial().parse(req.body);
  const employee = await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${id}::uuid FOR UPDATE`;
    await employeeReferences(tx, data, id);
    const linkedUser = await tx.user.findUnique({ where: { employeeId: id } });
    if (linkedUser?.role === 'ADMIN' && req.actor.role !== 'ADMIN')
      throw new AppError(
        403,
        'Only an administrator can update another administrator’s employee record.',
        'FORBIDDEN',
      );
    if (data.status && !['ACTIVE', 'ON_LEAVE'].includes(data.status) && linkedUser?.id === req.actor.id)
      throw new AppError(409, 'You cannot deactivate your own employee record.', 'SELF_DISABLE');
    if (
      data.status &&
      !['ACTIVE', 'ON_LEAVE'].includes(data.status) &&
      linkedUser?.role === 'ADMIN' &&
      linkedUser.active &&
      (await tx.user.count({ where: { active: true, role: 'ADMIN' } })) <= 1
    )
      throw new AppError(409, 'At least one active administrator is required.', 'LAST_ADMIN');
    if (
      data.status &&
      !['ACTIVE', 'ON_LEAVE'].includes(data.status) &&
      (await tx.assetAssignment.count({ where: { employeeId: id, returnedAt: null } }))
    )
      throw new AppError(
        409,
        'Use offboarding to resolve all assigned assets before deactivating an employee.',
        'OUTSTANDING_ASSETS',
      );
    if (data.status === 'OFFBOARDED' || data.status === 'OFFBOARDING')
      throw new AppError(422, 'Use the offboarding workflow to change this status.', 'USE_OFFBOARDING');
    const row = await tx.employee.update({ where: { id }, data, include: employeeInclude });
    if (data.status && ['INACTIVE', 'RESIGNED', 'TERMINATED'].includes(data.status)) {
      await tx.user.updateMany({ where: { employeeId: id }, data: { active: false } });
      const user = await tx.user.findUnique({ where: { employeeId: id } });
      if (user)
        await tx.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
    }
    await audit(tx, req.actor, 'EMPLOYEE_UPDATED', 'Employee', id, { changedFields: Object.keys(data) });
    return row;
  });
  ok(res, employee, 'Employee updated.');
});
directoryRouter.delete('/employees/:id', admin, async (req, res) => {
  const id = uuid.parse(param(req));
  await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${id}::uuid FOR UPDATE`;
    if (await tx.assetAssignment.count({ where: { employeeId: id, returnedAt: null } }))
      throw new AppError(409, 'Resolve all outstanding assets before archiving.', 'OUTSTANDING_ASSETS');
    const user = await tx.user.findUnique({ where: { employeeId: id } });
    if (user?.id === req.actor.id)
      throw new AppError(409, 'You cannot archive your own employee record.', 'SELF_DISABLE');
    if (
      user?.role === 'ADMIN' &&
      user.active &&
      (await tx.user.count({ where: { active: true, role: 'ADMIN' } })) <= 1
    )
      throw new AppError(409, 'At least one active administrator is required.', 'LAST_ADMIN');
    await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    await tx.user.updateMany({ where: { employeeId: id }, data: { active: false } });
    if (user)
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await audit(tx, req.actor, 'EMPLOYEE_ARCHIVED', 'Employee', id);
  });
  ok(res, null, 'Employee archived; assignment history is preserved.');
});

const categorySchema = z
  .object({
    name,
    description: text.nullable().optional(),
    serialRequiredUnique: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .strict();
const departmentSchema = z.object({ name, active: z.boolean().default(true) }).strict();
const locationSchema = z
  .object({ name, address: text.nullable().optional(), active: z.boolean().default(true) })
  .strict();
directoryRouter.get('/categories', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
  const [rows, total] = await Promise.all([
    prisma.assetCategory.findMany({
      where,
      include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
      orderBy: { name: 'asc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetCategory.count({ where }),
  ]);
  listed(res, rows, total, p);
});
directoryRouter.post('/categories', managers, async (req, res) => {
  const data = categorySchema.parse(req.body);
  ok(
    res,
    await transaction(async (tx) => {
      const row = await tx.assetCategory.create({ data });
      await audit(tx, req.actor, 'CATEGORY_CREATED', 'Category', row.id);
      return row;
    }),
    'Category created.',
    201,
  );
});
directoryRouter.put('/categories/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = categorySchema.partial().parse(req.body);
  ok(
    res,
    await transaction(async (tx) => {
      const row = await tx.assetCategory.update({ where: { id }, data });
      if (data.serialRequiredUnique !== undefined) {
        const assets = await tx.asset.findMany({
          where: { categoryId: id },
          select: { id: true, serialNumber: true },
        });
        for (const asset of assets)
          await tx.asset.update({
            where: { id: asset.id },
            data: {
              serialUniqueKey:
                row.serialRequiredUnique && asset.serialNumber
                  ? `${id}:${asset.serialNumber.trim().toUpperCase()}`
                  : null,
            },
          });
      }
      await audit(tx, req.actor, 'CATEGORY_UPDATED', 'Category', id);
      return row;
    }),
    'Category updated.',
  );
});
directoryRouter.get('/departments', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
  const [rows, total] = await Promise.all([
    prisma.department.findMany({
      where,
      include: {
        _count: {
          select: { employees: { where: { deletedAt: null } }, assets: { where: { deletedAt: null } } },
        },
      },
      orderBy: { name: 'asc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.department.count({ where }),
  ]);
  listed(res, rows, total, p);
});
directoryRouter.post('/departments', managers, async (req, res) => {
  const data = departmentSchema.parse(req.body);
  ok(
    res,
    await transaction(async (tx) => {
      const row = await tx.department.create({ data });
      await audit(tx, req.actor, 'DEPARTMENT_CREATED', 'Department', row.id);
      return row;
    }),
    'Department created.',
    201,
  );
});
directoryRouter.put('/departments/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = departmentSchema.partial().parse(req.body);
  ok(
    res,
    await transaction(async (tx) => {
      const row = await tx.department.update({ where: { id }, data });
      await audit(tx, req.actor, 'DEPARTMENT_UPDATED', 'Department', id);
      return row;
    }),
    'Department updated.',
  );
});
directoryRouter.get('/locations', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
  const [rows, total] = await Promise.all([
    prisma.location.findMany({
      where,
      include: { _count: { select: { assets: { where: { deletedAt: null } } } } },
      orderBy: { name: 'asc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.location.count({ where }),
  ]);
  listed(res, rows, total, p);
});
directoryRouter.post('/locations', managers, async (req, res) => {
  const data = locationSchema.parse(req.body);
  ok(
    res,
    await transaction(async (tx) => {
      const row = await tx.location.create({ data });
      await audit(tx, req.actor, 'LOCATION_CREATED', 'Location', row.id);
      return row;
    }),
    'Location created.',
    201,
  );
});
directoryRouter.put('/locations/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = locationSchema.partial().parse(req.body);
  ok(
    res,
    await transaction(async (tx) => {
      const row = await tx.location.update({ where: { id }, data });
      await audit(tx, req.actor, 'LOCATION_UPDATED', 'Location', id);
      return row;
    }),
    'Location updated.',
  );
});
