import { Prisma } from '@prisma/client';
import type { Actor } from '../http.js';
export type Tx = Prisma.TransactionClient;
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entityType: string,
  entityId?: string,
  details?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      userId: actor.id,
      userName: actor.name,
      action,
      entityType,
      entityId,
      ip: actor.requestIp,
      ...(details ? { details } : {}),
    },
  });
}
export async function history(
  tx: Tx,
  actor: Actor,
  assetId: string,
  eventType: string,
  fields: Omit<Prisma.AssetHistoryUncheckedCreateInput, 'assetId' | 'eventType' | 'performedById'> = {},
) {
  await tx.assetHistory.create({
    data: {
      assetId,
      eventType,
      performedById: actor.id,
      performedByName: actor.name,
      timestamp: new Date(),
      ...fields,
    },
  });
  await audit(
    tx,
    actor,
    eventType,
    'Asset',
    assetId,
    JSON.parse(JSON.stringify(fields)) as Prisma.InputJsonValue,
  );
}
export async function notifyEmployee(
  tx: Tx,
  employeeId: string,
  title: string,
  message: string,
  link?: string,
) {
  const user = await tx.user.findUnique({ where: { employeeId }, select: { id: true } });
  if (user) await tx.notification.create({ data: { userId: user.id, title, message, link } });
}
export async function notifyManagers(tx: Tx, title: string, message: string, link?: string) {
  const users = await tx.user.findMany({
    where: { active: true, role: { in: ['ADMIN', 'ASSET_MANAGER'] } },
    select: { id: true },
  });
  await tx.notification.createMany({
    data: users.map((user) => ({ userId: user.id, title, message, link })),
  });
}
