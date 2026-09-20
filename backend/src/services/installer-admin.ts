import { Prisma, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Explicit first-install credentials requested for this deployment. The normal
// password policy still applies when this temporary password is changed.
export const installerAdmin = {
  username: 'admin',
  password: 'Admin@123',
  email: 'admin@infocus.invalid',
  name: 'INFOCUS Administrator',
} as const;

export class InstallerAdminConflict extends Error {}

export async function ensureInstallerAdmin(db: PrismaClient): Promise<'created' | 'existing-admin'> {
  return db.$transaction(
    async (tx) => {
      // Share the manual bootstrap's lock. READ COMMITTED gives a waiting rerun
      // a fresh snapshot after the previous bootstrap commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73003812)`;
      if (await tx.user.count({ where: { role: 'ADMIN' } })) return 'existing-admin';

      const userCollision = await tx.user.findFirst({
        where: {
          OR: [
            { username: { equals: installerAdmin.username, mode: 'insensitive' } },
            { email: { in: [installerAdmin.email, installerAdmin.username], mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      const employeeCollision = await tx.employee.findFirst({
        where: { employeeId: { equals: installerAdmin.username, mode: 'insensitive' } },
        select: { id: true },
      });
      if (userCollision || employeeCollision)
        throw new InstallerAdminConflict(
          'The installer administrator username or reserved email is already in use. No existing account was changed; resolve the identifier conflict before rerunning.',
        );

      const user = await tx.user.create({
        data: {
          username: installerAdmin.username,
          email: installerAdmin.email,
          name: installerAdmin.name,
          passwordHash: await bcrypt.hash(installerAdmin.password, 12),
          role: 'ADMIN',
          active: true,
          mustChangePassword: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          userName: user.name,
          action: 'ADMIN_BOOTSTRAPPED',
          entityType: 'User',
          entityId: user.id,
          details: { source: 'installer', username: user.username, mustChangePassword: true },
        },
      });
      return 'created';
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 },
  );
}
