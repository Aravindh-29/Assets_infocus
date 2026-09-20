import { prisma, logger } from '../db.js';
import { notifyManagers } from './audit.js';
import { transaction } from './lifecycle.js';

export async function generateWarrantyAlerts() {
  try {
    await transaction(async (tx) => {
      const today = new Date().toISOString().slice(0, 10);
      const previous = await tx.setting.findUnique({ where: { key: 'internalWarrantyAlertDate' } });
      if (previous?.value === today) return;
      const days = await tx.setting.findUnique({ where: { key: 'warrantyAlertDays' } });
      const count = await tx.asset.count({
        where: {
          deletedAt: null,
          status: { notIn: ['DISPOSED', 'RETIRED'] },
          warrantyExpiry: {
            gte: new Date(),
            lte: new Date(Date.now() + (typeof days?.value === 'number' ? days.value : 30) * 86400000),
          },
        },
      });
      if (count)
        await notifyManagers(
          tx,
          'Warranties expiring soon',
          `${count} asset warranties will expire within the configured alert period.`,
          '/reports?type=warranty',
        );
      await tx.setting.upsert({
        where: { key: 'internalWarrantyAlertDate' },
        create: { key: 'internalWarrantyAlertDate', value: today },
        update: { value: today },
      });
    });
  } catch (error) {
    logger.error(
      { message: error instanceof Error ? error.message : 'Unknown error' },
      'Warranty alert generation failed',
    );
  }
}
