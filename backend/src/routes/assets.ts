import { Router, type Request } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  AppError,
  employeeScope,
  listed,
  managers,
  admin,
  ok,
  paging,
  param,
  queryString,
  type Actor,
} from '../http.js';
import {
  assetSchema,
  assignSchema,
  transferSchema,
  returnSchema,
  statuses,
  text,
  uuid,
} from '../validators.js';
import {
  assetInclude,
  assignAsset,
  transferAsset,
  returnAsset,
  transaction,
  lockedAsset,
  setStatus,
  withHolder,
  availableAfterReturn,
} from '../services/lifecycle.js';
import { history, type Tx } from '../services/audit.js';

export const assetsRouter = Router();
export function assetWhere(req: Request, includeEmployeeFilter = true): Prisma.AssetWhereInput {
  const scope = employeeScope(req.actor);
  const search = queryString(req.query.search)?.trim();
  const where: Prisma.AssetWhereInput = {
    deletedAt: null,
    ...(scope ? { assignments: { some: { employeeId: scope, returnedAt: null } } } : {}),
  };
  if (queryString(req.query.deleted) === 'true' && req.actor.role === 'ADMIN')
    where.deletedAt = { not: null };
  if (search)
    where.OR = [
      ...['assetTag', 'manufacturer', 'model', 'serialNumber', 'assetType', 'barcode'].map((key) => ({
        [key]: { contains: search, mode: 'insensitive' },
      })),
      {
        assignments: {
          some: {
            returnedAt: null,
            employee: {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { employeeId: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
      },
    ];
  for (const key of ['status', 'condition', 'categoryId', 'departmentId', 'locationId'] as const) {
    const value = queryString(req.query[key]);
    if (value) where[key] = key.endsWith('Id') ? uuid.parse(value) : value;
  }
  for (const [field, prefix] of [
    ['purchaseDate', 'purchase'],
    ['warrantyExpiry', 'warranty'],
  ] as const) {
    const from = queryString(req.query[`${prefix}From`]);
    const to = queryString(req.query[`${prefix}To`]);
    if (from || to)
      where[field] = {
        ...(from ? { gte: z.coerce.date().parse(from) } : {}),
        ...(to ? { lte: z.coerce.date().parse(to) } : {}),
      };
  }
  if (req.query.assigned === 'true' && !scope) where.assignments = { some: { returnedAt: null } };
  if (req.query.assigned === 'false') where.AND = [{ assignments: { none: { returnedAt: null } } }];
  if (includeEmployeeFilter && queryString(req.query.employeeId))
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { assignments: { some: { employeeId: uuid.parse(req.query.employeeId), returnedAt: null } } },
    ];
  return where;
}
export async function assertAssetAccess(id: string, actor: Actor) {
  const scope = employeeScope(actor);
  const asset = await prisma.asset.findFirst({
    where: {
      id,
      ...(actor.role === 'ADMIN' ? {} : { deletedAt: null }),
      ...(scope ? { assignments: { some: { employeeId: scope, returnedAt: null } } } : {}),
    },
    select: { id: true },
  });
  if (!asset) throw new AppError(404, 'Asset not found.', 'NOT_FOUND');
}
async function references(tx: Tx, data: z.infer<typeof assetSchema>) {
  const category = await tx.assetCategory.findUnique({ where: { id: data.categoryId } });
  if (!category?.active) throw new AppError(422, 'Choose an active category.', 'INVALID_CATEGORY');
  if (
    data.departmentId &&
    !(await tx.department.findFirst({ where: { id: data.departmentId, active: true } }))
  )
    throw new AppError(422, 'Choose an active department.', 'INVALID_DEPARTMENT');
  if (data.locationId && !(await tx.location.findFirst({ where: { id: data.locationId, active: true } })))
    throw new AppError(422, 'Choose an active location.', 'INVALID_LOCATION');
  if (data.warrantyStart && data.warrantyExpiry && data.warrantyExpiry < data.warrantyStart)
    throw new AppError(422, 'Warranty expiry cannot precede warranty start.', 'INVALID_DATE');
  const serial = data.serialNumber?.trim() || null;
  return {
    serialNumber: serial,
    serialUniqueKey:
      category.serialRequiredUnique && serial ? `${category.id}:${serial.toUpperCase()}` : null,
  };
}
assetsRouter.get('/', async (req, res) => {
  const p = paging(req);
  const where = assetWhere(req);
  const allowed = [
    'assetTag',
    'assetType',
    'manufacturer',
    'model',
    'serialNumber',
    'status',
    'condition',
    'purchaseDate',
    'warrantyExpiry',
    'createdAt',
  ];
  const sortBy = allowed.includes(String(req.query.sortBy)) ? String(req.query.sortBy) : 'createdAt';
  const [rows, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: assetInclude,
      skip: p.skip,
      take: p.take,
      orderBy: { [sortBy]: req.query.sortOrder === 'asc' ? 'asc' : 'desc' },
    }),
    prisma.asset.count({ where }),
  ]);
  listed(res, rows.map(withHolder), total, p);
});
assetsRouter.post('/', managers, async (req, res) => {
  const data = assetSchema.parse(req.body);
  const result = await transaction(async (tx) => {
    const serial = await references(tx, data);
    const asset = await tx.asset.create({
      data: { ...data, ...serial, status: availableAfterReturn(data.condition), createdById: req.actor.id },
      include: assetInclude,
    });
    await history(tx, req.actor, asset.id, 'ASSET_REGISTERED', {
      newStatus: asset.status,
      newLocationId: asset.locationId,
      notes: data.notes,
    });
    return withHolder(asset);
  });
  ok(res, result, 'Asset registered.', 201);
});
assetsRouter.get('/:id/history', async (req, res) => {
  const id = uuid.parse(param(req));
  await assertAssetAccess(id, req.actor);
  const scope = employeeScope(req.actor);
  const rows = await prisma.assetHistory.findMany({
    where: {
      assetId: id,
      ...(scope ? { OR: [{ newEmployeeId: scope }, { previousEmployeeId: scope }] } : {}),
    },
    orderBy: { timestamp: 'desc' },
  });
  ok(res, rows);
});
assetsRouter.get('/:id', async (req, res) => {
  const id = uuid.parse(param(req));
  await assertAssetAccess(id, req.actor);
  if (req.actor.role === 'EMPLOYEE') {
    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id },
      include: {
        ...assetInclude,
        history: {
          where: {
            OR: [{ newEmployeeId: req.actor.employeeId }, { previousEmployeeId: req.actor.employeeId }],
          },
          orderBy: { timestamp: 'desc' },
        },
        assignments: {
          where: { employeeId: req.actor.employeeId ?? '' },
          include: { employee: { include: { department: true, location: true } } },
          orderBy: { assignedAt: 'desc' },
        },
      },
    });
    const { purchaseCost: _cost, invoiceNumber: _invoice, vendor: _vendor, notes: _notes, ...safe } = asset;
    ok(res, withHolder(safe));
    return;
  }
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id },
    include: {
      ...assetInclude,
      assignments: {
        include: { employee: { include: { department: true, location: true } } },
        orderBy: { assignedAt: 'desc' },
      },
      history: { orderBy: { timestamp: 'desc' } },
      repairs: { orderBy: { openedAt: 'desc' } },
    },
  });
  ok(res, withHolder(asset));
});
assetsRouter.put('/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const patch = assetSchema.partial().parse(req.body);
  const asset = await transaction(async (tx) => {
    const previous = await lockedAsset(tx, id);
    const merged = assetSchema.parse({
      ...Object.fromEntries(
        Object.keys(assetSchema.shape).map((key) => [key, previous[key as keyof typeof previous]]),
      ),
      ...patch,
    });
    const serial = await references(tx, merged);
    const updated = await tx.asset.update({
      where: { id },
      data: { ...patch, ...serial },
      include: assetInclude,
    });
    if (patch.locationId && patch.locationId !== previous.locationId)
      await tx.assetMovement.create({
        data: {
          assetId: id,
          fromLocationId: previous.locationId,
          toLocationId: patch.locationId,
          movedAt: new Date(),
          performedById: req.actor.id,
          notes: 'Location changed in asset details.',
        },
      });
    const changes = Object.fromEntries(
      Object.keys(patch).map((key) => [
        key,
        { before: previous[key as keyof typeof previous], after: updated[key as keyof typeof updated] },
      ]),
    );
    await history(tx, req.actor, id, 'ASSET_UPDATED', {
      previousStatus: previous.status,
      newStatus: updated.status,
      previousLocationId: previous.locationId,
      newLocationId: updated.locationId,
      metadata: JSON.parse(
        JSON.stringify({ changedFields: Object.keys(patch), changes }),
      ) as Prisma.InputJsonValue,
    });
    return withHolder(updated);
  });
  ok(res, asset, 'Asset updated.');
});
assetsRouter.delete('/:id', admin, async (req, res) => {
  const id = uuid.parse(param(req));
  await transaction(async (tx) => {
    const asset = await lockedAsset(tx, id);
    if (asset.assignments.length || asset.status === 'UNDER_REPAIR')
      throw new AppError(409, 'Return the asset and close repairs before archiving.', 'ASSET_IN_USE');
    await tx.asset.update({ where: { id }, data: { deletedAt: new Date() } });
    await history(tx, req.actor, id, 'ASSET_ARCHIVED');
  });
  ok(res, null, 'Asset archived; its history is preserved.');
});
assetsRouter.post('/:id/restore', admin, async (req, res) => {
  const id = uuid.parse(param(req));
  const asset = await transaction(async (tx) => {
    const value = await tx.asset.update({ where: { id }, data: { deletedAt: null }, include: assetInclude });
    await history(tx, req.actor, id, 'ASSET_RESTORED');
    return value;
  });
  ok(res, withHolder(asset), 'Asset restored.');
});
assetsRouter.post('/:id/assign', managers, async (req, res) =>
  ok(
    res,
    await assignAsset(uuid.parse(param(req)), req.actor, assignSchema.parse(req.body)),
    'Asset assigned.',
  ),
);
assetsRouter.post('/:id/transfer', managers, async (req, res) =>
  ok(
    res,
    await transferAsset(uuid.parse(param(req)), req.actor, transferSchema.parse(req.body)),
    'Asset transferred.',
  ),
);
assetsRouter.post('/:id/return', managers, async (req, res) =>
  ok(
    res,
    await returnAsset(uuid.parse(param(req)), req.actor, returnSchema.parse(req.body)),
    'Asset returned.',
  ),
);
assetsRouter.post('/:id/move', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = z.object({ locationId: uuid, notes: text.optional() }).strict().parse(req.body);
  const asset = await transaction(async (tx) => {
    const previous = await lockedAsset(tx, id);
    if (previous.locationId === data.locationId)
      throw new AppError(409, 'Asset is already at that location.', 'SAME_LOCATION');
    if (!(await tx.location.findFirst({ where: { id: data.locationId, active: true } })))
      throw new AppError(422, 'Choose an active location.', 'INVALID_LOCATION');
    await tx.assetMovement.create({
      data: {
        assetId: id,
        fromLocationId: previous.locationId,
        toLocationId: data.locationId,
        movedAt: new Date(),
        performedById: req.actor.id,
        notes: data.notes,
      },
    });
    const updated = await tx.asset.update({
      where: { id },
      data: { locationId: data.locationId },
      include: assetInclude,
    });
    await history(tx, req.actor, id, 'ASSET_MOVED', {
      previousLocationId: previous.locationId,
      newLocationId: data.locationId,
      notes: data.notes,
    });
    return withHolder(updated);
  });
  ok(res, asset, 'Asset moved.');
});
assetsRouter.patch('/:id/status', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = z.object({ status: statuses, notes: text.optional() }).strict().parse(req.body);
  ok(
    res,
    await transaction((tx) => setStatus(tx, id, req.actor, data.status, data.notes)),
    'Asset status updated.',
  );
});
