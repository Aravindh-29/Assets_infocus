import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AppError, type Actor } from '../http.js';
import { assignSchema, transferSchema, returnSchema } from '../validators.js';
import { audit, history, notifyEmployee, type Tx } from './audit.js';

export const assetInclude = {
  category: true,
  department: true,
  location: true,
  assignments: {
    where: { returnedAt: null },
    include: { employee: { include: { department: true, location: true } } },
  },
} satisfies Prisma.AssetInclude;
export function withHolder<T extends { assignments?: { returnedAt?: Date | null }[] }>(asset: T) {
  return { ...asset, currentAssignment: asset.assignments?.find((a) => !a.returnedAt) ?? null };
}
export const transaction = <T>(fn: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 });
export async function lockedAsset(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Asset" WHERE id = ${id}::uuid FOR UPDATE`;
  const asset = await tx.asset.findUnique({
    where: { id },
    include: { assignments: { where: { returnedAt: null } } },
  });
  if (!asset || asset.deletedAt) throw new AppError(404, 'Asset not found.', 'NOT_FOUND');
  return asset;
}
export async function validEmployee(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${id}::uuid FOR UPDATE`;
  const employee = await tx.employee.findUnique({ where: { id } });
  if (!employee || employee.deletedAt || employee.status !== 'ACTIVE')
    throw new AppError(
      409,
      'Assignments require an active employee who is not offboarding.',
      'EMPLOYEE_UNAVAILABLE',
    );
  return employee;
}
export function assertChronology(at: Date, from?: Date) {
  if (at.getTime() > Date.now() + 60000)
    throw new AppError(422, 'Lifecycle dates cannot be in the future.', 'INVALID_DATE');
  if (from && at < from)
    throw new AppError(422, 'This date cannot precede the current assignment.', 'INVALID_DATE');
}
export const availableAfterReturn = (condition: string) =>
  ['DAMAGED', 'UNUSABLE', 'POOR'].includes(condition) ? 'DAMAGED' : 'AVAILABLE';
export async function resolveOffboarding(tx: Tx, assetId: string, employeeId: string, resolution: string) {
  await tx.offboardingItem.updateMany({
    where: { assetId, resolution: 'PENDING_RETURN', offboarding: { employeeId, status: 'IN_PROGRESS' } },
    data: { resolution, resolvedAt: new Date() },
  });
}
export async function assignAsset(id: string, actor: Actor, data: z.infer<typeof assignSchema>) {
  return transaction(async (tx) => {
    const asset = await lockedAsset(tx, id);
    if (asset.status !== 'AVAILABLE' || asset.assignments.length)
      throw new AppError(409, 'Only available assets can be assigned.', 'ASSET_UNAVAILABLE');
    const employee = await validEmployee(tx, data.employeeId);
    const latest = await tx.assetAssignment.findFirst({
      where: { assetId: id, returnedAt: { not: null } },
      orderBy: { returnedAt: 'desc' },
      select: { returnedAt: true },
    });
    const assignedAt = data.assignedAt ?? new Date();
    assertChronology(assignedAt, latest?.returnedAt ?? undefined);
    if (availableAfterReturn(data.condition ?? asset.condition) !== 'AVAILABLE')
      throw new AppError(409, 'Repair damaged or unusable assets before assignment.', 'ASSET_UNAVAILABLE');
    if (data.expectedReturnAt && data.expectedReturnAt < assignedAt)
      throw new AppError(422, 'Expected return must follow assignment.', 'INVALID_DATE');
    await tx.assetAssignment.create({
      data: {
        assetId: id,
        employeeId: employee.id,
        assignedAt,
        expectedReturnAt: data.expectedReturnAt,
        assignedById: actor.id,
        conditionAtAssignment: data.condition ?? asset.condition,
        notes: data.notes,
      },
    });
    await tx.asset.update({
      where: { id },
      data: {
        status: 'ASSIGNED',
        condition: data.condition ?? asset.condition,
        departmentId: employee.departmentId,
      },
    });
    await history(tx, actor, id, 'ASSET_ASSIGNED', {
      previousStatus: asset.status,
      newStatus: 'ASSIGNED',
      newEmployeeId: employee.id,
      timestamp: assignedAt,
      notes: `Assigned to ${employee.name} (${employee.employeeId}).${data.notes ? ` ${data.notes}` : ''}`,
    });
    await notifyEmployee(
      tx,
      employee.id,
      'Asset assigned',
      `${asset.assetTag} has been assigned to you.`,
      `/assets/${id}`,
    );
    return withHolder(await tx.asset.findUniqueOrThrow({ where: { id }, include: assetInclude }));
  });
}
export async function transferAsset(id: string, actor: Actor, data: z.infer<typeof transferSchema>) {
  return transaction(async (tx) => {
    const asset = await lockedAsset(tx, id);
    const current = asset.assignments[0];
    if (!current || asset.status !== 'ASSIGNED')
      throw new AppError(
        409,
        'Only assets in assigned status can be transferred. Return or repair damaged assets first.',
        'NO_ACTIVE_ASSIGNMENT',
      );
    if (current.employeeId === data.employeeId)
      throw new AppError(409, 'Select a different employee.', 'SAME_EMPLOYEE');
    const employee = await validEmployee(tx, data.employeeId);
    const transferredAt = data.transferredAt ?? new Date();
    assertChronology(transferredAt, current.assignedAt);
    await tx.assetAssignment.update({
      where: { id: current.id },
      data: { returnedAt: transferredAt, returnedById: actor.id, conditionAtReturn: asset.condition },
    });
    await tx.assetAssignment.create({
      data: {
        assetId: id,
        employeeId: employee.id,
        assignedAt: transferredAt,
        assignedById: actor.id,
        conditionAtAssignment: asset.condition,
        notes: data.notes,
      },
    });
    await tx.assetTransfer.create({
      data: {
        assetId: id,
        fromEmployeeId: current.employeeId,
        toEmployeeId: employee.id,
        transferredAt,
        performedById: actor.id,
        reason: data.reason,
        notes: data.notes,
      },
    });
    await tx.asset.update({
      where: { id },
      data: { status: 'ASSIGNED', departmentId: employee.departmentId },
    });
    const fromEmployee = await tx.employee.findUniqueOrThrow({
      where: { id: current.employeeId },
      select: { name: true, employeeId: true },
    });
    await history(tx, actor, id, 'ASSET_TRANSFERRED', {
      previousStatus: asset.status,
      newStatus: asset.status,
      previousEmployeeId: current.employeeId,
      newEmployeeId: employee.id,
      timestamp: transferredAt,
      notes: `Transferred from ${fromEmployee.name} (${fromEmployee.employeeId}) to ${employee.name} (${employee.employeeId}). ${[data.reason, data.notes].filter(Boolean).join(' — ')}`,
    });
    await resolveOffboarding(tx, id, current.employeeId, 'TRANSFERRED');
    await tx.assetRequest.updateMany({
      where: { assetId: id, employeeId: current.employeeId, type: 'TRANSFER', status: 'APPROVED' },
      data: { status: 'COMPLETED' },
    });
    await notifyEmployee(
      tx,
      employee.id,
      'Asset transferred to you',
      `${asset.assetTag} is now assigned to you.`,
      `/assets/${id}`,
    );
    await notifyEmployee(
      tx,
      current.employeeId,
      'Asset transferred',
      `${asset.assetTag} has been transferred from your custody.`,
      '/profile',
    );
    return withHolder(await tx.asset.findUniqueOrThrow({ where: { id }, include: assetInclude }));
  });
}
export async function returnAsset(id: string, actor: Actor, data: z.infer<typeof returnSchema>) {
  return transaction(async (tx) => {
    const asset = await lockedAsset(tx, id);
    const current = asset.assignments[0];
    if (!current) throw new AppError(409, 'The asset has no active assignment.', 'NO_ACTIVE_ASSIGNMENT');
    const returnedAt = data.returnedAt ?? new Date();
    assertChronology(returnedAt, current.assignedAt);
    const status = availableAfterReturn(data.condition);
    await tx.assetAssignment.update({
      where: { id: current.id },
      data: { returnedAt, returnedById: actor.id, conditionAtReturn: data.condition },
    });
    await tx.assetReturn.create({
      data: {
        assetId: id,
        employeeId: current.employeeId,
        returnedAt,
        condition: data.condition,
        accessories: data.accessories,
        damage: data.damage,
        notes: data.notes,
        performedById: actor.id,
      },
    });
    await tx.asset.update({ where: { id }, data: { status, condition: data.condition } });
    const fromEmployee = await tx.employee.findUniqueOrThrow({
      where: { id: current.employeeId },
      select: { name: true, employeeId: true },
    });
    await history(tx, actor, id, 'ASSET_RETURNED', {
      previousStatus: asset.status,
      newStatus: status,
      previousEmployeeId: current.employeeId,
      timestamp: returnedAt,
      notes: `Returned by ${fromEmployee.name} (${fromEmployee.employeeId}).${data.notes ? ` ${data.notes}` : ''}`,
      metadata: { condition: data.condition, accessories: data.accessories, damage: data.damage ?? '' },
    });
    await resolveOffboarding(tx, id, current.employeeId, 'RETURNED');
    await tx.assetRequest.updateMany({
      where: { assetId: id, employeeId: current.employeeId, type: 'RETURN', status: 'APPROVED' },
      data: { status: 'COMPLETED' },
    });
    await notifyEmployee(
      tx,
      current.employeeId,
      'Asset returned',
      `${asset.assetTag} has been received and removed from your current assets.`,
      '/profile',
    );
    return withHolder(await tx.asset.findUniqueOrThrow({ where: { id }, include: assetInclude }));
  });
}
const transitions: Record<string, string[]> = {
  AVAILABLE: ['DAMAGED', 'LOST', 'RETIRED'],
  ASSIGNED: ['DAMAGED', 'LOST'],
  DAMAGED: ['AVAILABLE', 'LOST', 'RETIRED'],
  LOST: ['AVAILABLE', 'DISPOSED'],
  UNDER_REPAIR: [],
  RETIRED: ['DISPOSED'],
  DISPOSED: [],
};
export function assertTransition(from: string, to: string, hasAssignment: boolean, role: string) {
  if (!transitions[from]?.includes(to))
    throw new AppError(
      409,
      `Cannot change ${from} to ${to}. Use the corresponding lifecycle workflow.`,
      'INVALID_STATUS_TRANSITION',
    );
  if (hasAssignment && !['DAMAGED', 'LOST'].includes(to))
    throw new AppError(409, 'Return or transfer the asset before changing its status.', 'ACTIVE_ASSIGNMENT');
  if ((from === 'LOST' || to === 'DISPOSED') && role !== 'ADMIN')
    throw new AppError(403, 'Only an administrator can recover or dispose of lost assets.', 'FORBIDDEN');
}
export async function setStatus(tx: Tx, id: string, actor: Actor, status: string, notes?: string) {
  const asset = await lockedAsset(tx, id);
  const current = asset.assignments[0];
  assertTransition(asset.status, status, Boolean(current), actor.role);
  if (status === 'LOST' && current) {
    if (
      actor.role !== 'ADMIN' &&
      (await tx.offboarding.count({ where: { employeeId: current.employeeId, status: 'IN_PROGRESS' } }))
    )
      throw new AppError(
        403,
        'An administrator must approve loss of an outstanding offboarding asset.',
        'ADMIN_LOSS_APPROVAL_REQUIRED',
      );
    await tx.assetAssignment.update({
      where: { id: current.id },
      data: { returnedAt: new Date(), returnedById: actor.id, conditionAtReturn: asset.condition },
    });
    await resolveOffboarding(tx, id, current.employeeId, 'LOST');
  }
  await tx.asset.update({
    where: { id },
    data: {
      status,
      ...(status === 'DAMAGED' ? { condition: 'DAMAGED' } : {}),
      ...(status === 'AVAILABLE' && asset.condition === 'DAMAGED' ? { condition: 'GOOD' } : {}),
    },
  });
  const events: Record<string, string> = {
    LOST: 'ASSET_REPORTED_LOST',
    DAMAGED: 'ASSET_REPORTED_DAMAGED',
    RETIRED: 'ASSET_RETIRED',
    DISPOSED: 'ASSET_DISPOSED',
  };
  await history(tx, actor, id, events[status] ?? 'STATUS_CHANGED', {
    previousStatus: asset.status,
    newStatus: status,
    previousEmployeeId: current?.employeeId,
    notes,
  });
  if (current)
    await notifyEmployee(
      tx,
      current.employeeId,
      'Asset status updated',
      `${asset.assetTag} has been marked ${status.toLowerCase().replaceAll('_', ' ')}.`,
      '/profile',
    );
  return withHolder(await tx.asset.findUniqueOrThrow({ where: { id }, include: assetInclude }));
}
