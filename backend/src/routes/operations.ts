import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError, employeeScope, listed, managers, ok, paging, param, queryString } from '../http.js';
import { date, name, optionalId, text, uuid } from '../validators.js';
import { history, audit, notifyEmployee, notifyManagers } from '../services/audit.js';
import {
  assetInclude,
  lockedAsset,
  resolveOffboarding,
  setStatus,
  transaction,
} from '../services/lifecycle.js';
import { assertAssetAccess } from './assets.js';

export const operationsRouter = Router();
operationsRouter.get('/assignments', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AssetAssignmentWhereInput = {
    ...(search
      ? {
          OR: [
            { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
            { employee: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(req.query.active === 'true' ? { returnedAt: null } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assetAssignment.findMany({
      where,
      include: { asset: true, employee: { include: { department: true } } },
      orderBy: { assignedAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetAssignment.count({ where }),
  ]);
  listed(res, rows, total, p);
});
operationsRouter.get('/transfers', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AssetTransferWhereInput = search
    ? {
        OR: [
          { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
          { fromEmployee: { name: { contains: search, mode: 'insensitive' } } },
          { toEmployee: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.assetTransfer.findMany({
      where,
      include: { asset: true, fromEmployee: true, toEmployee: true },
      orderBy: { transferredAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetTransfer.count({ where }),
  ]);
  listed(res, rows, total, p);
});
operationsRouter.get('/returns', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AssetReturnWhereInput = search
    ? {
        OR: [
          { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
          { employee: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.assetReturn.findMany({
      where,
      include: { asset: true, employee: true },
      orderBy: { returnedAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetReturn.count({ where }),
  ]);
  listed(res, rows, total, p);
});
operationsRouter.get('/movements', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AssetMovementWhereInput = search
    ? { asset: { assetTag: { contains: search, mode: 'insensitive' } } }
    : {};
  const [rows, total] = await Promise.all([
    prisma.assetMovement.findMany({
      where,
      include: { asset: true, fromLocation: true, toLocation: true },
      orderBy: { movedAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetMovement.count({ where }),
  ]);
  listed(res, rows, total, p);
});
operationsRouter.get('/repairs', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AssetRepairWhereInput = {
    ...(search
      ? {
          OR: [
            { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
            { issue: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(queryString(req.query.status) ? { status: String(req.query.status) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assetRepair.findMany({
      where,
      include: { asset: true },
      orderBy: { openedAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetRepair.count({ where }),
  ]);
  listed(res, rows, total, p);
});
const repairInput = z
  .object({
    assetId: uuid,
    issue: name,
    vendor: text.optional(),
    cost: z.coerce.number().min(0).max(999999999).optional(),
    notes: text.optional(),
  })
  .strict();
operationsRouter.post('/repairs', managers, async (req, res) => {
  const data = repairInput.parse(req.body);
  const row = await transaction(async (tx) => {
    const asset = await lockedAsset(tx, data.assetId);
    const current = asset.assignments[0];
    if (!['AVAILABLE', 'ASSIGNED', 'DAMAGED'].includes(asset.status))
      throw new AppError(
        409,
        'This asset cannot be sent for repair in its current status.',
        'INVALID_STATUS_TRANSITION',
      );
    if (await tx.assetRepair.count({ where: { assetId: asset.id, status: { not: 'CLOSED' } } }))
      throw new AppError(409, 'This asset already has an open repair.', 'REPAIR_OPEN');
    if (current) {
      await tx.assetAssignment.update({
        where: { id: current.id },
        data: { returnedAt: new Date(), returnedById: req.actor.id, conditionAtReturn: asset.condition },
      });
      await resolveOffboarding(tx, asset.id, current.employeeId, 'RECEIVED_FOR_REPAIR');
      await notifyEmployee(
        tx,
        current.employeeId,
        'Asset received for repair',
        `${asset.assetTag} has been received for repair.`,
        '/profile',
      );
    }
    const repair = await tx.assetRepair.create({
      data: { ...data, reportedById: req.actor.id, openedAt: new Date() },
      include: { asset: true },
    });
    await tx.asset.update({ where: { id: asset.id }, data: { status: 'UNDER_REPAIR' } });
    await history(tx, req.actor, asset.id, 'ASSET_SENT_FOR_REPAIR', {
      previousStatus: asset.status,
      newStatus: 'UNDER_REPAIR',
      previousEmployeeId: current?.employeeId,
      notes: data.issue,
      metadata: { repairId: repair.id },
    });
    return repair;
  });
  ok(res, row, 'Asset received for repair.', 201);
});
operationsRouter.patch('/repairs/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = z
    .object({
      status: z.enum(['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED']),
      vendor: text.optional(),
      cost: z.coerce.number().min(0).max(999999999).optional(),
      notes: text.optional(),
    })
    .strict()
    .parse(req.body);
  const row = await transaction(async (tx) => {
    const repair = await tx.assetRepair.findUnique({ where: { id } });
    if (!repair) throw new AppError(404, 'Repair not found.', 'NOT_FOUND');
    await lockedAsset(tx, repair.assetId);
    const steps = ['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED'];
    if (steps.indexOf(data.status) !== steps.indexOf(repair.status) + 1)
      throw new AppError(
        409,
        'Repair statuses must progress from open, to in repair, to repaired, then closed.',
        'INVALID_REPAIR_TRANSITION',
      );
    const result = await tx.assetRepair.update({
      where: { id },
      data: { ...data, ...(data.status === 'CLOSED' ? { closedAt: new Date() } : {}) },
      include: { asset: true },
    });
    if (data.status === 'CLOSED')
      await tx.asset.update({
        where: { id: repair.assetId },
        data: { status: 'AVAILABLE', condition: 'GOOD' },
      });
    await history(
      tx,
      req.actor,
      repair.assetId,
      data.status === 'CLOSED' ? 'ASSET_REPAIRED' : 'REPAIR_UPDATED',
      {
        previousStatus: 'UNDER_REPAIR',
        newStatus: data.status === 'CLOSED' ? 'AVAILABLE' : 'UNDER_REPAIR',
        notes: data.notes ?? data.status,
        metadata: { repairId: id },
      },
    );
    return result;
  });
  ok(res, row, 'Repair updated.');
});
operationsRouter.get('/maintenance', managers, async (req, res) => {
  const p = paging(req);
  const search = queryString(req.query.search);
  const where: Prisma.AssetMaintenanceWhereInput = {
    ...(search
      ? {
          OR: [
            { asset: { assetTag: { contains: search, mode: 'insensitive' } } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(queryString(req.query.status) ? { status: String(req.query.status) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assetMaintenance.findMany({
      where,
      include: { asset: true },
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetMaintenance.count({ where }),
  ]);
  listed(res, rows, total, p);
});
const maintenanceInput = z
  .object({ assetId: uuid, description: name, scheduledAt: date.optional(), notes: text.optional() })
  .strict();
operationsRouter.post('/maintenance', managers, async (req, res) => {
  const data = maintenanceInput.parse(req.body);
  const row = await transaction(async (tx) => {
    const asset = await lockedAsset(tx, data.assetId);
    if (['DISPOSED', 'RETIRED', 'LOST'].includes(asset.status))
      throw new AppError(409, 'Maintenance cannot be scheduled for this asset.', 'ASSET_UNAVAILABLE');
    const row = await tx.assetMaintenance.create({
      data: { ...data, performedById: req.actor.id },
      include: { asset: true },
    });
    await history(tx, req.actor, data.assetId, 'MAINTENANCE_SCHEDULED', { notes: data.description });
    return row;
  });
  ok(res, row, 'Maintenance scheduled.', 201);
});
operationsRouter.patch('/maintenance/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = z
    .object({
      status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
      description: name.optional(),
      scheduledAt: date.optional(),
      notes: text.optional(),
    })
    .strict()
    .parse(req.body);
  const row = await transaction(async (tx) => {
    const original = await tx.assetMaintenance.findUniqueOrThrow({ where: { id } });
    if (['COMPLETED', 'CANCELLED'].includes(original.status))
      throw new AppError(409, 'Completed or cancelled maintenance cannot be changed.', 'MAINTENANCE_CLOSED');
    const updated = await tx.assetMaintenance.update({
      where: { id },
      data: { ...data, performedById: req.actor.id },
      include: { asset: true },
    });
    await history(tx, req.actor, updated.assetId, 'MAINTENANCE_UPDATED', {
      notes: `${data.status}: ${data.notes ?? updated.description}`,
    });
    return updated;
  });
  ok(res, row, 'Maintenance updated.');
});
operationsRouter.get('/requests', async (req, res) => {
  const p = paging(req);
  const scope = employeeScope(req.actor);
  const where: Prisma.AssetRequestWhereInput = {
    ...(scope ? { employeeId: scope } : {}),
    ...(queryString(req.query.status) ? { status: String(req.query.status) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.assetRequest.findMany({
      where,
      include: { asset: true, employee: true },
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.assetRequest.count({ where }),
  ]);
  listed(res, rows, total, p);
});
operationsRouter.post('/requests', async (req, res) => {
  const data = z
    .object({
      assetId: uuid,
      type: z.enum(['DAMAGE', 'LOST', 'RETURN', 'TRANSFER']),
      description: name,
      location: text.optional(),
      targetEmployeeId: optionalId,
    })
    .strict()
    .parse(req.body);
  await assertAssetAccess(data.assetId, req.actor);
  const row = await transaction(async (tx) => {
    const asset = await lockedAsset(tx, data.assetId);
    const current = asset.assignments[0];
    if (!current || (req.actor.role === 'EMPLOYEE' && current.employeeId !== req.actor.employeeId))
      throw new AppError(
        409,
        'Only currently assigned assets can have employee requests.',
        'NO_ACTIVE_ASSIGNMENT',
      );
    if (
      data.targetEmployeeId &&
      !(await tx.employee.findFirst({
        where: { id: data.targetEmployeeId, status: 'ACTIVE', deletedAt: null },
      }))
    )
      throw new AppError(422, 'Target employee is unavailable.', 'EMPLOYEE_UNAVAILABLE');
    if (
      await tx.assetRequest.count({
        where: {
          assetId: asset.id,
          employeeId: current.employeeId,
          type: data.type,
          status: { in: ['PENDING', 'APPROVED'] },
        },
      })
    )
      throw new AppError(409, 'A request of this type is already pending.', 'REQUEST_EXISTS');
    const request = await tx.assetRequest.create({
      data: { ...data, employeeId: current.employeeId },
      include: { asset: true, employee: true },
    });
    await history(tx, req.actor, asset.id, 'ASSET_REQUESTED', {
      previousEmployeeId: current.employeeId,
      notes: `${data.type}: ${data.description}`,
      metadata: { requestId: request.id, type: data.type },
    });
    await notifyManagers(
      tx,
      `${data.type.toLowerCase()} request`,
      `${request.employee.name}: ${asset.assetTag} — ${data.description}`,
      '/requests',
    );
    return request;
  });
  ok(res, row, 'Request submitted.', 201);
});
operationsRouter.patch('/requests/:id', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const data = z
    .object({ status: z.enum(['APPROVED', 'REJECTED']), resolution: text.optional() })
    .strict()
    .parse(req.body);
  const row = await transaction(async (tx) => {
    const request = await tx.assetRequest.findUniqueOrThrow({ where: { id } });
    const asset = await lockedAsset(tx, request.assetId);
    if (request.status !== 'PENDING')
      throw new AppError(409, 'This request has already been reviewed.', 'REQUEST_REVIEWED');
    if (data.status === 'APPROVED') {
      if (asset.assignments[0]?.employeeId !== request.employeeId)
        throw new AppError(
          409,
          'The asset custody changed since this request was submitted. Reject the stale request.',
          'STALE_REQUEST',
        );
      if (request.type === 'DAMAGE' || request.type === 'LOST')
        await setStatus(
          tx,
          asset.id,
          req.actor,
          request.type === 'DAMAGE' ? 'DAMAGED' : 'LOST',
          data.resolution ?? request.description,
        );
    }
    const result = await tx.assetRequest.update({
      where: { id },
      data: {
        ...data,
        status:
          data.status === 'APPROVED' && ['DAMAGE', 'LOST'].includes(request.type) ? 'COMPLETED' : data.status,
        reviewedById: req.actor.id,
        reviewedAt: new Date(),
      },
      include: { asset: true, employee: true },
    });
    await audit(tx, req.actor, `REQUEST_${data.status}`, 'AssetRequest', id);
    await notifyEmployee(
      tx,
      request.employeeId,
      'Request reviewed',
      `Your ${request.type.toLowerCase()} request for ${asset.assetTag} was ${data.status.toLowerCase()}.${data.status === 'APPROVED' && ['RETURN', 'TRANSFER'].includes(request.type) ? ' Contact the asset team to complete the handover.' : ''}`,
      '/requests',
    );
    return result;
  });
  ok(res, row, 'Request reviewed.');
});

const offboardingInclude = {
  employee: { include: { department: true } },
  items: { include: { asset: { include: assetInclude } } },
} satisfies Prisma.OffboardingInclude;
operationsRouter.get('/offboarding', managers, async (req, res) => {
  const p = paging(req);
  const [rows, total] = await Promise.all([
    prisma.offboarding.findMany({
      include: offboardingInclude,
      orderBy: { startedAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.offboarding.count(),
  ]);
  listed(res, rows, total, p);
});
operationsRouter.post('/offboarding', managers, async (req, res) => {
  const data = z.object({ employeeId: uuid, notes: text.optional() }).strict().parse(req.body);
  const row = await transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${data.employeeId}::uuid FOR UPDATE`;
    const employee = await tx.employee.findUnique({
      where: { id: data.employeeId },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!employee || employee.deletedAt || employee.status !== 'ACTIVE')
      throw new AppError(409, 'Only an active employee can begin offboarding.', 'EMPLOYEE_UNAVAILABLE');
    if (employee.user?.id === req.actor.id)
      throw new AppError(409, 'Another administrator must handle your offboarding.', 'SELF_OFFBOARDING');
    if (employee.user?.role === 'ADMIN' && req.actor.role !== 'ADMIN')
      throw new AppError(403, 'Only an administrator can offboard another administrator.', 'FORBIDDEN');
    if (await tx.offboarding.count({ where: { employeeId: employee.id, status: 'IN_PROGRESS' } }))
      throw new AppError(409, 'Offboarding is already in progress.', 'OFFBOARDING_EXISTS');
    const assignments = await tx.assetAssignment.findMany({
      where: { employeeId: employee.id, returnedAt: null },
    });
    await tx.employee.update({ where: { id: employee.id }, data: { status: 'OFFBOARDING' } });
    const result = await tx.offboarding.create({
      data: {
        ...data,
        startedById: req.actor.id,
        startedAt: new Date(),
        items: { create: assignments.map((a) => ({ assetId: a.assetId })) },
      },
      include: offboardingInclude,
    });
    await audit(tx, req.actor, 'OFFBOARDING_STARTED', 'Offboarding', result.id, {
      employeeId: employee.id,
      assets: assignments.length,
    });
    await notifyManagers(
      tx,
      'Employee offboarding started',
      `${employee.name} has ${assignments.length} asset(s) to account for.`,
      `/offboarding/${result.id}`,
    );
    await notifyEmployee(
      tx,
      employee.id,
      'Offboarding checklist',
      `Please arrange the return of your ${assignments.length} company asset(s).`,
      '/assets',
    );
    return result;
  });
  ok(res, row, 'Offboarding started.', 201);
});
operationsRouter.get('/offboarding/:id', managers, async (req, res) =>
  ok(
    res,
    await prisma.offboarding.findUniqueOrThrow({
      where: { id: uuid.parse(param(req)) },
      include: offboardingInclude,
    }),
  ),
);
operationsRouter.post('/offboarding/:id/complete', managers, async (req, res) => {
  const id = uuid.parse(param(req));
  const row = await transaction(async (tx) => {
    const offboarding = await tx.offboarding.findUniqueOrThrow({ where: { id }, include: { items: true } });
    await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${offboarding.employeeId}::uuid FOR UPDATE`;
    if (offboarding.status !== 'IN_PROGRESS')
      throw new AppError(409, 'This offboarding is already complete.', 'OFFBOARDING_COMPLETED');
    if (await tx.assetAssignment.count({ where: { employeeId: offboarding.employeeId, returnedAt: null } }))
      throw new AppError(
        409,
        'Return, transfer, or explicitly resolve every outstanding asset before completing offboarding.',
        'OUTSTANDING_ASSETS',
      );
    if (offboarding.items.some((item) => item.resolution === 'PENDING_RETURN'))
      throw new AppError(409, 'Resolve all checklist items first.', 'OUTSTANDING_ASSETS');
    const user = await tx.user.findUnique({ where: { employeeId: offboarding.employeeId } });
    if (user?.role === 'ADMIN' && req.actor.role !== 'ADMIN')
      throw new AppError(403, 'Only an administrator can offboard another administrator.', 'FORBIDDEN');
    if (
      user?.role === 'ADMIN' &&
      user.active &&
      (await tx.user.count({ where: { role: 'ADMIN', active: true } })) <= 1
    )
      throw new AppError(409, 'At least one active administrator is required.', 'LAST_ADMIN');
    await tx.employee.update({ where: { id: offboarding.employeeId }, data: { status: 'OFFBOARDED' } });
    if (user) {
      await tx.user.update({ where: { id: user.id }, data: { active: false } });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    const result = await tx.offboarding.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
      include: offboardingInclude,
    });
    await audit(tx, req.actor, 'OFFBOARDING_COMPLETED', 'Offboarding', id);
    return result;
  });
  ok(res, row, 'Offboarding completed.');
});
