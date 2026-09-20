import { PrismaClient } from '@prisma/client';
import { ensureInstallerAdmin, InstallerAdminConflict } from '../src/services/installer-admin.js';

if (!process.env.DATABASE_URL) {
  console.error('Installer administrator setup requires the application DATABASE_URL.');
  process.exitCode = 1;
} else {
  const db = new PrismaClient();
  try {
    // Machine-readable status for install.sh; credentials are printed by the
    // installer only after the complete application verification succeeds.
    console.log(await ensureInstallerAdmin(db));
  } catch (error) {
    console.error(
      error instanceof InstallerAdminConflict
        ? error.message
        : 'Installer administrator setup failed. Verify migrations and runtime permissions; no partial administrator was committed.',
    );
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
