import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { employeeScope, ok, queryString, type Actor } from '../http.js';

export const dashboardRouter = Router();
async function summary(actor: Actor) {
  const scope = employeeScope(actor);
  const where: Prisma.AssetWhereInput = {
    deletedAt: null,
    ...(scope ? { assignments: { some: { employeeId: scope, returnedAt: null } } } : {}),
  };
  const now = new Date();
  const sixMonths = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const setting = await prisma.setting.findUnique({ where: { key: 'warrantyAlertDays' } });
  const expiry = new Date(
    now.getTime() + (typeof setting?.value === 'number' ? setting.value : 30) * 86400000,
  );
  const [
    statuses,
    categories,
    departments,
    totalEmployees,
    pendingRequests,
    offboarding,
    warrantiesExpiring,
    assignments,
    returns,
    recentActivity,
    categoryNames,
    departmentNames,
  ] = await Promise.all([
    prisma.asset.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.asset.groupBy({ by: ['categoryId'], where, _count: { _all: true } }),
    prisma.asset.groupBy({
      by: ['departmentId'],
      where: {
        ...where,
        assignments: { some: { returnedAt: null, ...(scope ? { employeeId: scope } : {}) } },
      },
      _count: { _all: true },
    }),
    prisma.employee.count({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'OFFBOARDING', 'ON_LEAVE'] },
        ...(scope ? { id: scope } : {}),
      },
    }),
    prisma.assetRequest.count({
      where: { status: { in: ['PENDING', 'APPROVED'] }, ...(scope ? { employeeId: scope } : {}) },
    }),
    scope ? Promise.resolve(0) : prisma.offboarding.count({ where: { status: 'IN_PROGRESS' } }),
    prisma.asset.count({ where: { ...where, warrantyExpiry: { gte: now, lte: expiry } } }),
    prisma.assetAssignment.findMany({
      where: { assignedAt: { gte: sixMonths }, ...(scope ? { employeeId: scope } : {}) },
      select: { assignedAt: true },
    }),
    prisma.assetReturn.findMany({
      where: { returnedAt: { gte: sixMonths }, ...(scope ? { employeeId: scope } : {}) },
      select: { returnedAt: true },
    }),
    prisma.assetHistory.findMany({
      where: scope ? { OR: [{ previousEmployeeId: scope }, { newEmployeeId: scope }] } : {},
      include: { asset: { select: { id: true, assetTag: true, model: true } } },
      orderBy: { timestamp: 'desc' },
      take: 10,
    }),
    prisma.assetCategory.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
  ]);
  const count = (status: string) => statuses.find((row) => row.status === status)?._count._all ?? 0;
  const assignmentTrend = Array.from({ length: 6 }, (_, i) => {
    const month = new Date(Date.UTC(sixMonths.getUTCFullYear(), sixMonths.getUTCMonth() + i, 1));
    const key = month.toISOString().slice(0, 7);
    return {
      month: month.toLocaleDateString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      assigned: assignments.filter((a) => a.assignedAt.toISOString().startsWith(key)).length,
      returned: returns.filter((a) => a.returnedAt.toISOString().startsWith(key)).length,
    };
  });
  return {
    totalAssets: statuses.reduce((sum, row) => sum + row._count._all, 0),
    availableAssets: count('AVAILABLE'),
    assignedAssets: count('ASSIGNED'),
    underRepairAssets: count('UNDER_REPAIR'),
    lostAssets: count('LOST'),
    damagedAssets: count('DAMAGED'),
    retiredAssets: count('RETIRED'),
    disposedAssets: count('DISPOSED'),
    pendingActions: pendingRequests + offboarding,
    warrantiesExpiring,
    totalEmployees,
    statusDistribution: statuses.map((row) => ({ name: row.status, value: row._count._all })),
    categoryDistribution: categories.map((row) => ({
      name: categoryNames.find((c) => c.id === row.categoryId)?.name ?? 'Unknown',
      value: row._count._all,
    })),
    departmentDistribution: departments.map((row) => ({
      name: departmentNames.find((d) => d.id === row.departmentId)?.name ?? 'Unassigned',
      value: row._count._all,
    })),
    assignmentTrend,
    recentActivity,
  };
}
dashboardRouter.get('/dashboard/summary', async (req, res) => ok(res, await summary(req.actor)));
for (const [route, key] of [
  ['status-distribution', 'statusDistribution'],
  ['category-distribution', 'categoryDistribution'],
  ['assignment-trend', 'assignmentTrend'],
  ['department-distribution', 'departmentDistribution'],
] as const)
  dashboardRouter.get(`/dashboard/${route}`, async (req, res) => ok(res, (await summary(req.actor))[key]));
dashboardRouter.get('/search', async (req, res) => {
  const q = queryString(req.query.q)?.trim().slice(0, 100) ?? '';
  const scope = employeeScope(req.actor);
  if (q.length < 2) {
    ok(res, { assets: [], employees: [] });
    return;
  }
  const [assets, employees] = await Promise.all([
    prisma.asset.findMany({
      where: {
        deletedAt: null,
        ...(scope ? { assignments: { some: { employeeId: scope, returnedAt: null } } } : {}),
        OR: [
          ...['assetTag', 'serialNumber', 'manufacturer', 'model', 'barcode'].map((key) => ({
            [key]: { contains: q, mode: 'insensitive' },
          })),
          { department: { name: { contains: q, mode: 'insensitive' } } },
          { location: { name: { contains: q, mode: 'insensitive' } } },
          {
            assignments: {
              some: { returnedAt: null, employee: { name: { contains: q, mode: 'insensitive' } } },
            },
          },
        ],
      },
      select: { id: true, assetTag: true, model: true, manufacturer: true, status: true, serialNumber: true },
      take: 8,
      orderBy: { assetTag: 'asc' },
    }),
    scope
      ? Promise.resolve([])
      : prisma.employee.findMany({
          where: {
            deletedAt: null,
            OR: [
              ...['name', 'employeeId', 'email'].map((key) => ({
                [key]: { contains: q, mode: 'insensitive' },
              })),
              { department: { name: { contains: q, mode: 'insensitive' } } },
            ],
          },
          select: { id: true, name: true, employeeId: true, email: true },
          take: 8,
          orderBy: { name: 'asc' },
        }),
  ]);
  ok(res, { assets, employees });
});
